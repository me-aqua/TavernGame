import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BranchForm from './BranchForm.vue'

/**
 * 中栏那张**只读字段表**：选中那一格的每一个字段一行 —— 卡里的键名 · 界面词的类型 ·
 * 开局在不在（`initial` 那一列）。本票一个可编辑控件都不开（说明框 / 垃圾桶 / 加字段是 8b-②）。
 *
 * 数据是假数据（这一层只看「填进去的行长什么样」）——真的行由 `CardEditor` 从 `card.state`
 * 现算：`object` 读自己的 `fields`，`map` / `list` 读**元素形状**的 `of.fields`。
 */
const meta = {
  title: '组件/BranchForm',
  component: BranchForm,
  args: {
    path: 'lead',
    rows: [
      { key: '名称', kind: 'string', hasInitial: true, taken: false },
      { key: '固有', kind: 'object', hasInitial: false, taken: false },
      { key: '关系', kind: 'list', hasInitial: true, taken: false },
      { key: 'pack', kind: 'list', hasInitial: true, taken: false },
      { key: '当下', kind: 'object', hasInitial: true, taken: false },
    ],
  },
} satisfies Meta<typeof BranchForm>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：第一层那一枝（五行，初值有与没有都在） */
export const Default: Story = {}

/** 元素形状那一格：表的行来自 `of.fields`，这一格自己的键一个都不在表里 */
export const ElementShape: Story = {
  args: {
    path: 'roles.*',
    rows: [
      { key: '种族', kind: 'string', hasInitial: false, taken: false },
      { key: '身份', kind: 'string', hasInitial: false, taken: false },
      { key: '本事', kind: 'list', hasInitial: false, taken: false },
      { key: '关系', kind: 'list', hasInitial: false, taken: false },
    ],
  },
}

/** 引擎接管的那一格：整行只读的标记与「本票暂未开放」不是同一个（行尾多一枚「引擎接管」） */
export const EngineOwned: Story = {
  args: {
    path: 'world.time',
    rows: [
      { key: 'year', kind: 'integer', hasInitial: false, taken: true },
      { key: 'month', kind: 'integer', hasInitial: false, taken: true },
      { key: 'day', kind: 'integer', hasInitial: false, taken: true },
      { key: 'hour', kind: 'integer', hasInitial: false, taken: true },
      { key: 'minute', kind: 'integer', hasInitial: false, taken: true },
    ],
  },
}

/** 一行都没有的格子：今天到不了（8b 不新建枝），留着给 8e 看表头长什么样 */
export const NoFields: Story = {
  args: { path: 'lead.pack.*', rows: [] },
}
