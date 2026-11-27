/**
 * 提示词 · 可写状态块（第 2 关契约；判据只认契约，不认实现）。
 *
 * 契约：每个节点的提示词里**恒有**一段自动生成的 `<可写状态>`，内容只由 `node.writable` 决定
 * （与 `node.reads` 无关，也不看节点类型 —— `output` 只是 writable 为空而已）：
 *
 *   · 一个引用展开成**值路径清单**（`pathsOf` 的口径）：元素 code ⇒ 自身值 + 整棵子树
 *     （有孩子的标量自身值住 `<code>.0`；`object` 没有自身值）；`<code>.0` ⇒ 只有这一格。
 *   · 每条值路径一行，行格式与状态段同形：`- <path>「<name>」：<约束>`；名字是元素的中文名。
 *   · 约束文案（语义就是契约，措辞可读但必须点名这四件事）：
 *       text    ⇒ `文本`
 *       enum    ⇒ `下拉`，并按卡里 `values` 的顺序列出全部白名单值
 *       integer ⇒ `整数 min..max，步幅 stepMin..stepMax`
 *       time    ⇒ `只能通过 advance_time 推进，不能 write_state`
 *   · `writable` 为空 ⇒ 块里没有一条写路径，正文说 `无可写状态`（无写能力）。
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
import { v6Card, v6Save } from './support/v6-fixtures.js'
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
    } else {
      throw new Error(`未知的期望类型：${spec.type}`)
    }
  })
}

describe('可写状态块：每个节点都有，位置在状态树之后', () => {
  it('示例卡的三个节点各自带一个 <可写状态>（输出节点也有，块里说无可写状态）', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    for (const id of ['time', 'check', 'output']) {
      const prompt = await promptOf({ card, save, node: nodeOf(card, id) })
      const hits = prompt.split(MARKER).length - 1
      expect(hits, `${id} 节点的提示词里 ${MARKER} 出现 ${hits} 次`).toBe(1)
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

describe('可写状态块：路径来自 node.writable（pathsOf 展开），未列出的只读', () => {
  it('示例卡 check：8 条值路径，父 1.1 展开成自身值 1.1.0 + 孩子 1.1.1，且不含时间 0', async () => {
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
      { path: '2.4', name: '携带', type: 'text' },
    ])

    const block = writableSection(prompt)
    expect(
      parsedLines(prompt).map((item) => item.path),
      'check 的 writable 里没有时间',
    ).not.toContain('0')
    expect(block, 'check 的 writable 里没有时间，不许提 advance_time').not.toContain('advance_time')
  })

  it('示例卡 output：writable 为空 ⇒ 无可写状态，读到的只读状态一条写路径都不列', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const prompt = await promptOf({ card, save, node: nodeOf(card, 'output') })
    const block = writableSection(prompt)

    expect(block, '空 writable 的块应当说没有可写状态').toMatch(/无可写状态|没有可写状态/)
    const pathLines = writableLines(prompt).filter((line) => line.startsWith('- '))
    expect(pathLines, 'output 读得到状态但 writable 为空，一块写路径都不许有').toEqual([])
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

  it('writable 里是父 code 1 ⇒ 展开成 1.0（自身值）+ 1.1.0 + 1.1.1 + 1.2 + 1.3', async () => {
    const card = sampleCard()
    const save = await sampleSave(card)
    const node = { ...nodeOf(card, 'check'), reads: [], writable: ['1'] }
    const prompt = await promptOf({ card, save, node })
    expectWritableLines(prompt, [
      { path: '1.0', name: '世界', type: 'text' },
      {
        path: '1.1.0',
        name: '区域',
        type: 'enum',
        values: ['晨风镇', '镇郊', '地牢', '官道', '码头'],
      },
      { path: '1.1.1', name: '地点', type: 'text' },
      { path: '1.2', name: '天气', type: 'enum', values: ['晴', '阴', '雨', '雪', '雾'] },
      { path: '1.3', name: '氛围', type: 'text' },
    ])
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
