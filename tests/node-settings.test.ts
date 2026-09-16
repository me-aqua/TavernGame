/**
 * 按节点投放设定块 —— `graph.nodes[*].settings` 的格式、校验与引擎行为。
 *
 * 契约在 `.team/test/contract-52.md`（S0 是 `.team/leader/2026-09-16-S0-票B-按节点投放.md`）。
 * 三组判据：
 *   - 校验器：非法声明必须被拒，**而且报错要指到那个节点**（卡有九个节点，
 *     报错不指节点的话，作者拿到的是一张九选一的卷子）；
 *   - 引擎：**写了子集 = 只发那几块；没写 = 五块全发**（不写是全发，向后兼容的那一半）；
 *   - 反向对照：写了子集的节点**拿不到** `style` —— 不然「测试通过」可能只是没测到。
 *
 * ⚠️ 节名判据一律用 `'### ' + t('prompts.settingBlock.*')`，**不能拿裸块名当子串**：
 *    `settings.core` 的正文里就有「魔法」这类词，拿块名判「在不在」会被正文撞上。
 *
 * ⚠️ 读节点的 `settings` 时用 `declaredSettings()` 而不是直接取字段：`GraphNode` 现在还没有这个键，
 *    直取会让 `npm run typecheck` 先红（TS2339）。**那条红与本文件的红是两回事**，
 *    这条转换只是让「测试写歪了」和「活还没干」在读数上分得开。
 */
import { describe, expect, it } from 'vitest'
import { cardSystemPrompt } from '../src/agent/prompts'
import { validateCard, type CardData } from '../src/game/card'
import { t } from '../src/i18n'
import { EXAMPLE_CARD, NODE_A, NODE_B, loadCard, minimalCard } from './support/card-fixtures'

/** 三号节点：装配用例用它把「一份子集只发它写的那几块」与别的子集分开 */
const NODE_C = 'third'

/** 一号节点声明的子集 —— **卡序里靠前的两块**（顺序断言用它） */
const SUBSET = ['world', 'style']

/** 三号节点声明的子集 —— 另外两块，与一号节点不重叠 */
const OTHER_SUBSET = ['core', 'lead']

/** 示例卡里七个不看范例的节点将来会声明的那四块 */
const WITHOUT_STYLE = ['world', 'core', 'common', 'lead']

/** 一个节点写没写 `settings` 声明 —— 字段还没进 `GraphNode`，所以这里读的是原始值 */
function declaredSettings(node: unknown): string[] | undefined {
  return (node as { settings?: string[] }).settings
}

/** 夹具上一处临时声明：字段还没进 `GraphNode`，所以写的时候也要转一次 */
function declareSettings(card: CardData, node: string, keys: string[]): void {
  ;(card.graph.nodes[node] as { settings?: string[] }).settings = keys
}

/**
 * 撤掉一处声明 —— **必须删键，不能赋 `undefined`**。
 *
 * 校验器判「写没写」用的是 `Object.hasOwn`：键在就算写了。赋值 `undefined` 会留下一个
 * 「键在、值不是数组」的节点，卡被合法地拦在那个节点上，报错就指不到真正要测的那一个。
 * 而**这个状态 JSON 根本表达不出来**（`undefined` 不是 JSON 值）—— 测试造卡要忠实于 JSON。
 */
function clearSettings(card: CardData, node: string): void {
  delete (card.graph.nodes[node] as { settings?: string[] }).settings
}

/** 装配一张卡：三个节点走三种声明（子集 / 另一份子集 / 不写），其余结构原样复制最小卡 */
function cardWithSubsets(): CardData {
  const card: any = minimalCard()
  // 最小卡的二号节点是 story 节点：它照旧不写声明，于是「没写 = 全发」那一档有实体可测
  card.graph.topology = [NODE_A, NODE_B, NODE_C]
  card.graph.nodes[NODE_C] = { name: NODE_C, duty: 'does the third thing', prompt: ['prompt line'] }
  declareSettings(card, NODE_A, SUBSET)
  declareSettings(card, NODE_C, OTHER_SUBSET)
  return card as CardData
}

/** 某张卡的某个节点请求里，设定小节出现的顺序（`### X` 现数出来，不猜） */
function settingSections(system: string, card: CardData): string[] {
  return Object.keys(card.settings)
    .map((key) => '### ' + t('prompts.settingBlock.' + key))
    .filter((heading) => system.includes(heading))
}

/** 某张卡的某个节点请求里那一行小标题 —— 没写声明时它是空的 */
function sectionsOf(card: CardData, node: string): string[] {
  return settingSections(cardSystemPrompt(card, node), card)
}

/** 一份五块全在的卡：它的 `### X` 行（顺序即卡序）—— 它同时是判据可用性的护栏 */
function allSections(card: CardData): string[] {
  return Object.keys(card.settings).map((key) => '### ' + t('prompts.settingBlock.' + key))
}

/** 改坏一处（只在夹具的副本上动一个地方）→ 必须被拒，而且报错要指到那一处 */
function expectRejected(card: unknown, path: string, note: string): void {
  let message = ''
  try {
    validateCard(card)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  expect(
    message,
    note + ': expected a rejection pointing at <' + path + '>, got ' + JSON.stringify(message),
  ).toContain(path)
}

/** 七种「不是合法子集」的输入 —— 四类硬要求（空 / 重复 / 非法名 / 不是数组）都在里面 */
const BAD_VALUES: [string, unknown][] = [
  ['an empty list', []],
  ['a list that repeats a block name', ['world', 'world']],
  ['a block name the card does not declare', ['style2']],
  ['a list holding something that is not a block name', ['world', 7]],
  ['a bare string', 'world'],
  ['an object', { world: true }],
  ['a number', 7],
]

describe('validateCard: a node declaring which setting blocks it reads', () => {
  it('accepts a subset, and accepts a node without the field at all', () => {
    expect(validateCard(cardWithSubsets())).toBeDefined()
  })

  it('rejects a broken settings on any node, and points at that node', () => {
    for (const [note, value] of BAD_VALUES) {
      // 两个节点都要跑到：坏值挂在谁身上，报错就得指谁
      for (const id of [NODE_A, NODE_C]) {
        const card = cardWithSubsets()
        // 没被改坏的那个节点必须撤掉声明 —— 否则它自己的好声明会先一步把卡拦下
        clearSettings(card, id === NODE_A ? NODE_C : NODE_A)
        declareSettings(card, id, value as string[])
        expectRejected(card, 'graph.nodes.' + id + '.settings', note + ' on ' + id)
      }
    }
  })

  it('names the offending block when the name is not one this card declares', () => {
    const card = cardWithSubsets()
    declareSettings(card, NODE_A, ['style2'])
    expectRejected(card, 'style2', 'a wrong block name must be reported by name')
  })

  it('rejects an empty settings list instead of reading it as "send nothing"', () => {
    const empty = cardWithSubsets()
    declareSettings(empty, NODE_A, [])
    expectRejected(empty, 'graph.nodes.' + NODE_A + '.settings', 'an empty list is a typo')
  })
})

describe('cardSystemPrompt: a node that declares a subset', () => {
  it('sends only the blocks the node declares, in the card order', () => {
    const card = cardWithSubsets()
    const headings = (keys: string[]) => keys.map((key) => '### ' + t('prompts.settingBlock.' + key))
    expect(settingSections(cardSystemPrompt(card, NODE_A), card)).toEqual(headings(SUBSET))
    expect(settingSections(cardSystemPrompt(card, NODE_C), card)).toEqual(headings(OTHER_SUBSET))
  })

  it('keeps the card order even when the node lists the blocks the other way round', () => {
    const card = cardWithSubsets()
    declareSettings(card, NODE_A, ['style', 'world'])
    const system = cardSystemPrompt(card, NODE_A)
    expect(system.indexOf('### ' + t('prompts.settingBlock.world'))).toBeLessThan(
      system.indexOf('### ' + t('prompts.settingBlock.style')),
    )
  })

  it('never sends a block the node did not declare, body and all (reverse control)', () => {
    const card = cardWithSubsets()
    const first = cardSystemPrompt(card, NODE_A)
    // 判据不止「标题不在」：正文也不许在 —— 只断标题的话，一份漏了标题却照样发正文的实现会绿
    expect(first).not.toContain('### ' + t('prompts.settingBlock.core'))
    expect(first).not.toContain(card.settings.core[0])

    const third = cardSystemPrompt(card, NODE_C)
    expect(third).not.toContain('### ' + t('prompts.settingBlock.style'))
    expect(third).not.toContain(card.settings.style[0])
  })
})

describe('cardSystemPrompt: a node that declares nothing', () => {
  it('sends all five blocks, and they are the five the card declares', () => {
    const card = cardWithSubsets()
    const undeclared = declaredSettings(card.graph.nodes[NODE_B])
    expect(undeclared, 'node ' + NODE_B + ' must stay undeclared').toBeUndefined()
    expect(sectionsOf(card, NODE_B), 'the five headings must be usable as a reading').toEqual(
      allSections(card),
    )
  })

  it('keeps the card order when nothing is declared (pins the reading itself)', () => {
    const card = cardWithSubsets()
    const system = cardSystemPrompt(card, NODE_B)
    const order = allSections(card).map((heading) => system.indexOf(heading))
    expect(order[0], 'the first heading must be found at all').toBeGreaterThan(-1)
    for (let i = 1; i < order.length; i += 1) {
      expect(order[i], 'headings must follow the card order').toBeGreaterThan(order[i - 1])
    }
  })
})

describe('the example card: style reaches only the nodes that write', () => {
  it('keeps style away from every node that declares a subset without it', () => {
    const card = loadCard(EXAMPLE_CARD)
    const styleHeading = '### ' + t('prompts.settingBlock.style')
    const declaring = card.graph.topology.filter((id) => declaredSettings(card.graph.nodes[id]) !== undefined)
    expect(declaring.length, 'the example card must declare settings per node').toBeGreaterThan(0)
    for (const id of declaring) {
      const system = cardSystemPrompt(card, id)
      expect(system, id + ' must not receive the style block').not.toContain(styleHeading)
      expect(system, id + ' must not receive the style text').not.toContain(card.settings.style[0])
    }
  })

  it('still gives the nodes that declare nothing the whole style block', () => {
    const card = loadCard(EXAMPLE_CARD)
    const silent = card.graph.topology.filter((id) => declaredSettings(card.graph.nodes[id]) === undefined)
    expect(silent.length, 'the example card must keep two nodes reading everything').toBeGreaterThan(0)
    for (const id of silent) {
      const system = cardSystemPrompt(card, id)
      expect(sectionsOf(card, id), id + ' reads every block').toEqual(allSections(card))
      for (const line of card.settings.style) {
        expect(system, id + ' must receive its style lines').toContain(line)
      }
    }
  })

  it('declares the four blocks without style, on every node that opts out', () => {
    const card = loadCard(EXAMPLE_CARD)
    for (const id of card.graph.topology) {
      const declared = declaredSettings(card.graph.nodes[id])
      if (declared === undefined) continue
      expect(declared.slice().sort(), 'node ' + id + ' declares the four blocks without style').toEqual(
        WITHOUT_STYLE.slice().sort(),
      )
    }
  })
})
