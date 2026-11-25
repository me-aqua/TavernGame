import type { Meta, StoryObj } from '@storybook/vue3-vite'
import PromptList from '../src/components/PromptList.vue'
import { OUTPUT_NODE, PROMPTS } from './support/data'

/**
 * 右栏 · 公共提示词：块名 + 读眼睛 + 删除（名字点一下选中，正文在中栏改）。
 * `+` 是裸的一个加号；「开场」那一块没有 ×。眼睛只在选中了节点时出现。
 */
const meta = {
  title: 'v2/PromptList',
  component: PromptList,
  args: { prompts: PROMPTS, selectedId: 'pr1', node: OUTPUT_NODE },
  decorators: [() => ({ template: '<div style="width: 380px; height: 420px"><story /></div>' })],
} satisfies Meta<typeof PromptList>

export default meta
type Story = StoryObj<typeof meta>

/** 选中了输出节点：每块一只读眼睛，选中块带边框 */
export const Filled: Story = {}

/** 没选节点：没有读眼睛（没有「谁读」可言），开场那一块也没有 × */
export const NoNodeSelected: Story = { args: { node: null, selectedId: null } }
