/**
 * src/game/lifecycle.ts —— 回合生命周期：状态、事件与迁移表。
 *
 * 一轮是一个事务（决定 #27/#39），它经过的阶段 —— 请求模型 / 执行工具 / 步数用尽强制收尾 /
 * 收尾文字到手 / 提交 / 回滚 —— 在这里是**显式数据**：合法性只在 advance() 一处判断，
 * 非法转移直接抛错。没有兜底、没有静默忽略：状态机与真实执行一旦悄悄分叉，
 * 「回合在飞」这个判据（重入保护与状态行都靠它）就不再可信。
 *
 * ⚠️ 纯函数，不认 Vue、不认 i18n：「现在该显示什么」由 statusKeyOf() 给出**文案键**，
 *    翻译留在组合根（显示是派生值，决定 #22）。
 *
 * ⚠️ 状态只回答「到哪一步了」，不带上下文：数据有没有写回由调用方的事务保证 ——
 *    committed 的判据是「提交真的发生了」，不是「状态机以为发生了」。
 */

/** 一轮是谁发起的：开新游戏的自动开场，还是玩家的行动 */
export type TurnMode = 'opening' | 'turn'

/** 回合的阶段：空闲 + 四个运行中阶段 + 两个终态 */
export type TurnPhase =
  'idle' | 'prompting' | 'executing' | 'forcing' | 'finishing' | 'committed' | 'rolled-back'

/** 回合的生命周期状态 */
export interface TurnState {
  phase: TurnPhase
  /** 这一轮是谁发起的：只有 start 事件会写它，之后随状态原样带走；空闲与终态下没有读者 */
  mode: TurnMode | null
}

/** 迁移的输入：前五个由引擎的 AgentEvent 推导，后四个是组合根自己的时刻 */
export type TurnEvent =
  /** 开始一轮：玩家提交行动，或开新游戏时自动跑开场 */
  | { type: 'start'; mode: TurnMode }
  /** 一次模型请求发出（AgentEvent thinking） */
  | { type: 'request-model' }
  /** 模型在协议层要求调工具（AgentEvent tool） */
  | { type: 'call-tools' }
  /** 一个工具结果回传（AgentEvent toolResult） */
  | { type: 'tools-returned' }
  /** 步数用尽、还没写过叙事：补写收尾（AgentEvent forcing） */
  | { type: 'force-narration' }
  /** 收尾文字到手（引擎交回本回合的正文）—— 只有这个状态允许提交 */
  | { type: 'closing-text' }
  /** 提交：工作副本一次写回权威状态 */
  | { type: 'commit' }
  /** 失败或取消：丢弃副本 */
  | { type: 'rollback' }
  /** 一轮彻底结束，回到空闲等下一轮 */
  | { type: 'reset' }

/** 空闲：没有回合在跑（mode 此时没有意义） */
export const IDLE: TurnState = { phase: 'idle', mode: null }

/**
 * 迁移表 —— 合法转移的**唯一来源**。
 *
 * 键是当前阶段，值是「事件 → 下一阶段」；表外的组合一律非法（advance 抛错）。
 * 测试从这张表生成合法集合，再枚举「阶段 × 事件」全集取补（tests/lifecycle.test.ts）。
 */
export const TRANSITIONS: Record<TurnPhase, Partial<Record<TurnEvent['type'], TurnPhase>>> = {
  idle: { start: 'prompting' },
  prompting: {
    // 下一步的模型请求仍在请求阶段；模型改口要工具就转去执行工具
    'request-model': 'prompting',
    'call-tools': 'executing',
    'force-narration': 'forcing',
    'closing-text': 'finishing',
    rollback: 'rolled-back',
  },
  executing: {
    // 一次模型消息可以带多个工具调用；工具结果一条条回来，仍在这个阶段
    'call-tools': 'executing',
    'tools-returned': 'executing',
    'request-model': 'prompting',
    'force-narration': 'forcing',
    'closing-text': 'finishing',
    rollback: 'rolled-back',
  },
  forcing: { 'closing-text': 'finishing', rollback: 'rolled-back' },
  finishing: { commit: 'committed', rollback: 'rolled-back' },
  committed: { reset: 'idle' },
  'rolled-back': { reset: 'idle' },
}

/**
 * 按迁移表推进一步。
 *
 * ⚠️ 非法组合直接抛错：这是快速失败，不是可恢复的错误 —— 能发生非法转移，说明调用方
 *    对「现在到哪一步了」的假设已经与状态机分叉，继续跑只会把错写进玩家的存档。
 */
export function advance(state: TurnState, event: TurnEvent): TurnState {
  const next = TRANSITIONS[state.phase][event.type]
  if (next === undefined) {
    throw new Error(`illegal turn transition: ${state.phase} + ${event.type}`)
  }
  return { phase: next, mode: event.type === 'start' ? event.mode : state.mode }
}

/** 运行中的四个阶段（顺序就是一轮里它们可能出现的顺序） */
const RUNNING_PHASES: readonly TurnPhase[] = ['prompting', 'executing', 'forcing', 'finishing']

/** 回合在飞吗 —— 界面据此禁用输入，回合入口据此挡住重入 */
export function isRunning(state: TurnState): boolean {
  return RUNNING_PHASES.includes(state.phase)
}

/**
 * 状态行的文案键：自动开场是「正在生成开场…」，玩家的回合一律「思考中…」；
 * 空闲与两个终态没有键（那时状态行归通知管）。
 */
export function statusKeyOf(state: TurnState): 'app.generatingOpening' | 'story.thinking' | null {
  if (!isRunning(state)) return null
  return state.mode === 'opening' ? 'app.generatingOpening' : 'story.thinking'
}
