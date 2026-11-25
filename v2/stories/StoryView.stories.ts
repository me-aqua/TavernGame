import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StoryView from '../src/components/StoryView.vue'
import type { StoryItem } from '../src/components/types'
import { TURN_STATS, TRACE_OUTPUT, TRACE_TIME } from './support/data'

/**
 * 故事流时间轴：玩家行动靠右、叙事靠左；每回合末尾一行合计读数；
 * 调试开着时，每个节点还会多一张卡片（提示词组装 / 思考 / 工具调用 / 输出 / 用量与耗时）。
 * `streaming` 是本回合正在长出来的那一段（还没落盘）。
 */
const OFF: StoryItem[] = [
  { type: 'action', text: 'act one' },
  { type: 'narration', text: '[mock] turn 1: act one' },
  { type: 'turnStats', stats: TURN_STATS },
]

const ON: StoryItem[] = [
  { type: 'action', text: 'act one' },
  { type: 'trace', trace: TRACE_TIME },
  { type: 'trace', trace: TRACE_OUTPUT },
  { type: 'narration', text: '[mock] turn 1: act one' },
  { type: 'turnStats', stats: TURN_STATS },
]

const meta = {
  title: 'v2/StoryView',
  component: StoryView,
  args: { items: OFF, streaming: '' },
  decorators: [
    () => ({
      template:
        '<div style="height: 620px; width: 760px; display: flex; flex-direction: column"><story /></div>',
    }),
  ],
} satisfies Meta<typeof StoryView>

export default meta
type Story = StoryObj<typeof meta>

/** 调试关着：只有故事 + 每回合的合计读数 */
export const DebugOff: Story = {}

/** 调试开着：故事之间夹着每个节点的读数卡片 */
export const DebugOn: Story = { args: { items: ON } }

/** 第三回合正在流式输出 */
export const Streaming: Story = { args: { streaming: '[mock] turn 3: act th' } }

/** 还没开始 */
export const Empty: Story = { args: { items: [], streaming: '' } }
