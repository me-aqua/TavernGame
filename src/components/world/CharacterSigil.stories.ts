import type { Meta, StoryObj } from '@storybook/vue3-vite'
import CharacterSigil from './CharacterSigil.vue'

/**
 * 角色纹章：名字**算**出来的一枚小徽记（星 / 楔 / 眼 + 两圈刻度），配一个专属色调。
 *
 * 摆的是几态看得见的差别：常态 / 主角 / 两档尺寸 / 换一个名字。
 * 名字换成别的就是**另一枚**（形、色、角度三样一起变）—— `AnotherName` 那一屏专门看这件事。
 *
 * ⚠️ 这里没有 i18n：纹章不吃界面语言，也不吃卡 —— 它只吃 `name` 那几个字节。
 */
const meta = {
  title: '组件/CharacterSigil',
  component: CharacterSigil,
  args: { name: 'Salen' },
} satisfies Meta<typeof CharacterSigil>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：中号、非主角 —— 楔形记号，色调是这个种子自己那一档 */
export const Default: Story = {}

/** 主角：金边 + 一枚冠，角度归零（不歪） */
export const You: Story = { args: { you: true } }

/** 小号（2rem）：挤在人物牌那一行里用 */
export const Small: Story = { args: { size: 'sm' } }

/** 大号（4.5rem）：单独摆在主角那一屏用 */
export const Large: Story = { args: { size: 'lg' } }

/** 换一个名字：记号与色调都换了一枚；这里用中文名（卡里的人名就是中文） */
export const AnotherName: Story = { args: { name: '灰羽' } }
