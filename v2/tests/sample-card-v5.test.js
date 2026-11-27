/**
 * 阶段 2.1 · 晨风镇样例（v5 契约 §7 / 验收 §9-9）。
 *
 * 样例是**产品资产**（`v2/src/data/sample-card.json`），玩家第一次打开看到的就是它。
 * 这一份钉的是 v5 §7.1 那棵树与 §7.2 那份初始值：
 *
 * ```text
 * 0 时间（time）upper=day lower=minute
 * 1 世界（object）
 *   1.1 区域（enum：晨风镇/镇郊/地牢/官道/码头；自身值）
 *     1.1.1 地点（text）
 *   1.2 天气（enum）
 *   1.3 氛围（text）
 * 2 玩家（object）
 *   2.1 名字 / 2.2 体力（integer 0..100，步长 1..10）/ 2.3 状态（enum）/ 2.4 携带（text）
 * ```
 *
 * `1.1` 是**同时有自身值和子节点**的那个形状（自身值在数据里是 `1.1.0`，不单独出行）；
 * 人物（字典）与线索不在 2.1 里。
 *
 * 资产是产品的一部分：这里的树与初始值必须和它逐字对得上。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModule } from './support/load.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))

function sampleCard() {
  return JSON.parse(readFileSync(join(SRC, 'data', 'sample-card.json'), 'utf8'))
}

function elementOf(card, code) {
  return card.state.find((item) => item.code === code)
}

const CODES = ['0', '1', '1.1', '1.1.1', '1.2', '1.3', '2', '2.1', '2.2', '2.3', '2.4']

describe('晨风镇 v5 · 资产形状', () => {
  it('过得了 validateCard（不合法的样例不许被种进玩家存储）', async () => {
    const { validateCard } = await loadSchema()
    const card = sampleCard()
    expect(card.name).toMatch(/[\u4e00-\u9fff]/)
    expect(() => validateCard(card)).not.toThrow()
  })

  it('树就是那一棵：时间 / 世界 / 玩家，四种用户可选类型都出场', async () => {
    const card = sampleCard()
    expect(card.state.map((item) => item.code).sort()).toEqual([...CODES].sort())
    expect(elementOf(card, '0')).toMatchObject({
      type: 'time',
      timeMode: 'year-minute',
      holidays: { international: false, china: false, traditional: false },
      initial: { year: 1024, month: 9, day: 17, hour: 18, minute: 30 },
    })
    // 世界 / 玩家是「text + 空自身值 + 子节点」——根 initial 是整棵子树的扁平表（2.2）
    expect(elementOf(card, '1')).toMatchObject({ type: 'text' })
    expect(elementOf(card, '2')).toMatchObject({ type: 'text' })
    expect(elementOf(card, '1').initial['1.0']).toBe('')
    expect(elementOf(card, '2').initial['2.0']).toBe('')
    // 子元素身上没有 initial：值住在所属根的 initial 里
    expect(elementOf(card, '1.2')).toMatchObject({ type: 'enum', values: ['晴', '阴', '雨', '雪', '雾'] })
    expect(elementOf(card, '1').initial['1.2']).toBe('雨')
    expect(elementOf(card, '1.3')).toMatchObject({ type: 'text' })
    expect(elementOf(card, '2.1')).toMatchObject({ type: 'text' })
    expect(elementOf(card, '2').initial['2.1']).toBe('旅人')
    expect(elementOf(card, '2.2')).toMatchObject({
      type: 'integer',
      min: 0,
      max: 100,
      stepMin: 1,
      stepMax: 10,
    })
    expect(elementOf(card, '2').initial['2.2']).toBe(80)
    expect(elementOf(card, '2.3')).toMatchObject({
      type: 'enum',
      values: ['正常', '受伤', '疲惫', '中毒'],
    })
    expect(elementOf(card, '2').initial['2.3']).toBe('正常')
    expect(elementOf(card, '2.4')).toMatchObject({ type: 'text' })
  })

  it('1.1 是「区域」（enum，自身值） + 1.1.1「地点」（text）', async () => {
    const card = sampleCard()
    expect(elementOf(card, '1.1')).toMatchObject({
      type: 'enum',
      values: ['晨风镇', '镇郊', '地牢', '官道', '码头'],
    })
    expect(elementOf(card, '1.1')).not.toHaveProperty('initial')
    expect(elementOf(card, '1').initial['1.1.0']).toBe('晨风镇')
    expect(elementOf(card, '1.1.1')).toMatchObject({ type: 'text' })
    expect(elementOf(card, '1').initial['1.1.1']).toBe('醉猫旅店 · 一楼')
  })

  it('人物与线索不在 2.1 里（字典/线索整块推迟）', async () => {
    const card = sampleCard()
    const names = card.state.map((item) => item.name)
    expect(names).not.toEqual(expect.arrayContaining(['人物', '线索']))
    // 也不许换个 code 偷偷留着：元素个数与 v5 §7.1 一致
    expect(card.state).toHaveLength(CODES.length)
  })

  it('链仍是那三个固定节点（时间 / 判定 / 输出）', async () => {
    const card = sampleCard()
    expect(card.chain.map((node) => node.id)).toEqual(['time', 'check', 'output'])
    expect(card.chain.find((node) => node.id === 'output').readsUpstream).toEqual(['check'])
  })
})

describe('晨风镇 v5 · 初始值展开（§7.2）', () => {
  it('initialTreeOf 逐字等于 §7.2 那张扁平表', async () => {
    const { initialTreeOf } = await loadState()
    expect(initialTreeOf(sampleCard())).toEqual({
      0: { year: 1024, month: 9, day: 17, hour: 18, minute: 30 },
      '1.0': '',
      '1.1.0': '晨风镇',
      '1.1.1': '醉猫旅店 · 一楼',
      1.2: '雨',
      1.3: '炉火噼啪，麦酒和湿羊毛的味道',
      '2.0': '',
      2.1: '旅人',
      2.2: 80,
      2.3: '正常',
      2.4: '短剑、斗篷、三枚银币',
    })
  })

  it('世界 / 玩家在初始值里是 1.0 / 2.0 空串，没有 1 / 2 键', async () => {
    const { initialTreeOf } = await loadState()
    const tree = initialTreeOf(sampleCard())
    expect(tree['1.0']).toBe('')
    expect(tree['2.0']).toBe('')
    expect('1' in tree).toBe(false)
    expect('2' in tree).toBe(false)
  })
})
