import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ModelPresetList from '../src/components/ModelPresetList.vue'
import { PRESETS } from './support/data'

/**
 * 设置页的模型预设表：名称 / Base URL / 模型 / Key（password 输入框）/ 思考强度。
 * Key 只住本机 —— 这里看到的就是玩家自己填的那一份。
 */
const meta = {
  title: 'v2/ModelPresetList',
  component: ModelPresetList,
  args: { presets: PRESETS },
  decorators: [() => ({ template: '<div style="width: 760px; height: 420px"><story /></div>' })],
} satisfies Meta<typeof ModelPresetList>

export default meta
type Story = StoryObj<typeof meta>

/** 新装的两条 DeepSeek（Key 空着：绝不内置任何 Key） */
export const Two: Story = {}

/** 用户把预设删光了 */
export const Empty: Story = { args: { presets: [] } }
