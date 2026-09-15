/**
 * 提示词装配测试。
 *
 * 提示词分两处：卡里的（作者写，引擎只读）与 `prompts/<lang>/*.md`（引擎自带）。
 * 这里断言的重点：
 *   - system = 五块设定（卡里声明的顺序）+ 剧本 + 规矩 + 该节点 uses 点名的生成器；
 *     **没有「你能做什么」那一节** —— 工具的名字与说明只走原生 tools 协议
 *   - user = 现在（时间 + 状态）+ 历史 + 玩家 + 本轮上游 + 该节点提示词
 *   - 模型语言跟随界面语言（引擎写的那部分；卡的内容不随语言变）
 *
 * 期望值从示例卡的 JSON 现读，不在这里抄第二份 —— 卡改了，断言跟着卡走。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildNodeMessages,
  cardSystemPrompt,
  connectionTestPrompt,
  conventionPrompt,
  generatorsPrompt,
  nodePrompt,
  openingInstruction,
  RECENT_STORY,
  renderPrompt,
  scriptPrompt,
  settingsPrompt,
  upstreamText,
} from '../src/agent/prompts'
import { currentCard } from '../src/game/current-card'
import { createInitialState } from '../src/game/save'
import { renderState } from '../src/game/card-state'
import { format } from '../src/game/card-calendar'
import { i18n, t } from '../src/i18n'
import type { GameData, GameEvent } from '../src/types/state'

const readPrompt = (lang: string, name: string): string =>
  readFileSync('prompts/' + lang + '/' + name + '.md', 'utf8').trim()

const openingMarkdown = readPrompt('zh-CN', 'opening')
const openingMarkdownEn = readPrompt('en', 'opening')

const topology = currentCard.graph.topology
const FIRST_NODE = topology[0]
const NODE_WITH_USES = topology.find((id) => (currentCard.graph.nodes[id].uses ?? []).length > 0) as string
const NODE_WITHOUT_USES = topology.find(
  (id) => (currentCard.graph.nodes[id].uses ?? []).length === 0,
) as string

/** 测试自己编的 fixture（玩家行动与上游产出） */
const PLAYER_WORDS = "Player's action: I go to the docks"
const EARLIER = 'EARLIER LINE'
const UPSTREAM_OUTPUT = 'UPSTREAM OUTPUT'

/** 切界面语言（setup 在每个用例前钉回 zh-CN） */
function setLocale(locale: 'zh-CN' | 'en'): void {
  ;(i18n.global.locale as unknown as { value: string }).value = locale
}

/** 造一次节点请求（默认用示例卡的第一帧、空的事件流） */
function messagesFor(
  node: string,
  data: GameData = createInitialState(currentCard),
  events: GameEvent[] = [],
  memoryUpTo: number = events.length,
) {
  return buildNodeMessages({
    card: currentCard,
    node,
    state: data.state,
    time: data.time,
    events,
    memoryUpTo,
    playerWords: PLAYER_WORDS,
    upstream: [],
  })
}

/** 一条请求的 system / user 文本 */
function systemOf(node: string, data?: GameData): string {
  return messagesFor(node, data)[0].content
}

function userOf(
  node: string,
  data?: GameData,
  events: GameEvent[] = [],
  memoryUpTo: number = events.length,
): string {
  return messagesFor(node, data, events, memoryUpTo).at(-1)?.content ?? ''
}

describe('renderPrompt', () => {
  it('fills placeholders', () => {
    expect(renderPrompt('Hello {{name}}!', { name: 'world' })).toBe('Hello world!')
  })

  it('replaces every occurrence of the same placeholder', () => {
    expect(renderPrompt('{{X}} and {{X}}', { X: 'a' })).toBe('a and a')
  })

  it('throws when a placeholder is left unfilled (never send {{X}} to the model)', () => {
    expect(() => renderPrompt('Hello {{missing}}', { unrelated: 'x' })).toThrow(
      t('prompts.unfilled', { names: '{{missing}}' }),
    )
  })
})

describe('engine prompt files', () => {
  it('have no BOM, no invalid UTF-8 and no CRLF', () => {
    for (const lang of ['zh-CN', 'en']) {
      for (const name of ['opening', 'connection-test']) {
        const text = readPrompt(lang, name)
        expect(text.charCodeAt(0), lang + '/' + name + ' has a BOM').not.toBe(0xfeff)
        expect(text.includes('\uFFFD'), lang + '/' + name + ' has invalid bytes').toBe(false)
        expect(text.includes('\r'), lang + '/' + name + ' contains CRLF').toBe(false)
      }
    }
  })

  it('the opening instruction starts the story directly, without meta questions', () => {
    expect(openingInstruction()).toBe(openingMarkdown)
    expect(openingMarkdownEn).toContain('Do not ask meta questions')
    expect(openingMarkdownEn).toContain('just start the story')
  })

  it('keeps the connection test prompt short (token budget)', () => {
    expect(connectionTestPrompt().length).toBeLessThan(60)
  })
})

describe('the card-side sections', () => {
  it('renders the five setting blocks in the card order, each line verbatim', () => {
    const text = settingsPrompt(currentCard)
    expect(text).toContain('## ' + t('prompts.setting'))
    let cursor = 0
    for (const [key, lines] of Object.entries(currentCard.settings)) {
      const at = text.indexOf('### ' + t('prompts.settingBlock.' + key))
      expect(at, key + ' must be there').toBeGreaterThan(-1)
      expect(at, key + ' must come after the previous block').toBeGreaterThan(cursor)
      cursor = at
      for (const line of lines) expect(text).toContain(line)
    }
  })

  it('renders the script through a shape-agnostic renderer (nested values included)', () => {
    const text = scriptPrompt(currentCard)
    expect(text).toContain('## ' + t('prompts.script'))
    // 最深一层的字符串也要原样出现 —— 渲染器不认字段名，只按形状摊开
    const leaves: string[] = []
    /** 递归收集剧本里所有的字符串 —— 渲染器不认字段名，断言只看内容在不在 */
    const walk = (value: unknown): void => {
      if (typeof value === 'string') leaves.push(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(currentCard.script)
    const longest = leaves.sort((a, b) => b.length - a.length)[0]
    expect(text).toContain(longest)
  })

  it('renders the node convention verbatim (it is part of every request)', () => {
    const text = conventionPrompt(currentCard)
    expect(text).toContain('## ' + t('prompts.convention'))
    for (const line of currentCard.convention) expect(text).toContain(line)
  })

  it('titles a node prompt with the display name the card gave it', () => {
    const node = currentCard.graph.nodes[FIRST_NODE]
    const text = nodePrompt(currentCard, FIRST_NODE)
    expect(text).toContain('## ' + node.name)
    for (const line of node.prompt) expect(text).toContain(line)
  })

  it('gives generators only to the nodes that name them (uses)', () => {
    const used = currentCard.graph.nodes[NODE_WITH_USES].uses as string[]
    const text = generatorsPrompt(currentCard, NODE_WITH_USES)
    expect(text).toContain('## ' + t('prompts.generators'))
    for (const name of used) {
      const generator = currentCard.generators.find((entry) => entry.name === name)
      expect(generator).toBeDefined()
      expect(text).toContain(name)
      expect(text).toContain(generator?.principles[0] as string)
      expect(text).toContain(t('prompts.generatorApplies', { text: generator?.applies as string }))
    }
    expect(generatorsPrompt(currentCard, NODE_WITHOUT_USES)).toBe('')
  })

  it('has no unfilled placeholders anywhere in the request', () => {
    expect(JSON.stringify(messagesFor(FIRST_NODE))).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })
})

describe('the system prompt carries no tool manual (the native protocol does)', () => {
  it('never repeats what an action says it does', () => {
    const system = systemOf(FIRST_NODE)
    for (const action of Object.values(currentCard.actions)) {
      expect(system).not.toContain(action.what)
    }
  })

  it('lays out settings, script, convention and generators in that order', () => {
    const system = systemOf(NODE_WITH_USES)
    const at = (needle: string) => system.indexOf(needle)
    expect(at('## ' + t('prompts.setting'))).toBeLessThan(at('## ' + t('prompts.script')))
    expect(at('## ' + t('prompts.script'))).toBeLessThan(at('## ' + t('prompts.convention')))
    expect(at('## ' + t('prompts.convention'))).toBeLessThan(at('## ' + t('prompts.generators')))
  })
})

describe('buildNodeMessages - one request per node', () => {
  it('lays out the system prompt then the task message', () => {
    const messages = messagesFor(FIRST_NODE)
    expect(messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(messages[0].content).toBe(cardSystemPrompt(currentCard, FIRST_NODE))
  })

  it('puts now, the player words, the upstream and the node prompt in that order', () => {
    const data = createInitialState(currentCard)
    const upstream = [{ node: currentCard.graph.nodes[topology[0]].name, output: UPSTREAM_OUTPUT }]
    const user = buildNodeMessages({
      card: currentCard,
      node: topology[1],
      state: data.state,
      time: data.time,
      events: [],
      memoryUpTo: 0,
      playerWords: PLAYER_WORDS,
      upstream,
    }).at(-1)?.content as string

    // 用带 ## 的标题当路标：卡的内容里也可能出现「玩家」这类词
    const order = [
      '## ' + t('prompts.now'),
      '## ' + t('prompts.player'),
      '## ' + t('prompts.upstream'),
      '## ' + currentCard.graph.nodes[topology[1]].name,
    ]
    let cursor = -1
    for (const needle of order) {
      const at = user.indexOf(needle)
      expect(at, needle + ' must be there').toBeGreaterThan(-1)
      expect(at, needle + ' must come after the previous section').toBeGreaterThan(cursor)
      cursor = at
    }
    expect(user).toContain(PLAYER_WORDS)
    expect(user).toContain(UPSTREAM_OUTPUT)
    for (const line of currentCard.graph.nodes[topology[1]].prompt) expect(user).toContain(line)
  })

  it('puts the recent story events inside the now section (the model memory)', () => {
    const data = createInitialState(currentCard)
    const events: GameEvent[] = [
      { kind: 'narration', text: 'long ago', at: '' },
      { kind: 'action', text: 'I look around', at: '' },
      { kind: 'narration', text: EARLIER, at: '' },
    ]
    const user = userOf(FIRST_NODE, data, events)

    expect(user).toContain('### ' + t('prompts.recent'))
    expect(user).toContain(t('prompts.recentLine', { who: t('prompts.player'), text: 'I look around' }))
    expect(user).toContain(t('prompts.recentLine', { who: t('prompts.gm'), text: EARLIER }))
    // 顺序 = 发生顺序；「现在」之后才是「玩家」那一段
    expect(user.indexOf(t('prompts.recent'))).toBeGreaterThan(-1)
    expect(user.indexOf('I look around')).toBeLessThan(user.indexOf(EARLIER))
    expect(user.indexOf(EARLIER)).toBeLessThan(user.indexOf('## ' + t('prompts.player')))
  })

  it('keeps only the tail of the story events (RECENT_STORY lines, no debug noise)', () => {
    const data = createInitialState(currentCard)
    const many: GameEvent[] = Array.from({ length: RECENT_STORY + 5 }, (_, i) => ({
      kind: 'narration',
      text: 'line ' + i,
      at: '',
    }))
    many.push({ kind: 'tool', text: 'debug noise', at: '' })
    const user = userOf(FIRST_NODE, data, many)

    expect(user).toContain('line ' + (RECENT_STORY + 4))
    expect(user).not.toContain('line 0')
    expect(user).not.toContain('debug noise')
  })

  it('only renders the history from before this round (memoryUpTo)', () => {
    const data = createInitialState(currentCard)
    const events: GameEvent[] = [
      { kind: 'action', text: 'last round words', at: '' },
      { kind: 'narration', text: EARLIER, at: '' },
      { kind: 'action', text: 'this round words', at: '' },
    ]
    // 这一轮从下标 2 开始：它的事件照旧在事件流里，但不进历史那一段
    const user = userOf(FIRST_NODE, data, events, 2)

    expect(user).toContain(t('prompts.recentLine', { who: t('prompts.player'), text: 'last round words' }))
    expect(user).toContain(t('prompts.recentLine', { who: t('prompts.gm'), text: EARLIER }))
    expect(user).not.toContain('this round words')
  })

  it('has no recent-stories block when the event stream has no story yet', () => {
    const user = userOf(FIRST_NODE, createInitialState(currentCard), [
      { kind: 'tool', text: 'debug noise', at: '' },
    ])
    expect(user).not.toContain(t('prompts.recent'))
  })

  it('renders the clock through the card calendar and the state through renderState(reads)', () => {
    const data = createInitialState(currentCard)
    const node = FIRST_NODE
    const user = userOf(node, data)
    expect(user).toContain(t('prompts.timeLine', { time: format(currentCard.time.calendar, data.time) }))
    expect(user).toContain(renderState(data.state, { reads: currentCard.graph.nodes[node].reads }))
  })

  it('omits the upstream section when there is no upstream (no invented headings)', () => {
    const user = userOf(FIRST_NODE)
    expect(user).not.toContain(t('prompts.upstream'))
    expect(upstreamText([])).toBe('')
  })

  it('skips upstream segments without output instead of inventing one', () => {
    const text = upstreamText([
      { node: 'a', output: UPSTREAM_OUTPUT },
      { node: 'b', output: '' },
    ])
    expect(text).toContain(UPSTREAM_OUTPUT)
    expect(text).not.toContain('b')
  })

  it('inserts the redo hint as a system message right before the task', () => {
    const data = createInitialState(currentCard)
    const messages = buildNodeMessages({
      card: currentCard,
      node: FIRST_NODE,
      state: data.state,
      time: data.time,
      events: [],
      memoryUpTo: 0,
      playerWords: PLAYER_WORDS,
      upstream: [],
      hint: 'THE HINT',
    })
    expect(messages.map((message) => message.role)).toEqual(['system', 'system', 'user'])
    expect(messages[1].content).toBe('THE HINT')
  })
})

describe('model language follows the UI language', () => {
  /**
   * ⚠️ 卡的内容是作者写的，**不随语言变**；随语言变的是引擎写的那部分
   *    （段落标题、开场指令）。这条测试两边都要盯住。
   */
  it('switches the engine-written headings but keeps the card content as written', () => {
    setLocale('zh-CN')
    const zh = systemOf(FIRST_NODE)
    const zhNow = t('prompts.now')
    const zhSetting = t('prompts.settingBlock.world')

    setLocale('en')
    const en = systemOf(FIRST_NODE)
    const enNow = t('prompts.now')
    const enSetting = t('prompts.settingBlock.world')

    expect(zhNow, 'labels must differ per locale or the assertions below are vacuous').not.toBe(enNow)
    expect(zhSetting).not.toBe(enSetting)
    expect(zh).not.toBe(en)
    expect(zh).toContain(zhSetting)
    expect(en).toContain(enSetting)

    // 卡的内容两版都在（作者写什么就是什么）
    for (const lines of Object.values(currentCard.settings)) expect(en).toContain(lines[0])
  })

  it('picks the matching language for the standalone instructions too', () => {
    setLocale('zh-CN')
    expect(openingInstruction()).toBe(openingMarkdown)
    expect(openingInstruction()).toMatch(/[\u4e00-\u9fff]/)

    setLocale('en')
    expect(openingInstruction()).toBe(openingMarkdownEn)
    expect(openingInstruction()).not.toMatch(/[\u4e00-\u9fff]/)
    expect(connectionTestPrompt().length).toBeLessThan(60)
  })
})
