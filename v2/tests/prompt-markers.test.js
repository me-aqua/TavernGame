/**
 * 提示词标记 + 历史语义判据（阶段 2 · 提示词结构这一票）。
 *
 * 五段固定顺序，每段带自己的标记：
 *   `<公共提示词·{title}>`（**每块一个**）→ `<世界状态树>` → `<游戏历史记录>` → `<上游输出·{nodeName}>` → `<节点提示词>`
 * 空段连标记一起省略；历史块按 `historyTurns` 取事件：
 *   · `0` ⇒ 只有本回合行动；
 *   · `1` ⇒ 最近一条 narration + 本回合行动（**不含**上一个 action）；
 *   · `2` ⇒ 上一条 action + 最近两条 narration + 本回合行动，按事件时间穿插、不重复。
 *
 * ⚠️ `=2` 的块内顺序在这一份里钉的是：`narr2, action3, narr3, action4`
 * （「previous action」= 紧邻本回合的那一个 action，它在自己的 narration 之前）。
 * 若组长要的是别的穿插方式，改这一条判据即可 —— 别改实现去迁就判据。
 *
 * 断言只认「标记 + 事件正文 + 它们的位置」：行动行的前缀（`> ` 之类）与段间分隔符归实现，不钉。
 */
import { describe, expect, it } from 'vitest'
import { makeCard, makeSave, turnEvents } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))

/** 三个已完成回合（记号互不为子串）+ 本回合行动 */
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

const outputOf = (card) => card.chain.find((node) => node.id === 'output')

/** 段标记的形状（`{title}` / `{nodeName}` 是变量，用 `[^>]*` 吃） */
const MARKER_PATTERNS = [
  /<公共提示词·[^>]*>/g,
  /<世界状态树>/g,
  /<游戏历史记录>/g,
  /<上游输出·[^>]*>/g,
  /<节点提示词>/g,
]

/** 按出现顺序收集所有标记（带位置） */
function markerHits(text) {
  const hits = []
  for (const pattern of MARKER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      hits.push({ marker: match[0], index: match.index })
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}

/** 取某个标记对应的段正文：从标记开始，到**下一个**标记之前（最后一段到结尾） */
function sectionOf(text, marker) {
  const hits = markerHits(text)
  const at = hits.findIndex((hit) => hit.marker === marker)
  if (at < 0) return null
  const start = hits[at].index
  const end = at + 1 < hits.length ? hits[at + 1].index : text.length
  return text.slice(start, end)
}

/** 一次性拼提示词（默认：三个已完成回合的存档、输出节点；`save` 可换成新存档 / 一回合存档） */
async function promptOf({ card = makeCard(), save, node, action = 'act four', outputs } = {}) {
  const { buildPrompt } = await loadPrompt()
  return buildPrompt({
    card,
    save: save ?? saveWithThreeTurns(card),
    node: node ?? outputOf(card),
    action,
    outputs: outputs ?? { check: 'UP_CHECK', extra: 'UP_EXTRA' },
  })
}

describe('提示词标记：每一段都有自己的标记，顺序固定', () => {
  it('七处标记按契约顺序出现（两块公共提示词各一个、上游按节点名各一个）', async () => {
    const text = await promptOf()
    expect(
      markerHits(text).map((hit) => hit.marker),
      '标记不是「每段一个、按固定顺序」',
    ).toEqual([
      '<公共提示词·tone>',
      '<公共提示词·style>',
      '<世界状态树>',
      '<游戏历史记录>',
      '<上游输出·check>',
      '<上游输出·extra>',
      '<节点提示词>',
    ])
  })

  it('标记后面紧跟着自己那一段的正文（不是把正文全堆在最后）', async () => {
    const text = await promptOf()
    const checks = [
      ['<公共提示词·tone>', 'BODY_ONE'],
      ['<公共提示词·style>', 'BODY_TWO'],
      ['<世界状态树>', 'VAL_PLACE_A1'],
      ['<游戏历史记录>', 'act four'],
      ['<上游输出·check>', 'UP_CHECK'],
      ['<上游输出·extra>', 'UP_EXTRA'],
      ['<节点提示词>', 'NODE_OUT'],
    ]
    for (const [marker, body] of checks) {
      const section = sectionOf(text, marker)
      expect(section, `${marker} 没出现在提示词里`).not.toBeNull()
      expect(section, `${marker} 后面不是它自己的正文 ${body}`).toContain(body)
    }
  })

  it('空段连标记一起省略：什么都不读、没有上游输出、节点提示词为空 ⇒ 只剩历史标记', async () => {
    const card = makeCard()
    const node = {
      ...outputOf(card),
      reads: [],
      readsUpstream: [],
      prompt: '',
      historyTurns: 0,
    }
    const text = await promptOf({ card, node, outputs: {} })
    expect(markerHits(text).map((hit) => hit.marker)).toEqual(['<游戏历史记录>'])
    // 历史块本身不为空（有本回合行动）⇒ 它的标记要留着
    expect(sectionOf(text, '<游戏历史记录>')).toContain('act four')
  })

  it('本节点提示词为空 ⇒ `<节点提示词>` 不出现；上游没输出 ⇒ 那个上游标记不出现', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), prompt: '', readsUpstream: ['check', 'extra'] }
    const text = await promptOf({ card, node, outputs: { check: 'UP_CHECK', extra: '' } })
    expect(text).not.toContain('<节点提示词>')
    expect(text).toContain('<上游输出·check>')
    expect(text).not.toContain('<上游输出·extra>')
  })
})

describe('历史语义：historyTurns 数的是 narration，action 只留最近的那一条', () => {
  it('historyTurns=0 ⇒ 块里只有本回合行动（没有更早的 narration / action）', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), historyTurns: 0 }
    const text = await promptOf({ card, node, action: 'ACT_CURRENT_4' })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(block).toContain('ACT_CURRENT_4')
    for (const gone of ['NARR_THREE', 'act three', 'NARR_TWO', 'act two', 'NARR_ONE', 'act one']) {
      expect(block, `historyTurns=0 却带上了 ${gone}`).not.toContain(gone)
    }
  })

  it('historyTurns=1 ⇒ 最近一条 narration + 本回合行动；上一个 action 不进块', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), historyTurns: 1 }
    const text = await promptOf({ card, node, action: 'ACT_CURRENT_4' })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(block).toContain('NARR_THREE')
    expect(block).toContain('ACT_CURRENT_4')
    expect(block, 'historyTurns=1 不许带上一个 action').not.toContain('act three')
    expect(block).not.toContain('NARR_TWO')
  })

  it('historyTurns=2 ⇒ narr2 → action3 → narr3 → 本回合行动（按时间、不重复）', async () => {
    const card = makeCard()
    const node = { ...outputOf(card), historyTurns: 2 }
    const text = await promptOf({ card, node, action: 'ACT_CURRENT_4' })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(block).not.toBeNull()

    // 顺序：narr2 < action3 < narr3 < 当前行动
    const at = (needle) => block.indexOf(needle)
    expect(at('NARR_TWO'), '缺最近第二条 narration').toBeGreaterThanOrEqual(0)
    expect(at('act three'), '缺上一个 action').toBeGreaterThan(at('NARR_TWO'))
    expect(at('NARR_THREE'), '缺最近一条 narration').toBeGreaterThan(at('act three'))
    expect(at('ACT_CURRENT_4'), '本回合行动必须在块的最后').toBeGreaterThan(at('NARR_THREE'))

    // 不重复：每条正文在块里恰好一次
    for (const once of ['NARR_TWO', 'act three', 'NARR_THREE', 'ACT_CURRENT_4']) {
      expect(block.split(once).length - 1, `${once} 在历史块里出现了不止一次`).toBe(1)
    }
    // 更旧的回合整段不进块
    expect(block).not.toContain('NARR_ONE')
    expect(block).not.toContain('act two')
    expect(block).not.toContain('act one')
  })
})

describe('开场白作为历史的第一条（新存档 / 落在窗口里才带）', () => {
  /** 把「开场」那块提示词的正文设成 `body`（其余不变） */
  function cardWithOpening(body) {
    const card = makeCard()
    card.prompts = card.prompts.map((prompt) => (prompt.id === 'opening' ? { ...prompt, body } : prompt))
    return card
  }

  /**
   * 历史块里**逐条**的内容：去掉标记、按行切、剥掉行动前缀 `> `、丢掉空行。
   * 只比「有哪些条目、什么顺序」，不钉行动行的前缀与分隔符（那是实现的自由）。
   */
  function entriesOf(block) {
    return block
      .replace('<游戏历史记录>', '')
      .split('\n')
      .map((line) => line.trim().replace(/^>\s*/, ''))
      .filter((line) => line !== '')
  }

  it('新存档（没有事件）+ historyTurns=1 ⇒ 块里恰好是「开场白 → 本回合行动」', async () => {
    const card = cardWithOpening('OPENING_OP')
    const node = { ...outputOf(card), historyTurns: 1 }
    const text = await promptOf({
      card,
      node,
      action: 'ACT_CURRENT_4',
      save: makeSave(card),
    })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(entriesOf(block), '新存档的历史块不是「开场白 + 本回合行动」').toEqual([
      'OPENING_OP',
      'ACT_CURRENT_4',
    ])
  })

  it('新存档 + historyTurns=0 ⇒ 只有本回合行动（开场白不进块）', async () => {
    const card = cardWithOpening('OPENING_OP')
    const node = { ...outputOf(card), historyTurns: 0 }
    const text = await promptOf({
      card,
      node,
      action: 'ACT_CURRENT_4',
      save: makeSave(card),
    })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(entriesOf(block)).toEqual(['ACT_CURRENT_4'])
    expect(block, 'historyTurns=0 却带上了开场白').not.toContain('OPENING_OP')
  })

  it('跑完一回合后 historyTurns=1 ⇒ 最近一条 narration + 本回合行动，开场白不再出现', async () => {
    const card = cardWithOpening('OPENING_OP')
    const save = makeSave(card, { turn: 1, events: turnEvents(1, 'act one', 'NARR_ONE') })
    const node = { ...outputOf(card), historyTurns: 1 }
    const text = await promptOf({ card, node, save, action: 'ACT_CURRENT_4' })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(entriesOf(block)).toEqual(['NARR_ONE', 'ACT_CURRENT_4'])
    expect(block, 'historyTurns=1 不该再带开场白').not.toContain('OPENING_OP')
    expect(block).not.toContain('act one')
  })

  it('跑完一回合后 historyTurns=2 ⇒ 开场白落在窗口里，按时间排在最前', async () => {
    const card = cardWithOpening('OPENING_OP')
    const save = makeSave(card, { turn: 1, events: turnEvents(1, 'act one', 'NARR_ONE') })
    const node = { ...outputOf(card), historyTurns: 2 }
    const text = await promptOf({ card, node, save, action: 'ACT_CURRENT_4' })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(entriesOf(block), 'historyTurns=2 时开场白应当作为最旧的一条叙事进块').toEqual([
      'OPENING_OP',
      'act one',
      'NARR_ONE',
      'ACT_CURRENT_4',
    ])
  })

  it('开场白正文为空 ⇒ 块里没有开头那一条（也不留空行）', async () => {
    const card = cardWithOpening('')
    const node = { ...outputOf(card), historyTurns: 1 }
    const text = await promptOf({
      card,
      node,
      action: 'ACT_CURRENT_4',
      save: makeSave(card),
    })
    const block = sectionOf(text, '<游戏历史记录>')
    expect(entriesOf(block), '开场白为空时不该多出一条空条目').toEqual(['ACT_CURRENT_4'])
  })
})
