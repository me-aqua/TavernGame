/**
 * 活动卡：从哪来、什么时候退回内置、导入怎么落盘。
 *
 * 选卡发生在**模块加载期**（currentCard 是模块级常量），所以要用到「换一份存储再重来」
 * 的用例都走 vi.resetModules() + 动态 import —— 与 theme / store 的重载用例同一套做法。
 *
 * 期望值全部从 cards/morningwind.json 现读：卡是唯一事实来源，不在这里抄一份内容；
 * 自造的坏数据直接用 card/3 的 JSON 键名与 ASCII。
 */
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseCard } from '../src/game/card'
import { EXAMPLE_CARD } from './support/card-fixtures'

/** 活动卡的存储键与产品一致：写错了这里会当场变红（读不到东西） */
const CARD_KEY = 'tavernGame.card'

/** 卡里那几处会被这个测试改动的键（card/3 的 JSON 键名） */
const CARD = 'card'
const NAME = 'name'
const GRAPH = 'graph'
const TOPOLOGY = 'topology'
const NODES = 'nodes'
const DISPLAY = 'display'
const SIDEBAR = 'sidebar'
const TOPBAR = 'topbar'
const BLOCK = 'block'

/** 示例卡的 JSON 文本 */
const example = readFileSync(EXAMPLE_CARD, 'utf8')

/** 改一处就是另一张卡：存在存储里的那份必须与内置那份分得出来 */
const STORED_NODE_NAME = 'stored-node'

/** 示例卡里第一个节点的 id（拓扑的第一个） */
const FIRST_NODE = (JSON.parse(example) as Record<string, any>)[GRAPH as string][TOPOLOGY][0] as string

/** 一份能通过两道校验的卡文本：示例卡改掉第一个节点的显示名 */
function goodCard(): string {
  const card = JSON.parse(example) as Record<string, any>
  card[GRAPH][NODES][FIRST_NODE][NAME] = STORED_NODE_NAME
  return JSON.stringify(card)
}

/** 每个用例拿一个全新的模块实例（选卡在加载期发生） */
async function freshCard() {
  vi.resetModules()
  return import('../src/game/current-card')
}

beforeEach(() => {
  localStorage.clear()
})

describe('which card is active', () => {
  it('uses the built-in example when nothing is stored', async () => {
    const { currentCard, cardStartup } = await freshCard()

    expect(currentCard).toEqual(parseCard(example))
    // 没存过卡 = 没有出事，不该播报任何东西
    expect(cardStartup).toEqual({ source: 'builtin', failed: null })
  })

  it('uses the stored card when it passes the card format and the vocabulary', async () => {
    localStorage.setItem(CARD_KEY, goodCard())
    const { currentCard, cardStartup } = await freshCard()

    expect(cardStartup).toEqual({ source: 'imported', failed: null })
    // 用的确实是存着的那张，不是内置那张
    expect(currentCard.graph.nodes[FIRST_NODE].name).toBe(STORED_NODE_NAME)
  })

  it('falls back to the built-in example, with the reason, when the stored text is not a card', async () => {
    localStorage.setItem(CARD_KEY, '{not valid json')
    const { currentCard, cardStartup } = await freshCard()

    expect(currentCard).toEqual(parseCard(example))
    expect(cardStartup.source).toBe('builtin')
    expect(cardStartup.failed).toContain('not valid JSON')
  })

  it('falls back when the stored card declares a sidebar block this app cannot render', async () => {
    const card = JSON.parse(goodCard()) as Record<string, any>
    card[DISPLAY][SIDEBAR] = [{ [BLOCK]: 'nope' }]
    localStorage.setItem(CARD_KEY, JSON.stringify(card))

    const { currentCard, cardStartup } = await freshCard()

    expect(currentCard).toEqual(parseCard(example))
    expect(cardStartup.failed).toContain('nope')
  })

  it('falls back when the stored card declares a topbar entry this app cannot render', async () => {
    const card = JSON.parse(goodCard()) as Record<string, any>
    card[DISPLAY][TOPBAR] = ['nope']
    localStorage.setItem(CARD_KEY, JSON.stringify(card))

    const { currentCard, cardStartup } = await freshCard()

    expect(currentCard).toEqual(parseCard(example))
    expect(cardStartup.failed).toContain('nope')
  })
})

describe('importing a card', () => {
  it('stores the card it just validated, and exports it back verbatim', async () => {
    const { importCard } = await freshCard()

    importCard(goodCard())

    // 落盘之后重新加载 = F5：这一次就是「已导入」的那张
    const reloaded = await freshCard()
    expect(reloaded.cardStartup).toEqual({ source: 'imported', failed: null })
    expect(JSON.parse(reloaded.exportCardText())).toEqual(JSON.parse(goodCard()))
  })

  it('throws with the card path and leaves the stored card untouched when the import is bad', async () => {
    localStorage.setItem(CARD_KEY, goodCard())
    const { importCard } = await freshCard()

    expect(() => importCard('{not valid json')).toThrow('not valid JSON')
    expect(() => importCard('{}')).toThrow('missing top-level key')

    const card = JSON.parse(goodCard()) as Record<string, any>
    card[DISPLAY][SIDEBAR] = [{ [BLOCK]: 'nope' }]
    expect(() => importCard(JSON.stringify(card))).toThrow('nope')

    // 三次都失败，存储里那份必须一个字节都没动
    expect(localStorage.getItem(CARD_KEY)).toBe(goodCard())
  })
})

describe('going back to the built-in example', () => {
  it('drops the stored card so the next load is the built-in one again', async () => {
    localStorage.setItem(CARD_KEY, goodCard())
    const { resetToBuiltinCard } = await freshCard()
    expect(localStorage.getItem(CARD_KEY)).toBe(goodCard())

    resetToBuiltinCard()

    expect(localStorage.getItem(CARD_KEY)).toBeNull()
    const reloaded = await freshCard()
    expect(reloaded.cardStartup).toEqual({ source: 'builtin', failed: null })
    expect(reloaded.currentCard).toEqual(parseCard(example))
  })
})

describe('cardMeta', () => {
  it('reads the name, version and id the interface shows and the export names its file after', async () => {
    const { cardMeta } = await freshCard()
    const declared = (JSON.parse(example) as Record<string, any>)[CARD]

    expect(cardMeta(parseCard(example))).toEqual({
      id: declared.id,
      name: declared[NAME],
      version: declared.version,
    })
  })
})
