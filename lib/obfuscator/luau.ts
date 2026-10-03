import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'

const validationWorker = `
const { parentPort, workerData } = require('node:worker_threads');
(async () => {
  const { LuauState } = await import(workerData.moduleUrl);
  const state = await LuauState.createAsync();
  try {
    state.loadstring(workerData.source, 'source', true);
    state.loadstring(workerData.output, 'output', true);
    parentPort.postMessage({ ok: true });
  } catch (error) {
    parentPort.postMessage({ error: String(error.message) });
  } finally { state.destroy(); }
})().catch(() => parentPort.postMessage({ internal: true }));
`

function validateLuau(source: string, output: string) {
  // Fresh workers isolate the WASM runtime and enforce a compilation time budget.
  const moduleUrl = pathToFileURL(createRequire(`${process.cwd()}/package.json`).resolve('luau-web')).href
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(validationWorker, { eval: true, workerData: { source, output, moduleUrl }, resourceLimits: { maxOldGenerationSizeMb: 64 } })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => finish(new CompileError('Luau validation timed out. Simplify the script.')), 8000)
    worker.once('message', result => finish(result.ok ? undefined : result.error ? new CompileError(`Luau compilation failed: ${result.error}`) : new Error('Luau validator failed.')))
    worker.once('error', finish)
    worker.once('exit', () => finish(new Error('Luau validator stopped before returning a result.')))
  })
}
import { CompileError } from './compiler'
import { DEFAULT_OPTIONS, MAX_SOURCE_BYTES, type CompilerOptions, type CompileResult } from './types'

function longEnd(source: string, start: number): number | undefined {
  const open = /^\[(=*)\[/.exec(source.slice(start))
  if (!open) return undefined
  const end = source.indexOf(`]${open[1]}]`, start + open[0].length)
  return end < 0 ? source.length : end + open[0].length
}

function quotedEnd(source: string, start: number) {
  let i = start + 1
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue }
    if (source[i++] === source[start]) return i
  }
  return i
}

function commentEnd(source: string, start: number) {
  return longEnd(source, start + 2) ?? (() => {
    const end = source.indexOf('\n', start)
    return end < 0 ? source.length : end
  })()
}

// Interpolation is preserved verbatim, including nested templates and expressions.
function templateEnd(source: string, start: number) {
  const stack: number[] = [-1]
  let i = start + 1
  while (i < source.length && stack.length) {
    const mode = stack[stack.length - 1]
    const char = source[i]
    if (mode === -1) {
      if (char === '\\') { i += 2; continue }
      if (char === '`') stack.pop()
      else if (char === '{') stack.push(1)
      i++
    } else if (char === '"' || char === "'") i = quotedEnd(source, i)
    else if (source.startsWith('--', i)) i = commentEnd(source, i)
    else if (char === '[' && longEnd(source, i) !== undefined) i = longEnd(source, i)!
    else {
      if (char === '`') stack.push(-1)
      else if (char === '{') stack[stack.length - 1]++
      else if (char === '}' && --stack[stack.length - 1] === 0) stack.pop()
      i++
    }
  }
  return i
}

export function transformLuau(source: string, options: CompilerOptions) {
  const parts: string[] = []
  const applied = new Set<keyof CompilerOptions>()
  let i = 0
  while (i < source.length) {
    const start = i
    const char = source[i]
    if (source.startsWith('--', i)) {
      i = commentEnd(source, i)
      const text = source.slice(start, i)
      if (options.compactOutput && !text.startsWith('--!')) {
        parts.push(' ' + (text.match(/\r\n|\r|\n/g) ?? []).join(''))
        applied.add('compactOutput')
      } else parts.push(text)
    } else if (char === '"' || char === "'") {
      i = quotedEnd(source, i)
      const text = source.slice(start + 1, i - 1)
      // Preserve existing escapes and singleton type literals without decoding/re-encoding them.
      if (options.encodeStrings && text.length && !text.includes('\\')) {
        parts.push('"' + Array.from(Buffer.from(text, 'utf8'), byte => `\\${String(byte).padStart(3, '0')}`).join('') + '"')
        applied.add('encodeStrings')
      } else parts.push(source.slice(start, i))
    } else if (char === '`') {
      i = templateEnd(source, i)
      parts.push(source.slice(start, i))
    } else if (char === '[' && longEnd(source, i) !== undefined) {
      i = longEnd(source, i)!
      parts.push(source.slice(start, i))
    } else if (options.compactOutput && /[\t \v\f]/.test(char)) {
      while (i < source.length && /[\t \v\f]/.test(source[i])) i++
      parts.push(' ')
      if (source.slice(start, i) !== ' ') applied.add('compactOutput')
    } else { parts.push(char); i++ }
  }
  return { output: parts.join(''), protections: [...applied] }
}

export async function compileLuau(source: string, options: Partial<CompilerOptions> = DEFAULT_OPTIONS): Promise<CompileResult> {
  const start = performance.now()
  const inputBytes = Buffer.byteLength(source, 'utf8')
  if (!source.trim()) throw new CompileError('Add a script before compiling.')
  if (inputBytes > MAX_SOURCE_BYTES) throw new CompileError('Source exceeds the 10 MB limit.')
  const transformed = transformLuau(source, { ...DEFAULT_OPTIONS, ...options })
  await validateLuau(source, transformed.output)
  return {
      mode: 'native',
      warnings: ['Native Luau output is not VM-virtualized. Only conservative string escaping and comment/whitespace reduction are applied. Names, control flow, escaped strings, long strings, directives, and interpolated strings are preserved. Validate Roblox APIs and execution context in Studio; syntax validation is not type checking.'],
      ...transformed,
      stats: { inputBytes, outputBytes: Buffer.byteLength(transformed.output), instructions: 0, constants: 0, handlers: 0, durationMs: Math.max(1, Math.round(performance.now() - start)) },
      buildId: randomUUID(),
    }
}
