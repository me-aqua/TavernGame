/**
 * 阶段 3 · 扩充：数组字段的**真读权限**（契约增补 `契约-阶段3-数组-字段权限-增补.md`）。
 *
 * 这一份钉的是「字段引用不是第二套寻址，但也不是摆设」的读半边：
 *   · `reads` / `writable` 里 `2.4.1` 合法（含 object 嵌套 / 数组嵌套），`2.4.0` 与悬空仍拒；
 *   · 工具由权限引用派生：只有字段写权限也发 `write_state`；
 *   · 读字段 ⇒ 仍并进容器一行，**只投影选中的字段**、中文键、item 顺序、嵌套结构保留；
 *   · 可写段：字段一条自己的行、容器一条整表行，两条同时开时都在。
 *
 * 整列写 / 长度 / 类型 / 嵌套写形状在 `array-field-write.test.js`；共用夹具在 `support/field-ref-fixtures.js`。
 * 读法：每条用例都连着契约增补的一节；增补没写的东西不断言。
 */
import { describe, expect, it } from 'vitest'
import { holdCard, holdSave, nestedCard } from './support/array-fixtures.js'
import { cardWithRefs, withArrayValue, twoOuterNestedCard } from './support/field-ref-fixtures.js'
import { loadModule } from './support/load.js'

const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))

const CJK = /[\u4e00-\u9fff]/
const STATE_MARKER = '<世界状态树>'
const WRITABLE_MARKER = '<可写状态>'

/** 抓一个同步调用抛出的错误（没抛就是 null） */
function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 拼提示词（存档树取卡的初始值） */
async function promptOf(card, node) {
  const { buildPrompt } = await loadPrompt()
  return buildPrompt({ card, save: holdSave(card), node, action: 'act one', outputs: {} })
}

/** 某个块（`\n\n` 分隔，块以标记开头） */
function blockOf(prompt, marker) {
  return prompt.split('\n\n').find((block) => block.startsWith(marker))
}

/** 状态段里的非空行 */
function stateLines(prompt) {
  const block = blockOf(prompt, STATE_MARKER)
  if (block === undefined) return null
  return block
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
}

/** 可写段里的非空行 */
function writableLines(prompt) {
  const block = blockOf(prompt, WRITABLE_MARKER)
  if (block === undefined) return null
  return block
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** 一行的 `：` 后面那一格（JSON / 约束） */
function payloadOf(line) {
  const at = line.indexOf('：')
  expect(at, `行里缺少全角冒号：${line}`).toBeGreaterThan(0)
  return line.slice(at + 1)
}

/** 状态段里以 `- <code>「<name>」：` 开头的那一行（找不到就红，报出实际行） */
function lineOf(lines, code, name) {
  const prefix = `- ${code}「${name}」：`
  const line = lines.find((item) => item.startsWith(prefix))
  expect(line, `缺少 ${prefix} 这一行（实际：${JSON.stringify(lines)}）`).toBeTruthy()
  return line
}

describe('数组字段 · 引用与校验（增补 §一 / §二）', () => {
  it('reads / writable 里的字段引用合法：直接字段、object 嵌套、array 嵌套都收', async () => {
    const { validateCard } = await loadSchema()
    const { cardIssues } = await loadState()
    const cases = [
      [holdCard(), '2.4.1'],
      [holdCard(), '2.4.2'],
      [nestedCard(), '2.4.2.1'],
      [nestedCard(), '2.4.2.2'],
      [nestedCard(), '2.4.2.2.1'],
    ]
    for (const [card, ref] of cases) {
      const reads = cardWithRefs(card, { reads: [ref] })
      expect(() => validateCard(reads), `reads 里的 ${ref} 应当合法`).not.toThrow()
      const writable = cardWithRefs(card, { writable: [ref] })
      expect(() => validateCard(writable), `writable 里的 ${ref} 应当合法`).not.toThrow()
      expect(cardIssues(reads), `${ref} 不该产生问题`).toEqual([])
    }
  })

  it('2.4.0 / 不存在的字段 / 字段的 .0 仍是 E_VALIDATION + 中文', async () => {
    const { validateCard } = await loadSchema()
    for (const field of ['reads', 'writable']) {
      for (const ref of ['2.4.0', '2.4.9', '2.4.1.0']) {
        const card = cardWithRefs(holdCard(), { [field]: [ref] })
        const error = errorOf(() => validateCard(card))
        expect(error, `${field} 里的 ${ref} 应当被拒`).not.toBeNull()
        expect(error.code, `${ref} 不是引用`).toBe('E_VALIDATION')
        expect(error.message).toMatch(CJK)
      }
    }
  })

  it('工具由权限引用派生：只有字段写权限也发 write_state（不派生 advance_time）', async () => {
    const { toolsForNode } = await loadSchema()
    for (const [card, ref] of [
      [holdCard(), '2.4.1'],
      [nestedCard(), '2.4.2.1'],
      [nestedCard(), '2.4.2.2.1'],
    ]) {
      const withField = cardWithRefs(card, { writable: [ref] })
      expect(
        toolsForNode(
          withField,
          withField.chain.find((node) => node.id === 'check'),
        ),
      ).toEqual(['write_state'])
    }
  })
})

describe('数组字段 · reads 投影（增补 §三）', () => {
  it('只读 2.4.1 ⇒ 一行、只带物品、中文键、item 顺序，不出现数量与字段 code', async () => {
    const card = cardWithRefs(holdCard(), { reads: ['2.4.1'] })
    const prompt = await promptOf(
      card,
      card.chain.find((node) => node.id === 'check'),
    )
    const lines = stateLines(prompt)
    expect(lines, '读了字段，状态块必须在').not.toBeNull()
    expect(lines, '一个数组只出一行').toHaveLength(1)

    const line = lineOf(lines, '2.4', '背包')
    expect(JSON.parse(payloadOf(line))).toEqual([
      { id: 'id_1', ['物品']: '短剑' },
      { id: 'id_2', ['物品']: '斗篷' },
      { id: 'id_3', ['物品']: '银币' },
    ])
    expect(line, '没选的字段一个键都不出现').not.toContain('数量')
    expect(line, '不许出现字段 code').not.toContain('2.4.1')
    expect(line, '不许出现自身值槽').not.toContain('2.4.0')
  })

  it('读两个字段 ⇒ 一行里两列都在，等于容器全投影', async () => {
    const card = cardWithRefs(holdCard(), { reads: ['2.4.1', '2.4.2'] })
    const line = lineOf(
      stateLines(
        await promptOf(
          card,
          card.chain.find((node) => node.id === 'check'),
        ),
      ),
      '2.4',
      '背包',
    )
    expect(JSON.parse(payloadOf(line))).toEqual([
      { id: 'id_1', ['物品']: '短剑', ['数量']: 1 },
      { id: 'id_2', ['物品']: '斗篷', ['数量']: 1 },
      { id: 'id_3', ['物品']: '银币', ['数量']: 3 },
    ])
  })

  it('读 object 字段里的嵌套字段 2.4.2.1 ⇒ 祖先对象出现，只带品质', async () => {
    const card = cardWithRefs(nestedCard(), { reads: ['2.4.2.1'] })
    const line = lineOf(
      stateLines(
        await promptOf(
          card,
          card.chain.find((node) => node.id === 'check'),
        ),
      ),
      '2.4',
      '背包',
    )
    expect(JSON.parse(payloadOf(line))).toEqual([{ id: 'id_1', ['属性']: { ['品质']: '普通' } }])
    expect(line).not.toContain('物品')
    expect(line).not.toContain('附魔')
  })

  it('读嵌套数组字段里的 2.4.2.2.1 ⇒ 层层保留，只带名称', async () => {
    const card = cardWithRefs(nestedCard(), { reads: ['2.4.2.2.1'] })
    const line = lineOf(
      stateLines(
        await promptOf(
          card,
          card.chain.find((node) => node.id === 'check'),
        ),
      ),
      '2.4',
      '背包',
    )
    expect(JSON.parse(payloadOf(line))).toEqual([
      { id: 'id_1', ['属性']: { ['附魔']: [{ id: 'id_1', ['名称']: '锋锐' }] } },
    ])
    expect(line).not.toContain('强度')
  })

  it('读整个嵌套数组字段 2.4.2.2 ⇒ 它自己的两个字段都在', async () => {
    const card = cardWithRefs(nestedCard(), { reads: ['2.4.2.2'] })
    const line = lineOf(
      stateLines(
        await promptOf(
          card,
          card.chain.find((node) => node.id === 'check'),
        ),
      ),
      '2.4',
      '背包',
    )
    expect(JSON.parse(payloadOf(line))).toEqual([
      { id: 'id_1', ['属性']: { ['附魔']: [{ id: 'id_1', ['名称']: '锋锐', ['强度']: 2 }] } },
    ])
  })

  it('外层 2 项、内层 1 / 2 项：item 顺序与嵌套分组都保留', async () => {
    const card = cardWithRefs(twoOuterNestedCard(), { reads: ['2.4.2.2.1'] })
    const line = lineOf(
      stateLines(
        await promptOf(
          card,
          card.chain.find((node) => node.id === 'check'),
        ),
      ),
      '2.4',
      '背包',
    )
    expect(JSON.parse(payloadOf(line))).toEqual([
      { id: 'id_1', ['属性']: { ['附魔']: [{ id: 'id_1', ['名称']: '锋锐' }] } },
      {
        id: 'id_2',
        ['属性']: {
          ['附魔']: [
            { id: 'id_1', ['名称']: '微光' },
            { id: 'id_2', ['名称']: '回响' },
          ],
        },
      },
    ])
  })

  it('容器 + 字段同时读 ⇒ 容器赢：一行、全字段（不重复出字段行）', async () => {
    const card = cardWithRefs(holdCard(), { reads: ['2.4', '2.4.1'] })
    const lines = stateLines(
      await promptOf(
        card,
        card.chain.find((node) => node.id === 'check'),
      ),
    )
    expect(lines).toHaveLength(1)
    expect(JSON.parse(payloadOf(lineOf(lines, '2.4', '背包')))).toEqual([
      { id: 'id_1', ['物品']: '短剑', ['数量']: 1 },
      { id: 'id_2', ['物品']: '斗篷', ['数量']: 1 },
      { id: 'id_3', ['物品']: '银币', ['数量']: 3 },
    ])
  })

  it('空数组 + 字段引用 ⇒ 一行 []（不是空段）', async () => {
    const card = cardWithRefs(withArrayValue(holdCard(), []), { reads: ['2.4.1'] })
    const lines = stateLines(
      await promptOf(
        card,
        card.chain.find((node) => node.id === 'check'),
      ),
    )
    expect(lines).toHaveLength(1)
    expect(payloadOf(lineOf(lines, '2.4', '背包'))).toBe('[]')
  })

  it('父元素被读（2.4.1 + 2）⇒ 父那一行包住数组，不额外出字段行', async () => {
    const card = cardWithRefs(holdCard(), { reads: ['2', '2.4.1'] })
    const lines = stateLines(
      await promptOf(
        card,
        card.chain.find((node) => node.id === 'check'),
      ),
    )
    expect(lines, '父行之外不该再有数组行').toHaveLength(1)
    expect(lines[0].startsWith('- 2「玩家」：')).toBe(true)
    expect(JSON.parse(payloadOf(lines[0])).背包).toEqual([
      { id: 'id_1', ['物品']: '短剑', ['数量']: 1 },
      { id: 'id_2', ['物品']: '斗篷', ['数量']: 1 },
      { id: 'id_3', ['物品']: '银币', ['数量']: 3 },
    ])
  })

  it('没读数组也没读字段 ⇒ 数组一个字符都不出现', async () => {
    const card = cardWithRefs(holdCard(), { reads: ['2.1'] })
    const lines = stateLines(
      await promptOf(
        card,
        card.chain.find((node) => node.id === 'check'),
      ),
    )
    expect(lines?.some((line) => line.startsWith('- 2.4「'))).toBe(false)
  })
})

describe('数组字段 · writable 提示词（增补 §四）', () => {
  it('写 2.4.1 ⇒ 一条字段行：JSON 数组 / 长度等于当前项数 / 文本；不出现容器整表行', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4.1'] })
    const lines = writableLines(
      await promptOf(
        card,
        card.chain.find((node) => node.id === 'check'),
      ),
    )
    expect(lines, '非 output 节点必须有可写块').not.toBeNull()
    const line = lineOf(lines, '2.4.1', '物品')
    const constraint = payloadOf(line)
    expect(constraint).toContain('JSON 数组')
    expect(constraint, '必须说清长度约束').toContain('长度')
    expect(constraint).toContain('文本')
    expect(constraint).not.toContain('advance_time')
    expect(
      lines.some((item) => item.startsWith('- 2.4「背包」：')),
      '没开容器写就不许列整表行',
    ).toBe(false)
  })

  it('写嵌套字段 2.4.2.2.1 ⇒ 用自己的 code / 中文名出一行，并说明数组形状', async () => {
    const card = cardWithRefs(nestedCard(), { writable: ['2.4.2.2.1'] })
    const lines = writableLines(
      await promptOf(
        card,
        card.chain.find((node) => node.id === 'check'),
      ),
    )
    const constraint = payloadOf(lineOf(lines, '2.4.2.2.1', '名称'))
    expect(constraint).toContain('JSON 数组')
    expect(constraint).not.toContain('advance_time')
  })

  it('容器 + 字段都写 ⇒ 两行都在（整表替换与整列替换是两种操作）', async () => {
    const card = cardWithRefs(holdCard(), { writable: ['2.4', '2.4.1'] })
    const lines = writableLines(
      await promptOf(
        card,
        card.chain.find((node) => node.id === 'check'),
      ),
    )
    expect(lines.some((item) => item.startsWith('- 2.4「背包」：'))).toBe(true)
    expect(lines.some((item) => item.startsWith('- 2.4.1「物品」：'))).toBe(true)
  })
})
