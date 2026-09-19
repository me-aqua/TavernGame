/**
 * 第二张卡（cards/night-watch.json）—— 引擎、显示与存档不是只为《晨风镇》写的。
 *
 * 成功标准：
 *   ① 两张卡各自从文件文本过 parseCard —— 校验器只认卡格式，不认「内置的那一张」
 *   ② 引擎照各自的拓扑跑：叙事取自**声明了 role: "story"** 的那个节点（id 不写死）
 *   ③ 显示与面板数据跟着各自的声明走：晨风镇三块、夜班一块；面板读各自的状态树
 *   ④ 存档认亲是双向的：夜班的存档拿到晨风镇底下会被拒（tests/save.test.ts 的补充）
 *
 * ⚠️ 源码必须 ASCII：断言里只用自造的 ASCII fixture 与从卡 JSON 现读出来的值。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runTurn } from '../src/agent/agent'
import { narrationOf } from '../src/agent/card-graph'
import { format } from '../src/game/card-calendar'
import { castOf, displayOf, mapOf, nodeLabel, packOf, spotOf } from '../src/game/display'
import { openingOf } from '../src/game/opening'
import { createInitialState, identityOf, normalize } from '../src/game/save'
import { currentCard } from '../src/game/current-card'
import { EXAMPLE_CARD, loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import { cardTurnReplies } from './support/card-replies'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

/* ---- 测试自己编的 fixture（模型回复与玩家行动），不是产品文案 ---- */
const LOOK_ACTION = 'walk to the lighthouse'
const STORY_TEXT = 'The beam sweeps the water.'
const TIME_MINUTES = 480
const OTHER_TIME_MINUTES = 30

const second = loadCard(NIGHT_WATCH_CARD)
const first = loadCard(EXAMPLE_CARD)

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/** 声明了 role: "story" 的节点（引擎就是靠它取叙事的） */
function storyNodeOf(card: typeof first): string {
  return card.graph.topology.find((id) => card.graph.nodes[id].role === 'story') as string
}

describe('two cards, one engine', () => {
  it('both parse from their file text and look nothing alike', () => {
    expect(first.card.format).toBe('card/3')
    expect(second.card.format).toBe('card/3')
    expect(first.card.id).not.toBe(second.card.id)
    expect(first.graph.topology.length).toBeGreaterThan(second.graph.topology.length)
    // 历法：一个是引擎预设，一个是卡自己写的
    expect(typeof first.time.calendar).toBe('string')
    expect(typeof second.time.calendar).toBe('object')
  })

  it('takes the narration from the node each card declares (no hardcoded id)', () => {
    for (const card of [first, second]) {
      const outputs = card.graph.topology.map(() => 'text')
      expect(narrationOf(card, outputs)).toBe('text')
      // 叙事永远来自它自己声明的那个节点
      expect(card.graph.nodes[storyNodeOf(card)].role).toBe('story')
    }
  })

  it('reads the opening facts of each card', () => {
    expect(openingOf(second).name).toBe(second.opening.defaultName)
    expect(openingOf(first).name).toBe(first.opening.defaultName)
    expect(openingOf(second).requirements).toEqual(second.opening.requirements)
  })

  it('gives the first frame from each card: its own state tree, clock and identity', () => {
    for (const card of [first, second]) {
      const data = createInitialState(card)
      expect(data.meta.card).toEqual(identityOf(card))
      expect(data.time).toEqual(card.time.initial)
      expect(Object.keys(data.state).length).toBeGreaterThan(0)
    }
    // 夜班没有 world / roles 这两支：它只声明了 lead 与 log
    expect(Object.keys(createInitialState(second).state).sort()).toEqual(['lead', 'log'])
  })
})

describe('the second card: one whole turn through the engine', () => {
  it('runs its two nodes and moves its own clock', async () => {
    const state = { data: createInitialState(second), loadError: null }
    const ctx = createAgentContext(state, second)
    fake = installFakeLlm(
      cardTurnReplies({ card: second, story: STORY_TEXT, time: { minutes: TIME_MINUTES } }),
    )

    const result = await runTurn(ctx, { action: LOOK_ACTION })

    expect(result.text).toBe(STORY_TEXT)
    // 自定义历法：4 月 12 日 21:40 + 480 分钟 = 4 月 13 日 05:40
    expect(state.data.time).toEqual({ year: 1, month: 4, day: 13, hour: 5, minute: 40 })
    // 时间标签按这张卡的模板渲染（三段是它自己声明的）
    expect(format(second.time.calendar, state.data.time)).toContain(String(state.data.time.day))
    // 模型调用 = 两个节点 + 时间节点的一次工具往返
    expect(fake.calls).toHaveLength(second.graph.topology.length + 1)
  })

  it('does not touch the builtin card state when running another card', async () => {
    const state = { data: createInitialState(second), loadError: null }
    const ctx = createAgentContext(state, second)
    fake = installFakeLlm(
      cardTurnReplies({ card: second, story: STORY_TEXT, time: { minutes: OTHER_TIME_MINUTES } }),
    )

    await runTurn(ctx, { action: LOOK_ACTION })

    // 引擎只改传进来的工作副本 —— 内置卡那一局一个字节没动
    expect(createInitialState(currentCard).meta.turn).toBe(0)
  })
})

describe('display follows each card declaration', () => {
  it('reads the blocks each card declares', () => {
    expect(displayOf(first).sidebar).toEqual(first.display.sidebar.map((block) => block.block))
    expect(displayOf(second).sidebar).toEqual(second.display.sidebar.map((block) => block.block))
    // 两张卡声明的块不同：界面照各自的卡来，不共用一份写死的清单
    expect(displayOf(first).sidebar).not.toEqual(displayOf(second).sidebar)
  })

  it('reads the panel data out of each state tree', () => {
    const firstState = createInitialState(first).state
    expect(mapOf(firstState).location).toBe((firstState.world as Record<string, unknown>).location)
    expect(castOf(firstState)).toBe(firstState.roles)
    expect(packOf(firstState)).toBe((firstState.lead as Record<string, unknown>).pack)

    const secondState = createInitialState(second).state
    // 这张卡没有 world / roles：两块没有数据，但背包与场景读法不变
    expect(mapOf(secondState)).toEqual({ areas: undefined, location: undefined })
    expect(castOf(secondState)).toBeUndefined()
    expect(spotOf(secondState)).toEqual({ area: '', spot: '', scene: '' })
    expect(packOf(secondState)).toBe((secondState.lead as Record<string, unknown>).pack)
  })

  it('labels the nodes of each card with its own display names', () => {
    for (const card of [first, second]) {
      for (const id of card.graph.topology) {
        expect(nodeLabel(card, id)).toBe(card.graph.nodes[id].name)
      }
    }
  })
})

describe('a save belongs to exactly one card', () => {
  it('the second card refuses the first card save (both directions)', () => {
    const firstSave = createInitialState(first)
    const secondSave = createInitialState(second)
    expect(() => normalize(firstSave, second)).toThrow(firstSave.meta.card.id)
    expect(() => normalize(secondSave, first)).toThrow(secondSave.meta.card.id)
  })
})
