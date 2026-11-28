/**
 * 读写覆盖对称（`.team/test/2026-11-28/契约-读写覆盖对称.md`）。
 *
 * 这一份钉三件事，全部只走**产品公开面**（`buildPrompt` / `applyWrite`）：
 *   1. 读投影：**标量元素（哪怕有孩子）只输出自己的值**；object 输出孩子、array 输出整份 item；
 *      读父标量**不抑制**单独读的子引用（`reads: ['1','1.2']` 两行都在）。
 *   2. 写授权：与读同一套容器口径 —— 标量只授权自己的值，object / array 授权全部后代；
 *      数组 item 字段里，标量字段只授权自己那一列、object / array 字段授权后代。
 *   3. 回归：object / array 整段读、字段引用只挑一格、`.0` 只出自身值 —— 这些旧行为不许翻面。
 *
 * ⚠️ 本票**不改**值路径口径（`pathsOf` / 初始值表 / 存档形状）；这里断言的是**权限覆盖**与提示词投影。
 * ⚠️ 期望值全部来自夹具（`support/coverage-fixtures.js`），不抄示例卡；红/绿都能指回契约节。
 */
import { describe, expect, it } from 'vitest'
import {
  bagItems,
  cardWithRefs,
  coverageCard,
  coverageSave,
  coverageTree,
} from './support/coverage-fixtures.js'
import { loadModule } from './support/load.js'

const loadPrompt = () => loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
const loadEngine = () => loadModule('core/engine.ts', () => import('../src/core/engine.ts'))

const STATE_MARKER = '<世界状态树>'
const WRITABLE_MARKER = '<可写状态>'

/** 一个只读的节点：读投影用 output（它不渲染可写段），写段用 normal */
function readerNode(reads) {
  return {
    id: 'reader',
    type: 'output',
    name: 'reader',
    reads,
    writable: [],
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
  }
}

function writerNode(writable) {
  return {
    id: 'writer',
    type: 'normal',
    name: 'writer',
    reads: [],
    writable,
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
  }
}

/** 拼提示词并返回状态段的非空行 */
async function stateLinesOf(reads) {
  const { buildPrompt } = await loadPrompt()
  const card = coverageCard()
  const prompt = buildPrompt({
    card,
    save: coverageSave(card),
    node: readerNode(reads),
    action: 'act one',
    outputs: {},
  })
  const block = prompt.split('\n\n').find((item) => item.startsWith(STATE_MARKER))
  if (block === undefined) return null
  return block
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '')
}

/** 一条状态行 `<code>`（`- <code>「<name>」：…`） */
function codeOf(line) {
  const match = /^- ([^\s「]+)「/.exec(line)
  expect(match, `状态行格式不对：${line}`).not.toBeNull()
  return match[1]
}

/** 一条状态行 `：` 后面的 JSON 正文 */
function payloadOf(line) {
  const at = line.indexOf('：')
  expect(at, `状态行缺少全角冒号：${line}`).toBeGreaterThan(0)
  return JSON.parse(line.slice(at + 1))
}

/** 提示词里某一段（`\n\n` 分块）的行（不含标记行） */
async function writablePathsOf(writable) {
  const { buildPrompt } = await loadPrompt()
  const card = coverageCard()
  const prompt = buildPrompt({
    card,
    save: coverageSave(card),
    node: writerNode(writable),
    action: 'act one',
    outputs: {},
  })
  const block = prompt.split('\n\n').find((item) => item.startsWith(WRITABLE_MARKER))
  expect(block, '非 output 节点的可写段必须出现').toBeTruthy()
  return block
    .split('\n')
    .slice(1)
    .filter((line) => line.startsWith('- '))
    .map((line) => codeOf(line))
}

/** 一个可写节点在给定 tree 上执行一次写入 */
async function writeOf(writable, path, value) {
  const { applyWrite } = await loadEngine()
  const card = cardWithRefs(coverageCard(), { writable })
  return applyWrite({ card, node: writerNode(writable), tree: coverageTree(card), path, value })
}

/** 写一条「应当被拒」的路径：错误码必须是 E_CHAIN（权限），不是 E_VALIDATION（值形状） */
async function expectChainRejected(writable, path, value) {
  await expect(writeOf(writable, path, value)).rejects.toMatchObject({ code: 'E_CHAIN' })
}

// ---------------------------------------------------------------------------
// 一、读投影：标量元素（含孩子）只输出自己的值
// ---------------------------------------------------------------------------

describe('读投影 · 标量元素（含孩子）只覆盖自己', () => {
  it('[R1] 读文字根 1（有孩子）⇒ 只有自己那一行、值是裸字符串', async () => {
    const lines = await stateLinesOf(['1'])
    expect(lines, '读 1 应当恰好一行（孩子不派生）').toHaveLength(1)
    expect(codeOf(lines[0])).toBe('1')
    expect(payloadOf(lines[0])).toBe('WORLD_OWN')
    expect(lines[0], '孩子一个都不许跟进来').not.toContain('REGION_OWN')
    expect(lines[0]).not.toContain('SITE_X')
    expect(lines[0]).not.toContain('WEATHER_SUN')
    expect(lines[0]).not.toContain('RING')
  })

  it('[R2] 读 `1` + 单独读孩子 `1.2` ⇒ 两行都在（父标量不抑制子行）', async () => {
    const lines = await stateLinesOf(['1', '1.2'])
    expect(lines.map(codeOf), '父在 + 子单独读 ⇒ 两行，顺序照状态树').toEqual(['1', '1.2'])
    expect(payloadOf(lines[0])).toBe('WORLD_OWN')
    expect(payloadOf(lines[1])).toBe('WEATHER_SUN')
  })

  it('[R3] 读 `1` + 单独读数组孩子的字段 `1.3.1` ⇒ `1` 自己一行、`1.3` 数组一行（不并进 1）', async () => {
    const lines = await stateLinesOf(['1', '1.3.1'])
    expect(lines.map(codeOf), '父标量不吞子数组').toEqual(['1', '1.3'])
    expect(payloadOf(lines[0])).toBe('WORLD_OWN')
    expect(payloadOf(lines[1]), '只选中字段 1.3.1').toEqual([{ id: 'id_1', item: 'RING' }])
  })

  it('[R4] 读 enum 元素 1.1（有孩子）⇒ 只有自己，孩子 1.1.1 不出现', async () => {
    const lines = await stateLinesOf(['1.1'])
    expect(lines).toHaveLength(1)
    expect(payloadOf(lines[0])).toBe('REGION_OWN')
    expect(lines[0]).not.toContain('SITE_X')
  })

  it('[R5] 读 `1.1` + 孩子 `1.1.1` ⇒ 两行都在', async () => {
    const lines = await stateLinesOf(['1.1', '1.1.1'])
    expect(lines.map(codeOf)).toEqual(['1.1', '1.1.1'])
    expect(payloadOf(lines[0])).toBe('REGION_OWN')
    expect(payloadOf(lines[1])).toBe('SITE_X')
  })

  it('[R6] 读普通元素 2.4（有孩子）⇒ 只有自己的值，`2.4.1` 不出现', async () => {
    const lines = await stateLinesOf(['2.4'])
    expect(lines).toHaveLength(1)
    expect(payloadOf(lines[0])).toBe('NOTE_OWN')
    expect(lines[0]).not.toContain('NOTE_DETAIL')
  })

  it('[R7] 读 `2.4` + `2.4.1` ⇒ 两行都在', async () => {
    const lines = await stateLinesOf(['2.4', '2.4.1'])
    expect(lines.map(codeOf)).toEqual(['2.4', '2.4.1'])
    expect(payloadOf(lines[0])).toBe('NOTE_OWN')
    expect(payloadOf(lines[1])).toBe('NOTE_DETAIL')
  })

  it('[R8] 读文字根 2（有孩子）⇒ 只有自己，孩子与数组都不出现', async () => {
    const lines = await stateLinesOf(['2'])
    expect(lines).toHaveLength(1)
    expect(payloadOf(lines[0])).toBe('PLAYER_OWN')
    expect(lines[0]).not.toContain('HERO')
    expect(lines[0]).not.toContain('SWORD')
    expect(lines[0]).not.toContain('NOTE_OWN')
  })

  it('[R11] 读父标量 `2` + 子 `2.4` ⇒ 两行都出（任务书原例：父不吞子）', async () => {
    const lines = await stateLinesOf(['2', '2.4'])
    expect(lines.map(codeOf), '父标量不抑制单独读的孩子').toEqual(['2', '2.4'])
    expect(payloadOf(lines[0])).toBe('PLAYER_OWN')
    expect(payloadOf(lines[1])).toBe('NOTE_OWN')
    expect(lines[1], '孩子那一行不许把孙辈也带进来').not.toContain('NOTE_DETAIL')
  })

  it('[R9] 读 `1` + `1.2` + `1.1.1`：行序照状态树，不照 reads 的顺序', async () => {
    const lines = await stateLinesOf(['1', '1.2', '1.1.1'])
    expect(lines.map(codeOf), '状态树顺序：1 在 1.1.1 前，1.1.1 在 1.2 前').toEqual(['1', '1.1.1', '1.2'])
    expect(payloadOf(lines[0])).toBe('WORLD_OWN')
    expect(payloadOf(lines[1])).toBe('SITE_X')
    expect(payloadOf(lines[2])).toBe('WEATHER_SUN')
  })

  it('[R10] 读 `.0` 仍然只出自身值，孩子不跟进来（旧行为）', async () => {
    const lines = await stateLinesOf(['1.0'])
    expect(lines, '读 `.0` 恰好一行').toHaveLength(1)
    expect(codeOf(lines[0]), '行里的编号是值路径').toBe('1.0')
    expect(payloadOf(lines[0])).toBe('WORLD_OWN')
    expect(lines[0]).not.toContain('REGION_OWN')
  })
})

// ---------------------------------------------------------------------------
// 二、读投影：object / array 容器整段（回归）
// ---------------------------------------------------------------------------

describe('读投影 · object / array 容器仍整段（回归）', () => {
  it('[C1] 读 object 3 ⇒ 孩子全在（中文名键、孩子里的 array 也整份）', async () => {
    const lines = await stateLinesOf(['3'])
    expect(lines).toHaveLength(1)
    expect(payloadOf(lines[0])).toEqual({
      lang: 'LANG_ZH',
      volume: 5,
      list: [{ id: 'id_1', entry: 'LIST_X' }],
      note: { ['自身']: 'CONFIG_NOTE', detail: 'CONFIG_DETAIL' },
    })
  })

  it('[C2] 读 object 3 + 孩子 3.1 ⇒ 仍只有容器一行（容器覆盖孩子）', async () => {
    const lines = await stateLinesOf(['3', '3.1'])
    expect(lines.map(codeOf)).toEqual(['3'])
    expect(payloadOf(lines[0]).lang).toBe('LANG_ZH')
  })

  it('[C3] 读 array 3.3 ⇒ 整份 item，不出现兄弟 3.1 / 3.2', async () => {
    const lines = await stateLinesOf(['3.3'])
    expect(lines.map(codeOf)).toEqual(['3.3'])
    expect(payloadOf(lines[0])).toEqual([{ id: 'id_1', entry: 'LIST_X' }])
  })

  it('[C4] 读 array 2.2 ⇒ 每个 item 的字段全在（含标量字段自己的值 + 孩子）', async () => {
    const lines = await stateLinesOf(['2.2'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])).toEqual([
      {
        id: 'id_1',
        item: 'SWORD',
        count: 1,
        note: { ['自身']: 'NOTE_N0', detail: 'DETAIL_D0' },
        tags: { kind: 'TAG_COMMON' },
        entries: [{ id: 'id_1', word: 'WORD_FIRE' }],
      },
      {
        id: 'id_2',
        item: 'SHIELD',
        count: 2,
        note: { ['自身']: 'NOTE_N1', detail: 'DETAIL_D1' },
        tags: { kind: 'TAG_RARE' },
        entries: [{ id: 'id_1', word: 'WORD_ICE' }],
      },
    ])
  })

  it('[C5] 读 array 2.2 + 字段引用 2.2.1 ⇒ 整段赢，只出一行', async () => {
    const lines = await stateLinesOf(['2.2', '2.2.1'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])[0].item).toBe('SWORD')
    expect(payloadOf(lines[0])[0].count).toBe(1)
  })

  it('[C6] 字段引用 2.2.1（叶子）⇒ 每个 item 只挑这一格', async () => {
    const lines = await stateLinesOf(['2.2.1'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])).toEqual([
      { id: 'id_1', item: 'SWORD' },
      { id: 'id_2', item: 'SHIELD' },
    ])
  })

  it('[C7] 字段引用 2.2.4（object）⇒ 每个 item 只挑这一格，孩子整段', async () => {
    const lines = await stateLinesOf(['2.2.4'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])).toEqual([
      { id: 'id_1', tags: { kind: 'TAG_COMMON' } },
      { id: 'id_2', tags: { kind: 'TAG_RARE' } },
    ])
  })

  it('[C8] 字段引用 2.2.5（array）⇒ 每个 item 只挑这一格，嵌套 item 整段', async () => {
    const lines = await stateLinesOf(['2.2.5'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])).toEqual([
      { id: 'id_1', entries: [{ id: 'id_1', word: 'WORD_FIRE' }] },
      { id: 'id_2', entries: [{ id: 'id_1', word: 'WORD_ICE' }] },
    ])
  })

  it('[C9] 字段引用 2.2.3.1（标量的孩子）⇒ 只挑这一格，不带父亲自己的值', async () => {
    const lines = await stateLinesOf(['2.2.3.1'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])).toEqual([
      { id: 'id_1', note: { detail: 'DETAIL_D0' } },
      { id: 'id_2', note: { detail: 'DETAIL_D1' } },
    ])
  })
})

// ---------------------------------------------------------------------------
// 三、读投影：数组 item 字段（标量只自己 / object·array 后代）
// ---------------------------------------------------------------------------

describe('读投影 · 数组 item 字段', () => {
  it('[F1] 字段引用 2.2.3（标量 + 孩子）⇒ 每个 item 只有自己的值', async () => {
    const lines = await stateLinesOf(['2.2.3'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])).toEqual([
      { id: 'id_1', note: 'NOTE_N0' },
      { id: 'id_2', note: 'NOTE_N1' },
    ])
    expect(JSON.stringify(payloadOf(lines[0]))).not.toContain('DETAIL_D0')
  })

  it('[F2] 字段引用 2.2.3 + 单独读孩子 2.2.3.1 ⇒ 两样都在（父标量不抑制孩子）', async () => {
    const lines = await stateLinesOf(['2.2.3', '2.2.3.1'])
    expect(lines.map(codeOf)).toEqual(['2.2'])
    expect(payloadOf(lines[0])).toEqual([
      { id: 'id_1', note: { ['自身']: 'NOTE_N0', detail: 'DETAIL_D0' } },
      { id: 'id_2', note: { ['自身']: 'NOTE_N1', detail: 'DETAIL_D1' } },
    ])
  })
})

// ---------------------------------------------------------------------------
// 四、可写段：路径来自权限覆盖（不是值路径全展开）
// ---------------------------------------------------------------------------

describe('可写段 · 标量只列自己的值，object / array 列后代', () => {
  it('[W1] writable 里是文字根 1 ⇒ 只有 1.0，孩子一个都不列', async () => {
    expect(await writablePathsOf(['1'])).toEqual(['1.0'])
  })

  it('[W2] writable 里是文字根 2 ⇒ 只有 2.0，孩子与数组都不列', async () => {
    expect(await writablePathsOf(['2'])).toEqual(['2.0'])
  })

  it('[W3] writable 里是 object 3 ⇒ 孩子 3.1 / 3.2 / 3.3 / 3.4.0 / 3.4.1（没有不存在的自身值）', async () => {
    expect(await writablePathsOf(['3'])).toEqual(['3.1', '3.2', '3.3', '3.4.0', '3.4.1'])
  })

  it('[W4] writable 里是 array 2.2 ⇒ 只有容器一行（整表写）', async () => {
    expect(await writablePathsOf(['2.2'])).toEqual(['2.2'])
  })

  it('[W5] writable 里是标量字段 2.2.3 ⇒ 只有这一列', async () => {
    expect(await writablePathsOf(['2.2.3'])).toEqual(['2.2.3'])
  })

  it('[W6] writable 里是 object 字段 2.2.4 ⇒ 只有这一列', async () => {
    expect(await writablePathsOf(['2.2.4'])).toEqual(['2.2.4'])
  })

  it('[W7] writable 里是 array 字段 2.2.5 ⇒ 只有这一列', async () => {
    expect(await writablePathsOf(['2.2.5'])).toEqual(['2.2.5'])
  })

  it('[W8] writable 里是 `1.3`（array 孩子）⇒ 只有它自己', async () => {
    expect(await writablePathsOf(['1.3'])).toEqual(['1.3'])
  })

  it('[W9] writable 里是 `2.4`（标量 + 孩子）⇒ 只有自己的值路径 2.4.0', async () => {
    expect(await writablePathsOf(['2.4'])).toEqual(['2.4.0'])
  })
})

// ---------------------------------------------------------------------------
// 五、写授权：与读同一套容器口径
// ---------------------------------------------------------------------------

describe('写授权 · 标量元素只授权自己的值', () => {
  it('[A1] `writable: [1]` + 写自己的值 1.0 ⇒ 收', async () => {
    const next = await writeOf(['1'], '1.0', 'NEW_WORLD')
    expect(next['1.0']).toBe('NEW_WORLD')
  })

  it('[A2] `writable: [1]` + 写孩子 1.2 ⇒ E_CHAIN（孩子不在覆盖里）', async () => {
    await expectChainRejected(['1'], '1.2', 'NEW_WEATHER')
  })

  it('[A3] `writable: [1]` + 写子数组 1.3（整表）⇒ E_CHAIN', async () => {
    await expectChainRejected(['1'], '1.3', [{ '1.3.1': 'X', '1.3.2': 1 }])
  })

  it('[A4] `writable: [1]` + 写子数组的字段 1.3.1 ⇒ E_CHAIN', async () => {
    await expectChainRejected(['1'], '1.3.1', ['X'])
  })

  it('[A5] `writable: [2]` + 写自己的值 2.0 ⇒ 收；写孩子 2.1 ⇒ E_CHAIN', async () => {
    const next = await writeOf(['2'], '2.0', 'NEW_PLAYER')
    expect(next['2.0']).toBe('NEW_PLAYER')
    await expectChainRejected(['2'], '2.1', 'NEW_HERO')
  })
})

describe('写授权 · object 容器覆盖全部孩子（含数组字段）', () => {
  it('[A6] `writable: [3]` + 写孩子 3.1 ⇒ 收', async () => {
    const next = await writeOf(['3'], '3.1', 'LANG_EN')
    expect(next['3.1']).toBe('LANG_EN')
  })

  it('[A7] `writable: [3]` + 写子数组 3.3（整表）⇒ 收', async () => {
    const next = await writeOf(['3'], '3.3', [{ '3.3.1': 'Y' }])
    expect(next['3.3'].map((item) => item['3.3.1'])).toEqual(['Y'])
  })

  it('[A8] `writable: [3]` + 写子数组的字段 3.3.1 ⇒ 收（object 覆盖整棵子树）', async () => {
    const next = await writeOf(['3'], '3.3.1', ['Y'])
    expect(next['3.3'].map((item) => item['3.3.1'])).toEqual(['Y'])
  })
})

describe('写授权 · array 容器覆盖所有 item 字段', () => {
  it('[A9] `writable: [2.2]` + 整表替换 ⇒ 收', async () => {
    const items = bagItems()
    const next = await writeOf(['2.2'], '2.2', items)
    expect(next['2.2']).toEqual(items)
  })

  it('[A10] `writable: [2.2]` + 写字段列 2.2.1 ⇒ 收', async () => {
    const next = await writeOf(['2.2'], '2.2.1', ['A', 'B'])
    expect(next['2.2'].map((item) => item['2.2.1'])).toEqual(['A', 'B'])
  })

  it('[A11] `writable: [2.2]` + 写标量字段的孩子列 2.2.3.1 ⇒ 收', async () => {
    const next = await writeOf(['2.2'], '2.2.3.1', ['X', 'Y'])
    expect(next['2.2'].map((item) => item['2.2.3']['2.2.3.1'])).toEqual(['X', 'Y'])
  })

  it('[A12] `writable: [2.2]` + 写字段列 2.2.3（自己的值 + 孩子）⇒ 收', async () => {
    const next = await writeOf(['2.2'], '2.2.3', [
      { '2.2.3.0': 'N0', '2.2.3.1': 'D0' },
      { '2.2.3.0': 'N1', '2.2.3.1': 'D1' },
    ])
    expect(next['2.2'][0]['2.2.3']).toEqual({ '2.2.3.0': 'N0', '2.2.3.1': 'D0' })
  })
})

describe('写授权 · 数组 item 字段：标量只自己，object / array 后代', () => {
  it('[A13] `writable: [2.2.3]`（标量 + 孩子）+ 写字段列 2.2.3 ⇒ 收（自己的值那一格）', async () => {
    const next = await writeOf(['2.2.3'], '2.2.3', [
      { '2.2.3.0': 'N0', '2.2.3.1': 'D0' },
      { '2.2.3.0': 'N1', '2.2.3.1': 'D1' },
    ])
    expect(next['2.2'][1]['2.2.3']['2.2.3.0']).toBe('N1')
  })

  it('[A14] `writable: [2.2.3]` + 写孩子字段 2.2.3.1 ⇒ E_CHAIN（标量字段不授权孩子）', async () => {
    await expectChainRejected(['2.2.3'], '2.2.3.1', ['X', 'Y'])
  })

  it('[A15] `writable: [2.2.4]`（object 字段）+ 写孩子字段 2.2.4.1 ⇒ 收', async () => {
    const next = await writeOf(['2.2.4'], '2.2.4.1', ['A', 'B'])
    expect(next['2.2'][0]['2.2.4']['2.2.4.1']).toBe('A')
    expect(next['2.2'][1]['2.2.4']['2.2.4.1']).toBe('B')
  })

  it('[A16] `writable: [2.2.5]`（array 字段）+ 写嵌套字段 2.2.5.1 ⇒ 收', async () => {
    // 值按数组层嵌套：外层每项一个数组（每项里是这个字段自己的那一层 item）
    const next = await writeOf(['2.2.5'], '2.2.5.1', [['A'], ['B']])
    expect(next['2.2'][0]['2.2.5'][0]['2.2.5.1']).toBe('A')
    expect(next['2.2'][1]['2.2.5'][0]['2.2.5.1']).toBe('B')
  })

  it('[A17] 字段列 2.2.1（叶子）⇒ 收（旧行为）', async () => {
    const next = await writeOf(['2.2.1'], '2.2.1', ['A', 'B'])
    expect(next['2.2'].map((item) => item['2.2.1'])).toEqual(['A', 'B'])
  })
})

describe('写授权 · `.0` 旧行为（回归）', () => {
  it('[A18] `writable: [2.4.0]` + 写自身值 ⇒ 收', async () => {
    const next = await writeOf(['2.4.0'], '2.4.0', 'NEW_NOTE')
    expect(next['2.4.0']).toBe('NEW_NOTE')
  })

  it('[A19] `writable: [2.4.0]` + 写孩子 2.4.1 ⇒ E_CHAIN', async () => {
    await expectChainRejected(['2.4.0'], '2.4.1', 'NEW_DETAIL')
  })
})
