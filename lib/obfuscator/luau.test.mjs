import assert from 'node:assert/strict'
import { test, after } from 'node:test'
import { LuauState } from 'luau-web'
import { compileLuau } from './luau.ts'
import { compileSource } from './compiler.ts'
import { DEFAULT_OPTIONS, MAX_SOURCE_BYTES } from './types.ts'

const fixtures = [
  ['typed generic closures', 'export type Box<T> = {value:T}\nlocal function make<T>(v:T): () -> T return function() return v end end return make("hello")()'],
  ['varargs and nil holes', 'local function f(...) return select("#",...),... end return f(1,nil,3,nil)'],
  ['continue and compound assignments', 'local n=0 for i=1,5 do if i==3 then continue end n+=i end n*=2 n//=3 return n'],
  ['generalized iteration', 'local sum=0 for k,v in {2,4,6} do sum+=v end return sum'],
  ['conditional expressions', 'local x:number=3 return if x>2 then "yes" else "no"'],
  ['nested interpolation', 'local x="世界" return `outer {`inner {x}`} {({name="value"}).name}`'],
  ['escaped interpolation', 'return `literal \\{brace} and \\`tick`'],
  ['UTF8 and singleton types', 'type Mode = "世界" | "hello"\nlocal x:Mode="世界" return x,"café", "123"'],
  ['escapes and long brackets', 'return "a\\n\\0009", [==[\nlong -- text ]=] \\n]==]'],
  ['comment token boundaries', '--!strict\nlocal x=1--[=[ comment\ntext ]=] +2 -- end\nreturn x, "-- not a comment"'],
  ['closure mutation and recursion', 'local n=0 local function f(x) n+=1 if x<2 then return 1 end return x*f(x-1) end return f(5),n'],
  ['metamethods and yielding', 'local t=setmetatable({}, {__index=function(_,k) return k end}) local co=coroutine.create(function() coroutine.yield(t.hello) return "done" end) local a,b=coroutine.resume(co) local c,d=coroutine.resume(co) return a,b,c,d'],
  ['Roblox-style callbacks with mock service', 'local callback local game={GetService=function(self,name) return {Connect=function(self,fn) callback=fn end} end} game:GetService("Players"):Connect(function(player) return player.Name end) return callback({Name="Ada"})'],
  ['binary literals and casts', 'local n:any=0b1010_0011 return (n::number)//2, 1_000, 0xFF'],
]

const state = await LuauState.createAsync()
after(() => state.destroy())
for (const [name, source] of fixtures) {
  test(`native Luau preserves ${name}`, async () => {
      const expected = await state.loadstring(source, 'fixture', true)()
      for (const encodeStrings of [false, true]) for (const compactOutput of [false, true]) {
        const result = await compileLuau(source, { encodeStrings, compactOutput })
        assert.equal(result.mode, 'native')
        assert.deepEqual(await state.loadstring(result.output, 'result', true)(), expected)
        assert.ok(result.protections.every(key => ['encodeStrings', 'compactOutput'].includes(key)))
        assert.equal(result.stats.instructions, 0)
      }
  })
}

test('VM functions preserve closures, callbacks, varargs, and yielding in Luau', async () => {
  const sources = [
    'local function make(x) return function(y) x=x+y return x end end local f=make(2) return f(3),f(4)',
    'local function fact(n) if n<2 then return 1 end return n*fact(n-1) end return fact(5)',
    'local t={} for i=1,3 do t[i]=function() return i end end return t[1](),t[2](),t[3]()',
    ...fixtures.filter(([name]) => ['varargs and nil holes', 'metamethods and yielding', 'Roblox-style callbacks with mock service'].includes(name)).map(([, source]) => source),
  ]
  for (const source of sources) {
    const expected = await state.loadstring(source, 'original', true)()
    for (const enabled of [false, true]) {
      const options = Object.fromEntries(Object.keys(DEFAULT_OPTIONS).map(key => [key, enabled]))
      const result = compileSource(source, options, true)
      assert.equal(result.mode, 'vm')
      assert.deepEqual(await state.loadstring(result.output, 'virtualized', true)(), expected)
    }
  }
})

test('native validation never executes input', async () => {
  assert.equal((await compileLuau('error("must not execute")')).mode, 'native')
  assert.equal((await compileLuau('while true do end')).mode, 'native')
})

test('native rejects invalid syntax, empty and oversized input', async () => {
  for (const source of ['local =', '', '--' + 'x'.repeat(MAX_SOURCE_BYTES), 'continue', 'return "unterminated']) {
    await assert.rejects(compileLuau(source))
  }
})

test('disabled passes preserve exact source and report no applied protections', async () => {
  const source = '--!strict\n-- comment\nlocal x = "hello"\nreturn x'
  const result = await compileLuau(source, Object.fromEntries(Object.keys(DEFAULT_OPTIONS).map(key => [key, false])))
  assert.equal(result.output, source)
  assert.deepEqual(result.protections, [])
})
