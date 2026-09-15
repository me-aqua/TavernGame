/**
 * tools/render-card.mjs 的渲染契约 —— 它是人读产物的唯一入口（卡是事实来源、md 是产物）。
 *
 * 三条判据：**不丢内容**（JSON 里每个字符串叶子都要出现在产物里）、
 * **不认具体卡**（换一张结构不同的卡照样渲染，项数全部现数）、
 * **散文原样打印**（说明块里的 markdown 字符不被转义、不被围进围栏）。
 *
 * ⚠️ 围栏符由 String.fromCharCode(96) 拼出来：模板字符串里的裸反引号会截断字符串。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderCard } from '../tools/render-card.mjs'
import * as K from '../src/game/card-keys'
import { EXAMPLE_CARD } from './support/card-fixtures'
import { stringLeaves } from './support/card-leaves'

/** 三个反引号（markdown 围栏符） */
const FENCE = String.fromCharCode(96).repeat(3)

/** 一张形状与示例卡完全不同的卡：三个节点、一段说明、没有声明块 */
function otherCard(): Record<string, unknown> {
  const ids = ['one', 'two', 'three']
  return {
    [K.KEY_CARD]: { [K.KEY_NAME]: 'demo', [K.KEY_VERSION]: '2.0.0' },
    [K.KEY_DECL]: {
      [K.KEY_GRAPH]: {
        [K.KEY_TOPOLOGY]: ids,
        [K.KEY_NODES]: Object.fromEntries(
          ids.map((id) => [id, { [K.KEY_NODE_NAME]: id + '-name', [K.KEY_OUTPUT]: { value: 'string' } }]),
        ),
      },
    },
    [K.KEY_PROMPT]: { [K.KEY_CONVENTION]: ['convention line'] },
    [K.KEY_NOTES]: { [K.KEY_STATE]: ['> quoted line', '| a | b |', '| --- | --- |', '| 1 | 2 |'] },
  }
}

describe('renderCard: the invariants', () => {
  it('keeps every string leaf of the example card', () => {
    const card = JSON.parse(readFileSync(EXAMPLE_CARD, 'utf8'))
    const missing = stringLeaves(card).filter((leaf) => !renderCard(card, EXAMPLE_CARD).includes(leaf))
    expect(missing).toEqual([])
  })

  it('renders a card whose shape is nothing like the example', () => {
    const md = renderCard(otherCard(), 'demo.json')
    expect(md).toContain('# 《demo》 v2.0.0')
    expect(md).toContain('demo.json')
    for (const id of ['one', 'two', 'three']) expect(md).toContain(id)
    expect(md).toContain('three-name')
  })

  it('derives the per-node upstream list from the topology, not from the card', () => {
    const md = renderCard(otherCard(), 'demo.json')
    expect(md).toContain('（3 项）')
    expect(md).toContain('公共部分 + ⓪①')
    expect(md.match(/^· /gm)).toHaveLength(3)
  })

  it('prints the notes block raw and fences the prompt blocks', () => {
    const md = renderCard(otherCard(), 'demo.json')
    const notesAt = md.indexOf(K.KEY_NOTES)
    const quotedAt = md.indexOf('> quoted line')
    expect(quotedAt).toBeGreaterThan(notesAt)
    expect(md.slice(notesAt, quotedAt)).not.toContain(FENCE)
    expect(md).toContain('| a | b |')
    expect(md.slice(0, notesAt)).toContain(FENCE + 'text')
  })
})
