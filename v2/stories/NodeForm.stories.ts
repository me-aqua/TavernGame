import type { Meta, StoryObj } from '@storybook/vue3-vite'
import NodeForm from '../src/components/NodeForm.vue'
import { OUTPUT_NODE, PRESETS, TIME_NODE } from './support/data'

/**
 * 中栏 · 选中节点时的那张表：模型预设（本地映射，不进卡）、读取历史回合、节点提示词。
 * 读哪几块提示词在右栏、读哪些上游节点在细条 —— 这张表里不再有眼睛。
 */
const meta = {
  title: 'v2/NodeForm',
  component: NodeForm,
  args: { node: OUTPUT_NODE, presets: PRESETS, presetId: PRESETS[0].id },
  decorators: [() => ({ template: '<div style="width: 520px; height: 420px"><story /></div>' })],
} satisfies Meta<typeof NodeForm>

export default meta
type Story = StoryObj<typeof meta>

/** 输出节点：历史 3 回合、有节点提示词 */
export const Output: Story = {}

/** 时间节点：另一条预设 */
export const TimeNode: Story = { args: { node: TIME_NODE, presetId: PRESETS[1].id } }

/** 一个预设都没有：那一格禁用，不另挂提示文案 */
export const NoPreset: Story = { args: { presets: [], presetId: '' } }
