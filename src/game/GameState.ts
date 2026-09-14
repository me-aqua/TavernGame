/**
 * src/game/GameState.ts —— GameState：这一局游戏本身
 *
 * 它是**唯一的核心实体**，一个类管三样：
 *   1. data —— 持久化的世界状态（玩家 / 场景 / 时间 / 日志 / 时间线）
 *   2. messages —— 本次会话的叙事流（界面 v-for 的那串，不持久化）
 *   3. 自己的存档 —— load / save / 导入 / 导出
 *
 * 响应式由**调用方**提供：界面层用 `reactive(new GameState())` 装它。
 * 这样 src/core 不依赖 Vue，能在 Node 里直接测（见 stores/game.ts 的说明）。
 *
 * ## ⚠️ 读存档一律当 unknown
 *
 * 存档是外部数据：用户能手改、能从文件导入。所以 normalize() 的入参类型是
 * unknown，逐项校验后才敢当 GameData 用 —— 类型标注在这里**不能当验证手段**，
 * 它只描述「校验通过之后」的形状。
 */

import { realCalendar, segmentName, advanceTime } from '../utils/calendar'
import { parseSave, createInitialState, normalize, MAX_LOG, MAX_TIMELINE } from '../game/json'
import { localStorageStore, backupBrokenSave, type GameStore, type StorageLike } from '../utils/storage'
import { t } from '../i18n'
import type { ChatMessage, GameData, LogEntry } from '../types/state'

/** 最后一次「大跨度跳跃」的显示阈值：超过半年就不显示「过去了多久」 */
const LONG_JUMP_MS = 180 * 86400000

/** 叙事流里的一行（界面直接 v-for 它；id 供 key 用） */
export interface StoryLine {
  id: number
  kind: 'narration' | 'action' | 'system' | 'tool' | 'warn' | 'error'
  text: string
  /** 调试模式下的模型原始输出（可折叠） */
  raw?: string
}

/** 判断入参是 GameData 还是构造选项：GameData 一定有 meta 字段 */
function isGameData(v: { storage?: StorageLike; data?: GameData } | GameData): v is GameData {
  return 'meta' in v
}

let nextLineId = 0

export class GameState {
  data: GameData
  /** 本次会话的叙事流。不持久化 —— 刷新后由日志恢复 */
  messages: StoryLine[] = []
  /** 读档失败的原因；null = 正常（给界面显示，不静默） */
  error: string | null = null
  /**
   * 存档适配器。只需要 save —— 读档走静态方法 open()，那里必须给真存储。
   * 公开字段的原因见构造函数（private 会让类不可结构化）。
   */
  storage: { save(data: GameData): boolean }

  /**
   * 传 data 就是「拿这份数据开局」（测试常用），传 storage 才能落盘。
   * 直接传 GameData 与传 { data } 等价 —— 少写一层包装。
   */
  constructor(options: { storage?: StorageLike; data?: GameData } | GameData = {}) {
    const opts = isGameData(options) ? { data: options } : options
    // ⚠️ 这个字段必须是**公开**的，不能加 private：private 成员会让类在 TS 里
    //    变成「不可结构化」，而 reactive(new GameState()) 的类型正是取其结构，
    //    于是 store.game 推不出原型方法，整个界面层的类型全崩。
    //    （`#private` 更不行：Vue 的代理不在私有品牌里，方法一访问就抛错。）
    this.storage = opts.storage ? localStorageStore(opts.storage) : noStore
    this.data = opts.data ?? createInitialState()
  }

  /**
   * 启动：读档 + 构造。存档坏了不抛错，而是把原因放在 error 上 ——
   * 整页打不开的话玩家连导出坏数据抢救的机会都没有。
   */
  static open(storage: StorageLike): GameState {
    try {
      const raw = localStorageStore(storage).load()
      return new GameState({ storage, data: raw === null ? undefined : normalize(raw) })
    } catch (err) {
      backupBrokenSave(storage)
      return Object.assign(new GameState({ storage }), { error: (err as Error).message })
    }
  }

  // ---------- 存档 ----------

  /**
   * 落盘。失败返回 false，**调用方必须让玩家看到** ——
   * 静默失败会让玩家以为进度已保存，刷新后才发现没了。
   */
  save(): boolean {
    return this.storage.save(this.data)
  }

  /** 重置为新开局并立刻落盘 */
  reset(): void {
    this.data = createInitialState()
    this.save()
  }

  /** 序列化成 JSON 文本（导出文件用） */
  exportFile(): string {
    return JSON.stringify(this.data, null, 2)
  }

  /** 从 JSON 文本导入存档（解析与校验在 persistence 里），并落盘 */
  importFile(json: string): void {
    this.data = parseSave(json)
    this.save()
  }

  // ---------- 叙事流 ----------

  /** 往叙事流末尾追加一行 */
  appendMessage(kind: StoryLine['kind'], text: string, extra: Partial<StoryLine> = {}): void {
    this.messages.push({ id: ++nextLineId, kind, text, ...extra })
  }

  /** 清空叙事流（重来 / 导入后调用） */
  clearMessages(): void {
    this.messages = []
  }

  /** 刷新页面后从日志恢复叙事与行动（system 类不恢复，避免重复提示） */
  restoreMessages(limit = 20): void {
    for (const entry of this.data.log.slice(-limit)) {
      if (entry.kind !== 'narration' && entry.kind !== 'action') continue
      this.appendMessage(entry.kind, entry.text)
    }
  }

  // ---------- 日志 ----------

  /** 追加一条日志；超出上限时丢最旧的 */
  addLog(kind: LogEntry['kind'], text: string): void {
    this.data.log.push({ kind, text, at: new Date().toISOString() })
    if (this.data.log.length > MAX_LOG) {
      this.data.log.splice(0, this.data.log.length - MAX_LOG)
    }
  }

  // ---------- 便捷读取 ----------

  get player(): GameData['player'] {
    return this.data.player
  }

  /**
   * 场景。名字与描述为空时给一个**当前语言**的默认值 —— 存档里存的是空串，
   * 所以切换语言时它跟着变（存成字符串的话会永远停在创建时那门语言）。
   */
  get scene(): { name: string; description: string } {
    return {
      name: this.data.scene.name || t('scene.unknownPlace'),
      description: this.data.scene.description || t('scene.unknownPlaceDesc'),
    }
  }

  get turn(): number {
    return this.data.meta.turn
  }

  /** 当前使用的历法（目前只有现实公历一种） */
  get calendar(): typeof realCalendar {
    return realCalendar
  }

  /** 当前时刻（ISO） */
  get iso(): string {
    return this.data.time.iso
  }

  /** 完整时间标签，由历法决定格式 */
  get timeLabel(): string {
    return this.calendar.format(this.data.time.iso)
  }

  /** 简短时间标签 */
  get timeLabelShort(): string {
    return this.calendar.formatShort(this.data.time.iso)
  }

  /** 当前时段名（上午/下午/晚上） */
  get segmentName(): string {
    return segmentName(new Date(this.data.time.iso).getHours())
  }

  // ---------- 工具：时间推进 ----------

  /**
   * 推进时间。这是**唯一的工具**。
   *
   * 参数把关（认单位、拒倒退、拦手滑）在 time.ts —— 那是系统边界。
   * 这里只负责改状态、记时间线、拼给模型看的文案。
   *
   * @returns 给模型看的结果文案（成功或失败都返回字符串）
   */
  advanceTime(step: unknown, unit?: unknown, reason = ''): string {
    const cal = this.calendar
    const before = this.timeLabel
    const beforeIso = this.data.time.iso // 推进前的时刻：时间线要用它记起点

    let outcome
    try {
      outcome = advanceTime(this.data.time.iso, step, unit, before)
    } catch (err) {
      // 边界：this.data.time.iso 来自存档，可能被手改成非法时刻，
      // 此时日历的 advance 会抛 RangeError。快速失败会连累整个回合，
      // 所以在这里转成给模型看的文案。
      return t('tools.advanceFailed', { message: (err as Error).message, current: before })
    }
    if (!outcome.ok) return outcome.message

    this.data.time.iso = outcome.iso
    const after = this.timeLabel

    // 时间线只记录「值得记」的跳跃，避免每回合都堆一条。
    // 阈值必须 <= 一个 segment（4 小时），否则默认单位的推进永远进不了时间线。
    const isNotable = outcome.elapsedMs >= 4 * 3600000 || this.data.timeline.length < 3
    if (isNotable) {
      // 只存「简短」的起止，侧栏空间有限；完整时间抬头看得到。
      // from 必须是**推进前**的时刻（this.data.time.iso 已被覆盖）
      this.data.timeline.push({
        from: cal.formatShort(beforeIso),
        to: cal.formatShort(outcome.iso),
        reason: reason || '',
        elapsedMs: outcome.elapsedMs,
        at: new Date().toISOString(),
      })
      if (this.data.timeline.length > MAX_TIMELINE) {
        this.data.timeline.splice(0, this.data.timeline.length - MAX_TIMELINE)
      }
    }

    const elapsed = outcome.elapsedMs < LONG_JUMP_MS ? cal.describeElapsed(outcome.elapsedMs) : ''

    return (
      t('tools.advanceResult', { before, after }) +
      (elapsed ? t('tools.advanceElapsed', { elapsed }) : '') +
      (reason ? t('tools.advanceReason', { reason }) : '')
    )
  }

  /** 回合 +1，返回给模型看的结算文案 */
  endTurn(): string {
    this.data.meta.turn += 1
    return t('agent.turnAdvanced', { turn: this.data.meta.turn })
  }

  // ---------- 给模型看的快照 ----------

  /**
   * 世界状态快照 —— 模型了解现状的主要途径。
   * @param history 最近几轮对话（刷新后为空，会回退到日志）
   */
  snapshot(history: ChatMessage[] = []): string {
    const lines = [
      t('snapshot.turn', { turn: this.turn }),
      t('snapshot.time', { time: this.timeLabel }),
      t('snapshot.place', { name: this.scene.name }),
      t('snapshot.sceneDescription', { text: this.scene.description }),
    ]

    const recent = history.filter((h) => h && typeof h.content === 'string').slice(-4)
    if (recent.length) {
      lines.push('', t('snapshot.recent'))
      for (const h of recent) {
        const who = h.role === 'user' ? t('snapshot.player') : t('snapshot.gm')
        lines.push(t('snapshot.recentLine', { who, text: h.content.replace(/\s+/g, ' ').slice(0, 160) }))
      }
    } else if (this.data.log.length) {
      lines.push('', t('snapshot.recentLog'))
      for (const entry of this.data.log.slice(-4)) {
        const text = entry.text.replace(/\s+/g, ' ').slice(0, 160)
        lines.push(`- ${text}`)
      }
    }

    // 先筛出有效记录再决定要不要打印标题：
    // 存档被手改后可能出现 to 为空的记录，那样会留下一个空标题，误导模型
    const timelineLines = this.data.timeline
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

    return lines.join('\n')
  }
}

/**
 * 没接存储时的落盘实现：什么都不做。
 *
 * ⚠️ 只有 save —— 读档走的是 GameState.open（那里必须给真存储），
 *    所以这里不需要 load，写了也没有调用点。
 */
const noStore = { save: () => true } satisfies Pick<GameStore, 'save'>
