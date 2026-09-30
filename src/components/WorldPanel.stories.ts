import type { Meta, StoryObj } from '@storybook/vue3-vite'
import WorldPanel from './WorldPanel.vue'
import { blocksOfSide, world } from './display-blocks'
import { instantiate, type StateTree } from '../game/card-state'
import { currentCard } from '../game/current-card'
import { atPath, displayOf, sceneValues } from '../game/display'
import { i18n } from '../i18n'

/**
 * 世界那一栏：卡声明这一侧的几块按声明顺序摆在**一条栏**里（路径 + 标题 + 一种预设格式）。
 *
 * 数据全部来自**状态树**（当前卡的初值 —— 开局那一刻的真实状态），故事里不抄卡的内容；
 * 「站在别处」只换册子里主控那一条，「当前所在」的标记跟着走。
 * ⚠️ 一栏只画**这一侧**的块（分栏是 `blocksOfSide` 的事，外层按卡的声明分开喂）。
 */
const opening = instantiate(currentCard)

/** 这一栏喂进去的块：卡声明里画在左边的那几块（顺序即声明顺序） */
const left = blocksOfSide(world, 'left')

/**
 * 卡声明里画在**右边**的那几块（随身 / 主控 / 此刻）。
 *
 * ⚠️ 它不是 `left` 的副本：右侧那几块的**格式**（`list` / `key-value`）与左侧不同
 * （左侧三块全是 `grouped`）⇒ 一个右栏故事同时照到另一条取数路径。
 * 🔴 它还是**接线票那两件装饰（主控徽记 / 场景剪影）的落脚点** —— 那两件按方案只在右栏画，
 * 只讲左栏的话组件故事这一层对它们**一条都照不到**（"照不到"既不是红也不是绿）。
 */
const right = blocksOfSide(world, 'right')

/**
 * 右栏那两件装饰要的两个入参 —— **与 `App.vue` 的同名 computed 同一个公式**（不抄卡的内容）。
 *
 * 🔴 **为什么必须有它们**：那两件是 `v-if="side === 'right' && leadName && seed && …"` ——
 *    不喂就是**一件都不画**，而 `expectSigilStill` 在"一个剪影都没有"时**返回 false 不抛**
 *    ⇒ 那几条故事判据会**永远绿**（"照不到"既不是红也不是绿）。评审 S4 打回的第 O2 条就是这个。
 * · `leadName`：卡的 `display.scene.who` 那条指路读出来的主控名字（读不到就是空串 ⇒ 整件不画）
 * · `sceneSeed`：册子里主控那一条的字面串，分隔点与侧栏同一份口径（两份 locale 都是 ` · `）
 */
const leadName = ((): string => {
  const who = currentCard.display.scene?.who
  const name = who === undefined ? undefined : atPath(opening, who)
  return typeof name === 'string' ? name : ''
})()
const sceneSeed = sceneValues(displayOf(currentCard), opening).join(i18n.global.t('sidebar.separator'))

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
  args: { side: 'left', blocks: left, state: opening },
} satisfies Meta<typeof WorldPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：开局那一刻的状态树（标记落在册子里主控那一条） */
export const Default: Story = {}

/** 站在别处：换掉册子里主控那一条，那一组与那个地点被点亮 */
export const Elsewhere: Story = { args: { state: at('晨风镇', '酒馆', '大堂') } }

/** 顺序由声明决定：同一栏里，块倒过来摆也一样渲染（组件里没有写死的顺序） */
export const DeclaredOrder: Story = { args: { blocks: [...left].reverse() } }

/**
 * 右栏：卡声明画在右边的那几块（随身 / 主控 / 此刻）—— 接线票那两件装饰只画在这一侧。
 *
 * 🔴 两个装饰入参**必须喂**（理由见上面 `leadName` / `sceneSeed`）：这一篇是组件故事那一层
 * 唯一照得到剪影与徽记的地方。
 * 🔴 **`tags: ['sigil']` 是给判据用的自声明**：`e2e/stories.spec.ts` 按这个标签收"剪影的故事"
 * —— 按标题收会把**左栏**那三篇也收进来，而那三篇**结构上照不到**剪影（只在右栏画）
 * ⇒ 那就是 6 条永远绿的假判据（评审 S4 的 O2）。改名不会让这一层悄悄失效。
 */
export const Right: Story = { tags: ['sigil'], args: { side: 'right', blocks: right, leadName, sceneSeed } }
