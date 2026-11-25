import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PromptList from '../src/components/PromptList.vue'
import { PROMPTS } from './support/data'

/**
 * 右栏 · 公共提示词：只有块名与删除（名字点一下选中，正文在中栏改）。
 * `+` 是裸的一个加号；「开场」那一块没有 ×。
 */
const meta = {
  title: 'v2/PromptList',
  component: PromptList,
  args: { prompts: PROMPTS, selectedId: 'pr1' },
  decorators: [() => ({ template: '<div style="width: 380px; height: 420px"><story /></div>' })],
} satisfies Meta<typeof PromptList>

export default meta
type Story = StoryObj<typeof meta>

/** 三块提示词（开场 + 两块自己的），选中第二块 */
export const Filled: Story = {}

/** 只有开场那一块：它没有 × */
export const OpeningOnly: Story = { args: { prompts: [PROMPTS[0]], selectedId: null } }
