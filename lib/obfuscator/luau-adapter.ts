import type { Node, Expression, Statement } from 'luaparse'
import type { CompoundOperator } from './compound'
import type { LuauAst } from './luau-ast'

const binaryOps: Record<string, string> = {
  Add: '+', Sub: '-', Mul: '*', Div: '/', FloorDiv: '//', Mod: '%', Pow: '^', Concat: '..',
  CompareEq: '==', CompareNe: '~=', CompareLt: '<', CompareLe: '<=', CompareGt: '>', CompareGe: '>=',
  And: 'and', Or: 'or',
  BitAnd: '&', BitOr: '|', BitXor: '~', ShiftLeft: '<<', ShiftRight: '>>',
}
const unaryOps: Record<string, string> = { Minus: '-', Not: 'not', Len: '#', Length: '#', BitNot: '~' }
const compoundOps: Record<string, CompoundOperator> = {
  Add: '+', Sub: '-', Mul: '*', Div: '/', FloorDiv: '//', Mod: '%', Pow: '^', Concat: '..',
  BitAnd: '&' as CompoundOperator, BitOr: '|' as CompoundOperator, BitXor: '~' as CompoundOperator,
  ShiftLeft: '<<' as CompoundOperator, ShiftRight: '>>' as CompoundOperator,
}

function loc(n: any) {
  const raw = String(n?.location ?? '0,0 - 0,0').split(/\s+-\s+/)
  const parse = (s: string) => { const [line, column] = s.split(',').map(Number); return { line: line + 1, column: column + 1 } }
  return { start: parse(raw[0]), end: parse(raw[1] ?? raw[0]) }
}
function base<T extends object>(n: any, type: string): T {
  return { type, loc: loc(n), range: undefined } as T
}
function id(name: string, n: any = {}) { return { ...base(n, 'Identifier'), name } as any }
let activeCompounds: Map<Node, CompoundOperator> | undefined

function expr(n: any, grouped: Set<Node>): Expression {
  switch (n.type) {
    case 'AstExprConstantInteger': return { ...base(n, 'NumericLiteral'), value: n.value, raw: String(n.value) } as any
    case 'AstExprConstantNumber': return { ...base(n, 'NumericLiteral'), value: n.value, raw: String(n.value) } as any
    case 'AstExprConstantString': return { ...base(n, 'StringLiteral'), value: n.value, raw: JSON.stringify(n.value) } as any
    case 'AstExprConstantBool': return { ...base(n, 'BooleanLiteral'), value: !!n.value, raw: String(!!n.value) } as any
    case 'AstExprConstantNil': return base(n, 'NilLiteral') as any
    case 'AstExprGlobal': return { ...base(n, 'Identifier'), name: n.global } as any
    case 'AstExprLocal': return { ...base(n, 'Identifier'), name: n.local?.name ?? n.name } as any
    case 'AstExprVarargs': return base(n, 'VarargLiteral') as any
    case 'AstExprGroup': {
      const e = expr(n.expr, grouped)
      grouped.add(e as Node)
      return e
    }
    case 'AstExprIndexName': {
      const b = expr(n.expr, grouped)
      return { ...base(n, 'MemberExpression'), indexer: n.op === ':' ? ':' : '.', base: b, identifier: id(n.index, n) } as any
    }
    case 'AstExprIndexExpr': return { ...base(n, 'IndexExpression'), base: expr(n.expr, grouped), index: expr(n.index, grouped) } as any
    case 'AstExprBinary': {
      const operator = binaryOps[n.op]
      if (!operator) throw new Error(`Unsupported Luau binary operator ${n.op}`)
      return { ...base(n, operator === 'and' || operator === 'or' ? 'LogicalExpression' : 'BinaryExpression'), operator, left: expr(n.left, grouped), right: expr(n.right, grouped) } as any
    }
    case 'AstExprTypeAssertion': return expr(n.expr, grouped)
    case 'AstExprUnary': {
      const operator = unaryOps[n.op]
      if (!operator) throw new Error(`Unsupported Luau unary operator ${n.op}`)
      return { ...base(n, 'UnaryExpression'), operator, argument: expr(n.expr, grouped) } as any
    }
    case 'AstExprCall': {
      const f = expr(n.func, grouped)
      const args = (n.args ?? []).map((a: any) => expr(a, grouped))
      if (n.self && f.type === 'MemberExpression') (f as any).indexer = ':'
      return { ...base(n, 'CallExpression'), base: f, arguments: args } as any
    }
    case 'AstExprFunction': {
      return { ...base(n, 'FunctionDeclaration'), identifier: null, isLocal: false, parameters: (n.args ?? []).map((a: any) => id(a.name, a)), isVararg: !!n.vararg, body: statements(n.body.body, grouped, activeCompounds!) } as any
    }
    case 'AstExprIfElse': {
      // Keep the backend's existing expression lowering contract by constructing a tiny IIFE.
      const f = { ...base(n, 'FunctionDeclaration'), identifier: null, isLocal: false, parameters: [], isVararg: false, body: [
        { ...base(n, 'IfStatement'), clauses: [
          { type: 'IfClause', condition: expr(n.condition, grouped), body: [{ ...base(n, 'ReturnStatement'), arguments: [expr(n.trueExpr, grouped)] }] },
          { type: 'ElseClause', body: [{ ...base(n, 'ReturnStatement'), arguments: [expr(n.falseExpr, grouped)] }] },
        ] },
      ] } as any
      return { ...base(n, 'CallExpression'), base: f, arguments: [] } as any
    }
    case 'AstExprInterpString': {
      const parts: Expression[] = []
      for (let i = 0; i < n.strings.length; i++) {
        if (n.strings[i] !== '') parts.push({ ...base(n, 'StringLiteral'), value: n.strings[i], raw: JSON.stringify(n.strings[i]) } as any)
        if (i < n.expressions.length) parts.push(expr(n.expressions[i], grouped))
      }
      if (!parts.length) return { ...base(n, 'StringLiteral'), value: '', raw: '""' } as any
      return parts.reduce((left, right): Expression => ({ ...base<{ type: 'BinaryExpression' }>(n, 'BinaryExpression'), operator: '..', left, right }))
    }
    case 'AstExprTable': {
      const fields = (n.items ?? []).map((item: any, index: number) => {
        if (item.kind === 'record') return { type: 'TableKeyString', key: id(item.key.value, item.key), value: expr(item.value, grouped) }
        if (item.kind === 'general') return { type: 'TableKey', key: expr(item.key, grouped), value: expr(item.value, grouped) }
        return { type: 'TableValue', value: expr(item.value, grouped) }
      })
      return { ...base(n, 'TableConstructorExpression'), fields } as any
    }
    default: throw new Error(`Unsupported Luau expression ${n.type}`)
  }
}

function statements(list: any[], grouped: Set<Node>, compounds: Map<Node, CompoundOperator> = new Map()): Statement[] {
  const out: Statement[] = []
  for (const n of list ?? []) {
    const s = statement(n, grouped, compounds)
    if (s) out.push(s)
  }
  return out
}

function statement(n: any, grouped: Set<Node>, compounds: Map<Node, CompoundOperator>): Statement | undefined {
  switch (n.type) {
    case 'AstStatTypeAlias':
    case 'AstStatTypeFunction':
    case 'AstStatDeclareGlobal':
    case 'AstStatDeclareFunction':
    case 'AstStatDeclareExternType': return undefined
    case 'AstStatLocal': return { ...base(n, 'LocalStatement'), variables: n.vars.map((v: any) => id(v.name, v)), init: (n.values ?? []).map((v: any) => expr(v, grouped)) } as any
    case 'AstStatLocalFunction': return { ...base(n, 'FunctionDeclaration'), identifier: id(n.name.name, n.name), isLocal: true, parameters: (n.func.args ?? []).map((a: any) => id(a.name, a)), isVararg: !!n.func.vararg, body: statements(n.func.body.body, grouped, compounds) } as any
    case 'AstStatFunction': return { ...base(n, 'FunctionDeclaration'), identifier: expr(n.name, grouped), isLocal: false, parameters: (n.func.args ?? []).map((a: any) => id(a.name, a)), isVararg: !!n.func.vararg, body: statements(n.func.body.body, grouped, compounds) } as any
    case 'AstStatAssign': return { ...base(n, 'AssignmentStatement'), variables: n.vars.map((v: any) => expr(v, grouped)), init: (n.values ?? []).map((v: any) => expr(v, grouped)) } as any
    case 'AstStatCompoundAssign': {
      const mapped = { ...base(n, 'AssignmentStatement'), variables: [expr(n.var, grouped)], init: [expr(n.value, grouped)] } as any
      const op = compoundOps[n.op]
      if (!op) throw new Error(`Unsupported Luau compound operator ${n.op}`)
      compounds.set(mapped, op)
      return mapped
    }
    case 'AstStatExpr': return { ...base(n, 'CallStatement'), expression: expr(n.expr, grouped) } as any
    case 'AstStatReturn': return { ...base(n, 'ReturnStatement'), arguments: (n.list ?? []).map((v: any) => expr(v, grouped)) } as any
    case 'AstStatBreak': return base(n, 'BreakStatement') as any
    case 'AstStatContinue': return { ...base(n, 'CallStatement'), expression: { ...base(n, 'CallExpression'), base: id('__obsidian_continue', n), arguments: [] } } as any
    case 'AstStatBlock': return { ...base(n, 'DoStatement'), body: statements(n.body, grouped, compounds) } as any
    case 'AstStatIf': {
      const clauses: any[] = [{ type: 'IfClause', condition: expr(n.condition, grouped), body: statements(n.thenbody.body, grouped, compounds) }]
      let e = n.elsebody
      while (e?.type === 'AstStatIf') { clauses.push({ type: 'IfClause', condition: expr(e.condition, grouped), body: statements(e.thenbody.body, grouped, compounds) }); e = e.elsebody }
      if (e) clauses.push({ type: 'ElseClause', body: statements(e.body, grouped, compounds) })
      return { ...base(n, 'IfStatement'), clauses } as any
    }
    case 'AstStatWhile': return { ...base(n, 'WhileStatement'), condition: expr(n.condition, grouped), body: statements(n.body.body, grouped, compounds) } as any
    case 'AstStatRepeat': return { ...base(n, 'RepeatStatement'), condition: expr(n.condition, grouped), body: statements(n.body.body, grouped, compounds) } as any
    case 'AstStatFor': return { ...base(n, 'ForNumericStatement'), variable: id(n.var.name, n.var), start: expr(n.from, grouped), end: expr(n.to, grouped), step: n.step ? expr(n.step, grouped) : undefined, body: statements(n.body.body, grouped, compounds) } as any
    case 'AstStatForIn': {
      let iterators = (n.values ?? []).map((v: any) => expr(v, grouped))
      // Luau permits generalized iteration over a table expression (`for k,v in t do`).
      // The VM's generic loop consumes the Lua iterator triple, so lower the direct-table
      // form to pairs(t), matching Luau's table iteration semantics.
      return { ...base(n, 'ForGenericStatement'), variables: n.vars.map((v: any) => id(v.name, v)), iterators, generalized: n.values?.length === 1, body: statements(n.body.body, grouped, compounds) } as any
    }
    default: throw new Error(`Unsupported Luau statement ${n.type}`)
  }
}

export function adaptLuauAst(root: LuauAst) {
  const grouped = new Set<Node>()
  const compounds = new Map<Node, CompoundOperator>()
  activeCompounds = compounds
  const body = statements(root.body, grouped, compounds)
  activeCompounds = undefined
  return { ast: { type: 'Chunk', body } as any, grouped, compounds }
}
