/**
 * 阶段 3 · 数组节点：提示词投影（数组契约 §五）。
 *
 * 这一份钉的是**模型真正看到的字**：
 *   · 读数组 code ⇒ 一行 `- <code>「<name>」：<JSON>`，JSON 的键是**字段中文名**，
 *     值按 item 顺序；不出现 `2.4.1` / `2.4.0` 这种 code 键；字段不单独出行；
 *   · 可写数组 ⇒ 一行 `- 2.4「背包」：<约束>`，约束说明这是 JSON 数组、每项是对象、
 *     字段中文名 + 各自类型 / 上下限；不出现字段 code，不出现 advance_time；
 *   · output 节点整段不出现（照旧）。
 *
 * 约束文案的具体措辞归实现；判据只钉「必须说清的东西」与「不许出现的东西」。
 */
import { describe, expect, it } from 'vitest'
import { holdCard, holdSave, nestedCard } from './support/array-fixtures.js'
import { loadModule } from './support/load.js'

const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))

const STATE_MARKER = '<世界状态树>'
const WRITABLE_MARKER = '<可写状态>'

/** 一个最简节点（只换 reads / writable，别的用最省事的合法值） */
function reader(over = {}) {
  return {
    id: 'reader',
    type: 'normal',
    name: 'reader',
    reads: [],
    writable: [],
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
    ...over,
  }
}

/** 拼一份提示词 */
async function promptOf(card, node, save = holdSave(card)) {
  const { buildPrompt } = await loadPrompt()
  return buildPrompt({ card, save, node, action: 'act one', outputs: {} })
}

/** 某个块（`\n\n` 分隔，块以标记开头） */
function blockOf(prompt, marker) {
  return prompt.split('\n\n').find((block) => block.startsWith(marker))
}

/** 状态块里的非空行 */
function stateLines(prompt) {
  const block = blockOf(prompt, STATE_MARKER)
  if (block === undefined) return null
  return block
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
}

/** 可写块里的非空行 */
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

/** 数组那一行的正文（`- 2.4「背包」：` 之后） */
function arrayLine(lines, code = '2.4', name = '背包') {
  const line = lines.find((item) => item.startsWith(`- ${code}「${name}」：`))
  expect(line, `缺少 ${code}「${name}」这一行（实际：${JSON.stringify(lines)}）`).toBeTruthy()
  return line
}

describe('数组 · 状态段（§五）', () => {
  it('读 2.4 ⇒ 一行 JSON 数组，键是中文名，不是字段 code', async () => {
    const card = holdCard()
    const prompt = await promptOf(card, reader({ reads: ['2.4'], historyTurns: 0 }))
    const lines = stateLines(prompt)
    expect(lines, '读了数组，状态块必须在').not.toBeNull()
    expect(lines, '数组只出一行，字段不单独出行').toHaveLength(1)

    const line = arrayLine(lines)
    // 数组 item 在模型提示词里带 id（阶段 4 §7.1 例）；引用值另算
    expect(JSON.parse(payloadOf(line))).toEqual([
      { id: 'id_1', ['物品']: '短剑', ['数量']: 1 },
      { id: 'id_2', ['物品']: '斗篷', ['数量']: 1 },
      { id: 'id_3', ['物品']: '银币', ['数量']: 3 },
    ])
    expect(line, '不许出现字段 code').not.toContain('2.4.1')
    expect(line, '不许出现自身值槽').not.toContain('2.4.0')
    expect(line, '键是中文名').toContain('物品')
    expect(line).toContain('数量')
  })

  it('空数组 ⇒ 一行 `[]`，不是空段', async () => {
    const card = holdCard()
    const save = holdSave(card)
    save.tree['2.4'] = []
    const prompt = await promptOf(card, reader({ reads: ['2.4'] }), save)
    const lines = stateLines(prompt)
    expect(lines).toHaveLength(1)
    expect(payloadOf(arrayLine(lines))).toBe('[]')
  })

  it('嵌套 object / array 字段递归：中文键层层嵌套，没有 code 键', async () => {
    const card = nestedCard()
    const prompt = await promptOf(card, reader({ reads: ['2.4'] }))
    const line = arrayLine(stateLines(prompt))
    expect(JSON.parse(payloadOf(line))).toEqual([
      {
        id: 'id_1',
        ['物品']: '短剑',
        ['属性']: {
          ['品质']: '普通',
          ['附魔']: [{ id: 'id_1', ['名称']: '锋锐', ['强度']: 2 }],
        },
      },
    ])
    for (const code of ['2.4.1', '2.4.2', '2.4.2.1', '2.4.2.2.1']) {
      expect(line, `嵌套 JSON 里出现了 code ${code}`).not.toContain(code)
    }
    expect(line).toContain('属性')
    expect(line).toContain('品质')
    expect(line).toContain('附魔')
    expect(line).toContain('名称')
    expect(line).toContain('强度')
  })

  it('没读数组 ⇒ 状态段里一个字符都不出现', async () => {
    const card = holdCard()
    const prompt = await promptOf(card, reader({ reads: ['2.1'] }))
    const lines = stateLines(prompt)
    expect(lines, '读了 2.1，状态块在').not.toBeNull()
    expect(lines.some((line) => line.startsWith('- 2.4「'))).toBe(false)
    expect(prompt).not.toContain('短剑')
  })
})

describe('数组 · 可写段（§五）', () => {
  it('写 2.4 ⇒ 说明 JSON 数组 / 每项对象 / 字段中文名与整数范围；不出现字段 code 与 advance_time', async () => {
    const card = holdCard()
    const prompt = await promptOf(card, reader({ writable: ['2.4'] }))
    const lines = writableLines(prompt)
    expect(lines, '非 output 节点必须有可写块').not.toBeNull()
    const line = arrayLine(lines)
    const constraint = payloadOf(line)

    expect(constraint, '必须说清是 JSON 数组').toContain('JSON 数组')
    expect(constraint, '必须说清每个元素是对象').toMatch(/对象|结构体/)
    expect(constraint, '必须列字段中文名「物品」').toContain('物品')
    expect(constraint, '必须列字段中文名「数量」').toContain('数量')
    expect(constraint, '必须写数量上下限 0..999').toMatch(/0\.\.999|0 ~ 999|0-999/)
    expect(constraint, '不许出现字段 code').not.toContain('2.4.1')
    expect(constraint, '不许出现字段 code').not.toContain('2.4.2')
    expect(constraint, '数组不走 advance_time').not.toContain('advance_time')
  })

  it('嵌套字段递归列：属性 / 品质 / 附魔 / 名称 / 强度；不出现嵌套 code', async () => {
    const card = nestedCard()
    const prompt = await promptOf(card, reader({ writable: ['2.4'] }))
    const constraint = payloadOf(arrayLine(writableLines(prompt)))
    for (const name of ['物品', '属性', '品质', '附魔', '名称', '强度']) {
      expect(constraint, `可写约束缺少字段「${name}」`).toContain(name)
    }
    expect(constraint, '嵌套 integer 的上下限').toMatch(/0\.\.10|0 ~ 10|0-10/)
    for (const code of ['2.4.1', '2.4.2', '2.4.2.1', '2.4.2.2.1']) {
      expect(constraint, `可写约束里出现了 code ${code}`).not.toContain(code)
    }
  })

  it('空数组的可写行仍然是数组形状（不是「无可写状态」）', async () => {
    const card = holdCard()
    const save = holdSave(card)
    save.tree['2.4'] = []
    const prompt = await promptOf(card, reader({ writable: ['2.4'] }), save)
    const lines = writableLines(prompt)
    expect(lines.some((line) => line.includes('无可写状态'))).toBe(false)
    expect(payloadOf(arrayLine(lines))).toContain('JSON 数组')
  })

  it('没写数组 ⇒ 可写块里没有 2.4 这一行', async () => {
    const card = holdCard()
    const prompt = await promptOf(card, reader({ writable: ['2.1'] }))
    const lines = writableLines(prompt)
    expect(lines.some((line) => line.startsWith('- 2.4「'))).toBe(false)
  })

  it('output 节点整段不出现可写状态', async () => {
    const card = holdCard()
    const output = card.chain.find((node) => node.id === 'output')
    const prompt = await promptOf(card, output)
    expect(prompt, 'output 节点不许渲染可写块').not.toContain(WRITABLE_MARKER)
    expect(prompt, 'output 节点连「无可写状态」都不留').not.toContain('无可写状态')
    expect(prompt, 'output 节点照旧读得到数组').toContain('- 2.4「背包」')
  })
})
