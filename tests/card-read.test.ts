/**
 * tests/card-read.test.ts —— 校验卡时用的底层工具：汉字数字、键集、路径。
 *
 * 这些函数被 card.ts 的检查大量复用，所以它们的**边界**值得单独钉住：
 * 汉字数字要认得 十 / 十二 / 二十 这三种写法，读不出来时必须返回 null
 * （返回 0 或猜一个数会让「N 块设定」这类自洽检查变成永远通过）。
 *
 * ⚠️ 用例里的汉字一律由 card-keys 的常量拼出来 —— 源码必须 ASCII（.githooks/checks/ascii.mjs），
 *    测试也不例外：写死中文字面量会被 pre-commit 拦下。
 */
import { describe, expect, it } from 'vitest'
import { at, checkKeys, chineseNumber, requireText } from '../src/game/card-read'
import { checkSettingCount, checkStateNote } from '../src/game/card-notes'
import * as K from '../src/game/card-keys'

/** 十二 —— 「十」在前、「二」在后，验证十位为 1 的那条分支 */
const TWELVE = K.CN_TEN + K.CN_TWO_PLAIN
/** 二十一 —— 十位与个位都不是 1 */
const TWENTY_ONE = K.CN_TWO_PLAIN + K.CN_TEN + K.CN_ONE
/** 一条声明了块数的约定行（正则要在句子里把数字挑出来） */
const FIVE_BLOCKS = K.CN_FIVE + K.KEY_BLOCK

describe('chineseNumber', () => {
  it('reads the three ways of writing a small number', () => {
    expect(chineseNumber(K.CN_ONE)).toBe(1)
    expect(chineseNumber(K.CN_TWO)).toBe(2)
    expect(chineseNumber(K.CN_TEN)).toBe(10)
    expect(chineseNumber(TWELVE)).toBe(12)
    expect(chineseNumber(K.CN_TWO_PLAIN + K.CN_TEN)).toBe(20)
    expect(chineseNumber(TWENTY_ONE)).toBe(21)
  })

  it('picks the numeral out of a sentence', () => {
    expect(chineseNumber('AI: ' + FIVE_BLOCKS)).toBe(5)
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
    expect(() => checkSettingCount([FIVE_BLOCKS], 5, 'convention')).not.toThrow()
    expect(() => checkSettingCount([FIVE_BLOCKS], 4, 'convention')).toThrow(/declares 5 setting blocks/)
  })

  it('rejects a convention that never declares the count', () => {
    expect(() => checkSettingCount(['no count here'], 5, 'convention')).toThrow(/exactly once/)
  })

  it('rejects a card with no notes block', () => {
    expect(() => checkStateNote({})).toThrow(new RegExp(K.KEY_NOTES + ': must be an object'))
  })
})
