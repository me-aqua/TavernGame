/**
 * 阶段 3 · 扩充：数组字段的**真读写权限**在编辑器里点得着（契约增补 §六）。
 *
 * 这一份量的是评审 F1 回炉后**玩家在界面上点得到**的那几件事：
 *   · 字段行（`2.4.1` / 嵌套 `2.4.2.1` / 穿数组的 `2.4.2.2.1`）都有读 / 写眼睛，不是被 v-if 藏掉；
 *   · 点字段眼睛 ⇒ `reads` / `writable` 里真的出现字段 code；保存成功（不再报悬空引用）；
 *   · 父行只有两态：满 / 未（父眼只认自己的 code，不看孩子）；点父行 = 全选 / 全反选；
 *   · 父引用已开时点字段 ⇒ 拆开父引用，真的关掉那一列（不是点不动的假眼睛）；
 *   · 模型拿字段写权限时，`write_state({path:'2.4.1', value:[...]})` 真的整列落盘。
 *
 * 判据只用既有 `data-*` 钩子；界面文案不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard, holdSave, nestedCard } from '../tests/support/array-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const readEye = (code) => `${row(code)} [data-eyes="read"]`
const writeEye = (code) => `${row(code)} [data-eyes="write"]`

/** 把 `check` 节点的两面眼睛换成给定清单（另一侧清空） */
function cardWithRefs(card, { reads = [], writable = [] } = {}) {
  return {
    ...card,
    chain: card.chain.map((node) => (node.id === 'check' ? { ...node, reads, writable } : node)),
  }
}

/** 开卡编辑器、选中判定节点（S1 才有眼睛） */
async function openEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
  await page.locator('[data-node-id="check"]').click()
}

/** 点保存并等结果出现；返回中文错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 盘上这张卡 `check` 节点的两面眼睛 */
async function storedRefs(page) {
  const cards = await readStorage(page, KEYS.cards)
  const check = cards[0].chain.find((node) => node.id === 'check')
  return { reads: check.reads, writable: check.writable }
}

test.describe('数组字段 · 编辑器眼睛', () => {
  test('字段行有读 / 写眼睛：点读 ⇒ reads 里出现 2.4.1，父 2.4 仍是 none，保存成功', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-field-eyes' }))
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4.1')), '字段行必须有读眼睛（不是 v-if 藏掉）').toHaveCount(1)
    await expect(page.locator(writeEye('2.4.1')), '字段行必须有写眼睛').toHaveCount(1)
    await expect(page.locator(readEye('2.4.1'))).toHaveAttribute('data-on', 'false')
    await expect(page.locator(readEye('2.4'))).toHaveAttribute('data-tri', 'none')

    await page.locator(readEye('2.4.1')).click()
    await expect(page.locator(readEye('2.4.1'))).toHaveAttribute('data-on', 'true')
    await expect(page.locator(readEye('2.4')), '父眼只认自己的 code ⇒ 仍 none').toHaveAttribute(
      'data-tri',
      'none',
    )
    await expect(page.locator(readEye('2')), '更上层也只看自己的 code').toHaveAttribute('data-tri', 'none')

    expect(await save(page), '字段引用必须是合法引用，保存不许报错').toBe(0)
    expect((await storedRefs(page)).reads).toEqual(['2.4.1'])
  })

  test('字段行写眼睛：点写 ⇒ writable 里出现 2.4.1，再点取消', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-field-write-eye' }))
    await openEditor(page, card)

    await page.locator(writeEye('2.4.1')).click()
    await expect(page.locator(writeEye('2.4.1'))).toHaveAttribute('data-on', 'true')
    await expect(page.locator(writeEye('2.4')), '父眼不看子引用').toHaveAttribute('data-tri', 'none')
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).writable).toEqual(['2.4.1'])

    await page.locator(writeEye('2.4.1')).click()
    await expect(page.locator(writeEye('2.4.1'))).toHaveAttribute('data-on', 'false')
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).writable).toEqual([])
  })

  test('容器写开 ⇒ 所有字段写眼睛亮、容器 all；拆开后父 none、另一列仍亮', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-container-write-eyes' }), { writable: ['2.4'] })
    await openEditor(page, card)

    await expect(page.locator(writeEye('2.4')), '容器写满').toHaveAttribute('data-tri', 'all')
    await expect(page.locator(writeEye('2.4.1')), '容器写授权这一列').toHaveAttribute('data-on', 'true')
    await expect(page.locator(writeEye('2.4.2')), '容器写授权这一列').toHaveAttribute('data-on', 'true')
    expect(await save(page), '容器引用本身合法').toBe(0)
    expect((await storedRefs(page)).writable).toEqual(['2.4'])

    await page.locator(writeEye('2.4.1')).click()
    await expect(page.locator(writeEye('2.4.1')), '拆开容器后这一列真的关掉').toHaveAttribute(
      'data-on',
      'false',
    )
    await expect(page.locator(writeEye('2.4.2')), '另一列仍是字段引用').toHaveAttribute('data-on', 'true')
    await expect(page.locator(writeEye('2.4')), '父眼只认自己的 code').toHaveAttribute('data-tri', 'none')
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).writable).toEqual(['2.4.2'])
  })

  test('父 on ⇒ 字段全亮；父 off ⇒ 字段全灭；父 off 后点字段 ⇒ 只存子引用、父 none', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-parent-on-off' }), {
      reads: ['2.4'],
      writable: ['2.4'],
    })
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4'))).toHaveAttribute('data-tri', 'all')
    await expect(page.locator(readEye('2.4.1')), '父 on ⇒ 字段读眼睛派生亮').toHaveAttribute(
      'data-on',
      'true',
    )
    await expect(page.locator(readEye('2.4.2'))).toHaveAttribute('data-on', 'true')
    await expect(page.locator(writeEye('2.4.1')), '父 on ⇒ 字段写眼睛派生亮').toHaveAttribute(
      'data-on',
      'true',
    )

    await page.locator(readEye('2.4')).click()
    await expect(page.locator(readEye('2.4')), '父全反选').toHaveAttribute('data-tri', 'none')
    await expect(page.locator(readEye('2.4.1')), '没有子引用 ⇒ 字段全灭').toHaveAttribute('data-on', 'false')
    await expect(page.locator(readEye('2.4.2'))).toHaveAttribute('data-on', 'false')

    await page.locator(readEye('2.4.1')).click()
    await expect(page.locator(readEye('2.4.1')), '父 off 后点字段 ⇒ 存子引用').toHaveAttribute(
      'data-on',
      'true',
    )
    await expect(page.locator(readEye('2.4')), '父眼仍 none').toHaveAttribute('data-tri', 'none')
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).reads).toEqual(['2.4.1'])

    await page.locator(writeEye('2.4')).click()
    await expect(page.locator(writeEye('2.4.1')), '父写全反选 ⇒ 字段写全灭').toHaveAttribute(
      'data-on',
      'false',
    )
    await page.locator(writeEye('2.4.2')).click()
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).writable).toEqual(['2.4.2'])

    const cards = await readStorage(page, KEYS.cards)
    const check = cards[0].chain.find((node) => node.id === 'check')
    expect(Object.keys(check).sort(), '数据里只有 reads / writable，没有显式 / 继承标记').toEqual([
      'historyTurns',
      'id',
      'name',
      'prompt',
      'reads',
      'readsUpstream',
      'type',
      'writable',
    ])
  })

  test('只开字段写 ⇒ 容器写 none（父眼不看子引用）', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-field-only-write-eyes' }), { writable: ['2.4.1'] })
    await openEditor(page, card)

    await expect(page.locator(writeEye('2.4.1'))).toHaveAttribute('data-on', 'true')
    await expect(page.locator(writeEye('2.4'))).toHaveAttribute('data-tri', 'none')
    await expect(page.locator(writeEye('2.4')), '字段引用不是整表写').not.toHaveAttribute('data-on', 'true')
  })

  test('父 none + 子全开：两列都开时容器仍是 none，字段 eyes 全亮', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-parent-none-child-all' }), {
      reads: ['2.4.1', '2.4.2'],
      writable: ['2.4.1', '2.4.2'],
    })
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4'))).toHaveAttribute('data-tri', 'none')
    await expect(page.locator(readEye('2.4.1'))).toHaveAttribute('data-on', 'true')
    await expect(page.locator(readEye('2.4.2'))).toHaveAttribute('data-on', 'true')
    await expect(page.locator(writeEye('2.4'))).toHaveAttribute('data-tri', 'none')
    await expect(page.locator(writeEye('2.4.1'))).toHaveAttribute('data-on', 'true')
    await expect(page.locator(writeEye('2.4.2'))).toHaveAttribute('data-on', 'true')
  })

  test('父行只有 all / none：点一列仍 none，点两列仍 none，点父行才 all', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-parent-tri' }))
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4'))).toHaveAttribute('data-tri', 'none')
    await page.locator(readEye('2.4.1')).click()
    await expect(page.locator(readEye('2.4')), '父眼不看子引用').toHaveAttribute('data-tri', 'none')
    await page.locator(readEye('2.4.2')).click()
    await expect(page.locator(readEye('2.4')), '子全开也不把父眼点亮').toHaveAttribute('data-tri', 'none')

    await page.locator(readEye('2.4')).click()
    await expect(page.locator(readEye('2.4')), '点父行 = 全选（自己的 code）').toHaveAttribute(
      'data-tri',
      'all',
    )
    await expect(page.locator(readEye('2.4.1')), '父 on 让字段 eyes 全亮').toHaveAttribute('data-on', 'true')
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).reads).toEqual(['2.4'])

    await page.locator(readEye('2.4')).click()
    await expect(page.locator(readEye('2.4')), '点父行 = 全反选').toHaveAttribute('data-tri', 'none')
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).reads).toEqual([])
  })

  test('父引用已开时点字段 ⇒ 拆开父引用，真的关掉这一列', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-split-parent' }), {
      reads: ['2.4'],
      writable: ['2.4'],
    })
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4.1'))).toHaveAttribute('data-on', 'true')
    await page.locator(readEye('2.4.1')).click()
    await expect(page.locator(readEye('2.4.1')), '这一列必须真的关掉').toHaveAttribute('data-on', 'false')
    await expect(page.locator(readEye('2.4')), '拆开后父眼 none').toHaveAttribute('data-tri', 'none')

    await page.locator(writeEye('2.4.2')).click()
    await expect(page.locator(writeEye('2.4.2'))).toHaveAttribute('data-on', 'false')
    await expect(page.locator(writeEye('2.4')), '拆开后父眼 none').toHaveAttribute('data-tri', 'none')

    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).reads).toEqual(['2.4.2'])
    expect((await storedRefs(page)).writable).toEqual(['2.4.1'])
  })

  test('更上层引用（2）也照同一条拆：只关这一列，2.4 里其余字段与 2 的兄弟都保住', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-split-ancestor' }), { reads: ['2'], writable: [] })
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4.1'))).toHaveAttribute('data-on', 'true')
    await page.locator(readEye('2.4.1')).click()
    await expect(page.locator(readEye('2.4.1'))).toHaveAttribute('data-on', 'false')
    expect(await save(page)).toBe(0)
    expect((await storedRefs(page)).reads, '祖先 2 换成「除 2.4.1 外的每一层兄弟」').toEqual([
      '2.1',
      '2.2',
      '2.3',
      '2.4.2',
    ])
  })

  test('对象祖先 2 的写不授权字段写：2.4.1 写眼睛 off（只有数组容器才派生）', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-object-ancestor-write' }), { writable: ['2'] })
    await openEditor(page, card)

    await expect(page.locator(writeEye('2')), '对象 code 自己是 all').toHaveAttribute('data-tri', 'all')
    await expect(page.locator(writeEye('2.4.1')), '对象祖先不是数组容器').toHaveAttribute('data-on', 'false')
    await expect(page.locator(writeEye('2.4')), '2.4 自己的 code 不在清单里').toHaveAttribute(
      'data-tri',
      'none',
    )
  })

  test('object 字段里的嵌套字段 2.4.2.1：两只眼睛都在、保存成功', async ({ page }) => {
    const card = cardWithRefs(nestedCard(), {})
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4.2.1'))).toHaveCount(1)
    await expect(page.locator(writeEye('2.4.2.1'))).toHaveCount(1)
    await page.locator(readEye('2.4.2.1')).click()
    await page.locator(writeEye('2.4.2.1')).click()
    await expect(page.locator(readEye('2.4')), '父眼只认自己的 code ⇒ none').toHaveAttribute(
      'data-tri',
      'none',
    )

    expect(await save(page)).toBe(0)
    expect(await storedRefs(page)).toMatchObject({
      reads: ['2.4.2.1'],
      writable: ['2.4.2.1'],
    })
  })

  test('穿嵌套数组的字段 2.4.2.2.1：两只眼睛都在、保存成功（不是只读藏写）', async ({ page }) => {
    const card = cardWithRefs(nestedCard(), {})
    await openEditor(page, card)

    await expect(page.locator(readEye('2.4.2.2.1'))).toHaveCount(1)
    await expect(page.locator(writeEye('2.4.2.2.1'))).toHaveCount(1)
    await page.locator(readEye('2.4.2.2.1')).click()
    await page.locator(writeEye('2.4.2.2.1')).click()

    expect(await save(page)).toBe(0)
    expect(await storedRefs(page)).toMatchObject({
      reads: ['2.4.2.2.1'],
      writable: ['2.4.2.2.1'],
    })
  })
})

test.describe('数组字段 · 模型链路', () => {
  /** 一个「真」预设：请求会被 `page.route` 拦掉，不联外网 */
  const REAL_PRESET = {
    id: 'p-real-field',
    name: 'real',
    provider: 'openai-compatible',
    baseUrl: 'https://api.example.invalid/v1',
    model: 'fake-model',
    apiKey: 'sk-test',
    reasoning: 'off',
  }

  /** OpenAI 形状的 SSE 帧 */
  function sseFrame(delta, finishReason = null) {
    return `data: ${JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'fake-model',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })}\n\n`
  }

  /** 只回一个工具调用 */
  function toolCallSse(name, args) {
    return (
      sseFrame({ role: 'assistant', content: '' }) +
      sseFrame({
        tool_calls: [
          { index: 0, id: 'call_1', type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      }) +
      sseFrame({}, 'tool_calls') +
      'data: [DONE]\n\n'
    )
  }

  /** 只回正文 */
  function textSse(text) {
    return sseFrame({ role: 'assistant', content: text }) + sseFrame({}, 'stop') + 'data: [DONE]\n\n'
  }

  test('按字段权限写：path 2.4.1 的数组整列落盘、item 数不变、别的字段不动', async ({ page }) => {
    const card = cardWithRefs(holdCard({ id: 'c-field-model-write' }), {
      reads: ['2.4'],
      writable: ['2.4.1'],
    })
    const save = holdSave(card, { id: 's-field-model-write' })
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [save],
        [KEYS.presets]: [REAL_PRESET],
        [KEYS.nodeModels]: {
          [card.id]: Object.fromEntries(card.chain.map((node) => [node.id, REAL_PRESET.id])),
        },
      },
    })

    let calls = 0
    await page.route('**/chat/completions', async (intercepted) => {
      calls += 1
      const payload =
        calls === 2
          ? toolCallSse('write_state', { path: '2.4.1', value: ['长弓', '火把', '盾'] })
          : textSse(calls === 1 ? 'OK' : 'STORY')
      await intercepted.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: payload,
      })
    })

    await page.goto(`${APP_PATH}${route.play(card.id, save.id)}`)
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    await page.locator('[data-action-input]').fill('act')
    await page.locator('[data-send]').click()

    await expect(page.locator('[data-line="narration"]')).toHaveCount(1, { timeout: 15_000 })
    await expect(page.locator('[data-error]')).toHaveCount(0)

    const saves = await readStorage(page, KEYS.saves)
    const stored = saves.find((item) => item.id === save.id).tree['2.4']
    expect(stored, '只改 2.4.1 这一列').toEqual([
      { '2.4.1': '长弓', '2.4.2': 1 },
      { '2.4.1': '火把', '2.4.2': 1 },
      { '2.4.1': '盾', '2.4.2': 3 },
    ])
    expect(stored, '不许增删 item').toHaveLength(3)
    expect(Object.keys(saves.find((item) => item.id === save.id).tree)).not.toContain('2.4.1')
  })
})
