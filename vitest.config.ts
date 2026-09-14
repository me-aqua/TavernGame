import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { promptsPlugin } from './vite-plugins/prompts.ts'

/**
 * 测试配置。
 *
 * - 单元测试跑 `src/game` / `src/agent` / `src/utils`（纯逻辑，node 环境，很快）
 * - 组件测试在文件头写 `// @vitest-environment jsdom` 切到 DOM 环境
 * - 覆盖率**只统计纯逻辑与 store**：那是游戏逻辑，是我们能真正测透的部分；
 *   Vue 组件由组件测试 + e2e 覆盖。
 */
export default defineConfig({
  // 必须与 vite.config.ts 一致：测试也要能 import 那些虚拟模块
  plugins: [vue(), promptsPlugin()],
  test: {
    environment: 'node',
    // ⚠️ jsdom 默认地址是 localhost，而 store 在 localhost 上**默认打开调试模式**
    //    （本机开发的便利）。测试跑在别的域名上，才不会把那个默认值当成产品行为：
    //    想测那条规则请直接测 isDevHost()。
    environmentOptions: { jsdom: { url: 'http://tavern.test/' } },
    globals: true,
    include: ['tests/**/*.test.ts'],
    // ⚠️ 没有这一行，tests/setup.ts 根本不会加载：localStorage 垫片缺席时，
    //    存档相关断言会静默走「保存失败」分支 —— 测试全绿，其实是假通过。
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // ⚠️ 改了 src 目录结构就必须同步这里：漏改 = 搬出去的代码静默脱离门禁
      include: ['src/game/**/*.ts', 'src/agent/**/*.ts', 'src/utils/**/*.ts', 'src/stores/**/*.ts'],
      exclude: ['src/types/**'],
      // 覆盖率门槛：低于这些数就失败。按实测值校准（99.57 / 93.46 / 100 / 99.53），
      // 留一点余量，让门槛抓的是真回归而不是正常重构的噪声。
      // 它的用途是拦住「加了功能没加测试」。
      thresholds: {
        statements: 99,
        branches: 94,
        functions: 100,
        lines: 99,
      },
    },
  },
})
