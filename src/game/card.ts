/**
 * src/game/card.ts —— card/4：一张卡的形状、结构校验与引擎词表。
 *
 * 卡是**外部数据**（作者手写、从别人那儿导入），按纪律只有系统边界才做校验，所以卡的校验
 * 集中在这里。**只做结构校验**：键集 / 类型 / 枚举 / 引用完整性 —— 不解析任何一句散文
 * （「说明里有五个地点」这种判断和「引擎解析模型输出」是同一个错误，决定 #46）。
 *
 * ⚠️ 只认 card/4。格式不认识就直接拒 —— 不做字段改名、不做版本迁移。
 *
 * 顶层 12 键（读者三分，字段级成立）：
 *   · 引擎读：card · state · time · actions · graph（id / 拓扑 / role / tools）· display
 *   · 模型读：settings · script · convention · generators · graph.nodes[*].prompt ·
 *             opening.requirements · 每个动作的 what
 *   · 人读：notes · 各处的 note
 *
 * 显示声明（`display`）的形状与校验都在 `game/display.ts` —— 那里说「一条 = 一枝 + 标题 + 一种格式」，
 * 这里只负责在读卡的路上叫它一声：坏声明**载入即失败**（不是启动崩）。
 *
 * 失败一律抛错并带 ASCII 路径（如 state.world.map.晨风镇），绝不静默纠正：在这里
 * 「纠正」等于替作者改卡，下一轮谁也不知道卡里原本写的是什么。
 */

import {
  at,
  checkKeys,
  checkOptionalKeys,
  fail,
  isRecord,
  readTextList,
  requireArray,
  requireRecord,
  requireText,
  requireTextList,
} from './card-read'
import { type Calendar } from './card-calendar'
import { checkTimeBlock } from './card-time'
import { checkSchema, schemaAt, schemaElement, schemaType, type StateSchema, type Schema } from './card-state'
import { checkDisplayBlock, type DisplayDecl } from './display'

// ---------- 通过校验的卡的形状 ----------

/** 元信息：卡的身份（存档认亲 / 导入判重 / 版本迁移锚点） */
export interface CardMeta {
  id: string
  name: string
  version: string
  compat: string
  author: string
  format: 'card/4'
  language: string
  summary: string
}

/** 给模型的五块设定 —— 每个节点都读得到 */
export interface Settings {
  world: string[]
  core: string[]
  common: string[]
  style: string[]
  lead: string[]
}

/** 图里的一个节点：一处的形状 + 提示词；顺序由 topology 定，节点里没有序号 */
export interface GraphNode {
  name: string
  duty: string
  prompt: string[]
  /** 本回合的叙事取这个节点的文字 —— 恰好一个节点声明 */
  role?: 'story'
  /** 这个节点能用哪些动作（不写 = 卡里全部） */
  tools?: string[]
  /** 这个节点看得见哪几个顶层状态分支（不写 = 全部） */
  reads?: string[]
  /** 这个节点要读哪几条生成器（不写 = 不带生成器） */
  uses?: string[]
  /** 这个节点要读哪几块设定（不写 = 五块全发）—— 取值是卡里 settings 的键 */
  settings?: string[]
}

/** 执行图：拓扑（顺序的唯一声明）+ 节点表 */
export interface Graph {
  topology: string[]
  nodes: Record<string, GraphNode>
}

/** 一个动作：写到哪（path + mode + key），或引擎内置效果（effect） */
export interface Action {
  what: string
  path?: string
  effect?: 'time' | 'redo'
  mode?: 'set' | 'merge' | 'push'
  key?: string
}

/** 一条按需生长的原则 */
export interface Generator {
  name: string
  applies: string
  principles: string[]
}

/** 开局事实：能不能起名、默认名、第一轮的要求 */
export interface Opening {
  canName: boolean
  defaultName: string
  requirements: string[]
}

/**
 * 界面怎么摆 —— 侧栏声明（引擎读：一条 = 一枝 + 标题 + 一种格式）加三段散文（给人看，引擎不读）。
 *
 * ⚠️ 显示声明的形状只有一处定义（`game/display.ts`）：这里 extends 它，不另抄一份。
 */
export interface Display extends DisplayDecl {
  layout?: string
  time?: string
  scroll?: string
}

/** 一条短注：一行文字，或一组行 */
export type Note = string | string[]

/** 通过校验的卡 */
export interface CardData {
  card: CardMeta
  settings: Settings
  script: Record<string, unknown>
  convention: string[]
  graph: Graph
  actions: Record<string, Action>
  state: StateSchema
  /** 这张卡的历法 —— 时刻本身声明在 `state.world.time`（R39） */
  time: { calendar: Calendar }
  generators: Generator[]
  opening: Opening
  display: Display
  notes: Record<string, Note>
}

// ---------- 键集与格式 ----------

/** 卡格式版本 —— 别的格式直接拒（这个字段就是干这个的） */
export const CARD_FORMAT = 'card/4'

/** 顶层 12 键，一个不少、一个不多 */
const TOP_LEVEL_KEYS = [
  'card',
  'settings',
  'script',
  'convention',
  'graph',
  'actions',
  'state',
  'time',
  'generators',
  'opening',
  'display',
  'notes',
]

const META_KEYS = ['id', 'name', 'version', 'compat', 'author', 'format', 'language', 'summary']
const SETTING_KEYS = ['world', 'core', 'common', 'style', 'lead']
const NODE_KEYS = ['name', 'duty', 'prompt', 'role', 'tools', 'reads', 'uses', 'settings']
const ACTION_KEYS = ['what', 'path', 'effect', 'mode', 'key']
const GENERATOR_KEYS = ['name', 'applies', 'principles']
const OPENING_KEYS = ['canName', 'defaultName', 'requirements']
const DISPLAY_KEYS = ['layout', 'sidebar', 'time', 'scroll', 'scene']

/** 动作的两种形状各自认的字段 */
const MODES = ['set', 'merge', 'push']
const EFFECTS = ['time', 'redo']

/** 本回合叙事的来源 —— 只有这一个 role */
const ROLE_STORY = 'story'

/** 卡 ID：小写字母 / 数字 / 连字符，中间一个点（作者名.卡名） */
const CARD_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/

/** 卡版本：semver（主.次.修订，后面可跟 -预发布 / +构建） */
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

/** 工具名（进原生的 tools 协议，必须是协议认的形状） */
const ACTION_NAME = /^[a-zA-Z0-9_-]{1,64}$/

// ---------- 顶层 ----------

/** 顶层 12 键一个不少、一个不多（没人读的块多半是写错了名字） */
function checkTopLevel(card: Record<string, unknown>): void {
  for (const key of TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(card, key)) fail('', 'missing top-level key "' + key + '"')
  }
  for (const key of Object.keys(card)) {
    if (!TOP_LEVEL_KEYS.includes(key)) fail('', 'unknown top-level key "' + key + '"')
  }
}

/** 卡的元信息：文本字段非空、格式认识、ID 规范（前缀 = 作者）、版本是 semver */
function checkMeta(card: Record<string, unknown>): void {
  const meta = requireRecord(card, 'card', '')
  checkKeys(meta, META_KEYS, 'card')
  for (const key of META_KEYS) requireText(meta, key, 'card')
  const found = JSON.stringify(meta.format)
  if (meta.format !== CARD_FORMAT) {
    fail('card.format', 'unknown card format ' + found + ' (this engine reads "' + CARD_FORMAT + '")')
  }
  const id = meta.id as string
  if (!CARD_ID.test(id)) {
    fail('card.id', 'must look like "author.card" (lowercase letters, digits, dashes, one dot)')
  }
  if (id.split('.')[0] !== meta.author) fail('card.id', 'its namespace must equal card.author')
  if (!SEMVER.test(meta.version as string)) fail('card.version', 'must be a semver like 1.2.3')
}

/** 设定：五块齐备、每块都是非空的行数组（顺序即声明顺序） */
function checkSettings(card: Record<string, unknown>): void {
  const settings = requireRecord(card, 'settings', '')
  checkKeys(settings, SETTING_KEYS, 'settings')
  for (const key of SETTING_KEYS) requireTextList(settings, key, 'settings')
}

/** 剧本：给模型的隐藏真相，非空的自由对象（结构由作者决定） */
function checkScript(card: Record<string, unknown>): void {
  const script = requireRecord(card, 'script', '')
  if (Object.keys(script).length === 0) fail('script', 'must not be empty')
}

/** 节点约定：非空的行数组 */
function checkConvention(card: Record<string, unknown>): void {
  requireTextList(card, 'convention', '')
}

/** 状态：顶层键就是状态树的分支；每个分支是一份 schema */
function checkState(card: Record<string, unknown>): void {
  const state = requireRecord(card, 'state', '')
  for (const [branch, schema] of Object.entries(state)) checkSchema(schema, at('state', branch))
}

/** 动作：名字是协议名、形状是两种之一、引用完整性（path 存在、mode / key 合法） */
function checkActions(card: Record<string, unknown>): void {
  const actions = requireRecord(card, 'actions', '')
  const state = requireRecord(card, 'state', '') as StateSchema
  for (const [name, value] of Object.entries(actions)) {
    const where = at('actions', name)
    if (!ACTION_NAME.test(name)) {
      fail(where, 'must be a tool name (letters, digits, dashes, underscores; up to 64)')
    }
    if (!isRecord(value)) fail(where, 'must be an object')
    checkOptionalKeys(value, ACTION_KEYS, ['what'], where)
    requireText(value, 'what', where)

    const hasPath = Object.hasOwn(value, 'path')
    const hasEffect = Object.hasOwn(value, 'effect')
    if (hasPath && hasEffect) fail(where, 'must have either path or effect, not both')
    if (!hasPath && !hasEffect) fail(where, 'must have either a path or an effect')

    if (hasEffect) {
      const effect = value.effect
      if (typeof effect !== 'string' || !EFFECTS.includes(effect)) {
        fail(at(where, 'effect'), 'must be one of ' + EFFECTS.join(' / '))
      }
      for (const key of ['mode', 'key']) {
        if (Object.hasOwn(value, key)) fail(at(where, key), 'is only for path actions')
      }
      continue
    }

    const path = requireText(value, 'path', where)
    const target = schemaAt(state, path)
    if (target === undefined) fail(at(where, 'path'), 'does not exist in state')
    checkMode(value, where, target)
    checkKey(value, where, target)
  }
}

/** mode 必须与 path 指向的形状对得上（push 要列表、merge 要对象） */
function checkMode(action: Record<string, unknown>, where: string, target: Schema): void {
  if (!Object.hasOwn(action, 'mode')) return
  const mode = action.mode
  if (typeof mode !== 'string' || !MODES.includes(mode)) {
    fail(at(where, 'mode'), 'must be one of ' + MODES.join(' / '))
  }
  const type = schemaType(target)
  if (mode === 'push' && type !== 'list') {
    fail(at(where, 'mode'), 'push needs a list in state (got ' + type + ')')
  }
  if (mode === 'merge') {
    // 合并一个字符串没有意义：map 的元素也必须是个对象
    const element = type === 'map' ? schemaElement(target) : undefined
    const mergeable = type === 'object' || (element !== undefined && schemaType(element) === 'object')
    if (!mergeable) fail(at(where, 'mode'), 'merge needs an object in state (got ' + type + ')')
  }
}

/** key 只在 path 指向 map 时合法，且 map 必须给 key（不然写哪一条是说不清的） */
function checkKey(action: Record<string, unknown>, where: string, target: Schema): void {
  const type = schemaType(target)
  if (type === 'map') {
    requireText(action, 'key', where)
    return
  }
  if (Object.hasOwn(action, 'key')) fail(at(where, 'key'), 'is only for a map in state (got ' + type + ')')
}

/** 图：拓扑与节点一一对应、节点键集严判、恰好一个 role: "story"、白名单引用都存在 */
function checkGraph(card: Record<string, unknown>): void {
  const graph = requireRecord(card, 'graph', '')
  checkKeys(graph, ['topology', 'nodes'], 'graph')
  const topology = requireTextList(graph, 'topology', 'graph')
  const seen: string[] = []
  topology.forEach((id, index) => {
    if (id.length === 0) fail('graph.topology[' + index + ']', 'must be a non-empty node id')
    if (seen.includes(id)) fail('graph.topology[' + index + ']', 'duplicate node id "' + id + '"')
    seen.push(id)
  })

  const nodes = requireRecord(graph, 'nodes', 'graph')
  for (const id of Object.keys(nodes)) {
    if (!seen.includes(id)) fail(at('graph.nodes', id), 'is not in graph.topology')
  }
  const settings = requireRecord(card, 'settings', '')
  const actions = requireRecord(card, 'actions', '')
  const state = requireRecord(card, 'state', '')
  const generators = requireArray(card, 'generators', '')
  const knownGenerators = generators.filter(isRecord).map((item) => item.name)

  const stories: string[] = []
  const names: string[] = []
  for (const id of topology) {
    const where = at('graph.nodes', id)
    if (!Object.hasOwn(nodes, id)) fail('graph.nodes', 'has no node "' + id + '"')
    const node = nodes[id]
    if (!isRecord(node)) fail(where, 'must be an object')
    checkOptionalKeys(node, NODE_KEYS, ['name', 'duty', 'prompt'], where)
    const name = requireText(node, 'name', where)
    if (names.includes(name)) fail(at(where, 'name'), 'duplicate node name "' + name + '"')
    names.push(name)
    requireText(node, 'duty', where)
    requireTextList(node, 'prompt', where)

    if (Object.hasOwn(node, 'role')) {
      if (node.role !== ROLE_STORY) {
        fail(at(where, 'role'), 'is the only role an engine reads (got ' + JSON.stringify(node.role) + ')')
      }
      stories.push(id)
    }
    checkTools(node, where, actions)
    checkReads(node, where, state)
    checkUses(node, where, knownGenerators)
    checkNodeSettings(node, where, settings)
  }
  if (stories.length !== 1) {
    fail(
      'graph.nodes',
      'exactly one node must declare role "' + ROLE_STORY + '" (found ' + stories.length + ')',
    )
  }
}

/** 节点的 tools 白名单只能引用卡里声明的动作 */
function checkTools(node: Record<string, unknown>, where: string, actions: Record<string, unknown>): void {
  const tools = readTextList(node, 'tools', where)
  if (tools === undefined) return
  tools.forEach((name, index) => {
    if (!Object.hasOwn(actions, name)) {
      fail(at(where, 'tools') + '[' + index + ']', 'is not an action declared in this card')
    }
  })
}

/** 节点的 reads 只能引用状态树的顶层分支 */
function checkReads(node: Record<string, unknown>, where: string, state: Record<string, unknown>): void {
  const reads = readTextList(node, 'reads', where)
  if (reads === undefined) return
  reads.forEach((name, index) => {
    if (!Object.hasOwn(state, name)) {
      fail(at(where, 'reads') + '[' + index + ']', 'is not a top-level branch of state')
    }
  })
}

/** 节点的 uses 只能引用卡里声明的生成器 */
function checkUses(node: Record<string, unknown>, where: string, names: unknown[]): void {
  const uses = readTextList(node, 'uses', where)
  if (uses === undefined) return
  uses.forEach((name, index) => {
    if (!names.includes(name)) {
      fail(at(where, 'uses') + '[' + index + ']', 'is not a generator declared in this card')
    }
  })
}

/** 节点的 settings：不写 = 五块全发；写了必须非空、不重复、且每一块都是卡里声明的设定块 */
function checkNodeSettings(
  node: Record<string, unknown>,
  where: string,
  settings: Record<string, unknown>,
): void {
  const names = readTextList(node, 'settings', where)
  if (names === undefined) return
  const path = at(where, 'settings')
  // 空表是写错了，不是「什么也不给」—— 后者由「不写这个键」表达
  if (names.length === 0) fail(path, 'must not be empty (leave the key out to send every block)')
  const seen: string[] = []
  for (const name of names) {
    // 坏名字要点出来：只报位置的话，「style2」与任何别的错名长得一模一样
    if (!Object.hasOwn(settings, name)) {
      fail(path, JSON.stringify(name) + ' is not a setting block this card declares')
    }
    if (seen.includes(name)) fail(path, 'duplicate setting block "' + name + '"')
    seen.push(name)
  }
}

/** 生成器：名字唯一（uses 按名字引用它）、适用与原则都不能空 */
function checkGenerators(card: Record<string, unknown>): void {
  const generators = requireArray(card, 'generators', '')
  const names: string[] = []
  generators.forEach((value, index) => {
    const where = 'generators[' + index + ']'
    if (!isRecord(value)) fail(where, 'must be an object')
    checkKeys(value, GENERATOR_KEYS, where)
    const name = requireText(value, 'name', where)
    if (names.includes(name)) fail(at(where, 'name'), 'duplicate generator name "' + name + '"')
    names.push(name)
    requireText(value, 'applies', where)
    requireTextList(value, 'principles', where)
  })
}

/** 开局：能不能起名 / 默认名（允许空串 = 由调用方按语言兜底）/ 第一轮的要求 */
function checkOpening(card: Record<string, unknown>): void {
  const opening = requireRecord(card, 'opening', '')
  checkKeys(opening, OPENING_KEYS, 'opening')
  if (typeof opening.canName !== 'boolean') fail('opening.canName', 'must be a boolean')
  if (typeof opening.defaultName !== 'string') {
    fail('opening.defaultName', 'must be a string (an empty one means "no default name")')
  }
  requireTextList(opening, 'requirements', 'opening')
}

/** 显示：三段散文可写可不写，侧栏声明与场景来源交给 display.ts 逐条查（它有卡的 schema 可对） */
function checkDisplay(card: Record<string, unknown>): void {
  const display = requireRecord(card, 'display', '')
  checkOptionalKeys(display, DISPLAY_KEYS, ['sidebar'], 'display')
  for (const key of ['layout', 'time', 'scroll']) {
    if (Object.hasOwn(display, key)) requireText(display, key, 'display')
  }
  checkDisplayBlock(display, requireRecord(card, 'state', '') as StateSchema)
}

/** 短注：键随便起，值必须是非空的一行文字或一组行（空的一节等于告诉人「这块本来就没内容」）*/
function checkNotes(card: Record<string, unknown>): void {
  const notes = requireRecord(card, 'notes', '')
  for (const [key, value] of Object.entries(notes)) {
    const where = at('notes', key)
    if (key.length === 0) fail('notes', 'must not have an empty key')
    if (typeof value === 'string' && value.length > 0) continue
    if (Array.isArray(value) && value.length > 0 && value.every((line) => typeof line === 'string')) continue
    fail(where, 'must be a non-empty string or an array of strings')
  }
}

/** 校验一张卡（外部数据）。通不过就抛错，错误信息指到具体路径。 */
export function validateCard(data: unknown): CardData {
  if (!isRecord(data)) fail('', 'must be a JSON object')
  checkTopLevel(data)
  checkMeta(data)
  checkSettings(data)
  checkScript(data)
  checkConvention(data)
  checkState(data)
  checkTimeBlock(data)
  checkActions(data)
  checkGraph(data)
  checkGenerators(data)
  checkOpening(data)
  checkDisplay(data)
  checkNotes(data)
  return data as unknown as CardData
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
