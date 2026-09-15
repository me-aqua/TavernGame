import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardNodeForm from './CardNodeForm.vue'

/**
 * 卡节点的编辑表单：名 / 职责 / 提示词可改，声明（role / tools / reads / uses）只读。
 *
 * 数据是假数据（这一层只看「填进去的字段长什么样」）——表单不认识卡，
 * 写回整份卡与校验是 CardEditor 的事。
 */
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
    error: '',
  },
} satisfies Meta<typeof CardNodeForm>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：故事节点（role: story、不给工具、只读三块状态） */
export const Default: Story = {}

/** 能做事的节点：tools / reads / uses 都有值时那几行长什么样 */
export const WithTools: Story = {
  args: {
    id: 'map',
    name: '地图',
    duty: '维护世界的空间',
    role: null,
    tools: ['move_to', 'add_place', 'set_whereabouts'],
    reads: ['world', 'roles', 'lead'],
    uses: ['填充晨风镇', '生成地牢新层'],
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
