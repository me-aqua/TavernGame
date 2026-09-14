import type { StorybookConfig } from '@storybook/vue3-vite'

/**
 * Storybook 配置 —— 组件工作台。
 *
 * 定位（doc/DESIGN.md 决定 #23）：
 *   · 这里看**单个组件的渲染**（每个 props 组合、浅色深色、中英）
 *   · 整套页面的功能与视觉回归在 e2e/（Playwright）里做，两边不重复
 *   · 故事只定义「什么数据、什么状态」，不放断言 —— 断言在 e2e/stories.spec.ts
 *
 * 开发：npm run storybook（改了 src 里的组件会热更新）
 * 巡检：npm run stories（构建 + 用 Playwright 逐个故事拍照与结构检查）
 */
const config: StorybookConfig = {
  stories: ['../src/components/**/*.stories.ts'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-themes'],
  framework: { name: '@storybook/vue3-vite', options: {} },
  core: { disableTelemetry: true },
}

export default config
