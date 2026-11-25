import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StoryView from '../src/components/StoryView.vue'

/**
 * 故事流：玩家行动靠右、叙事靠左；`streaming` 是本回合正在长出来的那一段（还没落盘）。
 */
const LINES = [
  { type: 'action' as const, text: 'act one' },
  { type: 'narration' as const, text: '[mock] turn 1: act one' },
  { type: 'action' as const, text: 'act two' },
  { type: 'narration' as const, text: '[mock] turn 2: act two' },
]

const meta = {
  title: 'v2/StoryView',
  component: StoryView,
  args: { lines: LINES, streaming: '' },
  decorators: [
    () => ({
      template:
        '<div style="height: 420px; width: 720px; display: flex; flex-direction: column"><story /></div>',
    }),
  ],
} satisfies Meta<typeof StoryView>

export default meta
type Story = StoryObj<typeof meta>

/** 两个跑完的回合 */
export const Turns: Story = {}

/** 第三回合正在流式输出 */
export const Streaming: Story = { args: { streaming: '[mock] turn 3: act th' } }

/** 还没开始 */
export const Empty: Story = { args: { lines: [], streaming: '' } }
