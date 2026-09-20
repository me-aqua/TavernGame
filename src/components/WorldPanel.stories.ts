import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorldPanel from './WorldPanel.vue'
import { world } from './display-blocks'
import { instantiate, type StateTree } from '../game/card-state'
import { currentCard } from '../game/current-card'

/**
 * 世界面板：卡声明的几块按声明顺序摆在一个浮层里（路径 + 标题 + 一种预设格式）。
 *
 * 数据全部来自**状态树**（当前卡的初值 —— 开局那一刻的真实状态），故事里不抄卡的内容；
 * 「站在别处」只换册子里主控那一条，「当前所在」的标记跟着走。
 */
const opening = instantiate(currentCard)

/** 把主控挪到某个地点（其余状态原样）—— 面板上「当前所在」的标记就跟着挪 */
function at(area: string, spot: string, scene: string): StateTree {
  const base = JSON.parse(JSON.stringify(opening)) as StateTree
  const lead = base.lead as Record<string, unknown>
  const book = (base.world as Record<string, Record<string, unknown>>)['谁在哪']
  book[String(lead['名称'])] = { 区域: area, 地点: spot, 场景: scene }
  return base
}

const meta = {
  title: '组件/WorldPanel',
  component: WorldPanel,
  decorators: [
    () => ({ template: '<div class="story-bg relative h-[560px] overflow-hidden"><story /></div>' }),
  ],
  args: { blocks: world, state: opening },
} satisfies Meta<typeof WorldPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：开局那一刻的状态树（标记落在册子里主控那一条） */
export const Default: Story = {}

/** 站在别处：换掉册子里主控那一条，那一组与那个地点被点亮 */
export const Elsewhere: Story = { args: { state: at('晨风镇', '酒馆', '大堂') } }

/** 顺序由声明决定：同一个面板，块倒过来摆也一样渲染（组件里没有写死的顺序） */
export const DeclaredOrder: Story = { args: { blocks: [...world].reverse() } }
