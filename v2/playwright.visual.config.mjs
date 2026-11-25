/**
 * v2 的**整页像素基线**配置（第 1 轮评审第 4 条）。
 *
 * 与 `v2:e2e` 分开跑、分开的端口、分开的产物目录：
 *   · `v2:e2e` 量行为（45 条，秒级）；
 *   · `v2:visual` 只量 4 张稳定画面的像素（慢、且要看图，不该拦在每次冒烟里）。
 * 参数按 SPEC §6 定：`maxDiffPixelRatio: 0.01`、动画禁用、caret 隐藏、只跑 chromium。
 *
 * ⚠️ **基线是平台相关的**：文件名会带 `-win32` 这类后缀（Playwright 自动加）。
 *    换系统 / 换机器要重录：`npm run v2:visual -- --update-snapshots`。
 */
import { defineConfig, devices } from '@playwright/test'
import { env } from 'node:process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const PORT = 4178
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: join(HERE, 'e2e'),
  // 只收视觉那一份，别的 spec 归 `v2:e2e`
  testMatch: '**/visual.spec.js',
  // 产物放进仓库根那个已被 .gitignore 忽略的 `test-results/`（别在 v2/ 下留新目录）
  outputDir: join(REPO, 'test-results', 'v2-visual'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(env.CI),
  retries: 0,
  reporter: env.CI ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    // 基线只认这一个工位（SPEC §6 的最小桌面档）
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npx vite build --config v2/vite.config.mjs && npx vite preview --config v2/vite.config.mjs --port ${PORT} --strictPort`,
    cwd: REPO,
    url: `${BASE_URL}/TavernGame/v2/`,
    reuseExistingServer: !env.CI,
    timeout: 180_000,
    stdout: 'ignore',
  },
})
