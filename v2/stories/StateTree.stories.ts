import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateTree from '../src/components/StateTree.vue'
import { CHECK_NODE, ELEMENTS, OUTPUT_NODE } from './support/data'

/**
 * 左栏状态树：一行只有编号 / 名字 / 【读】【写】/ 加子元素 / 删除（初始值与当前值不在这里显示），
 * 控件按 S1 / S2 的矩阵出现 ——
 * S1（选中节点）每行两只文字按钮【读】【写】（父行三态），S2（选中元素）有 + / 加子元素 / ×。
 * 写眼睛只看 `writable`：普通节点与时间节点每行都有（时间元素 `0` 也有），输出节点一只都没有。
 */
const meta = {
  title: 'v2/StateTree',
  component: StateTree,
  args: { elements: ELEMENTS, node: OUTPUT_NODE, selectedCode: null },
  decorators: [
    () => ({ template: '<div style="width: 300px; height: 260px; display: flex"><story /></div>' }),
  ],
} satisfies Meta<typeof StateTree>

export default meta
type Story = StoryObj<typeof meta>

/** S1：选中了输出节点 —— 每行只有「读」眼睛（输出节点不写状态） */
export const WithOutputNode: Story = {}

/** S1：选中了判定节点 —— 每行两只眼睛 */
export const WithNormalNode: Story = { args: { node: CHECK_NODE } }

/** S0：什么都没选 —— 只有编号与名字 */
export const NoNodeSelected: Story = { args: { node: null, selectedCode: null } }

/** S2：选中了元素 1 —— 栏顶有 +，行内有加子元素与 ×（时间那行没有） */
export const ElementSelected: Story = { args: { node: null, selectedCode: '1' } }
