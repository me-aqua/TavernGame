import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorldSelf from './WorldSelf.vue'
import { instantiate } from '../../game/card-state'
import { currentCard } from '../../game/current-card'

/**
 * 主角角色牌：名字 + 印记，然后按作者写下的顺序摊开固有 / 关系 / 携带 / 当下。
 *
 * 数据从示例卡的状态树现读 —— 不在故事里抄一份人物，卡改了这里跟着改。
 */
const lead = instantiate(currentCard).lead

const meta = {
  title: '组件/世界/WorldSelf',
  component: WorldSelf,
  decorators: [
    () => ({
      template:
        '<div class="story-bg relative h-[620px] overflow-auto p-4"><div class="reading-column"><story /></div></div>',
    }),
  ],
  args: { lead },
} satisfies Meta<typeof WorldSelf>

export default meta
type Story = StoryObj<typeof meta>

/** 完整角色牌：姓名、六项属性、关系、携带与当下（pack 没有别的块时留在牌里） */
export const Default: Story = {}

/** 同一张牌，但行囊已由「行囊」块专门展示：牌里就不再重复一遍 */
export const PackElsewhere: Story = { args: { hidden: ['pack'] } }

/** 不是对象（卡没声明 / 存坏了）：整块消失，不画半个空壳 */
export const NotAPerson: Story = { args: { lead: ['not', 'a', 'person'] } }
