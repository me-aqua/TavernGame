/**
 * tools/render-card.mjs 的渲染契约 —— 它是人读产物的唯一入口（卡是事实来源、md 是产物）。
 *
 * 三条判据：**不丢内容**（JSON 里每个字符串叶子都要出现在产物里）、
 * **不认具体卡**（换一张结构不同的卡照样渲染，项数全部现数）、
 * **notes 原样打印**（人读的散文里的 markdown 字符不被转义、不被围进围栏）。
 *
 * ⚠️ 围栏符由 String.fromCharCode(96) 拼出来：模板字符串里的裸反引号会截断字符串。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderCard } from '../tools/render-card.mjs'
import { EXAMPLE_CARD, LONG_NIGHT_CARD, NIGHT_WATCH_CARD } from './support/card-fixtures'
import { stringLeaves } from './support/card-leaves'

/** 三个反引号（markdown 围栏符） */
const FENCE = String.fromCharCode(96).repeat(3)

/** 上游清单的行首圆点与圈号（渲染器排版用的记号）—— 码点拼出来，源码才是 ASCII */
const BULLET = String.fromCharCode(0x00b7) + ' '
const mark = (index: number) => String.fromCodePoint(index === 0 ? 0x24ea : 0x2460 + index - 1)

/** 上游清单的行（行首是圆点） */
const upstreamLines = (md: string) => md.split('\n').filter((line) => line.startsWith(BULLET))

/** 仓库里的三张卡 —— 渲染器对每一张都要成立 */
const CARDS = [EXAMPLE_CARD, NIGHT_WATCH_CARD, LONG_NIGHT_CARD]

/** 一张形状与示例卡完全不同的卡：三个节点、一段约定、一份 notes、没有 state */
function otherCard(): Record<string, unknown> {
  const ids = ['one', 'two', 'three']
  return {
    card: { name: 'demo', version: '2.0.0' },
    graph: {
      topology: ids,
      nodes: Object.fromEntries(ids.map((id) => [id, { name: id + '-name', prompt: [id + '-prompt'] }])),
    },
    convention: ['convention line'],
    notes: { why: ['> quoted line', '| a | b |', '| --- | --- |', '| 1 | 2 |'] },
  }
}

describe('renderCard: the invariants', () => {
  it('keeps every string leaf of every card in the repo', () => {
    for (const path of CARDS) {
      const card = JSON.parse(readFileSync(path, 'utf8'))
      const missing = stringLeaves(card).filter((leaf) => !renderCard(card, path).includes(leaf))
      expect(missing, path).toEqual([])
    }
  })

  it('renders a card whose shape is nothing like the example', () => {
    const md = renderCard(otherCard(), 'demo.json')
    const title = md.split('\n')[0]
    expect(title.startsWith('# ')).toBe(true)
    expect(title).toContain('demo')
    expect(title).toContain('v2.0.0')
    expect(md).toContain('demo.json')
    for (const id of ['one', 'two', 'three']) expect(md).toContain(id)
    expect(md).toContain('three-name')
    expect(md).toContain('three-prompt')
  })

  it('derives the per-node upstream list from graph.topology, not from the card', () => {
    const md = renderCard(otherCard(), 'demo.json')
    expect(upstreamLines(md)).toHaveLength(3)
    // 第三行（节点 three）的上游是前两个节点的圈号
    expect(upstreamLines(md)[2]).toContain(mark(0) + mark(1))
  })

  it('gives every node of the example card one upstream line', () => {
    const card = JSON.parse(readFileSync(EXAMPLE_CARD, 'utf8'))
    const md = renderCard(card, EXAMPLE_CARD)
    const ids = card.graph.topology as string[]
    const lines = upstreamLines(md)
    expect(lines).toHaveLength(ids.length)
    // 最后那个节点的上游 = 它前面的每一个（圈号从 0 起）
    const last = lines[ids.length - 1]
    expect(last).toContain(
      ids
        .slice(0, -1)
        .map((_, index) => mark(index))
        .join(''),
    )
  })

  it('prints the notes block raw and fences the prompt blocks', () => {
    const md = renderCard(otherCard(), 'demo.json')
    const notesAt = md.indexOf('notes')
    const quotedAt = md.indexOf('> quoted line')
    expect(quotedAt).toBeGreaterThan(notesAt)
    expect(md.slice(notesAt, quotedAt)).not.toContain(FENCE)
    expect(md).toContain('| a | b |')
    expect(md.slice(0, notesAt)).toContain(FENCE + 'text')
  })
})
