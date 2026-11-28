/**
 * 阶段 3 · 数组 item 的**写值中文键**（`write_state` 入参归一化；契约 `契约-数组项写值中文键.md`）。
 *
 * 背景（本票修的 bug）：提示词那一侧只发中文名 —— 整表写是 `{物品: '长剑', 数量: 1}`，
 * 有孩子的字段是 `{自身: '短剑', 附魔: '锋利'}`；而 `arrayValueFits` / `fieldValueFits` 只认 code。
 * 模型照着提示词写 ⇒ 一律 `E_VALIDATION`。这一份钉的是**写入口**：
 *   · 中文名 / `自身` 进得来，落盘只留 code（`{ '2.4.1': '长剑', '2.4.2': 1 }`）；
 *   · 旧的 code 键照旧收（回归），名字与 code 可以混用；
 *   · 同一字段用名字与 code 各写一次 / 未知键 / 两个字段同名 ⇒ `E_VALIDATION`，
 *     消息点名**写路径 + 出问题的字段**，tree 一个字不动；
 *   · 递归：嵌套 object 字段、嵌套 array 字段、有孩子的标量字段（`自身` ⇒ `<code>.0`）。
 * 存储层（卡初始值 / 存档）**仍然只认 code** —— 那是另一条负控：本票不把中文名写进盘里。
 */
import { describe, expect, it } from 'vitest'
import {
  element,
  holdCard,
  holdItems,
  holdSave,
  nestedCard,
  nestedItems,
  patchElement,
  withInitialValue,
} from './support/array-fixtures.js'
import { cardWithRefs } from './support/field-ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const CJK = /[\u4e00-\u9fff]/
/** 有孩子的标量字段：自身值住 `<code>.0`，孩子是 `2.4.1.1` */
const OWN = '2.4.1.0'
const CHILD = '2.4.1.1'

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 卡里的判定节点（`applyWrite` 的 `node`） */
function checkNodeOf(card) {
  return card.chain.find((item) => item.id === 'check')
}

/**
 * 跑一次写：成功 ⇒ `next` 是新 tree；失败 ⇒ `error` 是抛出来的那个。
 * `writable` 不给就用卡自己的判定节点；给了就换那一张清单（权限不在本票判，只用来放行）。
 */
async function attempt(card, { path, value, writable }) {
  const { applyWrite } = await loadEngine()
  const target = writable === undefined ? card : cardWithRefs(card, { writable })
  const tree = holdSave(target).tree
  let next
  const error = errorOf(() => {
    next = applyWrite({ card: target, node: checkNodeOf(target), tree, path, value })
  })
  return { tree, next, error }
}

/**
 * 一次拒绝的统一口径（契约 §5–§6）：
 * `E_VALIDATION` + 中文 + 消息点名写路径与出问题的字段 + `detail.path` + tree 不动。
 */
async function expectRejected(card, { path, value, writable, names = [], codes = [], before, note }) {
  const { tree, error } = await attempt(card, { path, value, writable })
  expect(error, `${note}：应当被拒`).not.toBeNull()
  expect(error.code, `${note}：应当是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
  expect(error.message, `${note}：消息要点名写路径「${path}」`).toContain(path)
  for (const name of names) expect(error.message, `${note}：消息要点名「${name}」`).toContain(name)
  for (const code of codes) expect(error.message, `${note}：消息要点名「${code}」`).toContain(code)
  expect(error.detail?.path, `${note}：detail.path 也要是写路径`).toBe(path)
  expect(tree['2.4'], `${note}：tree 一个字都不许动`).toEqual(before)
  return error
}

/** 一个文字字段定义 */
function textChild(code, name) {
  return { code, name, note: '', type: 'text' }
}

/** 有孩子的标量字段（`2.4.1` = 自身值 + `2.4.1.1` 附魔），三项初始值 */
function ownChildItems(own = ['短剑', '斗篷', '银币'], child = '锋利') {
  return own.map((value, index) => ({
    id: `id_${index + 1}`,
    '2.4.1': { [OWN]: value, [CHILD]: child },
    '2.4.2': [1, 1, 3][index],
  }))
}

/** `holdCard` + 给 `2.4.1` 挂一个孩子（形状与 `array-field-parity.test.js` 同一份） */
function ownChildCard() {
  const base = holdCard()
  const at = base.state.findIndex((item) => item.code === '2.4.1') + 1
  const card = {
    ...base,
    state: [...base.state.slice(0, at), textChild(CHILD, '附魔'), ...base.state.slice(at)],
  }
  return withInitialValue(card, '2.4', ownChildItems())
}

/**
 * 嵌套数组里的「自身 + 孩子」（深度 5，正好卡在上限）：
 * `2.4 背包`(array) → `2.4.2 附魔`(array) → `2.4.2.1 名称`(text，自身值 + `2.4.2.1.1 描述`)
 * 另一个字段是 `2.4.2.2 强度`(integer 0..10)。
 */
function nestedOwnItems() {
  return [
    {
      id: 'id_1',
      '2.4.1': '短剑',
      '2.4.2': [{ id: 'id_1', '2.4.2.1': { '2.4.2.1.0': '锋锐', '2.4.2.1.1': '寒光' }, '2.4.2.2': 2 }],
    },
  ]
}

function nestedOwnCard() {
  const base = holdCard()
  const state = [
    ...base.state.filter((item) => item.code !== '2.4.1' && item.code !== '2.4.2'),
    element('2.4.1', 'text', { name: '物品' }),
    element('2.4.2', 'array', { name: '附魔' }),
    element('2.4.2.1', 'text', { name: '名称' }),
    element('2.4.2.1.1', 'text', { name: '描述' }),
    element('2.4.2.2', 'integer', { name: '强度', min: 0, max: 10 }),
  ]
  const card = { ...base, id: 'c-nested-own', name: 'nested own card', state }
  return withInitialValue(card, '2.4', nestedOwnItems())
}

/** 一个最简节点（只换 reads / writable，别的用最省事的合法值） */
function reader(over = {}) {
  return {
    id: 'check',
    type: 'normal',
    name: '判定',
    reads: [],
    writable: [],
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
    ...over,
  }
}

async function promptOf(card, node) {
  const { buildPrompt } = await loadPrompt()
  return buildPrompt({ card, save: holdSave(card), node, action: 'act one', outputs: {} })
}

/** 某个块（`\n\n` 分隔，块以标记开头） */
function blockOf(prompt, marker) {
  return prompt.split('\n\n').find((block) => block.startsWith(marker))
}

/** 块里的非空行（去掉块标记那一行） */
function linesOf(prompt, marker) {
  const block = blockOf(prompt, marker)
  if (block === undefined) return []
  return block
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** 一行 `：` 后面的正文（JSON / 约束） */
function payloadOf(line) {
  const at = line.indexOf('：')
  expect(at, `行里缺少全角冒号：${line}`).toBeGreaterThan(0)
  return line.slice(at + 1)
}

describe('数组 item 写值 · 中文名 → code（契约 §1–§2）', () => {
  it('整表写 2.4：中文名 item 收下，落盘是 code（原 tree 不改）', async () => {
    const card = holdCard()
    const { tree, next, error } = await attempt(card, {
      path: '2.4',
      value: [{ id: 'id_1', ['物品']: '长剑', ['数量']: 1 }],
    })
    expect(error, '中文名 item 应当收下').toBeNull()
    expect(next['2.4']).toEqual([{ id: 'id_1', '2.4.1': '长剑', '2.4.2': 1 }])
    expect(tree['2.4'], '入参 tree 一个字都不许改').toEqual(holdItems())
    expect(JSON.stringify(next['2.4']), '落盘里不许留中文名键').not.toMatch(/物品|数量/)

    const { arrayValueFits } = await loadState()
    expect(arrayValueFits(card.state, '2.4', next['2.4']), '落盘值必须是规范形状').toBe(true)
  })

  it('旧的 code 键 item 照旧收（回归）', async () => {
    const card = holdCard()
    const { next, error } = await attempt(card, {
      path: '2.4',
      value: [{ id: 'id_1', '2.4.1': '长剑', '2.4.2': 1 }],
    })
    expect(error, 'code 键是既有形状，不许因为本票变红').toBeNull()
    expect(next['2.4']).toEqual([{ id: 'id_1', '2.4.1': '长剑', '2.4.2': 1 }])
  })

  it('混合键：同一 item 里名字与别的字段的 code 并用，两种都落成 code', async () => {
    const card = holdCard()
    const left = await attempt(card, { path: '2.4', value: [{ id: 'id_1', ['物品']: '长剑', '2.4.2': 1 }] })
    expect(left.error, '名字 + 兄弟字段的 code 应当收').toBeNull()
    expect(left.next['2.4']).toEqual([{ id: 'id_1', '2.4.1': '长剑', '2.4.2': 1 }])

    const right = await attempt(card, { path: '2.4', value: [{ id: 'id_1', '2.4.1': '火把', ['数量']: 2 }] })
    expect(right.error, 'code + 兄弟字段的名字应当收').toBeNull()
    expect(right.next['2.4']).toEqual([{ id: 'id_1', '2.4.1': '火把', '2.4.2': 2 }])
  })
})

describe('数组 item 写值 · 重复 / 未知 / 歧义（契约 §2–§6）', () => {
  it('同一字段被名字与 code 各写一次 ⇒ E_VALIDATION（同值也拒），tree 不动', async () => {
    const card = holdCard()
    for (const [note, fieldValue] of [
      ['同值', { ['物品']: '长剑', '2.4.1': '长剑', '2.4.2': 1 }],
      ['不同值', { ['物品']: '长剑', '2.4.1': '短剑', '2.4.2': 1 }],
    ]) {
      await expectRejected(card, {
        path: '2.4',
        value: [fieldValue],
        codes: ['2.4.1'],
        before: holdItems(),
        note: `同一字段写两次（${note}）`,
      })
    }
  })

  it('未知键 ⇒ E_VALIDATION 点名路径与那个键，tree 不动', async () => {
    const card = holdCard()
    for (const [note, key] of [
      ['中文名不存在', '颜色'],
      ['长得像 code 但不存在', '2.4.9'],
    ]) {
      await expectRejected(card, {
        path: '2.4',
        value: [{ id: 'id_1', ['物品']: '长剑', ['数量']: 1, [key]: 'X' }],
        names: [key],
        before: holdItems(),
        note,
      })
    }
  })

  it('同名兄弟字段：用那个名字写 ⇒ E_VALIDATION 点名名字与候选 code；用 code 写仍然收', async () => {
    const card = patchElement(holdCard(), '2.4.2', { name: '物品' })
    await expectRejected(card, {
      path: '2.4',
      value: [{ id: 'id_1', ['物品']: '长剑' }],
      names: ['物品'],
      codes: ['2.4.1', '2.4.2'],
      before: holdItems(),
      note: '两个字段都叫「物品」',
    })

    const codes = await attempt(card, {
      path: '2.4',
      value: [{ '2.4.1': '长剑', '2.4.2': 1 }],
    })
    expect(codes.error, '名字有歧义不影响 code 键（code 是唯一身份）').toBeNull()
    expect(codes.next['2.4']).toEqual([{ id: 'id_4', '2.4.1': '长剑', '2.4.2': 1 }])
  })

  it('名字与兄弟字段的 code 撞车 ⇒ E_VALIDATION（不静默挑 code）', async () => {
    const card = patchElement(holdCard(), '2.4.2', { name: '2.4.1' })
    await expectRejected(card, {
      path: '2.4',
      value: [{ '2.4.1': '长剑', '2.4.2': 1 }],
      codes: ['2.4.1', '2.4.2'],
      before: holdItems(),
      note: '键 2.4.1 同时是字段一的 code 与字段二的名字',
    })
  })

  it('归一化后缺字段不补默认值 ⇒ E_VALIDATION', async () => {
    const card = holdCard()
    await expectRejected(card, {
      path: '2.4',
      value: [{ id: 'id_1', ['物品']: '长剑' }],
      before: holdItems(),
      note: '缺数量',
    })
  })

  it('数组 item 层没有「自身」⇒ E_VALIDATION 点名自身', async () => {
    const card = holdCard()
    await expectRejected(card, {
      path: '2.4',
      value: [{ id: 'id_1', ['自身']: 'X', ['物品']: '长剑', ['数量']: 1 }],
      names: ['自身'],
      before: holdItems(),
      note: '数组容器没有自身值',
    })
  })
})

describe('数组 item 写值 · 嵌套字段与「自身」（契约 §2–§3）', () => {
  it('嵌套 object / array 字段：中文名递归映射到各层 code', async () => {
    const card = nestedCard()
    const { next, error } = await attempt(card, {
      path: '2.4',
      value: [
        {
          id: 'id_1',
          ['物品']: '法杖',
          ['属性']: {
            ['品质']: '稀有',
            ['附魔']: [
              { ['名称']: '回响', ['强度']: 9 },
              { ['名称']: '微光', ['强度']: 1 },
            ],
          },
        },
      ],
    })
    expect(error, '嵌套中文名应当递归收下').toBeNull()
    expect(next['2.4']).toEqual([
      {
        id: 'id_1',
        '2.4.1': '法杖',
        '2.4.2': {
          '2.4.2.1': '稀有',
          '2.4.2.2': [
            // 嵌套数组的旧 item 是 id_1 ⇒ 新 item 取旧最大 + 1（id_2 / id_3）
            { id: 'id_2', '2.4.2.2.1': '回响', '2.4.2.2.2': 9 },
            { id: 'id_3', '2.4.2.2.1': '微光', '2.4.2.2.2': 1 },
          ],
        },
      },
    ])
  })

  it('字段列 2.4.2（object 字段）：每项写中文名对象 ⇒ 映射成 code 对象', async () => {
    const card = nestedCard()
    const { next, error } = await attempt(card, {
      path: '2.4.2',
      writable: ['2.4.2'],
      value: [{ ['品质']: '稀有', ['附魔']: [{ ['名称']: '初火', ['强度']: 3 }] }],
    })
    expect(error, 'object 字段列的中文名应当收下').toBeNull()
    expect(next['2.4'][0]['2.4.2']).toEqual({
      '2.4.2.1': '稀有',
      '2.4.2.2': [{ id: 'id_2', '2.4.2.2.1': '初火', '2.4.2.2.2': 3 }],
    })
    expect(next['2.4'][0]['2.4.1'], '兄弟字段不动').toBe('短剑')
  })

  it('字段列 2.4.2.2（嵌套 array 字段）：每外层一份数组，item 中文名映射', async () => {
    const card = nestedCard()
    const { next, error } = await attempt(card, {
      path: '2.4.2.2',
      writable: ['2.4.2.2'],
      value: [
        [
          { ['名称']: '初火', ['强度']: 3 },
          { ['名称']: '余烬', ['强度']: 4 },
        ],
      ],
    })
    expect(error, '嵌套数组字段列的中文名应当收下').toBeNull()
    expect(next['2.4'][0]['2.4.2']['2.4.2.2']).toEqual([
      { id: 'id_2', '2.4.2.2.1': '初火', '2.4.2.2.2': 3 },
      { id: 'id_3', '2.4.2.2.1': '余烬', '2.4.2.2.2': 4 },
    ])
    expect(next['2.4'][0]['2.4.2']['2.4.2.1'], '兄弟字段不动').toBe('普通')
  })

  it('字段列 2.4.1（有孩子的标量字段）：{自身, 孩子名} ⇒ {<code>.0, 孩子 code}', async () => {
    const card = ownChildCard()
    const { next, error } = await attempt(card, {
      path: '2.4.1',
      writable: ['2.4.1'],
      value: [
        { ['自身']: '长弓', ['附魔']: '尖' },
        { ['自身']: '火把', ['附魔']: '亮' },
        { ['自身']: '盾', ['附魔']: '厚' },
      ],
    })
    expect(error, '「自身 + 孩子名」应当收下').toBeNull()
    expect(next['2.4']).toEqual([
      { id: 'id_1', '2.4.1': { [OWN]: '长弓', [CHILD]: '尖' }, '2.4.2': 1 },
      { id: 'id_2', '2.4.1': { [OWN]: '火把', [CHILD]: '亮' }, '2.4.2': 1 },
      { id: 'id_3', '2.4.1': { [OWN]: '盾', [CHILD]: '厚' }, '2.4.2': 3 },
    ])
    expect(JSON.stringify(next['2.4']), '落盘里不许留「自身」').not.toContain('自身')
  })

  it('嵌套数组里的「自身 + 孩子」递归映射（深度 5）', async () => {
    const card = nestedOwnCard()
    const { next, error } = await attempt(card, {
      path: '2.4',
      value: [
        {
          id: 'id_1',
          ['物品']: '法杖',
          ['附魔']: [{ ['名称']: { ['自身']: '回响', ['描述']: '轰鸣' }, ['强度']: 9 }],
        },
      ],
    })
    expect(error, '嵌套数组 item 里的「自身 + 孩子」应当收下').toBeNull()
    expect(next['2.4']).toEqual([
      {
        id: 'id_1',
        '2.4.1': '法杖',
        '2.4.2': [
          {
            id: 'id_2',
            '2.4.2.1': { '2.4.2.1.0': '回响', '2.4.2.1.1': '轰鸣' },
            '2.4.2.2': 9,
          },
        ],
      },
    ])
  })

  it('「自身」只在有自身值的那一层：无孩子标量 / object 字段都不收，tree 不动', async () => {
    const flat = holdCard()
    await expectRejected(flat, {
      path: '2.4.1',
      writable: ['2.4.1'],
      value: [{ ['自身']: '长弓' }, { ['自身']: '火把' }, { ['自身']: '盾' }],
      before: holdItems(),
      note: '无孩子的文本字段没有自身层',
    })

    const nested = nestedCard()
    await expectRejected(nested, {
      path: '2.4.2',
      writable: ['2.4.2'],
      value: [{ ['自身']: 'X', ['品质']: '稀有', ['附魔']: [] }],
      names: ['自身'],
      before: nestedItems(),
      note: 'object 字段没有自身值',
    })
  })
})

describe('数组 item 写值 · 存储与提示词不回归（契约 §6–§7）', () => {
  it('存储层仍然只认 code：名字键的 item 不是合法数组值 / 卡初始值 / 存档', async () => {
    const card = holdCard()
    const named = [{ ['物品']: '长剑', ['数量']: 1 }]
    const { arrayValueFits, cardIssues } = await loadState()
    expect(arrayValueFits(card.state, '2.4', named), '存储层不接受名字键').toBe(false)
    expect(arrayValueFits(card.state, '2.4', [{ id: 'id_1', '2.4.1': '长剑', '2.4.2': 1 }])).toBe(true)

    const badCard = withInitialValue(card, '2.4', named)
    expect(cardIssues(badCard).length, '初始值里的名字键是坏卡').toBeGreaterThan(0)
    const { validateCard, validateSave } = await loadSchema()
    expect(errorOf(() => validateCard(badCard))?.code).toBe('E_VALIDATION')
    expect(errorOf(() => validateSave(holdSave(badCard), badCard))?.code).toBe('E_VALIDATION')
  })

  it('提示词仍是中文名：状态投影 / 可写容器 / 可写字段引用都不出现字段 code', async () => {
    const card = ownChildCard()
    const stateLines = linesOf(await promptOf(card, reader({ reads: ['2.4'] })), '<世界状态树>')
    expect(stateLines, '读了数组，状态块必须在').toHaveLength(1)
    // 数组 item 在模型提示词里带 id（阶段 4 §7.1）
    expect(JSON.parse(payloadOf(stateLines[0]))).toEqual([
      { id: 'id_1', ['物品']: { ['自身']: '短剑', ['附魔']: '锋利' }, ['数量']: 1 },
      { id: 'id_2', ['物品']: { ['自身']: '斗篷', ['附魔']: '锋利' }, ['数量']: 1 },
      { id: 'id_3', ['物品']: { ['自身']: '银币', ['附魔']: '锋利' }, ['数量']: 3 },
    ])
    for (const code of ['2.4.1', OWN, CHILD]) {
      expect(stateLines[0], `状态投影里出现了 code ${code}`).not.toContain(code)
    }

    const containerLines = linesOf(await promptOf(card, reader({ writable: ['2.4'] })), '<可写状态>')
    const containerLine = containerLines.find((line) => line.startsWith('- 2.4「背包」：'))
    expect(containerLine, `缺少 2.4 可写行（实际：${JSON.stringify(containerLines)}）`).toBeTruthy()
    const containerRule = payloadOf(containerLine)
    for (const name of ['物品', '自身', '附魔', '文本']) {
      expect(containerRule, `容器约束缺少「${name}」`).toContain(name)
    }
    for (const code of ['2.4.1', OWN, CHILD]) {
      expect(containerRule, `容器约束里出现了 code ${code}`).not.toContain(code)
    }

    const fieldLines = linesOf(await promptOf(card, reader({ writable: ['2.4.1'] })), '<可写状态>')
    const fieldLine = fieldLines.find((line) => line.startsWith('- 2.4.1「物品」：'))
    expect(fieldLine, `缺少 2.4.1 可写行（实际：${JSON.stringify(fieldLines)}）`).toBeTruthy()
    const fieldRule = payloadOf(fieldLine)
    for (const name of ['自身', '附魔', '文本']) {
      expect(fieldRule, `字段约束缺少「${name}」`).toContain(name)
    }
    for (const code of [OWN, CHILD]) {
      expect(fieldRule, `字段约束里出现了 code ${code}`).not.toContain(code)
    }
  })
})
