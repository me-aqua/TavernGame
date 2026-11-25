/**
 * 编辑器四块面板的标题栏（老板 2026-11-25 晚）：
 *   左 `[data-col="left"]` = 状态树 · 细条 `[data-workflow-strip]` = 工作流 ·
 *   右 `[data-col="right"]` = 公共提示词 · 中 `[data-col="middle"]` = `编辑·<当前选中对象的名字>`，
 *   什么都没选 = `编辑`。
 *
 * 四块标题共用一档版式：**同一个字号 / 字重 / 高度（高度差 ≤1px）**，且都有一条
 * **1px 实线、同一颜色**的水平分隔线把标题与内容分开（实现是标题条自己的下边框）。
 *
 * 为什么单独一份：这是「四个组件各画一版」的典型——谁的字号或分隔线单独漂了，
 * 在单独看任一组件时都像是「没问题」；只有把四个读数放在一起比才看得见。
 */
import { expect, test } from '@playwright/test'
import { APP_PATH, boot, KEYS, makeCard, MOCK_PRESET, route } from './support/app.js'

const CARD_ID = 'c1'

/**
 * 种一张**名字是中文**的卡：中栏标题要拼 `编辑·<名字>`，而夹具里的名字是 ASCII 记号
 * （time / place / opening）—— 换成老板举例的那三个名字，判据才和口径逐字对得上。
 */
function seedChromeCard() {
  const card = makeCard()
  card.chain[0] = { ...card.chain[0], name: '时间' }
  card.state[1] = { ...card.state[1], name: '地点' }
  card.prompts[0] = { ...card.prompts[0], title: '开场' }
  return { [KEYS.cards]: [card], [KEYS.presets]: [MOCK_PRESET] }
}

/** 读四块面板标题的文本与计算样式（浏览器侧代码一律写成模板串，见 support/app.js 的约定） */
async function readTitles(page) {
  return page.evaluate(
    `(() => {
      const panels = [
        ['left', '[data-col="left"] [data-panel-title]'],
        ['workflow', '[data-workflow-strip] [data-panel-title]'],
        ['middle', '[data-col="middle"] [data-panel-title]'],
        ['right', '[data-col="right"] [data-panel-title]'],
      ]
      return panels.map(([panel, selector]) => {
        const element = document.querySelector(selector)
        if (!element) return { panel, missing: true }
        const computed = getComputedStyle(element)
        return {
          panel,
          text: (element.textContent || '').trim(),
          fontSize: parseFloat(computed.fontSize),
          fontWeight: computed.fontWeight,
          height: Math.round(element.getBoundingClientRect().height * 100) / 100,
          dividerWidth: parseFloat(computed.borderBottomWidth),
          dividerStyle: computed.borderBottomStyle,
          dividerColor: computed.borderBottomColor,
        }
      })
    })()`,
  )
}

/** 四块标题的公共断言：文本、同一档版式、同一档虚线（这里是一条 1px 实线分隔） */
function expectChrome(titles, expectedMiddle) {
  const byPanel = Object.fromEntries(titles.map((title) => [title.panel, title]))
  for (const panel of ['left', 'workflow', 'middle', 'right']) {
    expect(byPanel[panel].missing, `${panel} 面板没有 [data-panel-title]`).not.toBe(true)
  }

  expect(byPanel.left.text, '左栏标题').toBe('状态树')
  expect(byPanel.workflow.text, '细条标题').toBe('工作流')
  expect(byPanel.right.text, '右栏标题').toBe('公共提示词')
  expect(byPanel.middle.text, '中栏标题').toBe(expectedMiddle)

  // 同一档字号 / 字重 / 高度（高度差允许 1px）
  const fontSizes = titles.map((title) => title.fontSize)
  expect(Math.max(...fontSizes) - Math.min(...fontSizes), '四个标题的字号不一致').toBeLessThanOrEqual(0.5)
  const weights = new Set(titles.map((title) => title.fontWeight))
  expect(weights.size, `四个标题的字重不一致：${[...weights]}`).toBe(1)
  const heights = titles.map((title) => title.height)
  expect(Math.max(...heights) - Math.min(...heights), '四个标题的高度差超过 1px').toBeLessThanOrEqual(1)

  // 标题与内容之间：1px 实线、四块颜色一致
  const colors = new Set()
  for (const title of titles) {
    expect(title.dividerWidth, `${title.panel} 标题的分隔线不是 1px`).toBeCloseTo(1, 1)
    expect(title.dividerStyle, `${title.panel} 标题的分隔线不是实线`).toBe('solid')
    colors.add(title.dividerColor)
  }
  expect(colors.size, `四块标题的分隔线颜色不一致：${[...colors]}`).toBe(1)
}

test('编辑器面板标题：四块文案 + 同一档字号/字重/高度 + 同一条 1px 实线分隔', async ({ page }) => {
  await boot(page, { storage: seedChromeCard() })
  await page.goto(`${APP_PATH}${route.edit(CARD_ID)}`)
  await expect(page.locator('[data-page="editor"]')).toBeVisible()

  // S0：什么都没选 ⇒ 中栏是「编辑」
  expectChrome(await readTitles(page), '编辑')

  // S1：选中工作流节点 time ⇒ 编辑·时间
  await page.locator('[data-node-id="time"]').click()
  expectChrome(await readTitles(page), '编辑·时间')

  // S2：选中状态元素「地点」⇒ 编辑·地点
  await page.locator('[data-state-item="1"]').click()
  expectChrome(await readTitles(page), '编辑·地点')

  // S3：选中提示词块「开场」⇒ 编辑·开场
  await page.locator('[data-prompt-block="opening"]').click()
  expectChrome(await readTitles(page), '编辑·开场')
})
