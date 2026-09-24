/**
 * src/components/display-blocks.ts —— 卡声明的侧栏条目 → 界面上要画的那几块（决定 #15 / R12 / R13）。
 *
 * 一条声明 = 一枝状态的**路径** + 标题 + 一种**预设格式** + **放哪一侧**。这里不再认识任何块名：
 * `worldBlocks` 照声明把路径解成「要读哪一段状态」，画成什么形状由那一种格式定
 * （WorldPanel：键值 / 列表 / 分组列表），画在左栏还是右栏由 `side` 定（`blocksOfSide`）。
 *
 * 坏声明在这一层已经不可能出现 —— 载入卡的时候就拒掉了（`game/display.ts` 的
 * `checkDisplayBlock`）。所以这里只剩"从状态树现取"：卡是老实的，状态树在变，画的永远是这一局的真相。
 *
 * 模块加载期就解析一次当前卡（currentCard 是静态 import）—— 卡声明的块在应用起来之前就摆好。
 */
import { currentCard } from '../game/current-card'
import {
  atPath,
  displayOf,
  sceneValues,
  type DisplayDecl,
  type DisplayFormat,
  type DisplaySide,
} from '../game/display'
import type { StateTree } from '../game/card-state'

/**
 * 状态浮层那三行（时间 / 场景 / 回合）—— **引擎自己的**：卡不再声明它们（R32 把顶栏并进侧栏）。
 *
 * ⚠️ 名字本身就是渲染键（App 按它决定那一条画什么）⇒ 不另立一张键值全相同的映射表。
 */
export const topbar = ['time', 'scene', 'turn'] as const

/** 状态浮层能画的一行 —— 就是上面那三个名字 */
export type TopbarItem = (typeof topbar)[number]

/** 玩家屏的一栏里的那一块：声明里的四样 + 从状态树现取的那两下 */
export interface WorldBlock {
  /** 声明里的路径 —— 它同时是画出来的 `[data-block]`（排查时一眼看得出这块读的哪一枝） */
  name: string
  /** 声明里的标题（卡里的内容，不是文案键） */
  title: string
  /** 声明里的格式 —— 画成什么形状由它定 */
  format: DisplayFormat
  /** 声明里的哪一侧 —— 它决定这块落在左栏还是右栏 */
  side: DisplaySide
  /** 这一块要画的那一段状态（路径读不到就是 undefined：空枝是合法的，空着画） */
  value: (state: StateTree) => unknown
  /** 「当前所在」的那几个值（按值相等标；卡没声明来源就是空表） */
  current: (state: StateTree) => string[]
}

/** 按声明把每一块解成「读哪一枝 + 画在哪一侧 + 怎么算当前所在」—— 顺序即声明顺序，一块不多一块不少 */
export function worldBlocks(decl: DisplayDecl): WorldBlock[] {
  return decl.sidebar.map((entry) => ({
    name: entry.path,
    title: entry.title,
    format: entry.format,
    side: entry.side,
    value: (state) => atPath(state, entry.path),
    current: (state) => sceneValues(decl, state),
  }))
}

/**
 * 一块表按一侧筛出来 —— **筛**，不是排序、不是复制：保持入参的相对顺序，返回的还是同一批对象。
 *
 * ⚠️ 分栏是 `world` 那张表的**投影**，所以这里没有第二份常量：一个事实一处。
 *    复制一份（左表 / 右表各存一遍）会让"同一块"在两个地方各有一份事实。
 */
export function blocksOfSide(blocks: WorldBlock[], side: DisplaySide): WorldBlock[] {
  return blocks.filter((block) => block.side === side)
}

/** 当前卡声明出来的块 —— 顺序即卡里的顺序（分栏是它的投影，见 `blocksOfSide`） */
export const world: WorldBlock[] = worldBlocks(displayOf(currentCard))
