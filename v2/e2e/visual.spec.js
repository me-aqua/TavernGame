/**
 * v2 的整页像素基线（第 1 轮评审第 4 条）：4 张**稳定画面**，1280×720。
 *
 * 挑画面的标准（照旧站的教训）：数据固定、没有流式、没有动画、不依赖时间 ——
 *   ① 首页空态（没有卡）· ② 编辑器（选中输出节点）· ③ 对话页（已有两回合故事）· ④ 设置。
 * 参数（SPEC §6）：`maxDiffPixelRatio: 0.01`、动画禁用、caret 隐藏、只跑 chromium。
 * 基线是**平台相关**的（文件名带 `-win32`）：换机器要重录 `npm run v2:visual -- --update-snapshots`。
 *
 * ⚠️ 这一层不钉「好不好看」，钉的是「有没有被悄悄改坏」。改界面时先看图再决定要不要重录基线。
 */
import { expect, test } from '@playwright/test'
import {
  APP_PATH,
  boot,
  KEYS,
  makeCard,
  makeSave,
  MOCK_PRESET,
  MOCK_PRESET_B,
  route,
  turnEvents,
} from './support/app.js'

const CARD_ID = 'c1'

/** 两回合已完成的故事（固定文本；对话页直接用事件流渲染，不跑模型） */
function saveWithStory() {
  const card = makeCard()
  return makeSave(card, {
    turn: 2,
    events: [
      ...turnEvents(1, 'act one', 'NARR_ONE\n\nThe door creaks open and warm light spills out.'),
      ...turnEvents(2, 'act two', 'NARR_TWO\n\nShe sets the tin cup down and looks up.'),
    ],
  })
}

/** 设置页用两条固定预设（不靠「首次打开自动种默认」那条路，画面才稳） */
function settingsStorage() {
  const card = makeCard()
  return {
    [KEYS.cards]: [card],
    [KEYS.saves]: [saveWithStory()],
    [KEYS.presets]: [MOCK_PRESET, { ...MOCK_PRESET_B, name: 'mock-b' }],
    [KEYS.settings]: { schemaVersion: 1, theme: 'light', editorColumns: { left: 280, right: 320 } },
  }
}

test.describe('整页像素基线（1280×720 · 浅色）', () => {
  test('首页空态', async ({ page }) => {
    await boot(page, { storage: { [KEYS.settings]: { schemaVersion: 1, theme: 'light' } } })
    await expect(page.locator('[data-page="home"]')).toBeVisible()
    await expect(page.locator('[data-empty-cards]')).toBeVisible()
    await expect(page).toHaveScreenshot('home-empty.png')
  })

  test('编辑器（选中输出节点）', async ({ page }) => {
    await boot(page, { storage: settingsStorage() })
    await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
    await expect(page.locator('[data-page="editor"]')).toBeVisible()
    await page.locator('[data-node-id="output"]').click()
    await expect(page.locator('[data-node-prompt]')).toBeVisible()
    await expect(page).toHaveScreenshot('editor-output-node.png')
  })

  test('对话页（已有两回合故事）', async ({ page }) => {
    await boot(page, { storage: settingsStorage(), hash: route.play(CARD_ID, 's1') })
    await expect(page.locator('[data-page="play"]')).toBeVisible()
    // 没有封面 / 开始按钮（CONTRACT §8.3）：打开就在故事流
    await expect(page.locator('[data-start]')).toHaveCount(0)
    await expect(page.locator('[data-line="narration"]')).toHaveCount(2)
    await expect(page).toHaveScreenshot('play-with-story.png')
  })

  test('设置页（两条固定预设）', async ({ page }) => {
    await boot(page, { storage: settingsStorage(), hash: route.settings })
    await expect(page.locator('[data-page="settings"]')).toBeVisible()
    await expect(page.locator('[data-preset]')).toHaveCount(2)
    await expect(page).toHaveScreenshot('settings.png')
  })
})
