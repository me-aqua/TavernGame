import type { Meta, StoryObj } from '@storybook/vue3-vite'
import SceneSigil from './SceneSigil.vue'

/**
 * 场景剪影：地名**算**出来的一座抽象地标（塔 / 拱门 / 林 / 山）与一枚月亮，
 * 低透明度铺在叙事后面。它不是写实原画，是「这一幕在哪儿」的一眼轮廓。
 *
 * 四屏 = 四座地标各一。**地名与画出来的形没有语义关系**（形完全由种子的字节定），
 * 下面这四个只是挑成读起来不别扭 —— 换任何别的字都会落回这四座里的一座。
 *
 * ⚠️ 它是 `position: absolute` 的水印，要父层有定位才贴得对地方（消费方那一层的事，见组件内注释）。
 */
const meta = {
  title: '组件/SceneSigil',
  component: SceneSigil,
  args: { seed: '高塔' },
} satisfies Meta<typeof SceneSigil>

export default meta
type Story = StoryObj<typeof meta>

/** 塔：一个方塔身 + 两层镂空窗 */
export const Tower: Story = {}

/** 拱门 / 遗迹：一道大拱 + 里头一道小拱 */
export const Ruins: Story = { args: { seed: '要塞' } }

/** 林：三棵高矮不一的树 */
export const Wood: Story = { args: { seed: '白桦林' } }

/** 山：两道山脊 + 两处雪线缺口 */
export const Ridge: Story = { args: { seed: '雪山' } }
