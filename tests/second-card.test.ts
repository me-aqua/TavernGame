/**
 * 第二张卡（cards/long-night.json）—— 卡格式与执行器不是只为《晨风镇》写的。
 *
 * 四条成功标准：
 *   ① 从文件文本过 parseCard —— 校验器只认卡格式，不认「内置的那一张」
 *   ② 用假模型把这张卡的一回合跑完：调用次数 = 节点数（从卡里数）、叙事取自 story
 *      节点的「正文」、时间按 time 节点的「推进」真的走了、事件流与存档形状正常
 *   ③ 渲染器渲染得出来，而且内容不丢（每个字符串叶子都在产物里）
 *   ④ 把关键字段改坏必须被拒 —— 校验器对这张卡同样可证伪
 *
 * ⚠️ 源码必须 ASCII：断言里只用 card-keys 的常量、自造的 ASCII fixture（玩家行动与
 *    模型回复），以及从卡 JSON 现读出来的值 —— 不在这里抄一份卡里的中文。
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCard, validateCard } from '../src/game/card'
import { displayOf } from '../src/game/display'
import { openingOf } from '../src/game/opening'
import { createInitialState } from '../src/game/save'
import { addEvent, endTurn, iso, save, snapshot, type GameState } from '../src/game/state'
import { STORY_NODE, TIME_NODE, graphOfCard, narrationOf } from '../src/agent/card-graph'
import { executeGraph } from '../src/agent/graph'
import { topbarItems, worldBlocks } from '../src/components/display-blocks'
import { renderCard } from '../tools/render-card.mjs'
import {
  CN_FIVE,
  CN_FOUR,
  CN_THREE,
  KEY_AREA,
  KEY_CARD,
  KEY_CONVENTION,
  KEY_DECL,
  KEY_DEFAULT_NAME,
  KEY_DISPLAY,
  KEY_GENERATORS,
  KEY_GRAPH,
  KEY_ID,
  KEY_NAME,
  KEY_NAMED_NPCS,
  KEY_NODES,
  KEY_NOTES,
  KEY_OPENING,
  KEY_PLACES,
  KEY_PRINCIPLE,
  KEY_PROMPT,
  KEY_SCENE,
  KEY_SETTING,
  KEY_SIDEBAR,
  KEY_START,
  KEY_START_TIME,
  KEY_STATE,
  KEY_TOPOLOGY,
  KEY_WORLD,
} from '../src/game/card-keys'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { stringLeaves } from './support/card-leaves'
import { advanceTimeCall } from './support/card-replies'
import { configureFakeProvider } from './support/game-fixtures'
import { installFakeLlm, type FakeLlm, type FakeReply } from './support/fakeLlm'
import type { GameData } from '../src/types/state'
import type { SaveStore } from '../src/utils/storage'

/** 第二张卡 —— 它是这一组用例的唯一事实来源（内容全部现读，测试里不抄一份） */
const SECOND_CARD = 'cards/long-night.json'
const CARD_TEXT = readFileSync(SECOND_CARD, 'utf8')
const card = parseCard(CARD_TEXT)

/** 声明（已校验）—— 用例从这里取图 / 世界 / 开局 / 显示 */
const decl = card[KEY_DECL] as Record<string, any>
const graph = decl[KEY_GRAPH] as Record<string, any>
const topology = graph[KEY_TOPOLOGY] as string[]

/** 反例断言用的 JSON 路径前缀 */
const GRAPH_NODES_PATH = KEY_DECL + '.' + KEY_GRAPH + '.' + KEY_NODES
const STATE_NOTE_PATH = KEY_NOTES + '.' + KEY_STATE
const GENERATOR_PATH = KEY_DECL + '.' + KEY_GENERATORS + '[0].' + KEY_PRINCIPLE + '[0]'
const CONVENTION_PATH = KEY_PROMPT + '.' + KEY_CONVENTION

/** 测试自造的 fixture（玩家行动、模型回复、推进量）—— 不是产品文案 */
const LOOK_ACTION = 'walk to the bridge'
const STORY_TEXT = 'The long night goes on.'
const TIME_STEP = { step: 6, unit: 'hour', reason: 'three decks down to the bridge' }
/** 时间节点工具往返之后回的那段文字（它是上游，不是叙事） */
const TIME_TEXT = 'the clock moved'
const HOUR_MS = 3600000

/** 渲染器逐节点上游清单的行首标记与第一个圈号 —— 源码 ASCII，码点拼出来 */
const UPSTREAM_LINE = new RegExp('^' + String.fromCharCode(0xb7) + ' ', 'gm')
const CIRCLED_ZERO = 0x24ea

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/** 造一局第二张卡的游戏：开局事实来自这张卡，不经过 currentCard（那是应用绑的那张） */
function stateOfTheSecondCard(): GameState {
  return { data: createInitialState(openingOf(card)), loadError: null }
}

/**
 * 按这张卡自己的拓扑造一轮假回复 —— 节点数、顺序、谁管时间都从卡里来，
 * 不照抄另一张卡的节点形状；出现第三个节点就当场抛错（这张卡不该有）。
 *
 * ⚠️ 时间节点走**原生工具调用**：先回一条 advance_time 的 tool_calls，引擎执行完
 *    再问一次，它才回文字 —— 所以它在回复序列里占两个槽位。
 */
function repliesForCard(over: { story?: string } = {}): FakeReply[] {
  return topology.flatMap((id) => {
    if (id === TIME_NODE) return [advanceTimeCall(TIME_STEP), TIME_TEXT]
    if (id === STORY_NODE) return [over.story ?? STORY_TEXT]
    throw new Error('the second card has a node the fake does not know: ' + id)
  })
}

/** 深拷贝卡文本再改坏一处：反例因此能归因到那一处，原始卡也不受污染 */
function broken(change: (copy: any) => void): unknown {
  const copy = JSON.parse(CARD_TEXT)
  change(copy)
  return copy
}

/** 跑一次校验，把错误读成文本（通过了就返回空串） */
function errorOf(candidate: unknown): string {
  try {
    validateCard(candidate)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('the second card: the shape the engine needs', () => {
  it('parses from the file text and is nothing like the example card', () => {
    const example = JSON.parse(readFileSync(EXAMPLE_CARD, 'utf8'))
    expect((card[KEY_CARD] as any)[KEY_ID]).not.toBe(example[KEY_CARD][KEY_ID])
    expect(topology).toHaveLength(2)
    expect(topology.length).toBeLessThan((example[KEY_DECL][KEY_GRAPH][KEY_TOPOLOGY] as string[]).length)
  })

  it('uses exactly the two node ids the engine consumes, in the order it declares', () => {
    expect(topology).toEqual([TIME_NODE, STORY_NODE])
    expect(Object.keys(graph[KEY_NODES])).toEqual(topology)
    expect(Object.keys((card[KEY_PROMPT] as any)[KEY_NODES])).toEqual(topology)
  })

  it('names no NPC and declares no sidebar block', () => {
    expect((decl[KEY_WORLD] as any)[KEY_NAMED_NPCS]).toEqual([])
    expect((decl[KEY_DISPLAY] as any)[KEY_SIDEBAR]).toEqual([])
    // 界面那一侧的读法：校验器与渲染映射两侧都收空侧栏 —— 零块，不是坏声明；
    // 顶栏三条照样映射得出来（三个名字写错一个，这里就会抛错）
    const display = displayOf(card)
    expect(display.sidebar).toEqual([])
    expect(worldBlocks(display)).toEqual([])
    expect(topbarItems(display)).toEqual(['time', 'scene', 'turn'])
  })

  it('gives the first frame from its own opening facts', () => {
    const state = stateOfTheSecondCard()
    const opening = decl[KEY_OPENING] as any
    expect(state.data.time.iso).toBe(opening[KEY_START_TIME])
    expect(state.data.scene.name).toBe(opening[KEY_START][KEY_SCENE])
    expect(state.data.player.name).toBe(opening[KEY_DEFAULT_NAME])
  })
})

describe('the second card: one whole turn', () => {
  it('calls once per node, narrates the story node and advances time by the time node', async () => {
    fake = installFakeLlm(repliesForCard())
    const state = stateOfTheSecondCard()
    const startIso = iso(state)

    // 引擎的顺序：记玩家行动 → 定快照 → 跑图（工具随手执行）→ 取正文 → 记叙事 → 回合 +1
    addEvent(state, 'action', LOOK_ACTION)
    const visited: string[] = []
    const outputs = await executeGraph(
      graphOfCard({ card, state, snapshot: snapshot(state), history: [], playerWords: LOOK_ACTION }),
      { onEvent: (evt) => visited.push(evt.id) },
    )
    const text = narrationOf(card, outputs)
    addEvent(state, 'narration', text)
    endTurn(state)

    // ① 每个节点至少问一次，顺序 = 拓扑；时间节点多一次工具往返
    expect(fake.calls).toHaveLength(topology.length + 1)
    expect(outputs).toHaveLength(topology.length)
    expect(visited).toEqual(topology)

    // ② 每次请求都是照这张卡拼的：system 里逐条出现它自己的五块设定
    const setting = (card[KEY_PROMPT] as any)[KEY_SETTING] as Record<string, string[]>
    const system = fake.calls[0].body.messages?.[0]?.content ?? ''
    for (const lines of Object.values(setting)) {
      for (const line of lines) expect(system).toContain(line)
    }
    // 每个节点的每一次请求都带着它自己那一份提示词（时间节点问了两次）
    const prompts = (card[KEY_PROMPT] as any)[KEY_NODES] as Record<string, string[]>
    let at = 0
    for (const id of topology) {
      for (let n = 0; n < (id === TIME_NODE ? 2 : 1); n += 1) {
        // ⚠️ 工具往返那一次的**最后一条**是 role:'tool'，所以找最后一条 user
        const lastUser = [...(fake.calls[at].body.messages ?? [])].reverse().find((m) => m.role === 'user')
        expect(lastUser?.content ?? '').toContain(prompts[id][0])
        at += 1
      }
    }
    expect(at).toBe(fake.calls.length)
    // 工具的结果以 role:'tool' 回传给模型（时间节点的第二次请求里带着）
    const followUp = fake.calls[1].body.messages ?? []
    expect(followUp.some((m) => m.role === 'tool')).toBe(true)
    // 上游 = 拓扑前缀：后跑的 story 拿得到 time 本轮产出的**文字**
    expect(fake.calls.at(-1)?.body.messages?.at(-1)?.content ?? '').toContain(TIME_TEXT)

    // ③ 叙事取自 story 节点的文字（不是模型返回的 JSON 块，也不是工具参数）
    expect(text).toBe(STORY_TEXT)
    expect(state.data.events.at(-1)?.text).toBe(STORY_TEXT)
    expect(text).not.toContain('advance_time')

    // ④ 时间按「推进」真的走了；理由进了时间线
    expect(Date.parse(iso(state)) - Date.parse(startIso)).toBe(TIME_STEP.step * HOUR_MS)
    expect(state.data.timeline).toHaveLength(1)
    expect(state.data.timeline[0].reason).toBe(TIME_STEP.reason)

    // ⑤ 事件流与回合数：一条行动 + 一条叙事
    expect(state.data.events.map((event) => event.kind)).toEqual(['action', 'narration'])
    expect(state.data.meta.turn).toBe(1)

    // ⑥ 存档形状：落盘的就是内存里那份，字段还是引擎认的那几个
    const write = vi.fn((_data: GameData) => true)
    const store: SaveStore = { save: write }
    expect(save(state, store)).toBe(true)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe(state.data)
    expect(Object.keys(state.data)).toEqual(['meta', 'player', 'scene', 'time', 'events', 'timeline'])
  })
})

describe('the second card: the renderer', () => {
  const raw = JSON.parse(CARD_TEXT)
  const markdown = renderCard(raw, SECOND_CARD)

  it('keeps every string leaf of this card', () => {
    const missing = stringLeaves(raw).filter((leaf) => !markdown.includes(leaf))
    expect(missing).toEqual([])
  })

  it('renders its own title and derives the upstream list from its own topology', () => {
    expect(markdown.startsWith('# ')).toBe(true)
    expect(markdown).toContain((card[KEY_CARD] as any)[KEY_NAME])
    expect(markdown).toContain(SECOND_CARD)
    expect(markdown.match(UPSTREAM_LINE)).toHaveLength(topology.length)
    expect(markdown).toContain(String.fromCodePoint(CIRCLED_ZERO))
  })
})

describe('the second card: the checks that can be falsified', () => {
  it('rejects a topology id that has no node', () => {
    const candidate = broken((copy) => {
      copy[KEY_DECL][KEY_GRAPH][KEY_TOPOLOGY].push('ghost')
    })
    expect(errorOf(candidate)).toContain(GRAPH_NODES_PATH)
  })

  it('rejects a state note whose segment count disagrees with the schema', () => {
    const candidate = broken((copy) => {
      copy[KEY_NOTES][KEY_STATE] = (copy[KEY_NOTES][KEY_STATE] as string).replace(CN_THREE, CN_FOUR)
    })
    expect(errorOf(candidate)).toContain(STATE_NOTE_PATH)
  })

  it('rejects a place count that disagrees with the generator principle', () => {
    const candidate = broken((copy) => {
      copy[KEY_DECL][KEY_WORLD][KEY_AREA][0][KEY_PLACES].push('extra place')
    })
    expect(errorOf(candidate)).toContain(GENERATOR_PATH)
  })

  it('rejects a convention that declares the wrong number of setting blocks', () => {
    const candidate = broken((copy) => {
      copy[KEY_PROMPT][KEY_CONVENTION] = (copy[KEY_PROMPT][KEY_CONVENTION] as string[]).map((line) =>
        line.replace(CN_FIVE, CN_FOUR),
      )
    })
    expect(errorOf(candidate)).toContain(CONVENTION_PATH)
  })

  it('fails fast when the card loses a node the engine consumes', () => {
    const candidate = broken((copy) => {
      const copyGraph = copy[KEY_DECL][KEY_GRAPH]
      copyGraph[KEY_TOPOLOGY] = (copyGraph[KEY_TOPOLOGY] as string[]).filter((id) => id !== STORY_NODE)
      delete copyGraph[KEY_NODES][STORY_NODE]
      delete copy[KEY_PROMPT][KEY_NODES][STORY_NODE]
    })
    // 少一个节点的图本身合法，但引擎要的正文没出处了 —— 抛错，不静默给一个空回合
    const stillValid = validateCard(candidate)
    const outputs = [TIME_TEXT]
    expect(() => narrationOf(stillValid, outputs)).toThrow(new RegExp(STORY_NODE))
  })
})
