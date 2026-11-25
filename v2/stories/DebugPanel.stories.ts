import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DebugPanel from '../src/components/DebugPanel.vue'
import { DEBUG } from './support/data'

/**
 * 对话页 `[data-debug-toggle]` 打开时的面板：逐节点（提示词 / 返回 / token / t/s / 耗时）
 * + 本回合总耗时 + 工具调用 + 用量 + **这一步用了哪个预设**。
 * 最后一格是模型住在本地映射时唯一能看见它的地方。
 */
const meta = {
  title: 'v2/DebugPanel',
  component: DebugPanel,
  args: { debug: DEBUG },
  decorators: [() => ({ template: '<div style="height: 640px; display: flex"><story /></div>' })],
} satisfies Meta<typeof DebugPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 跑完一回合：三个节点行 + 总耗时 + 三格汇总都有内容 */
export const Filled: Story = {}

/** 还没跑：只有一句话 */
export const Empty: Story = { args: { debug: null } }
