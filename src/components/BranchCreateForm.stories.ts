import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn } from 'storybook/test'
import BranchCreateForm from './BranchCreateForm.vue'

/**
 * 左栏那颗「新建一枝」开的那张面板（票 8e）：六选一 ⇒ 那个形状的必收项 ⇒ 建出来。
 *
 * 规矩（名字三条 · 三种必收项 · 怎么拼 schema）在 `useBranchCreate.ts` 的 `planBranch` 里 ——
 * 这一层只把输入收齐、把判决摆出来。
 * ⚠️ 真件里它由 `CardEditor` 用 `v-if` 开合（每次打开都是一个**新实例**、那几格本来就是干净的），
 * 这里取景在**左栏那 300px 的宽**里 —— 面板打开那一态别处拍不到，而它折不折行只有这个宽度量得出来。
 * ⚠️ 「选了哪个形状」与「被拒」那几态靠 `play` 点出来，而 `stories.spec.ts` **不等 `play` 跑完**就
 * 截图（实测拍到的是打字打到一半那一帧）⇒ 本文件**只声明起点那一态**；那几态由
 * `tests/branch-create-dom.test.ts`（19 条）与 `e2e/smoke.spec.ts` 的「新建一枝」那条守着。
 */

/** 这一层要自己接住 `make`：不接就是 Vue 的「未处理的 emit」警告，而它不拦门禁 */
const handlers = { onMake: fn() }

/** 示例卡里那四枝（重名由 `planBranch` 挡；这份名单只是把真件那一格的输入端出来） */
const taken = ['lead', 'roles', 'world', 'player']

const meta = {
  title: '组件/BranchCreateForm',
  component: BranchCreateForm,
  decorators: [
    () => ({
      template: '<div class="w-[300px] bg-page p-2"><story /></div>',
    }),
  ],
  args: { taken, ...handlers },
} satisfies Meta<typeof BranchCreateForm>

export default meta
type Story = StoryObj<typeof meta>

/** 刚点开：六颗形状一个都没选，「建出来」按不动（灰掉，不假装能按） */
export const Default: Story = {}
