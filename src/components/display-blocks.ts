/**
 * src/components/display-blocks.ts —— 卡声明的显示条目 → 界面组件的**唯一映射**（决定 #15）。
 *
 * 卡说「顶栏有哪几条、侧栏有哪几块、什么顺序」，这里说「那一条 / 那一块由谁渲染」，
 * 以及**那一块读状态树的哪一段**（game/display.ts 的 mapOf / castOf / packOf：
 * 地图 ← world.map + world.location、角色 ← roles、背包 ← lead.pack）。
 * 卡声明了映射表里没有的名字 = 这一块界面画不出来 —— 这里**启动即失败**：
 * 静默少画一块等于替作者改卡，玩家会以为那块内容本来就不存在。
 *
 * 允许哪些名字由词表（game/card.ts 的 TOPBAR_ITEMS / SIDEBAR_BLOCKS）说了算：
 * 下面两张映射表的键集被它**类型钉死**，词表加了名字却忘了组件，编译期就红。
 * 存着的卡认不出词表时不会走到这里 —— current-card 在解析那张卡时就退回内置示例了。
 *
 * 模块加载期就解析一次当前卡（currentCard 是静态 import），坏声明在应用起来之前就炸；
 * 数据则每次渲染现读（状态树在变，块要画的是这一局的真相）。
 */
import type { Component } from 'vue'
import { currentCard } from '../game/current-card'
import {
  castOf,
  displayOf,
  mapOf,
  packOf,
  KNOWN_BLOCKS,
  KNOWN_TOPBAR,
  type DisplayDecl,
} from '../game/display'
import type { StateTree } from '../game/card-state'
import WorldMap from './world/WorldMap.vue'
import WorldCast from './world/WorldCast.vue'
import WorldPack from './world/WorldPack.vue'

/** 顶栏能显示的条目 —— 卡里的名字由 TOPBAR 映射到它 */
export type TopbarItem = 'time' | 'scene' | 'turn'

/** 世界面板的一块：卡里的块名 + 标题文案键 + 组件 + 它读哪段状态 */
export interface WorldBlock {
  /** 卡声明的块名（用来定位与排查；标题走 title，界面不直接显示它） */
  name: string
  /** 标题的文案键 —— 界面文案一律走 t()，中英各一份 */
  title: string
  /** 渲染这一块的组件 */
  view: Component
  /** 这一块要的 props：读状态树的那一段 */
  props: (state: StateTree) => Record<string, unknown>
}

/** 顶栏条目名 —— 词表里的字面量类型 */
type TopbarName = (typeof KNOWN_TOPBAR)[number]

/** 侧栏块名 —— 词表里的字面量类型 */
type BlockName = (typeof KNOWN_BLOCKS)[number]

/** 侧栏块名 → 组件与它读的状态（块名与路径的对应在 game/display.ts，这里只连组件） */
const BLOCKS: Record<BlockName, Omit<WorldBlock, 'name'>> = {
  map: { title: 'world.map', view: WorldMap, props: (state) => ({ ...mapOf(state) }) },
  cast: { title: 'world.cast', view: WorldCast, props: (state) => ({ cast: castOf(state) }) },
  pack: { title: 'world.pack', view: WorldPack, props: (state) => ({ items: packOf(state) }) },
}

/** 顶栏条目名 → 界面上的哪一个 */
const TOPBAR: Record<TopbarName, TopbarItem> = {
  time: 'time',
  scene: 'scene',
  turn: 'turn',
}

/** 坏名字的报错：说清是哪个名字、应用认识哪些 —— 名字来自卡，是数据不是文案 */
function unknownName(kind: string, name: string, known: object): string {
  return (
    kind + ' ' + JSON.stringify(name) + ' has no renderer (known: ' + Object.keys(known).join(' / ') + ')'
  )
}

/** 按卡声明的顺序把侧栏块名解析成「组件 + 数据来源」；不认识的块名抛错 */
export function worldBlocks(decl: DisplayDecl): WorldBlock[] {
  return decl.sidebar.map((name) => {
    // 名字来自卡，运行时是普通字符串：先按 string 查一次表，认不出来才是坏卡
    const block = Object.hasOwn(BLOCKS, name) ? BLOCKS[name as BlockName] : undefined
    if (!block) throw new Error(unknownName('display block', name, BLOCKS))
    return { name, ...block }
  })
}

/** 按卡声明的顺序把顶栏条目名解析成渲染键；不认识的条目抛错 */
export function topbarItems(decl: DisplayDecl): TopbarItem[] {
  return decl.topbar.map((name) => {
    const item = Object.hasOwn(TOPBAR, name) ? TOPBAR[name as TopbarName] : undefined
    if (!item) throw new Error(unknownName('topbar entry', name, TOPBAR))
    return item
  })
}

/** 当前卡声明出来的世界面板与顶栏 —— 顺序即卡里的顺序 */
export const world: WorldBlock[] = worldBlocks(displayOf(currentCard))
export const topbar: TopbarItem[] = topbarItems(displayOf(currentCard))
