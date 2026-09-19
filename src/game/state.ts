/**
 * src/game/state.ts —— 这一局游戏本身：**纯数据 + 纯函数**
 *
 * 一个实体管两样（都是普通数据，没有类、没有 this）：
 *   1. data —— 持久化的一局：卡的实例化状态树（**这一局现在是几点也在里面**）+ 事件流 + 时间线
 *   2. loadError —— 读档失败的原因（给界面显示，不静默；null = 正常）
 *
 * ⚠️ 界面上那串故事**不是**状态，而是 data.events 的投影（见 stores/game.ts）：
 *    这里只留「事件流」这一个真值，没有第二个可变的叙事流数组。
 *
 * ⚠️ 状态的**形状**由卡声明（game/card-state.ts 的 instantiate），引擎不认识
 *    「地牢」「公主」这些词；时间线是引擎自己的东西，所以它不在卡的 state 里
 *    —— 而**时刻**在（`state.world.time`，R39）。
 *
 * ## 契约（改的时候必须守住）
 *
 * - 回合里的动作函数（addEvent / endTurn / advanceTime）**原地改**传进来的 GameData：
 *   那是这一轮的**工作副本**，提交与回滚由组合根负责（stores/turn.ts）。
 * - 只有 `data` 会落盘；`loadError` 是会话状态，序列化时不许带进去。
 * - 读存档一律当 unknown（见 game/save.ts），类型标注不是验证手段。
 */

import {
  advance as advanceCalendar,
  format as formatCalendar,
  type Calendar,
  type TimeValue,
} from './card-calendar'
import { clockIn, writeClock } from './card-time'
import { createInitialState, normalize, parseSave, trimEvents, MAX_TIMELINE } from './save'
import { currentCard } from './current-card'
import { localStorageStore, backupBrokenSave, type SaveStore, type StorageLike } from '../utils/storage'
import { t } from '../i18n'
import type { GameData, GameEvent } from '../types/state'

/** 时间线只记录「值得记」的跳跃（分钟）：小于它就只在时间标签上体现 */
const NOTABLE_MINUTES = 240

/** 这一局的全部状态（普通对象，可以被 reactive() 包） */
export interface GameState {
  data: GameData
  loadError: string | null
}

/** 新游戏的第一帧：状态树 / 时刻 / 卡身份全部来自当前卡（决定 #42） */
export function initialState(): GameState {
  return { data: createInitialState(currentCard), loadError: null }
}

// ---------- 读 ----------

export function turn(s: GameState): number {
  return s.data.meta.turn
}

/** 按一张卡的历法把一个时刻念成文本（引擎不写死日期的念法） */
export function timeText(calendar: Calendar, time: TimeValue): string {
  return formatCalendar(calendar, time)
}

// ---------- 事件流 ----------

/**
 * 追加一条事件（故事与调试痕迹 —— 同一个数组，顺序就是发生顺序）。
 *
 * @param data 这一轮的**工作副本**（引擎与调试痕迹都写它；提交与回滚由调用方负责）
 * @param event 事件本体；`at` 由这里补上
 */
export function addEvent(data: GameData, event: Omit<GameEvent, 'at'>): void {
  data.events.push({ ...event, at: new Date().toISOString() })
  trimEvents(data.events)
}

// ---------- 时间 ----------

/**
 * 按卡的历法推进这一局的时刻，并把它记进时间线。
 *
 * 推进量只有一个数：**分钟**（卡里那个历法的一分钟）。minutes = 0 合法
 * （这一轮时间没动），由动作层保证不出现负数与小数。
 *
 * ⚠️ 时刻写在**状态树里那一格**（`state.world.time`）—— 于是它跟着存档、跟着 `redo`
 *    的部分回滚、跟着事务提交走（R39）；引擎手里没有第二份。
 *
 * @param data 这一轮的工作副本
 * @param calendar 这张卡的历法（推进与念法都按它）
 * @returns 回传给模型的结果文案
 */
export function advanceTime(data: GameData, calendar: Calendar, minutes: number, reason: string): string {
  const before = clockIn(data.state)
  const after = advanceCalendar(calendar, before, minutes)
  writeClock(data.state, after)

  if (minutes > 0 && (minutes >= NOTABLE_MINUTES || data.timeline.length < 3)) {
    data.timeline.push({
      from: formatCalendar(calendar, before),
      to: formatCalendar(calendar, after),
      reason,
      minutes,
      at: new Date().toISOString(),
    })
    if (data.timeline.length > MAX_TIMELINE) {
      data.timeline.splice(0, data.timeline.length - MAX_TIMELINE)
    }
  }

  const time = timeText(calendar, after)
  if (minutes === 0) return t('tools.advanceStill', { time })
  return t('tools.advanceDone', { minutes, time }) + (reason ? t('tools.advanceReason', { reason }) : '')
}

/** 回合 +1（工作副本上的数；提交由调用方做） */
export function endTurn(data: GameData): void {
  data.meta.turn += 1
}

// ---------- 存档 ----------

/**
 * 落盘。失败返回 false，**调用方必须让玩家看到** ——
 * 静默失败会让玩家以为进度已保存，刷新后才发现没了。
 *
 * ⚠️ 存储是**参数**而不是状态的一部分：数据不该知道怎么落盘。
 */
export function save(s: GameState, store: SaveStore): boolean {
  return store.save(s.data)
}

/** 序列化成 JSON 文本（导出文件用）。只导出 data —— 叙事流不属于存档 */
export function exportFile(s: GameState): string {
  return JSON.stringify(s.data, null, 2)
}

/** 重置为新开局并立刻落盘 */
export function reset(s: GameState, store: SaveStore): void {
  s.data = createInitialState(currentCard)
  save(s, store)
}

/** 从 JSON 文本导入存档（解析与校验在 game/save.ts）并落盘 */
export function importFile(s: GameState, json: string, store: SaveStore): void {
  s.data = parseSave(json, currentCard)
  save(s, store)
}

/**
 * 启动：读档并写进给定的 state。存档坏了不抛错，而是把原因放在 loadError 上 ——
 * 整页打不开的话玩家连导出坏数据抢救的机会都没有。
 *
 * ⚠️ 这是**组合根**该做的事（stores/game.ts 调用），不是模块加载时的副作用：
 *    数据自己不该决定「什么时候从哪读」。
 */
export function hydrateFromSave(s: GameState, storage: StorageLike): void {
  const store = localStorageStore(storage)
  try {
    const raw = store.load()
    if (raw !== null) s.data = normalize(raw, currentCard)
  } catch (err) {
    // 坏存档不是致命错误：备份原数据、把原因挂到 loadError 上（界面会说明），
    // 抛出去的话整页打不开，玩家连导出坏数据抢救的机会都没有
    backupBrokenSave(storage)
    s.loadError = (err as Error).message
  }
}
