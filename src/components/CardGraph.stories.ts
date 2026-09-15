import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardGraph from './CardGraph.vue'
import { parseCard } from '../game/card'
import { toGraph } from '../game/card-layout'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 卡图：一张卡摊开是什么样（卡界面与组件故事共用同一个组件）。
 *
 * ⚠️ 标题里的节点数与边数只能写字面量：Storybook 建索引时**不执行**故事模块，
 *    标题里放表达式会被它拒掉（CSF: unexpected dynamic title）。所以这两个数由
 *    tests/card-ui.test.ts 拿卡里现数的结果对一遍 —— 卡改了，标题对不上就红。
 *
 * 实线 = 拓扑的先后（相邻两个节点一条）；虚线不写字 = 读上游，
 * 上游就是拓扑里排在它前面的**全部**节点（决定 #26）—— 图例走产品文案（t），
 * 中英由 Storybook 的语言开关决定。
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

/** 选中：编辑表单对着的那一个（外围用强调色描边） */
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

/** 示例卡的图：节点按拓扑排，节点框里是名字与「id · 职责摘要」 */
export const Sample: Story = {}

/** 进行中：当前节点高亮成强调色（进度只有开发者看得见，玩家侧的故事不变） */
export const Running: Story = { args: { active: nodeIds[RUNNING_INDEX] } }

/** 失败：挂掉的那个节点高亮成危险色（这一轮在这里断掉） */
export const Failed: Story = { args: { failed: nodeIds[FAILED_INDEX] } }

/** 选中：点中的那个节点加粗描边，编辑表单就对着它 */
export const Selected: Story = { args: { selected: nodeIds[SELECTED_INDEX] } }
