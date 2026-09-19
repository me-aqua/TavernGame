import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorldPanel from './WorldPanel.vue'
import { world } from './display-blocks'
import { instantiate, type StateTree } from '../game/card-state'
import { currentCard } from '../game/current-card'

/**
 * 世界手札：卡声明的几块（你 / 地图 / 人物 / 行囊）按声明顺序摆在一个浮层里。
 *
 * 数据全部来自**状态树**（当前卡的初值 —— 开局那一刻的真实状态），故事里不抄卡的内容；
 * 「站在别处」只换状态树里的 world.location，地图上的位置高亮跟着走。
 */
const opening = instantiate(currentCard)

/** 把当前所在挪到某个地点（其余状态原样）—— 地图的高亮就跟着挪 */
function at(area: string, spot: string, scene: string): StateTree {
  const base = JSON.parse(JSON.stringify(opening)) as StateTree
  const world = base.world as Record<string, unknown>
  world.location = { area, spot, scene }
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

/** 常态：开局那一刻的状态树（地图高亮卡声明的起始地点） */
export const Default: Story = {}

/** 站在别处：换掉状态树里的 world.location，那一块被点亮 */
export const Elsewhere: Story = { args: { state: at('晨风镇', '酒馆', '大堂') } }

/** 顺序由声明决定：同一个面板，块倒过来摆也一样渲染（组件里没有写死的顺序） */
export const DeclaredOrder: Story = { args: { blocks: [...world].reverse() } }
