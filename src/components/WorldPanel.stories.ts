import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorldPanel from './WorldPanel.vue'
import { world } from './display-blocks'

/**
 * 世界面板：卡声明的三块（地图 / 角色 / 背包）按声明顺序摆在一个浮层里。
 *
 * 数据全部来自当前卡（cards/morningwind.json）—— 故事里不抄卡的内容；
 * 「站在别处」只换运行时的场景名，地图上的位置高亮跟着走。
 */
const meta = {
  title: '组件/WorldPanel',
  component: WorldPanel,
  decorators: [
    () => ({ template: '<div class="story-bg relative h-[560px] overflow-hidden"><story /></div>' }),
  ],
  args: { blocks: world, sceneName: '' },
} satisfies Meta<typeof WorldPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：开局的场景名（旅店大堂）认不出具体地点，位置退回卡的开局位置 */
export const Default: Story = {}

/** 站在别处：场景名里带着地名（「晨风镇 · 酒馆」）时，那一块被点亮 */
export const Elsewhere: Story = { args: { sceneName: '晨风镇 · 酒馆' } }

/** 顺序由声明决定：同一个面板，块倒过来摆也一样渲染（组件里没有写死的顺序） */
export const DeclaredOrder: Story = { args: { blocks: [...world].reverse() } }
