import assert from 'node:assert/strict'
import { test } from 'node:test'
import { optimizeProgram } from './ir.ts'

const optimize = (code, constants) => optimizeProgram({ code, constants }).code

test('does not fold constants across branch joins', () => {
  const code = optimize([
    ['PARAM', 1, 1], ['JF', 1, 5], ['K', 2, 1], ['JUMP', 6],
    ['K', 2, 2], ['K', 3, 3], ['ADD', 4, 2, 3], ['RETURN', 4],
  ], [10, 20, 1])
  assert.ok(code.some(ins => ins[0] === 'ADD' || ins[0] === 'ADDK'))
})

test('preserves a left-hand addition constant and operand order', () => {
  const code = optimize([
    ['PARAM', 8, 1], ['K', 3, 1], ['ADD', 9, 3, 8], ['RETURN', 9],
  ], [42])
  assert.deepEqual(code[2], ['ADD', code[3][1], code[1][1], code[0][1]])
})

test('fuses a right-hand addition constant in the correct slot', () => {
  const code = optimize([
    ['PARAM', 8, 1], ['K', 3, 1], ['ADD', 9, 8, 3], ['RETURN', 9],
  ], [42])
  assert.deepEqual(code[1], ['ADDK', 9, 8, 1])
})

test('does not treat the table register as a constant key', () => {
  const code = optimize([
    ['PARAM', 8, 1], ['K', 3, 1], ['GET', 9, 3, 8], ['RETURN', 9],
  ], ['text'])
  assert.deepEqual(code[2], ['GET', code[3][1], code[1][1], code[0][1]])
})

test('does not fuse a branch entry with its preceding instruction', () => {
  const code = optimize([
    ['PARAM', 8, 1], ['PARAM', 3, 2], ['JT', 8, 5], ['K', 3, 1],
    ['ADD', 9, 8, 3], ['RETURN', 9],
  ], [42])
  assert.ok(code.some(ins => ins[0] === 'ADD'))
  assert.ok(!code.some(ins => ins[0] === 'ADDK'))
})

test('preserves invalid boolean ordering instead of folding away the error', () => {
  const code = optimize([
    ['K', 1, 1], ['K', 2, 2], ['LT', 3, 1, 2], ['RETURN', 3],
  ], [false, true])
  assert.ok(code.some(ins => ins[0] === 'LT'))
})

test('leaves string ordering to the Luau runtime', () => {
  const code = optimize([
    ['K', 1, 1], ['K', 2, 2], ['LT', 3, 1, 2], ['RETURN', 3],
  ], ['\u{10000}', '\uE000'])
  assert.ok(code.some(ins => ins[0] === 'LT'))
})
