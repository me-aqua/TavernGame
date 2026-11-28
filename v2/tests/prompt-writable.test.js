/**
 * 提示词 · 可写状态块（第 2 关契约；判据只认契约，不认实现）。
 *
 * 契约：**非 `output` 节点**的提示词里恒有一段自动生成的 `<可写状态>`，内容只由 `node.writable`
 * 决定（与 `node.reads` 无关）；`output` 节点**整段不出现**（它什么也不写，连「无可写状态」都不留）：
 *
 *   · 一个引用展开成**值路径清单**（`refPathsOf` 的口径，与读覆盖同一套容器规则）：
 *     **object / array** 元素 ⇒ 它的全部后代值路径（`object` 没有自身值，数组只有容器那一条）；
 *     **标量**元素（哪怕有孩子）⇒ 只有它自己的值（有孩子的住 `<code>.0`）；`<code>.0` ⇒ 只有这一格。
 *   · 每条值路径一行，行格式与状态段同形：`- <path>「<name>」：<约束>`；名字是元素的中文名。
 *   · 每一条可写路径都要说明**合法 JSON 值形状**，不能只说范围：
 *       text    ⇒ `文本` + `JSON 字符串`
 *       enum    ⇒ `下拉` + 白名单（卡里 `values` 顺序）+ `JSON 字符串`
 *       integer ⇒ `整数 min..max，步幅 stepMin..stepMax` + `JSON 整数` + 明确不能是字符串 / 小数
 *       time    ⇒ `只能通过 advance_time 推进，不能 write_state`
 *   · `writable` 为空且节点不是 `output` ⇒ 块里没有一条写路径，正文说 `无可写状态`（无写能力）。
 *   · 块是**穷举**：只有 writable 覆盖到的路径出现；没列出的状态（含时间）一律只读，
 *     一个字符都不进这一块；提示词里还要有一句「只读」声明（住段内还是紧挨段前归实现）。
 *   · 位置：`<世界状态树>` 之后、`<游戏历史记录>` 之前（读到的状态 → 能写的状态）。
 *
 * 断言只认标记、路径、名字、约束文案；段间分隔符与行的其它修饰归实现，不钉。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { v5Save } from './support/state-fixtures.js'
import { elementV6, nodeV6, timeElementV6, v6Card, v6Save } from './support/v6-fixtures.js'
import { loadModule } from './support/load.js'

const SAMPLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'sample-card.json')
const MARKER = '<可写状态>'
const STATE_MARKER = '<世界状态树>'
const HISTORY_MARKER = '<游戏历史记录>'
const NODE_MARKER = '<节点提示词>'

const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
const loadState = () => loadModule('core/statetree.ts', () => import('../src/core/statetree.ts'))

/** 示例卡（晨风镇）：check 可写 1.1 / 1.2 / 1.3 / 2.1–2.4，output 可写为空，time 只写 0 */
function sampleCard() {
  return JSON.parse(readFileSync(SAMPLE, 'utf8'))
}

/** 示例卡的存档：树按卡的初始值摊平（夹具用产品函数展开，期望侧仍是下面写死的路径） */
async function sampleSave(card) {
  const { initialTreeOf } = await loadState()
  return v5Save(card, { tree: initialTreeOf(card) })
}

function nodeOf(card, id) {
  return card.chain.find((node) => node.id === id)
}

/**
 * 反硬编码卡：约束全部来自元素字段，名字 / 白名单 / 上下限都与示例卡不同。
 *
 * ```text
 * 0 时间（time）
 * 1 世界（object）      initial: 1.1.0=X / 1.1.1=地点X / 1.2.1=0 / 1.2.2=备注X
 *   1.1 区域（enum X/Y；有孩子 ⇒ 自身值住 1.1.0）
 *     1.1.1 地点（text）
 *   1.2 容器（object，嵌套在对象里）
 *     1.2.1 数值（integer -5..7，步幅 2..3）
 *     1.2.2 备注（text）
 *     1.2.3 子容器（object，再嵌一层）
 *       1.2.3.1 深层（text）
 * ```
 */
function antiHardcodeCard() {
  const state = [
    timeElementV6(),
    elementV6('1', 'object', {
      name: '世界X',
      initial: { '1.1.0': 'X', '1.1.1': '地点X', '1.2.1': 0, '1.2.2': '备注X', '1.2.3.1': '深层X' },
    }),
    elementV6('1.1', 'enum', { name: '区域X', values: ['X', 'Y'] }),
    elementV6('1.1.1', 'text', { name: '地点X' }),
    elementV6('1.2', 'object', { name: '容器X' }),
    elementV6('1.2.1', 'integer', { name: '数值X', min: -5, max: 7, stepMin: 2, stepMax: 3 }),
    elementV6('1.2.2', 'text', { name: '备注X' }),
    elementV6('1.2.3', 'object', { name: '子容器X' }),
    elementV6('1.2.3.1', 'text', { name: '深层X' }),
  ]
  const chain = [
    nodeV6('time', 'time', { writable: ['0'] }),
    nodeV6('check', 'normal', { writable: ['1.1', '1.2'] }),
    nodeV6('output', 'output', { reads: ['1.1', '1.2'], readsUpstream: ['check'], historyTurns: 3 }),
  ]
  return v6Card({ id: 'c-generic', name: '通用树卡', state, chain })
}

/** 拼一份提示词；默认用示例卡的 check 节点 */
async function promptOf({ card, save, node, action = 'act one', outputs = {} }) {
  const { buildPrompt } = await loadPrompt()
  return buildPrompt({ card, save, node, action, outputs })
}

/** 可写状态块的正文（去掉标记行；块在下一个 `\n\n<…>` 标记之前结束） */
function writableSection(prompt) {
  const at = prompt.indexOf(MARKER)
  expect(at, `提示词里没有 ${MARKER} 标记`).toBeGreaterThanOrEqual(0)
  const after = prompt.slice(at + MARKER.length)
  const next = after.search(/\n\n(?=<[^>]+>)/)
  return (next < 0 ? after : after.slice(0, next)).trim()
}

/** 块里的非空行 */
function writableLines(prompt) {
  return writableSection(prompt)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** 块里的每条路径行：`- <path>「<name>」：<constraint>`（末尾那句只读声明不是路径行） */
function parsedLines(prompt) {
  return writableLines(prompt)
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const matched = /^- (\S+)「([^」]*)」：(.*)$/.exec(line)
      expect(matched, `可写状态的行应为 \`- <path>「<name>」：<约束>\`，实际是 \`${line}\``).not.toBeNull()
      return { line, path: matched[1], name: matched[2], constraint: matched[3] }
    })
}

/** 「未列出的状态只读」那句声明：住块里，或紧挨在块前一段（两种都收，位置归实现） */
function readOnlyStatementOf(prompt) {
  const at = prompt.indexOf(MARKER)
  expect(at, `提示词里没有 ${MARKER} 标记`).toBeGreaterThanOrEqual(0)
  const before = prompt.slice(0, at).trimEnd().split('\n\n').pop() ?? ''
  return writableSection(prompt) + '\n' + before
}

/** 整数行必须排除字符串与小数：从第一个否定词往后，两种写法都要点到 */
function expectIntegerValueShape(constraint, label) {
  expect(constraint, `${label} 必须写「JSON 整数」`).toContain('JSON 整数')
  const at = constraint.search(/不能|不是|不要|禁止|不允许|不接受|拒绝|不行|不可/)
  expect(at, `${label} 没写不能是字符串 / 小数`).toBeGreaterThanOrEqual(0)
  const tail = constraint.slice(at)
  expect(tail, `${label} 没排除字符串写法`).toContain('字符串')
  expect(tail, `${label} 没排除小数写法`).toMatch(/小数|浮点/)
  expect(constraint, `${label} 不能写成 JSON 字符串`).not.toContain('JSON 字符串')
}

/**
 * 一行约束里的**合法 JSON 值形状**：每种写路径都要点名 JSON 类型，不能只说范围。
 * 文本 / 下拉 = JSON 字符串；整数 = JSON 整数且明确排除字符串 / 小数；时间不走 write_state。
 */
function expectJsonValueShape(line, spec) {
  if (spec.type === 'text') {
    expect(line.constraint, `${spec.path} 的文本行必须写明「JSON 字符串」`).toContain('JSON 字符串')
    expect(line.constraint, `${spec.path} 的文本行串了别的类型`).not.toMatch(/JSON 整数|下拉|advance_time/)
    return
  }
  if (spec.type === 'enum') {
    expect(line.constraint, `${spec.path} 的下拉行必须写明「JSON 字符串」`).toContain('JSON 字符串')
    expect(line.constraint, `${spec.path} 的下拉行串了别的类型`).not.toMatch(/JSON 整数|advance_time/)
    return
  }
  if (spec.type === 'integer') {
    expectIntegerValueShape(line.constraint, `${spec.path} 的整数行`)
    return
  }
  if (spec.type === 'time') {
    expect(line.constraint, `${spec.path} 的时间行只能走 advance_time`).toContain('advance_time')
    expect(line.constraint, `${spec.path} 的时间行必须说明不能 write_state`).toContain('write_state')
    expect(line.constraint, `${spec.path} 的时间行不是 JSON 值行`).not.toMatch(/JSON 字符串|JSON 整数/)
    return
  }
  if (spec.type === 'array') {
    expect(line.constraint, `${spec.path} 的数组行必须写明「JSON 数组」`).toContain('JSON 数组')
    expect(line.constraint, `${spec.path} 的数组行必须说明每项是对象`).toMatch(/对象|结构体/)
    expect(line.constraint, `${spec.path} 的数组行不是时间行`).not.toContain('advance_time')
    return
  }
  throw new Error(`未知的期望类型：${spec.type}`)
}

/** 断言块里的路径、名字、约束都对（顺序 = writable 引用顺序 × pathsOf 顺序） */
function expectWritableLines(prompt, specs) {
  const lines = parsedLines(prompt)
  expect(
    lines.map((item) => item.path),
    '可写状态块的路径清单',
  ).toEqual(specs.map((spec) => spec.path))
  expect(readOnlyStatementOf(prompt), '提示词里要声明未列出的状态只读').toContain('只读')
  specs.forEach((spec, index) => {
    const line = lines[index]
    expect(line.name, `${spec.path} 的中文名`).toBe(spec.name)
    expectJsonValueShape(line, spec)
    if (spec.type === 'text') {
      expect(line.constraint, `${spec.path} 的文本约束没说是文本`).toContain('文本')
      expect(line.constraint, `${spec.path} 的文本约束串了别的类型`).not.toMatch(/下拉|整数|advance_time/)
    } else if (spec.type === 'integer') {
      expect(line.constraint, `${spec.path} 的整数约束`).toContain(
        `整数 ${spec.min}..${spec.max}，步幅 ${spec.stepMin}..${spec.stepMax}`,
      )
    } else if (spec.type === 'time') {
      expect(line.constraint, `${spec.path} 的时间约束`).toContain(
        '只能通过 advance_time 推进，不能 write_state',
      )
    } else if (spec.type === 'enum') {
      expect(line.constraint, `${spec.path} 应当说明是下拉`).toMatch(/^下拉/)
      let at = -1
      for (const value of spec.values) {
        const next = line.constraint.indexOf(value, at + 1)
        expect(next, `${spec.path} 的下拉清单缺少 ${value}，或顺序与卡里的 values 不一致`).toBeGreaterThan(at)
        at = next
      }
    } else if (spec.type === 'array') {
      for (const field of spec.fields) {
        const at = line.constraint.indexOf(field.name)
        expect(at, `${spec.path} 的数组约束缺少字段「${field.name}」`).toBeGreaterThanOrEqual(0)
        if (field.type === 'integer') {
          const range = `${field.min}..${field.max}`
          expect(line.constraint, `${spec.path} 的数组约束缺少「${field.name}」的范围 ${range}`).toContain(
            range,
          )
        }
      }
      expect(line.constraint, `${spec.path} 的数组约束里出现了字段 code`).not.toContain('2.4.1')
    } else {
      throw new Error(`未知的期望类型：${spec.type}`)
    }
  })
}

describe('可写状态块：非 output 节点都有，位置在状态树之后', () => {
  it('示例卡 time / check 各一个 <可写状态>；output 节点一个都没有', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const expected = { time: 1, check: 1, output: 0 }
    for (const [id, count] of Object.entries(expected)) {
      const prompt = await promptOf({ card, save, node: nodeOf(card, id) })
      const hits = prompt.split(MARKER).length - 1
      expect(hits, `${id} 节点的提示词里 ${MARKER} 出现 ${hits} 次，应当是 ${count}`).toBe(count)
    }
  })

  it('顺序：公共提示词 → 状态树 → 可写状态 → 历史 → 节点提示词', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const node = {
      ...nodeOf(card, 'check'),
      reads: ['prompt-world', '1.1'],
      writable: ['1.2'],
      readsUpstream: [],
      historyTurns: 1,
      prompt: 'NODE_CHECK',
    }
    const prompt = await promptOf({ card, save, node })
    const order = ['<公共提示词·世界观>', STATE_MARKER, MARKER, HISTORY_MARKER, NODE_MARKER]
    for (let index = 1; index < order.length; index += 1) {
      const before = prompt.indexOf(order[index - 1])
      const after = prompt.indexOf(order[index])
      expect(before, `${order[index - 1]} 没出现`).toBeGreaterThanOrEqual(0)
      expect(after, `${order[index - 1]} 应当排在 ${order[index]} 之前`).toBeGreaterThan(before)
    }
    expect(prompt.trimEnd().endsWith('NODE_CHECK'), '节点提示词必须仍是最后一段').toBe(true)
  })
})

describe('可写状态块：路径来自 node.writable（refPathsOf 覆盖），未列出的只读', () => {
  it('示例卡 check：8 条值路径（1.1 与 1.1.1 各自显式开着），且不含时间 0', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const prompt = await promptOf({ card, save, node: nodeOf(card, 'check') })

    expectWritableLines(prompt, [
      {
        path: '1.1.0',
        name: '区域',
        type: 'enum',
        values: ['晨风镇', '镇郊', '地牢', '官道', '码头'],
      },
      { path: '1.1.1', name: '地点', type: 'text' },
      { path: '1.2', name: '天气', type: 'enum', values: ['晴', '阴', '雨', '雪', '雾'] },
      { path: '1.3', name: '氛围', type: 'text' },
      { path: '2.1', name: '名字', type: 'text' },
      { path: '2.2', name: '体力', type: 'integer', min: 0, max: 100, stepMin: 1, stepMax: 10 },
      { path: '2.3', name: '状态', type: 'enum', values: ['正常', '受伤', '疲惫', '中毒'] },
      {
        path: '2.4',
        name: '背包',
        type: 'array',
        fields: [
          { name: '物品', type: 'text' },
          { name: '数量', type: 'integer', min: 0, max: 999 },
        ],
      },
    ])

    // `1.1.1` 上面那一行来自它自己的 ref：`1.1` 是标量（有孩子），不覆盖孩子
    const ownOnly = await promptOf({
      card,
      save,
      node: { ...nodeOf(card, 'check'), reads: [], writable: ['1.1'] },
    })
    expectWritableLines(ownOnly, [
      {
        path: '1.1.0',
        name: '区域',
        type: 'enum',
        values: ['晨风镇', '镇郊', '地牢', '官道', '码头'],
      },
    ])

    const paths = parsedLines(prompt).map((item) => item.path)
    expect(paths, 'check 的 writable 里没有时间').not.toContain('0')
    expect(writableSection(prompt), 'check 的 writable 里没有时间，不许提 advance_time').not.toContain(
      'advance_time',
    )
  })

  it('示例卡 check：8 条路径每一行都写明 JSON 值形态；2.2「体力」行明确是 JSON 整数', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const prompt = await promptOf({ card, save, node: nodeOf(card, 'check') })
    const lines = parsedLines(prompt)

    expect(
      lines.map((line) => line.path),
      '示例卡 check 的可写路径清单',
    ).toHaveLength(8)
    for (const line of lines) {
      expect(line.constraint, `${line.path} 这一行没写合法 JSON 值形态`).toMatch(
        /JSON 字符串|JSON 整数|JSON 数组/,
      )
    }

    const stamina = lines.find((line) => line.path === '2.2')
    expect(stamina, '示例卡 check 应当有 2.2「体力」这一行').toBeDefined()
    expect(stamina.name).toBe('体力')
    expect(stamina.constraint, '2.2「体力」的范围与步幅').toContain('整数 0..100，步幅 1..10')
    expectIntegerValueShape(stamina.constraint, '2.2「体力」行')
  })

  it('示例卡 output（type=output，writable 空）：整段不出现，连「无可写状态」都不留', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const prompt = await promptOf({ card, save, node: nodeOf(card, 'output') })

    expect(prompt, 'output 节点不许渲染 <可写状态> 标记').not.toContain(MARKER)
    expect(prompt, 'output 节点连「无可写状态」都不留').not.toContain('无可写状态')
    expect(prompt, 'output 节点也不留「未列出的状态只读」声明').not.toContain('未列出的状态')
    expect(prompt, 'output 节点照旧读得到状态').toContain(STATE_MARKER)
    expect(prompt, 'output 节点的节点提示词照旧在').toContain(NODE_MARKER)
  })

  it('普通节点 writable 为空：仍然出现 <可写状态>，正文说无可写状态 + 只读声明', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const node = { ...nodeOf(card, 'check'), reads: [], writable: [] }
    const prompt = await promptOf({ card, save, node })
    const block = writableSection(prompt)

    expect(
      prompt.split(MARKER).length - 1,
      '普通节点空 writable 仍要有一段（不许跟着 output 一起省略）',
    ).toBe(1)
    expect(block, '空 writable 的普通节点应当说没有可写状态').toMatch(/无可写状态|没有可写状态/)
    expect(block, '空 writable 的普通节点也要有只读声明').toContain('只读')
    expect(
      writableLines(prompt).filter((line) => line.startsWith('- ')),
      '空 writable 不许列任何写路径',
    ).toEqual([])
  })

  it('示例卡 time：writable 只有 0 ⇒ 一行，时间只能 advance_time 推进、不能 write_state', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const prompt = await promptOf({ card, save, node: nodeOf(card, 'time') })
    expectWritableLines(prompt, [{ path: '0', name: '时间', type: 'time' }])
  })

  it('读了时间但 writable 里没有 ⇒ 可写状态块里没有时间（状态块里仍然读得到时间）', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const node = {
      ...nodeOf(card, 'check'),
      reads: ['0', '1.2'],
      writable: ['1.2'],
    }
    const prompt = await promptOf({ card, save, node })
    expectWritableLines(prompt, [
      { path: '1.2', name: '天气', type: 'enum', values: ['晴', '阴', '雨', '雪', '雾'] },
    ])
    const stateSection = prompt.split('\n\n').find((block) => block.startsWith(STATE_MARKER))
    expect(stateSection, '读了时间，状态块里应当有时间那一行').toContain('- 0「时间」：')
    expect(
      parsedLines(prompt).map((item) => item.path),
      '只读时间不许进可写状态块',
    ).not.toContain('0')
    expect(writableSection(prompt)).not.toContain('advance_time')
  })

  it('writable 里是文字根 1（自身值 + 孩子）⇒ 只有自己的值 1.0，孩子一个都不列', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const node = { ...nodeOf(card, 'check'), reads: [], writable: ['1'] }
    const prompt = await promptOf({ card, save, node })
    expectWritableLines(prompt, [{ path: '1.0', name: '世界', type: 'text' }])
    const paths = parsedLines(prompt).map((item) => item.path)
    for (const child of ['1.1.0', '1.1.1', '1.2', '1.3']) {
      expect(paths, `1 是标量 ⇒ 孩子 ${child} 不在权限里`).not.toContain(child)
    }
  })

  it('writable 里是 object 父 code ⇒ 只有孩子，没有不存在的自身值 <code>.0', async () => {
    const card = v6Card()
    const node = { ...card.chain.find((item) => item.id === 'check'), reads: [], writable: ['1'] }
    const prompt = await promptOf({ card, save: v6Save(card), node })
    expectWritableLines(prompt, [
      { path: '1.1.0', name: '1.1', type: 'enum', values: ['A1', 'A2'] },
      { path: '1.1.1', name: '1.1.1', type: 'text' },
      { path: '1.2', name: '1.2', type: 'text' },
    ])
    expect(
      parsedLines(prompt).map((item) => item.path),
      'object 没有自身值，不许出现 1.0',
    ).not.toContain('1.0')
  })

  it('writable 里是 <code>.0 ⇒ 只覆盖那一格自身值，孩子不在权限里', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const node = { ...nodeOf(card, 'check'), reads: [], writable: ['1.1.0'] }
    const prompt = await promptOf({ card, save, node })
    expectWritableLines(prompt, [
      {
        path: '1.1.0',
        name: '区域',
        type: 'enum',
        values: ['晨风镇', '镇郊', '地牢', '官道', '码头'],
      },
    ])
    expect(
      parsedLines(prompt).map((item) => item.path),
      '.0 引用不许把孩子带进来',
    ).not.toContain('1.1.1')
  })
})

describe('可写状态块：与 reads 无关，writable 空 / 满各有各的形态', () => {
  it('reads 为空、节点提示词为空，只写 0 与 2.2 ⇒ 块里恰好两行（时间 + 整数）', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const node = {
      ...nodeOf(card, 'check'),
      reads: [],
      writable: ['0', '2.2'],
      prompt: '',
    }
    const prompt = await promptOf({ card, save, node })
    expectWritableLines(prompt, [
      { path: '0', name: '时间', type: 'time' },
      { path: '2.2', name: '体力', type: 'integer', min: 0, max: 100, stepMin: 1, stepMax: 10 },
    ])
    expect(prompt, '没读状态，就不该有状态块').not.toContain(STATE_MARKER)
    expect(prompt, '节点提示词为空，可写状态块照样生成').toContain(MARKER)
  })
})

describe('可写状态块：约束来自卡里的元素字段，不是示例卡硬编码', () => {
  it('自定义树：X/Y、-5..7、步幅 2..3、嵌套 object 全按字段展开；标量 1.1 只出自己的值，块里没有晨风镇', async () => {
    const card = antiHardcodeCard()
    const save = v6Save(card)
    const prompt = await promptOf({ card, save, node: nodeOf(card, 'check') })
    expectWritableLines(prompt, [
      { path: '1.1.0', name: '区域X', type: 'enum', values: ['X', 'Y'] },
      { path: '1.2.1', name: '数值X', type: 'integer', min: -5, max: 7, stepMin: 2, stepMax: 3 },
      { path: '1.2.2', name: '备注X', type: 'text' },
      { path: '1.2.3.1', name: '深层X', type: 'text' },
    ])
    expect(
      parsedLines(prompt).map((item) => item.path),
      '1.1 是标量（有孩子）⇒ 孩子 1.1.1 不在权限里',
    ).not.toContain('1.1.1')

    const block = writableSection(prompt)
    expect(block, '下拉白名单应当来自这张卡（X、Y）').toContain('X、Y')
    for (const sampleOnly of ['晨风镇', '镇郊', '地牢', '官道', '码头', '0..100', '步幅 1..10']) {
      expect(block, `块里出现了示例卡硬编码的 ${sampleOnly}`).not.toContain(sampleOnly)
    }
  })

  it('自定义树的 output 节点（writable 空）：整段不出现，读到的状态与历史照旧', async () => {
    const card = antiHardcodeCard()
    const save = v6Save(card)
    const prompt = await promptOf({ card, save, node: nodeOf(card, 'output') })

    expect(prompt, 'output 节点不许渲染 <可写状态>').not.toContain(MARKER)
    expect(prompt, 'output 节点不许留「无可写状态」').not.toContain('无可写状态')
    expect(prompt, 'output 节点不许留只读声明').not.toContain('未列出的状态')
    expect(prompt, 'output 读得到状态').toContain(STATE_MARKER)
    expect(prompt, '历史块照旧在').toContain(HISTORY_MARKER)
  })
})
