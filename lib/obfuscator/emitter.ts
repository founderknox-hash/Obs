import { randomBytes, randomInt } from 'node:crypto'
import { arity, binary, opcodeNames, operandKind, type Opcode, type Program } from './ir'
import type { CompilerOptions } from './types'

function shuffle<T>(items: T[]): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function quoteBytes(bytes: Uint8Array) {
  return '"' + Array.from(bytes, byte => `\\${String(byte).padStart(3, '0')}`).join('') + '"'
}

function varints(values: number[]) {
  const bytes: number[] = []
  for (let value of values) {
    do {
      const digit = value % 128
      value = Math.floor(value / 128)
      bytes.push(digit + (value ? 128 : 0))
    } while (value)
  }
  return Uint8Array.from(bytes)
}

type Variant = { id: number; opcode: Opcode; order: number[] }

const bodies: Record<Opcode, string> = {
  CELL: '$r[@0]={$r[@1]}', GETCELL: '$r[@0]=$r[@1][1]', SETCELL: '$r[@0][1]=$r[@1]',
  PARAM: '$r[@0]={$argv[@1]}',
  VARARG: 'local $values={n=$mathmax(0,$argv.n-@1)} for $j=1,$values.n do $values[$j]=$argv[@1+$j] end $r[@0]=$values',
  GENERIC: 'if $type($r[@0])=="table" then local $it,$st,$ctl=$pairs($r[@0]) $r[@0]=$it $r[@1]=$st $r[@2]=$ctl end',
  CLOSURE: 'local $captured={} for $j=5,#$ins do local $slot=$ins[$j] $captured[$slot]=$r[$slot] end local $entry=@1 $r[@0]=function(...) local $frame={} for $slot,$cell in $pairs($captured) do $frame[$slot]=$cell end return $run($entry,$frame,$pack(...)) end',
  K: '$r[@0]=$constant(@1)', NIL: '$r[@0]=nil', MOVE: '$r[@0]=$r[@1]',
  GLOBAL: '$r[@0]=$env[$constant(@1)]', SETGLOBAL: '$env[$constant(@0)]=$r[@1]',
  GET: '$r[@0]=$r[@1][$r[@2]]', SET: '$r[@0][$r[@1]]=$r[@2]', TABLE: '$r[@0]={}',
  CALL: 'local $args={} local $count=#$ins-4 for $j=1,$count do $args[$j]=$r[$ins[$j+4]] end $r[@0]=$r[@1]($unpack($args,1,$count))',
  PACK: 'local $args={n=#$ins-3} for $j=4,#$ins do $args[$j-3]=$r[$ins[$j]] end $r[@0]=$args',
  APPEND: 'local $args=$r[@0] local $values=$r[@1] for $j=1,$values.n do $args[$args.n+$j]=$values[$j] end $args.n=$args.n+$values.n',
  CALLP: 'local $args=$r[@2] $r[@0]=$pack($r[@1]($unpack($args,1,$args.n)))',
  RETURNP: 'local $args=$r[@0] return $unpack($args,1,$args.n)',
  SETLIST: 'local $values=$r[@2] for $j=1,$values.n do $r[@0][$r[@1]+$j-1]=$values[$j] end',
  RETURN: 'local $args={} local $count=#$ins-2 for $j=1,$count do $args[$j]=$r[$ins[$j+2]] end return $unpack($args,1,$count)',
  JUMP: '$pc=@0', JF: 'if not $r[@0] then $pc=@1 end', JT: 'if $r[@0] then $pc=@1 end',
  FORINIT: 'local $bounds={@0,@1,@2} for $j=1,3 do local $value=$number($r[$bounds[$j]]) if $value==nil then $error("numeric for bounds must be numbers") end $r[$bounds[$j]]=$value end',
  FORCHECK: 'if $r[@3]>0 then $r[@0]=$r[@1]<=$r[@2] else $r[@0]=$r[@1]>=$r[@2] end',
  ...Object.fromEntries(Object.entries(binary).map(([operator, opcode]) => [opcode, `$r[@0]=$r[@1] ${operator} $r[@2]`])) as Record<typeof binary[keyof typeof binary], string>,
  ADDK: '$r[@0]=$r[@1]+$constant(@2)', GETK: '$r[@0]=$r[@1][$constant(@2)]',
  BAND: '$r[@0]=$band($r[@1],$r[@2])', BOR: '$r[@0]=$bor($r[@1],$r[@2])', BXOR: '$r[@0]=$bxor($r[@1],$r[@2])', SHL: '$r[@0]=$shl($r[@1],$r[@2])', SHR: '$r[@0]=$shr($r[@1],$r[@2])',
  BITNOT: '$r[@0]=$bnot($r[@1])',
  NEG: '$r[@0]=-$r[@1]', NOT: '$r[@0]=not $r[@1]', LEN: '$r[@0]=#$r[@1]',
}

function variantBody(opcode: Opcode, variant: number) {
  const body = bodies[opcode]
  const alternatives: Partial<Record<Opcode, string[]>> = {
    MOVE: ['$r[@0]=$r[@1]', 'local $v=$r[@1] $r[@0]=$v'],
    K: ['$r[@0]=$constant(@1)', 'local $v=$constant(@1) $r[@0]=$v'],
    NIL: ['$r[@0]=nil', 'local $v=nil $r[@0]=$v'],
    GET: ['$r[@0]=$r[@1][$r[@2]]', 'local $o=$r[@1] local $k=$r[@2] $r[@0]=$o[$k]'],
    SET: ['$r[@0][$r[@1]]=$r[@2]', 'local $o=$r[@0] local $k=$r[@1] $o[$k]=$r[@2]'],
    ADDK: ['$r[@0]=$r[@1]+$constant(@2)', 'local $v=$constant(@2) $r[@0]=$r[@1]+$v'], GETK: ['$r[@0]=$r[@1][$constant(@2)]', 'local $k=$constant(@2) $r[@0]=$r[@1][$k]'],
    ADD: ['$r[@0]=$r[@1]+$r[@2]', 'local $a=$r[@1] local $b=$r[@2] $r[@0]=$a+$b'],
    SUB: ['$r[@0]=$r[@1]-$r[@2]', 'local $a=$r[@1] local $b=$r[@2] $r[@0]=$a-$b'],
    MUL: ['$r[@0]=$r[@1]*$r[@2]', 'local $a=$r[@1] local $b=$r[@2] $r[@0]=$a*$b'],
    DIV: ['$r[@0]=$r[@1]/$r[@2]', 'local $a=$r[@1] local $b=$r[@2] $r[@0]=$a/$b'],
    EQ: ['$r[@0]=$r[@1]==$r[@2]', 'local $a=$r[@1] local $b=$r[@2] $r[@0]=($a==$b)'],
    NE: ['$r[@0]=$r[@1]~=$r[@2]', 'local $a=$r[@1] local $b=$r[@2] $r[@0]=($a~=$b)'],
  }
  return (alternatives[opcode]?.[variant] ?? body)
}
function dispatch(variants: Variant[], style: number): string {
  const leaf = (v: Variant) => {
    const body = variantBody(v.opcode, v.id & 1).replace(/@(\d+)/g, (_, index: string) => `$ins[${(v.order.length ? v.order.indexOf(Number(index)) : Number(index)) + 3}]`)
    return `if $op==${v.id} then ${body} else $error("invalid VM instruction") end`
  }
  if (variants.length === 1) return leaf(variants[0])
  if (style === 0) {
    const middle=Math.floor(variants.length/2)
    return `if $op<${variants[middle].id} then\n${dispatch(variants.slice(0,middle),style)}\nelse\n${dispatch(variants.slice(middle),style)}\nend`
  }
  // Different builds can use a linear jump table instead of the comparison tree.
  return variants.map((v,i)=>`${i?'elseif':'if'} $op==${v.id} then ${variantBody(v.opcode,v.id&1).replace(/@(\d+)/g,(_,index:string)=>`$ins[${(v.order.length?v.order.indexOf(Number(index)):Number(index))+3}]`)}`).join(' ')+' else $error("invalid VM instruction") end'
}

export function emitVM(program: Program, options: CompilerOptions) {
  const multiplier = options.packBytecode || options.encodeStrings ? randomInt(8, 64) * 2 + 1 : 33
  const increment = options.packBytecode || options.encodeStrings ? randomInt(1, 256) : 17
  function mask(bytes: Uint8Array) {
    let state = randomInt(0, 16777213)
    const encoded = [Math.floor(state / 65536), Math.floor(state / 256) % 256, state % 256]
    for (const byte of bytes) {
      encoded.push((byte + state) % 256)
      state = (state * multiplier + increment + byte) % 16777213
    }
    return quoteBytes(Uint8Array.from(encoded))
  }

  const constants = program.constants.map((_, i) => i + 1)
  const constantOrder = options.randomizeOpcodes ? shuffle(constants) : constants
  const constantSlots = new Map(constantOrder.map((original, i) => [original, i + 1]))
  const pool = constantOrder.map(original => {
    const value = program.constants[original - 1]
    const layout = options.randomizeOpcodes ? randomInt(0, 3) : 0
    if (typeof value === 'string') {
      const bytes = Buffer.from(value, 'latin1')
      if (options.encodeStrings && layout === 1) return `{6,{${[...bytes].join(',')}}}`
      return options.encodeStrings ? `{2,${mask(bytes)}}` : `{1,${quoteBytes(bytes)}}`
    }
    if (typeof value === 'boolean') return layout === 1 ? `{7,${value}}` : `{4,${value}}`
    return options.packBytecode ? `{5,${mask(Buffer.from(String(value)))}}` : (layout === 1 ? `{8,${value}}` : `{3,${value}}`)
  })
  // Bound each initializer's constants and instructions independently of source size.
  const poolInitializers: string[] = []
  for (let start = 0; start < pool.length; start += 256) {
    poolInitializers.push(`do local function $init($pool) ${pool.slice(start, start + 256).map((entry, i) => `$pool[${start + i + 1}]=${entry}`).join('\n')} end $init($pool) end`)
  }

  const registers = new Set<number>()
  for (const [opcode, ...args] of program.code) {
    args.forEach((value, index) => { if (operandKind(opcode, index) === 'register') registers.add(value) })
  }
  const registerIds = [...registers]
  const registerOrder = options.randomizeOpcodes ? shuffle(registerIds) : registerIds
  const registerSlots = new Map(registerIds.map((value, i) => [value, registerOrder[i]]))
  const sequentialLabels = program.code.map((_, i) => i + 1)
  const labels = options.flattenControlFlow ? shuffle(sequentialLabels) : sequentialLabels
  const used = new Set(program.code.map(([opcode]) => opcode))
  const opcodeIds = new Set<number>()
  const variants = new Map<Opcode, Variant[]>()
  for (const opcode of opcodeNames.filter(opcode => used.has(opcode))) {
    variants.set(opcode, Array.from({ length: options.randomizeOpcodes ? 2 : 1 }, () => {
      let id = opcodeNames.indexOf(opcode) + 1
      if (options.randomizeOpcodes) do { id = randomInt(1, 65536) } while (opcodeIds.has(id))
      opcodeIds.add(id)
      const order = Array.from({ length: arity[opcode] ?? 0 }, (_, i) => i)
      return { id, opcode, order: options.randomizeOpcodes ? shuffle(order) : order }
    }))
  }
  const activeVariants = new Map<number, Variant>()
  const records = program.code.map(([opcode, ...operands], index) => {
    const choices = variants.get(opcode)!
    const variant = choices[options.randomizeOpcodes ? randomInt(choices.length) : 0]
    activeVariants.set(variant.id, variant)
    const mapped = operands.map((value, i) => {
      switch (operandKind(opcode, i)) {
        case 'literal': return value
        case 'register': return registerSlots.get(value)!
        case 'constant': return constantSlots.get(value)!
        case 'target': {
          const label = labels[value - 1]
          if (label === undefined) throw new Error('Invalid compiler jump target')
          return label
        }
      }
    })
    const values = [variant.id, labels[index + 1] ?? 0, ...(variant.order.length ? variant.order.map(i => mapped[i]) : mapped)]
    return [labels[index], values.length, ...values]
  })
  const orderedRecords = options.flattenControlFlow ? shuffle(records) : records
  const chunks: string[] = []
  const chunkChecksums: number[] = []
  for (let start = 0; start < orderedRecords.length; start += 256) {
    const bytes = varints(orderedRecords.slice(start, start + 256).flat())
    chunkChecksums.push([...bytes].reduce((a,b)=>(a+b)%2147483647,0))
    chunks.push(options.packBytecode ? mask(bytes) : quoteBytes(bytes))
  }
  const handlers = [...activeVariants.values()].sort((a, b) => a.id - b.id)
  const dispatchStyle = options.randomizeOpcodes ? randomInt(0, 2) : 0
  const usesBitwise = program.code.some(([opcode]) => ['BAND','BOR','BXOR','SHL','SHR','BITNOT'].includes(opcode))
  const usesDecoder = options.packBytecode || options.encodeStrings
  const bitwiseRuntime = `local function $signed($x) $x=$x%4294967296 if $x>=2147483648 then return $x-4294967296 end return $x end
local function $band($a,$b) if $bit32 and $bit32.band then return $bit32.band($a,$b) end local $x=0 local $p=1 $a=$a%4294967296 $b=$b%4294967296 for $j=1,32 do if $a%2>=1 and $b%2>=1 then $x=$x+$p end $a=math.floor($a/2) $b=math.floor($b/2) $p=$p*2 end return $signed($x) end
local function $bor($a,$b) if $bit32 and $bit32.bor then return $bit32.bor($a,$b) end local $x=0 local $p=1 $a=$a%4294967296 $b=$b%4294967296 for $j=1,32 do if $a%2>=1 or $b%2>=1 then $x=$x+$p end $a=math.floor($a/2) $b=math.floor($b/2) $p=$p*2 end return $signed($x) end
local function $bxor($a,$b) if $bit32 and $bit32.bxor then return $bit32.bxor($a,$b) end local $x=0 local $p=1 $a=$a%4294967296 $b=$b%4294967296 for $j=1,32 do local $aa=$a%2 local $bb=$b%2 if ($aa+$bb)==1 then $x=$x+$p end $a=math.floor($a/2) $b=math.floor($b/2) $p=$p*2 end return $signed($x) end
local function $bnot($a) if $bit32 and $bit32.bnot then return $bit32.bnot($a) end return $signed(4294967295-($a%4294967296)) end
local function $shl($a,$b) if $bit32 and $bit32.lshift then return $bit32.lshift($a,$b) end $b=$b%32 return $signed(($a%4294967296)*2^$b%4294967296) end
local function $shr($a,$b) if $bit32 and $bit32.rshift then return $bit32.rshift($a,$b) end $b=$b%32 return math.floor(($a%4294967296)/2^$b) end
`
  const runtime = `return (function($env,$unpack,$number,$error,$byte,$char,$concat,$select,$pairs,$mathmax,$bit32,$type,...)
local function $pack(...) return {n=$select("#",...),...} end
${usesBitwise ? bitwiseRuntime : ''}${usesDecoder ? `local function $decode($text)
local $state=$byte($text,1)*65536+$byte($text,2)*256+$byte($text,3) local $decoded={}
for $j=4,#$text do
local $value=($byte($text,$j)-$state)%256
$decoded[$j-3]=$value
$state=($state*${multiplier}+${increment}+$value)%16777213
end
return $decoded
end` : ''}
local $pool={}
${poolInitializers.join('\n')}
local $cache={}
local function $constant($index)
local $value=$cache[$index]
if $value~=nil then return $value end
local $entry=$pool[$index]
$value=$entry[2]
${usesDecoder ? `if $entry[1]==6 then local $bytes=$entry[2] for $j=1,#$bytes do $bytes[$j]=$char($bytes[$j]) end $value=$concat($bytes) elseif $entry[1]==2 or $entry[1]==5 then
local $bytes=$decode($value)
for $j=1,#$bytes do $bytes[$j]=$char($bytes[$j]) end
$value=$concat($bytes)
if $entry[1]==5 then $value=$number($value) elseif $entry[1]==7 then $value=($entry[2]~=false) elseif $entry[1]==8 then $value=$entry[2] end
end` : ''}
$cache[$index]=$value $pool[$index]=nil
return $value
end
local $code={}
local $chunks={${chunks.join(',')}}
local $chunkIndex={${orderedRecords.flatMap((r,i)=>[`[${r[0]}]=${Math.floor(i/256)+1}`]).join(',')}}
local $checks={${chunkChecksums.join(',')}}
local $loaded={} local $tick=0
local $chunkLabels={${Array.from({length:chunks.length},(_,i)=>`{${orderedRecords.slice(i*256,(i+1)*256).map(r=>r[0]).join(',')}}`).join(',')}}
local function $hash($text) local $h=0 for $j=1,#$text do local $v=${options.packBytecode ? '$text[$j]' : '$byte($text,$j)'} $h=($h+$v)%2147483647 end return $h end
local function $loadchunk($id)
if $loaded[$id] then return end
local $text=$chunks[$id]
local $raw=${options.packBytecode ? '$decode($text)' : '$text'}
if $hash($raw)~=$checks[$id] then $error('Obsidian VM integrity check failed',0) end
${options.packBytecode ? 'local $bytes=$raw' : ''}
local $cursor=1
local function $read()
local $value=0 local $factor=1
repeat
local $digit=${options.packBytecode ? '$bytes[$cursor]' : '$byte($text,$cursor)'} $cursor=$cursor+1
$value=$value+($digit%128)*$factor
if $digit<128 then return $value end
$factor=$factor*128
until false
end
while $cursor<=${options.packBytecode ? '#$bytes' : '#$text'} do
local $label=$read() local $count=$read() local $record={}
for $j=1,$count do $record[$j]=$read() end
$code[$label]=$record
end
$tick=$tick+1 $loaded[$id]=$tick
local $count=0 for $k in $pairs($loaded) do $count=$count+1 end
if $count>8 then local $oldId local $oldTick=math.huge for $k,$v in $pairs($loaded) do if $v<$oldTick then $oldTick=$v $oldId=$k end end if $oldId and $oldId~=$id then for _,${'$'}label in $pairs($chunkLabels[$oldId]) do $code[${'$'}label]=nil end $loaded[$oldId]=nil end end
end
local function $run($pc,$r,$argv)
while $pc~=0 do
local $id=$chunkIndex[$pc]
if not $id then $error('invalid VM program counter',0) end
$loadchunk($id)
local $ins=$code[$pc]
if not $ins then $error('invalid VM instruction address',0) end
$pc=$ins[2] local $op=$ins[1]
${dispatch(handlers, dispatchStyle)}
end
end
return $run(${labels[0]},{},$pack(...))
end)((getfenv and getfenv()) or _ENV,table.unpack or unpack,tonumber,error,string.byte,string.char,table.concat,select,pairs,math.max,bit32,type,...)`
  const names = new Map<string, string>()
  const named = runtime.replace(/\$([a-zA-Z]\w*)/g, (_, name: string) => {
    if (!names.has(name)) names.set(name, options.renameIdentifiers ? `_${randomBytes(6).toString('hex')}` : `_${name}`)
    return names.get(name)!
  })
  return {
    output: '-- Obsidian VM / v0.5.0 / experimental\n' + (options.compactOutput ? named.split('\n').map(line => line.trim()).filter(Boolean).join(' ') : named) + '\n',
    handlers: handlers.length,
  }
}


export function emitArbitrarySource(source: string, options: CompilerOptions) {
  const shouldEncode = options.encodeStrings
  const multiplier = shouldEncode ? randomInt(8, 64) * 2 + 1 : 33
  const increment = shouldEncode ? randomInt(1, 256) : 17
  function mask(bytes: Uint8Array) {
    let state = randomInt(1, 16777213)
    const encoded = [Math.floor(state / 65536), Math.floor(state / 256) % 256, state % 256]
    for (const byte of bytes) {
      encoded.push((byte + state) % 256)
      state = (state * multiplier + increment + byte) % 16777213
    }
    return quoteBytes(Uint8Array.from(encoded))
  }

  const encoded = shouldEncode ? mask(Buffer.from(source, 'utf8')) : quoteBytes(Buffer.from(source, 'utf8'))
  const runtime = `return (function($env,$loadstring,$load,$setfenv,$byte,$char,$concat,$error,...)
local $encoded=${encoded}
local $text
${shouldEncode ? `local $state=$byte($encoded,1)*65536+$byte($encoded,2)*256+$byte($encoded,3)
local $bytes={}
for $j=4,#$encoded do
local $value=($byte($encoded,$j)-$state)%256
$bytes[$j-3]=$char($value)
$state=($state*${multiplier}+${increment}+$value)%16777213
end
$text=$concat($bytes)` : '$text=$encoded'}
local $chunk,$err
if $loadstring then
$chunk,$err=$loadstring($text,'@obsidian')
if $chunk and $setfenv then $setfenv($chunk,$env) end
elseif $load and not $setfenv then
$chunk,$err=$load($text,'@obsidian','t',$env)
else
$error('Obsidian compatibility output requires an enabled loadstring or load function; use VM-supported syntax on Roblox clients.',0)
end
if not $chunk then $error($err,0) end
return $chunk(...)
end)((getfenv and getfenv()) or _ENV,loadstring,load,setfenv,string.byte,string.char,table.concat,error,...)`
  const names = new Map<string, string>()
  const named = runtime.replace(/\$([a-zA-Z]\w*)/g, (_, name: string) => {
    if (!names.has(name)) names.set(name, options.renameIdentifiers ? `_${randomBytes(6).toString('hex')}` : `_${name}`)
    return names.get(name)!
  })
  return {
    output: '-- Obsidian arbitrary-source compatibility / v0.5.0\n' + (options.compactOutput ? named.split('\n').map(line => line.trim()).filter(Boolean).join(' ') : named) + '\n',
    handlers: 0,
  }
}
