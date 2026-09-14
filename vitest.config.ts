import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

/**
 * 测试配置。
 *
 * - 单元测试跑 `src/core`（纯逻辑，node 环境，很快）
 * - 组件测试在文件头写 `// @vitest-environment jsdom` 切到 DOM 环境
 * - 覆盖率**只统计 src/core 与 src/stores**：那是游戏逻辑，
 *   是我们能真正测透的部分；Vue 组件由组件测试 + e2e 覆盖。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // ⚠️ 这行曾经漏掉：文件写了却没注册，于是 localStorage 垫片从未加载，
    //    存档相关断言全部静默走「保存失败」的报错分支 —— 看起来全绿，其实是假通过。
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/core/**/*.ts', 'src/stores/**/*.ts'],
      exclude: ['src/types/**'],
      // 门禁：低于这个数就失败。
      // 数值是**实测后略留余量**定的（实测 92.25 / 86.12 / 90.78 / 92.06），
      // 不是为了好看：它的作用是「新增功能不写测试就过不去」。
      thresholds: {
        statements: 90,
        branches: 84,
        functions: 88,
        lines: 90,
      },
    },
  },
})
