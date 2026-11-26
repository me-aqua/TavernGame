/**
 * 阶段 2.1 · 编辑器里的状态树（v5 契约 §6 / §6.1 / §7）。
 *
 * 这一份量的是**玩家在界面上点得到的那几件事**：
 *   · 左栏按 code 缩进；**`.0` 不单独出行**；有自身值的行显示自身值（时间显示公历格式）；
 *   · 【读】【写】是**文字按钮**；父行三态（满 / 半 / 未）；子节点按钮只切自己；
 *   · 第 5 层不再显示「加子元素」；给标量加孩子**不转换类型**；
 *   · 顶栏 `[data-save-card]`：编辑只改内存草稿，点保存才校验 + 落盘；
 *     校验不过 ⇒ 不写盘、草稿保留、中文错误清单可点回；合法 ⇒ 写盘。
 *
 * 判据只用契约 §8 的数据钩子；界面文案不在这里钉。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, CJK, KEYS, MOCK_PRESET, boot, readStorage, route } from './support/app.js'
import { deepCard, v5Card } from '../tests/support/state-fixtures.js'

/** 选中一行（状态树的行只做选择；眼睛 / 加孩子 / 删除都是行内按钮） */
const row = (code) => `[data-state-item="${code}"]`
const readEye = (code) => `${row(code)} [data-eyes="read"]`
const writeEye = (code) => `${row(code)} [data-eyes="write"]`
const addChild = (code) => `[data-add-child="${code}"]`

/** 一行是不是选中态（`data-selected` 与现类名 `.selected` 都收，见契约 §6） */
const selectedRow = (code) => `${row(code)}[data-selected], ${row(code)}.selected`

/** 开卡编辑器：种一张 v5 卡 + mock 预设，直接进 `#/edit/:cardId` */
async function openEditor(page, card) {
  await boot(page, {
    storage: { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] },
    hash: route.edit(card.id),
  })
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
}

/** 打开示例卡（首次打开会种入「晨风镇」） */
async function openSample(page) {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.goto(`${APP_PATH}${route.edit(cards[0].id)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

/** 选中工作流节点（S1）：眼睛才出现 */
async function selectNode(page, nodeId) {
  await page.locator(`[data-node-id="${nodeId}"]`).click()
}

/** 选中状态元素（S2）：加孩子 / 删除才出现 */
async function selectElement(page, code) {
  await page.locator(row(code)).click()
  await expect(page.locator(selectedRow(code))).toHaveCount(1)
}

/** 点保存并等结果出现；返回中文错误清单的条数（0 = 保存成功） */
async function save(page) {
  await page.locator('[data-save-card]').click()
  await expect(page.locator('[data-save-errors], [data-save-ok]')).toBeVisible({ timeout: 5_000 })
  return page.locator('[data-save-error]').count()
}

/** 草稿没写盘：`tg2.cards` 与种下去的那张卡逐字相等（JSON 值） */
async function expectNoWrite(page, card) {
  expect(await readStorage(page, KEYS.cards)).toEqual([card])
}

test('示例卡：1.1（区域）与 1.1.1（地点）都在，.0 不单独出行，行按深度缩进', async ({ page }) => {
  await openSample(page)
  await expect(page.locator(row('1'))).toBeVisible()
  await expect(page.locator(row('1.1'))).toBeVisible()
  await expect(page.locator(row('1.1.1'))).toBeVisible()
  await expect(page.locator(row('1.1.0')), '.0 是自身值的保留槽，不出行').toHaveCount(0)
  await expect(page.locator(`${row('1.1')} [data-state-value]`)).toHaveText('晨风镇')
  await expect(page.locator(`${row('1.1.1')} [data-state-value]`)).toHaveText('醉猫旅店 · 一楼')

  await expect(page.locator(row('1'))).toHaveAttribute('data-depth', '1')
  await expect(page.locator(row('1.1'))).toHaveAttribute('data-depth', '2')
  await expect(page.locator(row('1.1.1'))).toHaveAttribute('data-depth', '3')
})

test('示例卡：新建存档的 tree 就是 §7.2 那张扁平表（.0 与叶子分开）', async ({ page }) => {
  await boot(page, { sample: true })
  const cards = await readStorage(page, KEYS.cards)
  await page.locator(`[data-card-id="${cards[0].id}"]`).click()
  await page.locator('[data-new-save]').click()
  const saves = await readStorage(page, KEYS.saves)
  expect(saves.at(-1).tree).toEqual({
    0: { year: 1024, month: 9, day: 17, hour: 18, minute: 30, second: 0 },
    '1.1.0': '晨风镇',
    '1.1.1': '醉猫旅店 · 一楼',
    1.2: '雨',
    1.3: '炉火噼啪，麦酒和湿羊毛的味道',
    2.1: '旅人',
    2.2: 80,
    2.3: '正常',
    2.4: '短剑、斗篷、三枚银币',
  })
})

test('文字按钮：【读】【写】在每一行都有，父行带三态', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectNode(page, 'check')

  for (const code of ['1.1', '1.1.1', '2.2']) {
    await expect(page.locator(readEye(code)), `${code} 的读按钮`).toHaveText('读')
    await expect(page.locator(writeEye(code)), `${code} 的写按钮`).toHaveText('写')
    await expect(page.locator(readEye(code))).toHaveAttribute('data-tri', /^(all|some|none)$/)
    await expect(page.locator(writeEye(code))).toHaveAttribute('data-tri', /^(all|some|none)$/)
  }
})

test('父【读】全选 / 全反选 = 自身值 + 所有孩子；子节点按钮只切自己（三态）', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  // 时间节点的 reads 是空的：整棵树都从「未选」出发
  await selectNode(page, 'time')
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-tri', 'none')

  // 只点孩子 ⇒ 父行变「半」
  await page.locator(readEye('1.1.1')).click()
  await expect(page.locator(readEye('1.1.1'))).toHaveAttribute('data-on', 'true')
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-tri', 'some')
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-on', 'false')

  // 点父行全选 ⇒ 满（自身值 + 所有孩子在语义上都被覆盖）
  await page.locator(readEye('1.1')).click()
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-tri', 'all')
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-on', 'true')

  // 落盘的是**父 code**（一个 code 覆盖自身值 + 整棵子树），不是逐个孩子
  expect(await save(page)).toBe(0)
  const cards = await readStorage(page, KEYS.cards)
  expect(cards[0].chain.find((node) => node.id === 'time').reads).toContain('1.1')

  // 再点一次 = 全反选
  await page.locator(readEye('1.1')).click()
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-tri', 'none')
  expect(await save(page)).toBe(0)
  expect((await readStorage(page, KEYS.cards))[0].chain.find((node) => node.id === 'time').reads).toEqual([])
})

test('父行三态把自身值 1.1.0 算进去：只引用 .0 ⇒ 半；.0 不出行', async ({ page }) => {
  const base = v5Card()
  const card = {
    ...base,
    chain: base.chain.map((node) =>
      node.id === 'check' ? { ...node, reads: ['1.1.0'], writable: ['1.1.0'] } : node,
    ),
  }
  await openEditor(page, card)
  await expect(page.locator(row('1.1.0')), '.0 是自身值的保留槽，不出行').toHaveCount(0)

  await selectNode(page, 'check')
  // 只覆盖了 1.1 的自身值（1.1.0），孩子 1.1.1 没覆盖 ⇒ 父行是「半」
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-tri', 'some')
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-on', 'false')
  await expect(page.locator(writeEye('1.1'))).toHaveAttribute('data-tri', 'some')
  await expect(page.locator(writeEye('1.1'))).toHaveAttribute('data-on', 'false')
})

test('父行三态：引用 .0 + 孩子 ⇒ 满；.0 仍然不出行', async ({ page }) => {
  const base = v5Card()
  const card = {
    ...base,
    chain: base.chain.map((node) =>
      node.id === 'check' ? { ...node, reads: ['1.1.0', '1.1.1'], writable: ['1.1.0', '1.1.1'] } : node,
    ),
  }
  await openEditor(page, card)
  await expect(page.locator(row('1.1.0')), '.0 是自身值的保留槽，不出行').toHaveCount(0)

  await selectNode(page, 'check')
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-tri', 'all')
  await expect(page.locator(readEye('1.1'))).toHaveAttribute('data-on', 'true')
  await expect(page.locator(writeEye('1.1'))).toHaveAttribute('data-tri', 'all')
  await expect(page.locator(writeEye('1.1'))).toHaveAttribute('data-on', 'true')
})

test('父【写】同样是三态：全选 / 半选 / 全反选', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectNode(page, 'time')
  await expect(page.locator(writeEye('2'))).toHaveAttribute('data-tri', 'none')

  await page.locator(writeEye('2.2')).click()
  await expect(page.locator(writeEye('2'))).toHaveAttribute('data-tri', 'some')
  await page.locator(writeEye('2')).click()
  await expect(page.locator(writeEye('2'))).toHaveAttribute('data-tri', 'all')
  expect(await save(page)).toBe(0)
  const cards = await readStorage(page, KEYS.cards)
  expect(cards[0].chain.find((node) => node.id === 'time').writable).toContain('2')
})

test('第 5 层不再显示「加子元素」；第 4 层还有', async ({ page }) => {
  const card = deepCard()
  await openEditor(page, card)
  await selectElement(page, '1.1.1.1.1')
  await expect(page.locator(row('1.1.1.1.1'))).toHaveCount(1)
  await expect(page.locator(addChild('1.1.1.1.1')), '第 5 层不许再加孩子').toHaveCount(0)
  await page.locator(row('1.1.1.1')).click()
  await expect(page.locator(addChild('1.1.1.1'))).toHaveCount(1)
})

test('给标量加孩子：不转换类型、自身值仍是自身值（保存后读盘）', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '1.1')
  await page.locator(addChild('1.1')).click()
  await expect(page.locator(row('1.1.2')), '新孩子用下一个空位').toBeVisible()
  // 新孩子必须紧跟在父亲下面，不是被追加到整棵树末尾
  const codes = await page
    .locator('[data-state-item]')
    .evaluateAll((rows) => rows.map((item) => item.getAttribute('data-state-item')))
  const parentAt = codes.indexOf('1.1')
  const childAt = codes.indexOf('1.1.2')
  expect(childAt, '新孩子要插在 1.1 的子树里').toBeGreaterThan(parentAt)
  expect(childAt, '1.1.2 应紧跟在已有孩子 1.1.1 之后').toBe(codes.indexOf('1.1.1') + 1)
  expect(codes.indexOf('1.2'), '1.2 应排在 1.1.2 之后').toBeGreaterThan(childAt)
  await expect(page.locator(row('1.1.2'))).toHaveAttribute('data-depth', '3')
  await page.locator(row('1.1')).click()
  await expect(page.locator(`${row('1.1')} [data-state-value]`)).toHaveText('A1')
  await expect(page.locator('[data-state-type]')).toHaveValue('enum')

  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0]
  const parent = saved.state.find((item) => item.code === '1.1')
  expect(parent.type, '加孩子不把 enum 转成 object').toBe('enum')
  expect(parent.initial).toBe('A1')
  expect(saved.state.find((item) => item.code === '1.1.2')).toMatchObject({ type: 'text', initial: '' })
})

test('保存按钮：编辑只改草稿，点保存才写盘', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '2.1')
  await page.locator('[data-field="name"]').fill('RENAMED')
  await page.locator('[data-field="initial"]').fill('HERO_2')
  await expectNoWrite(page, card)

  expect(await save(page)).toBe(0)
  await expect(page.locator('[data-save-ok]'), '成功要给提示').toBeVisible()
  await expect(page.locator('[data-save-errors]')).toHaveCount(0)
  const saved = (await readStorage(page, KEYS.cards))[0]
  expect(saved.state.find((item) => item.code === '2.1')).toMatchObject({
    name: 'RENAMED',
    initial: 'HERO_2',
  })
})

test('清空数字初值：不炸、不楔死；保存时给校验或落一个合法整数，补回后能保存', async ({ page }) => {
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '2.2')

  const initial = page.locator('[data-field="initial"]')
  await expect(initial).toHaveValue('80')
  await initial.fill('')
  expect(pageErrors, '清空初值不许触发运行时错误').toEqual([])
  // 「不楔死」：编辑器还在、状态树还在、没有打成错误页
  await expect(
    page.locator('[data-page="editor"]'),
    `清空初值后编辑器消失了；pageerror=${pageErrors.join(' | ')}`,
  ).toBeVisible()
  await expect(page.locator('[data-state-tree]')).toBeVisible()
  await expect(page.locator('[data-error]'), '清空初值不许把编辑器打成错误页').toHaveCount(0)

  const errors = await save(page)
  const stored = (await readStorage(page, KEYS.cards))[0].state.find((item) => item.code === '2.2')
  if (errors === 0) {
    expect(Number.isSafeInteger(stored.initial), `保存成功时初值必须是合法整数，实际 ${stored.initial}`).toBe(
      true,
    )
  } else {
    expect(errors, '清空数字初值至少要报一条校验错误').toBeGreaterThan(0)
  }

  // 草稿还活着：补回合法值再保存必须成功
  await page.locator('[data-field="initial"]').fill('90')
  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0].state.find((item) => item.code === '2.2')
  expect(saved.initial).toBe(90)
})

test('enum values 改成不含旧值：initial 自动重置为第一项，保存成功', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '1.1')

  const initial = page.locator('[data-field="initial"]')
  await expect(initial).toHaveValue('A1')
  await page.locator('[data-field="values"]').fill('B1\nB2')
  await expect(initial, '旧值不在新列表里 ⇒ initial 应重置为第一项').toHaveValue('B1')

  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0].state.find((item) => item.code === '1.1')
  expect(saved.values).toEqual(['B1', 'B2'])
  expect(saved.initial).toBe('B1')
})

test('校验拦截 · 空 object：不写盘、草稿保留、错误可点回', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '1.2')
  await page.locator('[data-add-state]').click()
  await page.locator('[data-state-type]').selectOption('object')
  await expect(page.locator('[data-state-type]')).toHaveValue('object')

  const errors = await save(page)
  expect(errors, '空 object 应当被拦').toBeGreaterThan(0)
  await expect(page.locator('[data-save-errors]')).toBeVisible()
  const first = page.locator('[data-save-error]').first()
  await expect(first).toContainText(CJK)
  await expectNoWrite(page, card)
  await expect(page.locator('[data-state-type]'), '草稿保留').toHaveValue('object')

  // 点错误回到那一格
  const code = await first.getAttribute('data-save-error-code')
  expect(code, '错误项要带可点回的 code').toBeTruthy()
  await first.click()
  await expect(page.locator(selectedRow(code))).toHaveCount(1)
})

test('校验拦截 · 空 enum 取值：不写盘、草稿保留', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '1.2')
  await page.locator('[data-state-type]').selectOption('enum')
  await page.locator('[data-field="values"]').fill('')

  expect(await save(page)).toBeGreaterThan(0)
  await expectNoWrite(page, card)
  await expect(page.locator('[data-field="values"]'), '草稿保留').toHaveValue('')
})

test('校验拦截 · 数字上下限反了：不写盘、草稿保留', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '2.2')
  await page.locator('[data-field="min"]').fill('50')
  await page.locator('[data-field="max"]').fill('10')

  expect(await save(page)).toBeGreaterThan(0)
  await expectNoWrite(page, card)
  await expect(page.locator('[data-field="min"]'), '草稿保留').toHaveValue('50')
})

test('校验拦截 · 时间颗粒度顺序反了：不写盘；时间类型只读', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '0')
  await expect(page.locator('[data-state-type]')).toHaveValue('time')
  await expect(page.locator('[data-state-type]'), '时间类型只读').toBeDisabled()
  await expect(page.locator('[data-field="time-year"]')).toHaveValue('2024')

  await page.locator('[data-field="granularity-upper"]').selectOption('minute')
  await page.locator('[data-field="granularity-lower"]').selectOption('year')
  expect(await save(page)).toBeGreaterThan(0)
  await expectNoWrite(page, card)
  await expect(page.locator('[data-field="granularity-upper"]'), '草稿保留').toHaveValue('minute')
})

test('校验拦截 · 初始值越界：不写盘；改回合法值后能保存', async ({ page }) => {
  const card = v5Card()
  await openEditor(page, card)
  await selectElement(page, '2.2')
  await page.locator('[data-field="initial"]').fill('999')
  expect(await save(page)).toBeGreaterThan(0)
  await expectNoWrite(page, card)
  await expect(page.locator('[data-field="initial"]'), '草稿保留').toHaveValue('999')

  await page.locator('[data-field="initial"]').fill('90')
  expect(await save(page)).toBe(0)
  const saved = (await readStorage(page, KEYS.cards))[0]
  expect(saved.state.find((item) => item.code === '2.2').initial).toBe(90)
})
