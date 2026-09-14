/**
 * src/game/card.ts —— 一张卡的形状与自洽性
 *
 * 卡是**外部数据**（作者手写、从别人那儿导入），按纪律只有系统边界才做校验，
 * 所以卡的校验集中在这里；将来照图跑的引擎只管「校验通过之后」的行为。
 *
 * ⚠️ 只认 card/1。格式不认识就直接拒 —— 不做字段改名、不做版本迁移：
 *    产品未发布，没有旧卡要兼容。
 *
 * 校验分两种，两种都必须能**证伪**：
 *   · 形状 —— 字段在不在、类型对不对；
 *   · 自洽 —— 卡里两处各自声明的东西必须互相对得上：「N 个地点」跟地点数、
 *     节点约定提到的节点跟拓扑、「N 块设定」跟给AI 的块数、说明里的段名跟 schema 的键。
 *   只判存在性的检查抓不到自相矛盾的卡，所以第二组才是重点。
 *
 * 失败一律抛错并带 JSON 路径（如「节点[3].序号」），绝不静默纠正：在这里「纠正」
 * 等于替作者改卡，下一轮谁也不知道卡里原本写的是什么。
 */

import { isRecord } from './save'
/** 卡格式的键名与标点 —— 源码必须 ASCII，转义都收在 card-keys 里 */
import * as K from './card-keys'

/** 通过校验的卡数据：顶层 12 键都在，各块按卡格式解释 */
export type CardData = Record<string, unknown>

/** 卡格式版本 —— 「卡.格式」不是它就直接拒（这个字段就是干这个的） */
const CARD_FORMAT = 'card/1'

/** 卡 ID：小写字母 / 数字 / 连字符，中间一个点（作者名.卡名） */
const CARD_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/

/** 卡版本：semver（主.次.修订，后面可跟 -预发布 / +构建） */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** 引擎认识的历法 —— 日期算法按它选 */
const CALENDARS = new Set(['real'])

/** 数值字段的类型标记（schema 里「类型」的值） */
const TYPE_NUMBER = 'number'

/** 汉字数字字符集 —— 解析「五个地点」这类声明 */
const NUMERALS =
  K.CN_ONE +
  K.CN_TWO +
  K.CN_THREE +
  K.CN_FOUR +
  K.CN_FIVE +
  K.CN_SIX +
  K.CN_SEVEN +
  K.CN_EIGHT +
  K.CN_NINE +
  K.CN_TEN

/** 单个汉字数字 → 数值（「十」的组合在 chineseNumber 里处理） */
const DIGITS: Record<string, number> = {
  [K.CN_ONE]: 1,
  [K.CN_TWO]: 2,
  [K.CN_THREE]: 3,
  [K.CN_FOUR]: 4,
  [K.CN_FIVE]: 5,
  [K.CN_SIX]: 6,
  [K.CN_SEVEN]: 7,
  [K.CN_EIGHT]: 8,
  [K.CN_NINE]: 9,
}

/** 每个节点必须齐备的六个键 */
const NODE_KEYS = [K.KEY_NODE_NAME, K.KEY_ORDER, K.KEY_DUTY, K.KEY_PROMPT, K.KEY_OUTPUT, K.KEY_ID]

/** 路径拼接：父路径 + 一级键名（顶层传空串，于是路径就是键名本身） */
function at(base: string, key: string): string {
  return base ? base + '.' + key : key
}

/** 校验失败：抛错并带上卡里的 JSON 路径 —— 绝不静默纠正 */
function fail(path: string, reason: string): never {
  throw new Error(path ? 'card ' + path + ': ' + reason : 'card: ' + reason)
}

/** 取一个必须是对象的字段 */
function requireRecord(parent: Record<string, unknown>, key: string, base: string): Record<string, unknown> {
  const value = parent[key]
  if (!isRecord(value)) fail(at(base, key), 'must be an object')
  return value
}

/** 取一个必须是数组的字段 */
function requireArray(parent: Record<string, unknown>, key: string, base: string): unknown[] {
  const value = parent[key]
  if (!Array.isArray(value)) fail(at(base, key), 'must be an array')
  return value
}

/** 取一个非空字符串字段 */
function requireText(parent: Record<string, unknown>, key: string, base: string): string {
  const value = parent[key]
  if (typeof value !== 'string' || value.length === 0) fail(at(base, key), 'must be a non-empty string')
  return value
}

/** 取一个非空的字符串数组字段（空行合法 —— 提示词里本来就有空行） */
function requireTextList(parent: Record<string, unknown>, key: string, base: string): string[] {
  const value = requireArray(parent, key, base)
  if (value.length === 0) fail(at(base, key), 'must not be empty')
  if (!value.every((line) => typeof line === 'string')) fail(at(base, key), 'must be an array of strings')
  return value
}

/** 读出文本里的第一个汉字数字（1–99：一 / 十 / 十二 / 二十）；读不出来返回 null */
function chineseNumber(text: string): number | null {
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

/** 顶层 12 键：一个不少、类型对，且没有不认识的键（没人读的块多半是写错了名字） */
function checkTopLevel(card: Record<string, unknown>): void {
  for (const [key, kind] of K.TOP_LEVEL_KEYS) {
    const value = card[key]
    if (value === undefined) fail('', 'missing top-level key "' + key + '"')
    const ok = kind === 'object' ? isRecord(value) : Array.isArray(value)
    if (!ok) fail('', '"' + key + '" must be ' + (kind === 'object' ? 'an object' : 'an array'))
  }
  for (const key of Object.keys(card)) {
    if (!K.TOP_LEVEL_KEYS.some(([known]) => known === key)) fail('', 'unknown top-level key "' + key + '"')
  }
}

/** 卡的元信息：文本字段非空、格式认识、ID 规范（前缀 = 作者）、版本是 semver */
function checkMeta(card: Record<string, unknown>): void {
  const meta = requireRecord(card, K.KEY_CARD, '')
  const id = requireText(meta, K.KEY_ID, K.KEY_CARD)
  const version = requireText(meta, K.KEY_VERSION, K.KEY_CARD)
  const author = requireText(meta, K.KEY_AUTHOR, K.KEY_CARD)
  for (const key of [K.KEY_NAME, K.KEY_COMPAT, K.KEY_FORMAT, K.KEY_LANGUAGE])
    requireText(meta, key, K.KEY_CARD)
  if (meta[K.KEY_FORMAT] !== CARD_FORMAT) {
    const found = JSON.stringify(meta[K.KEY_FORMAT])
    fail(
      at(K.KEY_CARD, K.KEY_FORMAT),
      'unknown card format ' + found + ' (this engine reads "' + CARD_FORMAT + '")',
    )
  }
  if (!CARD_ID.test(id)) {
    fail(
      at(K.KEY_CARD, K.KEY_ID),
      'must look like "author.card" (lowercase letters, digits, dashes, one dot)',
    )
  }
  if (id.split('.')[0] !== author) {
    fail(at(K.KEY_CARD, K.KEY_ID), 'its namespace must equal ' + at(K.KEY_CARD, K.KEY_AUTHOR))
  }
  if (!SEMVER.test(version)) fail(at(K.KEY_CARD, K.KEY_VERSION), 'must be a semver like 1.2.3')
}

/** 给AI：五块设定、顺序固定、每块都是非空的行数组 */
function checkGiven(card: Record<string, unknown>): void {
  const given = requireRecord(card, K.KEY_GIVEN, '')
  const keys = Object.keys(given)
  if (keys.length !== K.GIVEN_BLOCKS.length) {
    fail(K.KEY_GIVEN, 'must have exactly ' + K.GIVEN_BLOCKS.length + ' blocks, got ' + keys.length)
  }
  K.GIVEN_BLOCKS.forEach((block, index) => {
    if (keys[index] !== block) fail(K.KEY_GIVEN, 'block #' + (index + 1) + ' must be "' + block + '"')
    requireTextList(given, block, K.KEY_GIVEN)
  })
}

/** 节点：非空、六键齐备、id 与名唯一、序号等于下标；返回按序的 id */
function checkNodes(card: Record<string, unknown>): string[] {
  const nodes = requireArray(card, K.KEY_NODES, '')
  if (nodes.length === 0) fail(K.KEY_NODES, 'must have at least one node')
  const ids: string[] = []
  const names: string[] = []
  nodes.forEach((node, index) => {
    const where = K.KEY_NODES + '[' + index + ']'
    if (!isRecord(node)) fail(where, 'must be an object')
    for (const key of NODE_KEYS) {
      if (!Object.hasOwn(node, key)) fail(where, 'missing key "' + key + '"')
    }
    const id = requireText(node, K.KEY_ID, where)
    const name = requireText(node, K.KEY_NODE_NAME, where)
    requireText(node, K.KEY_DUTY, where)
    requireTextList(node, K.KEY_PROMPT, where)
    requireRecord(node, K.KEY_OUTPUT, where)
    if (node[K.KEY_ORDER] !== index) {
      fail(at(where, K.KEY_ORDER), 'must be ' + index + ' (its position in ' + K.KEY_NODES + ')')
    }
    if (ids.includes(id)) fail(at(where, K.KEY_ID), 'duplicate node id "' + id + '"')
    if (names.includes(name)) fail(at(where, K.KEY_NODE_NAME), 'duplicate node name "' + name + '"')
    ids.push(id)
    names.push(name)
  })
  return ids
}

/** 拓扑与节点 id 等长且逐位对应 —— 引擎照拓扑跑，两处不一致就是跑错节点 */
function checkTopology(card: Record<string, unknown>, ids: string[]): void {
  const topology = requireArray(card, K.KEY_TOPOLOGY, '')
  if (topology.length !== ids.length) {
    const counts = ids.length + ' nodes, ' + topology.length + ' entries'
    fail(K.KEY_TOPOLOGY, 'must list every node id once (' + counts + ')')
  }
  topology.forEach((id, index) => {
    if (id !== ids[index]) fail(K.KEY_TOPOLOGY + '[' + index + ']', 'must be "' + ids[index] + '"')
  })
}

/** 开局.初始位置：键集必须正好是 {区域, 地点, 场景} */
function checkOpening(card: Record<string, unknown>): void {
  const opening = requireRecord(card, K.KEY_OPENING, '')
  const start = requireRecord(opening, K.KEY_START, K.KEY_OPENING)
  const wanted = [K.KEY_AREA, K.KEY_PLACE, K.KEY_SCENE].sort().join(' ')
  if (Object.keys(start).sort().join(' ') !== wanted) {
    const keys = K.KEY_AREA + ' / ' + K.KEY_PLACE + ' / ' + K.KEY_SCENE
    fail(at(K.KEY_OPENING, K.KEY_START), 'keys must be exactly ' + keys)
  }
}

/** 状态 schema：数值项是 {类型:number,初值:number,范围:[min,max]} 且初值落在范围内；层级初值属于取值 */
function checkSchema(card: Record<string, unknown>): void {
  const state = requireRecord(card, K.KEY_STATE, '')
  const role = requireRecord(state, K.KEY_ROLE, K.KEY_STATE)
  const inherent = requireRecord(role, K.KEY_INHERENT, at(K.KEY_STATE, K.KEY_ROLE))
  for (const [field, spec] of Object.entries(inherent)) {
    const where = at(K.KEY_STATE, K.KEY_ROLE) + '.' + K.KEY_INHERENT + '.' + field
    if (!isRecord(spec)) fail(where, 'must be an object')
    if (spec[K.KEY_TYPE] !== TYPE_NUMBER) continue
    const initial = spec[K.KEY_INITIAL]
    if (typeof initial !== 'number') fail(at(where, K.KEY_INITIAL), 'must be a number')
    const range = spec[K.KEY_RANGE]
    const bad = !Array.isArray(range) || range.length !== 2 || range.some((n) => typeof n !== 'number')
    if (bad) fail(at(where, K.KEY_RANGE), 'must be [min, max]')
    if (initial < range[0] || initial > range[1]) {
      fail(at(where, K.KEY_INITIAL), 'is outside ' + JSON.stringify(range))
    }
  }
  const tier = requireRecord(role, K.KEY_TIER, at(K.KEY_STATE, K.KEY_ROLE))
  const values = tier[K.KEY_VALUES]
  if (!Array.isArray(values) || !values.includes(tier[K.KEY_INITIAL])) {
    fail(at(at(K.KEY_STATE, K.KEY_ROLE), K.KEY_TIER) + '.' + K.KEY_VALUES, 'must list the initial value')
  }
}

/** 世界.历法：引擎只认识自己实现过的历法 */
function checkWorld(card: Record<string, unknown>): void {
  const world = requireRecord(card, K.KEY_WORLD, '')
  if (!CALENDARS.has(world[K.KEY_CALENDAR] as string)) {
    fail(at(K.KEY_WORLD, K.KEY_CALENDAR), 'unknown calendar ' + JSON.stringify(world[K.KEY_CALENDAR]))
  }
}

/** 核心剧本.阶段：阶段号从 1 起、连续（跳号就等于有一段永远演不到） */
function checkScript(card: Record<string, unknown>): void {
  const script = requireRecord(card, K.KEY_SCRIPT, '')
  const stages = requireArray(script, K.KEY_STAGES, K.KEY_SCRIPT)
  stages.forEach((stage, index) => {
    const where = K.KEY_SCRIPT + '.' + K.KEY_STAGES + '[' + index + ']'
    if (!isRecord(stage)) fail(where, 'must be an object')
    if (stage[K.KEY_STAGES] !== index + 1) fail(at(where, K.KEY_STAGES), 'must be ' + (index + 1))
  })
}

/** 显示.侧栏：区块名唯一（同一个块挂两次，界面就不知道该信哪个） */
function checkDisplay(card: Record<string, unknown>): void {
  const display = requireRecord(card, K.KEY_DISPLAY, '')
  const sidebar = requireArray(display, K.KEY_SIDEBAR, K.KEY_DISPLAY)
  const blocks: string[] = []
  sidebar.forEach((block, index) => {
    const where = K.KEY_DISPLAY + '.' + K.KEY_SIDEBAR + '[' + index + ']'
    if (!isRecord(block)) fail(where, 'must be an object')
    const name = requireText(block, K.KEY_BLOCK, where)
    if (blocks.includes(name)) fail(at(where, K.KEY_BLOCK), 'duplicate block "' + name + '"')
    blocks.push(name)
  })
}

/** 节点约定里写死的「N 块设定」必须等于 给AI 的块数 */
function checkGivenCount(lines: string[], count: number): void {
  const declared: number[] = []
  for (const line of lines) {
    const match = new RegExp('[' + NUMERALS + ']+' + K.KEY_BLOCK).exec(line)
    if (match) declared.push(chineseNumber(match[0]) ?? -1)
  }
  if (declared.length !== 1) {
    fail(
      K.KEY_CONVENTION,
      'must declare the number of setting blocks exactly once (found ' + declared.length + ')',
    )
  }
  if (declared[0] !== count) {
    fail(K.KEY_CONVENTION, 'declares ' + declared[0] + ' setting blocks but ' + K.KEY_GIVEN + ' has ' + count)
  }
}

/** 节点约定：提到的节点 id 与先后顺序必须正好是拓扑（每个节点都要被点到） */
function checkConvention(card: Record<string, unknown>, ids: string[]): void {
  const lines = requireTextList(card, K.KEY_CONVENTION, '')
  const seen: string[] = []
  for (const line of lines) {
    const hits: Array<[number, string]> = []
    for (const id of ids) {
      const found = line.search(new RegExp('(?<![a-z0-9-])' + id + '(?![a-z0-9-])'))
      if (found >= 0) hits.push([found, id])
    }
    hits.sort((left, right) => left[0] - right[0])
    for (const [, id] of hits) {
      if (!seen.includes(id)) seen.push(id)
    }
  }
  if (seen.join(' ') !== ids.join(' ')) {
    const told = 'topology: ' + ids.join(' ') + '; mentioned: ' + seen.join(' ')
    fail(K.KEY_CONVENTION, 'must mention every node id in topology order (' + told + ')')
  }
  checkGivenCount(lines, Object.keys(requireRecord(card, K.KEY_GIVEN, '')).length)
}

/** 生成器第一条原则里写的「N 个地点」必须等于第一个区域的必有地点数 —— 两处声明互证 */
function checkGeneratorPlaces(card: Record<string, unknown>): void {
  const generators = requireArray(card, K.KEY_GENERATORS, '')
  const first = generators[0]
  if (!isRecord(first)) fail(K.KEY_GENERATORS + '[0]', 'must be an object')
  const principles = requireTextList(first, K.KEY_PRINCIPLE, K.KEY_GENERATORS + '[0]')
  const declared = chineseNumber(principles[0])
  const where = K.KEY_GENERATORS + '[0].' + K.KEY_PRINCIPLE + '[0]'
  if (declared === null) fail(where, 'no chinese numeral to check the place count against')
  const world = requireRecord(card, K.KEY_WORLD, '')
  const areas = requireArray(world, K.KEY_AREA, K.KEY_WORLD)
  const area = areas[0]
  if (!isRecord(area)) fail(K.KEY_WORLD + '.' + K.KEY_AREA + '[0]', 'must be an object')
  const places = requireArray(area, K.KEY_PLACES, K.KEY_WORLD + '.' + K.KEY_AREA + '[0]')
  if (declared !== places.length) {
    const real = K.KEY_WORLD + '.' + K.KEY_AREA + '[0].' + K.KEY_PLACES
    fail(where, 'says ' + declared + ' places but ' + real + ' has ' + places.length)
  }
}

/** 状态.说明 里声明的「N 段：…」必须跟 状态.角色 的键对得上（说明与 schema 不能各说各话） */
function checkStateNote(card: Record<string, unknown>): void {
  const state = requireRecord(card, K.KEY_STATE, '')
  const note = requireText(state, K.KEY_NOTE, K.KEY_STATE)
  const where = at(K.KEY_STATE, K.KEY_NOTE)
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
  const role = requireRecord(state, K.KEY_ROLE, K.KEY_STATE)
  for (const name of names) {
    if (!Object.hasOwn(role, name))
      fail(where, '"' + name + '" is not a key of ' + at(K.KEY_STATE, K.KEY_ROLE))
  }
}

/** 校验一张卡（外部数据）。通不过就抛错，错误信息指到具体路径。 */
export function validateCard(data: unknown): CardData {
  if (!isRecord(data)) fail('', 'must be a JSON object')
  checkTopLevel(data)
  checkMeta(data)
  checkGiven(data)
  const ids = checkNodes(data)
  checkTopology(data, ids)
  checkOpening(data)
  checkSchema(data)
  checkWorld(data)
  checkScript(data)
  checkDisplay(data)
  checkConvention(data, ids)
  checkGeneratorPlaces(data)
  checkStateNote(data)
  return data
}

/** 解析一张卡的 JSON 文本；解析不了或通不过校验都抛错 */
export function parseCard(json: string): CardData {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (error) {
    throw new Error('card: not valid JSON', { cause: error })
  }
  return validateCard(parsed)
}
