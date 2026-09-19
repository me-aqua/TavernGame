import type { Meta, StoryObj } from '@storybook/vue3-vite'
import AppSidebar from './AppSidebar.vue'
import { format } from '../game/card-calendar'

/**
 * 场景眉题：卡声明的顶栏条目 + 最近一次时间跳跃（值全部读状态树与引擎持有的时间）。
 *
 * 它是故事的第一行，不是浮在左上角的白卡；这里给它一块真实舞台背景当参照，
 * 好看清衬线标题、细字的时间行与时间旁注在光池里的样子。
 */
const at = (day: number, hour: number) => format('real', { year: 2026, month: 9, day, hour, minute: 0 })

const meta = {
  title: '组件/AppSidebar',
  component: AppSidebar,
  decorators: [() => ({ template: '<div class="story-bg h-[220px] p-4"><story /></div>' })],
  args: {
    items: ['scene', 'time', 'turn'],
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
    scene: { area: '晨风镇', spot: '醉猫旅店', scene: '旅店大堂' },
    turn: 6,
  },
} satisfies Meta<typeof AppSidebar>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：场景是标题，时间与回目跟在下面，加最近一次时间跳跃 */
export const Default: Story = {}

/** 刚开局：状态树里还没有 world.location，三个空串（那一条就什么都不显示） */
export const FreshGame: Story = {
  args: { scene: { area: '', spot: '', scene: '' }, timeline: [], turn: 0 },
}

/** 长文案：地点名很长时不许把浮层撑破 */
export const LongScene: Story = {
  args: {
    scene: { area: '晨风镇', spot: '码头 · 第三条栈桥尽头的仓库', scene: '堆着没卸完的木箱' },
  },
}

/** 卡只声明了两条：没有「回合」时那一行就不出现（显示什么由卡说了算） */
export const Declared: Story = { args: { items: ['scene', 'time'] } }
