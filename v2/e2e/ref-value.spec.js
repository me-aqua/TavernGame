/**
 * 阶段 4 · 引用（ref）的**值编辑器**（初始值 / 存档当前值，引用契约 §6 / §8.3）。
 *
 * 这一份量的是玩家在界面上点得到的那几件事：
 *   · 单引用：空 = null（没有「空手 / 未持有」这类名字）、行里显示投影字段不是裸 id、× 清空；
 *   · 单引用选择器：只列满足筛选的 item（银币不出现）、可按投影字段搜索、选中即写 id；
 *   · 多引用：`+ 添加引用` 追加一行、不产生空行、已选中的不可再选、行 × 删除、N / max 计数、
 *     到 max 添加禁用、删到最后一条 → null、低于 min 行内红字 + 保存被拦；
 *   · 源数组为空 / 筛选后无候选：min=0 存 null，min>0 保存被拦；
 *   · 存档编辑器：当前值用**当前数组**现算、同一套行构建器；非根没有当前值块；
 *   · 筛选 = 是：把已选 item 的可手持改成「否」⇒ 保存被拦、点名引用元素；
 *   · ref 带子元素：自身值住 `<code>.0`、自身为 null 时子元素不展示；
 *   · 删除被引用 item：删完仍合法 ⇒ 必须确认级联；会低于 min ⇒ 整笔拒绝并点名；
 *   · 没有预览面板、没有「空手」字样。
 *
 * 判据只用 `data-*` 钩子（钩子名见 `.team/test/2026-11-28/契约-阶段4-引用-UI.md` §二）。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { ID, refCard, refSave } from './support/ref-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const initialRow = (path) => `[data-initial-row="${path}"]`
const currentRow = (path) => `[data-current-tree-row="${path}"]`
const bag = '[data-array="2.4"]'

/** 开卡编辑器 */
async function openCard(page, card = refCard()) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

/** 开存档编辑器 */
async function openSave(page) {
  const card = refCard()
  const save0 = refSave(card)
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.saves]: [save0], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.editSave(save0.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

async function select(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator(`${row(code)}.selected, ${row(code)}[data-selected]`)).toHaveCount(1)
}

/** 选择器里此刻**可选**的候选 id（隐藏 / 置灰的都不算） */
async function candidateIds(page) {
  return page
    .locator('[data-ref-candidate]:not([disabled])')
    .evaluateAll((rows) => rows.map((item) => item.getAttribute('data-ref-candidate')))
}

/** 打开选择器并选一条（先断言它确实可选） */
async function pick(page, opener, id) {
  await page.locator(opener).click()
  await expect(page.locator('[data-ref-picker]')).toBeVisible()
  await page.locator(`[data-ref-candidate="${id}"]`).click()
  await expect(page.locator('[data-ref-picker]'), '选完要收起来').toHaveCount(0)
}

/** 点保存并等结果出现；返回错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

async function expectSaveBlocked(page, code, why = '') {
  expect(await save(page), `保存应当被拦${why === '' ? '' : `（${why}）`}：${code}`).toBeGreaterThan(0)
  await expect(page.locator('[data-save-errors]')).toContainText(code)
}

/** 根 `2` 的初始值表（卡模式） */
async function initialTable(page) {
  const card = (await readStorage(page, KEYS.cards))[0]
  return card.state.find((item) => item.code === '2').initial
}

/** 根 `2` 初始值表里的某一条值 */
async function initialOf(page, path) {
  return (await initialTable(page))[path]
}

/** 盘上那张卡的某个元素 */
async function elementOf(page, code) {
  const card = (await readStorage(page, KEYS.cards))[0]
  return card.state.find((item) => item.code === code)
}

test.describe('单引用（max = 1，§6.2）', () => {
  test('选中行显示投影字段（不是裸 id）；× 清空成 null', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    const scope = initialRow('2.5')

    await expect(page.locator(`${scope} [data-ref-row]`), '2.5 初始值是一条引用').toHaveCount(1)
    const text = await page.locator(`${scope} [data-ref-row]`).innerText()
    expect(text, '行里要显示投影字段').toContain('短剑')
    expect(text, '不许显示裸 id').not.toContain(ID.sword)
    await expect(page.locator(`${scope} [data-ref-add]`), 'max=1 没有添加引用').toHaveCount(0)

    await page.locator(`${scope} [data-ref-row-remove]`).click()
    await expect(page.locator(`${scope} [data-ref-row]`)).toHaveCount(0)
    await expect(page.locator(`${scope} [data-ref-choose]`), '空状态是「选择引用」').toBeVisible()

    expect(await save(page)).toBe(0)
    expect(await initialOf(page, '2.5'), '删掉最后一条 = null').toBe(null)
  })

  test('空状态点选择引用：只列筛选后的 item（银币不在）、可搜索、选中写 id；没有「空手」', async ({
    page,
  }) => {
    await openCard(page)
    await select(page, '2')
    const scope = initialRow('2.8')
    await page.locator(`${scope} [data-ref-choose]`).click()

    await expect(page.locator('[data-ref-picker]')).toBeVisible()
    expect(await candidateIds(page), '筛选 2.4.3 = 是：只有短剑 / 斗篷').toEqual([ID.sword, ID.cloak])
    const pickerText = await page.locator('[data-ref-picker]').innerText()
    expect(pickerText, '银币（可手持 = 否）不出现').not.toContain('银币')
    expect(pickerText, '候选要显示投影字段').toContain('短剑')

    // 按投影字段搜索
    await page.locator('[data-ref-picker-search]').fill('剑')
    expect(await candidateIds(page)).toEqual([ID.sword])
    await page.locator('[data-ref-picker-search]').fill('')
    expect(await candidateIds(page)).toEqual([ID.sword, ID.cloak])

    await page.locator(`[data-ref-candidate="${ID.cloak}"]`).click()
    await expect(page.locator('[data-ref-picker]')).toHaveCount(0)
    await expect(page.locator(`${scope} [data-ref-row]`)).toContainText('斗篷')

    const middle = await page.locator('[data-col="middle"]').innerText()
    expect(middle, '不发明「空手 / 未持有」这类名字').not.toMatch(/空手|未持有/)

    expect(await save(page)).toBe(0)
    expect(await initialOf(page, '2.8'), '选中后直接写 id').toBe(ID.cloak)
  })

  test('min 改 1 而值还是空：行内红字、保存被拦并点名 2.8', async ({ page }) => {
    await openCard(page)
    await select(page, '2.8')
    await page.locator('[data-ref-min]').fill('1')
    await select(page, '2')

    const scope = initialRow('2.8')
    await expectSaveBlocked(page, '2.8')
    await expect(page.locator(`${scope} [data-ref-error]`), '空值 + min=1 要行内报错').toBeVisible()
    expect(await initialOf(page, '2.8'), '校验失败不许写盘').toBe(null)
    expect((await elementOf(page, '2.8')).min, '校验失败不许写盘（定义也不动）').toBe(0)
  })
})

test.describe('多引用（max > 1，§6.3）', () => {
  test('添加引用：追加一行、不产生空行；已选中的不可再选；无筛选时列全部', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    const scope = initialRow('2.6')
    await expect(page.locator(`${scope} [data-ref-row]`), '2.6 初始值一条').toHaveCount(1)
    await expect(page.locator(`${scope} [data-ref-count]`)).toHaveText(/^\s*1\s*\/\s*3\s*$/)

    await page.locator(`${scope} [data-ref-add]`).click()
    await expect(page.locator('[data-ref-picker]')).toBeVisible()
    expect(await candidateIds(page), '无筛选：剩下两条都能选（已选中的置灰 / 隐藏）').toEqual([
      ID.sword,
      ID.coin,
    ])
    await expect(
      page.locator(`[data-ref-candidate="${ID.cloak}"]:not([disabled])`),
      '已选中的 item 不许再选',
    ).toHaveCount(0)

    await page.locator(`[data-ref-candidate="${ID.sword}"]`).click()
    await expect(page.locator('[data-ref-picker]')).toHaveCount(0)
    await expect(page.locator(`${scope} [data-ref-row]`)).toHaveCount(2)
    const texts = await page
      .locator(`${scope} [data-ref-row]`)
      .evaluateAll((rows) => rows.map((item) => item.innerText.trim()))
    expect(
      texts.every((text) => text !== ''),
      '不许出现空行',
    ).toBe(true)
    expect(texts[1]).toContain('短剑')

    expect(await save(page)).toBe(0)
    expect(await initialOf(page, '2.6'), '顺序保留').toEqual([ID.cloak, ID.sword])
  })

  test('到达 max 时添加禁用；行 × 删到最后一条 → null', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    const scope = initialRow('2.6')

    for (const id of [ID.sword, ID.coin]) await pick(page, `${scope} [data-ref-add]`, id)
    await expect(page.locator(`${scope} [data-ref-row]`)).toHaveCount(3)
    await expect(page.locator(`${scope} [data-ref-count]`)).toHaveText(/^\s*3\s*\/\s*3\s*$/)
    await expect(page.locator(`${scope} [data-ref-add]`), '到 max 就停').toBeDisabled()

    // 删中间那条：剩下的顺序是 斗篷 / 银币
    await page.locator(`${scope} [data-ref-row="2"] [data-ref-row-remove]`).click()
    await expect(page.locator(`${scope} [data-ref-row]`)).toHaveCount(2)
    const texts = await page
      .locator(`${scope} [data-ref-row]`)
      .evaluateAll((rows) => rows.map((item) => item.innerText))
    expect(texts[0]).toContain('斗篷')
    expect(texts[1]).toContain('银币')

    // 删空
    await page.locator(`${scope} [data-ref-row="1"] [data-ref-row-remove]`).click()
    await page.locator(`${scope} [data-ref-row="1"] [data-ref-row-remove]`).click()
    await expect(page.locator(`${scope} [data-ref-row]`)).toHaveCount(0)
    await expect(page.locator(`${scope} [data-ref-add]`), '删空之后又能加').toBeEnabled()

    expect(await save(page)).toBe(0)
    expect(await initialOf(page, '2.6'), '零条 = null').toBe(null)
  })

  test('低于 min：行内红字 + 保存被拦、点名 2.7', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    const scope = initialRow('2.7')
    await expect(page.locator(`${scope} [data-ref-row]`), '2.7 初始值两条（min = 2）').toHaveCount(2)

    await page.locator(`${scope} [data-ref-row="1"] [data-ref-row-remove]`).click()
    await expect(page.locator(`${scope} [data-ref-row]`)).toHaveCount(1)
    await expectSaveBlocked(page, '2.7')
    await expect(page.locator(`${scope} [data-ref-error]`), '少于 min 要行内红字').toBeVisible()
  })
})

test.describe('候选为空（§6.3 最后两条）', () => {
  test('源数组为空：选择器没有候选；min = 0 存 null', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    const scope = initialRow('2.11')
    await page.locator(`${scope} [data-ref-choose]`).click()
    await expect(page.locator('[data-ref-candidate]'), '源数组 2.10 是空的').toHaveCount(0)
    await expect(page.locator('[data-ref-picker-close]'), '选择器要能关掉').toBeVisible()
    await page.locator('[data-ref-picker-close]').click()
    await expect(page.locator('[data-ref-picker]')).toHaveCount(0)

    expect(await save(page)).toBe(0)
    expect(await initialOf(page, '2.11')).toBe(null)
  })

  test('筛选后无候选 + min > 0：保存被拦并提示至少需要几个', async ({ page }) => {
    await openCard(page)
    await select(page, '2.8')
    await page.locator('[data-ref-min]').fill('1')
    await page.locator('[data-ref-filter-field]').selectOption('2.4.2')
    await page.locator('[data-ref-filter-value]').fill('999')
    await select(page, '2')

    const scope = initialRow('2.8')
    await page.locator(`${scope} [data-ref-choose]`).click()
    await expect(page.locator('[data-ref-candidate]'), '没有数量 = 999 的 item').toHaveCount(0)
    await page.locator('[data-ref-picker-close]').click()

    await expectSaveBlocked(page, '2.8')
    await expect(page.locator('[data-save-errors]'), '要提示「没有可选 item / 至少 N 个」').toContainText(
      /没有可选|至少/,
    )
  })
})

test.describe('存档编辑器：当前值（§6.4）', () => {
  test('当前值用当前数组现算；同一套行构建器；写 save.tree 不动卡快照', async ({ page }) => {
    await openSave(page)
    await select(page, '2')
    const scope = currentRow('2.6')

    await expect(page.locator(`${scope} [data-ref-add]`), '当前值也是行构建器').toBeVisible()
    await expect(page.locator(`${scope} [data-ref-count]`)).toHaveText(/^\s*0\s*\/\s*3\s*$/)

    await page.locator(`${scope} [data-ref-add]`).click()
    await expect(page.locator('[data-ref-picker]')).toBeVisible()
    expect(await candidateIds(page), '候选来自当前数组（长弓在、斗篷不在）').toEqual([
      ID.sword,
      ID.bow,
      ID.coin,
    ])
    expect(await page.locator('[data-ref-picker]').innerText(), '卡快照里的斗篷不该出现').not.toContain(
      '斗篷',
    )

    await page.locator(`[data-ref-candidate="${ID.bow}"]`).click()
    await expect(page.locator('[data-ref-picker]')).toHaveCount(0)
    await expect(page.locator(`${scope} [data-ref-row]`)).toHaveCount(1)
    await expect(page.locator(`${scope} [data-ref-row]`)).toContainText('长弓')

    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
    const saved = (await readStorage(page, KEYS.saves))[0]
    expect(saved.tree['2.6'], '当前值落到 save.tree').toEqual([ID.bow])
    expect(
      saved.cardSnapshot.state.find((item) => item.code === '2').initial['2.6'],
      '卡快照的初始值一个字不动',
    ).toEqual([ID.cloak])
  })

  test('选中非根 ref：没有当前值块（规则不变）', async ({ page }) => {
    await openSave(page)
    await select(page, '2.5')

    await expect(
      page.locator('[data-current-tree], [data-current-value], [data-current-array]'),
      '非根元素不许有自己的当前值块',
    ).toHaveCount(0)
    await expect(
      page.locator('[data-ref-row], [data-ref-choose], [data-ref-add], [data-ref-error]'),
      '没有当前值块就没有值编辑器',
    ).toHaveCount(0)
    await expect(page.locator('[data-ref-source]'), '定义字段照常显示').toHaveCount(1)
  })
})

test.describe('筛选与保存校验（§8.2 / §8.3）', () => {
  test('筛选 = 是：把已选 item 的可手持改成否 ⇒ 保存被拦、点名 2.5', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    await page
      .locator(`${bag} [data-array-item][data-array-index="1"] [data-array-field="2.4.3"]`)
      .selectOption('否')

    await expectSaveBlocked(page, '2.5')
    const card = (await readStorage(page, KEYS.cards))[0]
    const items = card.state.find((item) => item.code === '2').initial['2.4']
    expect(items[0]['2.4.3'], '校验失败不许写盘').toBe('是')
  })

  test('删除被引用 item（删完仍合法）：必须显式确认，确认后清成 null', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    await page.locator(`${bag} [data-array-item][data-array-index="1"] [data-array-remove]`).click()

    await expect(page.locator('[data-confirm]'), '级联清引用要显式确认').toBeVisible()
    await expect(page.locator('[data-confirm]'), '确认文案要说清有引用被清').toContainText('引用')
    await page.locator('[data-confirm-ok]').click()

    await expect(page.locator(`${bag} [data-array-item]`)).toHaveCount(2)
    await expect(page.locator(`${initialRow('2.5')} [data-ref-row]`), '2.5 被清空').toHaveCount(0)
    expect(await save(page)).toBe(0)
    expect(await initialOf(page, '2.5')).toBe(null)
  })

  test('删除被引用 item（会低于 min）：整笔拒绝并点名 2.7', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    await page.locator(`${bag} [data-array-item][data-array-index="3"] [data-array-remove]`).click()

    await expect(page.locator('[data-delete-error]'), '拒绝删除要说出原因').toBeVisible()
    await expect(page.locator('[data-delete-error]')).toContainText('2.7')
    if ((await page.locator('[data-confirm]').count()) > 0) {
      await page.locator('[data-confirm-cancel]').click()
    }
    await expect(page.locator(`${bag} [data-array-item]`), '拒绝后 item 一个都不许少').toHaveCount(3)
    expect(await save(page)).toBe(0)
    expect(await initialOf(page, '2.7'), '引用值也没动').toEqual([ID.cloak, ID.coin])
  })
})

test.describe('ref 带子元素（§4.3 / 验收 #22）', () => {
  test('自身值住 <code>.0；自身为 null 时子元素不展示；选中后子元素出现', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    const own = initialRow('2.9.0')
    await expect(page.locator(`${own} [data-ref-choose]`), 'ref 自身值在 2.9.0').toBeVisible()
    await expect(page.locator(initialRow('2.9.1')), '自身为 null 时子元素不展示').toHaveCount(0)
    await expect(page.locator(initialRow('2.9.2'))).toHaveCount(0)
    await expect(page.locator(`${own} [data-ref-add]`), 'max=1：子元素不改变单值形状').toHaveCount(0)

    await page.locator(`${own} [data-ref-choose]`).click()
    expect(await candidateIds(page), '筛选照旧（银币不在）').toEqual([ID.sword, ID.cloak])
    await page.locator(`[data-ref-candidate="${ID.cloak}"]`).click()
    await expect(page.locator(`${own} [data-ref-row]`)).toContainText('斗篷')
    await expect(page.locator(initialRow('2.9.1')), '有目标之后子元素才出现').toBeVisible()
    await expect(page.locator(initialRow('2.9.2'))).toBeVisible()

    expect(await save(page)).toBe(0)
    const table = await initialTable(page)
    // 带子元素的 ref 在初始值表里是**扁平**的（`2.9.0` 自身值 + `2.9.1` / `2.9.2` 子元素）：
    // 值路径口径就是完整 code，钉「自身值落在 `.0` 上」。
    expect(table['2.9.0'], 'ref 自身值要落在 2.9.0').toBe(ID.cloak)
    expect(table['2.9.1'], '子元素仍然是子元素，不会被清掉').toBe('')
    expect(table['2.9.2']).toBe('')
  })
})

test.describe('没有预览、没有业务化空态（§6.1）', () => {
  test('卡编辑器里没有预览面板，也没有「空手 / 未持有」字样', async ({ page }) => {
    await openCard(page)
    await select(page, '2')
    await expect(page.locator('[data-ref-preview], [data-preview]'), '不许有预览面板').toHaveCount(0)
    const middle = await page.locator('[data-col="middle"]').innerText()
    expect(middle).not.toMatch(/空手|未持有/)

    await select(page, '2.5')
    await expect(page.locator('[data-ref-preview], [data-preview]'), '定义层也没有预览').toHaveCount(0)
    await expect(page.locator('[data-ref-source]')).toBeVisible()
  })
})
