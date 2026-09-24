/**
 * src/game/display.ts —— 卡声明的显示：**一条侧栏声明 = 一枝状态的路径 + 标题 + 一种预设格式 + 放哪一侧**（R12/R13/R14）。
 *
 * 这一层分两半：
 *   · **声明侧**：`display.sidebar[]` 每一条点名"一枝 + 标题 + 格式 + 哪一侧"；格式同时约束
 *     **渲染**与**数据形状**，哪一侧决定它画在玩家屏的哪一栏 ⇒ 载入卡时校验，
 *     不符**启动即失败**（R14）—— 坏声明不许静默少画一块（静默少画等于替作者改卡，
 *     玩家会以为那块内容本来就不存在）。
 *   · **数据侧**：按声明里的路径从**状态树**取那一段（`atPath`），以及「当前所在」那一行的值
 *     （`sceneValues`）。引擎不认识任何一枝的名字，也不认识任何字段名（R13）。
 *
 * ⚠️ **引擎里不再有块名词表**：`map` / `cast` / `pack` 这些名字与"哪块读哪枝"的表都删了 ——
 *    声明只此一处（卡里那份），换一张卡不用改引擎（R12 的收益）。
 *    哪些路径是**引擎点名的**（键名保持 ASCII、不许作者改名）归别处管：`world.time` 见 `card-time.ts`，
 *    `world.map` / `roles` / `lead.pack` 见 `tests/card-keys-cn.test.ts` 的保留名单。
 * ⚠️ 纯函数、不 import Vue（只借 `card-read` 那份 isRecord）。
 */
import { at, checkKeys, fail, isRecord, requireArray, requireText } from './card-read'
import {
  schemaAt,
  schemaType,
  textValuesOf,
  type Schema,
  type StateSchema,
  type StateTree,
} from './card-state'
import type { CardData } from './card'

/** 三种**预设格式**的名字 —— 引擎词表，保持 ASCII（界面上的中文标签走 i18n） */
export const DISPLAY_FORMATS = ['key-value', 'list', 'grouped'] as const

export type DisplayFormat = (typeof DISPLAY_FORMATS)[number]

/**
 * 一块画在哪一侧 —— **只有这两个**（决定 #59）。
 *
 * ⚠️ 大小写敏感：写 `Left` 就是坏声明（载入即失败），不在这里顺手 `toLowerCase()` ——
 *    引擎替作者猜一个值，等于替作者改卡。
 */
export const DISPLAY_SIDES = ['left', 'right'] as const

export type DisplaySide = (typeof DISPLAY_SIDES)[number]

/**
 * 格式 → 它要求那一枝是什么容器。
 *
 * 容器名是**卡自己的 schema 词表**（`SchemaType`）：格式是形状的契约，不是内容的约定 ——
 * 一张卡新长一枝、随手挑一种格式，引擎一个字都不用改。
 */
const FORMAT_CONTAINER: Record<DisplayFormat, string> = {
  'key-value': 'object',
  list: 'list',
  grouped: 'map',
}

/** 一条侧栏声明：恰好四样（路径 / 标题 / 格式 / 放哪一侧），多一个键就是坏声明 */
export interface DisplayEntry {
  path: string
  title: string
  format: DisplayFormat
  /** 画在左栏还是右栏 —— 必填：界面不许替作者挑一边 */
  side: DisplaySide
}

/** 「当前所在」那一行的来源：册子（map）的路径 + 主控名字那一格（标量）的路径 */
export interface SceneDecl {
  path: string
  who: string
}

/** 卡声明的显示：侧栏条目（顺序即画出来的顺序）+ 可选的场景来源 */
export interface DisplayDecl {
  sidebar: DisplayEntry[]
  scene?: SceneDecl
}

/** 一条侧栏声明的键集（多一个少一个都拒） */
const ENTRY_KEYS = ['path', 'title', 'format', 'side']

/** 场景来源的键集 */
const SCENE_KEYS = ['path', 'who']

/** 一条声明里"画得出来"的四个条件：路径在、格式认识、格式与容器相符、放哪一侧认识 */
function checkEntry(entry: unknown, index: number, state: StateSchema, seen: Set<string>): void {
  const where = 'display.sidebar[' + index + ']'
  if (!isRecord(entry)) fail(where, 'must be an object {path, title, format, side}')
  checkKeys(entry, ENTRY_KEYS, where)
  requireText(entry, 'title', where)
  const format = requireText(entry, 'format', where)
  // 放哪一侧：先于路径那条 —— 取值错了就不该再拿它去读状态（与 format 同一条纪律）
  const side = requireText(entry, 'side', where)
  if (!(DISPLAY_SIDES as readonly string[]).includes(side)) {
    fail(
      at(where, 'side'),
      JSON.stringify(side) + ' is not a side (known: ' + DISPLAY_SIDES.join(' / ') + ')',
    )
  }
  const path = requireText(entry, 'path', where)

  // ① 格式在词表里（不认识的格式 ⇒ 那一块永远画不出来，点名拒掉）
  if (!(DISPLAY_FORMATS as readonly string[]).includes(format)) {
    fail(
      at(where, 'format'),
      JSON.stringify(format) + ' is no preset format (known: ' + DISPLAY_FORMATS.join(' / ') + ')',
    )
  }
  const wanted = FORMAT_CONTAINER[format as DisplayFormat]

  // ② 路径在卡的 schema 里（这条路径是画的时候唯一要读的东西）
  const target: Schema | undefined = schemaAt(state, path)
  if (target === undefined) {
    fail(at(where, 'path'), JSON.stringify(path) + ' does not exist in state')
  }

  // ③ 格式与容器相符 —— **认识的**格式才比形状。这一处**不接**"格式认不认识"那个责：
  //    它也顺手拒的话，两种拒绝的报错都会带上那个格式名，于是判据 7（未知格式被点名拒掉）
  //    会分不清是谁拒的 —— 把上面那道词表检查整个拿掉，它照样绿。
  //    ⇒ 这一道 `includes` 是**约束**，不是兜底：词表检查在跑时它恒为真（那一条路走不到），
  //      词表检查一旦被拿掉，未知格式就会**被收下**，判据 7 当场红。
  const container = schemaType(target)
  if ((DISPLAY_FORMATS as readonly string[]).includes(format) && container !== wanted) {
    fail(
      at(where, 'path'),
      JSON.stringify(path) +
        ' is a ' +
        container +
        ', which format ' +
        format +
        ' cannot draw (needs ' +
        wanted +
        ')',
    )
  }

  // ④ 一块 = 一枝，没有例外（同一枝画两遍 = 作者以为有两份）
  if (seen.has(path)) fail(at(where, 'path'), JSON.stringify(path) + ' is already drawn by another block')
  seen.add(path)
}

/** 场景来源：册子必须是 map、主控名字那一格必须是标量（`scene` 可选，缺了就是没有这一行） */
function checkScene(scene: unknown, state: StateSchema): void {
  if (scene === undefined) return
  if (!isRecord(scene)) fail('display.scene', 'must be an object {path, who}')
  checkKeys(scene, SCENE_KEYS, 'display.scene')
  const path = requireText(scene, 'path', 'display.scene')
  const who = requireText(scene, 'who', 'display.scene')
  const book: Schema | undefined = schemaAt(state, path)
  if (book === undefined) fail('display.scene.path', JSON.stringify(path) + ' does not exist in state')
  const bookType = schemaType(book)
  if (bookType !== 'map') {
    fail(
      'display.scene.path',
      JSON.stringify(path) + ' is a ' + bookType + ', but the scene line needs a map (one row per name)',
    )
  }
  const cell: Schema | undefined = schemaAt(state, who)
  if (cell === undefined) fail('display.scene.who', JSON.stringify(who) + ' does not exist in state')
  const cellType = schemaType(cell)
  if (['map', 'list', 'object'].includes(cellType)) {
    fail('display.scene.who', JSON.stringify(who) + ' is a ' + cellType + ', but the scene line needs a name')
  }
}

/**
 * 载入一张卡时校验显示声明（由 `card.ts` 调）。
 *
 * ⚠️ 这是那一条老纪律的新家：**画不出来的声明 ⇒ 载入即失败**。它原来住在
 *    `components/display-blocks.ts` 的头注释里（模块加载期炸），形状换成卡声明之后
 *    挪进校验器 —— 因为"这一块画不画得出来"现在完全由卡自己那三样决定。
 */
export function checkDisplayBlock(display: Record<string, unknown>, state: StateSchema): void {
  const sidebar = requireArray(display, 'sidebar', 'display')
  const seen = new Set<string>()
  sidebar.forEach((entry, index) => checkEntry(entry, index, state, seen))
  checkScene(display.scene, state)
}

/** 声明.显示：侧栏条目 + 场景来源，各自保持声明顺序（深拷一份，别把卡自己交出去） */
export function displayOf(card: CardData): DisplayDecl {
  const decl: DisplayDecl = {
    sidebar: card.display.sidebar.map((entry) => ({ ...entry })),
  }
  if (card.display.scene !== undefined) decl.scene = { ...card.display.scene }
  return decl
}

/** 点号路径 → 状态树里的值；中间缺一段就是 undefined（卡的声明可以没有那一块） */
export function atPath(state: StateTree, path: string): unknown {
  let scope: unknown = state
  for (const segment of path.split('.')) {
    if (!isRecord(scope) || !Object.hasOwn(scope, segment)) return undefined
    scope = scope[segment]
  }
  return scope
}

/**
 * 「当前所在」那一行的值：按卡声明的指路（`display.scene`）去册子里取**主控那一条**的字符串值，
 * 顺序即卡里字段的顺序。
 *
 * ⚠️ 界面**不认字段名**（字段名是作者起的，见 `components/state-view.ts` 的文件头）⇒
 *    "哪一条是主控的"只能由卡说一次（`scene.who` 指向名字那一格）；缺声明 / 空册子
 *    ⇒ 空数组（那一条什么都不显示，不是崩）。
 */
export function sceneValues(decl: DisplayDecl, state: StateTree): string[] {
  const scene = decl.scene
  if (scene === undefined) return []
  const book = atPath(state, scene.path)
  const name = atPath(state, scene.who)
  if (!isRecord(book) || typeof name !== 'string') return []
  // 那一行的文字栏由**状态层**认形状（`textValuesOf`：值来自状态树，判类型是它那一层的事）
  return textValuesOf(book[name])
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
