/**
 * src/game/lifecycle.ts —— 回合生命周期：状态、事件与迁移表。
 *
 * 一轮是一个事务（决定 #27/#39），它经过的阶段 —— 请求模型 / 收尾文字到手 /
 * 提交 / 回滚 —— 在这里是**显式数据**：合法性只在 advance() 一处判断，
 * 非法转移直接抛错。没有兜底、没有静默忽略：状态机与真实执行一旦悄悄分叉，
 * 「回合在飞」这个判据（重入保护与状态行都靠它）就不再可信。
 *
 * ⚠️ 引擎每轮只走「请求模型」与「收尾」两件事：九个节点各请求一次模型（每次都在
 *    prompting 里），图跑完交回正文的那一刻进 finishing。
 *
 * ⚠️ 纯函数，不认 Vue、不认 i18n：「现在该显示什么」由 statusKeyOf() 给出**文案键**，
 *    翻译留在组合根（显示是派生值，决定 #22）。
 *
 * ⚠️ 状态只回答「到哪一步了」，不带上下文：数据有没有写回由调用方的事务保证 ——
 *    committed 的判据是「提交真的发生了」，不是「状态机以为发生了」。
 */

/** 一轮是谁发起的：开新游戏的自动开场，还是玩家的行动 */
export type TurnMode = 'opening' | 'turn'

/** 回合的阶段：空闲 + 两个运行中阶段 + 两个终态 */
export type TurnPhase = 'idle' | 'prompting' | 'finishing' | 'committed' | 'rolled-back'

/** 回合的生命周期状态 */
export interface TurnState {
  phase: TurnPhase
  /** 这一轮是谁发起的：只有 start 事件会写它，之后随状态原样带走；空闲与终态下没有读者 */
  mode: TurnMode | null
  /**
   * 正在跑哪个节点（卡里的节点 id）；图还没开始跑、或跑完进入收尾时是 null。
   *
   * ⚠️ 它是**给界面看的进度**（状态行写着「正在跑「故事大纲」…」），不是执行器的状态：
   *    节点跑完不会再报一次「我结束了」，所以下一个节点的事件到来之前它一直是上一个。
   */
  node: string | null
}

/** 迁移的输入：前几个由引擎的 AgentEvent 推导，后几个是组合根自己的时刻 */
export type TurnEvent =
  /** 开始一轮：玩家提交行动，或开新游戏时自动跑开场 */
  | { type: 'start'; mode: TurnMode }
  /** 图执行器进了哪个节点（AgentEvent node）—— 状态行据此写出具体节点名 */
  | { type: 'node'; id: string }
  /** 一次模型请求发出（AgentEvent thinking）—— 图里每个节点一次 */
  | { type: 'request-model' }
  /** 收尾文字到手（引擎交回本回合的正文）—— 只有这个状态允许提交 */
  | { type: 'closing-text' }
  /** 提交：工作副本一次写回权威状态 */
  | { type: 'commit' }
  /** 失败或取消：丢弃副本 */
  | { type: 'rollback' }
  /** 一轮彻底结束，回到空闲等下一轮 */
  | { type: 'reset' }

/** 空闲：没有回合在跑（mode 与 node 此时都没有意义） */
export const IDLE: TurnState = { phase: 'idle', mode: null, node: null }

/**
 * 迁移表 —— 合法转移的**唯一来源**。
 *
 * 键是当前阶段，值是「事件 → 下一阶段」；表外的组合一律非法（advance 抛错）。
 * 测试从这张表生成合法集合，再枚举「阶段 × 事件」全集取补（tests/lifecycle.test.ts）。
 */
export const TRANSITIONS: Record<TurnPhase, Partial<Record<TurnEvent['type'], TurnPhase>>> = {
  idle: { start: 'prompting' },
  prompting: {
    // 下一个节点的请求仍在请求阶段：图是线性的，中间没有别的阶段
    'request-model': 'prompting',
    // 进了一个节点：阶段不变，只记下「现在跑的是谁」（状态行读它）
    node: 'prompting',
    'closing-text': 'finishing',
    rollback: 'rolled-back',
  },
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
  return {
    phase: next,
    // start 带上这一轮是谁发起的；终态与空闲不带任何在跑的节点
    mode: event.type === 'start' ? event.mode : state.mode,
    node: event.type === 'node' ? event.id : isRunning({ ...state, phase: next }) ? state.node : null,
  }
}

/** 运行中的两个阶段（顺序就是一轮里它们可能出现的顺序） */
const RUNNING_PHASES: readonly TurnPhase[] = ['prompting', 'finishing']

/** 回合在飞吗 —— 界面据此禁用输入，回合入口据此挡住重入 */
export function isRunning(state: TurnState): boolean {
  return RUNNING_PHASES.includes(state.phase)
}

/**
 * 状态行的文案键：自动开场是「正在生成开场…」，玩家的回合一律「思考中…」；
 * 空闲与两个终态没有键（那时状态行归通知管）。
 *
 * ⚠️ 有节点在跑时，组合根会把这个键换成带节点名的那条（见 stores/game.ts）——
 *    「正在跑「故事大纲」…」比「思考中…」有用得多：一等的九个节点里卡在哪一个，
 *    玩家与开发者都一眼看得到。
 */
export function statusKeyOf(state: TurnState): 'app.generatingOpening' | 'story.thinking' | null {
  if (!isRunning(state)) return null
  return state.mode === 'opening' ? 'app.generatingOpening' : 'story.thinking'
}

/** 空闲 / 终态之外的「正在跑哪个节点」——没有节点在跑时是 null */
export function runningNodeOf(state: TurnState): string | null {
  return isRunning(state) ? state.node : null
}
