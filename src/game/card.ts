/**
 * src/game/card.ts —— 一张卡的形状与自洽性
 *
 * 卡是**外部数据**（作者手写、从别人那儿导入），按纪律只有系统边界才做校验，
 * 所以卡的校验集中在这里；将来照图跑的引擎只管「校验通过之后」的行为。
 *
 * ⚠️ 只认 card/2。格式不认识就直接拒 —— 不做字段改名、不做版本迁移：
 *    产品未发布，没有旧卡要兼容。
 *
 * 顶层按「谁读」分三块：声明（引擎读）、提示词（模型读）、说明（人读）。
 * 执行顺序只由「声明.图.拓扑」声明一次 —— 节点里没有序号，也不看数组顺序。
 *
 * 校验分两种，两种都必须能**证伪**：
 *   · 形状 —— 字段在不在、类型对不对；
 *   · 自洽 —— 卡里两处各自声明的东西必须互相对得上：「N 个地点」跟地点数、
 *     「N 块设定」跟提示词.设定的块数、说明里的段名跟 schema 的键。
 *   只判存在性的检查抓不到自相矛盾的卡，所以第二组才是重点。
 *
 * 失败一律抛错并带 JSON 路径（如「声明.图.节点.psych.序号」），绝不静默纠正：在这里「纠正」
 * 等于替作者改卡，下一轮谁也不知道卡里原本写的是什么。
 */

import { isRecord } from './save'
/** 卡格式的键名与标点 —— 源码必须 ASCII，转义都收在 card-keys 里 */
import * as K from './card-keys'
import {
  at,
  fail,
  requireRecord,
  requireArray,
  requireText,
  requireTextList,
  checkKeys,
  chineseNumber,
} from './card-read'
import { checkSettingCount, checkStateNote } from './card-notes'

/** 通过校验的卡数据：顶层 4 键都在，各块按卡格式解释 */
export type CardData = Record<string, unknown>

/** 卡格式版本 —— 「卡.格式」不是它就直接拒（这个字段就是干这个的） */
const CARD_FORMAT = 'card/2'

/** 卡 ID：小写字母 / 数字 / 连字符，中间一个点（作者名.卡名） */
const CARD_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/

/** 卡版本：semver（主.次.修订，后面可跟 -预发布 / +构建） */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** 卡里的起始时刻写法：YYYY-MM-DDTHH:mm（本地时刻，不带时区 —— 决定 #42） */
const START_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

/** 引擎认识的历法 —— 日期算法按它选 */
const CALENDARS = new Set(['real'])

/** 数值字段的类型标记（schema 里「类型」的值） */
const TYPE_NUMBER = 'number'

/** 声明必须齐备的六个键 —— 顺序不限，顺序由拓扑说了算 */
const DECLARATION_KEYS = [
  K.KEY_GRAPH,
  K.KEY_STATE,
  K.KEY_WORLD,
  K.KEY_GENERATORS,
  K.KEY_OPENING,
  K.KEY_DISPLAY,
]

/** 提示词必须齐备的五个键 */
const PROMPT_KEYS = [K.KEY_SETTING, K.KEY_SCRIPT, K.KEY_CONVENTION, K.KEY_NODES, K.KEY_OPENING_REQUIREMENTS]

/** 说明必须齐备的三块 */
const NOTE_KEYS = [K.KEY_STATE, K.KEY_SCRIPT, K.KEY_OPENING]

/** 图里的节点只有这三个键 —— 位置由拓扑定，没有 id，也没有序号 */
const NODE_KEYS = [K.KEY_NODE_NAME, K.KEY_DUTY, K.KEY_OUTPUT]

/** 开局块的四个键 —— 引擎读哪几个，这里就守哪几个（决定 #42） */
const OPENING_KEYS = [K.KEY_START_TIME, K.KEY_START, K.KEY_CAN_NAME, K.KEY_DEFAULT_NAME]

/** 顶层 4 键：一个不少、都是对象，且没有不认识的键（没人读的块多半是写错了名字） */
function checkTopLevel(card: Record<string, unknown>): void {
  for (const key of K.TOP_LEVEL_KEYS) {
    const value = card[key]
    if (value === undefined) fail('', 'missing top-level key "' + key + '"')
    if (!isRecord(value)) fail('', '"' + key + '" must be an object')
  }
  for (const key of Object.keys(card)) {
    if (!K.TOP_LEVEL_KEYS.includes(key)) fail('', 'unknown top-level key "' + key + '"')
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

/** 顶层三块内部的键集必须齐备 —— 声明 6 个、提示词 5 个、说明 3 个 */
function checkBlocks(card: Record<string, unknown>): void {
  checkKeys(requireRecord(card, K.KEY_DECL, ''), DECLARATION_KEYS, K.KEY_DECL)
  checkKeys(requireRecord(card, K.KEY_PROMPT, ''), PROMPT_KEYS, K.KEY_PROMPT)
  checkKeys(requireRecord(card, K.KEY_NOTES, ''), NOTE_KEYS, K.KEY_NOTES)
}

/** 提示词.设定：五块、顺序固定、每块都是非空的行数组 */
function checkSetting(card: Record<string, unknown>): void {
  const prompts = requireRecord(card, K.KEY_PROMPT, '')
  const setting = requireRecord(prompts, K.KEY_SETTING, K.KEY_PROMPT)
  const base = at(K.KEY_PROMPT, K.KEY_SETTING)
  const keys = Object.keys(setting)
  if (keys.length !== K.SETTING_BLOCKS.length) {
    fail(base, 'must have exactly ' + K.SETTING_BLOCKS.length + ' blocks, got ' + keys.length)
  }
  K.SETTING_BLOCKS.forEach((block, index) => {
    if (keys[index] !== block) fail(base, 'block #' + (index + 1) + ' must be "' + block + '"')
    requireTextList(setting, block, base)
  })
}

/** 说明：三块人读的说明都非空 —— 空说明等于没写 */
function checkNotes(card: Record<string, unknown>): void {
  const notes = requireRecord(card, K.KEY_NOTES, '')
  for (const key of NOTE_KEYS) requireText(notes, key, K.KEY_NOTES)
}

/** 图：拓扑里每个 id 恰好一次，节点对象的键集正好是拓扑，每个节点只有三个键 */
function checkGraph(card: Record<string, unknown>): string[] {
  const decl = requireRecord(card, K.KEY_DECL, '')
  const graph = requireRecord(decl, K.KEY_GRAPH, K.KEY_DECL)
  const base = at(K.KEY_DECL, K.KEY_GRAPH)
  const topology = requireArray(graph, K.KEY_TOPOLOGY, base)
  if (topology.length === 0) fail(at(base, K.KEY_TOPOLOGY), 'must have at least one node')
  const ids: string[] = []
  topology.forEach((id, index) => {
    const where = at(base, K.KEY_TOPOLOGY) + '[' + index + ']'
    if (typeof id !== 'string' || id.length === 0) fail(where, 'must be a non-empty node id')
    if (ids.includes(id)) fail(where, 'duplicate node id "' + id + '"')
    ids.push(id)
  })
  const nodes = requireRecord(graph, K.KEY_NODES, base)
  const nodeBase = at(base, K.KEY_NODES)
  for (const id of Object.keys(nodes)) {
    if (!ids.includes(id)) fail(at(nodeBase, id), 'is not in ' + at(base, K.KEY_TOPOLOGY))
  }
  const names: string[] = []
  for (const id of ids) {
    const where = at(nodeBase, id)
    if (!Object.hasOwn(nodes, id)) fail(nodeBase, 'has no node "' + id + '"')
    const node = nodes[id]
    if (!isRecord(node)) fail(where, 'must be an object')
    checkKeys(node, NODE_KEYS, where)
    const name = requireText(node, K.KEY_NODE_NAME, where)
    requireText(node, K.KEY_DUTY, where)
    const output = requireRecord(node, K.KEY_OUTPUT, where)
    if (Object.keys(output).length === 0) fail(at(where, K.KEY_OUTPUT), 'must not be empty')
    if (names.includes(name)) fail(at(where, K.KEY_NODE_NAME), 'duplicate node name "' + name + '"')
    names.push(name)
  }
  return ids
}

/** 提示词.节点：键集必须正好是拓扑，每个值是非空的行数组 */
function checkNodePrompts(card: Record<string, unknown>, ids: string[]): void {
  const prompts = requireRecord(card, K.KEY_PROMPT, '')
  const nodes = requireRecord(prompts, K.KEY_NODES, K.KEY_PROMPT)
  const base = at(K.KEY_PROMPT, K.KEY_NODES)
  const topology = at(at(K.KEY_DECL, K.KEY_GRAPH), K.KEY_TOPOLOGY)
  for (const id of Object.keys(nodes)) {
    if (!ids.includes(id)) fail(at(base, id), 'is not a node in ' + topology)
  }
  for (const id of ids) {
    if (!Object.hasOwn(nodes, id)) fail(base, 'has no prompts for node "' + id + '"')
    requireTextList(nodes, id, base)
  }
}

/**
 * 声明.开局：四样事实齐备、类型对得上，初始位置的键集正好是 {区域, 地点, 场景}。
 *
 * 起始时刻只收具体时刻 —— 「now」那种写法（设计里记过）没有消费者，先不开这个口子。
 */
function checkOpening(card: Record<string, unknown>): void {
  const decl = requireRecord(card, K.KEY_DECL, '')
  const opening = requireRecord(decl, K.KEY_OPENING, K.KEY_DECL)
  const base = at(K.KEY_DECL, K.KEY_OPENING)
  checkKeys(opening, OPENING_KEYS, base)
  const written = requireText(opening, K.KEY_START_TIME, base)
  if (!START_TIME.test(written)) fail(at(base, K.KEY_START_TIME), 'must look like 2026-09-14T19:30')
  const start = requireRecord(opening, K.KEY_START, base)
  const wanted = [K.KEY_AREA, K.KEY_PLACE, K.KEY_SCENE].sort().join(' ')
  if (Object.keys(start).sort().join(' ') !== wanted) {
    const keys = K.KEY_AREA + ' / ' + K.KEY_PLACE + ' / ' + K.KEY_SCENE
    fail(at(base, K.KEY_START), 'keys must be exactly ' + keys)
  }
  if (typeof opening[K.KEY_CAN_NAME] !== 'boolean') fail(at(base, K.KEY_CAN_NAME), 'must be a boolean')
  // 默认名允许空串：空串 = 卡没给名字，由调用方退回 i18n 兜底（决定 #42）
  if (typeof opening[K.KEY_DEFAULT_NAME] !== 'string') {
    fail(at(base, K.KEY_DEFAULT_NAME), 'must be a string (an empty one means "no default name")')
  }
}

/** 状态 schema：数值项是 {类型:number,初值:number,范围:[min,max]} 且初值落在范围内；层级初值属于取值 */
function checkSchema(card: Record<string, unknown>): void {
  const decl = requireRecord(card, K.KEY_DECL, '')
  const state = requireRecord(decl, K.KEY_STATE, K.KEY_DECL)
  const stateBase = at(K.KEY_DECL, K.KEY_STATE)
  const role = requireRecord(state, K.KEY_ROLE, stateBase)
  const roleBase = at(stateBase, K.KEY_ROLE)
  const inherent = requireRecord(role, K.KEY_INHERENT, roleBase)
  for (const [field, spec] of Object.entries(inherent)) {
    const where = at(roleBase, K.KEY_INHERENT) + '.' + field
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
  const tier = requireRecord(role, K.KEY_TIER, roleBase)
  const values = tier[K.KEY_VALUES]
  if (!Array.isArray(values) || !values.includes(tier[K.KEY_INITIAL])) {
    fail(at(roleBase, K.KEY_TIER) + '.' + K.KEY_VALUES, 'must list the initial value')
  }
  const player = requireRecord(state, K.KEY_PLAYER, stateBase)
  const playerBase = at(stateBase, K.KEY_PLAYER)
  requireRecord(player, K.KEY_PROFILE, playerBase)
  requireArray(player, K.KEY_PROFILE_INITIAL, playerBase)
}

/** 声明.世界.历法：引擎只认识自己实现过的历法 */
function checkWorld(card: Record<string, unknown>): void {
  const decl = requireRecord(card, K.KEY_DECL, '')
  const world = requireRecord(decl, K.KEY_WORLD, K.KEY_DECL)
  const base = at(K.KEY_DECL, K.KEY_WORLD)
  if (!CALENDARS.has(world[K.KEY_CALENDAR] as string)) {
    fail(at(base, K.KEY_CALENDAR), 'unknown calendar ' + JSON.stringify(world[K.KEY_CALENDAR]))
  }
}

/** 提示词.剧本：非空，阶段号从 1 起、连续（跳号就等于有一段永远演不到） */
function checkScript(card: Record<string, unknown>): void {
  const prompts = requireRecord(card, K.KEY_PROMPT, '')
  const script = requireRecord(prompts, K.KEY_SCRIPT, K.KEY_PROMPT)
  const base = at(K.KEY_PROMPT, K.KEY_SCRIPT)
  if (Object.keys(script).length === 0) fail(base, 'must not be empty')
  const stages = requireArray(script, K.KEY_STAGES, base)
  stages.forEach((stage, index) => {
    const where = base + '.' + K.KEY_STAGES + '[' + index + ']'
    if (!isRecord(stage)) fail(where, 'must be an object')
    if (stage[K.KEY_STAGES] !== index + 1) fail(at(where, K.KEY_STAGES), 'must be ' + (index + 1))
  })
}

/** 提示词.开局要求：非空的行数组 —— 第一轮该怎么开场，不能空着 */
function checkOpeningRequirements(card: Record<string, unknown>): void {
  const prompts = requireRecord(card, K.KEY_PROMPT, '')
  requireTextList(prompts, K.KEY_OPENING_REQUIREMENTS, K.KEY_PROMPT)
}

/** 声明.显示.侧栏：区块名唯一（同一个块挂两次，界面就不知道该信哪个） */
function checkDisplay(card: Record<string, unknown>): void {
  const decl = requireRecord(card, K.KEY_DECL, '')
  const display = requireRecord(decl, K.KEY_DISPLAY, K.KEY_DECL)
  const base = at(K.KEY_DECL, K.KEY_DISPLAY)
  const sidebar = requireArray(display, K.KEY_SIDEBAR, base)
  const blocks: string[] = []
  sidebar.forEach((block, index) => {
    const where = base + '.' + K.KEY_SIDEBAR + '[' + index + ']'
    if (!isRecord(block)) fail(where, 'must be an object')
    const name = requireText(block, K.KEY_BLOCK, where)
    if (blocks.includes(name)) fail(at(where, K.KEY_BLOCK), 'duplicate block "' + name + '"')
    blocks.push(name)
  })
}

/** 提示词.节点约定：非空的行数组，写死的「N 块设定」必须跟 提示词.设定 对得上 */
function checkConvention(card: Record<string, unknown>): void {
  const prompts = requireRecord(card, K.KEY_PROMPT, '')
  const lines = requireTextList(prompts, K.KEY_CONVENTION, K.KEY_PROMPT)
  const setting = requireRecord(prompts, K.KEY_SETTING, K.KEY_PROMPT)
  checkSettingCount(lines, Object.keys(setting).length, at(K.KEY_PROMPT, K.KEY_CONVENTION))
}

/** 生成器第一条原则里写的「N 个地点」必须等于第一个区域的必有地点数 —— 两处声明互证 */
function checkGeneratorPlaces(card: Record<string, unknown>): void {
  const decl = requireRecord(card, K.KEY_DECL, '')
  const generators = requireArray(decl, K.KEY_GENERATORS, K.KEY_DECL)
  const base = at(K.KEY_DECL, K.KEY_GENERATORS)
  const first = generators[0]
  if (!isRecord(first)) fail(base + '[0]', 'must be an object')
  const principles = requireTextList(first, K.KEY_PRINCIPLE, base + '[0]')
  const declared = chineseNumber(principles[0])
  const where = base + '[0].' + K.KEY_PRINCIPLE + '[0]'
  if (declared === null) fail(where, 'no chinese numeral to check the place count against')
  const world = requireRecord(decl, K.KEY_WORLD, K.KEY_DECL)
  const worldBase = at(K.KEY_DECL, K.KEY_WORLD)
  const areas = requireArray(world, K.KEY_AREA, worldBase)
  const area = areas[0]
  if (!isRecord(area)) fail(worldBase + '.' + K.KEY_AREA + '[0]', 'must be an object')
  const places = requireArray(area, K.KEY_PLACES, worldBase + '.' + K.KEY_AREA + '[0]')
  if (declared !== places.length) {
    const real = worldBase + '.' + K.KEY_AREA + '[0].' + K.KEY_PLACES
    fail(where, 'says ' + declared + ' places but ' + real + ' has ' + places.length)
  }
}

/** 校验一张卡（外部数据）。通不过就抛错，错误信息指到具体路径。 */
export function validateCard(data: unknown): CardData {
  if (!isRecord(data)) fail('', 'must be a JSON object')
  checkTopLevel(data)
  checkMeta(data)
  checkBlocks(data)
  checkSetting(data)
  const ids = checkGraph(data)
  checkNodePrompts(data, ids)
  checkOpening(data)
  checkSchema(data)
  checkWorld(data)
  checkScript(data)
  checkOpeningRequirements(data)
  checkDisplay(data)
  checkNotes(data)
  checkConvention(data)
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
