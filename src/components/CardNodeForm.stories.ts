import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CardNodeForm from './CardNodeForm.vue'

/**
 * 卡节点的编辑表单：名 / 职责 / 提示词可改，输出只读。
 *
 * 数据是假数据（这一层只看「填进去的字段长什么样」）——表单不认识卡，
 * 写回整张卡与校验是 CardEditor 的事。
 */
const meta = {
  title: '组件/CardNodeForm',
  component: CardNodeForm,
  args: {
    id: 'story',
    name: '故事',
    duty: '把这一轮的因果写成正文',
    prompt: ['你是这个世界的说书人。', '', '只写正文，不要解释。'],
    output: { 正文: 'string' },
    error: '',
  },
} satisfies Meta<typeof CardNodeForm>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：选中一个节点之后的样子 */
export const Default: Story = {}

/** 保存失败：校验回来的原因原样留在表单里（重名 / 空提示词都可能） */
export const SaveFailed: Story = {
  args: { error: 'card 声明.图.节点.story.名: duplicate node name "故事"' },
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
