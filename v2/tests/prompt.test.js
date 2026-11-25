/**
 * 提示词拼装判据（CONTRACT §5）。
 *
 * 三件事非钉不可：
 *   ① **顺序**（公共提示词 → 状态树 → 历史（含本回合行动）→ 上游 → 本节点提示词）；
 *   ② **没有独立的「玩家行动」段**：行动只作为历史块的最后一条进来（老板 2026-11-25 口径）；
 *   ③ **眼睛**（`reads` 里没有的，正文一个字符都不许出现）——它是玩家唯一能看见的「读什么」开关。
 * 上游是**节点 id 的名单**（`readsUpstream: string[]`）：只拼名单里那些、按**链顺序**、空串跳过。
 *
 * 断言用 `indexOf` 比位置，不用整串相等：分隔符与段标题归实现，顺序与内容归契约。
 */
import { describe, expect, it } from 'vitest'
import { makeCard, makeSave, OPENING_PROMPT, turnEvents } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))

/** 三个已完成回合的存档（历史断言靠它；每回合的正文记号互不为子串） */
function saveWithThreeTurns(card) {
  return makeSave(card, {
    turn: 3,
    events: [
      ...turnEvents(1, 'act one', 'NARR_ONE'),
      ...turnEvents(2, 'act two', 'NARR_TWO'),
      ...turnEvents(3, 'act three', 'NARR_THREE'),
    ],
  })
}

/** 输出节点（historyTurns=3、读两块提示词与两个元素、读 check + extra 两个上游） */
const outputOf = (card) => card.chain.find((node) => node.id === 'output')

/** 本回合已执行节点的输出：默认两个上游都有正文，且互不为子串 */
const UPSTREAM_OUTPUTS = { check: 'UP_CHECK', extra: 'UP_EXTRA' }

/** 取某个节点拼出来的提示词（默认节点 = 输出节点） */
async function promptOf({
  card = makeCard(),
  save,
  node,
  action = 'act four',
  outputs = UPSTREAM_OUTPUTS,
} = {}) {
  const { buildPrompt } = await loadPrompt()
  return buildPrompt({
    card,
    save: save ?? saveWithThreeTurns(card),
    node: node ?? outputOf(card),
    action,
    outputs,
  })
}

/** 断言 mark 出现了，且必须排在 later 之前 */
function expectBefore(text, mark, later) {
  const at = text.indexOf(mark)
  expect(at, `${mark} 没出现在提示词里`).toBeGreaterThanOrEqual(0)
  expect(text.indexOf(later), `${mark} 应该排在 ${later} 之前`).toBeGreaterThan(at)
}

describe('提示词拼装：顺序', () => {
  it('五段按契约顺序排：提示词 → 状态 → 历史（含本回合行动）→ 上游 → 本节点', async () => {
    const text = await promptOf()
    expectBefore(text, 'BODY_ONE', 'BODY_TWO')
    expectBefore(text, 'BODY_TWO', 'VAL_PLACE_A1')
    expectBefore(text, 'VAL_PLACE_A1', 'VAL_MOOD_B2')
    expectBefore(text, 'VAL_MOOD_B2', 'NARR_ONE')
    expectBefore(text, 'NARR_TWO', 'NARR_THREE')
    // 本回合行动是历史块的最后一条 ⇒ 它排在「已完成回合」之后、上游之前
    expectBefore(text, 'NARR_THREE', 'act four')
    expectBefore(text, 'act four', 'UP_CHECK')
    expectBefore(text, 'UP_CHECK', 'UP_EXTRA')
    expectBefore(text, 'UP_EXTRA', 'NODE_OUT')
    expect(text.trimEnd().endsWith('NODE_OUT'), '本节点提示词必须是最后一段').toBe(true)
  })

  it('公共提示词正文逐字出现（含换行，不截断不转义）', async () => {
    const card = makeCard()
    card.prompts[1].body = 'BODY_LONG first line\nsecond line\twith tab'
    const text = await promptOf({ card })
    expect(text).toContain('BODY_LONG first line\nsecond line\twith tab')
  })

  it('时间元素渲染成 day <n> hour <n>', async () => {
    const card = makeCard()
    const node = { ...card.chain[0], reads: ['0'] }
    const text = await promptOf({ card, node, outputs: {} })
    expect(text).toContain('0 time = day 1 hour 8')
  })
})

describe('提示词拼装：状态取的是传进来的 tree', () => {
  it('tree 里是什么就渲染什么 —— 同回合的写入由引擎负责先放进 tree（CONTRACT §5 的 P2 条）', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), reads: ['1', '2'], historyTurns: 0, readsUpstream: [] }
    const save = makeSave(card)
    save.tree['1'] = 'WRITTEN_THIS_TURN'
    const text = await promptOf({ card, save, node, outputs: {} })
    expect(text, 'buildPrompt 是纯函数：它只负责把 tree 里的当前值写进去').toContain(
      '1 place = WRITTEN_THIS_TURN',
    )
    expect(text).not.toContain('VAL_PLACE_A1')
    expect(text).toContain('2 mood = VAL_MOOD_B2')
  })
})

describe('提示词拼装：没有独立的玩家行动段', () => {
  it('historyTurns=0 ⇒ 块里只剩本回合行动（行动仍可见，但没有更早的回合）', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), historyTurns: 0, readsUpstream: [], prompt: 'NODE_OUT' }
    const text = await promptOf({ card, node, action: 'ACT_MARKER_9Z', outputs: {} })
    expect(text).toContain('ACT_MARKER_9Z')
    expect(text).not.toContain('NARR_THREE')
    expect(text).not.toContain('act three')
    // 行动在这一条里是历史块的最后一条 ⇒ 它排在状态段之后、本节点提示词之前
    expectBefore(text, 'VAL_MOOD_B2', 'ACT_MARKER_9Z')
    expectBefore(text, 'ACT_MARKER_9Z', 'NODE_OUT')
  })

  it('historyTurns=1 ⇒ 只带最近一个已完成回合 + 本回合行动', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), historyTurns: 1, readsUpstream: [], prompt: 'NODE_OUT' }
    const text = await promptOf({ card, node, action: 'ACT_MARKER_9Z', outputs: {} })
    expect(text).toContain('NARR_THREE')
    expect(text).not.toContain('NARR_TWO')
    expectBefore(text, 'NARR_THREE', 'ACT_MARKER_9Z')
    expectBefore(text, 'ACT_MARKER_9Z', 'NODE_OUT')
  })

  it('行动只出现一次（不是「历史里一份 + 段尾一份」）', async () => {
    const text = await promptOf({ action: 'ACT_MARKER_9Z' })
    const hits = text.split('ACT_MARKER_9Z').length - 1
    expect(hits, '行动在提示词里出现了 ' + hits + ' 次').toBe(1)
  })
})

describe('提示词拼装：眼睛（读）', () => {
  it('关掉的公共提示词块，正文一个字符都不出现', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), reads: ['pr1', '1'] }
    const text = await promptOf({ card, node })
    expect(text).toContain('BODY_ONE')
    expect(text).not.toContain('BODY_TWO')
  })

  it('关掉的状态元素，值不出现（值只住在初值里，找不到就是真的没读）', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), reads: ['pr1'] }
    const text = await promptOf({ card, node })
    expect(text).not.toContain('VAL_PLACE_A1')
    expect(text).not.toContain('VAL_MOOD_B2')
  })
})

describe('提示词拼装：上游（按节点点名的名单）', () => {
  it('名单为空 ⇒ 一个上游正文都不出现', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), readsUpstream: [] }
    const text = await promptOf({ card, node })
    expect(text).not.toContain('UP_CHECK')
    expect(text).not.toContain('UP_EXTRA')
  })

  it('只拼名单里点名的那个：没点名的上游即使有输出也不出现', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), readsUpstream: ['extra'] }
    const text = await promptOf({ card, node })
    expect(text).toContain('UP_EXTRA')
    expect(text).not.toContain('UP_CHECK')
  })

  it('多个上游按**链顺序**拼，不按名单里的先后（名单顺序反过来，正文顺序不变）', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), readsUpstream: ['extra', 'check'] }
    const text = await promptOf({ card, node })
    expectBefore(text, 'UP_CHECK', 'UP_EXTRA')
  })

  it('上游输出是空串就跳过（不留空行、也不炸）', async () => {
    const card = makeCard()
    const text = await promptOf({ card, outputs: { check: '', extra: 'UP_EXTRA' } })
    expect(text).toContain('UP_EXTRA')
    expect(text).not.toContain('UP_CHECK')
  })

  it('本回合还没跑到的节点没有输出（映射里没有这个 id）⇒ 跳过', async () => {
    const card = makeCard()
    const text = await promptOf({ card, outputs: {} })
    expect(text).not.toContain('UP_CHECK')
    expect(text).not.toContain('UP_EXTRA')
    expect(text).toContain('NODE_OUT')
  })
})

describe('提示词拼装：历史（含本回合）', () => {
  it('historyTurns=3 ⇒ 最近三个已完成回合 + 本回合行动（旧的在前）', async () => {
    const text = await promptOf()
    expectBefore(text, 'NARR_ONE', 'NARR_TWO')
    expectBefore(text, 'NARR_TWO', 'NARR_THREE')
    expectBefore(text, 'NARR_THREE', 'act four')
  })

  it('historyTurns=2 ⇒ 只留最近两个已完成回合 + 本回合行动', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), historyTurns: 2 }
    const text = await promptOf({ card, node })
    expect(text).not.toContain('NARR_ONE')
    expectBefore(text, 'NARR_TWO', 'NARR_THREE')
    expectBefore(text, 'NARR_THREE', 'act four')
  })

  it('历史只取 action 与 narration（节点 / 工具 / 写入事件不进提示词）', async () => {
    const card = makeCard()
    const save = saveWithThreeTurns(card)
    save.events.push(
      { type: 'node', text: 'TOOLNOISE_NODE', at: '2026-01-04T00:00:00.000Z' },
      { type: 'tool', text: 'TOOLNOISE_TOOL', at: '2026-01-04T00:00:00.000Z' },
      { type: 'write', text: 'TOOLNOISE_WRITE', at: '2026-01-04T00:00:00.000Z' },
    )
    const text = await promptOf({ card, save })
    expect(text).not.toContain('TOOLNOISE')
  })
})

describe('提示词拼装：空的东西不炸也不留空标题', () => {
  it('本节点提示词为空串 ⇒ 提示词以本回合行动结尾（它是历史块的最后一条）', async () => {
    const card = makeCard()
    // 上游也关掉：否则「最后一段」是上游（它排在本节点之前、历史之后）
    const node = { ...outputOf(card), prompt: '', readsUpstream: [] }
    const text = await promptOf({ card, node, outputs: {} })
    expect(text).not.toContain('NODE_OUT')
    expect(text.trimEnd().endsWith('act four')).toBe(true)
  })

  it('只带开场、什么都读不到的卡也拼得出：只剩本回合行动与本节点提示词', async () => {
    const card = makeCard({
      prompts: [{ ...OPENING_PROMPT }],
      state: [{ code: '0', name: 'time', note: '', type: 'string', initial: { day: 1, hour: 8 } }],
    })
    const node = { ...outputOf(card), reads: [], historyTurns: 1, readsUpstream: [], prompt: 'NODE_OUT' }
    const text = await promptOf({ card, save: makeSave(card), node, outputs: {} })
    expect(text).toContain('act four')
    expect(text.trimEnd().endsWith('NODE_OUT')).toBe(true)
  })
})
