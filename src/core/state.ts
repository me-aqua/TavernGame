/**
 * src/core/state.ts —— 世界状态与存档
 *
 * ## 状态只有两样
 *
 * 1. **场景**（现在在哪、什么样）
 * 2. **时间**（唯一的结构化引擎状态）
 *
 * 早期版本有属性、背包、NPC、剧情标记等一堆字段，逼着模型每回合
 * 输出大量 JSON 去维护它们，反而挤掉了「写故事」的注意力。
 *
 * ## save
 *
 * - 主存 localStorage（自动保存，刷新不丢）
 * - 备份：导出 JSON 文件 / 从文件导入
 *
 * ## ⚠️ 读存档一律当 unknown
 *
 * 存档是外部数据：用户能手改、能从文件导入、可能是旧版本写的。
 * 所以 normalize() 的入参类型是 unknown，逐项校验后才敢当 GameData 用 ——
 * 类型标注在这里**不能当验证手段**，它只描述「校验通过之后」的形状。
 */

import { getCalendar, SEGMENTS, type Calendar } from './calendar'
import { advanceTime } from './time'
import { writeSave, parseSave, createInitialState } from './persistence'
import type { ChatMessage, GameData, LogEntry } from '../types/state'

/** 最后一次「大跨度跳跃」的显示阈值：超过半年就不显示「过去了多久」 */
const LONG_JUMP_MS = 180 * 86400000

const MAX_LOG = 80
const MAX_TIMELINE = 40

export class GameState {
  data: GameData

  constructor(data?: GameData) {
    this.data = data ?? createInitialState()
  }

  // ---------- save ----------

  /**
   * save。
   * ⚠️ 失败返回 false，**调用方必须让玩家看到** —— 静默失败会让玩家以为
   * 进度已保存，刷新后才发现没了。
   */
  save(): boolean {
    return writeSave(this.data)
  }

  reset(): void {
    this.data = createInitialState()
    this.save()
  }

  export(): string {
    return JSON.stringify(this.data, null, 2)
  }

  import(json: string): void {
    this.data = parseSave(json)
    this.save()
  }

  // ---------- 日志 ----------

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

  get scene(): GameData['scene'] {
    return this.data.scene
  }

  get turn(): number {
    return this.data.meta.turn
  }

  /** 当前使用的历法（对象） */
  get calendar(): Calendar {
    return getCalendar(this.data.time.calendar)
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

  /** 当前时段名（上午/下午/晚上），部分历法也有这个概念 */
  get segmentName(): string {
    const h = new Date(this.data.time.iso).getHours()
    return SEGMENTS[h < 12 ? 0 : h < 18 ? 1 : 2]
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
      // 边界：this.data.time.iso 来自 localStorage，可能被手改成非法时刻，
      // 此时日历的 advance 会抛 RangeError。快速失败会连累整个回合，
      // 所以在这里转成给模型看的文案。
      return `⚠ 推进失败：${(err as Error).message}（当前：${before}）`
    }
    if (!outcome.ok) return outcome.message

    this.data.time.iso = outcome.iso
    const after = this.timeLabel

    // 时间线只记录「值得记」的跳跃，避免每回合都堆一条。
    // 阈值必须 <= 一个 segment（4 小时），否则默认单位的推进永远进不了时间线 ——
    // 侧栏那块就一直是空的。
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
      `🕐 时间推进：${before}\n           → ${after}` +
      (elapsed ? `\n   （${elapsed}）` : '') +
      (reason ? `\n   原因：${reason}` : '')
    )
  }

  endTurn(): string {
    this.data.meta.turn += 1
    return `回合 +1（当前第 ${this.data.meta.turn} 回合）`
  }

  // ---------- 给模型看的快照 ----------

  /**
   * 世界状态快照 —— 模型了解现状的主要途径。
   * @param history 最近几轮对话（刷新后为空，会回退到日志）
   */
  snapshot(history: ChatMessage[] = []): string {
    const lines = [
      `【第 ${this.turn} 回合】`,
      `时间：${this.timeLabel}`,
      `地点：${this.data.scene.name}`,
      `　　${this.data.scene.description}`,
    ]

    // ⚠️ 防御性读取：这里的字段可能是脏的（存档被手改、或旧版本格式）。
    // 这个函数在**拼提示词**阶段被调用 —— 它一抛错，之后每一回合都在同一处崩，
    // 而且 save() 在抛错点之后，坏数据永远不会被覆盖修复。所以宁可少显示几行。
    const logs = Array.isArray(this.data.log) ? this.data.log : []
    const timeline = Array.isArray(this.data.timeline) ? this.data.timeline : []

    const recent = history.filter((h) => h && typeof h.content === 'string').slice(-4)
    if (recent.length) {
      lines.push('', '### 最近发生的事')
      for (const h of recent) {
        const who = h.role === 'user' ? '玩家' : '你(GM)'
        lines.push(`- ${who}：${h.content.replace(/\s+/g, ' ').slice(0, 160)}`)
      }
    } else if (logs.length) {
      lines.push('', '### 最近发生的事')
      for (const entry of logs.slice(-4)) {
        if (!entry || typeof entry !== 'object') continue
        const text = String(entry.text ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 160)
        lines.push(`- ${text}`)
      }
    }

    // 先筛出有效记录再决定要不要打印标题：
    // 存档被手改后可能出现 to 为空的记录，那样会留下一个空标题，误导模型
    const timelineLines = timeline
      .slice(-5)
      .filter((t) => t && typeof t === 'object' && String(t.to ?? ''))
      .map((t) => `- ${t.to}${t.reason ? `（${t.reason}）` : ''}`)
    if (timelineLines.length) {
      lines.push('', '### 时间线', ...timelineLines)
    }

    return lines.join('\n')
  }
}
