import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorkflowStrip from '../src/components/WorkflowStrip.vue'
import { CHAIN } from './support/data'

/**
 * 工作流细条：固定节点，宽度固定（不参与拖拽），点一下选中。
 * 选中某个节点时，排在它前面的每个节点旁边多一只「读」眼睛（上游只能是已经跑完的节点）。
 */
const meta = {
  title: 'v2/WorkflowStrip',
  component: WorkflowStrip,
  args: { nodes: CHAIN, selectedId: 'output', readsUpstream: ['check'] },
  decorators: [() => ({ template: '<div style="height: 260px; display: flex"><story /></div>' })],
} satisfies Meta<typeof WorkflowStrip>

export default meta
type Story = StoryObj<typeof meta>

/** 选中输出节点：前两个节点带「读」眼睛，其中判定是打开的 */
export const Default: Story = {}

/** 什么都没选：没有「读」眼睛，也没有上下游可言 */
export const NothingSelected: Story = { args: { selectedId: null, readsUpstream: [] } }
