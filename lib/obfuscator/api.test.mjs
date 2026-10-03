import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POST } from '../../app/api/obfuscate/route.ts'
import { DEFAULT_OPTIONS, MAX_SOURCE_BYTES } from './types.ts'

function request(body, contentType = 'application/json') {
  return new Request('http://localhost/api/obfuscate', {
    method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify(body),
  })
}

test('API enables hardened passes for old clients without options', async () => {
  const response = await POST(request({ source: 'return 42' }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const result = await response.json()
  assert.equal(result.protections.length, Object.keys(DEFAULT_OPTIONS).length)
  assert.match(result.output, /Obsidian VM \/ v0\.4\.0/)
})

test('API rejects invalid option values and unknown pass names', async () => {
  for (const options of [[], null, { packBytecode: 'false' }, { flattenControlFlow: 1 }, { renameIdentifier: true }]) {
    const response = await POST(request({ source: 'return 1', options }))
    assert.equal(response.status, 400)
  }
})

test('API accepts arbitrary Luau through the compatibility path', async () => {
  for (const source of [null, 42]) assert.equal((await POST(request({ source }))).status, 400)
  assert.equal((await POST(request({ source: 'local x: number = 1' }))).status, 422)
  assert.equal((await POST(request({ source: 'local = ' }))).status, 422)
  assert.equal((await POST(request({ source: 'return 1', requireVM: 'false' }))).status, 400)
  const compatible = await POST(request({ source: 'local x: number = 1', requireVM: false }))
  assert.equal(compatible.status, 200)
  const result = await compatible.json()
  assert.equal(result.mode, 'compatibility')
  assert.ok(result.warnings.length > 0)
  assert.ok(!result.protections.includes('packBytecode'))
  assert.equal((await POST(request({ source: 'while true do end' }))).status, 200)
})

test('API virtualizes declarations and anonymous functions in VM-only mode', async () => {
  const response = await POST(request({ source: 'local function make(x) return function(y) return x+y end end return make(2)(3)', requireVM: true }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.mode, 'vm')
  assert.deepEqual(result.warnings, [])
  assert.ok(result.stats.instructions > 0)
  assert.ok(!result.output.includes('loadstring'))
})

test('API supports validated native Luau without weakening VM-only requests', async () => {
  const response = await POST(request({ mode: 'native', source: 'local function f(x:number):number return x+1 end return f(2)' }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.mode, 'native')
  assert.equal(result.stats.handlers, 0)
  assert.ok(!result.output.includes('loadstring'))
  assert.equal((await POST(request({ mode: 'native', source: 'local =' }))).status, 422)
  assert.equal((await POST(request({ mode: 'native', requireVM: true, source: 'return 1' }))).status, 400)
  assert.equal((await POST(request({ mode: 'unknown', source: 'return 1' }))).status, 400)
})

test('API validates content type, malformed JSON, and request limits', async () => {
  for (const mediaType of ['text/plain', 'application/json-invalid']) {
    assert.equal((await POST(request({}, mediaType))).status, 415)
  }
  for (const mediaType of ['application/json; charset=utf-8', 'Application/JSON']) {
    assert.equal((await POST(request({ source: 'return 1', mode: 'native' }, mediaType))).status, 200)
  }
  assert.equal((await POST(new Request('http://localhost/api/obfuscate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  }))).status, 400)
  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_SOURCE_BYTES * 6 + 4097))
      controller.close()
    },
  })
  assert.equal((await POST(new Request('http://localhost/api/obfuscate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: oversizedBody, duplex: 'half',
  }))).status, 413)
  for (const mode of ['vm', 'native']) {
    const response = await POST(request({ source: 'a'.repeat(MAX_SOURCE_BYTES + 1), mode }))
    assert.equal(response.status, 422)
    assert.match((await response.json()).error, /10 MB/)
  }
})

test('API accepts source at the 10 MB boundary', async () => {
  assert.equal(MAX_SOURCE_BYTES, 10 * 1024 * 1024)
  const source = 'return 42 --' + 'x'.repeat(MAX_SOURCE_BYTES - 12)
  const response = await POST(request({ source, requireVM: true }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).stats.inputBytes, MAX_SOURCE_BYTES)
})
