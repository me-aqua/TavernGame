/**
 * 古书分组的纯逻辑测试：事件流怎么折成「一回一叶」。
 *
 * 全是纯函数（不 mount、不碰 DOM）：一回一页、开场是「序」、调试行不进书、
 * 同一回的多条叙事接在同一页上，不为长回答拆页。
 */
import { describe, expect, it } from 'vitest'
import { toLeaves } from '../src/components/book'
import type { Row, StoryRowKind } from '../src/stores/game'

/** 一条故事行 */
function line(kind: StoryRowKind, text: string, id = 0): Row {
  return { id, kind, text, debug: false }
}

/** 一条调试行：书里不该出现它 */
function trace(id = 99): Row {
  return { id, kind: 'tool', text: 'trace', detail: '{}', debug: true }
}

describe('toLeaves', () => {
  it('groups one action plus its narration into one leaf', () => {
    const leaves = toLeaves(
      [line('action', 'A'), line('narration', 'N1'), line('action', 'B'), line('narration', 'N2')],
      6,
    )

    expect(leaves).toEqual([
      { turn: 5, action: 'A', narration: 'N1' },
      { turn: 6, action: 'B', narration: 'N2' },
    ])
  })

  it('keeps the opening narration as a prologue leaf (turn 0)', () => {
    const leaves = toLeaves([line('narration', 'P'), line('action', 'A'), line('narration', 'N')], 1)

    expect(leaves[0]).toEqual({ turn: 0, action: '', narration: 'P' })
    expect(leaves[1]).toEqual({ turn: 1, action: 'A', narration: 'N' })
  })

  it('skips debug traces entirely (they belong to the debug ledger)', () => {
    const rows = [trace(1), line('action', 'A', 2), trace(3), line('narration', 'N', 4), trace(5)]

    expect(toLeaves(rows, 1)).toEqual([{ turn: 1, action: 'A', narration: 'N' }])
  })

  it('keeps an action whose answer has not arrived yet (empty right page)', () => {
    expect(toLeaves([line('action', 'A')], 3)).toEqual([{ turn: 3, action: 'A', narration: '' }])
  })

  it('joins several narration rows of the same turn with a paragraph break', () => {
    const leaves = toLeaves([line('action', 'A'), line('narration', 'N1'), line('narration', 'N2')], 1)

    expect(leaves[0].narration).toBe('N1\n\nN2')
  })

  it('never splits a long answer into extra leaves (one turn = one page)', () => {
    const long = 'A very long answer. '.repeat(200)
    const leaves = toLeaves([line('action', 'A'), line('narration', long)], 4)

    expect(leaves).toHaveLength(1)
    expect(leaves[0]).toEqual({ turn: 4, action: 'A', narration: long })
  })

  it('numbers the last action with the engine turn, older ones backwards from it', () => {
    const rows = [
      line('action', 'A'),
      line('narration', 'N'),
      line('action', 'B'),
      line('narration', 'N'),
      line('action', 'C'),
      line('narration', 'N'),
    ]

    expect(toLeaves(rows, 6).map((leaf) => leaf.turn)).toEqual([4, 5, 6])
  })
})
