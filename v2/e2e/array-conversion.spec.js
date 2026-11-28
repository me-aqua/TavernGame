/**
 * 阶段 3 · 数组转换到标量的**编辑器**（契约增补 `契约-阶段3-数组转换-标量与UI.md` §四）。
 *
 * 这一份量的是玩家在卡编辑器里点得到的那几件事：
 *   · 数组行的类型下拉恰好 text / integer / enum / array（没有 object / time / 结构体）；
 *   · 数组 → 文字 / 数字 / 下拉：>1 项先确认；取消一个字不动；确定后字段成孩子、
 *     第 1 项的值铺进去、容器自己的值在 `.0` 取默认；0 项不弹确认；数组 → 数组不弹；
 *   · 数组 → time 不可选；时间行的类型控件是模式选择器，没有 array；
 *   · 整数 item 的初始值行有 `[data-array-range]` 的 `min~max` 小字；空 min / max / step 合法；
 *   · item 卡第一行同时含第一字段与删除按钮，第一字段上方没有删除按钮撑出来的空行；
 *   · 存档编辑器里类型下拉对所有元素锁死。
 *
 * 判据只用 `data-*` 钩子；确认文案与界面措辞不在这里钉（只钉「是中文」）。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { holdCard, nestedCard } from '../tests/support/array-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const typeSelect = '[data-state-type]'

/** 根 `2` 的初始值表 */
function tableOf(card) {
  return card.state.find((item) => item.code === '2').initial
}

/** 换掉根 `2` 的整张初始值表 */
function withTable(card, table) {
  return {
    ...card,
    state: card.state.map((item) => (item.code === '2' ? { ...item, initial: table } : item)),
  }
}

/** 把某个元素的某一格换成给定值（其余原样） */
function withElement(card, code, change) {
  return { ...card, state: card.state.map((item) => (item.code === code ? { ...item, ...change } : item)) }
}

/** 去掉整数字段的 min / max / stepMin / stepMax（空范围） */
function withoutIntegerRange(card, code) {
  return {
    ...card,
    state: card.state.map((item) => {
      if (item.code !== code) return item
      const next = { ...item }
      delete next.min
      delete next.max
      delete next.stepMin
      delete next.stepMax
      return next
    }),
  }
}

/** 开卡编辑器、选中一个元素（类型下拉在中栏） */
async function openEditor(page, card, code = '2.4') {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await page.locator(row(code)).click()
  await expect(page.locator(typeSelect)).toBeVisible()
}

/** 类型下拉的每一档（value + 可见文字） */
async function typeOptions(page) {
  return page
    .locator(`${typeSelect} option`)
    .evaluateAll((options) =>
      options.map((option) => ({ value: option.value, text: option.textContent.trim() })),
    )
}

/** 点保存并等结果出现；返回中文错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 盘上第一张卡的某个元素 / 根初始值 */
async function stored(page, code) {
  const cards = await readStorage(page, KEYS.cards)
  const card = cards[0]
  return {
    card,
    element: card.state.find((item) => item.code === code),
    fields: card.state.filter((item) => item.code.startsWith('2.4.')).map((item) => item.code),
    table: tableOf(card),
  }
}

test.describe('数组行的类型下拉（增补 §四.1）', () => {
  test('恰好 text / integer / enum / array / ref；没有 object / time / 结构体', async ({ page }) => {
    await openEditor(page, holdCard({ id: 'c-conv-options' }))
    const options = await typeOptions(page)
    expect(
      options.map((option) => option.value),
      '数组行五档，顺序就是这五档',
    ).toEqual(['text', 'integer', 'enum', 'array', 'ref'])
    expect(options.map((option) => option.text)).toEqual(['文字', '数字', '下拉', '数组', '引用'])
    expect(options.map((option) => option.value)).not.toContain('object')
    expect(options.map((option) => option.value)).not.toContain('time')
    expect(options.map((option) => option.text)).not.toContain('结构体')
    expect(options.map((option) => option.text)).not.toContain('时间')
    await expect(page.locator(typeSelect)).toHaveValue('array')
  })

  test('任何元素的类型下拉都没有 object / 结构体', async ({ page }) => {
    await openEditor(page, holdCard({ id: 'c-conv-no-object' }))
    for (const code of ['0', '2', '2.1', '2.4', '2.4.1', '2.4.2']) {
      await page.locator(row(code)).click()
      const options = await typeOptions(page)
      expect(
        options.map((option) => option.value),
        `${code} 不许出现 object`,
      ).not.toContain('object')
      expect(
        options.map((option) => option.text),
        `${code} 不许出现结构体`,
      ).not.toContain('结构体')
    }
  })

  test('有字段的数组字段（item schema 里）也列五档（本票放开）', async ({ page }) => {
    await openEditor(page, nestedCard({ id: 'c-conv-field' }), '2.4.2.2')
    expect((await typeOptions(page)).map((option) => option.value)).toEqual([
      'text',
      'integer',
      'enum',
      'array',
      'ref',
    ])
  })

  test('没有字段的数组字段：五档；改回文字后每项取默认值、保存通过（往返契约 §6）', async ({ page }) => {
    await openEditor(page, holdCard({ id: 'c-conv-field-roundtrip' }), '2.4.1')

    // text 字段 → array：这是 0 字段的数组字段（中间态是坏卡，只活在草稿里）。
    await page.locator(typeSelect).selectOption('array')
    await expect(page.locator(typeSelect)).toHaveValue('array')
    await expect(page.locator('[data-confirm]'), '0 项不弹确认').toHaveCount(0)
    expect(
      (await typeOptions(page)).map((option) => option.value),
      '没有字段的数组字段也要能换回去（text / integer / enum / array / ref）',
    ).toEqual(['text', 'integer', 'enum', 'array', 'ref'])

    // 改回 text：每个外层 item 里的那一格回到空串；保存重新通过。
    await page.locator(typeSelect).selectOption('text')
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    await expect(page.locator(typeSelect)).toHaveValue('text')
    expect(await save(page)).toBe(0)

    const { card, element, table } = await stored(page, '2.4.1')
    expect(element.type).toBe('text')
    expect(
      card.state.some((item) => item.code.startsWith('2.4.1.')),
      '不凭空造孩子',
    ).toBe(false)
    expect(table['2.4'], '每一项回到 text 默认值').toEqual([
      { id: 'id_1', '2.4.1': '', '2.4.2': 1 },
      { id: 'id_2', '2.4.1': '', '2.4.2': 1 },
      { id: 'id_3', '2.4.1': '', '2.4.2': 3 },
    ])
    expect(table).not.toHaveProperty('2.4.1')
  })

  test('时间行的类型控件是三个模式，没有 array', async ({ page }) => {
    await openEditor(page, holdCard({ id: 'c-conv-time' }), '0')
    const options = await typeOptions(page)
    expect(options.map((option) => option.value)).toEqual(['year-minute', 'year-date', 'days-minute'])
    expect(options.map((option) => option.value)).not.toContain('array')
  })
})

test.describe('数组 → 文字（增补 §四.2）', () => {
  test('3 项先弹确认；取消不动；确定后字段成孩子、第 1 项铺进去、own `.0` 默认空串、其余丢弃', async ({
    page,
  }) => {
    const card = holdCard({ id: 'c-conv-text' })
    await openEditor(page, card)

    await page.locator(typeSelect).selectOption('text', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]'), '>1 项必须先弹确认').toBeVisible()
    await expect(page.locator('[data-confirm]')).toContainText(/[\u4e00-\u9fff]/)
    await expect(page.locator('[data-confirm]'), '文案要说清丢几项').toContainText('2')
    await page.locator('[data-confirm-cancel]').click()
    await expect(page.locator(typeSelect)).toHaveValue('array')
    expect(await save(page)).toBe(0)
    expect((await stored(page, '2.4')).table['2.4']).toHaveLength(3)

    await page.locator(typeSelect).selectOption('text', { timeout: 3_000 })
    await page.locator('[data-confirm-ok]').click()
    await expect(page.locator(typeSelect)).toHaveValue('text')
    expect(await save(page)).toBe(0)

    const { card: saved, element, fields, table } = await stored(page, '2.4')
    expect(element.type).toBe('text')
    expect(fields, '字段定义一个都不许少 / 不许改名').toEqual(['2.4.1', '2.4.2'])
    expect(saved.chain).toEqual(card.chain)
    expect(table['2.4.0'], 'own 值在 `.0`，默认空串').toBe('')
    expect(table['2.4.1']).toBe('短剑')
    expect(table['2.4.2']).toBe(1)
    expect(table).not.toHaveProperty('2.4')
    expect(JSON.stringify(table), '第 2 / 3 项必须丢弃').not.toContain('斗篷')
  })

  test('0 项：不弹确认；字段默认值 + own `.0` 默认空串', async ({ page }) => {
    const card = withTable(holdCard({ id: 'c-conv-empty' }), { ...tableOf(holdCard()), 2.4: [] })
    await openEditor(page, card)
    await page.locator(typeSelect).selectOption('text', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    expect(await save(page)).toBe(0)

    const { element, table } = await stored(page, '2.4')
    expect(element.type).toBe('text')
    expect(table['2.4.0']).toBe('')
    expect(table['2.4.1']).toBe('')
    expect(table['2.4.2']).toBe(0)
    expect(table).not.toHaveProperty('2.4')
  })
})

test.describe('数组 → 数字 / 下拉（增补 §四.2）', () => {
  test('数字：1 项不弹确认；own `.0` = 0；孩子取第 1 项', async ({ page }) => {
    const card = withTable(holdCard({ id: 'c-conv-int' }), {
      ...tableOf(holdCard()),
      2.4: [{ id: 'id_1', '2.4.1': '长弓', '2.4.2': 7 }],
    })
    await openEditor(page, card)
    await page.locator(typeSelect).selectOption('integer', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    expect(await save(page)).toBe(0)

    const { element, table } = await stored(page, '2.4')
    expect(element.type).toBe('integer')
    expect(table['2.4.0']).toBe(0)
    expect(table['2.4.1']).toBe('长弓')
    expect(table['2.4.2']).toBe(7)
    expect(table).not.toHaveProperty('2.4')
  })

  test('下拉：可选项可达；白名单保留时 own `.0` = 第一项', async ({ page }) => {
    const base = holdCard({ id: 'c-conv-enum' })
    const card = withTable(withElement(base, '2.4', { values: ['甲', '乙'] }), {
      ...tableOf(base),
      2.4: [{ id: 'id_1', '2.4.1': '短剑', '2.4.2': 1 }],
    })
    await openEditor(page, card)
    await page.locator(typeSelect).selectOption('enum', { timeout: 3_000 })
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    await expect(page.locator(typeSelect)).toHaveValue('enum')
    expect(await save(page)).toBe(0)

    const { element, table } = await stored(page, '2.4')
    expect(element.type).toBe('enum')
    expect(element.values).toEqual(['甲', '乙'])
    expect(table['2.4.0']).toBe('甲')
    expect(table['2.4.1']).toBe('短剑')
    expect(table).not.toHaveProperty('2.4')
  })
})

test.describe('数组 → 数组（增补 §3.3）', () => {
  test('选 array 不弹确认、保存后一个字节不变', async ({ page }) => {
    const card = holdCard({ id: 'c-conv-noop' })
    await openEditor(page, card)
    const before = JSON.stringify((await readStorage(page, KEYS.cards))[0])

    await page.locator(typeSelect).selectOption('array')
    await expect(page.locator('[data-confirm]')).toHaveCount(0)
    await expect(page.locator(typeSelect)).toHaveValue('array')
    expect(await save(page)).toBe(0)
    expect(JSON.stringify((await readStorage(page, KEYS.cards))[0])).toBe(before)
  })
})

test.describe('整数 item 的初始值行（增补 §4.4）', () => {
  test('每个 item 的整数字段显示 `min~max`，取自 integerRangeOf', async ({ page }) => {
    const card = withElement(holdCard({ id: 'c-conv-range' }), '2.4.2', { min: 1, max: 9 })
    await openEditor(page, card, '2')

    await expect(page.locator('[data-array-item]')).toHaveCount(3)
    await expect(page.locator('[data-array-range]')).toHaveCount(3)
    const first = page.locator('[data-array-item]').first()
    await expect(first.locator('[data-array-range]')).toHaveText('1~9')

    const geometry = await first.evaluate((item) => {
      const input = item.querySelector('[data-array-field="2.4.2"]')
      const hint = item.querySelector('[data-array-range]')
      if (!input || !hint) return null
      const a = input.getBoundingClientRect()
      const b = hint.getBoundingClientRect()
      return { inputRight: a.right, hintLeft: b.left, hintTop: b.top, inputTop: a.top }
    })
    expect(geometry).not.toBeNull()
    expect(geometry.hintLeft, '小字在输入框右边').toBeGreaterThanOrEqual(geometry.inputRight - 1)
    expect(Math.abs(geometry.hintTop - geometry.inputTop), '小字与输入框同一行').toBeLessThanOrEqual(4)
  })

  test('min / max / step 为空也合法：缺省范围照常显示、保存通过', async ({ page }) => {
    const card = withoutIntegerRange(holdCard({ id: 'c-conv-empty-range' }), '2.4.2')
    await openEditor(page, card, '2')
    await expect(page.locator('[data-array-range]').first()).toHaveText('-1000000000~1000000000')

    await page.locator(row('2.4.2')).click()
    for (const field of ['min', 'max', 'step-min', 'step-max']) {
      await expect(page.locator(`[data-field="${field}"]`), `${field} 留空`).toHaveValue('')
    }
    expect(await save(page)).toBe(0)
  })
})

test.describe('item 卡顶部与删除按钮（增补 §4.3）', () => {
  test('删除按钮与第一字段同一行、不是绝对定位；第一字段上方没有空行', async ({ page }) => {
    await openEditor(page, holdCard({ id: 'c-conv-item-card' }), '2')
    const rows = await page.locator('[data-array-item]').evaluateAll((items) =>
      items.map((item) => {
        const name = item.querySelector('[data-array-field-name]')
        const remove = item.querySelector('[data-array-remove]')
        if (!name || !remove) return { missing: true }
        const rect = (element) => {
          const box = element.getBoundingClientRect()
          return {
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            height: box.height,
            cy: box.top + box.height / 2,
          }
        }
        let line = name
        while (line && line !== item && !line.contains(remove)) line = line.parentElement
        return {
          item: rect(item),
          name: rect(name),
          remove: rect(remove),
          removeCount: item.querySelectorAll('[data-array-remove]').length,
          position: remove.ownerDocument.defaultView.getComputedStyle(remove).position,
          line: line
            ? { ...rect(line), names: line.querySelectorAll('[data-array-field-name]').length }
            : null,
        }
      }),
    )

    expect(rows).toHaveLength(3)
    for (const [index, one] of rows.entries()) {
      expect(one.missing, `第 ${index + 1} 项要有第一字段与删除按钮`).toBeUndefined()
      expect(one.removeCount, `第 ${index + 1} 项恰好一个删除按钮`).toBe(1)
      expect(one.position, '删除按钮不是绝对 / 固定定位').not.toMatch(/absolute|fixed/)
      expect(one.name.top - one.item.top, '第一字段上方没有删除按钮撑出来的空行').toBeLessThanOrEqual(10)
      expect(one.line, '第一字段与删除按钮要有共同的行').not.toBeNull()
      expect(one.line.names, '共同的行只含第一字段').toBe(1)
      expect(one.line.height, '共同祖先是一行，不是整张卡').toBeLessThanOrEqual(40)
      expect(Math.abs(one.remove.cy - one.name.cy), '删除按钮与第一字段垂直对齐').toBeLessThanOrEqual(4)
      expect(one.remove.top < one.name.bottom && one.remove.bottom > one.name.top, '同一行相交').toBe(true)
    }
  })
})

test.describe('存档编辑器：类型锁死（结构冻结）', () => {
  test('选中数组 / 文本元素，类型下拉都 disabled', async ({ page }) => {
    const card = holdCard({ id: 'c-conv-save' })
    const save = {
      schemaVersion: 1,
      id: 's-conv-save',
      cardId: card.id,
      cardSnapshot: JSON.parse(JSON.stringify(card)),
      name: 'save',
      turn: 0,
      tree: {
        0: { year: 2024, month: 2, day: 10, hour: 8, minute: 30 },
        1.1: 'A1',
        2.1: '旅人',
        2.2: 80,
        2.3: '正常',
        2.4: [{ id: 'id_1', '2.4.1': '短剑', '2.4.2': 1 }],
      },
      events: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    await boot(page, {
      storage: { [KEYS.cards]: [card], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
      hash: route.editSave(save.id),
    })
    await expect(page.locator('[data-page="editor"]')).toBeVisible()

    await page.locator(row('2.4')).click()
    await expect(page.locator(typeSelect), '存档编辑器里数组类型必须锁死').toBeDisabled()

    await page.locator(row('2.1')).click()
    await expect(page.locator(typeSelect), '存档编辑器里所有类型都必须锁死').toBeDisabled()
  })
})
