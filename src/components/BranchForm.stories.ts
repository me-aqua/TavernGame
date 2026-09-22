import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BranchForm from './BranchForm.vue'

/**
 * 中栏那张**可写字段表**：选中那一格的每一个字段一行 —— 卡里的键名 · 界面词的类型 ·
 * 说明（可编）· 开局在不在（`initial` 那一列）· 行尾一颗垃圾桶；表尾一行「＋ 加一个字段」。
 *
 * 数据是假数据（这一层只看「填进去的行长什么样」）——真的行由 `CardEditor` 从 `card.state`
 * 现算：`object` 读自己的 `fields`，`map` / `list` 读**元素形状**的 `of.fields`；
 * 草稿、待删、报错也都是它传进来的（这一层只抛事件）。
 */
const meta = {
  title: '组件/BranchForm',
  component: BranchForm,
  args: {
    path: 'lead',
    rows: [
      { key: '名称', kind: 'string', hasInitial: true, taken: false, note: '玩家角色的名字' },
      { key: '固有', kind: 'object', hasInitial: false, taken: false, note: '' },
      { key: '关系', kind: 'list', hasInitial: true, taken: false, note: '{"好感": 80} 这种一条一个' },
      { key: 'pack', kind: 'list', hasInitial: true, taken: false, note: '' },
      { key: '当下', kind: 'object', hasInitial: true, taken: false, note: '' },
    ],
    gone: [],
    badKeys: [],
    failed: false,
    fresh: null,
  },
} satisfies Meta<typeof BranchForm>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：第一层那一枝（五行，初值有与没有都在，说明有的填了有的空着） */
export const Default: Story = {}

/** 元素形状那一格：表的行来自 `of.fields`，这一格自己的键一个都不在表里 */
export const ElementShape: Story = {
  args: {
    path: 'roles.*',
    rows: [
      { key: '种族', kind: 'string', hasInitial: false, taken: false, note: '' },
      { key: '身份', kind: 'string', hasInitial: false, taken: false, note: '' },
      { key: '本事', kind: 'list', hasInitial: false, taken: false, note: '' },
      { key: '关系', kind: 'list', hasInitial: false, taken: false, note: '' },
    ],
  },
}

/** 引擎接管的那一格：整行不可写（没有框、没有垃圾桶，行尾写「引擎接管」） */
export const EngineOwned: Story = {
  args: {
    path: 'world.time',
    rows: [
      { key: 'year', kind: 'integer', hasInitial: false, taken: true, note: '' },
      { key: 'month', kind: 'integer', hasInitial: false, taken: true, note: '' },
      { key: 'day', kind: 'integer', hasInitial: false, taken: true, note: '' },
      { key: 'hour', kind: 'integer', hasInitial: false, taken: true, note: '' },
      { key: 'minute', kind: 'integer', hasInitial: false, taken: true, note: '' },
    ],
  },
}

/** 编辑中：一行待删（字划掉）+ 一行刚开出来还没保存的新行（四格 + 一颗取消） */
export const Editing: Story = {
  args: {
    gone: ['关系'],
    fresh: { key: 'test_field', kind: 'string', note: '', initial: '' },
  },
}

/** 保存被拒：整条原因是 `[data-card-error]`（在外壳那一层），行上的标记指出是哪一行 */
export const Refused: Story = {
  args: {
    failed: true,
    badKeys: ['pack'],
    fresh: { key: 'test_field', kind: 'integer', note: '', initial: 'abc' },
  },
}

/** 一行都没有的格子：今天到不了（8b 不新建枝），留着给 8e 看表头长什么样 */
export const NoFields: Story = {
  args: { path: 'lead.pack.*', rows: [] },
}
