/**
 * src/game/display.ts —— 卡声明的显示（顶栏条目 / 侧栏块）与界面要读的面板数据。
 *
 * 词汇表（顶栏条目与侧栏块名）是**引擎的**，在 game/card.ts —— 这里只 import，
 * 不抄第二份；卡里出现引擎不认识的块名，校验期（card.ts）就报错。
 *
 * 面板数据读**状态树**（地图 ← world.map + world.location；角色 ← roles；
 * 背包 ← lead.pack），不再读卡里的预设：状态由卡声明，界面画的就是这一局的真相。
 * 「哪一块读哪段状态」也是引擎词汇表的一部分（card.ts 的 BLOCK_STATE_PATHS）。
 *
 * 卡没声明那几段状态时给空值 —— 一张只声明了 pack 面板的卡（cards/night-watch.json）
 * 照样能开，只是地图与角色两块没有内容。这不是兜底，是词汇表允许的声明。
 *
 * 纯函数、不 import Vue：「哪一块由谁渲染」是界面层的事（src/components/display-blocks.ts）。
 */
import {
  ATMOSPHERES,
  BLOCK_STATE_PATHS,
  SIDEBAR_BLOCKS,
  TOPBAR_ITEMS,
  type Atmosphere,
  type CardData,
} from './card'
import { isRecord } from './save'
import type { StateTree } from './card-state'

/** 顶栏与侧栏要摆什么 —— 两个名字列表，顺序即声明顺序 */
export interface DisplayDecl {
  /** 顶栏条目名（时间 / 当前场景 / 回合），顺序即卡里的顺序 */
  topbar: string[]
  /** 侧栏块名（地图 / 角色 / 背包），顺序即卡里的顺序 */
  sidebar: string[]
}

/** 应用画得出来的侧栏块名 —— 卡里写别的名字就只能换一张卡（导入的卡可能来自更新的版本） */
export const KNOWN_BLOCKS = SIDEBAR_BLOCKS

/** 应用画得出来的顶栏条目名 */
export const KNOWN_TOPBAR = TOPBAR_ITEMS

/** 应用点得亮的气氛名 */
export const KNOWN_ATMOSPHERES = ATMOSPHERES

/** 声明.显示：顶栏条目名与侧栏块名，各自保持声明顺序 */
export function displayOf(card: CardData): DisplayDecl {
  return {
    topbar: [...card.display.topbar],
    sidebar: card.display.sidebar.map((block) => block.block),
  }
}

/** 这一局该点哪盏灯；卡没写就用中性墨色 —— 默认值是引擎的，不占卡的声明 */
export function atmosphereOf(card: CardData): Atmosphere {
  return card.display.atmosphere ?? 'ink'
}

/** 判存在性用集合：名字来自卡，是普通字符串，不是字面量类型 */
const BLOCK_SET: ReadonlySet<string> = new Set(KNOWN_BLOCKS)
const TOPBAR_SET: ReadonlySet<string> = new Set(KNOWN_TOPBAR)

/**
 * 显示声明必须是这个应用画得出来的：块名与顶栏名都在词汇表里。
 *
 * 卡的形状已经由 card.ts 守过；这里守的是**这一刻这个应用认不认** ——
 * 认不出来就是「界面上这一块永远不存在」，宁可换一张卡，也不静默少画一块。
 */
export function checkRenderable(decl: DisplayDecl): void {
  decl.sidebar.forEach((name, index) => {
    if (!BLOCK_SET.has(name)) {
      const known = KNOWN_BLOCKS.join(' / ')
      throw new Error(
        'display.sidebar[' +
          index +
          '].block ' +
          JSON.stringify(name) +
          ' has no renderer (known: ' +
          known +
          ')',
      )
    }
  })
  decl.topbar.forEach((name, index) => {
    if (!TOPBAR_SET.has(name)) {
      const known = KNOWN_TOPBAR.join(' / ')
      throw new Error(
        'display.topbar[' + index + '] ' + JSON.stringify(name) + ' has no renderer (known: ' + known + ')',
      )
    }
  })
}

/**
 * 图里某个节点的显示名 —— 状态行写着「正在跑「故事大纲」…」时要用的那一个。
 *
 * ⚠️ 节点 id 是**引擎报出来的**（卡已校验，拓扑里的 id 必然有节点）：读不到就抛错，
 *    不退回 id 假装没事 —— 那种静默兜底只会让状态行显示一串内部 id。
 */
export function nodeLabel(card: CardData, id: string): string {
  const node = card.graph.nodes[id]
  if (node === undefined) throw new Error('card has no "' + id + '" node')
  return node.name
}

// ---------- 面板数据（读状态树） ----------

/** 点号路径 → 状态树里的值；中间缺一段就是 undefined（卡的声明可以没有那一块） */
function atPath(state: StateTree, path: string): unknown {
  let scope: unknown = state
  for (const segment of path.split('.')) {
    if (!isRecord(scope) || !Object.hasOwn(scope, segment)) return undefined
    scope = scope[segment]
  }
  return scope
}

/** 地图块要读的两段状态：区域表 + 当前所在 */
export interface MapView {
  areas: unknown
  location: unknown
}

/** 地图块的数据（world.map + world.location） */
export function mapOf(state: StateTree): MapView {
  return {
    areas: atPath(state, BLOCK_STATE_PATHS.map[0]),
    location: atPath(state, BLOCK_STATE_PATHS.map[1]),
  }
}

/** 角色块的数据（roles 字典） */
export function castOf(state: StateTree): unknown {
  return atPath(state, BLOCK_STATE_PATHS.cast[0])
}

/** 主角角色牌的数据（lead 那一段） */
export function selfOf(state: StateTree): unknown {
  return atPath(state, BLOCK_STATE_PATHS.self[0])
}

/** 行踪块的数据（world.whoIsWhere） */
export function whereOf(state: StateTree): unknown {
  return atPath(state, BLOCK_STATE_PATHS.where[0])
}

/** 故事链块的数据（world.chains） */
export function chainsOf(state: StateTree): unknown {
  return atPath(state, BLOCK_STATE_PATHS.chains[0])
}

/**
 * 主角角色牌要藏起来的字段：另一块已经展示同一段状态。
 *
 * 例：卡同时声明了 self 与 pack，而 pack 读 lead.pack —— 角色牌就把自己的 pack
 * 收起来，让「行囊」那块专门展示，避免同一串东西在面板里出现两遍。
 * 名字从引擎词表（BLOCK_STATE_PATHS）现算，不写死某张卡的字段。
 */
export function selfHiddenFields(decl: DisplayDecl): string[] {
  const selfPath = BLOCK_STATE_PATHS.self[0]
  const prefix = selfPath + '.'
  const hidden = new Set<string>()
  for (const name of decl.sidebar) {
    if (name === 'self' || !Object.hasOwn(BLOCK_STATE_PATHS, name)) continue
    for (const path of BLOCK_STATE_PATHS[name as keyof typeof BLOCK_STATE_PATHS]) {
      if (path.startsWith(prefix)) hidden.add(path.slice(prefix.length))
    }
  }
  return [...hidden]
}

/** 背包块的数据（lead.pack 列表） */
export function packOf(state: StateTree): unknown {
  return atPath(state, BLOCK_STATE_PATHS.pack[0])
}

/** 当前所在：区域 / 地点 / 场景（顶栏「场景」那一条读它） */
export interface Spot {
  area: string
  spot: string
  scene: string
}

/**
 * 顶栏「场景」那一条的数据：world.location 的三段；卡没声明这一段时是三个空串
 * （顶栏可以声明 scene 而状态里没有 world —— 那一条就什么也不显示）。
 */
export function spotOf(state: StateTree): Spot {
  const location = atPath(state, BLOCK_STATE_PATHS.map[1])
  /** 读一段字符串；不是字符串（卡没声明 / 类型不对）就是空串 */
  const text = (key: string): string =>
    isRecord(location) && typeof location[key] === 'string' ? (location[key] as string) : ''
  return { area: text('area'), spot: text('spot'), scene: text('scene') }
}

/**
 * 游戏 HUD 要读的几段状态 —— **只取卡声明过的块**。
 *
 * 卡没声明 `where`，HUD 就不显示行踪；没声明 `chains`，就不显示故事链。
 * 和世界面板同一条纪律：名字来自卡的 `display.sidebar`，代码不替作者决定画什么。
 */
export interface HudData {
  lead: unknown
  cast: unknown
  where: unknown
  chains: unknown
  map: unknown
  location: Spot
  pack: unknown
}

/** 按显示声明挑出 HUD 数据；没声明的块一律 undefined（map 连带 location 空） */
export function hudData(decl: DisplayDecl, state: StateTree): HudData {
  const declared = new Set(decl.sidebar)
  const map = mapOf(state)
  return {
    lead: declared.has('self') ? selfOf(state) : undefined,
    cast: declared.has('cast') ? castOf(state) : undefined,
    where: declared.has('where') ? whereOf(state) : undefined,
    chains: declared.has('chains') ? chainsOf(state) : undefined,
    map: declared.has('map') ? map.areas : undefined,
    location: declared.has('map') ? spotOf(state) : { area: '', spot: '', scene: '' },
    pack: declared.has('pack') ? packOf(state) : undefined,
  }
}
