import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PromptForm from '../src/components/PromptForm.vue'
import { PROMPTS } from './support/data'

/**
 * 中栏 · 选中一块公共提示词时的那张表：名字 + 正文。
 * 两个故事：有正文的那一块 / 空正文的「开场」。
 */
const meta = {
  title: 'v2/PromptForm',
  component: PromptForm,
  args: { prompt: PROMPTS[1] },
  decorators: [() => ({ template: '<div style="width: 520px; height: 320px"><story /></div>' })],
} satisfies Meta<typeof PromptForm>

export default meta
type Story = StoryObj<typeof meta>

/** 有正文的一块 */
export const Filled: Story = {}

/** 「开场」：正文还是空的 */
export const Opening: Story = { args: { prompt: PROMPTS[0] } }
