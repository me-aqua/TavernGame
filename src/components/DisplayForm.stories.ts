import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import DisplayForm from './DisplayForm.vue'
import { parseCard } from '../game/card'
import cardJson from '../../cards/morningwind.json?raw'
import emptyJson from '../../cards/long-night.json?raw'

/**
 * 中栏那一屏「编一块显示」：`display.sidebar[]` 一条声明一行（第几条 + 它的 `path`），点一条 ⇒
 * 下面那屏编**那一条的四个键**（`path` / `title` 是打字，`format` / `side` 从词表里挑）；表尾一颗「＋」；
 * 卡里一条都没声明时先说一句「没有这一块」。
 *
 * ⚠️ **列表与选中号都取自真卡**，但**真源不在这里**：值与草稿由 `CardEditor` 经 `useDisplayDraft`
 *    现算（这一层只画 + 抛事件）⇒ 下面那份 `args` 照它那条读法拼（`entries` 就是卡里那一条数组）。
 * ⚠️ **这一屏没有「删除」那一态**：本票只加不减（S0 裁决 2）。
 */
const card = parseCard(cardJson)
/** 一条都没声明的那张卡（`sidebar: []` 是合法声明）—— 空态那一屏用它 */
const emptyCard = parseCard(emptyJson)

/** 这一层要自己接住三个事件：不接就是 Vue 的「未处理的 emit」警告，而它不拦门禁 */
const handlers = { onPick: fn(), onField: fn(), onAdd: fn() }

const meta = {
  title: '组件/DisplayForm',
  component: DisplayForm,
  args: { entries: card.display.sidebar, at: null, ...handlers },
} satisfies Meta<typeof DisplayForm>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：示例卡那六条按声明序排开，**一条都没选**（明细整块不在 —— 开屏不自动选） */
export const Default: Story = {}

/** 选中第 4 条（`lead.pack`：list / right）：明细那四个键就是它 */
export const Picked: Story = { args: { at: 3 } }

/** 选中最后一条（`lead.当下`：key-value / right）：两个下拉的取值与上一条不同 */
export const PickedLast: Story = { args: { at: 5 } }

/** 卡里一条都没声明：先说一句「没有这一块」，那颗「＋」照样在 */
export const EmptyCard: Story = { args: { entries: emptyCard.display.sidebar } }
