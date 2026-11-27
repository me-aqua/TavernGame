import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateForm from '../src/components/StateForm.vue'
import { ELEMENTS } from './support/data'

/**
 * 中栏 · 选中状态元素时的那张表：类型 / 名字 / 备注 / 类型自己的格子 / 初始值。
 * 四个故事各演一种类型：文字（一个初值框）、数字（上下限与步幅）、下拉（白名单 + 初值下拉）、
 * 时间（第一行「类型」就是模式下拉；初值按模式 5 / 3 / 3 格 + 三个节日勾选）。
 *
 * 初始值只挂在**根元素**上，所以这一层要同时给 `element` 与它所在的 `state`：
 * 根元素页才会渲染初始值块（每一条值路径一行，带编号 / 中文名 / 值）。
 */
const meta = {
  title: 'v2/StateForm',
  component: StateForm,
  args: { element: ELEMENTS[2], state: ELEMENTS },
  decorators: [() => ({ template: '<div style="width: 520px; height: 320px"><story /></div>' })],
} satisfies Meta<typeof StateForm>

export default meta
type Story = StoryObj<typeof meta>

/** 普通文本元素 */
export const Text: Story = {}

/** 数字元素：上下限 + 单次步幅 + 初始值 */
export const Integer: Story = { args: { element: ELEMENTS[4] } }

/** 下拉元素：白名单一行一个，初始值从白名单里选 */
export const Enum: Story = { args: { element: ELEMENTS[1] } }

/** 时间元素：第一行「类型」就是模式选择；初值按模式给格子，另有三个节日勾选 */
export const Time: Story = { args: { element: ELEMENTS[0] } }
