import { defineConfig } from 'vitest/config'

/**
 * 测试配置。
 *
 * 测试只跑 src/core 里的**纯逻辑**（状态、历法、工具、agent 循环），
 * 不跑组件渲染 —— 组件由 CDP 那套真实浏览器验证来盯。
 * 这样测试不需要 jsdom，跑得很快。
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
})
