import type { Meta, StoryObj } from '@storybook/vue3-vite'
import ConfirmDialog from '../src/components/ConfirmDialog.vue'
import { t } from '../src/i18n'

/**
 * 删除前的确认层：只有「删除」才真删，「取消」什么都不做。
 * 文案从 locale 里来（删卡与删存档各一句），故事里不抄字面量。
 */
const meta = {
  title: 'v2/ConfirmDialog',
  component: ConfirmDialog,
  args: { message: t('home.deleteCardConfirm') },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

/** 删卡带：连它的存档一起 */
export const DeleteCard: Story = {}

/** 删存档：不动卡 */
export const DeleteSave: Story = { args: { message: t('home.deleteSaveConfirm') } }
