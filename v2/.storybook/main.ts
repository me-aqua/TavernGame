import type { StorybookConfig } from '@storybook/vue3-vite'

/**
 * v2 的组件工作台（SPEC §6「组件故事」）。
 *
 * 与旧站那份 `.storybook/` 完全分开：旧站的 `stories` 脚本仍指它，v2 的 `v2:stories`
 * 指这一份 —— 两边各建各的，互不改对方的故事清单。
 *
 * 这里只负责「渲染出什么」；结构检查（溢出 / 出界 / 24px 点按 / 遮挡 / 三档字号）在
 * `v2/stories/harness/` 里跑，用的是**真实浏览器 + 构建产物**。
 */
const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.ts'],
  addons: [],
  framework: { name: '@storybook/vue3-vite', options: {} },
  core: { disableTelemetry: true },
}

export default config
