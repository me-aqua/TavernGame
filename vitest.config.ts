import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { promptsPlugin } from './vite-plugins/prompts.ts'

/**
 * 测试配置。
 *
 * - 单元测试跑 `src/core`（纯逻辑，node 环境，很快）
 * - 组件测试在文件头写 `// @vitest-environment jsdom` 切到 DOM 环境
 * - 覆盖率**只统计 src/core 与 src/stores**：那是游戏逻辑，
 *   是我们能真正测透的部分；Vue 组件由组件测试 + e2e 覆盖。
 */
export default defineConfig({
  // 必须与 vite.config.ts 一致：测试也要能 import 那些虚拟模块
  plugins: [vue(), promptsPlugin()],
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
      // Coverage gate: fail below these numbers.
      // Calibrated from measured values (99.57 / 93.46 / 100 / 99.53 after the
      // i18n round), with a small margin so the gate flags real regressions
      // rather than normal refactoring noise. Its purpose is to stop "new
      // feature, no tests" from getting through.
      thresholds: {
        statements: 99,
        branches: 94,
        functions: 100,
        lines: 99,
      },
    },
  },
})
