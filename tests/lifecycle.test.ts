/**
 * 回合生命周期（src/game/lifecycle.ts）—— 迁移表的正反用例。
 *
 * 两条判据：
 *   ① 迁移表里**每一条**合法转移都走得通，落到的阶段与表一致
 *   ② 「阶段 × 事件」全集里，除合法集合之外的**每一种组合**都抛错
 *
 * 合法集合从 TRANSITIONS 生成（不手抄）；补集靠两份全量样本枚举 ——
 * 往 TurnPhase / TurnEvent 里加成员时，下面的 Record<...> 会当场编译不过，
 * 逼着补样本，矩阵不会悄悄漏掉新成员。
 */
import { describe, expect, it } from 'vitest'
import {
  advance,
  IDLE,
  isRunning,
  statusKeyOf,
  TRANSITIONS,
  type TurnEvent,
  type TurnPhase,
  type TurnState,
} from '../src/game/lifecycle'

/** 每个阶段一个代表状态：枚举「阶段 × 事件」矩阵时用它 */
const STATE_FOR: Record<TurnPhase, TurnState> = {
  idle: IDLE,
  prompting: { phase: 'prompting', mode: 'turn' },
  finishing: { phase: 'finishing', mode: 'turn' },
  committed: { phase: 'committed', mode: null },
  'rolled-back': { phase: 'rolled-back', mode: null },
}

/** 每种事件一个代表事件：枚举矩阵时用它 */
const EVENT_FOR: Record<TurnEvent['type'], TurnEvent> = {
  start: { type: 'start', mode: 'opening' },
  'request-model': { type: 'request-model' },
  'closing-text': { type: 'closing-text' },
  commit: { type: 'commit' },
  rollback: { type: 'rollback' },
  reset: { type: 'reset' },
}

const PHASES = Object.keys(TRANSITIONS) as TurnPhase[]
const EVENT_TYPES = Object.keys(EVENT_FOR) as Array<TurnEvent['type']>

/** 迁移表给出的合法集合：表改了，合法集合跟着改 */
const LEGAL = PHASES.flatMap((phase) =>
  Object.entries(TRANSITIONS[phase]).map(([type, next]) => ({
    phase,
    type: type as TurnEvent['type'],
    next: next as TurnPhase,
  })),
)

/** 矩阵的补集：表里没有的每一种组合都必须被拒 */
const ILLEGAL = PHASES.flatMap((phase) =>
  EVENT_TYPES.filter((type) => TRANSITIONS[phase][type] === undefined).map((type) => ({ phase, type })),
)

describe('the table and its complement partition the whole matrix', () => {
  it('every phase x event pair is either legal or illegal, never both', () => {
    expect(LEGAL.length + ILLEGAL.length).toBe(PHASES.length * EVENT_TYPES.length)
    expect(LEGAL.length).toBeGreaterThan(0)
    expect(ILLEGAL.length).toBeGreaterThan(0)
  })
})

describe('every legal transition in the table goes through', () => {
  it.each(LEGAL)('$phase + $type => $next', ({ phase, type, next }) => {
    expect(advance(STATE_FOR[phase], EVENT_FOR[type]).phase).toBe(next)
  })
})

describe('every combination outside the table is refused', () => {
  it.each(ILLEGAL)('$phase + $type throws', ({ phase, type }) => {
    expect(() => advance(STATE_FOR[phase], EVENT_FOR[type])).toThrow(/illegal turn transition/)
  })
})

describe('the paths that must not exist are refused', () => {
  it('idle: commit is refused (nothing has run yet)', () => {
    expect(() => advance(IDLE, { type: 'commit' })).toThrow(/idle \+ commit/)
  })

  it('committed: a second commit is refused (a turn commits once)', () => {
    const committed = advance({ phase: 'finishing', mode: 'turn' }, { type: 'commit' })
    expect(committed.phase).toBe('committed')
    expect(() => advance(committed, { type: 'commit' })).toThrow(/committed \+ commit/)
  })

  it('rolled-back: a second rollback is refused (the draft is already gone)', () => {
    const rolledBack = advance({ phase: 'prompting', mode: 'turn' }, { type: 'rollback' })
    expect(rolledBack.phase).toBe('rolled-back')
    expect(() => advance(rolledBack, { type: 'rollback' })).toThrow(/rolled-back \+ rollback/)
  })

  it('commit happens only in the phase that holds the closing text', () => {
    for (const phase of PHASES.filter((candidate) => candidate !== 'finishing')) {
      expect(() => advance(STATE_FOR[phase], { type: 'commit' })).toThrow()
    }
  })

  it('rollback happens only while the turn is running', () => {
    for (const phase of ['idle', 'committed', 'rolled-back'] as const) {
      expect(() => advance(STATE_FOR[phase], { type: 'rollback' })).toThrow()
    }
  })
})

describe('a whole turn walks the phases in order', () => {
  it('start -> prompting (every node request) -> finishing -> committed -> idle', () => {
    let state = advance(IDLE, { type: 'start', mode: 'opening' })
    const walk: TurnPhase[] = [state.phase]
    // 九个节点各请求一次模型：每次都在 prompting 里自环，图跑完才进 finishing
    const events: TurnEvent[] = [
      { type: 'request-model' },
      { type: 'request-model' },
      { type: 'request-model' },
      { type: 'closing-text' },
      { type: 'commit' },
      { type: 'reset' },
    ]
    for (const event of events) {
      state = advance(state, event)
      walk.push(state.phase)
    }

    expect(walk).toEqual([
      'prompting',
      'prompting',
      'prompting',
      'prompting',
      'finishing',
      'committed',
      'idle',
    ])
    // start 写进去的 mode 一路带到终态（状态行按它选文案）
    expect(state.mode).toBe('opening')
  })
})

describe('the status line is a projection of the state', () => {
  it('every running phase names the opening or the thinking by mode', () => {
    for (const phase of ['prompting', 'finishing'] as const) {
      expect(statusKeyOf({ phase, mode: 'opening' })).toBe('app.generatingOpening')
      expect(statusKeyOf({ phase, mode: 'turn' })).toBe('story.thinking')
    }
  })

  it('idle and the two terminal phases have no status line of their own', () => {
    expect(statusKeyOf(IDLE)).toBeNull()
    expect(statusKeyOf({ phase: 'committed', mode: 'turn' })).toBeNull()
    expect(statusKeyOf({ phase: 'rolled-back', mode: 'turn' })).toBeNull()
  })

  it('isRunning is true for exactly the running phases', () => {
    const running = PHASES.filter((phase) => isRunning(STATE_FOR[phase]))
    expect(running).toEqual(['prompting', 'finishing'])
  })
})
