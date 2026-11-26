/**
 * 存档级编辑器（`#/edit-save/:saveId`）：改的是**这一份存档的快照**，不是卡带库。
 *
 * 钉住的钩子 / 字段（本票新钉，实现要与之一致）：
 *   · 首页存档行 `[data-save-edit]`（「编辑游戏卡」）—— 在 `[data-save-rename]` 左边；非法存档行没有它；
 *   · 路由 `#/edit-save/<saveId>`；
 *   · 存档对象上的 `nodeModels`（`{ [nodeId]: presetId }`）—— 新建存档从卡映射拷一份。
 *
 * 判据分五格：入口 / 读快照 / 禁用项 / 允许的编辑落盘且不动卡库 / 模型映射与播放。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  createSave,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  MOCK_PRESET_B,
  nodeModelsFor,
  openAiSse,
  openStory,
  playTurn,
  readRaw,
  readStorage,
  slowMock,
} from './support/app.js'

const SAVE_ID = 's1'

/** 卡 + 存档 + 预设 + 卡的模型映射 */
function seeded() {
  const card = makeCard()
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [makeSave(card)],
    [KEYS.presets]: [MOCK_PRESET, MOCK_PRESET_B],
    [KEYS.nodeModels]: { [card.id]: nodeModelsFor(card) },
  }
}

/** 进存档编辑器 */
async function openSaveEditor(page, saveId) {
  await page.goto(`${APP_PATH}#/edit-save/${saveId}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()
}

test.describe('存档编辑器：入口', () => {
  test('首页存档行有「编辑游戏卡」，在重命名左边；非法存档行没有', async ({ page }) => {
    const card = makeCard()
    const bad = { ...makeSave(card), id: 's-bad', tree: { ...makeSave(card).tree, 0: { day: 1, hour: 8 } } }
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.saves]: [makeSave(card), bad],
        [KEYS.presets]: [MOCK_PRESET],
      },
    })
    await expect(page.locator('[data-page="home"]')).toBeVisible()

    const edit = page.locator(`[data-save-id="${SAVE_ID}"] [data-save-edit]`)
    const rename = page.locator(`[data-save-id="${SAVE_ID}"] [data-save-rename]`)
    const remove = page.locator(`[data-save-id="${SAVE_ID}"] [data-save-delete]`)
    await expect(edit, '合法存档行要有「编辑游戏卡」').toHaveCount(1)
    await expect(edit).toBeVisible()
    // 只认 `data-save-edit` 这一个钩子：不许留别名（同元素上多一个 data-save-edit-card 也算没改干净）
    await expect(
      page.locator('[data-save-edit-card]'),
      '「编辑游戏卡」不许再有 data-save-edit-card 别名',
    ).toHaveCount(0)
    const [editBox, renameBox, deleteBox] = [
      await edit.boundingBox(),
      await rename.boundingBox(),
      await remove.boundingBox(),
    ]
    expect(editBox.x, '「编辑游戏卡」要在重命名左边').toBeLessThan(renameBox.x)
    expect(editBox.x, '「编辑游戏卡」要在删除左边').toBeLessThan(deleteBox.x)

    await expect(page.locator('[data-invalid-save] [data-save-edit]'), '非法存档行不许有入口').toHaveCount(0)
  })
})

test.describe('存档编辑器：读的是快照', () => {
  test('从 save.cardSnapshot 打开：标题是快照里的卡名，不是卡带库里的那张', async ({ page }) => {
    const card = makeCard()
    const save = makeSave(card)
    // 卡带库里同 id 的卡被改过名：编辑器若读卡库，标题会变成 LIBRARY_NAME
    const renamed = { ...card, name: 'LIBRARY_NAME' }
    await boot(page, {
      storage: { [KEYS.cards]: [renamed], [KEYS.saves]: [save], [KEYS.presets]: [MOCK_PRESET] },
    })

    await openSaveEditor(page, SAVE_ID)
    await expect(page.locator('[data-page="editor"] .page-title')).toContainText(save.cardSnapshot.name)
    await expect(page.locator('[data-page="editor"] .page-title')).not.toContainText('LIBRARY_NAME')
    // 三个面板都在（它还是那个编辑器）
    await expect(page.locator('[data-state-tree]')).toBeVisible()
    await expect(page.locator('[data-workflow-strip]')).toBeVisible()
    await expect(page.locator('[data-prompt-list]')).toBeVisible()
  })
})

test.describe('存档编辑器：禁用项', () => {
  test('状态树没有 + / ×，也没有改卡名的入口', async ({ page }) => {
    await boot(page, { storage: seeded() })
    await openSaveEditor(page, SAVE_ID)

    // S2（选中元素）：卡带编辑器这里会出现 + 与每行的 ×；存档编辑器两个都不许有
    await page.locator('[data-state-item="1"]').click()
    await expect(page.locator('[data-add-state]'), '存档编辑器不许加状态元素').toHaveCount(0)
    await expect(page.locator('[data-delete-state]'), '存档编辑器不许删状态元素').toHaveCount(0)

    // 节点选中时同样没有
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-add-state]')).toHaveCount(0)
    await expect(page.locator('[data-delete-state]')).toHaveCount(0)

    // 不许改卡名：没有卡行口的那几个入口
    await expect(page.locator('[data-card-rename]')).toHaveCount(0)
    await expect(page.locator('input[data-card-name]')).toHaveCount(0)
  })
})

test.describe('存档编辑器：允许的编辑落到快照', () => {
  test('提示词正文 / 节点提示词 / 读取历史回合 / 状态名与备注 / 眼睛都落盘，卡带库一个字节不动', async ({
    page,
  }) => {
    await boot(page, { storage: seeded() })
    const cardsBefore = await readRaw(page, KEYS.cards)
    await openSaveEditor(page, SAVE_ID)

    // ① 公共提示词正文（S3）
    await page.locator('[data-prompt-block="pr1"]').click()
    await page.locator('[data-prompt-body]').fill('SAVE_BODY_EDIT')

    // ② 节点提示词 + ③ 读取历史回合（S1）
    await page.locator('[data-node-id="check"]').click()
    await page.locator('[data-node-prompt]').fill('SAVE_NODE_EDIT')
    await page.locator('[data-node-history]').fill('5')
    await page.locator('[data-node-history]').dispatchEvent('change')

    // ④ 状态名与备注（S2）
    await page.locator('[data-state-item="1"]').click()
    await page.locator('[data-field="name"]').fill('PLACE_SAVE')
    await page.locator('[data-field="note"]').fill('NOTE_SAVE')

    // ⑤ 眼睛：给判定节点开「读元素 2」
    await page.locator('[data-node-id="check"]').click()
    await page.locator('[data-state-item="2"] [data-eyes="read"]').click()

    // 存档编辑器与卡编辑器同一套语义：点【保存】才校验 + 落盘
    await page.locator('[data-save-card]').click()
    await expect(page.locator('[data-save-ok]')).toBeVisible()

    const saved = (await readStorage(page, KEYS.saves))[0]
    expect(saved.cardSnapshot.prompts.find((prompt) => prompt.id === 'pr1').body).toBe('SAVE_BODY_EDIT')
    const node = saved.cardSnapshot.chain.find((item) => item.id === 'check')
    expect(node.prompt).toBe('SAVE_NODE_EDIT')
    expect(node.historyTurns).toBe(5)
    expect(node.reads).toContain('2')
    expect(saved.cardSnapshot.state.find((element) => element.code === '1').name).toBe('PLACE_SAVE')
    expect(saved.cardSnapshot.state.find((element) => element.code === '1').note).toBe('NOTE_SAVE')
    // 卡带库完全没动（字节级）
    expect(await readRaw(page, KEYS.cards), '存档编辑器改到了卡带库').toBe(cardsBefore)

    // 刷新后还在
    await page.reload()
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-prompt]')).toHaveValue('SAVE_NODE_EDIT')
    await expect(page.locator('[data-node-history]')).toHaveValue('5')
  })
})

test.describe('存档编辑器：模型映射', () => {
  test('改节点预设落到 save.nodeModels（不动卡的映射），刷新后还在', async ({ page }) => {
    await boot(page, { storage: seeded() })
    const cardModelsBefore = await readStorage(page, KEYS.nodeModels)
    await openSaveEditor(page, SAVE_ID)

    await page.locator('[data-node-id="check"]').click()
    await page.locator('[data-node-preset]').selectOption(MOCK_PRESET_B.id)

    const saved = (await readStorage(page, KEYS.saves))[0]
    expect(saved.nodeModels, '存档没有自己的模型映射').toBeTruthy()
    expect(saved.nodeModels.check).toBe(MOCK_PRESET_B.id)
    expect(await readStorage(page, KEYS.nodeModels), '存档编辑器改到了卡的映射').toEqual(cardModelsBefore)

    await page.reload()
    await page.locator('[data-node-id="check"]').click()
    await expect(page.locator('[data-node-preset]')).toHaveValue(MOCK_PRESET_B.id)
  })

  test('新建存档从卡映射拷一份；播放用存档映射，改它只影响这一份的下一回合请求', async ({ page }) => {
    const card = makeCard()
    const presetA = {
      ...slowMock(0),
      id: 'p-a',
      name: 'a',
      provider: 'openai-compatible',
      baseUrl: 'https://mock.invalid/v1',
      apiKey: 'k',
      model: 'model-a',
    }
    const presetB = { ...presetA, id: 'p-b', name: 'b', model: 'model-b' }
    await boot(page, {
      storage: {
        [KEYS.cards]: [card],
        [KEYS.presets]: [presetA, presetB],
        [KEYS.nodeModels]: { [card.id]: nodeModelsFor(card, presetA.id) },
      },
    })

    // 两份存档：A 要被改，B 不许受影响
    const saveA = await createSave(page, card.id)
    const saveB = await createSave(page, card.id)
    const afterCreate = await readStorage(page, KEYS.saves)
    const createdA = afterCreate.find((item) => item.id === saveA)
    const createdB = afterCreate.find((item) => item.id === saveB)
    expect(createdA.nodeModels, '新存档没有继承卡映射').toEqual(nodeModelsFor(card, presetA.id))
    expect(createdB.nodeModels).toEqual(nodeModelsFor(card, presetA.id))

    // 只改 A 的 check 节点 → presetB
    await openSaveEditor(page, saveA)
    await page.locator('[data-node-id="check"]').click()
    await page.locator('[data-node-preset]').selectOption(presetB.id)

    const models = await readStorage(page, KEYS.nodeModels)
    expect(models[card.id].check, '卡的映射被存档编辑器改掉了').toBe(presetA.id)
    const savesNow = await readStorage(page, KEYS.saves)
    expect(savesNow.find((item) => item.id === saveB).nodeModels).toEqual(nodeModelsFor(card, presetA.id))

    // 播放 A：check 那一跳的请求用 model-b，其余用 model-a
    const requests = []
    await page.route('**/chat/completions', async (intercepted) => {
      requests.push(intercepted.request().postDataJSON())
      await intercepted.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: openAiSse(['OK']),
      })
    })
    await openStory(page, card.id, saveA)
    await playTurn(page, 'act one', 1)

    const modelsOfCalls = requests.map((body) => body.model)
    // 链顺序 time → check → extra → output：只有第二跳换了模型
    expect(modelsOfCalls).toEqual(['model-a', 'model-b', 'model-a', 'model-a'])
  })
})
