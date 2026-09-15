/**
 * src/game/state.ts —— 这一局游戏本身：**纯数据 + 纯函数**
 *
 * 一个实体管两样（都是普通数据，没有类、没有 this）：
 *   1. data —— 持久化的世界状态（玩家 / 场景 / 时间 / 日志 / 时间线）
 *   2. loadError —— 读档失败的原因（给界面显示，不静默；null = 正常）
 *
 * ⚠️ 界面上那串故事**不是**状态，而是 data.events 的投影（见 stores/game.ts）：
 *    这里只留「事件流」这一个真值，没有第二个可变的叙事流数组。
 *
 * ## 为什么是函数而不是类
 *
 * 类 + Vue 响应式有三处结构性摩擦（都实测踩过）：`private` 字段让类不可结构化，
 * 而 `reactive()` 的类型正是取结构；`#private` 更糟，Vue 代理不在私有品牌里，
 * 方法一访问就抛错；存储适配器于是只能做公开字段，数据自己知道怎么落盘，职责混了。
 * 纯数据没有这些负担，而且逻辑能在没有 Vue 的地方跑（脚本、离线校验卡）。
 *
 * ## 契约（改的时候必须守住）
 *
 * - 动作函数**原地改**传进来的 `s`，不返回新 state。调用方把 `reactive()` 的**代理**
 *   传进来，Vue 才能建立依赖；传原对象（`toRaw`）不会报错，但界面不会更新。
 * - 只有 `data` 会落盘；`loadError` 是会话状态，序列化时不许带进去。
 * - 读存档一律当 unknown（见 game/save.ts），类型标注不是验证手段。
 */

import { realCalendar, advanceTime as advanceTimeFor } from '../utils/calendar'
import { parseSave, createInitialState, normalize, isStoryKind, trimEvents, MAX_TIMELINE } from './save'
import { openingOf } from './opening'
import { currentCard } from './current-card'
import { localStorageStore, backupBrokenSave, type SaveStore, type StorageLike } from '../utils/storage'
import { t } from '../i18n'
import type { ChatMessage, EventKind, GameData } from '../types/state'

/** 最后一次「大跨度跳跃」的显示阈值：超过半年就不显示「过去了多久」 */
const LONG_JUMP_MS = 180 * 86400000

/** 一个时段 ≈ 4 小时：时间线只记录不小于它的跳跃 */
const SEGMENT_MS = 4 * 3600000

/** 这一局的全部状态（普通对象，可以被 reactive() 包） */
export interface GameState {
  data: GameData
  loadError: string | null
}

/** 新游戏的第一帧：形状来自 save.ts，开局事实来自当前卡（决定 #42） */
function freshGame(): GameData {
  return createInitialState(openingOf(currentCard))
}

export function initialState(): GameState {
  return { data: freshGame(), loadError: null }
}

// ---------- 读 ----------

export function turn(s: GameState): number {
  return s.data.meta.turn
}

export function iso(s: GameState): string {
  return s.data.time.iso
}

export function timeLabel(s: GameState): string {
  return realCalendar.format(s.data.time.iso)
}

/**
 * 场景。名字与描述为空时给一个**当前语言**的默认值 —— 存档里存的是空串，
 * 所以切换语言时它跟着变（存成字符串的话会永远停在创建时那门语言）。
 */
export function sceneOf(s: GameState): { name: string; description: string } {
  return {
    name: s.data.scene.name || t('scene.unknownPlace'),
    description: s.data.scene.description || t('scene.unknownPlaceDesc'),
  }
}

// ---------- 事件流 ----------

/**
 * 追加一条事件（故事或调试痕迹 —— 同一个数组，顺序就是发生顺序）。
 *
 * @param detail 可折叠的原始内容（请求体 / 响应体）；只有调试类事件会带
 */
export function addEvent(s: GameState, kind: EventKind, text: string, detail?: string): void {
  s.data.events.push({ kind, text, detail, at: new Date().toISOString() })
  trimEvents(s.data.events)
}

// ---------- 工具：时间推进 ----------

/**
 * 推进时间。这是**唯一的工具**。
 *
 * 参数把关（认单位、拒倒退、拦手滑）在 utils/calendar.ts —— 那是系统边界。
 * 这里只负责改状态、记时间线、拼给模型看的文案。
 *
 * @returns 给模型看的结果文案（成功或失败都返回字符串）
 */
export function advanceTime(s: GameState, step: unknown, unit?: unknown, reason = ''): string {
  const before = timeLabel(s)
  const beforeIso = s.data.time.iso // 推进前的时刻：时间线要用它记起点

  let outcome
  try {
    outcome = advanceTimeFor(s.data.time.iso, step, unit, before)
  } catch (err) {
    // 边界：s.data.time.iso 来自存档，可能被手改成非法时刻，
    // 此时日历的 advance 会抛 RangeError。快速失败会连累整个回合，
    // 所以在这里转成给模型看的文案。
    return t('tools.advanceFailed', { message: (err as Error).message, current: before })
  }
  if (!outcome.ok) return outcome.message

  s.data.time.iso = outcome.iso
  const after = timeLabel(s)

  // 时间线只记录「值得记」的跳跃，避免每回合都堆一条。
  // 阈值必须 <= 一个 segment，否则默认单位的推进永远进不了时间线。
  const isNotable = outcome.elapsedMs >= SEGMENT_MS || s.data.timeline.length < 3
  if (isNotable) {
    // 只存「简短」的起止，侧栏空间有限；完整时间抬头看得到。
    // from 必须是**推进前**的时刻（s.data.time.iso 已被覆盖）
    s.data.timeline.push({
      from: realCalendar.formatShort(beforeIso),
      to: realCalendar.formatShort(outcome.iso),
      reason: reason || '',
      elapsedMs: outcome.elapsedMs,
      at: new Date().toISOString(),
    })
    if (s.data.timeline.length > MAX_TIMELINE) {
      s.data.timeline.splice(0, s.data.timeline.length - MAX_TIMELINE)
    }
  }

  const elapsed = outcome.elapsedMs < LONG_JUMP_MS ? realCalendar.describeElapsed(outcome.elapsedMs) : ''

  return (
    t('tools.advanceResult', { before, after }) +
    (elapsed ? t('tools.advanceElapsed', { elapsed }) : '') +
    (reason ? t('tools.advanceReason', { reason }) : '')
  )
}

/** 回合 +1，返回给模型看的结算文案 */
export function endTurn(s: GameState): string {
  s.data.meta.turn += 1
  return t('agent.turnAdvanced', { turn: s.data.meta.turn })
}

// ---------- 给模型看的快照 ----------

/** 上游节点**本轮**的产出：节点名 + 它的产出原文 */
export interface UpstreamOutput {
  /** 产出它的节点名（拼进段落标题） */
  node: string
  /** 该节点本轮的产出原文 —— 原样累加，引擎不改写 */
  output: string
}

/** contextFor 的输入：公共部分要的对话历史 + 本轮上游产出 */
export interface ContextOptions {
  /** 最近几轮对话（刷新后为空，快照会回退到日志） */
  history?: ChatMessage[]
  /** 本轮上游产出，**按拓扑顺序**给；不传或为空表示这是第一个节点 */
  upstream?: UpstreamOutput[]
}

/**
 * 一个节点这一轮的上下文 = 公共部分 + 本轮上游累加（doc/DESIGN.md 第四节、决定 #26/#36）。
 *
 * 公共部分 = 世界状态快照，所有节点拿到的完全一样；上游产出按调用方给的顺序累加，
 * 每段用节点名起一个标题。
 *
 * ⚠️ 拿不到上游产出时**不猜、不编占位符**（第四节那条纪律）：没传上游、传了空数组、
 *    或某条没有产出，都只是「没有这一段」—— 不替它写任何话，也不留空标题。
 */
export function contextFor(s: GameState, options: ContextOptions = {}): string {
  const place = sceneOf(s)
  const lines = [
    t('snapshot.turn', { turn: turn(s) }),
    t('snapshot.time', { time: timeLabel(s) }),
    t('snapshot.place', { name: place.name }),
    t('snapshot.sceneDescription', { text: place.description }),
  ]

  const recent = (options.history ?? []).filter((h) => h && typeof h.content === 'string').slice(-4)
  if (recent.length) {
    lines.push('', t('snapshot.recent'))
    for (const h of recent) {
      const who = h.role === 'user' ? t('snapshot.player') : t('snapshot.gm')
      lines.push(t('snapshot.recentLine', { who, text: h.content.replace(/\s+/g, ' ').slice(0, 160) }))
    }
  } else {
    // ⚠️ 只喂**故事类**事件：事件流里还有模型输入输出与工具调用，
    //    那些是调试痕迹，混进上下文会把它冲掉（见 save.ts 的 isStoryKind）
    const story = s.data.events.filter((event) => isStoryKind(event.kind)).slice(-4)
    if (story.length) {
      lines.push('', t('snapshot.recentLog'))
      for (const event of story) {
        lines.push(`- ${event.text.replace(/\s+/g, ' ').slice(0, 160)}`)
      }
    }
  }

  // 先筛出有效记录再决定要不要打印标题：
  // 存档被手改后可能出现 to 为空的记录，那样会留下一个空标题，误导模型
  const timelineLines = s.data.timeline
    .slice(-5)
    .filter((entry) => String(entry.to ?? ''))
    .map((entry) =>
      entry.reason
        ? t('snapshot.timelineLine', { to: entry.to, reason: entry.reason })
        : t('snapshot.timelineLineNoReason', { to: entry.to }),
    )
  if (timelineLines.length) {
    lines.push('', t('snapshot.timeline'), ...timelineLines)
  }

  const upstream = upstreamText(options.upstream)
  if (upstream) lines.push(upstream)

  return lines.join('\n')
}

/**
 * 把本轮上游产出拼成文本：每段一条标题 + 产出原文，顺序就是调用方给的顺序。
 *
 * ⚠️ 空产出 / 缺字段 = 这个节点本轮没有结论可传：跳过它，而不是替它编一段
 *    （「拿不到的就别猜」是决定 #26 那条纪律）。
 */
export function upstreamText(upstream: UpstreamOutput[] = []): string {
  const lines: string[] = []
  for (const item of upstream) {
    const node = item?.node
    const output = item?.output
    if (!node || !output) continue
    lines.push('', t('snapshot.upstreamNode', { node }), output)
  }
  return lines.join('\n')
}

/**
 * 世界状态快照 —— 模型了解现状的主要途径。等于「没有上游」时的上下文。
 * @param history 最近几轮对话（刷新后为空，会回退到日志）
 */
export function snapshot(s: GameState, history: ChatMessage[] = []): string {
  return contextFor(s, { history })
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
  s.data = freshGame()
  save(s, store)
}

/** 从 JSON 文本导入存档（解析与校验在 game/save.ts）并落盘 */
export function importFile(s: GameState, json: string, store: SaveStore): void {
  s.data = parseSave(json)
  save(s, store)
}

/**
 * 启动：读档并写进给定的 state。存档坏了不抛错，而是把原因放在 loadError 上 ——
 * 整页打不开的话玩家连导出坏数据抢救的机会都没有。
 *
 * ⚠️ 这是**组合根**该做的事（stores/game.ts 调用），不是模块加载时的副作用：
 * 数据自己不该决定「什么时候从哪读」。
 */
export function hydrateFromSave(s: GameState, storage: StorageLike): void {
  const store = localStorageStore(storage)
  try {
    const raw = store.load()
    if (raw !== null) s.data = normalize(raw)
  } catch (err) {
    // 坏存档不是致命错误：备份原数据、把原因挂到 loadError 上（界面会说明），
    // 抛出去的话整页打不开，玩家连导出坏数据抢救的机会都没有
    backupBrokenSave(storage)
    s.loadError = (err as Error).message
  }
}
