import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardGraph from './CardGraph.vue'
import { parseCard } from '../game/card'
import { toGraph } from '../game/card-layout'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 卡图：一张卡摊开是什么样（卡界面、调试面板与组件故事共用同一个组件）。
 *
 * ⚠️ 标题里的节点数与边数只能写字面量：Storybook 建索引时**不执行**故事模块，
 *    标题里放表达式会被它拒掉（CSF: unexpected dynamic title）。所以这两个数由
 *    tests/card-layout.test.ts 拿卡里现数的结果对一遍 —— 卡改了，标题对不上就红。
 *
 * 读法（设计 13.1.1）：默认只有一条主干链（实线 + 折行点上的序号）；
 * 点中一个节点才画出它自己的上游虚线（上游 = 拓扑前缀），其余节点淡出。
 * 节点框里带序号与声明（role / tools / reads）—— 中英由 Storybook 的语言开关决定。
 *
 * 高亮故事从卡里**现取**节点 id：写死一个 id 会在卡改名后指到一个不存在的节点。
 */

/** 示例卡（故事的节点、名字与职责都从卡里现取，不在这里抄一份内容） */
const card = parseCard(cardJson)

/** 示例卡的节点 id，按拓扑顺序 */
const nodeIds = toGraph(card).nodes.map((node) => node.id)

/** 进行中：跑到第 5 个节点（拓扑下标 4）—— 前面的已经跑完，后面的还没轮到 */
const RUNNING_INDEX = 4

/** 失败：第 3 个节点（拓扑下标 2）跑挂了 */
const FAILED_INDEX = 2

/** 选中：编辑表单对着的那一个（外围用强调色描边，同时画出它的上游虚线） */
const SELECTED_INDEX = 1

const meta = {
  title: '组件/CardGraph（9 节点 / 44 边）',
  component: CardGraph,
  args: { card },
  decorators: [
    () => ({
      template:
        '<div class="bg-page p-3"><p class="mb-2 text-xs text-muted">{{ $t(\'card.graphLegend\') }}</p><story /></div>',
    }),
  ],
} satisfies Meta<typeof CardGraph>

export default meta
type Story = StoryObj<typeof meta>

/** 示例卡的图：节点按拓扑排成一条链，折行点带序号，框里是序号、名字、职责与声明 */
export const Sample: Story = {}

/** 进行中：正在跑的那个节点高亮成强调色（进度只有开发者看得见，玩家侧的故事不变） */
export const Running: Story = { args: { active: nodeIds[RUNNING_INDEX] } }

/** 失败：退回过 / 工具调用失败过的节点标红（调试面板的活卡图就是它） */
export const Failed: Story = { args: { failed: [nodeIds[FAILED_INDEX]] } }

/** 选中：点中的节点加粗描边，并画出它自己的上游虚线（上游 = 拓扑前缀） */
export const Selected: Story = { args: { selected: nodeIds[SELECTED_INDEX] } }
