import type { Meta, StoryObj } from '@storybook/vue3-vite'
import LandscapeOverlay from '../src/components/LandscapeOverlay.vue'

/**
 * 手机竖屏遮罩：竖屏时整页只给这一层，按钮尝试锁定横屏，失败就给一句手动旋转的提示。
 *
 * ⚠️ 故事画布是 1280×720（不分手机档），所以这里看到的是**桌面尺寸下的同一层** ——
 * 它自己不带媒体查询，什么时候出现由 `App.vue` 的 matchMedia 决定。
 */
const meta = {
  title: 'v2/LandscapeOverlay',
  component: LandscapeOverlay,
} satisfies Meta<typeof LandscapeOverlay>

export default meta
type Story = StoryObj<typeof meta>

/** 默认：标题 + 尝试按钮 */
export const Default: Story = {}
