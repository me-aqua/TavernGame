/**
 * 阶段 4 · ref 的类型转换（引用契约 §九 · 验收 24）。
 *
 * 统一规则（`ref` ↔ `text` / `integer` / `enum` / `结构`（有子元素的标量）/ `array`）：
 *   · 弹窗警告（UI 那一格，这里不测）；
 *   · **清空该元素及其子元素的初始值**；
 *   · **不把旧值转换成新值**（id 不写成文字，文字也不猜成 id）；
 *   · **子元素结构保留**；
 *   · 丢弃旧类型专属配置（`refSource` / `refFields` / `refFilter` / `min` / `max`、白名单、上下限）；
 *   · `ref` ↔ `time` **拒绝**；`object` 不是可选类型（「结构体」就是「有孩子」）。
 *
 * 全部走 `setElementType`（编辑器换类型的数据层唯一入口）与 `cardIssues`（能不能保存）。
 */
import { describe, expect, it } from 'vitest'
import {
  bagItems,
  element,
  elementOf,
  patchElement,
  refCard,
  refChildCard,
  withElement,
  withInitialValue,
} from './support/ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))

const CJK = /[\u4e00-\u9fff]/

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 某个根元素的初始值表 */
function tableOf(card, rootCode) {
  return elementOf(card, rootCode).initial
}

/** 期望这次换类型被拒：E_VALIDATION + 中文 */
async function expectReject(card, code, type, note) {
  const { setElementType } = await loadState()
  const error = errorOf(() => setElementType(card, code, type))
  expect(error, `${note}：${code} → ${type} 应当被拒`).not.toBeNull()
  expect(error.code, `${note}：换类型的错是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
  return error
}

/** 期望 `cardIssues` 有一条指到这个 code（转换后配置不完整） */
async function expectIssue(card, code, note) {
  const { cardIssues } = await loadState()
  const issues = cardIssues(card)
  expect(issues.length, `${note}：应当报错`).toBeGreaterThan(0)
  for (const issue of issues) expect(issue.message, `${note}：message 必须是中文`).toMatch(CJK)
  expect(
    issues.some((issue) => issue.code === code || issue.path === code || issue.path?.startsWith(`${code}.`)),
    `${note}：没有一条 issue 指到 ${code}（实际：${JSON.stringify(issues)}）`,
  ).toBe(true)
}

describe('转换 · ref → 标量 / 结构（§9.1）', () => {
  it('ref → text：丢配置、清自身值、不搬运 id', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refCard(), '2.5', 'text')
    const element = elementOf(next, '2.5')
    expect(element.type).toBe('text')
    for (const key of ['refSource', 'refFields', 'refFilter', 'min', 'max']) {
      expect(element, `旧类型专属配置 ${key} 应当被移除`).not.toHaveProperty(key)
    }
    expect(tableOf(next, '2')['2.5'], '目标类型写自己的默认值').toBe('')
    // 作用域只看被转换的这一格：别的数组（2.4 / 2.6）本来就带 id，不该被这条断言牵连
    expect(tableOf(next, '2')['2.5'], '不许把 id 写成文字搬过来').not.toContain('id_1')
    expect(tableOf(next, '2')['2.5.0'], '带子元素时自身值也不许搬 id').toBeUndefined()
  })

  it('ref → integer：自身值 0（不是 id）', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refCard(), '2.5', 'integer')
    expect(elementOf(next, '2.5').type).toBe('integer')
    expect(tableOf(next, '2')['2.5']).toBe(0)
  })

  it('ref → enum：自身值取白名单第一项，白名单原样留着（空白名单由卡校验拦）', async () => {
    const { setElementType } = await loadState()
    const enumSource = patchElement(refCard(), '2.5', { values: ['甲', '乙'] })
    const next = setElementType(enumSource, '2.5', 'enum')
    expect(elementOf(next, '2.5')).toMatchObject({ type: 'enum', values: ['甲', '乙'] })
    expect(tableOf(next, '2')['2.5']).toBe('甲')
  })

  it('ref → 结构（有子元素）：子元素结构保留、子元素初始值清空、自身值在 .0', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refChildCard(), '2.5', 'text')
    expect(elementOf(next, '2.5.1'), '子元素一个都不许丢').toBeTruthy()
    expect(elementOf(next, '2.5.2')).toBeTruthy()
    expect(elementOf(next, '2.5').type).toBe('text')
    const table = tableOf(next, '2')
    expect(table['2.5.0'], '自身值清成目标类型的默认值').toBe('')
    expect(table['2.5.1'], 'enum 子元素清成白名单首项（原来是「双手」）').toBe('单手')
    expect(table['2.5.2'], 'text 子元素清空（原来是「火」）').toBe('')
  })
})

describe('转换 · 标量 / 结构 → ref（§9.1）', () => {
  it('text → ref：自身值 null、旧值不搬运、配置要重选', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refCard(), '2.1', 'ref')
    const element = elementOf(next, '2.1')
    expect(element.type).toBe('ref')
    expect(tableOf(next, '2')['2.1'], 'ref 空值就是 null（不是空串）').toBeNull()
    expect(JSON.stringify(tableOf(next, '2')), '不许把旧文字搬成 id').not.toContain('旅人')
    await expectIssue(next, '2.1', '刚转成 ref、还没选源 / 字段 ⇒ 保存被拦')
  })

  it('enum → ref：白名单（旧类型专属配置）被丢弃', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refCard(), '2.3', 'ref')
    expect(elementOf(next, '2.3')).not.toHaveProperty('values')
    expect(elementOf(next, '2.3').type).toBe('ref')
  })

  it('结构 → ref：子元素保留，成为关系子元素（自身值 null）', async () => {
    const { setElementType } = await loadState()
    const scalar = setElementType(refChildCard(), '2.5', 'text')
    const next = setElementType(scalar, '2.5', 'ref')
    expect(elementOf(next, '2.5.1'), '子元素结构保留').toBeTruthy()
    expect(elementOf(next, '2.5.2')).toBeTruthy()
    expect(tableOf(next, '2')['2.5.0'], 'ref 自身值置 null').toBeNull()
  })
})

describe('转换 · ref ↔ array（§9.1）', () => {
  it('ref → array：子元素变成 item 字段，数组值 []，ref 值与子元素初始值都清掉', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refChildCard(), '2.5', 'array')
    expect(elementOf(next, '2.5').type).toBe('array')
    expect(elementOf(next, '2.5.1'), '子元素留成数组字段').toBeTruthy()
    expect(elementOf(next, '2.5.2')).toBeTruthy()
    const table = tableOf(next, '2')
    expect(table['2.5'], '数组值设 []').toEqual([])
    expect(
      Object.keys(table).filter((path) => path.startsWith('2.5.')),
      'ref 值 / 子元素初始值一条都不留',
    ).toEqual([])
  })

  it('ref（无子元素）→ array：[] 且卡校验点名字段要补（§9.1 末条）', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refCard(), '2.5', 'array')
    expect(tableOf(next, '2')['2.5']).toEqual([])
    await expectIssue(next, '2.5', '没有子元素 ⇒ 数组没有 item 字段')
  })

  it('array → ref：字段留成子元素，数组值清空，ref 自身值 null，不搬运第一项', async () => {
    const { setElementType } = await loadState()
    const next = setElementType(refCard(), '2.4', 'ref')
    expect(elementOf(next, '2.4').type).toBe('ref')
    expect(elementOf(next, '2.4.1'), '字段变关系子元素').toBeTruthy()
    expect(elementOf(next, '2.4.3')).toBeTruthy()
    const table = tableOf(next, '2')
    // 字段留成子元素 ⇒ 自身值住 2.4.0（不是裸 2.4）
    expect(table['2.4.0'], '数组值清空后留 null（有子元素 ⇒ 自身值在 .0）').toBeNull()
    expect('2.4' in table, '有子元素时裸 2.4 不放自身值').toBe(false)
    const text = JSON.stringify(table)
    for (const old of ['短剑', '斗篷', '银币']) expect(text, `不许搬运第一项「${old}」`).not.toContain(old)
    await expectIssue(next, '2.4', '刚转成 ref、还没选源 / 字段 ⇒ 保存被拦')
  })
})

describe('转换 · 拒绝的两类（§9.1 / §9.2）', () => {
  it('ref ↔ time 双向都拒（不做转换）', async () => {
    await expectReject(refCard(), '2.5', 'time', 'ref → time')
    await expectReject(refCard(), '0', 'ref', 'time → ref')
  })

  it('object 不是可选类型：ref → object 被拒（「结构体」= 有孩子，不是一种类型）', async () => {
    await expectReject(refCard(), '2.5', 'object', 'ref → object')
    await expectReject(patchElement(refCard(), '2.5', { min: 0 }), '2.5', 'object', 'ref → object（可空）')
  })

  it('回归：array → object 仍被拒（结构体不可选）', async () => {
    await expectReject(refCard(), '2.4', 'object', 'array → object')
  })
})

describe('转换 · 转换后配置不完整（§9.2）', () => {
  it('array → ref 之后没选源 / 字段 ⇒ 保存被拦、点名 2.4（值已经是 null）', async () => {
    const { setElementType, cardIssues } = await loadState()
    const converted = setElementType(refCard(), '2.4', 'ref')
    expect(cardIssues(converted), '缺 refSource / refFields ⇒ 保存被拦').not.toHaveLength(0)
    expect(
      cardIssues(converted).some((issue) => issue.code === '2.4' || issue.path === '2.4'),
      '点名的必须是 2.4',
    ).toBe(true)
    // 字段留成子元素 ⇒ 自身值住 2.4.0`n    expect(tableOf(converted, '2')['2.4.0'], '转换完的初始值是 null（住 .0）').toBeNull()
    expect(bagItems(), '正控：源卡没被动过').toHaveLength(3)
  })
})

describe('转换 · item 里的 array → ref：默认指针 null', () => {
  it('2.4.4 数组字段换成 ref ⇒ 每个 item 的指针是 null（不是空串），卡补上源后合法', async () => {
    const { setElementType, cardIssues } = await loadState()
    const base = refCard()
    const items = base.state
      .find((item) => item.code === '2')
      .initial['2.4'].map((item, index) => ({
        ...item,
        '2.4.4': index === 0 ? [{ id: 'id_1', '2.4.4.1': '药膏' }] : [],
      }))
    const withArray = withInitialValue(
      withElement(
        withElement(base, element('2.4.4', 'array', { name: '内袋' })),
        element('2.4.4.1', 'text', { name: '物品' }),
      ),
      '2.4',
      items,
    )
    const converted = setElementType(withArray, '2.4.4', 'ref')
    expect(elementOf(converted, '2.4.4').type).toBe('ref')
    const values = converted.state.find((item) => item.code === '2').initial['2.4']
    for (const [index, item] of values.entries()) {
      expect(item['2.4.4']['2.4.4.0'], `第 ${index + 1} 个 item 的指针应为 null`).toBeNull()
    }
    // 补上源之后卡应当合法（指针 null + min 0）
    const ready = patchElement(patchElement(converted, '2.4.4', { refSource: '1.4' }), '2.4.4', {
      refFields: ['1.4.1'],
    })
    expect(cardIssues(ready), '补上引用源后卡应当合法').toEqual([])
  })
})
