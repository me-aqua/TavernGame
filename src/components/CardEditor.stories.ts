import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardEditor from './CardEditor.vue'
import { parseCard } from '../game/card'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 卡界面浮层：卡图 + 编辑表单（设置面板里「查看 / 编辑卡图」打开的那一层）。
 *
 * 覆盖式浮层（决定 #24），关了它下面还是原来那一屏；节点选中是内部状态，
 * 所以这张故事只展示「刚打开」的样子，表单本身有 CardNodeForm 的故事。
 */

/** 示例卡（卡图与标题里的卡名都从卡里现读） */
const card = parseCard(cardJson)

const meta = {
  title: '组件/CardEditor',
  component: CardEditor,
  args: { card, source: 'builtin' },
} satisfies Meta<typeof CardEditor>

export default meta
type Story = StoryObj<typeof meta>

/** 内置示例卡（来源写在标题下面） */
export const Builtin: Story = {}

/** 导入的卡：标题下面写着「已导入」，与设置面板里那一节一致 */
export const Imported: Story = { args: { source: 'imported' } }
