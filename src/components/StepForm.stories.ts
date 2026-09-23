import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import StepForm from './StepForm.vue'
import { parseCard } from '../game/card'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 中栏那一屏「编一步」：**这一步声明了的**每一个键一块 —— 名字 / 职责 / 主提示词可编，
 * 三栏（能用哪些动作 / 看得见哪几枝 / 吃哪几块设定）是**候选 + 挑中**的勾选框，
 * `role` 与节点 id 只读；`settings` 那一栏只剩一块时锁住（空表过不了卡的校验）。
 *
 * ⚠️ **值是从真卡里取的**（这一屏的每一个字都来自 `graph.nodes[id]`），但**真源不在这里**：
 *    值与草稿都由 `CardEditor` 现算（`cardDraft()` 与 `roster`），这一层只画 + 抛事件。
 *    下面那个 `argsOf()` 照它那两条读法拼一份没改过时的样子。
 */
const card = parseCard(cardJson)

/** 卡里一步**没改过**时长什么样 —— 与 `CardEditor` 的 `cardDraft()` / `roster` 同一条读法 */
function argsOf(id: string) {
  const node = card.graph.nodes[id]
  return {
    card,
    id,
    roster: {
      tools: Object.keys(card.actions),
      reads: Object.keys(card.state),
      settings: Object.keys(card.settings),
    },
    name: node.name,
    duty: node.duty,
    prompt: node.prompt.join('\n'),
    tools: [...(node.tools ?? Object.keys(card.actions))],
    reads: [...(node.reads ?? Object.keys(card.state))],
    settings: [...(node.settings ?? [])],
  }
}

/** 这一层要自己接住两个事件：不接就是 Vue 的「未处理的 emit」警告，而它不拦门禁 */
const handlers = { onText: fn(), onPick: fn() }

const meta = {
  title: '组件/StepForm',
  component: StepForm,
  args: { ...argsOf('map'), ...handlers },
} satisfies Meta<typeof StepForm>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：给得出动作、看得见三枝、吃四块设定的那一步 */
export const Default: Story = {}

/** 一个动作都不给的那一步（`tools: []`）：候选一个不少，一个都不勾 */
export const NoTools: Story = { args: argsOf('judge') }

/** 叙事那一步：多一块**只读**的 `role`（全卡恰好一步有它） */
export const StoryStep: Story = { args: argsOf('story') }

/** 吃了四块设定里的三块：勾选那一栏两种状态都在（勾着 / 没勾） */
export const SomeSettings: Story = { args: { ...argsOf('map'), settings: ['world', 'core', 'common'] } }

/** 只剩一块设定：那一枚锁住，下面挂一句为什么（空表过不了卡的校验） */
export const LastBlock: Story = { args: { ...argsOf('map'), settings: ['world'] } }

/** 最长的那条主提示词（31 行）：多行框自己滚，那一屏不许被撑破 */
export const LongPrompt: Story = { args: argsOf('psych') }
