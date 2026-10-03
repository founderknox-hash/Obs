import assert from 'node:assert/strict'
import { test } from 'node:test'
import fengari from 'fengari'

// luau-web has a fixed ~17 MB heap; use Lua for the large allocation tests.
function execute(output) {
  const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari
  const state = lauxlib.luaL_newstate()
  lualib.luaL_openlibs(state)
  try {
    const loaded = lauxlib.luaL_loadstring(state, to_luastring(output))
    assert.equal(loaded, lua.LUA_OK, loaded === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state, -1)))
    const result = lua.lua_pcall(state, 0, lua.LUA_MULTRET, 0)
    assert.equal(result, lua.LUA_OK, result === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(state, -1)))
    return [lua.lua_tonumber(state, -1)]
  } finally { lua.lua_close(state) }
}
import { compileSource } from './compiler.ts'
import { DEFAULT_OPTIONS } from './types.ts'
import { POST } from '../../app/api/obfuscate/route.ts'

test('chunk boundaries preserve unique constants, loops, and closures', () => {
  const assignments = Array.from({ length: 1200 }, (_, i) => `total+=${i + 1}`).join('\n')
  const input = `local total=0 local function add() ${assignments} end for i=1,2 do add() end return total`
  for (const enabled of [false, true]) {
    const options = Object.fromEntries(Object.keys(DEFAULT_OPTIONS).map(key => [key, enabled]))
    const result = compileSource(input, options, true)
    assert.equal(result.stats.constants, 1201)
    assert.deepEqual(execute(result.output), [1200 * 1201])
  }
})

test('compiles 100,000 statements without an instruction cap or fallback', () => {
  const result = compileSource(`local n=0\n${'n+=1\n'.repeat(100000)}return n`, DEFAULT_OPTIONS, true)
  assert.equal(result.mode, 'vm')
  assert.ok(result.stats.instructions > 400000)
  assert.equal(result.warnings.length, 0)
})

const count = 12000
const source = `local total=0\n${'total+=1\n'.repeat(count)}return total`

for (const packBytecode of [true, false]) {
  test(`large VM output executes beyond the previous instruction cap (packed=${packBytecode})`, async () => {
    const result = compileSource(source, { ...DEFAULT_OPTIONS, packBytecode }, true)
    assert.equal(result.mode, 'vm')
    assert.ok(!result.output.includes('loadstring'))
    assert.deepEqual(execute(result.output), [count])
  })
}

test('API accepts large scripts in VM-only mode', async () => {
  const response = await POST(new Request('http://localhost/api/obfuscate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, requireVM: true }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.mode, 'vm')
  assert.deepEqual(execute(result.output), [count])
})
