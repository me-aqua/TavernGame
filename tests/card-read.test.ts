/**
 * tests/card-read.test.ts —— 校验卡时用的底层工具：路径拼接、键集、取字段。
 *
 * 这些函数被 card.ts / card-state.ts / card-calendar.ts 大量复用，所以它们的**边界**值得
 * 单独钉住：键集多一个少一个都要拒、可选字段不写就是 undefined（而不是空串）。
 */
import { describe, expect, it } from 'vitest'
import {
  at,
  checkKeys,
  checkOptionalKeys,
  checkTextList,
  fail,
  isRecord,
  readText,
  readTextList,
  requireRecord,
  requireText,
  requireTextList,
} from '../src/game/card-read'

describe('paths and failures', () => {
  it('joins a JSON path only when there is a parent', () => {
    expect(at('', 'tree')).toBe('tree')
    expect(at('tree', 'leaf')).toBe('tree.leaf')
  })

  it('writes the path into the error message', () => {
    expect(() => fail('tree.leaf', 'must be a string')).toThrow('card tree.leaf: must be a string')
    expect(() => fail('', 'must be an object')).toThrow('card: must be an object')
  })

  it('knows a record from an array', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
  })
})

describe('required values', () => {
  it('rejects a missing key and an unknown key', () => {
    expect(() => checkKeys({ a: 1 }, ['a', 'b'], 'block')).toThrow(/missing key "b"/)
    expect(() => checkKeys({ a: 1, c: 2 }, ['a'], 'block')).toThrow(/block\.c: unknown key/)
  })

  it('requires the listed keys and rejects unknown ones', () => {
    expect(() => checkOptionalKeys({ a: 1 }, ['a', 'b'], ['a', 'b'], 'block')).toThrow(/missing key "b"/)
    expect(() => checkOptionalKeys({ a: 1, c: 2 }, ['a', 'b'], ['a'], 'block')).toThrow(
      /block\.c: unknown key/,
    )
    expect(checkOptionalKeys({ a: 1 }, ['a', 'b'], ['a'], 'block')).toBeUndefined()
  })

  it('rejects an empty string, a wrong type, and a missing field', () => {
    expect(() => requireText({ a: '' }, 'a', 'block')).toThrow(/block\.a: must be a non-empty string/)
    expect(() => requireText({ a: 7 }, 'a', 'block')).toThrow(/must be a non-empty string/)
    expect(() => requireText({}, 'a', 'block')).toThrow(/must be a non-empty string/)
  })

  it('rejects a missing record, and an array where a record is wanted', () => {
    expect(() => requireRecord({}, 'a', 'block')).toThrow(/block\.a: must be an object/)
    expect(() => requireRecord({ a: [] }, 'a', 'block')).toThrow(/must be an object/)
  })
})

describe('text lists', () => {
  it('rejects an empty list or a non-string line', () => {
    expect(() => requireTextList({ a: [] }, 'a', 'block')).toThrow(/block\.a: must not be empty/)
    expect(() => requireTextList({ a: ['ok', 7] }, 'a', 'block')).toThrow(/must be an array of strings/)
    expect(requireTextList({ a: ['ok'] }, 'a', 'block')).toEqual(['ok'])
  })

  it('treats an absent optional list as undefined, and an empty one as an empty list', () => {
    expect(readTextList({}, 'a', 'block')).toBeUndefined()
    expect(readTextList({ a: [] }, 'a', 'block')).toEqual([])
    expect(readTextList({ a: ['x'] }, 'a', 'block')).toEqual(['x'])
    expect(() => readTextList({ a: [1] }, 'a', 'block')).toThrow(/must be an array of strings/)
  })

  it('treats an absent optional text as undefined, and an empty one as an error', () => {
    expect(readText({}, 'a', 'block')).toBeUndefined()
    expect(() => readText({ a: '' }, 'a', 'block')).toThrow(/must be a non-empty string/)
    expect(readText({ a: 'x' }, 'a', 'block')).toBe('x')
  })

  it('checks a loose text list (value + path)', () => {
    expect(checkTextList(['a'], 'block')).toEqual(['a'])
    expect(() => checkTextList('a', 'block')).toThrow(/block: must be an array/)
    expect(() => checkTextList([], 'block')).toThrow(/must not be empty/)
    expect(() => checkTextList([1], 'block')).toThrow(/must be an array of strings/)
  })
})
