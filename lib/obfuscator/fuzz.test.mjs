import assert from 'node:assert/strict'
import { test } from 'node:test'
import fengari from 'fengari'
import { compileSource } from './compiler.ts'
import { DEFAULT_OPTIONS } from './types.ts'

function execute(output) {
  const { lua, lauxlib, lualib, to_luastring } = fengari
  const state = lauxlib.luaL_newstate(); lualib.luaL_openlibs(state)
  try {
    assert.equal(lauxlib.luaL_loadstring(state, to_luastring(output)), lua.LUA_OK)
    assert.equal(lua.lua_pcall(state, 0, lua.LUA_MULTRET, 0), lua.LUA_OK)
    return [lua.lua_tonumber(state,-1)]
  } finally { lua.lua_close(state) }
}

function rand(seed) { let x=seed>>>0; return () => (x=(Math.imul(x,1664525)+1013904223)>>>0)/2**32 }

test('randomized arithmetic differential corpus', () => {
  const r=rand(0x5eed1234)
  const ops=['+','-','*','/','//','%']
  for(let n=0;n<100;n++){
    const values=Array.from({length:5},()=>1+Math.floor(r()*20))
    const expr=values.slice(1).reduce((acc,v)=>`(${acc}${ops[Math.floor(r()*ops.length)]}${v})`,String(values[0]))
    const source=`return ${expr}`
    const expected=execute(source)
    const result=compileSource(source,DEFAULT_OPTIONS,true)
    assert.equal(result.mode,'vm')
    assert.deepEqual(execute(result.output),expected,source)
  }
})
