/**
 * v2 组件故事的巡检配置（Playwright）。
 *
 * 与 `v2:e2e` 那份分开：**被测对象不同**（这份测 Storybook 构建产物，那份测应用构建产物），
 * 端口（4177 / 4176）与产物目录（`v2/test-results/stories` / `v2/test-results`）也分开 ——
 * 两套浏览器测试永远不许共用一次跑的目录（踩过：并发时互相抽走 trace）。
 *
 * 用法：`npm run v2:stories`（先构建故事，再跑这份配置）。
 * ⚠️ 跑之前把代理变量清掉：Playwright 会把对本地服务的请求也塞给代理。
 */
import { defineConfig, devices } from '@playwright/test'
import { env } from 'node:process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: join(HERE, 'stories', 'harness'),
  outputDir: join(HERE, 'test-results', 'stories'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(env.CI),
  retries: 0,
  reporter: env.CI ? [['github'], ['list']] : [['list']],
  timeout: 30_000,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  },
})
