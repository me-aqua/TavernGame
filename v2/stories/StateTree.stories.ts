import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateTree from '../src/components/StateTree.vue'
import { ELEMENTS, OUTPUT_NODE } from './support/data'

/**
 * 左栏状态树：行内两只会「眼睛」（读 / 写），只在选中了工作流节点时出现。
 * 两个故事就是这两种形态 —— 有节点时看得见眼睛，没节点时看不见（也没有意义）。
 */
const meta = {
  title: 'v2/StateTree',
  component: StateTree,
  args: { elements: ELEMENTS, node: OUTPUT_NODE, selectedCode: '1' },
  decorators: [
    () => ({ template: '<div style="width: 280px; height: 260px; display: flex"><story /></div>' }),
  ],
} satisfies Meta<typeof StateTree>

export default meta
type Story = StoryObj<typeof meta>

/** 选中了输出节点：每行两只眼睛（这一行的值进提示词 / 可写） */
export const WithNodeSelected: Story = {}

/** 没选节点：眼睛不出现（它们说的是「当前这个节点」读/写什么） */
export const NoNodeSelected: Story = { args: { node: null, selectedCode: null } }
