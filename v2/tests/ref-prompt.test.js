/**
 * 阶段 4 · 引用在提示词里的样子（引用契约 §七 · 验收 4 / 13 / 21）。
 *
 * 这一份钉的是模型**读到**什么、**允许写**什么：
 *   · 单引用非空 ⇒ 投影对象 `{ 物品: "短剑" }`；空 ⇒ `null`（不发明「空手 / 未持有」这类业务词）；
 *   · 多引用非空 ⇒ 投影数组、顺序保留；空 ⇒ `null`；
 *   · 数组 item 内的引用字段读取时递归解析（`2.6` 里的 `来源` 变成 `{ 名称, 描述 }`）；
 *   · 数组 item 在模型提示词里**带 id**（契约 §二 2026-11-28 口径：玩家 / 编辑器看不到，模型看得到）；
 *     引用自己的值仍是投影，不打印指针；投影字段是只读视图（写不进去）；
 *   · 可写段说清：引用自哪个数组、筛选条件、最多几个（多引用还有「不能重复」）。
 */
import { describe, expect, it } from 'vitest'
import {
  itemRefChildCard,
  leafItemRefCard,
  refChildRefCard,
  scalarChildRefCard,
  lineOf,
  nestedArrayRefCard,
  objectFieldRefCard,
  nodeOf,
  patchElement,
  patchNode,
  payloadOf,
  refCard,
  saveOf,
  stateLines,
  writableLines,
  withInitialValue,
} from './support/ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 拼一个节点的提示词（存档树取卡的初始值） */
function promptOf(card, nodeId) {
  return loadPrompt().then(({ buildPrompt }) =>
    buildPrompt({ card, save: saveOf(card), node: nodeOf(card, nodeId), action: 'ACT', outputs: {} }),
  )
}

/** 状态段里某个 code 那一行的 payload（从一份已拼好的提示词里取） */
function payloadIn(prompt, code) {
  const lines = stateLines(prompt)
  const line = lineOf(lines, code)
  expect(line, `状态段里应当有 ${code} 那一行（实际：${JSON.stringify(lines)}）`).toBeTruthy()
  return payloadOf(line)
}

/** 状态段里某个 code 那一行的 payload */
async function statePayload(card, code, nodeId = 'check') {
  return payloadIn(await promptOf(card, nodeId), code)
}

/** 可写段里某个 code 那一行 */
async function writableLine(card, code, nodeId = 'check') {
  const lines = writableLines(await promptOf(card, nodeId))
  const line = lineOf(lines, code)
  expect(line, `可写段里应当有 ${code} 那一行（实际：${JSON.stringify(lines)}）`).toBeTruthy()
  return line
}

describe('提示词 · 读取（§7.1）', () => {
  it('单引用非空 ⇒ 投影对象（键是投影字段的中文名，不投影没勾的字段）', async () => {
    expect(JSON.parse(await statePayload(refCard(), '2.5'))).toEqual({ ['物品']: '短剑' })
  })

  it('单引用空 ⇒ null（不是 [] / {} / 业务词）', async () => {
    const card = withInitialValue(refCard(), '2.5', null)
    const payload = await statePayload(card, '2.5')
    expect(payload).toBe('null')
    for (const word of ['空手', '未持有', '无'])
      expect(payload, `不许出现业务词「${word}」`).not.toContain(word)
  })

  it('多引用非空 ⇒ 投影数组，顺序就是值里的顺序', async () => {
    expect(JSON.parse(await statePayload(refCard(), '3.2'))).toEqual([
      { ['角色名']: '艾琳' },
      { ['角色名']: '阿拉贡' },
    ])
    const reversed = withInitialValue(refCard(), '3.2', ['id_3', 'id_1'])
    expect(JSON.parse(await statePayload(reversed, '3.2'))).toEqual([
      { ['角色名']: '莱戈拉' },
      { ['角色名']: '艾琳' },
    ])
  })

  it('多引用空 ⇒ null', async () => {
    const card = withInitialValue(patchElement(refCard(), '3.2', { min: 0 }), '3.2', null)
    expect(await statePayload(card, '3.2')).toBe('null')
  })

  it('数组 item 内的引用字段递归解析成投影对象（验收 21）', async () => {
    const payload = payloadIn(await promptOf(refCard(), 'check'), '2.6')
    expect(JSON.parse(payload)).toEqual([
      { id: 'id_1', ['来源']: { ['名称']: '微醺', ['描述']: '脚步有点飘' }, ['严重程度']: '轻' },
      { id: 'id_2', ['来源']: { ['名称']: '潮湿', ['描述']: '衣服贴在身上' }, ['严重程度']: '中' },
    ])
    for (const item of JSON.parse(payload)) {
      expect(typeof item.来源, '来源必须是投影对象，不是裸 id').toBe('object')
    }
  })

  it('id 进提示词：数组行每项带 id，引用值仍是投影（验收 1 / 26）', async () => {
    const prompt = await promptOf(refCard(), 'output')
    const bag = JSON.parse(payloadIn(prompt, '2.4'))
    expect(bag.map((item) => item.id)).toEqual(['id_1', 'id_2', 'id_3'])
    expect(prompt, '整份提示词里能看见 id').toContain('"id_1"')
    const mainHand = JSON.parse(payloadIn(prompt, '2.5'))
    expect(mainHand).toEqual({ ['物品']: '短剑' })
    expect(mainHand.id, '引用自己不投影 id').toBeUndefined()
  })

  it('改源 item 的显示字段 ⇒ 引用读取自动看到新值（验收 12）', async () => {
    const items = JSON.parse(JSON.stringify(saveOf(refCard()).tree['2.4']))
    items[0]['2.4.1'] = '长剑'
    const card = withInitialValue(refCard(), '2.4', items)
    expect(JSON.parse(await statePayload(card, '2.5'))).toEqual({ ['物品']: '长剑' })
  })

  it('读眼睛：没读 2.5 就一个字都不出现', async () => {
    const card = patchNode(refCard(), 'output', { reads: ['1.1', '2.1'] })
    const prompt = await promptOf(card, 'output')
    expect(prompt).not.toContain('2.5')
    expect(prompt).not.toContain('主手')
  })
})

describe('提示词 · 可写说明（§7.2）', () => {
  it('单引用带筛选：说清引用自哪个数组、筛选字段与值、最多几个、可写 null', async () => {
    const line = await writableLine(refCard(), '2.5')
    expect(line, '要说清这是引用').toContain('引用')
    expect(line, '要点名源数组 2.4').toContain('2.4')
    expect(line, '要点名筛选字段与值').toContain('2.4.3')
    expect(line).toContain('是')
    expect(line, '要说清最多几条').toContain('最多 1 个')
    expect(line, 'min = 0 时可写 null 清空').toContain('null')
  })

  it('多引用：说清是 id 列表、数量区间、不能重复、可写 null', async () => {
    const line = await writableLine(refCard(), '3.2')
    expect(line).toContain('引用')
    expect(line, '要点名源数组 1.5').toContain('1.5')
    expect(line, '要说清是列表').toContain('列表')
    expect(line, `要说清数量区间：${line}`).toMatch(/(0 到 4 个|2 到 4 个)/)
    expect(line, '多引用不能重复').toContain('不能重复')
    // 这一条 3.2 是 2..4（min > 0）⇒ 没有 null 提示；min = 0 的 null 提示在下面那两条里钉
    expect(line, 'min > 0 的多引用不许出现可空提示').not.toContain('可写 null 清空')
  })

  it('可空单引用（min = 0）：可写行带**真正的** null 提示，且没有未替换的 {nullHint} 占位（复审缺口 c）', async () => {
    const line = await writableLine(refCard(), '2.5')
    expect(line, 'min = 0 ⇒ 要出现真正的 null 提示').toContain('可写 null 清空')
    expect(line, '不许把占位符原样吐出来').not.toContain('{nullHint}')
    expect(line, '也不许留下半截占位名').not.toContain('nullHint')
  })

  it('必选单引用（min = 1）：可写行**没有** null 提示，也没有 {nullHint} 占位（复审缺口 c）', async () => {
    const required = patchElement(refCard(), '2.5', { min: 1 })
    const line = await writableLine(required, '2.5')
    expect(line, 'min = 1 ⇒ 不许出现可空提示').not.toContain('可写 null 清空')
    expect(line, '不许把占位符原样吐出来').not.toContain('{nullHint}')
    expect(line, '也不许留下半截占位名').not.toContain('nullHint')
  })

  it('多引用的 null 提示同样按 min 决定：0..4 带、1..4 不带（复审缺口 c）', async () => {
    const optional = patchElement(refCard(), '3.2', { min: 0 })
    const optionalLine = await writableLine(optional, '3.2')
    expect(optionalLine, 'min = 0 的多引用要带 null 提示').toContain('可写 null 清空')
    expect(optionalLine).not.toContain('{nullHint}')

    const required = patchElement(refCard(), '3.2', { min: 1 })
    const requiredLine = await writableLine(required, '3.2')
    expect(requiredLine, 'min = 1 的多引用不带 null 提示').not.toContain('可写 null 清空')
    expect(requiredLine).not.toContain('nullHint')
  })
  it('投影字段是只读视图：可写段不出现投影字段的写行', async () => {
    const card = patchNode(refCard(), 'check', { writable: ['2.5'] })
    const lines = writableLines(await promptOf(card, 'check'))
    expect(lines.some((line) => line.startsWith('- 2.5「'))).toBe(true)
    expect(
      lines.some((line) => line.startsWith('- 2.4.1「') || line.startsWith('- 2.4.2「')),
      '投影字段不许有自己的写约束行',
    ).toBe(false)
    expect(
      lines.some((line) => line.startsWith('- 2.4「')),
      '没开 2.4 的写权限就不许列整表行',
    ).toBe(false)
  })

  it('投影字段写不进去：2.5 下面没有投影出来的值路径（写它 ⇒ E_CHAIN）', async () => {
    const { pathsOf } = await loadState()
    expect(pathsOf(refCard().state, '2.5.2.4.1')).toEqual([])
    const card = patchNode(refCard(), 'check', { writable: ['2.5'] })
    const { applyWrite } = await loadModule('core/engine.ts', () => import('../src/core/engine.ts'))
    const error = errorOf(() =>
      applyWrite({
        card,
        node: nodeOf(card, 'check'),
        tree: saveOf(card).tree,
        path: '2.5.2.4.1',
        value: '长剑',
      }),
    )
    expect(error, '投影字段不是可写路径').not.toBeNull()
    expect(error.code, '路径不存在是链的错').toBe('E_CHAIN')
  })
})

describe('提示词 · 任何标量位置的引用都要投影（2026-11-28 重开）', () => {
  it('嵌套数组 item 里的引用：投影成对象，不打印裸指针', async () => {
    const card = nestedArrayRefCard()
    const bag = JSON.parse(payloadIn(await promptOf(card, 'check'), '2.4'))
    const inner = bag[0]['内袋']
    expect(Array.isArray(inner), '内袋是数组').toBe(true)
    expect(inner[0]['内袋来源'], '内袋来源要投影成对象（键是投影字段的中文名）').toEqual({ 名称: '微醺' })
    expect(typeof inner[0]['内袋来源'], '引用位是投影对象，不是裸 id').toBe('object')
  })

  it('数组 item 的对象字段里的引用：同样是投影对象', async () => {
    const card = objectFieldRefCard()
    const bag = JSON.parse(payloadIn(await promptOf(card, 'check'), '2.4'))
    expect(bag[0]['属性'], '对象字段里的引用要投影成对象').toEqual({ 属性来源: { 名称: '微醺' } })
    expect(JSON.stringify(bag[0]['属性']), '不许出现裸指针').not.toContain('"id_1"')
  })

  it('item 级引用带子元素：投影对象 + 关系子元素都在，不打印裸指针', async () => {
    const card = itemRefChildCard()
    const payload = payloadIn(await promptOf(card, 'check'), '2.6')
    expect(payload, '投影字段要在').toContain('微醺')
    expect(payload, '关系子元素（握法）也要在').toContain('单手')
    // item 自己的 id 是合法的提示词内容（§7.1）；这里只禁「引用位被吐成裸指针」
    const buffs = JSON.parse(payload)
    expect(
      buffs.map((item) => item.id),
      '数组 item 的隐藏 id 照常出现（不是裸指针）',
    ).toEqual(['id_1', 'id_2'])
    for (const item of buffs) {
      expect(typeof item.来源, '引用位是投影对象').toBe('object')
      expect(item.来源, '引用位里不许出现指针字段或裸 id 字符串').not.toHaveProperty('2.6.1.0')
    }
  })
})

describe('提示词 · 第五种位置（有孩子的标量字段下的 ref）', () => {
  it('2.4 的 item 里 物品.来源 要投影成对象，不打印裸指针', async () => {
    const card = scalarChildRefCard()
    const bag = JSON.parse(payloadIn(await promptOf(card, 'check'), '2.4'))
    expect(bag[0]['物品'], '有孩子的标量字段仍是「自身 + 孩子」的对象').toEqual({
      ['自身']: '短剑',
      ['来源']: { 名称: '微醺' },
    })
    expect(typeof bag[0]['物品']['来源'], '引用位是投影对象，不是裸指针').toBe('object')
  })
})

describe('提示词 · ref 的孩子也是 ref（item 深度）要递归投影', () => {
  it('2.6 的 item 里 来源.增益来源 投影成对象，不打印裸指针', async () => {
    const card = refChildRefCard()
    const payload = payloadIn(await promptOf(card, 'check'), '2.6')
    const buffs = JSON.parse(payload)
    const source = buffs[0]['来源']
    expect(source, '外层的引用投影在').toMatchObject({ 名称: '微醺' })
    expect(source['增益来源'], '孩子 ref 也要投影成对象').toEqual({ 角色名: '阿拉贡' })
    expect(typeof source['增益来源'], '孩子的引用位不是裸指针').toBe('object')
  })
})

describe('提示词 · 带孩子的引用，可写形状是「自身值 + 孩子」的对象', () => {
  it('2.6.1 的可写行点名 2.6.1.0 / 2.6.1.1，不说「item id」', async () => {
    const card = patchNode(refChildRefCard(), 'check', { writable: ['2.6.1'] })
    const lines = writableLines(await promptOf(card, 'check'))
    const line = lines.find((text) => text.startsWith('- 2.6.1「来源」'))
    expect(line, `可写段里应当有 2.6.1 那一行（实际：${JSON.stringify(lines)}）`).toBeTruthy()
    expect(line, '要写明自身值那一格 2.6.1.0').toContain('2.6.1.0')
    expect(line, '要写明关系子元素 2.6.1.1').toContain('2.6.1.1')
    expect(line, '不是一列裸 item id').not.toContain('item id')
  })
})

describe('提示词 · 派生写权限在可写段的显示（与引擎同一口径）', () => {
  it('写源数组 1.4 ⇒ 叶子 item 级引用 2.6.3 的可写行要派生出来', async () => {
    const card = patchNode(leafItemRefCard(), 'check', { writable: ['1.4'] })
    const lines = writableLines(await promptOf(card, 'check'))
    expect(
      lines.some((line) => line.startsWith('- 2.6.3「来源三」')),
      `叶子引用的派生行要在（实际：${JSON.stringify(lines)}）`,
    ).toBe(true)
  })

  it('带孩子的 item 级引用 2.6.1 ⇒ 写源数组 1.4 **不**该派生可写行', async () => {
    const card = patchNode(refChildRefCard(), 'check', { writable: ['1.4'] })
    const lines = writableLines(await promptOf(card, 'check'))
    expect(
      lines.some((line) => line.startsWith('- 2.6.1「来源」')),
      `带孩子的引用不派生：整格写会连孩子一起换（实际：${JSON.stringify(lines)}）`,
    ).toBe(false)
  })
})
