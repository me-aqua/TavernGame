/**
 * 阶段 3 · 数组节点：卡校验 / item 形状 / 存档校验（数组契约 §三）。
 *
 * 这一份钉的是「什么算坏值」：
 *   · item 必须是**同构普通对象**：键集合恰好等于字段定义全集（缺 / 多 / 多出 id 都不行）；
 *   · 字段类型递归收：text 字符串 / integer 安全整数且在上下限内 / enum 白名单 /
 *     object 嵌套对象 / array 嵌套数组；数字字符串不做收编；
 *   · time 不能做 item 字段（直接或嵌套子孙）；标量字段可以有孩子（自身值住 `<code>.0`，2026-11-28 翻面）；
 *     array 字段必须有孩子；
 *   · 初始值表：缺数组路径 / 多字段 code / 多 `2.4.0` / 值形状不对都拦；
 *   · 存档：值路径恰好覆盖；空数组合法；字段 code 不许当键。
 */
import { describe, expect, it } from 'vitest'
import {
  deepCard,
  holdCard,
  holdSave,
  nestedCard,
  nestedItems,
  tooDeepCard,
  withInitialValue,
  withoutInitialValue,
} from './support/array-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const CJK = /[\u4e00-\u9fff]/

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 数组契约 §3.2 的公开判据；缺了给一条指名道姓的红 */
async function arrayFits(state, code, value) {
  const mod = await loadState()
  if (typeof mod.arrayValueFits !== 'function') {
    throw new Error('missing export: core/statetree.ts arrayValueFits（数组契约 §3.2）')
  }
  return mod.arrayValueFits(state, code, value)
}

/** 期望 cardIssues 至少一条落在这些 code / path 上，且消息是中文 */
async function expectIssue(card, codes, note) {
  const { cardIssues } = await loadState()
  const wanted = Array.isArray(codes) ? codes : [codes]
  const issues = cardIssues(card)
  expect(issues.length, `${note}：应当报错`).toBeGreaterThan(0)
  for (const issue of issues) expect(issue.message, `${note}：message 必须是中文`).toMatch(CJK)
  const hit = issues.some((issue) =>
    wanted.some(
      (code) =>
        issue.code === code ||
        issue.path === code ||
        issue.path?.startsWith(`${code}[`) ||
        issue.path?.startsWith(`${code}.`),
    ),
  )
  expect(hit, `${note}：没有一条 issue 指到 ${wanted.join(' / ')}（实际：${JSON.stringify(issues)}）`).toBe(
    true,
  )
  return issues
}

/** 期望 validateCard 拒绝同一份卡（E_VALIDATION + 中文） */
async function expectReject(card, note) {
  const { validateCard } = await loadSchema()
  const error = errorOf(() => validateCard(card))
  expect(error, `${note}：validateCard 应当抛错`).not.toBeNull()
  expect(error.code, `${note}：结构错是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
}

/** 给 state 追加一个元素（其余原样） */
function withElement(card, item) {
  return { ...card, state: [...card.state, item] }
}

describe('数组 · item 形状（§3.2）', () => {
  it('item 必须是普通对象；缺字段 / 多字段 / 多出 id 都不行', async () => {
    const state = holdCard().state
    const bad = [
      ['非对象（字符串）', ['短剑']],
      ['非对象（null）', [null]],
      ['非对象（数组）', [[]]],
      ['缺字段', [{ '2.4.1': '短剑' }]],
      ['多字段', [{ '2.4.1': '短剑', '2.4.2': 1, '2.4.3': 'X' }]],
      ['多出隐藏 id', [{ '2.4.1': '短剑', '2.4.2': 1, id: 'it_1' }]],
      ['多出 order', [{ '2.4.1': '短剑', '2.4.2': 1, order: 1 }]],
      ['两项字段不同构', [{ '2.4.1': '短剑', '2.4.2': 1 }, { '2.4.1': '斗篷' }]],
    ]
    for (const [note, value] of bad) {
      expect(await arrayFits(state, '2.4', value), note).toBe(false)
      await expectIssue(withInitialValue(holdCard(), '2.4', value), '2.4', note)
    }
  })

  it('字段类型严格收：text / integer / enum 的值错了就假', async () => {
    const state = holdCard().state
    const cases = [
      ['text 写成数字', [{ '2.4.1': 7, '2.4.2': 1 }]],
      ['integer 写成数字字符串', [{ '2.4.1': '短剑', '2.4.2': '1' }]],
      ['integer 写成小数', [{ '2.4.1': '短剑', '2.4.2': 1.5 }]],
      ['integer 超上限', [{ '2.4.1': '短剑', '2.4.2': 1000 }]],
      ['integer 低于下限', [{ '2.4.1': '短剑', '2.4.2': -1 }]],
    ]
    for (const [note, value] of cases) {
      expect(await arrayFits(state, '2.4', value), note).toBe(false)
    }

    // enum 字段：白名单内合法，白名单外为假
    const enumCard = holdCard({
      state: [
        ...holdCard().state.filter((item) => item.code !== '2.4.2'),
        { code: '2.4.2', name: '品质', note: '', type: 'enum', values: ['普通', '稀有'] },
      ],
    })
    const good = [{ '2.4.1': '短剑', '2.4.2': '普通' }]
    expect(await arrayFits(enumCard.state, '2.4', good), '正控：enum 在白名单内').toBe(true)
    expect(
      await arrayFits(enumCard.state, '2.4', [{ '2.4.1': '短剑', '2.4.2': 'X' }]),
      'enum 不在白名单',
    ).toBe(false)
    expect(enumCard.state.filter((item) => item.code === '2.4.2')).toHaveLength(1)
  })

  it('嵌套对象 / 嵌套数组递归判：缺键、多键、内层类型错都假', async () => {
    const state = nestedCard().state
    const good = nestedItems()
    expect(await arrayFits(state, '2.4', good), '正控：嵌套值合法').toBe(true)

    const missing = JSON.parse(JSON.stringify(good))
    delete missing[0]['2.4.2']['2.4.2.1']
    expect(await arrayFits(state, '2.4', missing), 'object 字段缺键').toBe(false)

    const extra = JSON.parse(JSON.stringify(good))
    extra[0]['2.4.2']['2.4.2.9'] = 'X'
    expect(await arrayFits(state, '2.4', extra), 'object 字段多键').toBe(false)

    const wrongNested = JSON.parse(JSON.stringify(good))
    wrongNested[0]['2.4.2']['2.4.2.2'][0]['2.4.2.2.2'] = '2'
    expect(await arrayFits(state, '2.4', wrongNested), '嵌套 integer 写成字符串').toBe(false)

    const notArray = JSON.parse(JSON.stringify(good))
    notArray[0]['2.4.2']['2.4.2.2'] = 'X'
    expect(await arrayFits(state, '2.4', notArray), '嵌套 array 字段不是数组').toBe(false)

    await expectIssue(withInitialValue(nestedCard(), '2.4', missing), '2.4', '嵌套 object 缺键')
    await expectReject(withInitialValue(nestedCard(), '2.4', missing), '嵌套 object 缺键')
  })

  it('time 不能做 item 字段（直接 / 嵌套子孙都拦）', async () => {
    const direct = withElement(holdCard(), {
      code: '2.4.3',
      name: '时刻',
      note: '',
      type: 'time',
      timeMode: 'year-minute',
      holidays: { international: false, china: false, traditional: false },
    })
    await expectIssue(direct, '2.4', '直接 time 字段')
    await expectReject(direct, '直接 time 字段')

    const nested = withElement(nestedCard(), {
      code: '2.4.2.3',
      name: '时刻',
      note: '',
      type: 'time',
      timeMode: 'year-minute',
      holidays: { international: false, china: false, traditional: false },
    })
    await expectIssue(nested, '2.4', '嵌套 time 字段')
  })

  it('标量字段可以有孩子（2026-11-28 翻面）：`<code>.0` + 孩子是合法值；仍写裸标量则拒', async () => {
    const card = withInitialValue(
      withElement(holdCard(), { code: '2.4.1.1', name: '附魔', note: '', type: 'text' }),
      '2.4',
      [{ '2.4.1': { '2.4.1.0': '短剑', '2.4.1.1': '锋利' }, '2.4.2': 1 }],
    )
    const value = [{ '2.4.1': { '2.4.1.0': '短剑', '2.4.1.1': '锋利' }, '2.4.2': 1 }]
    expect(await arrayFits(card.state, '2.4', value), '正控：自身值 + 孩子').toBe(true)
    const { cardIssues } = await loadState()
    expect(cardIssues(card), '有自身值 + 孩子的字段是合法卡').toEqual([])
    const { validateCard } = await loadSchema()
    expect(() => validateCard(card)).not.toThrow()

    const bare = withInitialValue(card, '2.4', [{ '2.4.1': '短剑', '2.4.2': 1 }])
    await expectIssue(bare, '2.4', '有孩子的字段仍写裸标量')
    await expectReject(bare, '有孩子的字段仍写裸标量')
  })

  it('object / array 字段必须有孩子', async () => {
    const emptyObject = nestedCard({
      state: nestedCard().state.filter((item) => !item.code.startsWith('2.4.2.')),
    })
    await expectIssue(emptyObject, '2.4.2', '空 object 字段')
    const emptyArrayField = nestedCard({
      state: nestedCard().state.filter((item) => !item.code.startsWith('2.4.2.2.')),
    })
    await expectIssue(emptyArrayField, ['2.4.2.2', '2.4.2'], '空 array 字段')
  })

  it('深度 6 被拦（定义层与普通元素同一把尺）', async () => {
    await expectIssue(tooDeepCard(), '2.4.1.1.1.1', '深度 6')
    expect(await arrayFits(deepCard().state, '2.4', [{ '2.4.1': { '2.4.1.1': { '2.4.1.1.1': 'X' } } }])).toBe(
      true,
    )
  })
})

describe('数组 · 初始值表（§3.1）', () => {
  it('缺数组路径 / 多字段 code / 多 2.4.0 都被拦', async () => {
    await expectIssue(withoutInitialValue(holdCard(), '2.4'), '2.4', '缺 2.4')
    await expectReject(withoutInitialValue(holdCard(), '2.4'), '缺 2.4')

    const extraField = withInitialValue(holdCard(), '2.4.1', '短剑')
    await expectIssue(extraField, ['2.4.1', '2.4'], '多出字段 code')
    await expectReject(extraField, '多出字段 code')

    const ownSlot = withInitialValue(holdCard(), '2.4.0', [])
    await expectIssue(ownSlot, ['2.4.0', '2.4'], '多出 2.4.0')
    await expectReject(ownSlot, '多出 2.4.0')
  })

  it('2.4 的值不是合法数组 / 形状不对都拦，消息指到 2.4', async () => {
    for (const [note, value] of [
      ['不是数组', { '2.4.1': '短剑', '2.4.2': 1 }],
      ['item 缺字段', [{ '2.4.1': '短剑' }]],
      ['item 多字段', [{ '2.4.1': '短剑', '2.4.2': 1, id: 'it_1' }]],
    ]) {
      await expectIssue(withInitialValue(holdCard(), '2.4', value), '2.4', note)
      await expectReject(withInitialValue(holdCard(), '2.4', value), note)
    }
  })

  it('数组元素自己不许带 initial（初始值只挂根元素）', async () => {
    const card = holdCard({
      state: holdCard().state.map((item) => (item.code === '2.4' ? { ...item, initial: [] } : item)),
    })
    await expectIssue(card, '2.4', '数组元素带 initial')
  })
})

describe('数组 · 存档校验（§3.3）', () => {
  it('合法存档（数组 + 空数组）能过', async () => {
    const { validateSave } = await loadSchema()
    const card = holdCard()
    expect(() => validateSave(holdSave(card), card)).not.toThrow()
    const empty = holdSave(card, { tree: { ...holdSave(card).tree, 2.4: [] } })
    expect(() => validateSave(empty, card), '空数组合法').not.toThrow()
  })

  it('缺数组路径 / 多字段键 / 多 2.4.0 / 数组放到标量路径都被拦', async () => {
    const { validateSave } = await loadSchema()
    const card = holdCard()
    const base = holdSave(card).tree

    const missing = { ...base }
    delete missing['2.4']
    expect(errorOf(() => validateSave(holdSave(card, { tree: missing }), card))?.code).toBe('E_VALIDATION')

    expect(
      errorOf(() => validateSave(holdSave(card, { tree: { ...base, '2.4.1': '短剑' } }), card))?.code,
      '字段 code 不是值路径',
    ).toBe('E_VALIDATION')
    expect(
      errorOf(() => validateSave(holdSave(card, { tree: { ...base, '2.4.0': [] } }), card))?.code,
      '数组没有自身值槽',
    ).toBe('E_VALIDATION')
    expect(
      errorOf(() => validateSave(holdSave(card, { tree: { ...base, 2.1: ['X'] } }), card))?.code,
      '标量路径上放数组',
    ).toBe('E_VALIDATION')
  })

  it('数组值形状不对 ⇒ E_VALIDATION；没有卡时数组按 JSON 形状收下', async () => {
    const { validateSave } = await loadSchema()
    const card = holdCard()
    const badTree = { ...holdSave(card).tree, 2.4: [{ '2.4.1': '短剑' }] }
    const error = errorOf(() => validateSave(holdSave(card, { tree: badTree }), card))
    expect(error?.code).toBe('E_VALIDATION')
    expect(error.message).toMatch(CJK)

    // 没有卡可比时（存储层整表读）：数组 / 普通对象值不按字段形状判，与「时间三种形状都收」同一口径
    expect(() => validateSave(holdSave(card, { tree: badTree })), '无卡时只看 JSON 形状').not.toThrow()
  })
})
