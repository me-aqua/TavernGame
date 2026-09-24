/**
 * 票 59 · 段 1：schema 类型表 8 → 6（删 `number` / `boolean`）+「必填」整个删掉。
 *
 * 契约 `.team/test/2026-09-19/contract-59.md`；S0 在 `.team/leader/2026-09-19/段1-S0.md`。
 *
 * ⚠️ **两条同名的 `required` 分得很清楚**（这是本票最容易改错的一处）：
 *   · 卡 schema 里的字段标记 `{ type: 'string', required: true }` —— **本票删掉**（判据 5）；
 *   · JSON Schema **工具参数**里的 `required: string[]`（set 的每个字段、map 的键、内置效果）——
 *     **必须留**（判据 6 / 7 / 8）。两者长得一样、意思不同，所以这里逐条点名，不靠"看着像"。
 *
 * ⚠️ 全 ASCII：`.githooks/checks/ascii.mjs` 连 `tests/` 里的字符串字面量与 `it` 标题一起拦。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CARD_FORMAT, parseCard, validateCard, type CardData } from '../src/game/card'
import { checkSchema } from '../src/game/card-state'
import { instantiate } from '../src/game/card-state'
import { runAction, toolSchemas } from '../src/game/card-actions'
import { createInitialState, normalize } from '../src/game/save'
import { EXAMPLE_CARD, minimalCard } from './support/card-fixtures'

/** 跑一段代码，把抛出的错误读成文本（没抛就返回空串）—— 校验器是"抛错"还是"返回一句话"都能读 */
function errorOf(run: () => unknown): string {
  try {
    run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/**
 * 一份最小卡的副本，只在 `state` 上改一处（反例要能归因到那一处）。
 *
 * ⚠️ 先把格式戳盖成引擎认的那个：**本判据问的是 schema 那一处**，格式戳归判据 10 / 11 / 12 ——
 *    不盖的话，夹具有一天变成旧戳，这几条会红在"格式不认"，把真正要守的那件事掩埋掉。
 */
function brokenCard(change: (state: Record<string, unknown>) => void): Record<string, unknown> {
  const card = minimalCard()
  ;(card.card as Record<string, unknown>).format = CARD_FORMAT
  change(card.state as Record<string, unknown>)
  return card
}

/** 报错文案里那张"已知类型"清单（校验器自己印出来的表）—— marker 后面就是它 */
function listedAfter(message: string, marker: string): string[] {
  const tail = message.split(marker)[1]
  return tail === undefined ? [] : tail.trim().split(' / ')
}

describe('the type vocabulary is six: number / boolean are gone', () => {
  it('1 refuses a full node whose type was removed, and prints the six', () => {
    for (const gone of ['number', 'boolean']) {
      const problem = errorOf(() => checkSchema({ type: gone }, 'state.mood'))
      expect(problem, gone + ' must be refused at that path').toContain('state.mood')
      expect(listedAfter(problem, 'must be one of '), gone).toEqual([
        'string',
        'integer',
        'enum',
        'list',
        'map',
        'object',
      ])
    }
  })

  it('2 refuses the bare shorthand of the two removed types', () => {
    for (const gone of ['number', 'boolean']) {
      const problem = errorOf(() => checkSchema(gone, 'state.mood'))
      expect(problem, gone + ' must be refused at that path').toContain('state.mood')
      expect(listedAfter(problem, 'or one of '), gone).toEqual(['string', 'integer'])
    }
  })

  it('3 still accepts a well-formed node of each of the six (nothing was over-deleted)', () => {
    const nodes: Record<string, unknown> = {
      string: { type: 'string', initial: 'x' },
      integer: { type: 'integer', range: [1, 3] },
      enum: { type: 'enum', values: ['a', 'b'] },
      list: { type: 'list', of: 'string' },
      map: { type: 'map', of: 'string' },
      object: { type: 'object', fields: { a: 'string' } },
    }
    for (const [name, node] of Object.entries(nodes)) {
      expect(
        errorOf(() => checkSchema(node, 'state.' + name)),
        name,
      ).toBe('')
    }
  })
})

describe('a card that writes the removed words is refused, with the path', () => {
  it('4 refuses type number / boolean inside a card state schema', () => {
    for (const gone of ['number', 'boolean']) {
      const card = brokenCard((state) => {
        state.mood = { type: gone }
      })
      expect(
        errorOf(() => validateCard(card)),
        gone + ' must be refused',
      ).toContain('state.mood')
    }
  })

  it('5 refuses a field marked required: the key does not exist any more', () => {
    const card = brokenCard((state) => {
      state.mood = { type: 'string', required: true }
    })
    const problem = errorOf(() => validateCard(card))
    expect(problem, 'required must be refused at that path').toContain('state.mood.required')
    expect(problem, 'and it must be refused as an unknown key').toContain('unknown key')
  })
})

describe('the same-named required in the tool parameters must stay', () => {
  /** 某个动作推导出来的工具参数（走真推导器，不手抄一份契约） */
  const params = (name: string) => {
    const tool = toolSchemas(minimalCard() as unknown as CardData).find((item) => item.function.name === name)
    if (tool === undefined) throw new Error('no such tool: ' + name)
    return tool.function.parameters
  }

  it('6 keeps the JSON Schema required arrays (every field of a set, the map key + value)', () => {
    expect(params('set_place').required).toEqual(['area', 'spot', 'scene'])
    expect(params('set_where').required).toEqual(['who', 'value'])
    expect(params('add_role').required).toEqual(['name'])
  })

  it('7 keeps the merge contract at "every field optional"', () => {
    expect(params('move_lead').required).toEqual([])
  })

  it('8 the two built-in effects are untouched (reverse control)', () => {
    const time = params('advance_time')
    expect(time.required).toEqual(['minutes'])
    expect(time.properties?.minutes).toMatchObject({ type: 'integer', minimum: 0 })
    const redo = params('redo')
    expect(redo.required).toEqual(['from', 'why'])
    expect(redo.properties?.from.enum).toEqual(['first', 'second'])
  })

  it('9 a merge write takes an empty patch on purpose (nothing is required any more)', () => {
    const card = minimalCard() as unknown as CardData
    const outcome = runAction(card, instantiate(card), 'move_lead', {})
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
  })
})

describe('card/5: the format stamp moved, and the old saves die', () => {
  it('10 the engine constant is card/5', () => {
    expect(CARD_FORMAT).toBe('card/5')
  })

  it('11 a save stamped with an older format no longer loads', () => {
    const card = minimalCard() as unknown as CardData
    // 卡带当前戳、存档带旧戳：问的是「旧存档会不会被静默重跑」（格式戳就是干这个的）
    ;(card.card as unknown as Record<string, unknown>).format = CARD_FORMAT
    // 票 68（2026-09-24）：`side` 必填 ⇒ 格式戳提到 card/5 ⇒ **上一个戳（card/4）也要拒**
    // ⚠️ `card/3` 那半**留着**：更旧的戳同样不许静默重跑，这条纪律没变
    for (const stamp of ['card/4', 'card/3']) {
      const saved = createInitialState(card)
      saved.meta.card.format = stamp
      expect(() => normalize(saved, card), 'an old save must be refused, not silently re-run').toThrow()
    }
  })

  it('12 the cards in the repo carry the new stamp too', () => {
    // ⚠️ 这一条**依赖 `cards/**` 的那 3 行**（三张卡的 "format"）：格式戳是引擎与卡之间的那一份事实，
    //    引擎认 card/5 之后旧戳的卡会被拒 —— **卡必须在同一票里跟上**。
    expect(parseCard(readFileSync(EXAMPLE_CARD, 'utf8')).card.format).toBe(CARD_FORMAT)
  })
})
