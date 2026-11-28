/**
 * 阶段 4 · 引用（ref）的**定义层** UI（引用契约 `.team/leader/2026-11-28/阶段4-引用-契约草案.md` §5 / §9）。
 *
 * 这一份量的是作者在界面上点得到的定义动作：
 *   · 非时间元素的类型下拉里有「引用」；时间行仍是三档模式选择器；`object` 不是可选目标；
 *   · 引用自：只列数组（非数组一律不可选）、显示层级路径、可搜索；切源清空字段与筛选；
 *   · 引用字段：只列直接标量字段（text / integer / enum），至少一个，勾选顺序 = 保存顺序；
 *   · 筛选（可选）：单字段等值，值控件跟字段类型走，清空 = 不筛选，不做 AND / OR；
 *   · min / max：整数、默认 0 / 1、`0<=min<=max`、`1<=max<=999`，非法组合保存被拦并点名；
 *   · `max=1` 单值编辑器 / `max>1` 多值行构建器；
 *   · 源不能是自己所在的数组（防递归）。
 *
 * 判据只用 `data-*` 钩子（钩子名见 `.team/test/2026-11-28/契约-阶段4-引用-UI.md` §二）；
 * 界面文案不在这里钉，只有错误要点名元素 code。
 */
import { expect, test } from '@playwright/test'
import { KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { defCard, refCard } from './support/ref-fixtures.js'

const row = (code) => `[data-state-item="${code}"]`
const typeSelect = '[data-state-type]'
const source = '[data-ref-source]'
const sourceSearch = '[data-ref-source-search]'
const filterField = '[data-ref-filter-field]'
const filterValue = '[data-ref-filter-value]'
const minInput = '[data-ref-min]'
const maxInput = '[data-ref-max]'
const fieldBox = (code) => `[data-ref-field="${code}"]`
const initialRow = (path) => `[data-initial-row="${path}"]`

/** 开卡编辑器（卡 + mock 预设），等状态树出来 */
async function openEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

/** 选中一个状态元素 */
async function select(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator(`${row(code)}.selected, ${row(code)}[data-selected]`)).toHaveCount(1)
}

/** 类型下拉的每一档（value） */
async function typeOptions(page) {
  return page.locator(`${typeSelect} option`).evaluateAll((options) => options.map((option) => option.value))
}

/**
 * 把一个元素换成「引用」：契约 §九 要求先弹警告，所以这里必须看见 `[data-confirm]` 再确定。
 * 换完断言中栏真的变成引用定义（`[data-ref-source]` 在）。
 */
async function switchToRef(page, code) {
  await select(page, code)
  await expect(page.locator(`${typeSelect} option[value="ref"]`), `${code} 的类型下拉里要有引用`).toHaveCount(
    1,
  )
  await page.locator(typeSelect).selectOption('ref')
  await expect(page.locator('[data-confirm]'), '换成引用要先弹警告（契约 §九）').toBeVisible()
  await page.locator('[data-confirm-ok]').click()
  await expect(page.locator(typeSelect)).toHaveValue('ref')
  await expect(page.locator(source), `${code} 换完之后要显示引用定义`).toBeVisible()
}

/** 引用自：可选的数组 code（只读「没被置灰」的那些；空占位不算） */
async function sourceCodes(page) {
  const options = await page
    .locator(`${source} option`)
    .evaluateAll((all) => all.map((option) => ({ value: option.value, disabled: option.disabled })))
  return options.filter((option) => option.value !== '' && !option.disabled).map((option) => option.value)
}

/** 引用字段勾选框的 code（按 DOM 顺序） */
async function fieldCodes(page) {
  return page
    .locator('[data-ref-field]')
    .evaluateAll((all) => all.map((box) => box.getAttribute('data-ref-field')))
}

/** 筛选值控件此刻长什么样：`select` / `input` + type */
async function filterShape(page) {
  return page.locator(filterValue).evaluate((el) => {
    const tag = el.tagName.toLowerCase()
    return { tag, type: tag === 'input' ? (el.getAttribute('type') ?? 'text') : null }
  })
}

/** 设一条筛选（字段 + 值）；值控件可能是下拉也可能是输入框 */
async function setFilter(page, field, value) {
  await page.locator(filterField).selectOption(field)
  const control = page.locator(filterValue)
  const { tag } = await filterShape(page)
  if (tag === 'select') await control.selectOption(String(value))
  else await control.fill(String(value))
}

/** 点保存并等结果出现；返回错误清单条数（0 = 成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 保存必须被拦，且错误清单点名这个元素 code */
async function expectSaveBlocked(page, code, why = '') {
  expect(await save(page), `保存应当被拦${why === '' ? '' : `（${why}）`}：${code}`).toBeGreaterThan(0)
  await expect(page.locator('[data-save-errors]')).toContainText(code)
}

/** 盘上那张卡的某个元素 */
async function elementOf(page, code) {
  const card = (await readStorage(page, KEYS.cards))[0]
  return card.state.find((item) => item.code === code)
}

test.describe('类型下拉：引用是可选类型（§5 / §9.2）', () => {
  test('非时间元素有「引用」；没有 time / object；时间行仍是三档模式', async ({ page }) => {
    await openEditor(page, defCard())
    for (const code of ['1.1', '2.1', '2.2', '2.3', '2.4']) {
      await select(page, code)
      const values = await typeOptions(page)
      expect(values, `${code} 的类型下拉要有引用`).toContain('ref')
      expect(values, `${code} 不许出现 time`).not.toContain('time')
      expect(values, `${code} 不许出现 object`).not.toContain('object')
    }

    // 导入的 object 行：`object` 不是可选目标（结构体 = 有孩子的形态）
    await select(page, '2')
    const objectRow = await typeOptions(page)
    expect(objectRow, 'object 行不许把 object 当可选目标').not.toContain('object')
    expect(objectRow).not.toContain('time')

    // 时间行：还是三个模式，没有 ref，也没有引用定义块
    await select(page, '0')
    const timeRow = await typeOptions(page)
    expect(timeRow).toEqual(['year-minute', 'year-date', 'days-minute'])
    expect(timeRow).not.toContain('ref')
    await expect(page.locator(source), '时间行没有引用定义').toHaveCount(0)
  })
})

test.describe('引用自：只列数组 + 层级路径 + 搜索（§5.1）', () => {
  test('只有数组节点可选；文字 / 数字 / 下拉 / 对象 / 时间全部不可选', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')

    // 数组字段（`2.4.5` 附魔）也是数组节点 ⇒ 可选（引用契约 §8.4 点名「直接引用 2.4.2 这种嵌套数组」）
    expect(await sourceCodes(page), '可选源恰好是全部数组节点（含嵌套数组字段）').toEqual([
      '2.4',
      '2.4.5',
      '2.6',
      '2.7',
      '2.8',
    ])
    for (const code of ['0', '1', '2', '2.1', '2.2', '2.3', '2.4.1', '2.5']) {
      expect(await sourceCodes(page), `${code} 不是数组，不许可选`).not.toContain(code)
    }

    // 层级路径显示：编号 + 中文名
    const text = await page.locator(`${source} option[value="2.4"]`).textContent()
    expect(text).toContain('2.4')
    expect(text).toContain('背包')
  })

  test('引用自可搜索（按编号 / 名字），清空恢复全部数组', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')

    const search = page.locator(sourceSearch)
    await expect(search, '引用自要能搜').toBeVisible()
    await search.fill('背包')
    expect(await sourceCodes(page)).toEqual(['2.4'])
    await search.fill('2.6')
    expect(await sourceCodes(page)).toEqual(['2.6'])
    await search.fill('zzz')
    expect(await sourceCodes(page), '搜不到就一个都不给').toEqual([])
    await search.fill('')
    expect(await sourceCodes(page)).toEqual(['2.4', '2.4.5', '2.6', '2.7', '2.8'])
  })
})

test.describe('引用字段：只列直接标量字段（§5.2）', () => {
  test('只列 text / integer / enum 的直接子字段；勾选顺序 = 保存顺序', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')
    await page.locator(source).selectOption('2.4')

    expect(await fieldCodes(page), '对象 / 数组字段不列，孙辈也不列').toEqual(['2.4.1', '2.4.2', '2.4.3'])
    for (const code of ['2.4.3', '2.4.1', '2.4.2']) await page.locator(fieldBox(code)).check()

    expect(await save(page)).toBe(0)
    const ref = await elementOf(page, '2.5')
    expect(ref.type).toBe('ref')
    expect(ref.refSource).toBe('2.4')
    expect(ref.refFields, '勾选顺序要原样保留').toEqual(['2.4.3', '2.4.1', '2.4.2'])
    expect(ref.min).toBe(0)
    expect(ref.max).toBe(1)
    expect('refFilter' in ref, '没选筛选就不写 refFilter').toBe(false)
  })

  test('一个字段都不勾：保存被拦、点名 2.5', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')
    await page.locator(source).selectOption('2.4')
    await expectSaveBlocked(page, '2.5')
  })

  test('切源：清空已勾字段与筛选，min / max 不动', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')
    await page.locator(source).selectOption('2.4')
    await page.locator(fieldBox('2.4.1')).check()
    await setFilter(page, '2.4.3', '是')
    await expect(page.locator(filterValue)).toHaveValue('是')

    await page.locator(source).selectOption('2.6')
    expect(await fieldCodes(page), '新源的字段表').toEqual(['2.6.1'])
    await expect(page.locator(fieldBox('2.6.1')), '旧源勾的字段要清掉').not.toBeChecked()
    await expect(page.locator(filterField), '筛选字段要清空').toHaveValue('')
    await expect(page.locator(filterValue), '清空筛选字段 = 不筛选').toHaveCount(0)
    await expect(page.locator(minInput), 'min 不动').toHaveValue('0')
    await expect(page.locator(maxInput), 'max 不动').toHaveValue('1')
  })
})

test.describe('筛选：单字段等值（§5.3）', () => {
  test('值控件跟字段类型走：enum 下拉 / 文字输入 / 数字输入；清空 = 不筛选', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')
    await page.locator(source).selectOption('2.4')
    await page.locator(fieldBox('2.4.1')).check()

    await page.locator(filterField).selectOption('2.4.3')
    expect(await filterShape(page), 'enum ⇒ 下拉').toEqual({ tag: 'select', type: null })
    expect(
      await page.locator(`${filterValue} option`).evaluateAll((all) => all.map((item) => item.value)),
    ).toEqual(['是', '否'])
    await page.locator(filterValue).selectOption('否')

    await page.locator(filterField).selectOption('2.4.1')
    expect(await filterShape(page), 'text ⇒ 文本输入').toEqual({ tag: 'input', type: 'text' })
    await page.locator(filterValue).fill('短剑')

    await page.locator(filterField).selectOption('2.4.2')
    expect(await filterShape(page), 'integer ⇒ 数字输入').toEqual({ tag: 'input', type: 'number' })
    await page.locator(filterValue).fill('2')

    // 清空筛选字段 = 不筛选：值控件整块消失
    await page.locator(filterField).selectOption('')
    await expect(page.locator(filterValue)).toHaveCount(0)
    await expect(page.locator(filterField)).toHaveValue('')

    // 只有单字段等值：一个筛选字段 / 一个值控件，没有「再加一条」或 AND / OR
    await expect(page.locator(filterField)).toHaveCount(1)
    await expect(
      page.locator('[data-ref-filter-add], [data-ref-filter-and], [data-ref-filter-or]'),
    ).toHaveCount(0)
  })

  test('筛选存进卡：字段 + 值原样落盘', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')
    await page.locator(source).selectOption('2.4')
    await page.locator(fieldBox('2.4.1')).check()
    await setFilter(page, '2.4.3', '是')

    expect(await save(page)).toBe(0)
    const ref = await elementOf(page, '2.5')
    expect(ref.refFilter).toEqual({ field: '2.4.3', value: '是' })
  })
})

test.describe('最少 / 最多（§5.4）', () => {
  test('整数输入、默认 0 / 1；合法组合能存；非法组合保存被拦并点名', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')
    await page.locator(source).selectOption('2.4')
    await page.locator(fieldBox('2.4.1')).check()

    await expect(page.locator(minInput)).toHaveAttribute('type', 'number')
    await expect(page.locator(maxInput)).toHaveAttribute('type', 'number')
    await expect(page.locator(minInput), '新引用默认 min = 0').toHaveValue('0')
    await expect(page.locator(maxInput), '新引用默认 max = 1').toHaveValue('1')

    // 合法：0..4（存进去的是整数）
    await page.locator(maxInput).fill('4')
    expect(await save(page)).toBe(0)
    let ref = await elementOf(page, '2.5')
    expect(ref.min).toBe(0)
    expect(ref.max).toBe(4)

    const bad = [
      { min: '3', max: '2', why: 'min > max' },
      { min: '0', max: '0', why: 'max < 1' },
      { min: '0', max: '1000', why: 'max > 999' },
      { min: '-1', max: '1', why: 'min < 0' },
    ]
    for (const item of bad) {
      await page.locator(minInput).fill(item.min)
      await page.locator(maxInput).fill(item.max)
      await expectSaveBlocked(page, '2.5', item.why)
    }

    // 改回合法值 ⇒ 又能存
    await page.locator(minInput).fill('0')
    await page.locator(maxInput).fill('1')
    expect(await save(page)).toBe(0)
  })

  test('max=1 是单值编辑器；max>1 变成多值行构建器', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.5')
    await page.locator(source).selectOption('2.4')
    await page.locator(fieldBox('2.4.1')).check()

    // 初始值块只在根元素上：先看 max=1 的形态
    await select(page, '2')
    await expect(page.locator(`${initialRow('2.5')} [data-ref-choose]`), 'max=1：选择引用').toBeVisible()
    await expect(page.locator(`${initialRow('2.5')} [data-ref-add]`), 'max=1 没有添加引用').toHaveCount(0)
    await expect(page.locator(`${initialRow('2.5')} [data-ref-count]`)).toHaveCount(0)

    // 改 max = 3 ⇒ 多值行构建器
    await select(page, '2.5')
    await page.locator(maxInput).fill('3')
    await select(page, '2')
    await expect(page.locator(`${initialRow('2.5')} [data-ref-add]`), 'max>1：添加引用').toBeVisible()
    await expect(
      page.locator(`${initialRow('2.5')} [data-ref-choose]`),
      '多值不再有「选择引用」',
    ).toHaveCount(0)
    await expect(page.locator(`${initialRow('2.5')} [data-ref-count]`), '多值要显示计数').toBeVisible()
  })
})

test.describe('源的禁区（§5.1 / 契约 §十二）', () => {
  test('源不能是自己所在的数组：2.8 里的字段不能引用 2.8', async ({ page }) => {
    await openEditor(page, defCard())
    await switchToRef(page, '2.8.1')

    const enabled = await sourceCodes(page)
    expect(enabled, '包含自己的数组不许作为源').not.toContain('2.8')
    expect(enabled, '别的数组照常可选').toEqual(['2.4', '2.4.5', '2.6', '2.7'])
  })

  test('引用字段不列对象 / 数组 / ref 字段（2.10 作源）', async ({ page }) => {
    await openEditor(page, refCard())
    await select(page, '2.11')
    expect(await fieldCodes(page), '只列 2.10 的直接标量字段').toEqual(['2.10.1', '2.10.2', '2.10.3'])
  })
})
