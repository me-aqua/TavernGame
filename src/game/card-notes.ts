/**
 * src/game/card-notes.ts —— 卡里「说明」那一段写的数字必须跟数据对得上。
 *
 * ⚠️ 这组检查是**可证伪**的：只判存在性的校验抓不到自相矛盾的卡 ——「四段」写成五段、
 *    「五块设定」写成四块，读卡的人只会照着说明去改数据。
 */

/** 卡格式的键名与标点 —— 源码必须 ASCII，转义都收在 card-keys 里 */
import * as K from './card-keys'
import { at, fail, requireRecord, requireText, chineseNumber, NUMERALS } from './card-read'

/** 节点约定里写死的「N 块设定」必须等于 提示词.设定的块数 */
export function checkSettingCount(lines: string[], count: number, base: string): void {
  const declared: number[] = []
  for (const line of lines) {
    const match = new RegExp('[' + NUMERALS + ']+' + K.KEY_BLOCK).exec(line)
    if (match) declared.push(chineseNumber(match[0]) ?? -1)
  }
  if (declared.length !== 1) {
    fail(base, 'must declare the number of setting blocks exactly once (found ' + declared.length + ')')
  }
  if (declared[0] !== count) {
    const real = at(K.KEY_PROMPT, K.KEY_SETTING)
    fail(base, 'declares ' + declared[0] + ' setting blocks but ' + real + ' has ' + count)
  }
}

/** 说明.状态 里声明的「N 段：…」必须跟 声明.状态.角色 的键对得上（说明与 schema 不能各说各话） */
export function checkStateNote(card: Record<string, unknown>): void {
  const notes = requireRecord(card, K.KEY_NOTES, '')
  const note = requireText(notes, K.KEY_STATE, K.KEY_NOTES)
  const where = at(K.KEY_NOTES, K.KEY_STATE)
  const colon = note.indexOf(K.PUNCT_COLON)
  if (colon < 0) fail(where, 'must list the segments after a "' + K.PUNCT_COLON + '"')
  const period = note.indexOf(K.PUNCT_PERIOD, colon + 1)
  if (period < 0) fail(where, 'the segment list must end with "' + K.PUNCT_PERIOD + '"')
  const declared = chineseNumber(note.slice(0, colon))
  if (declared === null) fail(where, 'no chinese numeral to check the segment count against')
  const names = note
    .slice(colon + 1, period)
    .split('/')
    .map((name) => name.trim())
  if (declared !== names.length) fail(where, 'says ' + declared + ' segments but lists ' + names.length)
  const state = requireRecord(requireRecord(card, K.KEY_DECL, ''), K.KEY_STATE, K.KEY_DECL)
  const role = requireRecord(state, K.KEY_ROLE, at(K.KEY_DECL, K.KEY_STATE))
  for (const name of names) {
    if (!Object.hasOwn(role, name)) {
      const real = at(at(K.KEY_DECL, K.KEY_STATE), K.KEY_ROLE)
      fail(where, '"' + name + '" is not a key of ' + real)
    }
  }
}
