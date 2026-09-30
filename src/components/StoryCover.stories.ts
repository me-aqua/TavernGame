import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import StoryCover from './StoryCover.vue'

/**
 * 开场封面：纹章 + 卡名 + 简介 + 一枚开始键 —— 全新一局、还没配 API、开场正在生成时的那一页。
 *
 * 三态就是玩家真会遇到的三种：没配 key / 开场正在生成 / 配好了还没开始；
 * 另加一屏「上一条通知是坏的」，看状态行那一支（`Opening` 之外的唯一另一条分支）。
 *
 * ⚠️ 状态文案不写成 `args` 里的静态字符串 —— 它由组件内的 `t()` 现取，
 *    浅色/深色 × 中/英 那套矩阵（故事巡检那一层）才会各自正确。
 * ⚠️ 两个事件接上 `fn()`：不接就是 Vue 的「未处理的 emit」警告，而它不拦门禁。
 */
const handlers = { onConfigure: fn(), onStart: fn() }

const meta = {
  title: '组件/StoryCover',
  component: StoryCover,
  // `story-bg` 是应用自己那个带纸色背景的容器；封面靠 `flex-1` 撑满，所以外面这层要有高度。
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
    ...handlers,
  },
} satisfies Meta<typeof StoryCover>

export default meta
type Story = StoryObj<typeof meta>

/** 还没配置：先给这一张卡一个脸，再把玩家送去设置 */
export const Unconfigured: Story = {}

/** 开场正在生成：卡名下面挂着一滴呼吸的墨（这里只展示不带节点进度的那一档） */
export const Opening: Story = { args: { configured: true, busy: true } }

/** 配好了、没有在跑：上一次失败了或者刚清掉存档，给一颗「开始这一局」 */
export const Ready: Story = { args: { configured: true } }

/** 报错：状态行那一支 —— 配好了、没在跑，最近一条通知是坏的 */
export const Failed: Story = {
  args: { configured: true, status: { kind: 'error', text: '出错了：请求发不出去' } },
}
