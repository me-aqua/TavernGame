import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StoryCover from './StoryCover.vue'

/**
 * 首屏封面：卡名 + 印记 + 简介，加一条明确的下一步。
 *
 * 三种状态就是玩家真会遇到的三种：没配 key、开场正在生成、配好了还没开始（重试）。
 * 状态文案不写成 args 里的静态字符串 —— 它由组件内的 t() 现取，中英截图才各自正确。
 */
const meta = {
  title: '组件/StoryCover',
  component: StoryCover,
  decorators: [
    () => ({
      template: '<div class="story-bg relative flex h-[620px] flex-col overflow-hidden"><story /></div>',
    }),
  ],
  args: {
    name: '晨风镇',
    summary:
      '边境小镇外有座地牢，没人知道它有多深。人们下去是为找东西 —— 药师收苔，铁匠收旧铁，还有人专捡前人没带走的家伙。',
    configured: false,
    busy: false,
    status: null,
  },
} satisfies Meta<typeof StoryCover>

export default meta
type Story = StoryObj<typeof meta>

/** 还没配置：先给这一张卡一个脸，再把玩家送去设置 */
export const Unconfigured: Story = {}

/** 开场正在生成：节点进度长在封面上（这里只展示不带节点名的那一档） */
export const Opening: Story = {
  args: { configured: true, busy: true },
}

/** 配好了、没有在跑：上一次失败了或者刚清掉存档，给一颗「开始这一局」 */
export const Ready: Story = {
  args: { configured: true },
}
