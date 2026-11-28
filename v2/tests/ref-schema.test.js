/**
 * 阶段 4 · 引用的定义层校验（引用契约 §三 · 验收 2 / 18）。
 *
 * 这一份钉的是「作者能定义出什么形状的引用」，全部走 `cardIssues` / `validateCard`（保存按钮与
 * 引擎共用那份清单）：
 *   · `refSource` 必须是状态树里存在的 **array 元素**（文字 / 数字 / 下拉 / 对象 / 字段 / 自己都不行）；
 *   · `refFields` 至少一个，且必须是源数组 item 的**直接子字段**，第一版只允许 text / integer / enum；
 *   · `refFilter` 可选：字段必须是源的直接子字段且是 text / integer / enum；值类型与字段一致，enum 在白名单；
 *   · `min` / `max` 是整数、`0 <= min <= max`、`max >= 1`、`max <= 999`；缺省 = `0..1`；
 *   · `ref` 可以出现在数组 item 内（`2.6.1`），但源不能包含它所在的数组（防递归）；
 *   · 投影字段是元数据：不产出状态元素、不是值路径。
 *
 * 值形状（`id | null` / `id[]`）在 `ref-value-shape.test.js`；带子元素的 ref 在 `ref-children.test.js`。
 */
import { describe, expect, it } from 'vitest'
import {
  elementOf,
  objectFieldBagCard,
  patchElement,
  refCard,
  withInitialValue,
  withElement,
  refElement,
} from './support/ref-fixtures.js'
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

/**
 * 期望 `cardIssues` 至少一条落在 2.5（或给定的 code）上。
 *
 * 第二关的判据必须能分清「这条规则没做」与「ref 还不认识」：所以再要求**除了 baseline 已有的
 * 问题之外**还多出一条 —— 只靠「类型 ref 不认识」凑数的不算（那一条迟早会消失）。
 */
async function expectIssue(card, codes, note, baseline = refCard()) {
  const { cardIssues } = await loadState()
  const wanted = Array.isArray(codes) ? codes : [codes]
  const issues = cardIssues(card)
  expect(issues.length, `${note}：应当报错`).toBeGreaterThan(0)
  for (const issue of issues) expect(issue.message, `${note}：message 必须是中文`).toMatch(CJK)
  const hit = issues.some((issue) =>
    wanted.some((code) => issue.code === code || issue.path === code || issue.path?.startsWith(`${code}.`)),
  )
  expect(hit, `${note}：没有一条 issue 指到 ${wanted.join(' / ')}（实际：${JSON.stringify(issues)}）`).toBe(
    true,
  )
  const known = new Set(cardIssues(baseline).map(issueText))
  expect(
    issues.some((issue) => !known.has(issueText(issue))),
    `${note}：必须报出这条规则本身，不能只靠 baseline 里已有的问题（实际：${JSON.stringify(issues)}）`,
  ).toBe(true)
  return issues
}

/** 一条问题的身份（比较 baseline 用） */
function issueText(issue) {
  return `${issue.errorCode}|${issue.code}|${issue.path}|${issue.message}`
}

/** 期望 `validateCard` 拒绝同一份卡（E_VALIDATION + 中文） */
async function expectReject(card, note) {
  const { validateCard } = await loadSchema()
  const error = errorOf(() => validateCard(card))
  expect(error, `${note}：validateCard 应当抛错`).not.toBeNull()
  expect(error.code, `${note}：结构错是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
}

/** 期望这张卡是干净的 */
async function expectClean(card, note) {
  const { cardIssues } = await loadState()
  expect(cardIssues(card), `${note}：不该有问题（实际：${JSON.stringify(cardIssues(card))}）`).toEqual([])
}

/** 拿掉元素上的几个字段（造「配置不完整」） */
function withoutKeys(card, code, keys) {
  const element = elementOf(card, code)
  const next = { ...element }
  for (const key of keys) delete next[key]
  return { ...card, state: card.state.map((item) => (item.code === code ? next : item)) }
}

/** 给 `2.5` 换筛选条件，并把初始引用换成满足它的那条 item */
function withFilter(card, filter, id = 'id_1') {
  return withInitialValue(patchElement(card, '2.5', { refFilter: filter }), '2.5', id)
}

describe('引用 · refSource 必须是数组（§三）', () => {
  it('正控：引用 / 数组内引用 / 多引用都是合法卡，一条问题都没有', async () => {
    await expectClean(refCard(), '2.5 单引用 + 3.2 多引用 + 2.6.1 数组内引用')
    await expectClean(
      withInitialValue(
        withElement(
          refCard(),
          refElement('2.8', '备用主手', { refSource: '2.4', refFields: ['2.4.1'], min: 0, max: 1 }),
        ),
        '2.8',
        null,
      ),
      '同源两个直接引用者',
    )
  })

  it('指向文字 / 对象 / 不存在的 code / 数组字段 ⇒ 都被拦', async () => {
    const cases = [
      ['文字元素', '2.1'],
      ['对象元素', '1'],
      ['不存在的 code', '2.9'],
      ['数组的字段（不是数组元素）', '2.4.1'],
      ['引用自己', '2.5'],
    ]
    for (const [note, source] of cases) {
      const card = patchElement(refCard(), '2.5', { refSource: source })
      await expectIssue(card, '2.5', `refSource = ${note}`)
      await expectReject(card, `refSource = ${note}`)
    }
  })

  it('ref 在数组 item 内时，源不能包含它所在的数组（防递归）', async () => {
    const card = patchElement(refCard(), '2.6.1', { refSource: '2.6' })
    await expectIssue(card, ['2.6.1', '2.6'], '2.6.1 的来源不能是它所在的 2.6')
    await expectReject(card, '数组内引用指向自己所在的数组')
  })

  it('切源之后配置不完整 ⇒ 阻止保存并点名（§9.2）', async () => {
    await expectIssue(withoutKeys(refCard(), '2.5', ['refSource']), '2.5', '缺 refSource')
    await expectIssue(withoutKeys(refCard(), '2.5', ['refFields']), '2.5', '缺 refFields')
  })
})

describe('引用 · refFields（§三 / §5.2）', () => {
  it('正控：源的直接子字段 text / integer / enum 都能投影，多个按勾选顺序', async () => {
    for (const [note, fields] of [
      ['text', ['2.4.1']],
      ['integer', ['2.4.2']],
      ['enum', ['2.4.3']],
      ['两个字段', ['2.4.1', '2.4.2']],
    ]) {
      await expectClean(patchElement(refCard(), '2.5', { refFields: fields }), `投影 ${note}`)
    }
  })

  it('空清单 / 缺清单 / 不是直接子字段 ⇒ 都被拦', async () => {
    for (const [note, fields] of [
      ['空数组', []],
      ['源自己', ['2.4']],
      ['不存在的字段', ['2.4.9']],
      ['别的数组的字段', ['1.4.1']],
      ['孙字段（非直接子字段）', ['2.4.4.1']],
    ]) {
      await expectIssue(patchElement(refCard(), '2.5', { refFields: fields }), '2.5', `refFields = ${note}`)
    }
    await expectIssue(withoutKeys(refCard(), '2.5', ['refFields']), '2.5', '缺 refFields 键')
  })

  it('第一版不许投影对象字段（整棵子树任意勾不碰，§5.2）', async () => {
    const card = patchElement(objectFieldBagCard(), '2.5', { refFields: ['2.4.4'] })
    await expectIssue(card, '2.5', '投影对象字段', objectFieldBagCard())
    await expectReject(card, '投影对象字段')
  })

  it('投影字段是元数据：不产出状态元素、不是值路径', async () => {
    const { pathsOf, elementOfPath } = await loadState()
    const state = refCard().state
    expect(
      state.filter((item) => item.code.startsWith('2.5.')).map((item) => item.code),
      '2.5 没有子元素（2.5.1 / 2.5.2 只在带子元素的派生卡里）',
    ).toEqual([])
    expect(pathsOf(state, '2.5'), '单引用只有自己那一条值路径').toEqual(['2.5'])
    expect(pathsOf(state, '2.5.2.4.1'), '投影字段不是值路径').toEqual([])
    expect(elementOfPath(state, '2.5.2.4.1'), '投影字段不是元素').toBeUndefined()
  })
})

describe('引用 · refFilter（§三 / §5.3）', () => {
  it('正控：text / integer / enum 三种等值筛选都能定义', async () => {
    await expectClean(withFilter(refCard(), { field: '2.4.1', value: '短剑' }), 'text 等值')
    await expectClean(withFilter(refCard(), { field: '2.4.2', value: 1 }), 'integer 等值')
    await expectClean(withFilter(refCard(), { field: '2.4.3', value: '是' }), 'enum 等值')
    await expectClean(refCard(), '不筛选（清空筛选字段 = 不筛选）')
  })

  it('筛选字段不是源的直接子字段 / 不存在 / 是对象 ⇒ 都被拦', async () => {
    for (const [note, filter] of [
      ['别的数组的字段', { field: '2.1', value: 'x' }],
      ['不存在的字段', { field: '2.4.9', value: 'x' }],
      ['孙字段', { field: '2.4.4.1', value: 'x' }],
      ['对象字段', { field: '2.4.4', value: '火' }],
    ]) {
      const card = objectFieldBagCard()
      await expectIssue(withFilter(card, filter), '2.5', `筛选字段 = ${note}`, card)
    }
  })

  it('筛选值类型不符 / enum 不在白名单 ⇒ 都被拦（验收 18）', async () => {
    for (const [note, filter] of [
      ['enum 值不在白名单', { field: '2.4.3', value: '也许' }],
      ['integer 写成字符串', { field: '2.4.2', value: '1' }],
      ['text 写成数字', { field: '2.4.1', value: 1 }],
      ['enum 值写成数字', { field: '2.4.3', value: 1 }],
      ['text 写成布尔', { field: '2.4.1', value: true }],
    ]) {
      await expectIssue(withFilter(refCard(), filter), '2.5', `筛选值 = ${note}`)
    }
  })

  it('筛选结构本身坏掉（不是对象 / 缺 field / 缺 value）⇒ 被拦', async () => {
    for (const [note, filter] of [
      ['不是对象', '是'],
      ['缺 field', { value: '是' }],
      ['缺 value', { field: '2.4.3' }],
      ['值是 null', { field: '2.4.3', value: null }],
    ]) {
      await expectIssue(patchElement(refCard(), '2.5', { refFilter: filter }), '2.5', `refFilter ${note}`)
    }
  })
})

describe('引用 · min / max（§三 / §5.4）', () => {
  it('正控：0..1 / 1..1 / 0..4 / 2..4 / 999 都合法', async () => {
    for (const [note, bounds, value] of [
      ['0..1', { min: 0, max: 1 }, 'id_1'],
      ['1..1', { min: 1, max: 1 }, 'id_1'],
      ['0..4', { min: 0, max: 4 }, null],
      ['2..4', { min: 2, max: 4 }, ['id_1', 'id_2']],
      ['0..999 上限', { min: 0, max: 999 }, null],
    ]) {
      await expectClean(
        withInitialValue(patchElement(refCard(), '2.5', bounds), '2.5', value),
        `${note} 应当是合法定义`,
      )
    }
  })

  it('缺省 min / max = 0 / 1（单引用）', async () => {
    const card = withoutKeys(refCard(), '2.5', ['min', 'max'])
    await expectClean(withInitialValue(card, '2.5', null), '缺省 min=0 时 null 合法')
    await expectClean(withInitialValue(card, '2.5', 'id_1'), '缺省 max=1 时单个 id 合法')
    await expectReject(withInitialValue(card, '2.5', ['id_1', 'id_2']), '缺省 max=1 时数组非法')
  })

  it('坏边界：负数 / min>max / max 0 / max>999 / 非整数 ⇒ 都被拦', async () => {
    for (const [note, bounds] of [
      ['min 负数', { min: -1, max: 1 }],
      ['min > max', { min: 3, max: 2 }],
      ['max 0（max 必须 ≥ 1）', { min: 0, max: 0 }],
      ['max 1000（第一版上限 999）', { min: 0, max: 1000 }],
      ['min 非整数', { min: 0.5, max: 1 }],
      ['max 非整数', { min: 0, max: 1.5 }],
      ['min 是字符串', { min: '0', max: 1 }],
      ['max 是字符串', { min: 0, max: '1' }],
    ]) {
      await expectIssue(patchElement(refCard(), '2.5', bounds), '2.5', `边界 ${note}`)
    }
  })
})
