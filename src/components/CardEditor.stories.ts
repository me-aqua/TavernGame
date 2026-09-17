import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { fn, userEvent } from 'storybook/test'
import CardEditor from './CardEditor.vue'
import { parseCard } from '../game/card'
import type { CardData } from '../game/card'
import cardJson from '../../cards/morningwind.json?raw'

/**
 * 卡界面浮层：卡图 + 编辑表单 + 资源库面板（设置面板里「查看 / 编辑卡图」打开的那一层）。
 *
 * 覆盖式浮层（决定 #24），关了它下面还是原来那一屏；节点选中与资源库开合都是组件内部状态，
 * 所以资源库那条故事用 `play` 把它点开 —— 折叠着的东西结构探针量不到，看图也看不见。
 */

/** 示例卡（卡图与标题里的卡名都从卡里现读） */
const card = parseCard(cardJson)

/**
 * 一份**只加了两条长行**的卡：`world` 与 `style` 各插一条。
 *
 * 契约 §10.2 点名这条故事要「长行 + 展开的 `style` 那一项」：长行撑不撑破版面只有真浏览器
 * 量得出来，而 `style` 是示例卡里最长的一块（正文 6000 字上下）。卡的内容其余一字未改。
 */
const longLine = 'A long line the probe must see: ' + 'A'.repeat(200)
const resourceCard: CardData = {
  ...card,
  settings: {
    ...card.settings,
    world: [...card.settings.world, longLine],
    style: [...card.settings.style, longLine],
  },
}

/** 这一层要自己接住两个事件：不接就是 Vue 的「未处理的 emit」警告，而它不拦门禁 */
const handlers = { onClose: fn(), onSaved: fn() }

const meta = {
  title: '组件/CardEditor',
  component: CardEditor,
  // ⚠️ 浮层是 `fixed inset-0`：不给它一个真实的取景高度，它在 iframe 里会被压成一条。
  //    里面那层把卡图压矮（连 `xl:` 一起压，原生那个 `h-[220px]` 是写在组件上的任意值，
  //    层叠上打不过 `xl:h-[420px]` 那条媒体查询）：判据要看的是资源库面板那一块（契约 §10.2），
  //    而卡图在 xl 下自己占 420px，会把面板挤到折叠线以下 —— 那是取景，不是版面。
  decorators: [
    () => ({
      template:
        '<div class="h-[760px] w-full bg-page [&_.card-graph]:h-[220px] [&_.card-graph]:xl:h-[220px]"><story /></div>',
    }),
  ],
  args: { card, source: 'builtin', ...handlers },
} satisfies Meta<typeof CardEditor>

export default meta
type Story = StoryObj<typeof meta>

/** 内置示例卡（来源写在标题下面） */
export const Builtin: Story = {}

/** 导入的卡：标题下面写着「已导入」，与设置面板里那一节一致 */
export const Imported: Story = { args: { source: 'imported' } }

/**
 * 资源库展开：面板整块在画面里，`style` 那一项的正文（233 行）也点开着。
 *
 * 取景就是这条故事的全部意义 —— 长行撑破版面、正文被挤出可视区，只有在展开的状态下才量得到。
 */
export const Resources: Story = {
  args: { card: resourceCard },
  /** 点开面板，再点开 `style` 那一项（两项都展开着才算量到了正文） */
  play: async ({ canvasElement }) => {
    // 按钩子找，不按文案 —— 故事要在中英两种语言下都跑得通
    const trigger = canvasElement.querySelector('[data-card-resources-open]')
    if (!(trigger instanceof HTMLElement)) throw new Error('the resources trigger is not on screen')
    await userEvent.click(trigger)
    const open = canvasElement.querySelector('[data-card-resource="style"] [data-card-resource-open]')
    if (!(open instanceof HTMLElement)) throw new Error('the style resource is not on screen')
    await userEvent.click(open)
    // 正文 233 行，比一屏还高：把它的编辑器滚进画面，结构探针与截图才量得到这一项
    // （`play` 之前两次点击已经把面板滚到过这里，这一步是防止取景把它留在折叠线以下）
    const box = canvasElement.querySelector('[data-card-resource="style"] [data-card-resource-text]')
    if (!(box instanceof HTMLElement)) throw new Error('the style editor is not on screen')
    box.scrollIntoView({ block: 'center' })
  },
}
