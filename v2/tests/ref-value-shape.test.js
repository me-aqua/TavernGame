/**
 * 阶段 4 · 引用的值形状与写入校验（引用契约 §四 / §8.1 / §8.2 · 验收 3 / 5 / 7 / 9 / 10 / 16 / 17）。
 *
 * 这一份钉的是「值什么时候合法」，两边同一把尺：
 *   · **卡 / 存档**走 `cardIssues` / `saveTreeIssues` / `validateSave`；
 *   · **写入**走 `applyWrite`（模型那条路）。
 *
 *   · 单引用（`max = 1`）：`id | null`；`min = 0` 时 `null` 合法，`min = 1` 时 `null` 非法；
 *     不许 `[]` / `{}` / `""` / 数字；
 *   · 多引用（`max > 1`）：零条统一 `null`（不是 `[]`）；非空是**有序、不重复**的 `id[]`，
 *     长度 `min..max`；
 *   · 有 `refFilter` 时每个非空 id 还必须满足 `item[field] === value`（改筛选字段让引用失效 ⇒ 保存被拦）；
 *   · 非法 ⇒ `E_VALIDATION`，报文点名元素 code / 源 code / 非法 id 或数量；失败的写一个字都不改 tree。
 */
import { describe, expect, it } from 'vitest'
import {
  nodeOf,
  patchElement,
  refCard,
  saveOf,
  treeOf,
  withInitialValue,
  withTreeValue,
} from './support/ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const CJK = /[\u4e00-\u9fff]/

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 错误里能点名的那几格（message + detail）拼成一段文本 */
function textOf(error) {
  return `${error?.message ?? ''} ${JSON.stringify(error?.detail ?? {})}`
}

/** 存档校验这条尺：期望抛 E_VALIDATION + 中文 */
async function expectSaveReject(card, tree, note) {
  const { validateSave } = await loadSchema()
  const error = errorOf(() => validateSave(saveOf(card, { tree }), card))
  expect(error, `${note}：存档校验应当拒绝`).not.toBeNull()
  expect(error.code, `${note}：值错是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
  return error
}

/** 写入这条尺：期望抛 E_VALIDATION + 中文 */
async function expectWriteReject(card, path, value, note) {
  const { applyWrite } = await loadEngine()
  const tree = treeOf(card)
  const error = errorOf(() => applyWrite({ card, node: nodeOf(card, 'check'), tree, path, value }))
  expect(error, `${note}：写入应当被拒`).not.toBeNull()
  expect(error.code, `${note}：值错是 E_VALIDATION`).toBe('E_VALIDATION')
  expect(error.message, `${note}：错误消息必须是中文`).toMatch(CJK)
  return error
}

/** 两条尺都拒同一份坏值（卡校验 / 写入不各判一套） */
async function expectBothReject(card, path, value, note) {
  const saveError = await expectSaveReject(card, withTreeValue(treeOf(card), path, value), note)
  const writeError = await expectWriteReject(card, path, value, note)
  expect(textOf(writeError), `${note}：报文要点名元素或 id`).toContain(path)
  return { saveError, writeError }
}

describe('引用值 · 单引用（max = 1，§4.1）', () => {
  it('正控：id 与 null（min = 0）都过存档校验；写入同样接受', async () => {
    const { validateSave } = await loadSchema()
    const { applyWrite } = await loadEngine()
    const card = refCard()
    for (const value of ['id_1', null]) {
      expect(() =>
        validateSave(saveOf(card, { tree: withTreeValue(treeOf(card), '2.5', value) }), card),
      ).not.toThrow()
      const written = applyWrite({
        card,
        node: nodeOf(card, 'check'),
        tree: treeOf(card),
        path: '2.5',
        value,
      })
      expect(written['2.5']).toBe(value)
    }
  })

  it('坏形状：数组 / 空对象 / 空串 / 数字 / 布尔 / 不存在的 id ⇒ 两条尺都拒', async () => {
    const card = refCard()
    for (const [note, value] of [
      ['空数组', []],
      ['空对象', {}],
      ['空串', ''],
      ['数字', 1],
      ['布尔', true],
      ['不存在的 id', 'id_9'],
    ]) {
      await expectBothReject(card, '2.5', value, `单引用写 ${note}`)
    }
  })

  it('多值写不进单引用：数组被拒（§8.2「单引用不许多值」）', async () => {
    const card = refCard()
    const error = await expectWriteReject(card, '2.5', ['id_1', 'id_2'], '单引用写两条')
    expect(textOf(error)).toContain('2.5')
  })

  it('min = 1 时 null 非法（2.6.1 来源是 1..1）', async () => {
    const card = refCard()
    const tree = withTreeValue(treeOf(card), '2.6', [{ id: 'id_1', '2.6.1': null, '2.6.2': '轻' }])
    const error = await expectSaveReject(card, tree, '1..1 写 null')
    expect(textOf(error), '报文要点名 2.6.1 或 2.6').toMatch(/2\.6(\.1)?/)
  })
})

describe('引用值 · 多引用（max > 1，§4.2）', () => {
  it('正控：两条 id（含逆序）都合法；顺序就是写进来的顺序', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const tree = treeOf(card)
    const forward = applyWrite({
      card,
      node: nodeOf(card, 'check'),
      tree,
      path: '3.2',
      value: ['id_1', 'id_2'],
    })
    expect(forward['3.2']).toEqual(['id_1', 'id_2'])
    const reversed = applyWrite({
      card,
      node: nodeOf(card, 'check'),
      tree,
      path: '3.2',
      value: ['id_2', 'id_1'],
    })
    expect(reversed['3.2'], '顺序保留：不排序、不去重').toEqual(['id_2', 'id_1'])
    expect(
      applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '3.2', value: ['id_1', 'id_2', 'id_3'] })[
        '3.2'
      ],
    ).toHaveLength(3)
  })

  it('零条统一是 null：[] 非法；min > 0 时 null 也非法', async () => {
    const card = refCard()
    await expectBothReject(card, '3.2', [], '多引用零条写成 []')
    await expectSaveReject(card, withTreeValue(treeOf(card), '3.2', null), 'min = 2 时 null')
    await expectWriteReject(card, '3.2', null, 'min = 2 时 null')
  })

  it('min = 0 的多引用：null 合法（零条就是 null）', async () => {
    const { validateSave } = await loadSchema()
    const card = patchElement(refCard(), '3.2', { min: 0 })
    expect(() =>
      validateSave(saveOf(card, { tree: withTreeValue(treeOf(card), '3.2', null) }), card),
    ).not.toThrow()
    await expectSaveReject(card, withTreeValue(treeOf(card), '3.2', []), 'min = 0 也不许用 [] 表示零条')
  })

  it('数量：低于 min / 高于 max ⇒ 两条尺都拒，报文点名数量或元素', async () => {
    const card = refCard()
    const { saveError, writeError } = await expectBothReject(card, '3.2', ['id_1'], 'min = 2 只写 1 个')
    // 报文要点名数量（两条尺各一条：卡校验 / 写入）
    expect(`${textOf(saveError)} ${textOf(writeError)}`, '要有一个报文点名当前数量').toMatch(/1|2/)
    const tight = patchElement(refCard(), '3.2', { min: 1, max: 2 })
    const { writeError: tightError } = await expectBothReject(
      tight,
      '3.2',
      ['id_1', 'id_2', 'id_3'],
      'max = 2 写 3 个',
    )
    expect(textOf(tightError), '超 max 的报文要点名数量或元素').toMatch(/3|2\.5|3\.2/)
  })

  it('重复 id / 单值 / 非数组 ⇒ 都被拒（有序、不重复）', async () => {
    const card = refCard()
    await expectBothReject(card, '3.2', ['id_1', 'id_1'], '重复 id')
    await expectBothReject(card, '3.2', 'id_1', '多引用收到单个 id')
    await expectBothReject(card, '3.2', { 0: 'id_1' }, '多引用收到对象')
    await expectBothReject(card, '3.2', [1, 2], '多引用收到数字数组')
  })

  it('形状由 max 决定：max = 1 只收 id|null，max > 1 只收 id[]|null', async () => {
    const single = patchElement(refCard(), '3.2', { min: 0, max: 1 })
    const multi = patchElement(refCard(), '3.2', { min: 0, max: 4 })
    await expectWriteReject(single, '3.2', ['id_1', 'id_2'], 'max = 1 收到数组')
    await expectWriteReject(multi, '3.2', 'id_1', 'max > 1 收到单 id')
    const { applyWrite } = await loadEngine()
    expect(
      applyWrite({
        card: single,
        node: nodeOf(single, 'check'),
        tree: treeOf(single),
        path: '3.2',
        value: 'id_1',
      })['3.2'],
    ).toBe('id_1')
  })
})

describe('引用值 · 筛选条件（§8.1 / §8.2 · 验收 16 / 17）', () => {
  it('写一条不满足筛选的 item ⇒ E_VALIDATION，报文点名过滤条件（银币「可手持 = 否」）', async () => {
    const card = refCard()
    const error = await expectWriteReject(card, '2.5', 'id_3', '写银币')
    expect(textOf(error), '要点名元素 2.5').toContain('2.5')
    expect(textOf(error), '要点名源数组 2.4 或筛选字段 2.4.3').toMatch(/2\.4(\.3)?/)
  })

  it('满足筛选的 id 正常写；筛选不改源 item（写失败后 2.4 的值一个字不变）', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const tree = treeOf(card)
    expect(applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '2.5', value: 'id_2' })['2.5']).toBe(
      'id_2',
    )
    const rejected = errorOf(() =>
      applyWrite({ card, node: nodeOf(card, 'check'), tree, path: '2.5', value: 'id_3' }),
    )
    expect(rejected, '银币不满足筛选 ⇒ 必须被拒').not.toBeNull()
    expect(tree['2.4'], '筛选只判候选，不改源 item').toEqual(treeOf(card)['2.4'])
  })

  it('卡 / 存档里已有的引用不满足筛选 ⇒ 保存被拦，并点名 2.5（验收 17）', async () => {
    const { cardIssues } = await loadState()
    const card = withInitialValue(
      patchElement(refCard(), '2.5', { refFilter: { field: '2.4.3', value: '是' } }),
      '2.5',
      'id_3',
    )
    const issues = cardIssues(card)
    expect(issues, '银币（可手持 = 否）当主手 ⇒ 卡不合法').not.toHaveLength(0)
    const known = new Set(
      cardIssues(refCard()).map((issue) => `${issue.code}|${issue.path}|${issue.message}`),
    )
    expect(
      issues.some(
        (issue) =>
          (issue.code === '2.5' || issue.path === '2.5') &&
          !known.has(`${issue.code}|${issue.path}|${issue.message}`),
      ),
      `要有一条**因为筛选**而指到 2.5 的问题（实际：${JSON.stringify(issues)}）`,
    ).toBe(true)
    await expectSaveReject(refCard(), withTreeValue(treeOf(refCard()), '2.5', 'id_3'), '存档里主手指银币')
  })

  it('多引用逐条判筛选：一条不满足就整笔拒', async () => {
    const { cardIssues } = await loadState()
    const filtered = patchElement(refCard(), '3.2', { refFilter: { field: '1.5.2', value: '游侠' } })
    expect(cardIssues(withInitialValue(filtered, '3.2', ['id_1', 'id_3'])), '正控：两个游侠合法').toEqual([])
    expect(
      cardIssues(withInitialValue(filtered, '3.2', ['id_1', 'id_2'])),
      '王族（id_2）不满足筛选 ⇒ 不合法',
    ).not.toHaveLength(0)
  })
})

describe('引用值 · 卡 / 存档 / 写三条路同一把尺（§8.1）', () => {
  it('saveTreeIssues 与 validateSave 报同一批坏值', async () => {
    const { saveTreeIssues } = await loadState()
    const card = refCard()
    const bad = [
      ['2.5', 'id_9'],
      ['2.5', []],
      ['3.2', ['id_1']],
      ['3.2', ['id_1', 'id_1']],
      ['3.2', []],
    ]
    for (const [path, value] of bad) {
      const tree = withTreeValue(treeOf(card), path, value)
      const issues = saveTreeIssues(card, tree)
      expect(issues.length, `${path} = ${JSON.stringify(value)} 应当有问题`).toBeGreaterThan(0)
      expect(
        issues.some((issue) => issue.code === path || issue.path === path),
        `${path} 的问题要指到自己那一格`,
      ).toBe(true)
      await expectSaveReject(card, tree, `${path} = ${JSON.stringify(value)}`)
    }
  })

  it('合法的树一条问题都没有（正控，含 null 与多引用）', async () => {
    const { saveTreeIssues } = await loadState()
    const card = refCard()
    expect(saveTreeIssues(card, treeOf(card))).toEqual([])
    expect(saveTreeIssues(card, withTreeValue(treeOf(card), '2.5', null))).toEqual([])
  })

  it('失败的写入一个字都不改 tree（两个引用路径各一条）', async () => {
    const { applyWrite } = await loadEngine()
    const card = refCard()
    const tree = treeOf(card)
    for (const [path, value] of [
      ['2.5', 'id_9'],
      ['2.5', 'id_3'],
      ['3.2', ['id_1']],
      ['3.2', ['id_1', 'id_1']],
    ]) {
      const error = errorOf(() => applyWrite({ card, node: nodeOf(card, 'check'), tree, path, value }))
      expect(error, `${path} = ${JSON.stringify(value)} 必须被拒`).not.toBeNull()
      expect(tree[path], `${path} = ${JSON.stringify(value)} 失败后 tree 不动`).toEqual(treeOf(card)[path])
    }
  })
})

describe('引用值 · 第五种位置（有孩子的标量字段下的 ref）的写入校验', () => {
  it('写一个不在源数组里的 id ⇒ E_VALIDATION，tree 不动', async () => {
    const { applyWrite } = await loadEngine()
    const { scalarChildRefCard } = await import('./support/ref-fixtures.js')
    const card = scalarChildRefCard()
    const node = nodeOf(card, 'check')
    const writable = { ...node, writable: ['2.4.1.1'] }
    const tree = treeOf(card)
    const error = errorOf(() =>
      applyWrite({ card, node: writable, tree, path: '2.4.1.1', value: ['id_9', 'id_1', null] }),
    )
    expect(error, '不存在的 id 必须被拒').not.toBeNull()
    expect(error.code).toBe('E_VALIDATION')
    expect(tree['2.4'][0]['2.4.1']['2.4.1.1'], '失败的写不许改 tree').toBe('id_1')
  })
})
