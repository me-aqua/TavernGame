/**
 * src/game/card-read.ts —— 校验一张卡时反复用到的那几件小事：拼 JSON 路径、取字段、
 * 检查键集、读汉字数字（「五个地点」这种声明要跟数据对上）。
 *
 * ⚠️ 它们只**读**卡，不认识任何一块的含义 —— 「这个键该不该在」「这个数字要跟谁对上」
 *    全在 card.ts 的检查里。失败一律抛错并带路径（理由见 card.ts 的文件头）。
 */

import { isRecord } from './save'
/** 卡格式的键名与标点 —— 源码必须 ASCII，转义都收在 card-keys 里 */
import * as K from './card-keys'

/** 汉字数字字符集 —— 解析「五个地点」这类声明 */
export const NUMERALS =
  K.CN_ONE +
  K.CN_TWO +
  K.CN_TWO_PLAIN +
  K.CN_THREE +
  K.CN_FOUR +
  K.CN_FIVE +
  K.CN_SIX +
  K.CN_SEVEN +
  K.CN_EIGHT +
  K.CN_NINE +
  K.CN_TEN

/** 单个汉字数字 → 数值（「十」的组合在 chineseNumber 里处理） */
export const DIGITS: Record<string, number> = {
  [K.CN_ONE]: 1,
  [K.CN_TWO]: 2,
  [K.CN_TWO_PLAIN]: 2,
  [K.CN_THREE]: 3,
  [K.CN_FOUR]: 4,
  [K.CN_FIVE]: 5,
  [K.CN_SIX]: 6,
  [K.CN_SEVEN]: 7,
  [K.CN_EIGHT]: 8,
  [K.CN_NINE]: 9,
}
/** 路径拼接：父路径 + 一级键名（顶层传空串，于是路径就是键名本身） */
export function at(base: string, key: string): string {
  return base ? base + '.' + key : key
}

/** 校验失败：抛错并带上卡里的 JSON 路径 —— 绝不静默纠正 */
export function fail(path: string, reason: string): never {
  throw new Error(path ? 'card ' + path + ': ' + reason : 'card: ' + reason)
}

/** 取一个必须是对象的字段 */
export function requireRecord(
  parent: Record<string, unknown>,
  key: string,
  base: string,
): Record<string, unknown> {
  const value = parent[key]
  if (!isRecord(value)) fail(at(base, key), 'must be an object')
  return value
}

/** 取一个必须是数组的字段 */
export function requireArray(parent: Record<string, unknown>, key: string, base: string): unknown[] {
  const value = parent[key]
  if (!Array.isArray(value)) fail(at(base, key), 'must be an array')
  return value
}

/** 取一个非空字符串字段 */
export function requireText(parent: Record<string, unknown>, key: string, base: string): string {
  const value = parent[key]
  if (typeof value !== 'string' || value.length === 0) fail(at(base, key), 'must be a non-empty string')
  return value
}

/** 取一个非空的字符串数组字段（空行合法 —— 提示词里本来就有空行） */
export function requireTextList(parent: Record<string, unknown>, key: string, base: string): string[] {
  const value = requireArray(parent, key, base)
  if (value.length === 0) fail(at(base, key), 'must not be empty')
  if (!value.every((line) => typeof line === 'string')) fail(at(base, key), 'must be an array of strings')
  return value
}

/** 键集必须正好是这些键：少一个、多一个都拒（没人读的键多半是写错了名字） */
export function checkKeys(record: Record<string, unknown>, keys: string[], base: string): void {
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) fail(base, 'missing key "' + key + '"')
  }
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) fail(at(base, key), 'unknown key')
  }
}

/** 读出文本里的第一个汉字数字（1–99：一 / 十 / 十二 / 二十）；读不出来返回 null */
export function chineseNumber(text: string): number | null {
  const match = new RegExp('[' + NUMERALS + ']+').exec(text)
  if (!match) return null
  const written = match[0]
  const ten = written.indexOf(K.CN_TEN)
  if (ten < 0) return written.length === 1 ? (DIGITS[written] ?? null) : null
  const tens = ten === 0 ? 1 : (DIGITS[written[ten - 1]] ?? null)
  const ones = ten === written.length - 1 ? 0 : (DIGITS[written[ten + 1]] ?? null)
  if (tens === null || ones === null) return null
  return tens * 10 + ones
}
