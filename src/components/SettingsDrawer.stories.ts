import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SettingsDrawer from './SettingsDrawer.vue'

/** 设置面板：服务商、key、地址、模型、步数、语言、存档操作 */
const meta = {
  title: '组件/SettingsDrawer',
  component: SettingsDrawer,
  args: { open: true, language: 'system', theme: 'system' },
} satisfies Meta<typeof SettingsDrawer>

export default meta
type Story = StoryObj<typeof meta>

/** 打开着（常态） */
export const Open: Story = {}

/** 英语界面下的同一块面板 */
export const EnglishUi: Story = { args: { language: 'en', theme: 'system' } }

/**
 * 关着：组件自己什么都不渲染（调用方用 v-model:open 控制）。
 * 这里给个空背景，让这一屏不是「空白页面」—— 结构探针才有东西可量。
 */
export const Closed: Story = {
  args: { open: false, theme: 'system' },
  decorators: [() => ({ template: '<div class="h-[240px] bg-page"></div>' })],
}
