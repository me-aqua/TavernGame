/**
 * src/game/display.ts —— 读卡里的「显示 / 世界 / 主控初始」声明，翻译成界面要的数据（决定 #15）。
 *
 * 纯函数、不 import Vue：「哪一块由谁渲染」是界面层的事（src/components/display-blocks.ts），
 * 这里只把卡里的字段搬成界面好用的形状；读不出来就抛错并带上 JSON 路径，不做静默兜底。
 *
 * 当前位置由**两个事实**合起来定：卡的开局位置（决定 #42）与运行时状态里的场景名
 * （引擎每轮更新它）—— 场景名里认得出哪个区域 / 地点就用哪个，认不出才退回开局位置。
 *
 * ⚠️ 卡校验器（card.ts）只读过这些字段的一部分，所以这里对没被守过的字段逐个严读；
 *    已经守过的（侧栏的块名与唯一性、区域是个非空数组）不再重判一遍。
 */
import type { CardData } from './card'
import * as K from './card-keys'
import { at, fail, requireRecord, requireText } from './card-read'
import { isRecord } from './save'

/** 顶栏与侧栏要摆什么 —— 两个名字列表，顺序即声明顺序 */
export interface DisplayDecl {
  /** 顶栏条目名（时间 / 当前场景 / 回合） */
  topbar: string[]
  /** 侧栏块名（地图 / 角色 / 背包） */
  sidebar: string[]
}

/** 地图上的一块区域：名字 + 作者点名的「必有地点」（可以为空：地点由生成器长出来） */
export interface AreaView {
  name: string
  places: string[]
}

/** 作者点名的 NPC：姓名 / 身份 / 种族 / 一句设定 */
export interface CastView {
  name: string
  role: string
  race: string
  bio: string
}

/** 背包里的一件东西：没写数量就是一件，没写备注就没有 */
export interface PackView {
  name: string
  count?: number
  note?: string
}

/** 当前所在：区域 + 地点（地点为空 = 只认得出区域） */
export interface Spot {
  area: string
  place: string
}

/** 读数组里的一项，必须是对象 */
function recordAt(value: unknown, where: string): Record<string, unknown> {
  if (!isRecord(value)) fail(where, 'must be an object')
  return value
}

/** 读一个字符串列表（允许为空：一个地点都还没长的区域照样能显示） */
function textsAt(value: unknown, where: string): string[] {
  if (!Array.isArray(value)) fail(where, 'must be an array')
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.length === 0)
      fail(where + '[' + index + ']', 'must be a non-empty string')
    return item
  })
}

/** 读一个可选的字符串列表：没写就是空 —— 区域可以不长固定地点（地牢就是靠生成器长的） */
function optionalTexts(item: Record<string, unknown>, key: string, where: string): string[] {
  if (!Object.hasOwn(item, key)) return []
  return textsAt(item[key], at(where, key))
}

/** 读一个可选字段：不在就是 undefined，在就必须是对的类型（写错了要出声） */
function optionalNumber(item: Record<string, unknown>, key: string, where: string): number | undefined {
  if (!Object.hasOwn(item, key)) return undefined
  const value = item[key]
  if (typeof value !== 'number') fail(at(where, key), 'must be a number')
  return value
}

/** 读一个可选的文本字段：不在就是 undefined，在就不能是空串 */
function optionalText(item: Record<string, unknown>, key: string, where: string): string | undefined {
  if (!Object.hasOwn(item, key)) return undefined
  return requireText(item, key, where)
}

/** 声明.世界（历法 / 区域 / 点名的 NPC） */
function worldOf(card: CardData): Record<string, unknown> {
  return requireRecord(requireRecord(card, K.KEY_DECL, ''), K.KEY_WORLD, K.KEY_DECL)
}

/** 声明.状态.主控初始 */
function playerStartOf(card: CardData): Record<string, unknown> {
  const base = at(K.KEY_DECL, K.KEY_STATE)
  const state = requireRecord(requireRecord(card, K.KEY_DECL, ''), K.KEY_STATE, K.KEY_DECL)
  return requireRecord(state, K.KEY_PLAYER_START, base)
}

/**
 * 声明.显示：顶栏条目名与侧栏块名，各自保持声明顺序。
 *
 * ⚠️ 「顶栏」卡校验器没有守（它只查侧栏），所以 topbarNames 是唯一读它的地方：
 *    在那里严判一次，坏声明启动即失败。
 */
export function displayOf(card: CardData): DisplayDecl {
  const display = requireRecord(requireRecord(card, K.KEY_DECL, ''), K.KEY_DISPLAY, K.KEY_DECL)
  return { topbar: topbarNames(display), sidebar: sidebarNames(display) }
}

/** 顶栏条目名：非空、不重复，顺序照声明 */
function topbarNames(display: Record<string, unknown>): string[] {
  const where = at(at(K.KEY_DECL, K.KEY_DISPLAY), K.KEY_TOPBAR)
  const items = display[K.KEY_TOPBAR]
  if (!Array.isArray(items) || items.length === 0) fail(where, 'must be a non-empty array')
  return items.map((item, index) => {
    if (typeof item !== 'string' || item.length === 0)
      fail(where + '[' + index + ']', 'must be a non-empty string')
    if (items.indexOf(item) !== index)
      fail(where + '[' + index + ']', 'duplicate entry ' + JSON.stringify(item))
    return item
  })
}

/** 侧栏块名：块名与唯一性由卡校验器守（card.ts 的 checkDisplay），这里照着读 */
function sidebarNames(display: Record<string, unknown>): string[] {
  const blocks = display[K.KEY_SIDEBAR] as Array<Record<string, string>>
  return blocks.map((block) => block[K.KEY_BLOCK])
}

/**
 * 图里某个节点的显示名 —— 状态行写着「正在跑「故事大纲」…」时要用的那一个。
 *
 * ⚠️ 节点 id 是**引擎报出来的**（卡已校验，拓扑里的 id 必然有节点）：读不到就抛错，
 *    不退回 id 假装没事 —— 那种静默兜底只会让状态行显示一串内部 id。
 */
export function nodeLabel(card: CardData, id: string): string {
  const nodes = requireRecord(
    requireRecord(requireRecord(card, K.KEY_DECL, ''), K.KEY_GRAPH, K.KEY_DECL),
    K.KEY_NODES,
    at(K.KEY_DECL, K.KEY_GRAPH),
  )
  const where = at(at(K.KEY_DECL, K.KEY_GRAPH), K.KEY_NODES) + '.' + id
  return requireText(
    requireRecord(nodes, id, at(at(K.KEY_DECL, K.KEY_GRAPH), K.KEY_NODES)),
    K.KEY_NODE_NAME,
    where,
  )
}

/** 声明.世界.区域：每个区域带上它的「必有地点」 */
export function areasOf(card: CardData): AreaView[] {
  const base = at(K.KEY_DECL, K.KEY_WORLD)
  const areas = worldOf(card)[K.KEY_AREA] as unknown[]
  return areas.map((value, index) => {
    const where = base + '.' + K.KEY_AREA + '[' + index + ']'
    const area = recordAt(value, where)
    return {
      name: requireText(area, K.KEY_NODE_NAME, where),
      places: optionalTexts(area, K.KEY_PLACES, where),
    }
  })
}

/** 声明.世界.点名的NPC：姓名 / 身份 / 种族 / 一句设定（生平与性格是给模型的，界面不显示） */
export function castOf(card: CardData): CastView[] {
  const base = at(K.KEY_DECL, K.KEY_WORLD)
  const where = at(base, K.KEY_NAMED_NPCS)
  const cast = worldOf(card)[K.KEY_NAMED_NPCS]
  if (!Array.isArray(cast)) fail(where, 'must be an array')
  return cast.map((value, index) => {
    const personBase = where + '[' + index + ']'
    const person = recordAt(value, personBase)
    return {
      name: requireText(person, K.KEY_NODE_NAME, personBase),
      role: requireText(person, K.KEY_IDENTITY, personBase),
      race: requireText(person, K.KEY_RACE, personBase),
      bio: requireText(person, K.KEY_SETTING, personBase),
    }
  })
}

/** 声明.状态.主控初始.携带.背包：名称 / 数量 / 备注 */
export function packOf(card: CardData): PackView[] {
  const startBase = at(at(K.KEY_DECL, K.KEY_STATE), K.KEY_PLAYER_START)
  const carry = requireRecord(playerStartOf(card), K.KEY_CARRY, startBase)
  const where = at(at(startBase, K.KEY_CARRY), K.KEY_PACK)
  const items = carry[K.KEY_PACK]
  if (!Array.isArray(items)) fail(where, 'must be an array')
  return items.map((value, index) => {
    const itemBase = where + '[' + index + ']'
    const item = recordAt(value, itemBase)
    return {
      name: requireText(item, K.KEY_NAME, itemBase),
      count: optionalNumber(item, K.KEY_COUNT, itemBase),
      note: optionalText(item, K.KEY_REMARK, itemBase),
    }
  })
}

/** 卡的开局位置 —— 场景名里认不出任何区域 / 地点时的兜底（决定 #42） */
function openingSpot(card: CardData): Spot {
  const opening = requireRecord(requireRecord(card, K.KEY_DECL, ''), K.KEY_OPENING, K.KEY_DECL)
  const base = at(at(K.KEY_DECL, K.KEY_OPENING), K.KEY_START)
  const start = requireRecord(opening, K.KEY_START, at(K.KEY_DECL, K.KEY_OPENING))
  return { area: requireText(start, K.KEY_AREA, base), place: requireText(start, K.KEY_PLACE, base) }
}

/**
 * 当前所在的区域与地点。
 *
 * 场景名（运行时状态里的那个）里出现谁的名字就算在谁那儿：地点比区域具体，先认地点；
 * 一个名字是另一个的前缀时取最长的（「镇口」与「镇口码头」）。都认不出就退回开局位置。
 */
export function spotOf(card: CardData, sceneName: string): Spot {
  const areas = areasOf(card)
  const named = areas
    .flatMap((area) => area.places.map((place) => ({ area: area.name, place })))
    .filter((candidate) => sceneName.includes(candidate.place))
    .sort((a, b) => b.place.length - a.place.length)[0]
  if (named) return named
  const area = areas.find((entry) => sceneName.includes(entry.name))
  if (area) return { area: area.name, place: '' }
  return openingSpot(card)
}
