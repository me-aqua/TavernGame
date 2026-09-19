/**
 * src/game/card-time.ts —— 「这一局现在是几点」住哪儿（R39：它是世界状态的一部分）。
 *
 * 时刻**只有一处**：`state.world.time` 那五个整数。它跟着存档、跟着 `redo` 的部分回滚、
 * 跟着事务提交走 —— 与地点、背包那些状态一视同仁。
 *
 * ⚠️ **那一格是引擎点名的**（键名不由作者改，与 `world.map` / `roles` / `lead.pack` 同一类）：
 *    引擎要拿它取时刻（提示词的「现在」那一行 / 顶栏那条标签）、推进时刻（`advance_time`）、
 *    卡载入时按历法核它的初值、读档时再核一次 —— 那几处都不认识「作者把它叫什么」。
 * ⚠️ **没有第二份时钟**：引擎私有的那个顶层 `time` 字段已经没了（段 5），
 *    所以这里既不「同步」也不「兜底」—— 读不到就抛，让问题当场暴露。
 */

import { checkCalendar, checkTime, type Calendar, type TimeValue } from './card-calendar'
import { checkKeys, fail, isRecord, requireRecord } from './card-read'
import { schemaAt, type StateSchema } from './card-state'

/** 时钟那一格在状态树里的路径 —— 唯一的时刻来源 */
export const CLOCK_STATE_PATH = 'world.time'

/** 时钟那一段在 schema 里的路径（`state.world.fields.time`）—— 报错信息与校验用 */
const CLOCK_SCHEMA_PATH = 'state.' + CLOCK_STATE_PATH.split('.').join('.fields.')

/**
 * 状态树里的时刻。
 *
 * ⚠️ 读不到就**抛**：静默给一个兜底时刻，模型与界面就会各自编一个「现在」出来 ——
 *    那正是这一段要消灭的「两份时钟」。
 */
export function clockIn(state: Record<string, unknown>): TimeValue {
  const [branch, cell] = CLOCK_STATE_PATH.split('.')
  const scope = state[branch]
  const clock = isRecord(scope) ? scope[cell] : undefined
  if (!isRecord(clock)) throw new Error('the state tree has no ' + CLOCK_STATE_PATH)
  return clock as unknown as TimeValue
}

/** 把时刻写回那一格（原地改：卡片的动作写的也是这一格，两种写法必须落到同一处） */
export function writeClock(state: Record<string, unknown>, clock: TimeValue): void {
  const [branch, cell] = CLOCK_STATE_PATH.split('.')
  const scope = state[branch]
  if (!isRecord(scope)) throw new Error('the state tree has no ' + branch)
  scope[cell] = { ...clock }
}

/**
 * 状态树的一份副本，**去掉时钟那一格** —— 给模型的「状态快照」用它。
 *
 * 为什么：时刻已经在「现在」那一行里按卡的历法念过一遍了，快照里再出现那五个整数就是
 * **同一个事实说两遍**；两处一旦不一致，模型会挑错的那份去叙事。调试面板要的是完整的树，
 * 所以这件事只在这里做（不改 `renderState` 自己）。
 */
export function withoutClock(state: Record<string, unknown>): Record<string, unknown> {
  const [branch, cell] = CLOCK_STATE_PATH.split('.')
  const scope = state[branch]
  if (!isRecord(scope) || !Object.hasOwn(scope, cell)) return state
  const copy = { ...scope }
  delete copy[cell]
  return { ...state, [branch]: copy }
}

/**
 * 卡声明的那段时间：历法（预设名或自定义 spec）+ 状态树里那一格的起始时刻。
 *
 * ⚠️ 那一格的初值必须落在这张历法里（月 13、时 24 当场拒）—— 这一道以前跑在顶层
 * `time.initial` 上，时刻搬进 schema 之后 `checkSchema` 只认「五个整数」，得在这里补回来。
 */
export function checkTimeBlock(card: Record<string, unknown>): void {
  const time = requireRecord(card, 'time', '')
  checkKeys(time, ['calendar'], 'time')
  const calendar: Calendar = checkCalendar(time.calendar, 'time.calendar')
  checkClockInitial(calendar, requireRecord(card, 'state', '') as StateSchema)
}

/**
 * 卡声明的起始时刻必须落在**这张卡自己的历法**里。
 *
 * ⚠️ 那一格**必须声明**：缺了不是"少显示一行"，而是开局就跑不起来（`clockIn` 当场抛）。
 */
export function checkClockInitial(calendar: Calendar, state: StateSchema): void {
  const clock = schemaAt(state, CLOCK_STATE_PATH)
  if (!isRecord(clock)) {
    fail(CLOCK_STATE_PATH, 'must be an object schema holding the clock (the engine reads it there)')
  }
  checkTime(calendar, clock.initial, CLOCK_SCHEMA_PATH + '.initial')
}

/** 读档时的那一道：时刻必须在历法里（校验不过就抛，调用方会挂到 loadError 上） */
export function checkSavedClock(calendar: Calendar, state: Record<string, unknown>): void {
  checkTime(calendar, clockIn(state), CLOCK_SCHEMA_PATH)
}
