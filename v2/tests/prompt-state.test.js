/**
 * 阶段 2.1 · 提示词里的状态段（v5 契约 §5）。
 *
 * 这一份钉的是**玩家模型真正看到的那几行**：
 *   · 读 **object / array** 元素 ⇒ 输出孩子 / item 的 JSON；读**标量**元素（哪怕有孩子）
 *     ⇒ 只输出它自己的值（要读孩子就单独给孩子的 code）；
 *   · **容器读**里标量孩子的自身值住在 `"自身"` 键（`prompt.ownKey`），孩子键用元素的 `name`；
 *   · 读叶子 code ⇒ 输出该字段；
 *   · 时间输出 `YYYY-MM-DD HH:mm:ss（周X）`；
 *   · 行格式 `- <code>「<name>」：<JSON>`；**不输出形状表**（除了这些行没有别的东西）。
 *
 * 判据只认 `- <code>「<name>」：…` 这些行：状态段里除了它们没有别的东西。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { v5Card, v5Save } from './support/state-fixtures.js'
import { loadModule } from './support/load.js'

const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))
const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'sample-card.json')

/** 把一段提示词切成「`\n\n` 分隔的块」，返回以某个标记开头的块（找不到就是 undefined） */
function blockOf(prompt, marker) {
  return prompt.split('\n\n').find((block) => block.startsWith(marker))
}

/** 状态块里的行（去掉标记行本身）；没有块就是 null */
function stateLines(prompt) {
  const block = blockOf(prompt, '<世界状态树>')
  if (block === undefined) return null
  return block.split('\n').slice(1)
}

/** 从 `- <code>「<name>」：` 后面取正文 */
function payloadOf(line, code, name) {
  const prefix = `- ${code}「${name}」：`
  expect(line.startsWith(prefix), `行格式应为 \`${prefix}…\`，实际是 \`${line}\``).toBe(true)
  return line.slice(prefix.length)
}

describe('提示词 · 状态段（v5 §5）', () => {
  /** 一张小卡：读 1.1（enum 自身值 + text 孩子）、1.2（text 叶子）、0（时间） */
  const card = v5Card()
  const node = {
    id: 'output',
    type: 'output',
    name: 'output',
    reads: ['1.1', '1.2', '0'],
    writable: [],
    readsUpstream: [],
    historyTurns: 3,
    prompt: 'NODE_OUT',
  }

  it('读标量父亲 ⇒ 只有它自己的值；「自身」+ name 的嵌套只在容器读里出现', async () => {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({ card, save: v5Save(card), node, action: 'act one', outputs: {} })
    const lines = stateLines(prompt)
    expect(lines, '读了三样，应当有状态块').not.toBeNull()
    const line = lines.find((item) => item.startsWith('- 1.1「'))
    expect(line, '1.1 那一行').toBeTruthy()
    const payload = JSON.parse(payloadOf(line, '1.1', 'region'))
    expect(payload, '1.1 是标量（有孩子也一样）⇒ 只出它自己的值').toBe('A1')
    expect(line, '孩子不跟着标量父亲进来').not.toContain('SITE_X')

    // 同样的格子放在 object 容器读里才带出整棵子树：自身值用「自身」、孩子用 name
    const container = buildPrompt({
      card,
      save: v5Save(card),
      node: { ...node, reads: ['1'] },
      action: 'act one',
      outputs: {},
    })
    const containerLine = stateLines(container).find((item) => item.startsWith('- 1「'))
    expect(containerLine, '1 那一行').toBeTruthy()
    const region = JSON.parse(payloadOf(containerLine, '1', 'world')).region
    expect(region, 'object 1 覆盖孩子：自身值 + 孩子（键是中文名）').toEqual({
      自身: 'A1',
      site: 'SITE_X',
    })
    expect(JSON.stringify(region), '不许出现 "0" / "1" 这种 code 键').not.toMatch(/"0"\s*:|"1"\s*:/)
  })

  it('读叶子 ⇒ 只有该字段；读时间 ⇒ 公历格式', async () => {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({ card, save: v5Save(card), node, action: 'act one', outputs: {} })
    const lines = stateLines(prompt)

    const leaf = lines.find((item) => item.startsWith('- 1.2「'))
    const leafPayload = payloadOf(leaf, '1.2', 'mood')
    expect(leafPayload.startsWith('"') ? JSON.parse(leafPayload) : leafPayload).toBe('MOOD_Y')

    const time = lines.find((item) => item.startsWith('- 0「'))
    expect(payloadOf(time, '0', 'time')).toBe('2024-01-01 08:05（周一）')
  })

  it('读对象 code ⇒ 子树 JSON（相对段，object 没有 "0"）', async () => {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({
      card,
      save: v5Save(card),
      node: { ...node, reads: ['2.4'] },
      action: 'act one',
      outputs: {},
    })
    const line = stateLines(prompt).find((item) => item.startsWith('- 2.4「'))
    const payload = JSON.parse(payloadOf(line, '2.4', 'bag'))
    expect(payload).toEqual({ item: 'SWORD' })
    expect(JSON.stringify(payload), '不许出现 "0" / "1" 这种 code 键').not.toMatch(/"0"\s*:|"1"\s*:/)
  })

  it('读顶层 object ⇒ 整棵子树的嵌套 JSON', async () => {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({
      card,
      save: v5Save(card),
      node: { ...node, reads: ['1'] },
      action: 'act one',
      outputs: {},
    })
    const line = stateLines(prompt).find((item) => item.startsWith('- 1「'))
    const payload = JSON.parse(payloadOf(line, '1', 'world'))
    expect(payload).toEqual({ region: { 自身: 'A1', site: 'SITE_X' }, mood: 'MOOD_Y' })
    expect(JSON.stringify(payload), '不许出现 "0" / "1" 这种 code 键').not.toMatch(/"0"\s*:|"1"\s*:/)
  })

  it('只读孩子时不带父亲的自身值；读父亲时不把子孙单独列行', async () => {
    const { buildPrompt } = await loadPrompt()
    const childOnly = buildPrompt({
      card,
      save: v5Save(card),
      node: { ...node, reads: ['1.1.1'] },
      action: 'act one',
      outputs: {},
    })
    const lines = stateLines(childOnly)
    expect(lines).toHaveLength(1)
    expect(payloadOf(lines[0], '1.1.1', 'site').replace(/^"|"$/g, '')).toBe('SITE_X')
    expect(childOnly, '没读父亲，就不该出现它的自身值').not.toContain('A1')

    const parent = buildPrompt({ card, save: v5Save(card), node, action: 'act one', outputs: {} })
    expect(
      stateLines(parent).some((item) => item.startsWith('- 1.1.1「')),
      '父子树只该有父亲那一行',
    ).toBe(false)
  })

  it('状态块只有 `- code「name」：…` 这些行，没有形状表', async () => {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({ card, save: v5Save(card), node, action: 'act one', outputs: {} })
    const lines = stateLines(prompt).filter((line) => line.trim() !== '')
    expect(lines).toHaveLength(3)
    for (const line of lines) expect(line.startsWith('- '), `多余的一行：${line}`).toBe(true)
    expect(prompt).not.toContain('类型')
    expect(prompt).not.toContain('values')
    expect(prompt).not.toContain('type:')
  })

  it('眼睛关着 ⇒ 状态段连标记都不出现', async () => {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({
      card,
      save: v5Save(card),
      node: { ...node, reads: [] },
      action: 'act one',
      outputs: {},
    })
    expect(prompt).not.toContain('<世界状态树>')
    expect(prompt).not.toContain('A1')
    expect(prompt).not.toContain('SITE_X')
  })

  it('未读的兄弟元素一个字符都不进提示词（历史与节点提示词照旧）', async () => {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({ card, save: v5Save(card), node, action: 'act one', outputs: {} })
    expect(stateLines(prompt), '读了三样，状态块必须在').not.toBeNull()
    expect(
      stateLines(prompt).some((line) => line.startsWith('- 1.1「')),
      '读到的 1.1 在',
    ).toBe(true)
    expect(prompt).not.toContain('HERO')
    expect(prompt).not.toContain('SWORD')
    expect(prompt).toContain('<游戏历史记录>')
    expect(prompt).toContain('> act one')
    expect(prompt).toContain('<节点提示词>\nNODE_OUT')
  })
})

/**
 * 读**自身值路径** `<code>.0`（v5 §4 / §5 修订：reads 里可以有 `.0`）。
 *
 * 行里那个 `<code>` 不钉死（`1.1` 与 `1.1.0` 两种写法都收 —— 契约只规定「只输出这个值」），
 * 但**值与名字**必须对：`.0` 只出自身值，不出孩子；读孩子时不出父亲的自身值。
 */
describe('提示词 · 读自身值路径 <code>.0', () => {
  const card = v5Card()
  const reader = {
    id: 'reader',
    type: 'output',
    name: 'reader',
    reads: [],
    writable: [],
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
  }

  /** 拼一份提示词，返回状态段的非空行 */
  async function linesFor(reads) {
    const { buildPrompt } = await loadPrompt()
    const prompt = buildPrompt({
      card,
      save: v5Save(card),
      node: { ...reader, reads },
      action: 'act one',
      outputs: {},
    })
    expect(prompt, '读了状态元素，状态块必须在').toContain('<世界状态树>')
    return stateLines(prompt).filter((line) => line.trim() !== '')
  }

  /** 行里 `：` 后面那一格（JSON 引号字符串 / 裸文本两种都收） */
  function payloadOfLine(line) {
    const at = line.indexOf('：')
    expect(at, `状态行缺少全角冒号：${line}`).toBeGreaterThan(0)
    return line.slice(at + 1)
  }

  function plainValue(payload) {
    return payload.startsWith('"') ? JSON.parse(payload) : payload
  }

  it('reads 里是 1.1.0 ⇒ 只输出自己的值（不出孩子、不出整棵子树）', async () => {
    const lines = await linesFor(['1.1.0'])
    expect(lines, '读自身值路径应当恰好一行').toHaveLength(1)
    expect(lines[0]).toContain('「region」')
    expect(plainValue(payloadOfLine(lines[0]))).toBe('A1')
    expect(lines[0], '.0 只出自身值，孩子不许跟着进来').not.toContain('SITE_X')
  })

  it('reads 里是 1.1.1 ⇒ 只输出孩子（不出父亲的自身值）', async () => {
    const lines = await linesFor(['1.1.1'])
    expect(lines, '读孩子应当恰好一行').toHaveLength(1)
    expect(lines[0]).toContain('「site」')
    expect(plainValue(payloadOfLine(lines[0]))).toBe('SITE_X')
    expect(lines[0], '读孩子时不带父亲自身值').not.toContain('A1')
  })

  it('reads 里是父亲 code 1.1 ⇒ 只出它自己的值（标量不覆盖孩子）', async () => {
    const lines = await linesFor(['1.1'])
    expect(lines, '父亲 code 只出一行（子孙不单独出行）').toHaveLength(1)
    expect(plainValue(payloadOfLine(lines[0]))).toBe('A1')
    expect(lines[0], '标量父亲不把孩子的值 / 键带进来').not.toContain('SITE_X')
  })
})

describe('提示词 · 示例卡的 JSON 键是中文名', () => {
  it('读标量根只出自己的值；数组 item 的键是中文名，没有数字键 / 字段 code', async () => {
    const { buildPrompt } = await loadPrompt()
    const { initialTreeOf } = await loadState()
    const sample = JSON.parse(readFileSync(SAMPLE, 'utf8'))
    const save = v5Save(sample, { tree: initialTreeOf(sample) })
    const reader = {
      id: 'reader',
      type: 'output',
      name: 'reader',
      reads: [],
      writable: [],
      readsUpstream: [],
      historyTurns: 0,
      prompt: '',
    }

    /** 读一个引用：返回那一行（`- <code>「<name>」：…`）与 `：` 后面的 JSON */
    function readLine(code) {
      const prompt = buildPrompt({
        card: sample,
        save,
        node: { ...reader, reads: [code] },
        action: 'act one',
        outputs: {},
      })
      const line = stateLines(prompt).find((item) => item.startsWith(`- ${code}「`))
      expect(line, `${code} 那一行`).toBeTruthy()
      return { line, payload: JSON.parse(line.slice(line.indexOf('：') + 1)) }
    }

    // 示例卡的 1 / 2 是「有孩子的标量根」：直接读只给自己的值（空串），孩子一个都不跟进来
    for (const code of ['1', '2']) {
      const { line, payload } = readLine(code)
      expect(payload, `${code} 是标量根，只出自身值`).toBe('')
      expect(line, `${code} 是标量根，孩子不许跟着进来`).not.toMatch(/晨风镇|旅人|短剑|雨/)
    }

    // 子元素仍然各自出行、值是自己的那一格
    expect(readLine('1.1').payload, '1.1「区域」是标量，只出自己的值').toBe('晨风镇')
    expect(readLine('1.3').payload).toBe('炉火噼啪，麦酒和湿羊毛的味道')

    // 数组 2.4 是容器：整份 item 出来，键是字段的中文名（不是 2.4.1 这种 code，也不是数字键）
    const bag = readLine('2.4').payload
    expect(bag, '数组里是中文键的 item 对象').toEqual([
      { 物品: '短剑', 数量: 1 },
      { 物品: '斗篷', 数量: 1 },
      { 物品: '银币', 数量: 3 },
    ])
    expect(JSON.stringify(bag), '数组里不许出现字段 code 键').not.toMatch(/"2\.4\.[0-9]+"\s*:/)
    expect(JSON.stringify(bag), '数组里不许出现数字键').not.toMatch(/"[0-9]+"\s*:/)
  })
})

/**
 * F8-①（评审缺口）：真实示例卡的 `check` / `output` 节点，不是合成的「一个读者」。
 *
 * 新读口径下 `1.1「区域」`（enum，有孩子 `1.1.1「地点」`）只出自己的值；地点必须由
 * 自己的 ref 单独成行。删掉示例卡 `reads` 里的 `1.1.1`，这一行就消失 —— 判据必须跟着红。
 */
describe('提示词 · 示例卡真实节点的状态段带「地点」', () => {
  async function promptOf(nodeId) {
    const { buildPrompt } = await loadPrompt()
    const { initialTreeOf } = await loadState()
    const sample = JSON.parse(readFileSync(SAMPLE, 'utf8'))
    const node = sample.chain.find((item) => item.id === nodeId)
    expect(node, `示例卡应当有 ${nodeId} 节点`).toBeTruthy()
    return buildPrompt({
      card: sample,
      save: v5Save(sample, { tree: initialTreeOf(sample) }),
      node,
      action: '推门走进酒馆',
      outputs: {},
    })
  }

  function expectLocationLine(prompt, nodeId) {
    const lines = stateLines(prompt)
    expect(lines, `${nodeId} 读了状态，状态块必须在`).not.toBeNull()
    const rows = lines ?? []
    expect(
      rows.filter((line) => line.startsWith('- 1.1「区域」：')),
      `${nodeId} 的 1.1「区域」行：标量有孩子也只出自己的值`,
    ).toEqual(['- 1.1「区域」："晨风镇"'])
    expect(
      rows.filter((line) => line.startsWith('- 1.1.1「地点」：')),
      `${nodeId} 的 1.1.1「地点」行`,
    ).toEqual(['- 1.1.1「地点」："醉猫旅店 · 一楼"'])
    expect(
      rows.filter((line) => line.includes('醉猫旅店 · 一楼')),
      `${nodeId} 的地点值只能出现在地点行`,
    ).toHaveLength(1)
  }

  it('check 的状态段：区域只出自己的值，地点单独一行', async () => {
    expectLocationLine(await promptOf('check'), 'check')
  })

  it('output 的状态段：区域只出自己的值，地点单独一行', async () => {
    expectLocationLine(await promptOf('output'), 'output')
  })
})
