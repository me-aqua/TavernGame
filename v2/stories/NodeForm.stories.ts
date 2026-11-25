import type { Meta, StoryObj } from '@storybook/vue3-vite'
import NodeForm from '../src/components/NodeForm.vue'
import { OUTPUT_NODE, PRESETS, PROMPTS, TIME_NODE } from './support/data'

/**
 * 中栏 · 选中节点时的那张表：模型预设（本地映射，不进卡）、历史回合数、上游眼睛、
 * 读哪几块公共提示词、节点提示词。三种形态各一个故事：普通节点 / 首节点（上游眼睛禁用）/ 一个预设都没有。
 */
const meta = {
  title: 'v2/NodeForm',
  component: NodeForm,
  args: { node: OUTPUT_NODE, isFirst: false, presets: PRESETS, presetId: PRESETS[0].id, prompts: PROMPTS },
  decorators: [() => ({ template: '<div style="width: 520px; height: 420px"><story /></div>' })],
} satisfies Meta<typeof NodeForm>

export default meta
type Story = StoryObj<typeof meta>

/** 输出节点：读上游、历史 3 回合、读第一块提示词 */
export const Output: Story = {}

/** 首节点：上游眼睛 `aria-disabled`，点了也不翻面 */
export const FirstNode: Story = { args: { node: TIME_NODE, isFirst: true, presetId: PRESETS[1].id } }

/** 一个预设都没有：那一格禁用，不另挂提示文案 */
export const NoPreset: Story = { args: { presets: [], presetId: '' } }
