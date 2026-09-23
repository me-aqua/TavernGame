import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import EditorShell from './EditorShell.vue'
import { parseCard } from '../game/card'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 编辑器外壳：顶栏（卡身份 / 提示词资源 / 抽屉 / 保存）· 四栏栅格（内容 · 细条 · 编辑 ·
 * 公共提示词）· 横带（≤820px 的降级形态）· 底部宽度标尺。
 *
 * ⚠️ **壳本身不认识卡的内容**：中栏编什么由 `CardEditor` 从插槽塞进来（那三态在它那边），
 *    这里只画骨架 + 把人的动作抛上去 —— 所以这几条故事量的是**骨架**，插槽留空。
 * ⚠️ **「编辑」栏那个 ＋ 是节点导向的**（加一个动作）：编枝时收起来（见 `BranchPicked`）。
 * ⚠️ 浮层式的取景归 `CardEditor.stories.ts`；这一层给它一个真实高度，否则四栏会被压成一条。
 */
const card = parseCard(cardJson)
const topology = card.graph.topology

/** 这一层要自己接住那几个事件：不接就是 Vue 的「未处理的 emit」警告，而它不拦门禁 */
const handlers = {
  onClose: fn(),
  onToggleResources: fn(),
  onSave: fn(),
  onSelect: fn(),
  onAddBranch: fn(),
  onAddAction: fn(),
  onAddStep: fn(),
}

const meta = {
  title: '组件/EditorShell',
  component: EditorShell,
  decorators: [() => ({ template: '<div class="flex h-[760px] flex-col bg-page p-3"><story /></div>' })],
  args: {
    card,
    selected: '',
    branch: '',
    meta: card.card.name + ' v' + card.card.version,
    promptsOpen: false,
    dirty: false,
    ...handlers,
  },
} satisfies Meta<typeof EditorShell>

export default meta
type Story = StoryObj<typeof meta>

/** 开屏：两条轴都空 —— 细条一项都不亮，中栏那句「还没选」，三个 ＋ 都在 */
export const Default: Story = {}

/** 点了一步：细条上那一步亮着，中栏字幕是**那一步的名字**，＋ 仍是三个 */
export const StepPicked: Story = { args: { selected: topology[0] } }

/** 编一枝：左栏那一行亮着（插槽留空，真界面里中栏是可写字段表），加动作那颗 ＋ 收起 */
export const BranchPicked: Story = {
  args: {
    branch: Object.keys(card.state)[0],
  },
}

/** 有未保存的改动：顶栏那颗「保存」可用；提示词资源那一栏点开着 */
export const Dirty: Story = { args: { selected: topology[1], dirty: true, promptsOpen: true } }

/** 英文界面下同一屏（文案长度不同，顶栏与四栏都不许被顶破） */
export const English: Story = { args: { selected: topology[0], meta: 'Morning Wind v0.1.0' } }
