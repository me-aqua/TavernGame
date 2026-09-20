/**
 * src/components/state-view.ts —— 把状态树的一段**按形状**摊成界面画得出来的几行。
 *
 * 状态是卡声明的（game/card-state.ts）：引擎不认识「地牢」「萨伦」，界面同样不认识 ——
 * 这里只按 JSON 的形状走（对象 = 键值行、一串标量 = 标签、标量 = 一行文字），
 * 于是换一张卡面板照样画得出来。
 *
 * ⚠️ **界面不认任何字段名**，也没有「哪一栏是标题 / 数量 / 简介」这套约定：卡里的字段名由作者起、
 *    可以是中文，而这里只能写 ASCII 的东西（`src/**` 不许出现非 ASCII 字面量，
 *    `.githooks/checks/ascii.mjs` 拦）—— 按名字找「名称 / 数量 / 简介」时，名字对不上就
 *    **静默读到空**、不报错，面板上少一句话而没人知道为什么（那一栏当然也没法高亮）。
 *    ⇒ 面板上那一块**画成什么形状**由卡声明的**格式**定（`game/display.ts` 的三种预设），
 *      这里只提供「按形状取数」的那几个函数，渲染器照着格式用它们。
 *
 * 与 game/display.ts 的分工：那里说「这一块读**哪一枝**」（路径来自卡的声明），
 * 这里说「那一枝怎么摆成几行」（界面的事）。
 */
import { isRecord } from '../game/save'

/** 状态树里的一段：键 → 值 */
export interface StateEntry {
  key: string
  value: unknown
}

/** 面板上的一行：键 + 值（都是文字） */
export interface StateLine {
  key: string
  text: string
}

/** 一段状态摊成键值对（不是对象就一个都没有） */
export function entriesOf(value: unknown): StateEntry[] {
  if (!isRecord(value)) return []
  return Object.entries(value).map(([key, item]) => ({ key, value: item }))
}

/** 是不是标量（状态树来自 JSON：不是对象、不是数组、不是空的，就是标量） */
export function isScalar(value: unknown): boolean {
  return value !== null && value !== undefined && !Array.isArray(value) && !isRecord(value)
}

/** 标量写成一行文字（数字与布尔照原样写）；对象与数组不走这一条路 */
export function scalarText(value: unknown): string {
  return isScalar(value) ? String(value) : ''
}

/**
 * 一段状态里的标签（地点 / 伤势这类）。
 *
 * 值自己就是一串标量时用它本身；是对象时把每个标量数组摊平 —— 卡把「一串名字」
 * 放在哪个键上由作者决定（spots / places / …），界面只认「它是一串标量」。
 */
export function textsOf(value: unknown): string[] {
  const lists: unknown[][] = Array.isArray(value)
    ? [value]
    : isRecord(value)
      ? Object.values(value).filter((item) => Array.isArray(item))
      : []
  return lists.flatMap((list) => list.filter(isScalar).map(String))
}

/** 一段状态里的键值行：标量直接写，一串标量用中点连起来，其余（嵌套对象）跳过 */
export function linesOf(value: unknown): StateLine[] {
  const lines: StateLine[] = []
  for (const { key, value: item } of entriesOf(value)) {
    const text = scalarText(item)
    if (text !== '') {
      lines.push({ key, text })
      continue
    }
    const texts = textsOf(item)
    if (texts.length > 0) lines.push({ key, text: texts.join(' / ') })
  }
  return lines
}

/**
 * 列表条目：条目本身就是一行文字时标题就是它；是对象时没有标题，整段摊成明细行。
 *
 * ⚠️ 标题只有"整条是一个标量"这一种来源 —— 对象条目的名字由调用方给（地图拿 map 的键当名字）。
 */
export function itemOf(value: unknown): { title: string; lines: StateLine[] } {
  const text = scalarText(value)
  if (text !== '') return { title: text, lines: [] }
  return { title: '', lines: linesOf(value) }
}
