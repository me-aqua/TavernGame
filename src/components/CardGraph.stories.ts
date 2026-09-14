import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardGraph from './CardGraph.vue'
import { parseCard } from '../game/card'
import { toGraph } from '../dev/card-graph'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 卡图：一张卡摊开是什么样（作者 / 调试工具，只在 Storybook 与 dev 里用）。
 *
 * ⚠️ 标题里的节点数与边数只能写字面量：Storybook 建索引时**不执行**故事模块，
 *    标题里放表达式会被它拒掉（CSF: unexpected dynamic title）。所以这两个数由
 *    tests/components.test.ts 拿卡里现数的结果对一遍 —— 卡改了，标题对不上就红。
 *
 * 实线是拓扑的先后；标「读」的虚线是谁读了谁的产出（「节点约定」里逐行写明的上游）。
 *
 * 高亮故事从卡里**现取**节点 id：写死一个 id 会在卡改名后指到一个不存在的节点。
 */

/** 示例卡的节点 id，按拓扑顺序 */
const nodeIds = toGraph(parseCard(cardJson)).nodes.map((node) => node.id)

/** 进行中：跑到第 5 个节点（拓扑下标 4）—— 前面的已经跑完，后面的还没轮到 */
const RUNNING_INDEX = 4

/** 失败：第 3 个节点（拓扑下标 2）跑挂了 */
const FAILED_INDEX = 2

const meta = {
  title: '组件/CardGraph（9 节点 / 43 边）',
  component: CardGraph,
} satisfies Meta<typeof CardGraph>

export default meta
type Story = StoryObj<typeof meta>

/** 示例卡的图：节点按拓扑排，节点框里是名字与「id · 职责摘要」 */
export const Sample: Story = {}

/** 进行中：当前节点高亮成强调色（进度只有开发者看得见，玩家侧的故事不变） */
export const Running: Story = { args: { active: nodeIds[RUNNING_INDEX] } }

/** 失败：挂掉的那个节点高亮成危险色（这一轮在这里断掉） */
export const Failed: Story = { args: { failed: nodeIds[FAILED_INDEX] } }
