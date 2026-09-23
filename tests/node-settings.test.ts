/**
 * 按节点投放设定块 —— `graph.nodes[*].settings` 的格式、校验与引擎行为。
 *
 * 契约在 `.team/test/contract-52.md`（S0 是 `.team/leader/2026-09-16-S0-票B-按节点投放.md`）；
 * **缺省语义在票 76 改了**，那一票的契约是 `.team/test/2026-09-23/contract-76.md`。
 * 三组判据：
 *   - 校验器：非法声明必须被拒，**而且报错要指到那个节点**（卡有九个节点，
 *     报错不指节点的话，作者拿到的是一张九选一的卷子）；空表**仍然被拒**，
 *     但报错要说清「要一块都不发就省掉这个键」；
 *   - 引擎：**写了子集 = 只发那几块；没写 = 一块都不发**（票 76 的语义，2026-09-23 老板拍板）；
 *   - 反向对照：写了子集的节点**拿不到** `style` —— 不然「测试通过」可能只是没测到。
 *
 * ⚠️ 节名判据一律用 `'### ' + t('prompts.settingBlock.*')`，**不能拿裸块名当子串**：
 *    `settings.core` 的正文里就有「魔法」这类词，拿块名判「在不在」会被正文撞上。
 *
 * ⚠️ 「不写这个键」那一档**只能靠本文件自己造的卡**（`cardWithSubsets()` 把 NODE_B 的键删掉）：
 *    三张卡补齐显式声明之后，仓库里再也挑不出「没写 `settings`」的节点。
 *
 * ⚠️ 读节点的 `settings` 时用 `declaredSettings()` 而不是直接取字段：`GraphNode` 现在还没有这个键，
 *    直取会让 `npm run typecheck` 先红（TS2339）。**那条红与本文件的红是两回事**，
 *    这条转换只是让「测试写歪了」和「活还没干」在读数上分得开。
 */
import { describe, expect, it } from 'vitest'
import { cardSystemPrompt, settingsPrompt } from '../src/agent/prompts'
import { validateCard, type CardData } from '../src/game/card'
import { t } from '../src/i18n'
import {
  EXAMPLE_CARD,
  LONG_NIGHT_CARD,
  NIGHT_WATCH_CARD,
  NODE_A,
  NODE_B,
  loadCard,
  minimalCard,
} from './support/card-fixtures'

/** 三号节点：装配用例用它把「一份子集只发它写的那几块」与别的子集分开 */
const NODE_C = 'third'

/** 一号节点声明的子集 —— **卡序里靠前的两块**（顺序断言用它） */
const SUBSET = ['world', 'style']

/** 三号节点声明的子集 —— 另外两块，与一号节点不重叠 */
const OTHER_SUBSET = ['core', 'lead']

/** 示例卡里六个不看范例的节点声明的那四块（`outline` / `story` 读全部五块） */
const WITHOUT_STYLE = ['world', 'core', 'common', 'lead']

/** 三张卡 —— 票 76 之后**每一张的每一步**都该写明它读哪几块 */
const THREE_CARDS = [EXAMPLE_CARD, LONG_NIGHT_CARD, NIGHT_WATCH_CARD]

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

/**
 * 装配一张卡：三个节点走三种声明（子集 / 另一份子集 / **不写这个键**），其余结构原样复制最小卡。
 *
 * ⚠️ `NODE_B` 那一档是**显式删掉**的（不靠共享最小卡恰好没写这个键）：票 76 之后仓库里的卡
 *    全都写明了声明，「不写」这一档只活在本文件自己造的这张卡上。
 */
function cardWithSubsets(): CardData {
  const card: any = minimalCard()
  card.graph.topology = [NODE_A, NODE_B, NODE_C]
  card.graph.nodes[NODE_C] = { name: NODE_C, duty: 'does the third thing', prompt: ['prompt line'] }
  declareSettings(card, NODE_A, SUBSET)
  declareSettings(card, NODE_C, OTHER_SUBSET)
  clearSettings(card, NODE_B)
  return card as CardData
}

/** 一串块名在 system 消息里对应的那几行小标题（顺序 = 传进来的顺序） */
function headings(keys: string[]): string[] {
  return keys.map((key) => '### ' + t('prompts.settingBlock.' + key))
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

/** 改坏一处（只在夹具的副本上动一个地方）→ 把校验器那句话取回来（没被拒就是空串） */
function rejectionOf(card: unknown): string {
  let message = ''
  try {
    validateCard(card)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  return message
}

/** 改坏一处 → 必须被拒，而且报错要指到那一处 */
function expectRejected(card: unknown, path: string, note: string): void {
  const message = rejectionOf(card)
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

  it('rejects an empty settings list, and says leaving the key out is how you send none', () => {
    const empty = cardWithSubsets()
    declareSettings(empty, NODE_A, [])
    const message = rejectionOf(empty)
    expect(message, 'an empty list is still a typo: ' + JSON.stringify(message)).toContain(
      'graph.nodes.' + NODE_A + '.settings',
    )
    // 🔴 票 76（裁决 2）：空表**继续拒**，但理由变了 —— 它是多写了没有用的东西，
    //    不是「一块都不发」的那条路，那条路是**省掉这个键**。文案不把新语义说出来，
    //    作者会照旧去写空表。
    expect(message, 'the message must spell out the new default').toContain(
      'must not be empty (leave the key out to send no block at all)',
    )
  })
})

describe('cardSystemPrompt: a node that declares a subset', () => {
  it('sends only the blocks the node declares, in the card order', () => {
    const card = cardWithSubsets()
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
  it('sends no setting block at all, and no empty heading either', () => {
    const card = cardWithSubsets()
    expect(
      declaredSettings(card.graph.nodes[NODE_B]),
      'node ' + NODE_B + ' must stay undeclared',
    ).toBeUndefined()
    // 反面控制：**同一句读法**在写了声明的那两步上数得出标题。
    // 少了它，「标题一个都数不出来」与「我的选择器/读法写歪了」长得一模一样。
    expect(sectionsOf(card, NODE_A), 'the reading must be able to find headings at all').toEqual(
      headings(SUBSET),
    )
    // 正题：设定那一节**整个不出现**（票 76 裁决 4）—— 不是产一个只有标题的空壳
    expect(settingsPrompt(card, NODE_B), 'the whole section must be gone').toBe('')
    expect(sectionsOf(card, NODE_B), NODE_B + ' reads no block').toEqual([])
    expect(cardSystemPrompt(card, NODE_B), 'no heading may survive anywhere').not.toContain(
      '## ' + t('prompts.setting'),
    )
  })

  it('is the same thing as an empty list on the engine side (the card format still rejects that)', () => {
    const card = cardWithSubsets()
    // 两句话别混：**引擎端**「不写」与「空表」等价（都不发），**卡格式端**空表仍被拒（上一条用例）。
    declareSettings(card, NODE_A, [])
    expect(settingsPrompt(card, NODE_A), 'an empty list sends nothing').toBe('')
    expect(settingsPrompt(card, NODE_A), 'and so does the absent key').toBe(settingsPrompt(card, NODE_B))
  })
})

describe('the three cards: every step writes down which blocks it reads', () => {
  it('writes an explicit declaration on every node of every card', () => {
    for (const path of THREE_CARDS) {
      const card = loadCard(path)
      const silent = card.graph.topology.filter((id) => declaredSettings(card.graph.nodes[id]) === undefined)
      expect(silent, path + ' must spell the declaration out on every node').toEqual([])
    }
  })

  it('spells out the whole key list on the node that writes the story', () => {
    // 写正文的那一步是「读全部五块」的那一步（风格范例只发给它）。
    // ⚠️ 这里断的是**声明**，不是行为：光断行为的话，一个「声明只写了四块」的补齐会静默少发一块。
    for (const path of THREE_CARDS) {
      const card = loadCard(path)
      const keepers = card.graph.topology.filter((id) => card.graph.nodes[id].role !== undefined)
      expect(keepers, path + ' must have exactly one node writing the story').toHaveLength(1)
      expect(
        declaredSettings(card.graph.nodes[keepers[0]]),
        path + ': the story node must declare every block',
      ).toEqual(Object.keys(card.settings))
    }
  })

  it('keeps style away from every node that declares a subset without it', () => {
    const card = loadCard(EXAMPLE_CARD)
    const styleHeading = '### ' + t('prompts.settingBlock.style')
    const optingOut = card.graph.topology.filter((id) => {
      const declared = declaredSettings(card.graph.nodes[id])
      return declared !== undefined && !declared.includes('style')
    })
    expect(optingOut.length, 'the example card must keep nodes out of style').toBeGreaterThan(0)
    for (const id of optingOut) {
      const system = cardSystemPrompt(card, id)
      expect(system, id + ' must not receive the style block').not.toContain(styleHeading)
      expect(system, id + ' must not receive the style text').not.toContain(card.settings.style[0])
    }
  })

  it('still gives some step the whole style block (reverse control for the line above)', () => {
    const card = loadCard(EXAMPLE_CARD)
    const styleHeading = '### ' + t('prompts.settingBlock.style')
    const reading = card.graph.topology.filter((id) => sectionsOf(card, id).includes(styleHeading))
    expect(reading.length, 'nobody reads style, so the line above proves nothing').toBeGreaterThan(0)
    for (const id of reading) {
      expect(sectionsOf(card, id), id + ' must carry the whole setting section').toEqual(allSections(card))
      for (const line of card.settings.style) {
        expect(cardSystemPrompt(card, id), id + ' must receive its style lines').toContain(line)
      }
    }
  })

  it('declares the four blocks without style, on every node that opts out', () => {
    const card = loadCard(EXAMPLE_CARD)
    let optingOut = 0
    for (const id of card.graph.topology) {
      const declared = declaredSettings(card.graph.nodes[id])
      if (declared === undefined || declared.includes('style')) continue
      optingOut += 1
      expect(declared.slice().sort(), 'node ' + id + ' declares the four blocks without style').toEqual(
        WITHOUT_STYLE.slice().sort(),
      )
    }
    expect(optingOut, 'the example card must keep a node that opts out of style').toBeGreaterThan(0)
  })
})
