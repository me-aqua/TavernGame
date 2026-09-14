import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardGraph from './CardGraph.vue'

/**
 * 卡图：一张卡摊开是什么样（作者 / 调试工具，只在 Storybook 与 dev 里用）。
 *
 * ⚠️ 标题里的节点数与边数只能写字面量：Storybook 建索引时**不执行**故事模块，
 *    标题里放表达式会被它拒掉（CSF: unexpected dynamic title）。所以这两个数由
 *    tests/components.test.ts 拿卡里现数的结果对一遍 —— 卡改了，标题对不上就红。
 *
 * 实线是拓扑的先后；标「读」的虚线是谁读了谁的产出（「节点约定」里逐行写明的上游）。
 */
const meta = {
  title: '组件/CardGraph（9 节点 / 43 边）',
  component: CardGraph,
} satisfies Meta<typeof CardGraph>

export default meta
type Story = StoryObj<typeof meta>

/** 示例卡的图：节点按拓扑排，节点框里是名字与「id · 职责摘要」 */
export const Sample: Story = {}
