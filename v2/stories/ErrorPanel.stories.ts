import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ErrorPanel from '../src/components/ErrorPanel.vue'
import { AppError } from '../src/core/errors'

/**
 * 错误条：码 + 中文一句话 + 中文下一步。
 * 三个故事对应玩家真会撞上的三类（上游连不上 / 数据坏了 / 卡带链坏了）。
 */
const meta = {
  title: 'v2/ErrorPanel',
  component: ErrorPanel,
  args: { error: new AppError('E_PROVIDER') },
} satisfies Meta<typeof ErrorPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 服务商那条路：网络 / Key / 额度 */
export const Provider: Story = { args: { error: new AppError('E_PROVIDER') } }

/** 数据坏了：坏 JSON、schemaVersion 不认、id 不存在 */
export const Validation: Story = { args: { error: new AppError('E_VALIDATION') } }

/** 链不合法：输出个数、首节点读上游之类 */
export const Chain: Story = { args: { error: new AppError('E_CHAIN') } }
