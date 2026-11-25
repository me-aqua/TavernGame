import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorkflowStrip from '../src/components/WorkflowStrip.vue'
import { CHAIN } from './support/data'

/**
 * 工作流细条：固定四节点，宽度固定（不参与拖拽），点一下选中。
 */
const meta = {
  title: 'v2/WorkflowStrip',
  component: WorkflowStrip,
  args: { nodes: CHAIN, selectedId: 'output' },
  decorators: [() => ({ template: '<div style="height: 260px; display: flex"><story /></div>' })],
} satisfies Meta<typeof WorkflowStrip>

export default meta
type Story = StoryObj<typeof meta>

/** 选中输出节点 */
export const Default: Story = {}

/** 什么都没选 */
export const NothingSelected: Story = { args: { selectedId: null } }
