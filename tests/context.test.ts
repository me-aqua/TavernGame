/**
 * 节点上下文的裁剪：公共部分 + 本轮上游累加（doc/DESIGN.md 第四节、决定 #26/#36）。
 *
 * 这里守两条：
 *   · 默认路径（没有上游）与升级前的 snapshot() **逐字节一样** —— 旧实现冻结成
 *     legacySnapshot 当基线，公共部分一旦被改动这条就会红；
 *   · 上游按给定顺序累加、每段标题走 locale；拿不到产出就不猜、不编占位符。
 */
import { describe, expect, it } from 'vitest'
import * as game from '../src/game/state'
import { isStoryKind } from '../src/game/save'
import { i18n, t } from '../src/i18n'
import { createGame } from './support/game-fixtures'
import type { ChatMessage } from '../src/types/state'

/* ---- 测试自己编的 fixture（非产品文案） ---- */

const PINNED_ISO = '2026-09-14T09:30:00.000Z'
const PLAYER_ACTION = 'I head to the docks'
const GM_REPLY = 'The sea air is salty.'
const LOG_LINE = 'a line from the log'
const DEBUG_NOISE = 'debug noise'
const LONG_TEXT = 'x'.repeat(300)
const WAITED_A_WEEK = 'waited a week'
const SCENE_NAME = 'The Docks'
const SCENE_DESCRIPTION = 'Masts creak in the fog.'

/** 上游产出的两个假片段（节点名与内容都要能区分出顺序） */
const OUTLINE_NODE = 'outline'
const OUTLINE_OUTPUT = '{"beat":"the fog lifts"}'
const JUDGE_NODE = 'judge'
const JUDGE_OUTPUT = '{"check":"hard"}'
const LOST_NODE = 'lost-node'

interface Fixture {
  label: string
  state: game.GameState
  history: ChatMessage[]
}

/** 一批**确定性**的输入：公共部分（快照）的每个分支都要走到 */
function byteFixtures(): Fixture[] {
  const bare = createGame()
  bare.data.time.iso = PINNED_ISO

  const withLog = createGame()
  withLog.data.time.iso = PINNED_ISO
  withLog.data.meta.turn = 7
  withLog.data.scene = { name: SCENE_NAME, description: SCENE_DESCRIPTION }
  game.addEvent(withLog, 'narration', LOG_LINE)
  game.addEvent(withLog, 'action', PLAYER_ACTION)
  game.addEvent(withLog, 'tool', DEBUG_NOISE)
  game.advanceTime(withLog, 1, 'week', WAITED_A_WEEK)
  game.advanceTime(withLog, 1, 'day')

  const withHistory = createGame()
  withHistory.data.time.iso = PINNED_ISO
  withHistory.data.meta.turn = 3
  game.addEvent(withHistory, 'narration', LOG_LINE)
  const history: ChatMessage[] = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'second' },
    { role: 'user', content: 'third\n  with   spaces' },
    { role: 'assistant', content: LONG_TEXT },
    { role: 'user', content: PLAYER_ACTION },
  ]

  const dirtyHistory = createGame()
  dirtyHistory.data.time.iso = PINNED_ISO
  game.addEvent(dirtyHistory, 'narration', LOG_LINE)
  const dirty: ChatMessage[] = [
    null as unknown as ChatMessage,
    { role: 'user', content: '' },
    { role: 'assistant', content: GM_REPLY },
  ]

  const timelineEdges = createGame()
  timelineEdges.data.time.iso = PINNED_ISO
  timelineEdges.data.timeline = [
    { from: 'a', to: '', reason: 'skipped', elapsedMs: 1, at: '' },
    { from: 'b', to: 'to-b', reason: '', elapsedMs: 1, at: '' },
    { from: 'c', to: 'to-c', reason: 'reason-c', elapsedMs: 1, at: '' },
    { from: 'd', to: 'to-d', reason: '', elapsedMs: 1, at: '' },
    { from: 'e', to: 'to-e', reason: 'reason-e', elapsedMs: 1, at: '' },
    { from: 'f', to: 'to-f', reason: '', elapsedMs: 1, at: '' },
    { from: 'g', to: 'to-g', reason: 'reason-g', elapsedMs: 1, at: '' },
  ]

  return [
    { label: 'bare', state: bare, history: [] },
    { label: 'log-and-timeline', state: withLog, history: [] },
    { label: 'history-wins', state: withHistory, history },
    { label: 'dirty-history', state: dirtyHistory, history: dirty },
    { label: 'timeline-edges', state: timelineEdges, history: [] },
  ]
}

/**
 * 升级前的 snapshot() 实现，原样冻结在这里当基线。
 *
 * ⚠️ 故意不重构、不跟随新代码改 —— 它的价值就是「老实现怎么写，输出就得是什么」。
 */
function legacySnapshot(s: game.GameState, history: ChatMessage[] = []): string {
  const place = game.sceneOf(s)
  const lines = [
    t('snapshot.turn', { turn: game.turn(s) }),
    t('snapshot.time', { time: game.timeLabel(s) }),
    t('snapshot.place', { name: place.name }),
    t('snapshot.sceneDescription', { text: place.description }),
  ]

  const recent = history.filter((h) => h && typeof h.content === 'string').slice(-4)
  if (recent.length) {
    lines.push('', t('snapshot.recent'))
    for (const h of recent) {
      const who = h.role === 'user' ? t('snapshot.player') : t('snapshot.gm')
      lines.push(t('snapshot.recentLine', { who, text: h.content.replace(/\s+/g, ' ').slice(0, 160) }))
    }
  } else {
    const story = s.data.events.filter((event) => isStoryKind(event.kind)).slice(-4)
    if (story.length) {
      lines.push('', t('snapshot.recentLog'))
      for (const event of story) {
        lines.push(`- ${event.text.replace(/\s+/g, ' ').slice(0, 160)}`)
      }
    }
  }

  const timelineLines = s.data.timeline
    .slice(-5)
    .filter((entry) => String(entry.to ?? ''))
    .map((entry) =>
      entry.reason
        ? t('snapshot.timelineLine', { to: entry.to, reason: entry.reason })
        : t('snapshot.timelineLineNoReason', { to: entry.to }),
    )
  if (timelineLines.length) {
    lines.push('', t('snapshot.timeline'), ...timelineLines)
  }

  return lines.join('\n')
}

/** 切界面语言（setup 在每个用例前钉回 zh-CN） */
function setLocale(locale: 'zh-CN' | 'en'): void {
  ;(i18n.global.locale as unknown as { value: string }).value = locale
}

describe('contextFor - the public part is byte-identical to the old snapshot', () => {
  it('every fixture comes out exactly as the frozen old implementation', () => {
    for (const fixture of byteFixtures()) {
      expect(game.contextFor(fixture.state, { history: fixture.history }), fixture.label).toBe(
        legacySnapshot(fixture.state, fixture.history),
      )
      expect(game.snapshot(fixture.state, fixture.history), fixture.label).toBe(
        legacySnapshot(fixture.state, fixture.history),
      )
    }
  })
})

describe('contextFor - upstream accumulation', () => {
  it('appends upstream outputs in the given order, each under its own node name', () => {
    const s = createGame()
    const upstream = [
      { node: OUTLINE_NODE, output: OUTLINE_OUTPUT },
      { node: JUDGE_NODE, output: JUDGE_OUTPUT },
    ]
    const out = game.contextFor(s, { upstream })

    // 公共部分在前且逐字节等于无上游的上下文
    expect(out.startsWith(game.snapshot(s, []))).toBe(true)
    // 两段都在，节点名各自出现在自己那段的标题里
    expect(out).toContain(t('snapshot.upstreamNode', { node: OUTLINE_NODE }))
    expect(out).toContain(t('snapshot.upstreamNode', { node: JUDGE_NODE }))
    // 顺序 = 调用方给的顺序（标题与正文都按序）
    expect(out.indexOf(OUTLINE_OUTPUT)).toBeLessThan(out.indexOf(JUDGE_OUTPUT))
    expect(out.indexOf(t('snapshot.upstreamNode', { node: OUTLINE_NODE }))).toBeLessThan(
      out.indexOf(t('snapshot.upstreamNode', { node: JUDGE_NODE })),
    )
    // 标题紧贴在它那段正文前面
    expect(out.indexOf(t('snapshot.upstreamNode', { node: OUTLINE_NODE }))).toBeLessThan(
      out.indexOf(OUTLINE_OUTPUT),
    )
    expect(out.indexOf(t('snapshot.upstreamNode', { node: JUDGE_NODE }))).toBeLessThan(
      out.indexOf(JUDGE_OUTPUT),
    )
  })

  it('respects the order it is given, not some canonical order', () => {
    const s = createGame()
    const reversed = game.contextFor(s, {
      upstream: [
        { node: JUDGE_NODE, output: JUDGE_OUTPUT },
        { node: OUTLINE_NODE, output: OUTLINE_OUTPUT },
      ],
    })
    expect(reversed.indexOf(JUDGE_OUTPUT)).toBeLessThan(reversed.indexOf(OUTLINE_OUTPUT))
  })
})

describe('contextFor - the segment heading comes from the locale table', () => {
  it('localizes the heading in both languages and keeps the node name in it', () => {
    const s = createGame()
    const upstream = [{ node: OUTLINE_NODE, output: OUTLINE_OUTPUT }]
    const headings = new Set<string>()

    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale)
      const heading = t('snapshot.upstreamNode', { node: OUTLINE_NODE })
      expect(heading, locale).toContain(OUTLINE_NODE)
      expect(game.contextFor(s, { upstream }), locale).toContain(heading)
      headings.add(heading)
    }

    // 两种语言给出两句不同的标题 —— 说明它真的来自 locale，不是写死在代码里的
    expect(headings.size).toBe(2)
  })
})

describe('contextFor - no upstream means no guessing', () => {
  it('missing options, an empty array, and missing fields all append nothing', () => {
    const s = createGame()
    s.data.time.iso = PINNED_ISO
    const plain = game.snapshot(s, [])

    expect(game.contextFor(s)).toBe(plain)
    expect(game.contextFor(s, {})).toBe(plain)
    expect(game.contextFor(s, { upstream: [] })).toBe(plain)
    expect(game.contextFor(s, { history: [], upstream: [] })).toBe(plain)

    const incomplete = [
      { node: OUTLINE_NODE } as game.UpstreamOutput,
      { node: '', output: OUTLINE_OUTPUT } as game.UpstreamOutput,
      { node: OUTLINE_NODE, output: '' } as game.UpstreamOutput,
      null as unknown as game.UpstreamOutput,
    ]
    expect(game.contextFor(s, { upstream: incomplete })).toBe(plain)
    // 不编占位符：节点名也不许被写进上下文
    expect(game.contextFor(s, { upstream: incomplete })).not.toContain(OUTLINE_NODE)
  })

  it('skips only the segments without output, keeping the rest', () => {
    const s = createGame()
    s.data.time.iso = PINNED_ISO
    const out = game.contextFor(s, {
      upstream: [
        { node: OUTLINE_NODE, output: OUTLINE_OUTPUT },
        { node: LOST_NODE, output: '' },
        { node: JUDGE_NODE, output: JUDGE_OUTPUT },
      ],
    })

    expect(out).toContain(OUTLINE_OUTPUT)
    expect(out).toContain(JUDGE_OUTPUT)
    expect(out).not.toContain(LOST_NODE)
  })
})
