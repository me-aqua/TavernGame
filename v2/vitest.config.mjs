/**
 * v2 单测配置（vitest）。
 *
 * 与被测代码一样是**原生 ES modules + node 环境**：`src/core/**` 不碰 DOM，
 * 所以这一层跑得很快，也不需要 jsdom。DOM 那半边归 Playwright（`v2/e2e/`）。
 *
 * 用法：`npm run v2:test`（等价于 `vitest run --config v2/vitest.config.mjs`）。
 * ⚠️ 旧站的 `vitest.config.ts` 是另一套（Vue + 覆盖率门禁），两者互不影响。
 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: import.meta.dirname,
  // 缓存放在根 node_modules 里：v2/ 下不新增 node_modules 目录
  cacheDir: '../node_modules/.vite/v2',
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // 夹具自检与产品判据在同一份目录里：红了要先能分清是夹具坏了还是功能没做
    reporters: ['default'],
  },
})
