import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { CompileError } from './compiler'

export type LuauAst = Record<string, any>

function binaryPath() {
  const configured = process.env.LUAU_AST_BIN
  if (configured) return configured
  const bundled = resolve(process.cwd(), 'tools/luau-ast/bin/luau-ast')
  if (existsSync(bundled)) return bundled
  throw new CompileError('The official Luau AST frontend is not installed. Build tools/luau-ast/bin/luau-ast or set LUAU_AST_BIN.')
}

export function parseLuau(source: string): LuauAst {
  try {
    const json = execFileSync(binaryPath(), [], {
      input: source,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 8000,
      windowsHide: true,
    })
    return JSON.parse(json) as LuauAst
  } catch (error: any) {
    if (error?.status === 2) throw new CompileError(`Luau parser: ${String(error.stderr || error.message).trim()}`)
    if (error?.code === 'ETIMEDOUT') throw new CompileError('Luau parser timed out. Simplify the script.')
    if (error instanceof CompileError) throw error
    throw new CompileError(`Luau AST frontend failed: ${error?.message ?? 'unknown error'}`)
  }
}
