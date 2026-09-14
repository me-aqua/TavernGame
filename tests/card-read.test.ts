/**
 * tests/card-read.test.ts —— 校验卡时用的底层工具：汉字数字、键集、路径。
 *
 * 这些函数被 card.ts 的检查大量复用，所以它们的**边界**值得单独钉住：
 * 汉字数字要认得 十 / 十二 / 二十 这三种写法，读不出来时必须返回 null
 * （返回 0 或猜一个数会让「N 块设定」这类自洽检查变成永远通过）。
 */
import { describe, expect, it } from 'vitest'
import { at, checkKeys, chineseNumber, requireText } from '../src/game/card-read'
import { checkSettingCount, checkStateNote } from '../src/game/card-notes'
import * as K from '../src/game/card-keys'

describe('chineseNumber', () => {
  it('reads the three ways of writing a small number', () => {
    expect(chineseNumber('一')).toBe(1)
    expect(chineseNumber('十')).toBe(10)
    expect(chineseNumber('十二')).toBe(12)
    expect(chineseNumber('二十')).toBe(20)
    expect(chineseNumber('二十一')).toBe(21)
  })

  it('picks the numeral out of a sentence', () => {
    expect(chineseNumber('① 给 AI 的五块设定')).toBe(5)
    expect(chineseNumber('作者点名的五个地点一个不少')).toBe(5)
  })

  it('returns null when there is nothing readable', () => {
    expect(chineseNumber('no numeral here')).toBeNull()
    expect(chineseNumber('')).toBeNull()
    expect(chineseNumber('1234')).toBeNull()
  })
})

describe('reading helpers', () => {
  it('joins a JSON path only when there is a parent', () => {
    expect(at('', 'tree')).toBe('tree')
    expect(at('tree', 'leaf')).toBe('tree.leaf')
  })

  it('rejects a missing key and an unknown key', () => {
    expect(() => checkKeys({ a: 1 }, ['a', 'b'], 'block')).toThrow(/missing key "b"/)
    expect(() => checkKeys({ a: 1, c: 2 }, ['a'], 'block')).toThrow(/block\.c: unknown key/)
  })

  it('rejects an empty string', () => {
    expect(() => requireText({ a: '' }, 'a', 'block')).toThrow(/block\.a: must be a non-empty string/)
  })
})

describe('note checks', () => {
  it('accepts the declared block count and rejects a mismatch', () => {
    const lines = ['① 给 AI 的五块设定']
    expect(() => checkSettingCount(lines, 5, 'convention')).not.toThrow()
    expect(() => checkSettingCount(lines, 4, 'convention')).toThrow(/declares 5 setting blocks/)
  })

  it('rejects a convention that never declares the count', () => {
    expect(() => checkSettingCount(['no count here'], 5, 'convention')).toThrow(/exactly once/)
  })

  it('rejects a card with no notes block', () => {
    expect(() => checkStateNote({})).toThrow(new RegExp(K.KEY_NOTES + ': must be an object'))
  })
})
