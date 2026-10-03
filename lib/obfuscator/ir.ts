export const binary = {
  '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '//': 'IDIV', '%': 'MOD', '^': 'POW',
  '..': 'CONCAT', '==': 'EQ', '~=': 'NE', '&': 'BAND', '|': 'BOR', '~': 'BXOR', '<<': 'SHL', '>>': 'SHR', '<': 'LT', '<=': 'LE', '>': 'GT', '>=': 'GE',
} as const
export const unary = { '-': 'NEG', not: 'NOT', '#': 'LEN', '~': 'BITNOT' } as const
export const opcodeNames = ['K', 'NIL', 'MOVE', 'GLOBAL', 'SETGLOBAL', 'GET', 'SET', 'TABLE', 'CALL', 'PACK', 'APPEND', 'CALLP', 'RETURNP', 'SETLIST', 'RETURN', 'JUMP', 'JF', 'JT', 'FORINIT', 'FORCHECK', 'ADDK', 'GETK', 'CELL', 'GETCELL', 'SETCELL', 'CLOSURE', 'PARAM', 'VARARG', 'GENERIC', ...Object.values(binary), ...Object.values(unary)] as const
export type Opcode = typeof opcodeNames[number]
export type Instruction = [Opcode, ...number[]]
export type Constant = string | number | boolean
export type Program = { code: Instruction[]; constants: Constant[] }

type Operand = 'register' | 'constant' | 'target' | 'literal'
const fixedOperands: Partial<Record<Opcode, Operand[]>> = {
  CLOSURE: ['register', 'target'], ADDK: ['register','register','constant'], GETK: ['register','register','constant'], PARAM: ['register', 'literal'], VARARG: ['register', 'literal'], GENERIC: ['register','register','register'],
  K: ['register', 'constant'], GLOBAL: ['register', 'constant'],
  SETGLOBAL: ['constant', 'register'], JUMP: ['target'],
  JF: ['register', 'target'], JT: ['register', 'target'],
}

export function operandKind(opcode: Opcode, index: number): Operand {
  return fixedOperands[opcode]?.[index] ?? 'register'
}

export const arity: Partial<Record<Opcode, number>> = {
  K: 2, NIL: 1, MOVE: 2, GLOBAL: 2, SETGLOBAL: 2, GET: 3, SET: 3, TABLE: 1,
  CELL: 2, GETCELL: 2, SETCELL: 2, PARAM: 2, VARARG: 2, GENERIC: 3,
  APPEND: 2, CALLP: 3, RETURNP: 1, SETLIST: 3,
  JUMP: 1, JF: 2, JT: 2, FORINIT: 3, FORCHECK: 4,
  ADD: 3, ADDK: 3, GETK: 3, SUB: 3, MUL: 3, DIV: 3, IDIV: 3, MOD: 3, POW: 3, CONCAT: 3,
  EQ: 3, NE: 3, LT: 3, LE: 3, GT: 3, GE: 3, BAND: 3, BOR: 3, BXOR: 3, SHL: 3, SHR: 3, NEG: 2, NOT: 2, LEN: 2, BITNOT: 2,
}


function reuseTemporaryRegisters(program: Program): Program {
  const persistent=new Set<number>()
  for(let i=0;i<program.code.length;i++){
    const [op,...args]=program.code[i]
    if(op==='CELL'||op==='PARAM'||op==='GETCELL'||op==='SETCELL') persistent.add(args[0])
    if(op==='CLOSURE') for(const r of args.slice(2)) persistent.add(r)
    // Numeric-for bounds/control survive the entire loop.
    if(op==='FORINIT') for(const r of args.slice(0,3)) persistent.add(r)
    if(op==='GENERIC') for(const r of args.slice(0,3)) persistent.add(r)
    // Generic-for iterator/state/control values are consumed again on each
    // iteration; the PACK immediately feeding CALLP is the VM loop-carried form.
    if(op==='PACK' && program.code[i+1]?.[0]==='CALLP') for(const r of args.slice(1)) persistent.add(r)
    if(op==='CALLP') persistent.add(args[1])
  }
  const ranges=new Map<number,[number,number]>()
  for(let i=0;i<program.code.length;i++){
    const [op,...args]=program.code[i]
    args.forEach((value,index)=>{ if(operandKind(op,index)==='register' && !persistent.has(value)){ const range=ranges.get(value); if(range) range[1]=i; else ranges.set(value,[i,i]) } })
  }
  const ordered=[...ranges.entries()].sort((a,b)=>a[1][0]-b[1][0])
  const active:{reg:number,end:number,slot:number}[]=[]
  const free:number[]=[]
  let next=0
  const mapping=new Map<number,number>()
  const base=(persistent.size?Math.max(...persistent):0)+1
  for(const [reg,[start,end]] of ordered){
    for(let i=active.length-1;i>=0;i--) if(active[i].end<start){free.push(active[i].slot);active.splice(i,1)}
    const slot=free.pop() ?? base+next++
    mapping.set(reg,slot);active.push({reg,end,slot})
  }
  const code=program.code.map(([op,...args])=>[op,...args.map((value,index)=>operandKind(op,index)==='register'?(mapping.get(value)??value):value)] as Instruction)
  return {code,constants:program.constants}
}

export function optimizeProgram(program: Program): Program {
  const code = program.code.map(instruction => [...instruction] as Instruction)
  const constants = [...program.constants]
  const constantKey = (v: Constant) => `${typeof v}:${String(v)}`
  const lookup = new Map(constants.map((v, i) => [constantKey(v), i + 1]))
  const known = new Map<number, Constant>()
  const invalidate = (r: number) => known.delete(r)
  const get = (r: number) => known.get(r)
  const add = (v: Constant) => { const key=constantKey(v); const old=lookup.get(key); if(old) return old; constants.push(v); const n=constants.length; lookup.set(key,n); return n }
  const numeric = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const targets = new Set<number>()
  for (const instruction of code) {
    if (['JUMP', 'JF', 'JT'].includes(instruction[0])) targets.add(instruction[instruction.length - 1] as number)
    if (instruction[0] === 'CLOSURE') targets.add(instruction[2])
  }
  for (let i=0;i<code.length;i++) {
    if (targets.has(i + 1)) known.clear()
    const ins=code[i]; const op=ins[0]
    if (['JUMP', 'JF', 'JT', 'RETURN', 'RETURNP', 'CALL', 'CALLP', 'CLOSURE'].includes(op)) known.clear()
    if(op==='K') { const v=constants[ins[2]-1]; if(v!==undefined) known.set(ins[1] as number,v); continue }
    if(op==='MOVE') { const v=get(ins[2]); if(v!==undefined) known.set(ins[1] as number,v); else invalidate(ins[1]); continue }
    if(op==='NIL') { invalidate(ins[1]); continue }
    if(op==='FORINIT') { invalidate(ins[1]); invalidate(ins[2]); invalidate(ins[3]); continue }
    if(op==='FORCHECK') { invalidate(ins[1]); continue }
    if(op==='GENERIC') { invalidate(ins[1]); invalidate(ins[2]); invalidate(ins[3]); continue }
    if (['ADD','SUB','MUL','DIV','IDIV','MOD','POW'].includes(op)) {
      const a=get(ins[2]), b=get(ins[3]);
      if(numeric(a)&&numeric(b)) {
        let v:number|undefined
        if(op==='ADD')v=a+b; else if(op==='SUB')v=a-b; else if(op==='MUL')v=a*b; else if(op==='DIV'&&b!==0)v=a/b; else if(op==='IDIV'&&b!==0)v=Math.floor(a/b); else if(op==='MOD'&&b!==0)v=a-Math.floor(a/b)*b; else if(op==='POW')v=a**b
        if(v!==undefined&&Number.isFinite(v)){ ins[0]='K'; ins.length=2; ins.push(add(v)); known.set(ins[1] as number,v); continue }
      }
    }
    if(op==='CONCAT') { const a=get(ins[2]),b=get(ins[3]); if(typeof a==='string'&&typeof b==='string'){ const v=a+b; ins[0]='K'; ins.length=2; ins.push(add(v)); known.set(ins[1] as number,v); continue } }
    if(['EQ','NE','LT','LE','GT','GE'].includes(op)) { const a=get(ins[2]),b=get(ins[3]); if(a!==undefined&&b!==undefined&&((typeof a===typeof b)&&(typeof a==='number'||(typeof a==='boolean'&&(op==='EQ'||op==='NE'))))){ let v=false; if(op==='EQ')v=a===b; else if(op==='NE')v=a!==b; else if(op==='LT')v=(a as any)<(b as any); else if(op==='LE')v=(a as any)<=(b as any); else if(op==='GT')v=(a as any)>(b as any); else if(op==='GE')v=(a as any)>=(b as any); ins[0]='K'; ins.length=2; ins.push(add(v)); known.set(ins[1] as number,v); continue } }
    const dsts:number[]=[]
    if(op==='GLOBAL'||op==='GET'||op==='TABLE'||op==='CALL'||op==='PACK'||op==='CALLP'||op==='PARAM'||op==='VARARG'||op==='CLOSURE'||op==='CELL'||op==='GETCELL'||op==='SETCELL'||op==='SET'||op==='SETGLOBAL'||op==='SETLIST'||op==='APPEND'||op==='NEG'||op==='NOT'||op==='LEN'||op==='BITNOT'||Object.values(binary).includes(op as any)) dsts.push(ins[1] as number)
    for(const r of dsts) invalidate(r)
  }
  // Any physical instruction deletion must immediately update 1-based control-flow
  // targets; otherwise a later loop/back-edge can point at the pre-compaction index.
  const removeAt = (index: number) => {
    const removed = index + 1
    code.forEach(ins => {
      if (ins[0] === 'JUMP' || ins[0] === 'JF' || ins[0] === 'JT') {
        const target = ins[ins.length - 1] as number
        if (target > removed) ins[ins.length - 1] = target - 1
        else if (target === removed && removed > code.length - 1) ins[ins.length - 1] = Math.max(1, removed - 1)
      } else if (ins[0] === 'CLOSURE') {
        const target = ins[2] as number
        if (target > removed) ins[2] = target - 1
        else if (target === removed && removed > code.length - 1) ins[2] = Math.max(1, removed - 1)
      }
    })
    code.splice(index, 1)
  }
  // Remove dead, side-effect-free value producers after folding.
  const useCount=new Map<number,number>()
  const valueDest=new Set<Opcode>(['K','NIL','MOVE','GLOBAL','GET','TABLE','PACK','PARAM','VARARG','GENERIC','GETCELL','FORCHECK','ADD','SUB','MUL','DIV','IDIV','MOD','POW','CONCAT','EQ','NE','LT','LE','GT','GE','BAND','BOR','BXOR','SHL','SHR','NEG','NOT','LEN','BITNOT','ADDK','GETK'])
  for(const [op,...args] of code) args.forEach((v,i)=>{ if(operandKind(op,i)==='register' && !(i===0&&valueDest.has(op))) useCount.set(v,(useCount.get(v)??0)+1) })
  const pure=new Set<Opcode>(['K','NIL','MOVE'])
  for(let i=code.length-1;i>=0;i--){ const ins=code[i]; if(pure.has(ins[0]) && typeof ins[1]==='number' && (useCount.get(ins[1])??0)===0) removeAt(i) }
  // Fuse a constant load immediately consumed by an addition. This preserves
  // primitive numeric semantics and removes both an instruction and a temporary.
  const uses=new Map<number,number>()
  for(const [op,...args] of code) args.forEach((v,i)=>{if(operandKind(op,i)==='register' && !(i===0&&valueDest.has(op))) uses.set(v,(uses.get(v)??0)+1)})
  for(let i=0;i+1<code.length;i++){
    const k=code[i], addIns=code[i+1]
    if(k[0]!=='K'||addIns[0]!=='ADD') continue
    const value=constants[k[2]-1]
    if(typeof value!=='number'||!Number.isFinite(value)||uses.get(k[1])!==1) continue
    // ADDK keeps the constant on the right: swapping operands changes metamethod semantics.
    if (code.some(ins => (['JUMP', 'JF', 'JT'].includes(ins[0]) && ins[ins.length - 1] === i + 2) || (ins[0] === 'CLOSURE' && ins[2] === i + 2))) continue
    if(addIns[3]===k[1]) { addIns[0]='ADDK'; addIns.splice(3,1,k[2]); removeAt(i); i-- }
  }
  for(let i=0;i+1<code.length;i++){
    const k=code[i], getIns=code[i+1]
    if(k[0]!=='K'||getIns[0]!=='GET'||getIns[3]!==k[1]||uses.get(k[1])!==1) continue
    if (code.some(ins => (['JUMP', 'JF', 'JT'].includes(ins[0]) && ins[ins.length - 1] === i + 2) || (ins[0] === 'CLOSURE' && ins[2] === i + 2))) continue
    getIns[0]='GETK'; getIns.splice(3,1,k[2]); removeAt(i); i--
  }
  // Reachability roots are the main entry plus every closure entry.
  const reachable=new Set<number>(); const queue=[1]
  for(const ins of code) if(ins[0]==='CLOSURE') queue.push(ins[2])
  while(queue.length){
    const p=queue.pop()!
    if(reachable.has(p)||p<1||p>code.length)continue
    reachable.add(p)
    const ins=code[p-1]
    if(['JUMP','JF','JT'].includes(ins[0])) queue.push(ins[ins.length-1] as number)
    if(ins[0]!=='JUMP'&&ins[0]!=='RETURN'&&ins[0]!=='RETURNP') queue.push(p+1)
  }
  const kept=code.filter((_,i)=>reachable.has(i+1))
  const remap=new Map<number,number>(); let n=0
  for(let i=0;i<code.length;i++) if(reachable.has(i+1)) remap.set(i+1,++n)
  for(const ins of kept){
    if(ins[0]==='JUMP'||ins[0]==='JF'||ins[0]==='JT') {
      const target=remap.get(ins[ins.length-1] as number)
      if(target===undefined) throw new Error('Optimizer lost a reachable control-flow target')
      ins[ins.length-1]=target
    }
    if(ins[0]==='CLOSURE') {
      const target=remap.get(ins[2] as number)
      if(target===undefined) throw new Error('Optimizer lost a closure entry')
      ins[2]=target
    }
  }
  return reuseTemporaryRegisters({code: kept, constants})
}
