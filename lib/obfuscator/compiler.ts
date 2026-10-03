import { randomUUID } from 'node:crypto'
import type { Expression, Node, Statement } from './ast-types'
import { DEFAULT_OPTIONS, MAX_SOURCE_BYTES, type CompilerOptions, type CompileResult } from './types'
import { binary, unary, type Opcode, type Instruction, type Constant } from './ir'
import { emitArbitrarySource, emitVM } from './emitter'
import { parseLuau } from './luau-ast'
import { adaptLuauAst } from './luau-adapter'
import type { CompoundOperator } from './compound'
import { optimizeProgram } from './ir'
export type { Opcode } from './ir'

export class CompileError extends Error {}

function fail(node: Node, message: string): never {
  throw new CompileError(`Line ${node.loc?.start.line ?? '?'}: ${message}`)
}

function isCall(node: Expression) {
  return node.type === 'CallExpression' || node.type === 'StringCallExpression' || node.type === 'TableCallExpression'
}

class Compiler {
  code: Instruction[] = []
  constants: Constant[] = []
  private constantLookup = new Map<string, number>()
  private scopes: Map<string, number>[] = [new Map()]
  private nextRegister = 0
  private frameScopeStart = 0

  private frameLocal(node: Expression) {
    if (node.type !== 'Identifier') return undefined
    for (let i = this.scopes.length - 1; i >= this.frameScopeStart; i--) {
      const cell = this.scopes[i].get(node.name)
      if (cell !== undefined) return cell
    }
  }
  private breaks: number[][] = []
  private continues: number[][] = []

  private register() { return ++this.nextRegister }
  private emit(opcode: Opcode, ...args: number[]) {
    this.code.push([opcode, ...args])
    return this.code.length - 1
  }
  private position() { return this.code.length + 1 }
  private patch(index: number, target = this.position()) {
    const instruction = this.code[index]
    instruction[instruction.length - 1] = target
  }
  private local(name: string) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const value = this.scopes[i].get(name)
      if (value !== undefined) return value
    }
  }
  private constant(value: Constant) {
    const key = `${typeof value}:${value}`
    const existing = this.constantLookup.get(key)
    if (existing) return existing
    this.constants.push(value)
    this.constantLookup.set(key, this.constants.length)
    return this.constants.length
  }
  private load(value: Constant) {
    const dst = this.register()
    this.emit('K', dst, this.constant(value))
    return dst
  }
  constructor(private grouped: Set<Node>, private compounds: Map<Node, CompoundOperator>) {}

  private parameterCount = 0

  private functionExpression(node: Extract<Expression, { type: 'FunctionDeclaration' }>, dst: number) {
    const captures = [...new Set(this.scopes.flatMap(scope => [...scope.values()]))]
    const skip = this.emit('JUMP', 0)
    const entry = this.position()
    const outerBreaks = this.breaks
    const outerContinues = this.continues
    const outerParameterCount = this.parameterCount
    this.breaks = []
    this.continues = []
    const outerFrameScopeStart = this.frameScopeStart
    this.frameScopeStart = this.scopes.length
    this.scopes.push(new Map())
    this.parameterCount = 0
    const parameters = node.identifier?.type === 'MemberExpression' && node.identifier.indexer === ':'
      ? [{ type: 'Identifier' as const, name: 'self' }, ...node.parameters]
      : node.parameters
    for (const parameter of parameters) {
      if (parameter.type === 'VarargLiteral') continue
      const cell = this.register()
      this.emit('PARAM', cell, ++this.parameterCount)
      this.scopes[this.scopes.length - 1].set(parameter.name, cell)
    }
    this.block(node.body, false)
    this.emit('RETURN')
    this.scopes.pop()
    this.breaks = outerBreaks
    this.continues = outerContinues
    this.parameterCount = outerParameterCount
    this.frameScopeStart = outerFrameScopeStart
    this.patch(skip)
    this.emit('CLOSURE', dst, entry, ...captures)
  }

  private expands(node?: Expression) { return !!node && (isCall(node) || node.type === 'VarargLiteral') && !this.grouped.has(node) }

  private valueList(expressions: Expression[], prefix: number[] = []) {
    const last = expressions[expressions.length - 1]
    const expands = this.expands(last)
    const values = [...prefix, ...(expands ? expressions.slice(0, -1) : expressions).map(value => this.expression(value))]
    const dst = this.register()
    this.emit('PACK', dst, ...values)
    if (expands) this.emit('APPEND', dst, this.expression(last, true))
    return dst
  }

  private assignmentValues(expressions: Expression[], count: number, _node: Node) {
    if (this.expands(expressions[expressions.length - 1])) {
      const list = this.valueList(expressions)
      return Array.from({ length: count }, (_, index) => {
        const dst = this.register()
        this.emit('GET', dst, list, this.load(index + 1))
        return dst
      })
    }
    // Evaluate even discarded expressions, before any assignment becomes visible.
    const values = expressions.map(expression => this.expression(expression))
    while (values.length < count) {
      const value = this.register()
      this.emit('NIL', value)
      values.push(value)
    }
    return values
  }

  expression(node: Expression, multiple = false): number {
    const dst = this.register()
    switch (node.type) {
      case 'FunctionDeclaration': this.functionExpression(node, dst); break
      case 'VarargLiteral': {
        const values = multiple ? dst : this.register()
        this.emit('VARARG', values, this.parameterCount)
        if (!multiple) this.emit('GET', dst, values, this.load(1))
        break
      }
      case 'NumericLiteral':
        if (!Number.isFinite(node.value)) fail(node, 'Non-finite numeric literals are not supported.')
        this.emit('K', dst, this.constant(node.value)); break
      case 'StringLiteral':
      case 'BooleanLiteral': this.emit('K', dst, this.constant(node.value)); break
      case 'NilLiteral': this.emit('NIL', dst); break
      case 'Identifier': {
        const local = this.local(node.name)
        if (local !== undefined) this.emit('GETCELL', dst, local)
        else this.emit('GLOBAL', dst, this.constant(node.name))
        break
      }
      case 'BinaryExpression': {
        const op = binary[node.operator as keyof typeof binary]
        if (!op) fail(node, `Operator ${node.operator} is not supported.`)
        this.emit(op, dst, this.expression(node.left), this.expression(node.right)); break
      }
      case 'UnaryExpression': {
        if (node.operator === '~') { this.emit('BITNOT', dst, this.expression(node.argument)); break }
        const op = unary[node.operator as keyof typeof unary]
        if (!op) fail(node, `Operator ${node.operator} is not supported.`)
        this.emit(op, dst, this.expression(node.argument)); break
      }
      case 'LogicalExpression': {
        this.emit('MOVE', dst, this.expression(node.left))
        const jump = this.emit(node.operator === 'and' ? 'JF' : 'JT', dst, 0)
        this.emit('MOVE', dst, this.expression(node.right))
        this.patch(jump); break
      }
      case 'MemberExpression': this.emit('GET', dst, this.expression(node.base), this.load(node.identifier.name)); break
      case 'IndexExpression': this.emit('GET', dst, this.expression(node.base), this.expression(node.index)); break
      case 'TableConstructorExpression': {
        this.emit('TABLE', dst)
        let index = 1
        for (const [i, field] of node.fields.entries()) {
          if (field.type === 'TableValue' && i === node.fields.length - 1 && this.expands(field.value)) {
            this.emit('SETLIST', dst, this.load(index), this.expression(field.value, true))
            continue
          }
          const key = field.type === 'TableKey' ? this.expression(field.key) : this.load(field.type === 'TableKeyString' ? field.key.name : index++)
          this.emit('SET', dst, key, this.expression(field.value))
        }
        break
      }
      case 'CallExpression':
      case 'StringCallExpression':
      case 'TableCallExpression': {
        if (node.type === 'CallExpression' && node.base.type === 'Identifier' && node.base.name.startsWith('__obsidian_')) {
          const helper = node.base.name
          const binaryHelper = ({ __obsidian_band: 'BAND', __obsidian_bor: 'BOR', __obsidian_bxor: 'BXOR', __obsidian_shl: 'SHL', __obsidian_shr: 'SHR' } as Record<string, Opcode | undefined>)[helper]
          if (binaryHelper && node.arguments.length === 2) { this.emit(binaryHelper, dst, this.expression(node.arguments[0]), this.expression(node.arguments[1])); break }
          if (helper === '__obsidian_bitnot' && node.arguments.length === 1) { this.emit('BITNOT', dst, this.expression(node.arguments[0])); break }
        }
        let fn: number
        const args: number[] = []
        if (node.base.type === 'MemberExpression' && node.base.indexer === ':') {
          const self = this.expression(node.base.base)
          fn = this.register()
          this.emit('GET', fn, self, this.load(node.base.identifier.name))
          args.push(self)
        } else fn = this.expression(node.base)
        const callArgs = node.type === 'CallExpression' ? node.arguments : node.type === 'StringCallExpression' ? [node.argument] : [node.arguments]
        if (multiple || this.expands(callArgs[callArgs.length - 1])) {
          const values = this.valueList(callArgs, args)
          const result = multiple ? dst : this.register()
          this.emit('CALLP', result, fn, values)
          if (!multiple) this.emit('GET', dst, result, this.load(1))
        } else {
          args.push(...callArgs.map((arg: Expression) => this.expression(arg)))
          this.emit('CALL', dst, fn, ...args)
        }
        break
      }
      default: fail(node, `${(node as Node).type} is not supported in v0.5. See Documentation for the supported syntax subset.`)
    }
    return dst
  }

  block(statements: Statement[], scoped = true) {
    if (scoped) this.scopes.push(new Map())
    for (const node of statements) this.statement(node)
    if (scoped) this.scopes.pop()
  }

  private statement(node: Statement) {
    switch (node.type) {
      case 'FunctionDeclaration': {
        const target = node.identifier
        if (!target) fail(node, 'Function declaration requires a name.')
        if (node.isLocal && target.type === 'Identifier') {
          const cell = this.register()
          const empty = this.register()
          this.emit('NIL', empty)
          this.emit('CELL', cell, empty)
          this.scopes[this.scopes.length - 1].set(target.name, cell)
          this.emit('SETCELL', cell, this.expression(node))
        } else if (target.type === 'Identifier') {
          const cell = this.local(target.name)
          const value = this.expression(node)
          if (cell !== undefined) this.emit('SETCELL', cell, value)
          else this.emit('SETGLOBAL', this.constant(target.name), value)
        } else {
          const object = this.expression(target.base)
          const key = this.load(target.identifier.name)
          this.emit('SET', object, key, this.expression(node))
        }
        break
      }
      case 'LocalStatement': {
        const values = this.assignmentValues(node.init, node.variables.length, node)
        node.variables.forEach((variable: Node, index: number) => {
          const local = this.register()
          this.emit('CELL', local, values[index])
          this.scopes[this.scopes.length - 1].set(variable.name, local)
        })
        break
      }
      case 'AssignmentStatement': {
        // Capture table references and keys before writes (e.g. i,t[i] = i+1,9).
        const targets = node.variables.map((target: Expression) => {
          if (target.type === 'Identifier') {
            const local = this.local(target.name)
            return local !== undefined
              ? { opcode: 'SETCELL' as const, args: [local] }
              : { opcode: 'SETGLOBAL' as const, args: [this.constant(target.name)] }
          }
          const object = this.expression(target.base)
          const key = target.type === 'MemberExpression' ? this.load(target.identifier.name) : this.expression(target.index)
          return { opcode: 'SET' as const, args: [object, key] }
        })
        const compound = this.compounds.get(node)
        if (compound) {
          const target = targets[0]
          const previous = this.register()
          const variable = node.variables[0]
          const liveLocal = this.frameLocal(variable)
          if (variable.type !== 'Identifier') {
            const objectCell = this.frameLocal(variable.base)
            if (objectCell !== undefined) this.emit('GETCELL', target.args[0], objectCell)
          }
          if (target.opcode === 'SETCELL' && liveLocal === undefined) this.emit('GETCELL', previous, ...target.args)
          else if (target.opcode === 'SETGLOBAL') this.emit('GLOBAL', previous, ...target.args)
          else if (target.opcode === 'SET') this.emit('GET', previous, ...target.args)
          const value = this.expression(node.init[0])
          // Luau uses live frame-local slots, but snapshots globals, upvalues and computed expressions.
          if (liveLocal !== undefined) this.emit('GETCELL', previous, liveLocal)
          const result = this.register()
          this.emit(binary[compound], result, previous, value)
          if (variable.type !== 'Identifier') {
            const objectCell = this.frameLocal(variable.base)
            if (objectCell !== undefined) this.emit('GETCELL', target.args[0], objectCell)
            const keyCell = variable.type === 'IndexExpression' ? this.frameLocal(variable.index) : undefined
            if (keyCell !== undefined) this.emit('GETCELL', target.args[1], keyCell)
          }
          this.emit(target.opcode, ...target.args, result)
          break
        }
        const values = this.assignmentValues(node.init, targets.length, node)
        // Lua commits assignments right-to-left when targets alias one another.
        for (let index = targets.length - 1; index >= 0; index--) {
          const target = targets[index]
          this.emit(target.opcode, ...target.args, values[index])
        }
        break
      }
      case 'CallStatement':
        if (node.expression.type === 'CallExpression' && node.expression.base.type === 'Identifier' && node.expression.base.name === '__obsidian_continue') {
          if (!this.continues.length) fail(node, 'continue must be inside a loop.')
          this.continues[this.continues.length - 1].push(this.emit('JUMP', 0))
        } else this.expression(node.expression)
        break
      case 'ReturnStatement':
        if (this.expands(node.arguments[node.arguments.length - 1])) this.emit('RETURNP', this.valueList(node.arguments))
        else this.emit('RETURN', ...node.arguments.map((arg: Expression) => this.expression(arg)))
        break
      case 'DoStatement': this.block(node.body); break
      case 'IfStatement': {
        const exits: number[] = []
        for (const clause of node.clauses) {
          const skip = clause.type === 'ElseClause' ? undefined : this.emit('JF', this.expression(clause.condition), 0)
          this.block(clause.body)
          exits.push(this.emit('JUMP', 0))
          if (skip !== undefined) this.patch(skip)
        }
        exits.forEach(index => this.patch(index))
        break
      }
      case 'WhileStatement': {
        const start = this.position()
        const exit = this.emit('JF', this.expression(node.condition), 0)
        this.breaks.push([])
        this.continues.push([])
        this.block(node.body)
        this.continues.pop()!.forEach(index => this.patch(index, start))
        this.emit('JUMP', start)
        this.patch(exit)
        this.breaks.pop()!.forEach(index => this.patch(index))
        break
      }
      case 'RepeatStatement': {
        const start = this.position()
        this.scopes.push(new Map())
        this.breaks.push([])
        this.continues.push([])
        this.block(node.body, false)
        const conditionStart = this.position()
        this.continues.pop()!.forEach(index => this.patch(index, conditionStart))
        this.emit('JF', this.expression(node.condition), start)
        this.breaks.pop()!.forEach(index => this.patch(index))
        this.scopes.pop()
        break
      }
      case 'ForNumericStatement': {
        const control = this.expression(node.start)
        const limit = this.expression(node.end)
        const step = node.step ? this.expression(node.step) : this.load(1)
        this.emit('FORINIT', control, limit, step)
        const start = this.position()
        const condition = this.register()
        this.emit('FORCHECK', condition, control, limit, step)
        const exit = this.emit('JF', condition, 0)
        this.scopes.push(new Map())
        const iterator = this.register()
        this.scopes[this.scopes.length - 1].set(node.variable.name, iterator)
        this.emit('CELL', iterator, control)
        this.breaks.push([])
        this.continues.push([])
        this.block(node.body, false)
        const increment = this.position()
        this.continues.pop()!.forEach(index => this.patch(index, increment))
        this.emit('ADD', control, control, step)
        this.emit('JUMP', start)
        this.patch(exit)
        this.breaks.pop()!.forEach(index => this.patch(index))
        this.scopes.pop()
        break
      }
      case 'ForGenericStatement': {
        const [iterator, state, control] = this.assignmentValues(node.iterators, 3, node)
        if (node.generalized) this.emit('GENERIC', iterator, state, control)
        const start = this.position()
        const args = this.register()
        this.emit('PACK', args, state, control)
        const results = this.register()
        this.emit('CALLP', results, iterator, args)
        this.emit('GET', control, results, this.load(1))
        const empty = this.register()
        this.emit('NIL', empty)
        const done = this.register()
        this.emit('EQ', done, control, empty)
        const exit = this.emit('JT', done, 0)
        this.scopes.push(new Map())
        node.variables.forEach((variable: Node, index: number) => {
          const local = this.register()
          const value = this.register()
          this.emit('GET', value, results, this.load(index + 1))
          this.emit('CELL', local, value)
          this.scopes[this.scopes.length - 1].set(variable.name, local)
        })
        this.breaks.push([])
        this.continues.push([])
        this.block(node.body, false)
        this.continues.pop()!.forEach(index => this.patch(index, start))
        this.emit('JUMP', start)
        this.patch(exit)
        this.breaks.pop()!.forEach(index => this.patch(index))
        this.scopes.pop()
        break
      }
      case 'BreakStatement': {
        if (!this.breaks.length) fail(node, 'break must be inside a loop.')
        this.breaks[this.breaks.length - 1].push(this.emit('JUMP', 0)); break
      }
      default: fail(node, `${(node as Node).type} is not supported in v0.5. See Documentation for the supported syntax subset.`)
    }
  }
}

export function compileSource(source: string, options: Partial<CompilerOptions> = DEFAULT_OPTIONS, requireVM = false): CompileResult {
  const start = performance.now()
  const inputBytes = Buffer.byteLength(source, 'utf8')
  if (!source.trim()) throw new CompileError('Add a script before compiling.')
  if (inputBytes > MAX_SOURCE_BYTES) throw new CompileError('Source exceeds the 10 MB limit.')
  const resolvedOptions = { ...DEFAULT_OPTIONS, ...options }
  let ast: Node
  let compounds: Map<Node, CompoundOperator>
  let grouped: Set<Node>
  try {
    // The official Luau parser produces the AST. We adapt that AST directly to the
    // existing VM IR; there is deliberately no Lua-5.1 parse or source rewrite here.
    const officialAst = parseLuau(source)
    const adapted = adaptLuauAst(officialAst)
    ast = adapted.ast
    compounds = adapted.compounds
    grouped = adapted.grouped
  } catch (error) {
    if (error instanceof RangeError) throw new CompileError('Script nesting is too deep. Simplify the expression or block structure.')
    throw error instanceof CompileError ? error : new CompileError(`Luau frontend failed: ${error instanceof Error ? error.message : 'unrecognized syntax'}`)
  }
  const compiler = new Compiler(grouped, compounds)
  try { compiler.block(ast.body, false) }
  catch (error) {
    if (error instanceof RangeError) throw new CompileError('Script nesting is too deep. Simplify the expression or block structure.')
    throw error
  }
  compiler.code.push(['RETURN'])
  const optimized = optimizeProgram({ code: compiler.code, constants: compiler.constants })
  compiler.code = optimized.code
  compiler.constants = optimized.constants
  const { output, handlers } = emitVM(compiler, resolvedOptions)
  return {
    mode: 'vm',
    warnings: [],
    output,
    stats: { inputBytes, outputBytes: Buffer.byteLength(output), instructions: compiler.code.length, constants: compiler.constants.length, handlers, durationMs: Math.max(1, Math.round(performance.now() - start)) },
    protections: (Object.keys(resolvedOptions) as (keyof CompilerOptions)[]).filter(key => resolvedOptions[key]),
    buildId: randomUUID(),
  }
}
