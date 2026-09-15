/**
 * 提示词装配测试。
 *
 * 提示词分两处：卡里的（作者写，引擎只读）与 `prompts/<lang>/*.md`（引擎自带）。
 * 这里断言的重点：
 *   - 公共部分的顺序与内容：五块设定（固定顺序）+ 剧本 + 历法 + 节点约定
 *   - 一次节点请求的结构：system + 全部历史 + user（快照 + 玩家原话 + 上游 + 节点提示词）
 *   - 上游按给定顺序累加；拿不到就不编内容（决定 #26/#36）
 *   - 模型语言跟随界面语言（引擎写的那部分；卡的内容不随语言变）
 *
 * 期望值从示例卡的 JSON 现读，不在这里抄第二份 —— 卡改了，断言跟着卡走。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildNodeMessages,
  calendarPrompt,
  cardSystemPrompt,
  connectionTestPrompt,
  conventionPrompt,
  nodePrompt,
  openingInstruction,
  renderPrompt,
  scriptPrompt,
  settingsPrompt,
} from '../src/agent/prompts'
import { currentCard } from '../src/game/current-card'
import * as K from '../src/game/card-keys'
import { i18n, t } from '../src/i18n'
import type { UpstreamOutput } from '../src/game/state'
import type { ChatMessage } from '../src/types/state'

const readPrompt = (lang: string, name: string): string =>
  readFileSync('prompts/' + lang + '/' + name + '.md', 'utf8').trim()

const calendarMarkdown = readPrompt('zh-CN', 'calendar')
const openingMarkdown = readPrompt('zh-CN', 'opening')
const openingMarkdownEn = readPrompt('en', 'opening')

const card = currentCard as Record<string, unknown>
const decl = card[K.KEY_DECL] as Record<string, unknown>
const graph = decl[K.KEY_GRAPH] as Record<string, unknown>
const topology = graph[K.KEY_TOPOLOGY] as string[]
const prompts = card[K.KEY_PROMPT] as Record<string, unknown>
const settings = prompts[K.KEY_SETTING] as Record<string, string[]>
const convention = prompts[K.KEY_CONVENTION] as string[]
const nodePrompts = prompts[K.KEY_NODES] as Record<string, string[]>
const FIRST_NODE = topology[0]

/** 测试自己编的 fixture（玩家行动与上游产出） */
const PLAYER_WORDS = "Player's action: I go to the docks"
const SNAPSHOT = 'SNAPSHOT LINES'
const EARLIER = 'EARLIER LINE'

/** 切界面语言（setup 在每个用例前钉回 zh-CN） */
function setLocale(locale: 'zh-CN' | 'en'): void {
  ;(i18n.global.locale as unknown as { value: string }).value = locale
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
      for (const name of ['calendar', 'opening', 'connection-test']) {
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
  it('renders the five setting blocks in the fixed order, each line verbatim', () => {
    const text = settingsPrompt(currentCard)
    expect(text).toContain('## ' + K.KEY_SETTING)
    let cursor = 0
    for (const block of K.SETTING_BLOCKS) {
      const at = text.indexOf('### ' + block)
      expect(at, block + ' must be there').toBeGreaterThan(-1)
      expect(at, block + ' must come after the previous block').toBeGreaterThan(cursor)
      cursor = at
      for (const line of settings[block]) expect(text).toContain(line)
    }
  })

  it('renders the script through a shape-agnostic renderer (nested values included)', () => {
    const text = scriptPrompt(currentCard)
    expect(text).toContain('## ' + K.KEY_SCRIPT)
    // 最深一层的字符串也要原样出现 —— 渲染器不认字段名，只按形状摊开
    const leaves: string[] = []
    /** 递归收集剧本里所有的字符串 —— 渲染器不认字段名，断言只看内容在不在 */
    const walk = (value: unknown): void => {
      if (typeof value === 'string') leaves.push(value)
      else if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') Object.values(value).forEach(walk)
    }
    walk(prompts[K.KEY_SCRIPT])
    const longest = leaves.sort((a, b) => b.length - a.length)[0]
    expect(text).toContain(longest)
  })

  it('renders the node convention verbatim (it is part of every request)', () => {
    const text = conventionPrompt(currentCard)
    expect(text).toContain('## ' + K.KEY_CONVENTION)
    for (const line of convention) expect(text).toContain(line)
  })

  it('titles a node prompt with the display name the card gave it', () => {
    const node = graph[K.KEY_NODES] as Record<string, Record<string, unknown>>
    const text = nodePrompt(currentCard, FIRST_NODE)
    expect(text).toContain('## ' + String(node[FIRST_NODE][K.KEY_NODE_NAME]))
    for (const line of nodePrompts[FIRST_NODE]) expect(text).toContain(line)
  })

  it('puts the sections in the order the card convention promises', () => {
    const text = cardSystemPrompt(currentCard)
    const order = [K.KEY_SETTING, K.KEY_SCRIPT, t('snapshot.turn', { turn: 0 })]
    // 历法与节点约定在剧本之后；快照不在 system 里（它进 user）
    expect(text.indexOf('## ' + K.KEY_SETTING)).toBeLessThan(text.indexOf('## ' + K.KEY_SCRIPT))
    expect(text.indexOf('## ' + K.KEY_SCRIPT)).toBeLessThan(text.indexOf(calendarPrompt().split('\n')[0]))
    expect(text.indexOf(calendarPrompt().split('\n')[0])).toBeLessThan(text.indexOf('## ' + K.KEY_CONVENTION))
    expect(text).not.toContain(order[2])
  })
})

describe('buildNodeMessages - one request per node', () => {
  const history: ChatMessage[] = [{ role: 'assistant', content: EARLIER }]
  const upstream: UpstreamOutput[] = [
    { node: topology[0], output: 'FIRST OUTPUT' },
    { node: topology[1], output: 'SECOND OUTPUT' },
  ]

  it('lays out system, the whole history, then the task message', () => {
    const messages = buildNodeMessages({
      card: currentCard,
      snapshot: SNAPSHOT,
      history,
      playerWords: PLAYER_WORDS,
      upstream,
      node: topology[2],
    })

    expect(messages.map((m) => m.role)).toEqual(['system', 'assistant', 'user'])
    expect(messages[0].content).toBe(cardSystemPrompt(currentCard))

    const user = messages.at(-1)?.content ?? ''
    expect(user.startsWith(SNAPSHOT)).toBe(true)
    expect(user).toContain(PLAYER_WORDS)
    // 上游：前面每个节点一段，按给定顺序，标题走 locale
    for (const item of upstream) {
      expect(user).toContain(t('snapshot.upstreamNode', { node: item.node }))
      expect(user).toContain(item.output)
    }
    expect(user.indexOf(upstream[0].output)).toBeLessThan(user.indexOf(upstream[1].output))
    // 自己的提示词在最后
    expect(user).toContain(nodePrompt(currentCard, topology[2]))
    expect(user.indexOf(upstream[1].output)).toBeLessThan(user.indexOf(nodePrompts[topology[2]][0]))
  })

  it('omits the upstream section when there is no upstream (no invented headings)', () => {
    const user =
      buildNodeMessages({
        card: currentCard,
        snapshot: SNAPSHOT,
        history: [],
        playerWords: PLAYER_WORDS,
        upstream: [],
        node: FIRST_NODE,
      }).at(-1)?.content ?? ''
    for (const id of topology) expect(user).not.toContain(t('snapshot.upstreamNode', { node: id }))
  })

  it('has no unfilled placeholders anywhere in the request', () => {
    const messages = buildNodeMessages({
      card: currentCard,
      snapshot: SNAPSHOT,
      history,
      playerWords: PLAYER_WORDS,
      upstream,
      node: FIRST_NODE,
    })
    expect(JSON.stringify(messages)).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })
})

describe('model language follows the UI language', () => {
  /**
   * ⚠️ 卡的内容是作者写的，**不随语言变**；随语言变的是引擎写的那部分
   *    （历法说明、快照标签）。这条测试两边都要盯住。
   */
  it('switches the engine-written calendar but keeps the card content as written', () => {
    setLocale('zh-CN')
    const zh = cardSystemPrompt(currentCard)
    const zhCalendar = calendarPrompt()
    const zhSnapshotTurn = t('snapshot.turn', { turn: 0 })

    setLocale('en')
    const en = cardSystemPrompt(currentCard)
    const enCalendar = calendarPrompt()
    const enSnapshotTurn = t('snapshot.turn', { turn: 0 })

    expect(
      zhSnapshotTurn,
      'the snapshot label must differ per locale, or the assertions below are vacuous',
    ).not.toBe(enSnapshotTurn)

    expect(zhCalendar, 'zh calendar must contain CJK').toMatch(/[\u4e00-\u9fff]/)
    expect(enCalendar, 'en calendar must be ASCII English').not.toMatch(/[\u4e00-\u9fff]/)
    expect(zh).not.toBe(en)
    expect(zh).toContain(zhCalendar)
    expect(en).toContain(enCalendar)

    // 卡的内容两版都在（作者写什么就是什么）
    for (const block of K.SETTING_BLOCKS) {
      expect(zh).toContain('### ' + block)
      expect(en).toContain('### ' + block)
    }
    // 中文卡的内容本来就带中文：英文界面下也一样（不翻译卡）
    expect(en).toContain(settings[K.SETTING_BLOCKS[0]][0])
  })

  it('picks the matching language for the standalone instructions too', () => {
    setLocale('zh-CN')
    expect(openingInstruction()).toMatch(/[\u4e00-\u9fff]/)
    expect(calendarPrompt()).toBe(calendarMarkdown)

    setLocale('en')
    expect(openingInstruction()).not.toMatch(/[\u4e00-\u9fff]/)
    expect(calendarPrompt()).toMatch(/unit/)
    expect(connectionTestPrompt().length).toBeLessThan(60)
  })
})
