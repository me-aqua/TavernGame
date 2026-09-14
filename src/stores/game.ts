/**
 * src/stores/game.ts —— 界面与游戏之间的唯一桥梁
 *
 * 这里承担了原来 index.html 里那一大坨 <script> 的职责：
 *   - 持有 GameState 实例与对话历史
 *   - 跑回合（含重入保护、中止）
 *   - 把 agent 循环抛出的事件转成界面用的消息流
 *   - 导出 / 导入 / 重开
 *
 * 为什么用 shallowRef 包 GameState：
 *   GameState 内部是普通对象 + getter（日历、时间标签都是 getter），
 *   用 deep reactive 包会把整棵存档做成响应式代理，既慢又容易在
 *   深层嵌套上报错。只做「浅层替换 + 手动 triggerRef」最省事也最可控。
 */

import { computed, ref, shallowRef, triggerRef } from 'vue'
import { GameState } from '../core/state'
import { runTurn, type AgentEvent } from '../core/agent'
import type { ChatMessage } from '../types/state'

/** 叙事流里的一行 —— 界面直接 v-for 它 */
export interface StoryLine {
  id: number
  kind: 'narration' | 'action' | 'system' | 'tool' | 'warn' | 'error'
  text: string
  /** 调试模式下的模型原始输出（可折叠） */
  raw?: string
  rawBlocks?: number
}

let 行号 = 0
function 新行(kind: StoryLine['kind'], text: string, extra: Partial<StoryLine> = {}): StoryLine {
  return { id: ++行号, kind, text, ...extra }
}

// ⚠️ GameState.load() 返回的**已经是 GameState 实例**，
//    不能再 `new GameState(...)` 包一层 —— 那样 this.data 会变成
//    { data: GameState }，所有 getter（timeLabel / calendar）全崩。
const state = shallowRef(GameState.load())
const 消息流 = ref<StoryLine[]>([])
const 对话历史 = ref<ChatMessage[]>([])
const 正在跑 = ref(false)
const 调试模式 = ref(false)
let controller: AbortController | null = null

export function useGame() {
  // ---------- 只读派生 ----------
  const 时间标签 = computed(() => (state.value, state.value.timeLabel))
  const 时间线 = computed(() => (state.value, state.value.data.timeline.slice(-4)))
  const 场景 = computed(() => (state.value, state.value.data.scene))
  const 回合数 = computed(() => (state.value, state.value.turn))

  // ---------- 消息流 ----------
  function 追加(kind: StoryLine['kind'], text: string, extra: Partial<StoryLine> = {}) {
    消息流.value.push(新行(kind, text, extra))
  }

  function 清空消息流() {
    消息流.value = []
  }

  /** 刷新页面后从日志恢复叙事与行动（system 类不恢复，避免重复提示） */
  function 恢复日志(条数 = 20) {
    for (const entry of state.value.data.log.slice(-条数)) {
      if (entry.kind !== 'narration' && entry.kind !== 'action') continue
      追加(entry.kind, entry.text)
    }
  }

  // ---------- 回合 ----------

  /**
   * ⚠️ 重入保护：一次只能跑一个回合。
   * 没有它的时候，模型正在写故事时点「重来」/「导入」，会同时跑两个回合 ——
   * 旧回合的 addLog/advanceTime/save 全都作用在**新游戏**上，
   * 于是新存档里混进旧剧情、回合数对不上。
   */
  function 中止当前回合() {
    if (!controller) return
    controller.abort()
    controller = null
  }

  function 处理事件(evt: AgentEvent) {
    switch (evt.type) {
      case 'narration':
        追加('narration', evt.text)
        break
      case 'raw':
        if (调试模式.value) {
          追加('tool', `🔍 模型原始输出（解析出 ${evt.blocks} 个工具块）`, {
            raw: evt.text,
            rawBlocks: evt.blocks,
          })
        }
        break
      case 'tool':
        追加('tool', `⚙ 调用 ${evt.tool}(${JSON.stringify(evt.args)})`)
        break
      case 'toolResult':
        追加('tool', `   → ${evt.result}`)
        break
      case 'warn':
        追加('warn', `⚠ ${evt.message}`)
        break
      case 'thinking':
        break
    }
  }

  async function 执行回合(action?: string): Promise<void> {
    if (正在跑.value) return
    正在跑.value = true
    if (action) 追加('action', action)

    controller = new AbortController()
    try {
      const result = await runTurn(state.value, {
        action,
        history: 对话历史.value,
        signal: controller.signal,
        onEvent: 处理事件,
      })
      对话历史.value = result.history
      if (!result.text) 追加('system', '（模型没有返回文字，可能只调用了工具）')
    } catch (err) {
      const e = err as Error
      if (e.name === 'AbortError') {
        追加('system', '已取消本回合')
      } else {
        追加('error', `出错了：\n${e.message}`)
      }
      throw err // 交给调用方决定要不要提示
    } finally {
      controller = null
      正在跑.value = false
      // ⚠️ 必须手动触发：GameState 是普通对象，改动不会自动被 Vue 感知
      triggerRef(state)
    }
  }

  // ---------- 换 state 的三个入口 ----------

  function 重新开始() {
    中止当前回合()
    state.value.reset()
    对话历史.value = []
    triggerRef(state)
    清空消息流()
  }

  function 导入存档(json: string) {
    中止当前回合()
    state.value.import(json)
    对话历史.value = []
    triggerRef(state)
    清空消息流()
  }

  function 导出存档(): string {
    return state.value.export()
  }

  function 打开存档文件(file: File): Promise<void> {
    return file.text().then(导入存档)
  }

  return {
    // 状态
    时间标签, 时间线, 场景, 回合数,
    消息流, 正在跑, 调试模式,
    // 动作
    追加, 清空消息流, 恢复日志, 执行回合, 中止当前回合,
    重新开始, 导入存档, 导出存档, 打开存档文件,
    // 原始实例（设置面板等偶尔需要）
    原始状态: state,
  }
}

/** 界面初始化：读存档 → 恢复日志（在 App.vue 的 onMounted 里调用） */
export function useGameState() {
  return useGame()
}
