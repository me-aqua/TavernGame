import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StateTreeNav from './StateTreeNav.vue'

/**
 * 左栏那棵**枝树**：卡声明里那些「能编」的容器节点（有非空字段表的 `object` / `map` / `list`），
 * 一节点一行、缩进照层级；点一行就在中栏编它。
 *
 * 数据是假数据（这一层只看「填进去的行长什么样」）——真的行由 `CardEditor` 从 `card.state`
 * 现算，因为「什么进树」是卡的知识，不该有第二份。下面这些路径与示例卡里的一致，只是取了一截。
 */
const rows = [
  { path: 'lead', kind: 'object', taken: false },
  { path: 'roles', kind: 'map', taken: false },
  { path: 'world', kind: 'object', taken: false },
  { path: 'player', kind: 'object', taken: false },
  { path: 'lead.固有', kind: 'object', taken: false },
  { path: 'lead.关系', kind: 'list', taken: false },
  { path: 'world.map', kind: 'map', taken: false },
  { path: 'world.谁在哪', kind: 'map', taken: false },
  { path: 'world.time', kind: 'object', taken: true },
  { path: 'world.map.*', kind: 'object', taken: false },
  { path: 'world.map.*.一层', kind: 'object', taken: false },
]

const meta = {
  title: '组件/StateTreeNav',
  component: StateTreeNav,
  args: { rows, picked: '' },
} satisfies Meta<typeof StateTreeNav>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：还没选任何一格（一行都不亮） */
export const Default: Story = {}

/** 选中的那一行：左竖条 + 加粗 + 强调色（不只靠颜色） */
export const Picked: Story = {
  args: { picked: 'world.map' },
}

/** 选到引擎接管的那一格：它按「只读 ＝ 左竖条 + 灰字」的长相画，照样点得开 */
export const EngineOwned: Story = {
  args: { picked: 'world.time' },
}
