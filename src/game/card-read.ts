/**
 * src/game/card-read.ts —— 校验一张卡时反复用到的那几件小事：拼 JSON 路径、取字段、检查键集。
 *
 * ⚠️ 它们只**读**卡，不认识任何一块的含义 —— 「这个键该不该在」全在 card.ts / card-state.ts
 *    的检查里。失败一律抛错并带 ASCII 路径（如 state.world.location），绝不静默纠正：
 *    在这里「纠正」等于替作者改卡，下一轮谁也不知道卡里原本写的是什么。
 *
 * ⚠️ isRecord 自带一份，不从 game/save.ts 借：save.ts 经 i18n 拉进 Vue，而这一组模块
 *    （card / card-state / card-actions / card-calendar）是纯函数，要能在没有 Vue 的地方跑。
 */

/** 路径拼接：父路径 + 一级键名（顶层传空串，于是路径就是键名本身） */
export function at(base: string, key: string): string {
  return base ? base + '.' + key : key
}

/** 校验失败：抛错并带上卡里的 JSON 路径 —— 绝不静默纠正 */
export function fail(path: string, reason: string): never {
  throw new Error(path ? 'card ' + path + ': ' + reason : 'card: ' + reason)
}

/** 普通对象（数组不算）—— 卡里的每个块都是它 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  const lines = requireArray(parent, key, base)
  if (lines.length === 0) fail(at(base, key), 'must not be empty')
  if (!lines.every((line) => typeof line === 'string')) fail(at(base, key), 'must be an array of strings')
  return lines as string[]
}

/** 取一个可选的字符串数组：不写 = undefined（全部），写了可以是空表（tools: [] = 一个都不给） */
export function readTextList(
  parent: Record<string, unknown>,
  key: string,
  base: string,
): string[] | undefined {
  if (!Object.hasOwn(parent, key)) return undefined
  const lines = requireArray(parent, key, base)
  if (!lines.every((line) => typeof line === 'string')) fail(at(base, key), 'must be an array of strings')
  return lines as string[]
}

/** 取一个可选的文本字段：不写就是 undefined，写了就不能是空串 */
export function readText(parent: Record<string, unknown>, key: string, base: string): string | undefined {
  if (!Object.hasOwn(parent, key)) return undefined
  return requireText(parent, key, base)
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

/** 键集必须在 allowed 里，required 里的一个都不能少（可选键只是可写可不写） */
export function checkOptionalKeys(
  record: Record<string, unknown>,
  allowed: string[],
  required: string[],
  base: string,
): void {
  for (const key of required) {
    if (!Object.hasOwn(record, key)) fail(base, 'missing key "' + key + '"')
  }
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) fail(at(base, key), 'unknown key')
  }
}

/** 非空的字符串数组（卡里多处要它；错误信息指到数组本身） */
export function checkTextList(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) fail(where, 'must be an array')
  if (value.length === 0) fail(where, 'must not be empty')
  if (!value.every((line) => typeof line === 'string')) fail(where, 'must be an array of strings')
  return value as string[]
}
