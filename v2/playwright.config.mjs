/**
 * v2 的 e2e 配置（Playwright）。
 *
 * 与被测代码一致的思路：**只跑 chromium**，测的永远是**构建产物**（`dist/v2`），不是源码。
 * 端口与旧站错开（旧站 4174 / 组件故事 4175），产物目录也错开（`v2/test-results`）——
 * 两套浏览器测试永远不许共用一次跑的目录（踩过：并发时互相抽走 trace）。
 *
 * 用法：`npm run v2:e2e`。
 * ⚠️ 跑之前把代理变量清掉（`HTTP_PROXY` / `HTTPS_PROXY` / `NODE_USE_ENV_PROXY`）：
 *    Playwright 会把对本地 preview 的请求也塞给代理，报一条完全不像代理的错。
 */
import { defineConfig, devices } from '@playwright/test'
import { env } from 'node:process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const PORT = 4176
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: join(HERE, 'e2e'),
  // 像素基线是另一层（慢、要看图）：它归 `v2:visual` + `playwright.visual.config.mjs`
  testIgnore: '**/visual.spec.js',
  outputDir: join(HERE, 'test-results'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(env.CI),
  retries: env.CI ? 1 : 0,
  reporter: env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
  webServer: {
    // 先构建再起 preview：测的是玩家真正下载到的那份产物
    command: `npx vite build --config v2/vite.config.mjs && npx vite preview --config v2/vite.config.mjs --port ${PORT} --strictPort`,
    cwd: REPO,
    url: `${BASE_URL}/TavernGame/v2/`,
    reuseExistingServer: !env.CI,
    timeout: 180_000,
    stdout: 'ignore',
  },
})
