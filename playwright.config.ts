import { defineConfig, devices } from '@playwright/test'

const PORT = 4174
const BASE_URL = `http://localhost:${PORT}`

/**
 * UI 与视觉测试的配置（Playwright）。
 *
 * - webServer 负责「构建 + 起 preview」：测的永远是构建产物，不是源码
 * - 只跑 chromium：风险面在布局与交互，多浏览器等真有需求再加
 * - 截图基线的阈值与动画策略在 expect.toHaveScreenshot 里统一定（见 e2e/visual.spec.ts）
 *
 * 产物：test-results/（失败痕迹）、artifacts/（截图巡检的总览页）—— 都不进仓库。
 */
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // 共用一份构建产物与一个 preview 服务：串行更好读日志
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // 界面显示的时间来自存档（数据固定）；时区固定让日期标签不随机器变
    timezoneId: 'Asia/Shanghai',
    locale: 'zh-CN',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `${BASE_URL}/TavernGame/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
  },
})
