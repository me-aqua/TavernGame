import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppSidebar from './AppSidebar.vue'
import { realCalendar } from '../utils/calendar'

/**
 * 状态浮层：时间 / 地点 / 回合 + 最近一次时间跳跃。
 *
 * 它浮在故事上（用户要求「缩小、悬浮」），所以这里给它一块真实背景当参照，
 * 好看清毛玻璃与描边在场景里的样子。
 */
const meta = {
  title: '组件/AppSidebar',
  component: AppSidebar,
  decorators: [() => ({ template: '<div class="story-bg h-[220px] p-3"><story /></div>' })],
  args: {
    timeLabel: realCalendar.format('2026-09-15T09:00:00.000Z'),
    timeline: [
      {
        from: realCalendar.formatShort('2026-09-14T09:00:00.000Z'),
        to: realCalendar.formatShort('2026-09-15T09:00:00.000Z'),
        reason: '在酒馆待到深夜，睡了一觉',
        elapsedMs: 86400000,
        at: '2026-09-15T09:00:00.000Z',
      },
    ],
    scene: { name: '晨风镇 · 酒馆', description: '炉火把墙面照成蜜色，海风从门缝里钻进来。' },
    turn: 6,
  },
} satisfies Meta<typeof AppSidebar>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：时间、地点、回合，加最近一次时间跳跃 */
export const Default: Story = {}

/** 刚开局：还是默认场景名（从 locale 现取），没有时间线 */
export const FreshGame: Story = {
  args: { scene: { name: '', description: '' }, timeline: [], turn: 0 },
}

/** 长文案：地点名很长时不许把浮层撑破 */
export const LongScene: Story = {
  args: {
    scene: {
      name: '晨风镇 · 码头 · 第三条栈桥尽头的仓库',
      description: '栈桥尽头堆着没卸完的木箱。',
    },
  },
}
