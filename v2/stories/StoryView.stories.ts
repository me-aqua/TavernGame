import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StoryView from '../src/components/StoryView.vue'
import type { StoryItem } from '../src/components/types'
import { TURN_STATS, TRACE_OUTPUT, TRACE_TIME } from './support/data'

/**
 * 故事流时间轴：行动与叙事同一版式（左对齐、同字号），块与块之间一条虚线分隔；
 * 每回合末尾一行合计读数；调试开着时，每个节点还会多一张卡片
 * （提示词组装 / 思考 / 工具调用 / 输出 / 用量与耗时）。
 * `streaming` 是本回合正在长出来的那一段（还没落盘）；
 * `generating` 是第一段正文还没到时的「生成中……」那一行（与 `streaming` 互斥）。
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

/** 本回合还没落盘的那句行动（乐观副本：靠右的同一颗气泡，带 `pending`） */
const PENDING: StoryItem[] = [{ type: 'action', text: 'act three', pending: true }]

const meta = {
  title: 'v2/StoryView',
  component: StoryView,
  args: { items: OFF, streaming: '', generating: false },
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

/** 第三回合正在流式输出：乐观行动气泡留着，下面长正文 */
export const Streaming: Story = { args: { items: PENDING, streaming: '[mock] turn 3: act th' } }

/** 刚发出行动、第一段正文还没到：行动气泡下面一行「生成中……」 */
export const Waiting: Story = { args: { items: PENDING, generating: true } }

/** 还没开始 */
export const Empty: Story = { args: { items: [], streaming: '' } }
