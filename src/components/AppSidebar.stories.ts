import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppSidebar from './AppSidebar.vue'
import { format } from '../game/card-calendar'

/**
 * 状态浮层：引擎自己的三行（时间 / 场景 / 回合）+ 最近一次时间跳跃（值全部读状态树与引擎持有的时间）。
 *
 * 它浮在故事上（决定 #24：缩小、悬浮），所以这里给它一块真实背景当参照，
 * 好看清毛玻璃与描边在场景里的样子。
 */
const at = (day: number, hour: number) => format('real', { year: 2026, month: 9, day, hour, minute: 0 })

const meta = {
  title: '组件/AppSidebar',
  component: AppSidebar,
  decorators: [() => ({ template: '<div class="story-bg h-[220px] p-3"><story /></div>' })],
  args: {
    items: ['time', 'scene', 'turn'],
    timeLabel: at(15, 9),
    timeline: [
      {
        from: at(14, 21),
        to: at(15, 9),
        reason: '在酒馆待到深夜，睡了一觉',
        minutes: 720,
        at: '2026-09-15T09:00:00.000Z',
      },
    ],
    scene: ['晨风镇', '醉猫旅店', '旅店大堂'],
    turn: 6,
  },
} satisfies Meta<typeof AppSidebar>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：时间、场景、回合，加最近一次时间跳跃 */
export const Default: Story = {}

/** 刚开局：册子空着（那一条就什么都不显示） */
export const FreshGame: Story = {
  args: { scene: [], timeline: [], turn: 0 },
}

/** 长文案：地点名很长时不许把浮层撑破 */
export const LongScene: Story = {
  args: {
    scene: ['晨风镇', '码头 · 第三条栈桥尽头的仓库', '堆着没卸完的木箱'],
  },
}

/** 引擎只给两条：没有「回合」时那一行就不出现 */
export const Declared: Story = { args: { items: ['time', 'scene'] } }
