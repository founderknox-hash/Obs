import { NextResponse } from 'next/server'
import { CompileError, compileSource } from '@/lib/obfuscator/compiler'
import { compileLuau } from '@/lib/obfuscator/luau'
import { DEFAULT_OPTIONS, MAX_SOURCE_BYTES, type CompilerOptions } from '@/lib/obfuscator/types'

export const runtime = 'nodejs'
export const maxDuration = 15

const noStore = { 'Cache-Control': 'no-store' }
// JSON can encode a single source byte as a six-byte Unicode escape.
const MAX_BODY_BYTES = MAX_SOURCE_BYTES * 6 + 4096

export async function POST(request: Request) {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (mediaType !== 'application/json') {
    return NextResponse.json({ error: 'Content-Type must be application/json.' }, { status: 415, headers: noStore })
  }
  const reader = request.body?.getReader()
  if (!reader) return NextResponse.json({ error: 'A request body is required.' }, { status: 400, headers: noStore })
  let body: unknown
  try {
    const chunks: Uint8Array[] = []
    let size = 0
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return NextResponse.json({ error: 'Request is too large. Source must be at most 10 MB.' }, { status: 413, headers: noStore })
      }
      chunks.push(value)
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request.' }, { status: 400, headers: noStore })
  }
  if (!body || typeof body !== 'object' || !('source' in body) || typeof body.source !== 'string') {
    return NextResponse.json({ error: 'Source must be a string.' }, { status: 400, headers: noStore })
  }
  if ('requireVM' in body && typeof body.requireVM !== 'boolean') {
    return NextResponse.json({ error: 'requireVM must be a boolean.' }, { status: 400, headers: noStore })
  }
  if ('mode' in body && body.mode !== 'native' && body.mode !== 'vm') {
    return NextResponse.json({ error: 'mode must be native or vm.' }, { status: 400, headers: noStore })
  }
  if ('mode' in body && body.mode === 'native' && 'requireVM' in body && body.requireVM === true) {
    return NextResponse.json({ error: 'Native output cannot satisfy requireVM. Choose VM mode or disable requireVM.' }, { status: 400, headers: noStore })
  }
  const options: CompilerOptions = { ...DEFAULT_OPTIONS }
  if ('options' in body) {
    if (!body.options || typeof body.options !== 'object' || Array.isArray(body.options)) {
      return NextResponse.json({ error: 'Invalid compiler options.' }, { status: 400, headers: noStore })
    }
    if (Object.keys(body.options).some(key => !Object.hasOwn(DEFAULT_OPTIONS, key))) {
      return NextResponse.json({ error: 'Unknown compiler option.' }, { status: 400, headers: noStore })
    }
    for (const key of Object.keys(options) as (keyof CompilerOptions)[]) {
      const value = (body.options as Record<string, unknown>)[key]
      if (value !== undefined && typeof value !== 'boolean') {
        return NextResponse.json({ error: `Option ${key} must be a boolean.` }, { status: 400, headers: noStore })
      }
      if (typeof value === 'boolean') options[key] = value
    }
  }
  try {
    const result = 'mode' in body && body.mode === 'native'
      ? await compileLuau(body.source, options)
      : compileSource(body.source, options, 'requireVM' in body ? body.requireVM as boolean : true)
    return NextResponse.json(result, { headers: noStore })
  } catch (error) {
    return NextResponse.json({ error: error instanceof CompileError ? error.message : 'Compilation failed unexpectedly. Simplify the script and try again.' }, { status: error instanceof CompileError ? 422 : 500, headers: noStore })
  }
}
