import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardNodeForm from './CardNodeForm.vue'
import { parseCard } from '../game/card'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 卡节点的编辑表单：名 / 职责 / 提示词可改，声明（role / tools / reads / uses）只读，
 * **勾选区**决定这个节点读哪几块资源。
 *
 * 数据是假数据（这一层只看「填进去的字段长什么样」）——表单不认识卡：两列的名单与写回
 * 整份卡都是 CardEditor 的事。名单从示例卡现取，卡改了故事跟着改。
 */
const card = parseCard(cardJson)
const settingKeys = Object.keys(card.settings)
const generatorNames = card.generators.map((generator) => generator.name)

const meta = {
  title: '组件/CardNodeForm',
  component: CardNodeForm,
  args: {
    id: 'story',
    name: '故事',
    duty: '把这一轮的因果写成正文',
    prompt: ['你是这个世界的说书人。', '', '只写正文，不要解释。'],
    role: 'story',
    tools: [],
    reads: ['world', 'roles', 'lead'],
    uses: null,
    settings: null,
    settingKeys,
    generatorNames,
    error: '',
  },
} satisfies Meta<typeof CardNodeForm>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：故事节点（role: story、不给工具、没写 settings ⇒ 五块全勾） */
export const Default: Story = {}

/** 能做事的节点：tools / reads / uses 都有值时那几行长什么样；勾选区里点掉了一条生成器 */
export const WithTools: Story = {
  args: {
    id: 'map',
    name: '地图',
    duty: '维护世界的空间',
    role: null,
    tools: ['add_place', 'set_whereabouts'],
    reads: ['world', 'roles', 'lead'],
    // ⚠️ 只点一条：`uses` 那行与勾选区是同一件事的两面，两处对不上就是假数据
    uses: [generatorNames[0]],
  },
}

/** 写了声明的节点：`settings` 里没有 `style` —— 勾选区照它少勾一枚（这张卡的常态） */
export const DeclaredSettings: Story = {
  args: {
    id: 'judge',
    name: '行动判定',
    duty: '判定玩家这一轮的行动在这个世界里成不成、代价是什么',
    role: null,
    settings: settingKeys.filter((key) => key !== 'style'),
  },
}

/** 保存失败：校验回来的原因原样留在表单里（重名 / 空提示词都可能） */
export const SaveFailed: Story = {
  args: { error: 'graph.nodes.story.name: duplicate node name "故事"' },
}

/** 长提示词：多行文本框自己滚，表单不许被撑破 */
export const LongPrompt: Story = {
  args: {
    prompt: Array.from(
      { length: 12 },
      (_, i) => '第 ' + (i + 1) + ' 行：这一行只是用来把多行文本框撑满，看看滚动起来什么样。',
    ),
  },
}
