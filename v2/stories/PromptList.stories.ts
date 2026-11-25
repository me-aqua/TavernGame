import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PromptList from '../src/components/PromptList.vue'
import { OUTPUT_NODE, PROMPTS } from './support/data'

/**
 * 右栏 · 公共提示词：每块前面一只「读」眼睛（当前选中的节点读不读它），块可以增删改。
 */
const meta = {
  title: 'v2/PromptList',
  component: PromptList,
  args: { prompts: PROMPTS, node: OUTPUT_NODE },
  decorators: [() => ({ template: '<div style="width: 380px; height: 420px"><story /></div>' })],
} satisfies Meta<typeof PromptList>

export default meta
type Story = StoryObj<typeof meta>

/** 两块提示词，输出节点读第一块 */
export const Filled: Story = {}

/** 一块都没有：只有新增按钮 */
export const Empty: Story = { args: { prompts: [], node: null } }
