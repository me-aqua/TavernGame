import type { Meta, StoryObj } from '@storybook/vue3-vite'
import GameComposer from './GameComposer.vue'

/** 输入区：配置好就能投稿，回合在飞时禁用 */
const meta = {
  title: '组件/GameComposer',
  component: GameComposer,
  decorators: [() => ({ template: '<div class="w-[640px] bg-page"><story /></div>' })],
  args: { disabled: false, configured: true },
} satisfies Meta<typeof GameComposer>

export default meta
type Story = StoryObj<typeof meta>

/** 常态 */
export const Ready: Story = {}

/** 还没配 API：输入框禁用，提示去哪配 */
export const Unconfigured: Story = { args: { configured: false, disabled: true } }

/** 回合在飞：禁用（进行中的状态由状态行表达） */
export const Running: Story = { args: { disabled: true } }
