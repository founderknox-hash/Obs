import assert from 'node:assert/strict'
import { test } from 'node:test'
import fengari from 'fengari'
import { compileSource } from './compiler.ts'
import { DEFAULT_OPTIONS, EXAMPLE_SOURCE, MAX_SOURCE_BYTES } from './types.ts'

const { lua, lauxlib, lualib, to_luastring, to_jsstring } = fengari

function execute(source, setup = '') {
  const L = lauxlib.luaL_newstate()
  lualib.luaL_openlibs(L)
  try {
    const loaded = lauxlib.luaL_loadstring(L, to_luastring('unpack=table.unpack\n' + setup + '\n' + source))
    assert.equal(loaded, lua.LUA_OK, loaded === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(L, -1)))
    const result = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0)
    assert.equal(result, lua.LUA_OK, result === lua.LUA_OK ? '' : to_jsstring(lua.lua_tostring(L, -1)))
    function read(index) {
      const type = lua.lua_type(L, index)
      if (type === lua.LUA_TNIL) return null
      if (type === lua.LUA_TNUMBER) return lua.lua_tonumber(L, index)
      if (type === lua.LUA_TBOOLEAN) return lua.lua_toboolean(L, index)
      if (type === lua.LUA_TSTRING) return to_jsstring(lua.lua_tostring(L, index))
      if (type === lua.LUA_TTABLE) {
        const table = {}
        const absolute = lua.lua_absindex(L, index)
        lua.lua_pushnil(L)
        while (lua.lua_next(L, absolute)) {
          const key = lua.lua_type(L, -2) === lua.LUA_TNUMBER ? lua.lua_tonumber(L, -2) : to_jsstring(lua.lua_tostring(L, -2))
          table[key] = read(-1)
          lua.lua_pop(L, 1)
        }
        return table
      }
      throw new Error(`Unexpected return type ${type}`)
    }
    return Array.from({ length: lua.lua_gettop(L) }, (_, i) => read(i + 1))
  } finally { lua.lua_close(L) }
}

const fixtures = [
  ['global function declaration', 'function add(a,b) return a+b end return add(2,3)'],
  ['local recursive declaration', 'local function fact(n) if n<2 then return 1 end return n*fact(n-1) end return fact(6)'],
  ['anonymous expression and immediate call', 'local f=function(x) return x*2 end return f(4),(function(x) return x+1 end)(8)'],
  ['method and dotted declarations', 'local t={nested={},n=4} function t.nested.add(a,b) return a+b end function t:add(x) self.n=self.n+x return self.n end return t:add(3),t.nested.add(2,5)'],
  ['shared mutable upvalues', 'local n=0 local inc=function() n=n+1 end local get=function() return n end inc() inc() return get()'],
  ['independent escaped closures', 'local function make(n) return function() n=n+1 return n end end local a,b=make(0),make(10) return a(),b(),a()'],
  ['transitive captures', 'local function outer(x) return function() return function() x=x+1 return x end end end local f=outer(3)() return f(),f()'],
  ['mutual recursion', 'local odd,even odd=function(n) if n==0 then return false end return even(n-1) end even=function(n) if n==0 then return true end return odd(n-1) end return odd(5),even(8)'],
  ['declaration assigns existing local', 'local f function f() return 7 end return f()'],
  ['anonymous initializer sees outer binding', 'local f=9 do local f=function() return f end return f() end'],
  ['local recursion survives shadowing', 'local function f(n) if n==0 then return 1 end return f(n-1)+1 end local old=f local f=0 return old(3),f'],
  ['numeric loop closures', 'local t={} for i=1,3 do t[i]=function() return i end end return t[1](),t[2](),t[3]()'],
  ['generic loop closures', 'local t={} for i,v in ipairs({4,5,6}) do t[i]=function() return i,v end end return t[1](),t[2](),t[3]()'],
  ['while loop local cells', 'local t={} local i=0 while i<3 do i=i+1 local x=i t[i]=function() x=x+10 return x end end return t[1](),t[2](),t[1]()'],
  ['repeat closures capture condition mutation', 'local t={} local i=0 repeat local x=i t[i+1]=function() return x end i=i+1 until i==3 return t[1](),t[2](),t[3]()'],
  ['function varargs and nil holes', 'local function f(a,...) return a,select("#",...),... end return f(1,2,nil,4,nil)'],
  ['grouped and scalar varargs', 'local function f(...) local a,b=(...) return a,b,(...),select("#",(...)) end return f(1,2)'],
  ['empty varargs and missing parameters', 'local function f(a,b,...) return a,b,select("#",...),... end return f(1)'],
  ['vararg table and call forwarding', 'local function f(...) return {...},select("#",...) end local function g(...) return f(...) end return g(1,nil,3,nil)'],
  ['callback and implicit return', 'local t={3,1,2} table.sort(t,function(a,b) return a<b end) local function f() local x=1 end return t,f()'],
  ['nested loop break isolation', 'local sum=0 for i=1,3 do local function f() for j=1,3 do break end return i end sum=sum+f() end return sum'],
  ['expanded assignments with nils', 'local a,b,c,d=unpack({1,false,3}) return a,b,c,d'],
  ['expanded returns with nils', 'return 5,unpack({1,false,3},1,4)'],
  ['expanded arguments', 'return select("#", 0,unpack({1,false,3},1,4))'],
  ['expanded table tail', 'local t={8,unpack({1,false,3})} return t'],
  ['parenthesized return', 'return (unpack({1,2,3}))'],
  ['parenthesized assignment', 'local a,b=(unpack({1,2})) return a,b'],
  ['parenthesized call argument', 'return select("#", (unpack({1,2})))'],
  ['nested grouped calls', 'return select("#", ((unpack({1,2}))))'],
  ['parenthesized table tail', 'return {1,(unpack({2,3}))}'],
  ['grouped function callee', 'return (unpack)({1,2,3})'],
  ['iterator pairs', 'local sum=0 for k,v in pairs({a=2,b=4}) do sum=sum+v end return sum'],
  ['iterator ipairs and break', 'local sum=0 for i,v in ipairs({2,4,6}) do if i==3 then break end sum=sum+v end return sum'],
  ['iterator control independent of loop locals', 'local sum=0 for i,v in ipairs({2,4,6}) do sum=sum+v i=99 end return sum'],
  ['iterator explicit state', 'local sum=0 for k,v in next,{a=2,b=3},nil do sum=sum+v end return sum'],
  ['arithmetic and precedence', 'local a = 8 local b = 3 return a+b,a-b,a*b,a/b,a%b,a^b,-a'],
  ['false, nil, zero and empty string', 'local x = false local y = nil return x,y,0,"",not 0,not "",not y'],
  ['nil return holes', 'return nil, 12, nil'],
  ['lexical shadowing', 'local x=7 do local x=x+2 x=x+3 end return x'],
  ['reset uninitialized loop locals', 'local i=0 local sum=0 while i<3 do local x if i==0 then x=2 end if x then sum=sum+x end i=i+1 end return sum'],
  ['short circuit', 'local a = false and error("no") local b = true or error("no") return a,b,0 or 5,nil or "yes"'],
  ['branches', 'local n=3 local s="" if n<1 then s="a" elseif n<4 then s="b" else s="c" end return s'],
  ['while and break', 'local n=0 while true do n=n+1 if n==4 then break end end return n'],
  ['numeric for and shadowing', 'local i=99 local n=0 for i=1,4 do n=n+i i=200 end return n,i'],
  ['negative numeric step', 'local n=0 for i=6,1,-2 do n=n+i end return n'],
  ['numeric string bounds', 'local n=0 for i="1","3" do n=n+i end return n'],
  ['nested loop breaks', 'local n=0 for i=1,3 do for j=1,9 do n=n+1 break end end return n'],
  ['table constructors and assignment', 'local t={name="hello",[2]=8} t.name=t.name.." world" t[3]=false return t'],
  ['table lengths', 'local t={1,2,3} return #t'],
  ['method calls', 'local s=("hello"):upper() return s'],
  ['built-in calls and nil args', 'local n=select("#",nil,1,nil) local x=math.floor(3.9) return n,x'],
  ['globals', 'obsidian_test_value=9 local n=obsidian_test_value return n'],
  ['runtime helpers survive global writes', 'tonumber=nil error=nil local n=0 for i=1,3 do n=n+i end return n'],
  ['utf8 and escapes', 'local s="héllo 世界\\n\\000\\255" return #s,s=="héllo 世界\\n\\000\\255"'],
  ['long strings', 'local s=[=[hello\nworld]=] return s'],
  ['comments and empty return', '-- comment\nreturn'],
  ['parallel swap', 'local a,b=1,2 a,b=b,a return a,b'],
  ['repeated assignment targets', 'local a=0 a,a=1,2 return a'],
  ['aliased table targets', 'local t={} t[1],t[1]=1,2 return t[1]'],
  ['nil padding', 'local a,b,c=1 a,b,c=3 return a,b,c'],
  ['parallel local scope', 'local a,b=1,2 do local a,b=b,a return a,b end'],
  ['assignment key capture', 'local i,t=1,{} i,t[i]=2,9 return i,t[1],t[2]'],
  ['assignment object capture', 'local t={1} local old=t t,t[1]={2},3 return t[1],old[1]'],
  ['discarded expressions still execute', 'local t={} local a=1,table.insert(t,2) a=3,table.insert(t,4) return a,t'],
  ['multiple uninitialized locals', 'local a,b,c return a,b,c'],
  ['repeat condition sees locals', 'local count=0 repeat local stop=count>=3 count=count+1 until stop return count'],
  ['repeat resets locals', 'local count=0 local seen=0 repeat local x if count==0 then x=8 end if x then seen=seen+x end count=count+1 until count==3 return seen'],
  ['repeat break exits nested scopes', 'local n=0 repeat do n=n+1 if n==3 then break end end until false return n'],
  ['repeat scope isolation', 'local stop=42 repeat local stop=true until stop return stop'],
  ['nested repeat and while breaks', 'local n=0 repeat while true do n=n+1 break end until n==3 return n'],
]

for (const [name, source] of fixtures) {
  test(name, () => {
    const expected = execute(source)
    const keys = Object.keys(DEFAULT_OPTIONS)
    for (let flags = 0; flags < 2 ** keys.length; flags++) {
      const options = Object.fromEntries(keys.map((key, index) => [key, Boolean(flags & (1 << index))]))
      const result = compileSource(source, options, true)
      assert.equal(result.mode, 'vm')
      assert.deepEqual(execute(result.output, 'load=nil loadstring=nil'), expected)
      assert.ok(result.stats.instructions > 0)
      assert.equal(result.stats.outputBytes, Buffer.byteLength(result.output))
    }
  })
}

test('Roblox example with mocked APIs', () => {
  const setup = 'game={GetService=function(self,name) return {GetPlayers=function() return {1,2} end} end} print=function() end'
  assert.deepEqual(execute(compileSource(EXAMPLE_SOURCE, DEFAULT_OPTIONS).output, setup), execute(EXAMPLE_SOURCE, setup))
})

test('unsupported syntax falls back only outside VM-only mode', () => {
  const cases = [
    ['local x = function() end; <invalid>', []],
  ]
  for (const [source, expected] of cases) {
    const result = compileSource(source, DEFAULT_OPTIONS)
    assert.match(result.output, /arbitrary-source compatibility/)
    assert.deepEqual(execute(result.output), expected)
    assert.equal(result.stats.instructions, 0)
  }
})

test('Luau syntax enters the VM frontend', () => {
  for (const [source, expected] of [
    ['local x: number = 1 return x', [1]],
    ['local n=0 for i=1,3 do if i==2 then continue end n+=i end return n', [4]],
    ['return `hello {"world"}`', ['hello world']],
    ['return 7 & 3', [3]],
  ]) {
    const result = compileSource(source, DEFAULT_OPTIONS, true)
    assert.equal(result.mode, 'vm')
    assert.deepEqual(execute(result.output), expected)
    assert.equal(result.warnings.length, 0)
  }
})

test('compatibility loader reports missing loader clearly', () => {
  const result = compileSource('return function<T>() end')
  assert.throws(() => execute(result.output, 'load=nil loadstring=nil'), /requires an enabled loadstring or load/)
})

test('iterator first result may be false; only nil terminates', () => {
  const source = 'local n=0 for k,v in iter,nil,nil do n=n+v end return n'
  const setup = 'function iter(s,k) if k==nil then return false,3 end end'
  assert.equal(compileSource(source).mode, 'vm')
  assert.deepEqual(execute(compileSource(source).output, setup), [3])
})

test('randomization and encoding are real', () => {
  const source = 'local message="private marker" return message'
  const a = compileSource(source, DEFAULT_OPTIONS)
  const b = compileSource(source, DEFAULT_OPTIONS)
  assert.notEqual(a.output, b.output)
  assert.ok(!a.output.includes('private marker'))
  assert.deepEqual(execute(a.output), ['private marker'])
})

test('only required opcode handlers are emitted', () => {
  const result = compileSource('return 42', { ...DEFAULT_OPTIONS, randomizeOpcodes: false })
  assert.deepEqual(execute(result.output), [42])
  assert.equal(result.stats.handlers, 2)
  assert.ok(!result.output.includes('numeric for bounds'))
  assert.ok(result.stats.outputBytes < 6000)
})

test('size and empty source validation', () => {
  assert.throws(() => compileSource(' ', DEFAULT_OPTIONS), /Add a script/)
  assert.throws(() => compileSource('a'.repeat(MAX_SOURCE_BYTES + 1), DEFAULT_OPTIONS), /10 MB/)
  assert.equal(compileSource('local x=0 ' + 'x=x+1 '.repeat(5000), DEFAULT_OPTIONS, true).mode, 'vm')
})

test('all byte values survive feedback encoding', () => {
  const literal = Array.from({ length: 256 }, (_, i) => `\\${String(i).padStart(3, '0')}`).join('')
  const source = `local s="${literal}" local sum=0 for i=1,#s do sum=sum+string.byte(s,i) end return #s,sum`
  for (let build = 0; build < 16; build++) assert.deepEqual(execute(compileSource(source).output), [256, 32640])
})

test('lazy helpers survive global library mutation', () => {
  const source = 'string=nil table=nil tonumber=nil error=nil type=nil local s="later decoded" local t={false,128,16384,1.25} return s,t'
  for (let build = 0; build < 16; build++) assert.deepEqual(execute(compileSource(source).output), execute(source))
})

test('large constant pools and register operands', () => {
  const source = `local t={${Array.from({ length: 300 }, (_, i) => `"item_${i}"`).join(',')}} local n=0 for i=1,#t do n=n+#t[i] end return n,t[1],t[300]`
  assert.deepEqual(execute(compileSource(source).output), execute(source))
})

test('randomized layouts preserve nested branches across repeated builds', () => {
  const source = 'local sum=0 for i=1,12 do local j=0 repeat j=j+1 if j==4 then break elseif i%2==0 then sum=sum+i*j else sum=sum-j end until j>5 end return sum'
  const expected = execute(source)
  const outputs = new Set()
  for (let build = 0; build < 64; build++) {
    const result = compileSource(source)
    assert.deepEqual(execute(result.output), expected)
    outputs.add(result.output)
  }
  assert.equal(outputs.size, 64)
})

test('default output uses packed records and mangled symbols', () => {
  const result = compileSource('local namedSecret="sensitive-marker" return namedSecret,987654321')
  assert.ok(!result.output.includes('sensitive-marker'))
  assert.ok(!result.output.includes('namedSecret'))
  assert.ok(!result.output.includes('987654321'))
  assert.ok(!result.output.includes('_constant'))
  assert.ok(!result.output.includes('_code'))
  assert.match(result.output, /_[a-f0-9]+\("(?:\\\d{3})+"\)/)
  assert.deepEqual(new Set(result.protections), new Set(Object.keys(DEFAULT_OPTIONS)))
  assert.deepEqual(execute(result.output), ['sensitive-marker', 987654321])
})

test('disabled transformations are deterministic and correctly reported', () => {
  const options = Object.fromEntries(Object.keys(DEFAULT_OPTIONS).map(key => [key, false]))
  const source = 'local a="visible" local b=false return a,b'
  const a = compileSource(source, options)
  const b = compileSource(source, options)
  assert.equal(a.output, b.output)
  assert.deepEqual(a.protections, [])
  assert.deepEqual(execute(a.output), execute(source))
})

test('empty chunks and terminal branches are valid', () => {
  for (const source of ['-- only a comment', 'if false then return 1 end', 'do end', 'while false do end']) {
    assert.deepEqual(execute(compileSource(source).output), execute(source))
  }
})
