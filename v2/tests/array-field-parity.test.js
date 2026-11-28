/**
 * 阶段 3 · 数组 item 字段：自身值 + 孩子（Stage3 parity；契约 `契约-阶段3-数组项字段-自身值与孩子.md` §1–§3）。
 *
 * 本票的口径一句话：数组子树里的字段与普通节点同权 —— `type` 只描述自己的值，孩子是另一层。
 * 有孩子时 item 里的值是 `{ "<code>.0": 自己的值, 孩子 code: 孩子值, … }`；**键是完整值路径**，
 * 不是短键 `"0"`（与扁平树同一套口径）。
 *
 * 这一份钉的是纯函数：形状 / 默认值 / 加删孩子 / 卡与存档校验 / 提示词投影 / `applyWrite`。
 * 另含评审 F5 的 5 条补判据：嵌套孩子写 `2.4.1.1`、容器授权写「自身 + 孩子」字段列、精确提示词
 * （父 → 数组 → item 字段自身 + 孩子）、根表多 `2.4.1.0`、孙子层缺键。
 * DOM 那半边在 `v2/e2e/array-item-field-parity.spec.js`。
 */
import { describe, expect, it } from 'vitest'
import { elementOf, holdCard, holdItems, holdSave, withInitialValue } from './support/array-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const CJK = /[\u4e00-\u9fff]/
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

/** 根 2 的初始值表里那一份数组值（调用方自己别改） */
function itemsOf(card) {
  return elementOf(card, '2').initial['2.4']
}

/** 一个文字孩子定义 */
function textChild(code, name) {
  return { code, name, note: '', type: 'text' }
}

/** 有孩子字段的初始值：每项都是 `{<code>.0, 2.4.1.1}`，另一个字段 2.4.2 保持裸标量 */
function childItems(own = ['短剑', '斗篷', '银币'], child = '锋利') {
  return own.map((value, index) => ({
    '2.4.1': { [OWN]: value, [CHILD]: child },
    '2.4.2': [1, 1, 3][index],
  }))
}

/**
 * 在 `holdCard` 上给 `2.4.1` 挂孩子：孩子定义插在 2.4.1 后面，初始值换成给定数组。
 * `holdCard` 的骨架（时间 / 根 / 兄弟字段）不动，只多一层孩子。
 */
function childCard({ children = [textChild(CHILD, '附魔')], items = childItems() } = {}) {
  const base = holdCard()
  const at = base.state.findIndex((item) => item.code === '2.4.1') + 1
  const card = {
    ...base,
    state: [...base.state.slice(0, at), ...children, ...base.state.slice(at)],
  }
  return withInitialValue(card, '2.4', items)
}

/**
 * 评审 F5-③ 的精确提示词夹具：根 `1「区域」`(object) → `1.1「名称」` / `1.2「地点」`(array)
 * → item 字段 `1.2.1「名称」`(text，自身值 + `1.2.1.1「描述」`)。
 * 这一份钉的是「父节点 → 数组孩子 → item 字段自身 + 孩子」的完整组合，而不只是数组那一行。
 */
function regionCard() {
  const base = holdCard()
  const rest = base.state.filter(
    (item) => item.code === '0' || item.code === '2' || item.code.startsWith('2.'),
  )
  return {
    ...base,
    id: 'c-region',
    name: 'region card',
    state: [
      base.state.find((item) => item.code === '0'),
      {
        code: '1',
        name: '区域',
        note: '',
        type: 'object',
        initial: {
          1.1: '镇中心',
          1.2: [{ '1.2.1': { '1.2.1.0': '醉猫旅店', '1.2.1.1': '炉火噼啪，麦酒和湿羊毛的味道' } }],
        },
      },
      { code: '1.1', name: '名称', note: '', type: 'text' },
      { code: '1.2', name: '地点', note: '', type: 'array' },
      { code: '1.2.1', name: '名称', note: '', type: 'text' },
      { code: '1.2.1.1', name: '描述', note: '', type: 'text' },
      ...rest.filter((item) => item.code !== '0'),
    ],
  }
}

/** 三种标量孩子各一个：文本 / 整数 / 下拉（用来钉「孩子值也逐类型校验」） */
function richChildren() {
  return [
    textChild(CHILD, '附魔'),
    { code: '2.4.1.2', name: '强度', note: '', type: 'integer', min: 0, max: 9 },
    { code: '2.4.1.3', name: '品质', note: '', type: 'enum', values: ['普通', '稀有'] },
  ]
}

function richItems() {
  return [
    {
      '2.4.1': { [OWN]: '短剑', [CHILD]: '锋利', '2.4.1.2': 3, '2.4.1.3': '普通' },
      '2.4.2': 1,
    },
    {
      '2.4.1': { [OWN]: '斗篷', [CHILD]: '轻柔', '2.4.1.2': 1, '2.4.1.3': '稀有' },
      '2.4.2': 1,
    },
    {
      '2.4.1': { [OWN]: '银币', [CHILD]: '微光', '2.4.1.2': 5, '2.4.1.3': '普通' },
      '2.4.2': 3,
    },
  ]
}

/** 一个正控：item 形状 / 卡清单 / validateCard / validateSave 四处都该过 */
async function expectCardValid(card, note) {
  const { arrayValueFits, cardIssues } = await loadState()
  expect(arrayValueFits(card.state, '2.4', itemsOf(card)), `${note}：item 形状应当合法`).toBe(true)
  expect(cardIssues(card), `${note}：卡问题清单应当为空`).toEqual([])
  const { validateCard, validateSave } = await loadSchema()
  expect(() => validateCard(card), `${note}：validateCard 应当通过`).not.toThrow()
  expect(() => validateSave(holdSave(card), card), `${note}：validateSave 应当通过`).not.toThrow()
}

/** 一个负控：值形状 / 卡清单 / validateCard / validateSave 四处都该拒（中文） */
async function expectBadValue(card, value, note) {
  const { arrayValueFits, cardIssues } = await loadState()
  expect(arrayValueFits(card.state, '2.4', value), `${note}：arrayValueFits 应当为假`).toBe(false)
  const bad = withInitialValue(card, '2.4', value)
  const issues = cardIssues(bad)
  expect(issues.length, `${note}：cardIssues 应当报错`).toBeGreaterThan(0)
  for (const issue of issues) expect(issue.message, `${note}：message 必须是中文`).toMatch(CJK)
  const { validateCard, validateSave } = await loadSchema()
  const error = errorOf(() => validateCard(bad))
  expect(error?.code, `${note}：validateCard 应当 E_VALIDATION`).toBe('E_VALIDATION')
  const saveError = errorOf(() => validateSave(holdSave(bad), bad))
  expect(saveError?.code, `${note}：validateSave 应当 E_VALIDATION`).toBe('E_VALIDATION')
  return issues
}

/** 一个最简节点（只换 reads / writable） */
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

/** 状态块 / 可写块里的非空行（去掉块标记那一行） */
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

describe('数组 item 字段 · 形状与默认值（契约 §1.1 / §1.2）', () => {
  it('无孩子字段保持裸标量：默认值 / 形状判据都不接受对象（回归）', async () => {
    const { arrayItemOf, arrayValueFits, fieldValueFits } = await loadState()
    const card = holdCard()
    expect(arrayItemOf(card.state, '2.4')).toEqual({ '2.4.1': '', '2.4.2': 0 })
    expect(arrayValueFits(card.state, '2.4', holdItems())).toBe(true)
    expect(fieldValueFits(card.state, elementOf(card, '2.4.1'), '短剑')).toBe(true)
    expect(
      fieldValueFits(card.state, elementOf(card, '2.4.1'), { [OWN]: '短剑' }),
      '无孩子字段不接受对象形状',
    ).toBe(false)
    await expectCardValid(card, '旧背包')
  })

  it('有孩子字段的值恰好是 `<code>.0` + 孩子 code：键对就合法，默认值也是这一形状', async () => {
    const { arrayValueFits, arrayItemOf } = await loadState()
    const card = childCard()
    expect(arrayValueFits(card.state, '2.4', childItems())).toBe(true)
    expect(arrayItemOf(card.state, '2.4')).toEqual({
      '2.4.1': { [OWN]: '', [CHILD]: '' },
      '2.4.2': 0,
    })
    await expectCardValid(card, '一个文字孩子')
  })

  it('短键 `"0"` 不是自身值：即使孩子都在，整项也判坏', async () => {
    const { fieldValueFits } = await loadState()
    const card = childCard()
    expect(
      fieldValueFits(card.state, elementOf(card, '2.4.1'), { 0: '短剑', [CHILD]: '锋利' }),
      '短键不是完整值路径',
    ).toBe(false)
  })
})

describe('数组 item 字段 · 加孩子（契约 §1.3）', () => {
  it('给 2.4.1 加孩子：每个 item 从裸标量提升成 `<code>.0` + 新孩子，其它字段 / 项不动', async () => {
    const { addChild, arrayItemOf, initialTreeOf } = await loadState()
    const card = holdCard()
    const next = addChild(card, '2.4.1')

    expect(next.state.filter((item) => item.code.startsWith('2.4.1.')).map((item) => item.code)).toEqual([
      CHILD,
    ])
    expect(
      next.state.find((item) => item.code === CHILD),
      '新孩子是文字',
    ).toMatchObject({ type: 'text' })
    expect(itemsOf(next)).toEqual([
      { '2.4.1': { [OWN]: '短剑', [CHILD]: '' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '斗篷', [CHILD]: '' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '银币', [CHILD]: '' }, '2.4.2': 3 },
    ])
    expect(itemsOf(card), '原卡的 item 一个字都不许改').toEqual(holdItems())
    expect(arrayItemOf(next.state, '2.4')).toEqual({
      '2.4.1': { [OWN]: '', [CHILD]: '' },
      '2.4.2': 0,
    })
    expect(initialTreeOf(next)['2.4']).toEqual(itemsOf(next))
    expect(Object.keys(initialTreeOf(next))).not.toContain('2.4.0')
    await expectCardValid(next, '加完孩子')
  })

  it('给已有孩子的字段再加一个：own 与已有孩子的值不动，只补新键', async () => {
    const { addChild } = await loadState()
    const card = childCard()
    const next = addChild(card, '2.4.1')
    expect(next.state.filter((item) => item.code.startsWith('2.4.1.')).map((item) => item.code)).toEqual([
      CHILD,
      '2.4.1.2',
    ])
    expect(itemsOf(next)[0]['2.4.1']).toEqual({ [OWN]: '短剑', [CHILD]: '锋利', '2.4.1.2': '' })
    expect(itemsOf(next)[1]['2.4.1']).toEqual({ [OWN]: '斗篷', [CHILD]: '锋利', '2.4.1.2': '' })
    await expectCardValid(next, '两个孩子')
  })
})

describe('数组 item 字段 · 删孩子（契约 §1.4）', () => {
  it('删一个留自身 + 剩下（值跟着改名）；删最后一个收成裸自身值', async () => {
    const { addChild, removeNode, setInitial } = await loadState()
    const first = addChild(holdCard(), '2.4.1')
    const second = addChild(first, '2.4.1')
    const valued = setInitial(second, '2.4', [
      { '2.4.1': { [OWN]: '短剑', [CHILD]: '锋利', '2.4.1.2': '轻' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '斗篷', [CHILD]: '轻柔', '2.4.1.2': '暖' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '银币', [CHILD]: '微光', '2.4.1.2': '重' }, '2.4.2': 3 },
    ])
    await expectCardValid(valued, '两个孩子、值不同')

    const one = removeNode(valued, CHILD)
    expect(one.state.filter((item) => item.code.startsWith('2.4.1.')).map((item) => item.code)).toEqual([
      '2.4.1.1',
    ])
    expect(itemsOf(one)).toEqual([
      { '2.4.1': { [OWN]: '短剑', [CHILD]: '轻' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '斗篷', [CHILD]: '暖' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '银币', [CHILD]: '重' }, '2.4.2': 3 },
    ])
    await expectCardValid(one, '删掉一个孩子')

    const zero = removeNode(one, '2.4.1.1')
    expect(zero.state.filter((item) => item.code.startsWith('2.4.1.')).map((item) => item.code)).toEqual([])
    expect(itemsOf(zero)).toEqual([
      { '2.4.1': '短剑', '2.4.2': 1 },
      { '2.4.1': '斗篷', '2.4.2': 1 },
      { '2.4.1': '银币', '2.4.2': 3 },
    ])
    await expectCardValid(zero, '删掉最后一个孩子')
    expect(itemsOf(valued)[0]['2.4.2'], '入参卡不许被改').toBe(1)
  })
})

describe('数组 item 字段 · 校验（契约 §2）', () => {
  it('缺 `<code>.0` / 短键 / 多键 / 自身类型错 / 孩子类型错：四道口子都拒', async () => {
    const card = childCard()
    const badFields = [
      ['缺自身值', { [CHILD]: '锋利' }],
      ['短键 0', { 0: '短剑', [CHILD]: '锋利' }],
      ['多一个键', { [OWN]: '短剑', [CHILD]: '锋利', '2.4.1.9': 'X' }],
      ['自身值写成数字', { [OWN]: 7, [CHILD]: '锋利' }],
      ['孩子写成数字', { [OWN]: '短剑', [CHILD]: 7 }],
      ['孩子写成 null', { [OWN]: '短剑', [CHILD]: null }],
    ]
    for (const [note, fieldValue] of badFields) {
      await expectBadValue(
        card,
        [
          { '2.4.1': fieldValue, '2.4.2': 1 },
          { '2.4.1': fieldValue, '2.4.2': 1 },
          { '2.4.1': fieldValue, '2.4.2': 3 },
        ],
        note,
      )
    }
  })

  it('孩子值逐类型校验：整数越界 / 下拉不在白名单 / 递归孙层都拒', async () => {
    const rich = childCard({ children: richChildren(), items: richItems() })
    await expectCardValid(rich, '文本 / 整数 / 下拉三个孩子')

    const over = richItems()
    over[0]['2.4.1']['2.4.1.2'] = 99
    await expectBadValue(rich, over, '整数孩子超上限')

    const unknown = richItems()
    unknown[1]['2.4.1']['2.4.1.3'] = '传说'
    await expectBadValue(rich, unknown, '下拉孩子不在白名单')

    const nested = childCard({
      children: [
        textChild(CHILD, '附魔'),
        { code: '2.4.1.1.1', name: '深层', note: '', type: 'integer', min: 0, max: 5 },
      ],
      items: [{ '2.4.1': { [OWN]: '短剑', [CHILD]: { '2.4.1.1.0': '锋', '2.4.1.1.1': 3 } }, '2.4.2': 1 }],
    })
    await expectCardValid(nested, '孙层是整数')
    const nestedBad = [
      { '2.4.1': { [OWN]: '短剑', [CHILD]: { '2.4.1.1.0': '锋', '2.4.1.1.1': 9 } }, '2.4.2': 1 },
    ]
    await expectBadValue(nested, nestedBad, '孙层整数越界')
  })

  it('时间仍然不能进数组子树：直接孩子 / 更深子孙都拦', async () => {
    const timeChild = {
      code: CHILD,
      name: '时刻',
      note: '',
      type: 'time',
      timeMode: 'year-minute',
      holidays: { international: false, china: false, traditional: false },
    }
    const direct = childCard({ children: [timeChild], items: childItems() })
    const { cardIssues } = await loadState()
    const issues = cardIssues(direct)
    expect(issues.length, '直接 time 字段应当是坏卡').toBeGreaterThan(0)
    expect(
      issues.some((issue) => issue.code === CHILD && issue.message.includes('数组字段')),
      `time 字段的问题没被点名（实际：${JSON.stringify(issues)}）`,
    ).toBe(true)
    const { validateCard } = await loadSchema()
    expect(errorOf(() => validateCard(direct))?.code).toBe('E_VALIDATION')

    const nested = childCard({
      children: [textChild(CHILD, '附魔'), { ...timeChild, code: '2.4.1.1.1', name: '深层时刻' }],
      items: [
        {
          '2.4.1': {
            [OWN]: '短剑',
            [CHILD]: {
              '2.4.1.1.0': '锋',
              '2.4.1.1.1': { year: 2024, month: 2, day: 10, hour: 8, minute: 30 },
            },
          },
          '2.4.2': 1,
        },
      ],
    })
    expect(cardIssues(nested).length, '孙层 time 字段应当是坏卡').toBeGreaterThan(0)
  })
  it('根初始值表多出 `2.4.1.0`（不是 `2.4.0`）：cardIssues / validateCard / validateSave 都拒', async () => {
    const card = childCard()
    const bad = withInitialValue(card, '2.4.1.0', 'X')
    const { cardIssues } = await loadState()
    const issues = cardIssues(bad)
    expect(
      issues.some((issue) => issue.path === '2.4.1.0'),
      `多出的 2.4.1.0 没被点名（实际：${JSON.stringify(issues)}）`,
    ).toBe(true)
    const { validateCard, validateSave } = await loadSchema()
    expect(errorOf(() => validateCard(bad))?.code).toBe('E_VALIDATION')
    expect(errorOf(() => validateSave(holdSave(bad), bad))?.code).toBe('E_VALIDATION')
  })

  it('孙子层缺键（缺自身 / 缺孩子 / 多键）也拒，不是只拒类型错', async () => {
    const nested = childCard({
      children: [textChild(CHILD, '附魔'), { code: '2.4.1.1.1', name: '深层', note: '', type: 'text' }],
      items: [
        {
          '2.4.1': { [OWN]: '短剑', [CHILD]: { '2.4.1.1.0': '锋', '2.4.1.1.1': '深' } },
          '2.4.2': 1,
        },
      ],
    })
    await expectCardValid(nested, '孙层键齐')

    const withChild = (childValue) => [{ '2.4.1': { [OWN]: '短剑', [CHILD]: childValue }, '2.4.2': 1 }]
    for (const [note, childValue] of [
      ['缺孙层自身值 2.4.1.1.0', { '2.4.1.1.1': '深' }],
      ['缺孙层孩子 2.4.1.1.1', { '2.4.1.1.0': '锋' }],
      ['孙层多一个键', { '2.4.1.1.0': '锋', '2.4.1.1.1': '深', '2.4.1.1.9': 'X' }],
    ]) {
      await expectBadValue(nested, withChild(childValue), note)
    }
  })
})

describe('数组 item 字段 · 提示词与写（契约 §3）', () => {
  it('读 2.4：自身值 + 孩子的中文名嵌套；不出现字段 code', async () => {
    const card = childCard()
    const prompt = await promptOf(card, reader({ reads: ['2.4'] }))
    const lines = linesOf(prompt, '<世界状态树>')
    expect(lines, '读了数组，状态块必须在').toHaveLength(1)
    expect(JSON.parse(payloadOf(lines[0]))).toEqual([
      { 物品: { 自身: '短剑', 附魔: '锋利' }, 数量: 1 },
      { 物品: { 自身: '斗篷', 附魔: '锋利' }, 数量: 1 },
      { 物品: { 自身: '银币', 附魔: '锋利' }, 数量: 3 },
    ])
    for (const code of ['2.4.1', OWN, CHILD]) {
      expect(lines[0], `投影里出现了 code ${code}`).not.toContain(code)
    }
  })

  it('只读字段引用 2.4.1：每个 item 只投影这一格，仍是「自身 + 孩子」', async () => {
    const card = childCard()
    const prompt = await promptOf(card, reader({ reads: ['2.4.1'] }))
    const lines = linesOf(prompt, '<世界状态树>')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(payloadOf(lines[0]))).toEqual([
      { 物品: { 自身: '短剑', 附魔: '锋利' } },
      { 物品: { 自身: '斗篷', 附魔: '锋利' } },
      { 物品: { 自身: '银币', 附魔: '锋利' } },
    ])
    expect(lines[0], '没读的字段一个键都不出现').not.toContain('数量')
  })

  it('精确例子：父节点 1「区域」→ 地点 array → item 字段 名称（自身 + 描述）', async () => {
    const card = regionCard()
    await expectCardValid(card, '精确提示词夹具')
    const prompt = await promptOf(card, reader({ reads: ['1'] }))
    const lines = linesOf(prompt, '<世界状态树>')
    expect(lines, '读了 1，状态块必须在').toHaveLength(1)
    expect(JSON.parse(payloadOf(lines[0])), '父 → 数组 → 字段自身 + 孩子的完整组合').toEqual({
      名称: '镇中心',
      地点: [{ 名称: { 自身: '醉猫旅店', 描述: '炉火噼啪，麦酒和湿羊毛的味道' } }],
    })
    for (const code of ['1.2', '1.2.1', '1.2.1.0', '1.2.1.1']) {
      expect(lines[0], `投影里出现了 code ${code}`).not.toContain(code)
    }
  })

  it('可写段：字段引用说明 JSON 数组 / 长度 / 对象形状里的自身与孩子；容器约束也列孩子', async () => {
    const card = childCard()
    const fieldLines = linesOf(await promptOf(card, reader({ writable: ['2.4.1'] })), '<可写状态>')
    const fieldLine = fieldLines.find((line) => line.startsWith('- 2.4.1「物品」：'))
    expect(fieldLine, `缺少 2.4.1 可写行（实际：${JSON.stringify(fieldLines)}）`).toBeTruthy()
    const fieldRule = payloadOf(fieldLine)
    expect(fieldRule).toContain('JSON 数组')
    expect(fieldRule).toContain('长度')
    expect(fieldRule, '要说明每项是对象').toMatch(/对象|结构体/)
    expect(fieldRule, '要出现自身值').toContain('自身')
    expect(fieldRule, '要出现孩子的中文名').toContain('附魔')
    expect(fieldRule).toContain('文本')
    expect(fieldRule).not.toContain(OWN)
    expect(fieldRule).not.toContain(CHILD)

    const arrayLines = linesOf(await promptOf(card, reader({ writable: ['2.4'] })), '<可写状态>')
    const arrayLine = arrayLines.find((line) => line.startsWith('- 2.4「背包」：'))
    expect(arrayLine, '写容器要有一行').toBeTruthy()
    const arrayRule = payloadOf(arrayLine)
    expect(arrayRule).toContain('物品')
    expect(arrayRule, '容器约束也要说明该字段的自身 + 孩子').toContain('自身')
    expect(arrayRule).toContain('附魔')
    expect(arrayRule).not.toContain(CHILD)
  })

  it('applyWrite 2.4.1：每项收 `{<code>.0, 孩子}` 字段值；标量列 / 短键 / 缺自身 / 多键都拒', async () => {
    const { applyWrite } = await loadEngine()
    const card = childCard()
    const node = reader({ writable: ['2.4.1'] })
    const tree = holdSave(card).tree
    /** 字段写是**整列字段值**：每项是这个字段自己的值，不是整个 item 对象 */
    const value = childItems(['长弓', '火把', '盾'], '尖').map((item) => item['2.4.1'])
    const next = applyWrite({ card, node, tree, path: '2.4.1', value })
    expect(next['2.4']).toEqual([
      { '2.4.1': value[0], '2.4.2': 1 },
      { '2.4.1': value[1], '2.4.2': 1 },
      { '2.4.1': value[2], '2.4.2': 3 },
    ])
    expect(next['2.4'][0]['2.4.1'], '第一项落的是字段对象本身').toEqual({
      '2.4.1.0': '长弓',
      '2.4.1.1': '尖',
    })
    expect(next['2.4'][0]['2.4.2'], '其它字段不动').toBe(1)
    expect(tree['2.4'], '入参 tree 一个字都不许改').toEqual(childItems())

    /** 一列坏值：长度必须与当前 item 数一致，否则红的是长度而不是形状 */
    const badValues = [
      ['标量列（旧形状）', ['长弓', '火把', '盾']],
      [
        '短键',
        [
          { 0: '长弓', [CHILD]: '尖' },
          { 0: '火把', [CHILD]: '亮' },
          { 0: '盾', [CHILD]: '厚' },
        ],
      ],
      ['缺自身', [{ [CHILD]: '尖' }, { [CHILD]: '亮' }, { [CHILD]: '厚' }]],
      [
        '多键',
        [
          { [OWN]: '长弓', [CHILD]: '尖', '2.4.1.9': 'X' },
          { [OWN]: '火把', [CHILD]: '亮', '2.4.1.9': 'X' },
          { [OWN]: '盾', [CHILD]: '厚', '2.4.1.9': 'X' },
        ],
      ],
      [
        '孩子类型错',
        [
          { [OWN]: '长弓', [CHILD]: 7 },
          { [OWN]: '火把', [CHILD]: 7 },
          { [OWN]: '盾', [CHILD]: 7 },
        ],
      ],
    ]
    for (const [note, bad] of badValues) {
      const error = errorOf(() => applyWrite({ card, node, tree, path: '2.4.1', value: bad }))
      expect(error?.code, `${note}：字段写应当 E_VALIDATION`).toBe('E_VALIDATION')
      expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
      expect(tree['2.4'], `${note}：tree 不动`).toEqual(childItems())
    }
  })

  it('整表写 2.4：item 里有孩子字段的对象值也按同一形状收', async () => {
    const { applyWrite } = await loadEngine()
    const card = childCard()
    const node = reader({ writable: ['2.4'] })
    const tree = holdSave(card).tree
    const next = applyWrite({ card, node, tree, path: '2.4', value: childItems(['甲', '乙'], '丙') })
    expect(next['2.4']).toEqual(childItems(['甲', '乙'], '丙'))
    const bad = errorOf(() =>
      applyWrite({ card, node, tree, path: '2.4', value: [{ '2.4.1': { [CHILD]: '锋利' }, '2.4.2': 1 }] }),
    )
    expect(bad?.code).toBe('E_VALIDATION')
  })

  it('容器写 2.4 也授权「自身 + 孩子」的字段列 2.4.1（每项字段对象）', async () => {
    const { applyWrite } = await loadEngine()
    const card = childCard()
    const node = reader({ writable: ['2.4'] })
    const tree = holdSave(card).tree
    const value = childItems(['长弓', '火把', '盾'], '尖').map((item) => item['2.4.1'])
    const next = applyWrite({ card, node, tree, path: '2.4.1', value })
    expect(next['2.4']).toEqual([
      { '2.4.1': value[0], '2.4.2': 1 },
      { '2.4.1': value[1], '2.4.2': 1 },
      { '2.4.1': value[2], '2.4.2': 3 },
    ])
    expect(next['2.4'][0]['2.4.1'][OWN], '自身值在').toBe('长弓')
    expect(next['2.4'][0]['2.4.1'][CHILD], '孩子值在').toBe('尖')
    expect(tree['2.4'], '入参 tree 不动').toEqual(childItems())
  })

  it('applyWrite 2.4.1.1：容器授权写嵌套孩子的整列；own 与兄弟字段不动', async () => {
    const { applyWrite } = await loadEngine()
    const card = childCard()
    const node = reader({ writable: ['2.4'] })
    const tree = holdSave(card).tree
    const next = applyWrite({
      card,
      node,
      tree,
      path: '2.4.1.1',
      value: ['锋利', '锐利', '微光'],
    })
    expect(next['2.4']).toEqual([
      { '2.4.1': { [OWN]: '短剑', [CHILD]: '锋利' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '斗篷', [CHILD]: '锐利' }, '2.4.2': 1 },
      { '2.4.1': { [OWN]: '银币', [CHILD]: '微光' }, '2.4.2': 3 },
    ])
    expect(next['2.4'][1]['2.4.1'][OWN], '父字段的自身值不动').toBe('斗篷')
    expect(next['2.4'][0]['2.4.2'], '兄弟字段不动').toBe(1)
    expect(tree['2.4'], '入参 tree 不动').toEqual(childItems())

    for (const [note, value] of [
      ['长度错', ['锋利', '锐利']],
      ['孩子类型错', [7, 7, 7]],
    ]) {
      const error = errorOf(() => applyWrite({ card, node, tree, path: '2.4.1.1', value }))
      expect(error?.code, `${note}：嵌套孩子写应当 E_VALIDATION`).toBe('E_VALIDATION')
      expect(tree['2.4'], `${note}：tree 不动`).toEqual(childItems())
    }
  })
})

describe('数组 item 字段 · 无孩子的旧行为不变（契约 §0 / §四）', () => {
  it('读投影 / 字段写仍是裸标量；加孩子之前 item 里没有自己的对象层', async () => {
    const card = holdCard()
    const prompt = await promptOf(card, reader({ reads: ['2.4'] }))
    const lines = linesOf(prompt, '<世界状态树>')
    expect(JSON.parse(payloadOf(lines[0]))).toEqual([
      { 物品: '短剑', 数量: 1 },
      { 物品: '斗篷', 数量: 1 },
      { 物品: '银币', 数量: 3 },
    ])

    const { applyWrite } = await loadEngine()
    const node = reader({ writable: ['2.4.1'] })
    const tree = holdSave(card).tree
    const next = applyWrite({ card, node, tree, path: '2.4.1', value: ['长弓', '火把', '盾'] })
    expect(next['2.4']).toEqual([
      { '2.4.1': '长弓', '2.4.2': 1 },
      { '2.4.1': '火把', '2.4.2': 1 },
      { '2.4.1': '盾', '2.4.2': 3 },
    ])
  })
})
