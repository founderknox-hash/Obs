import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { LuauState } from 'luau-web'
import { compileSource } from './compiler.ts'
import { DEFAULT_OPTIONS } from './types.ts'
import { POST } from '../../app/api/obfuscate/route.ts'

const state = await LuauState.createAsync()
after(() => state.destroy())

const fixtures = [
  ['all operators', 'local x=10 x+=2 x-=3 x*=4 x/=2 x%=7 x^=3 x//=2 local s="a" s..="b" return x,s'],
  ['negative floor division', 'local x=-7 x//=2 return x'],
  ['RHS precedence', 'local x=2 x*=3+4 x^=1+1 local s="a" s..="b".."c" return x,s'],
  ['global writes', 'compoundGlobal=10 compoundGlobal+=5 return compoundGlobal'],
  ['upvalues and shadowing', 'local x=1 local function f() x+=2 end do local x=10 x*=3 end f() f() return x'],
  ['loop statements', 'local x=0 for i=1,4 do x+=i end repeat x-=1 until x==8 return x'],
  ['member and index targets', 'local t={x=2,[3]=4} t.x+=5 t[3]*=2 return t.x,t[3]'],
  ['target evaluation once and order', 'local trace="" local t={x=4} local function base() trace..="b" return t end local function key() trace..="k" return "x" end local function rhs() trace..="r" return 3 end base()[key()]+=rhs() return t.x,trace'],
  ['RHS changes table and key', 'local t={4,8} local old=t local i=1 local function rhs() t={20} i=2 old[1]=100 return 3 end t[i]+=rhs() return old[1],old[2],t[1],t[2],i'],
  ['key changes local base', 'local t={4} local old=t local function key() t={8} return 1 end t[key()]+=3 return old[1],t[1]'],
  ['RHS changes upvalue', 'local x=4 local function rhs() x=100 return 3 end local function f() x+=rhs() end f() return x'],
  ['RHS changes global', 'compoundGlobal=4 local function rhs() compoundGlobal=100 return 3 end compoundGlobal+=rhs() return compoundGlobal'],
  ['RHS changes captured table', 'local t={4} local old=t local function rhs() t={20} return 3 end local function f() t[1]+=rhs() end f() return old[1],t[1]'],
  ['RHS changes local', 'local x=4 local function rhs() x=100 return 3 end x+=rhs() return x'],
  ['single RHS call result', 'local x=4 local function f() return 3,99 end x+=f() return x'],
  ['single vararg result', 'local function f(...) local x=4 x+=(...) return x end return f(3,99)'],
  ['nested compound functions', 'local x=1 x+=(function() local y=2 y*=3 return y end)() return x'],
  ['comments and multiline syntax', 'local x=1 x --[=[ = += ]=]\n += -- note\n 2 return x'],
  ['literal tokens remain untouched', 'local s="+= -= *= /= //= %= ^= ..=" local t=[==[x+=1]==] -- x+=99\nlocal x=1 x+=2 return s,t,x,"世界"'],
  ['grouping after normalization', 'local x=1 x+=2 local function f() return x,9 end return (f())'],
  ['table metamethod ordering', 'local trace="" local stored=4 local t=setmetatable({}, {__index=function() trace..="g" return stored end,__newindex=function(_,k,v) trace..="s" stored=v end}) local function rhs() trace..="r" return 3 end t.x+=rhs() return stored,trace'],
  ['arithmetic metamethod', 'local t=setmetatable({}, {__add=function(a,b) return b+20 end}) t+=3 return t'],
  ['floor division metamethod', 'local t=setmetatable({}, {__idiv=function(a,b) return b+20 end}) t//=3 return t'],
]

for (const [name, source] of fixtures) {
  test(`VM compound assignments: ${name}`, async () => {
    const expected = await state.loadstring(source, 'original', true)()
    const keys = Object.keys(DEFAULT_OPTIONS)
    for (let flags = 0; flags < 2 ** keys.length; flags++) {
      const options = Object.fromEntries(keys.map((key, index) => [key, Boolean(flags & (1 << index))]))
      const result = compileSource(source, options, true)
      assert.equal(result.mode, 'vm')
      assert.deepEqual(result.warnings, [])
      assert.ok(!result.output.includes('loadstring'))
      assert.deepEqual(await state.loadstring(result.output, 'virtualized', true)(), expected)
    }
  })
}

test('invalid compound assignments never enter VM mode', () => {
  for (const source of ['local x += 1', 'local x,y=1,2 x,y+=3', 'local x=1 x+=2,3', 'return x+=1', 'f()+=1', 'x + = 1', 'x+=', 'x**=2']) {
    assert.throws(() => compileSource(source, DEFAULT_OPTIONS, true))
    assert.equal(compileSource(source).mode, 'compatibility')
  }
})

test('API accepts compound assignments in VM-only mode', async () => {
  const response = await POST(new Request('http://localhost/api/obfuscate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'local x=10 x+=2 x//=3 return x', requireVM: true }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.mode, 'vm')
  assert.deepEqual(await state.loadstring(result.output, 'api', true)(), [4])
})
