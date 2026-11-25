import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateForm from '../src/components/StateForm.vue'
import { ELEMENTS } from './support/data'

/**
 * 中栏 · 选中状态元素时的那张表：名字 / 备注 / 初值。
 * 时间元素（`0`）的初值阶段 1 只读 —— 两个故事就是这两种。
 */
const meta = {
  title: 'v2/StateForm',
  component: StateForm,
  args: { element: ELEMENTS[1] },
  decorators: [() => ({ template: '<div style="width: 520px; height: 260px"><story /></div>' })],
} satisfies Meta<typeof StateForm>

export default meta
type Story = StoryObj<typeof meta>

/** 普通文本元素 */
export const Text: Story = {}

/** 时间元素：初值只读 */
export const Time: Story = { args: { element: ELEMENTS[0] } }
