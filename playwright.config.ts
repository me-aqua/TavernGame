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
  // 截图目录的清理放在这里：**所有 worker 起之前只跑一次**。
  // ⚠️ 别挪回 spec 的模块顶层 —— 真机理是**一条用例失败 ⇒ worker 重启 ⇒ 模块重新加载 ⇒ 顶层清理再跑一次**，
  //    于是只剩"最后一次重启之后"写的那一段（票 69 实测：85 条只剩 20 张、分属 4 个状态；
  //    失败编号 #60…#65 ⇒ 最后一段从 #66 起 = 20 张，逐项对上）。**"workers: 1 就没事"是错的。**
  //    它也只在"这一趟跑的是整页巡检"时清（见 `e2e/visual-setup.ts` —— 跑 e2e / stories 不该清掉给人看的资产）。
  globalSetup: './e2e/visual-setup.ts',
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
