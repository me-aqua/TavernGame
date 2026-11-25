import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateTree from '../src/components/StateTree.vue'
import { ELEMENTS, OUTPUT_NODE } from './support/data'

/**
 * 左栏状态树：控件按 S0–S3 的矩阵出现 —— S1（选中节点）有眼睛，S2（选中元素）有 + 和 ×。
 */
const meta = {
  title: 'v2/StateTree',
  component: StateTree,
  args: { elements: ELEMENTS, node: OUTPUT_NODE, selectedCode: null },
  decorators: [
    () => ({ template: '<div style="width: 280px; height: 260px; display: flex"><story /></div>' }),
  ],
} satisfies Meta<typeof StateTree>

export default meta
type Story = StoryObj<typeof meta>

/** S1：选中了输出节点 —— 每行两只眼睛 */
export const WithNodeSelected: Story = {}

/** S0：什么都没选 —— 只有编码与名字 */
export const NoNodeSelected: Story = { args: { node: null, selectedCode: null } }

/** S2：选中了元素 1 —— 栏顶有 +，每行都有 ×（`0` 那行没有） */
export const ElementSelected: Story = { args: { node: null, selectedCode: '1' } }
