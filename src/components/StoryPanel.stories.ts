import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { onMounted, ref } from 'vue'
import StoryPanel from './StoryPanel.vue'
import type { BlockGroup, BlockLine, PromptBlock } from '../agent/prompts'
import type { Row } from '../stores/game'

/**
 * 故事区：故事行 + （调试模式下的）调试行 + 底部状态行。
 *
 * 三种内容在**同一个列表**里按发生顺序排 —— 所以调试行会夹在两段叙事之间
 * （见 doc/DESIGN.md 决定 #22）。这里的 fixture 就是照那个顺序摆的。
 */
const story = (id: number, kind: 'narration' | 'action', text: string): Row => ({
  id,
  kind,
  text,
  debug: false,
})

/** 造一行调试数据（节点进度、模型输入输出、工具调用、状态写入、警告） */
const debugRow = (
  id: number,
  kind: 'node' | 'thinking' | 'request' | 'model' | 'tool' | 'toolResult' | 'stateChange' | 'warn',
  text: string,
  detail?: string,
): Row => ({
  id,
  kind,
  text,
  debug: true,
  ...(detail === undefined ? {} : { detail }),
})

const meta = {
  title: '组件/StoryPanel',
  component: StoryPanel,
  decorators: [() => ({ template: '<div class="flex h-[520px] flex-col bg-page"><story /></div>' })],
  args: {
    rows: [
      story(0, 'action', '我推开酒馆的门，看看里面都有谁。'),
      story(
        1,
        'narration',
        '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒、木炭和湿羊毛的味道。\n\n柜台后站着一位头发花白的女人，她正把一只锡杯擦得发亮。',
      ),
    ],
    status: null,
  },
} satisfies Meta<typeof StoryPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 常态：只有故事（玩家行动行 + 叙事行） */
export const Default: Story = {}

/** 空屏：一条都没有（新开局还没写开场时就是这样） */
export const Empty: Story = { args: { rows: [] } }

/** 进行中：状态行是三个点（它不是故事里的一行） */
export const Busy: Story = { args: { rows: [], status: { kind: 'busy', text: '正在生成开场…' } } }

/** 通知：一次性提示，回合一开始就没了 */
export const Notice: Story = {
  args: { rows: [], status: { kind: 'info', text: '存档已导出为文件' } },
}

/** 出错：红色边的状态行 */
export const ErrorNotice: Story = {
  args: { rows: [], status: { kind: 'error', text: '出错了：请求发不出去' } },
}

/** 调试模式：节点进度、模型输入输出、工具往返与状态写入夹在叙事之间 */
export const Debug: Story = {
  args: {
    rows: [
      debugRow(0, 'node', '🧩 节点：时间'),
      debugRow(1, 'request', '📤 模型输入（2 条消息）', '{ "model": "demo-model", "messages": [ … ] }'),
      debugRow(2, 'model', '🔍 模型原始回复', '{ "choices": [ … ] }'),
      story(3, 'action', '我推开酒馆的门，看看里面都有谁。'),
      debugRow(4, 'tool', '⚙ 调用 advance_time({"minutes":5,"reason":"走到桌边"})'),
      debugRow(5, 'stateChange', '✎ 写入 time'),
      debugRow(6, 'toolResult', '   → 🕐 时间推进：5 分钟'),
      debugRow(7, 'warn', '⚠ 模型这一步只调用了工具，没有写叙事文字（第 1 步）'),
      story(8, 'narration', '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒和湿羊毛的味道。'),
    ],
  },
}

// ---------- 块清单（票 53）：两条痕迹都带分块，长行 / 空行 / 小标题一样不少 ----------

/** 一条没有空格的超长串：结构检查要量的就是它会不会撑破版面 */
const LONG_RUN = 'A'.repeat(240)

const text = (value: string): BlockLine => ({ kind: 'text', text: value })
const subhead = (value: string): BlockLine => ({ kind: 'subhead', text: value })
const block = (title: string, lines: BlockLine[]): PromptBlock => ({ title, level: 2, lines })

/** 一条带分块清单的调试行（模型输入 / 原始回复） */
const blockRow = (
  id: number,
  kind: 'request' | 'model',
  line: string,
  detail: string,
  blocks: BlockGroup[],
): Row => ({ id, kind, text: line, debug: true, detail, blocks })

const REQUEST_BLOCKS: BlockGroup[] = [
  {
    role: 'system',
    title: '系统消息',
    blocks: [
      block('设定', [
        subhead('世界'),
        text('晨风镇在赫兰王国的东北边陲，背靠雾岭，一条土路往南通向官道。'),
        text(''),
        subhead('核心'),
        text('时间会往前走，玩家看不见的东西也在动。'),
        text(''),
        text('工具声明的原文：' + LONG_RUN),
      ]),
      block('剧本', [text('镇上的钟楼底下埋着一样东西，只有守夜人知道。')]),
      block('生成器', [subhead('生成地牢新层'), text('- 一次别生成太多：玩家推进到哪一层，就长到哪一层')]),
    ],
  },
  {
    role: 'user',
    title: '用户消息',
    blocks: [
      block('现在', [
        text('时间：2026 年 9 月 14 日 · 星期一 · 晚上'),
        subhead('最近发生的事'),
        text('- 你(GM)：门轴发出一声长叹。'),
        text(''),
        text('玩家：' + "Player's action: look around"),
      ]),
    ],
  },
]

const REPLY_BLOCKS: BlockGroup[] = [
  {
    role: 'assistant',
    title: '助手消息',
    blocks: [
      { title: '模型说的话', level: 0, lines: [text('我把斗篷裹紧了一些，往柜台那边走。')] },
      { title: 'advance_time', level: 0, lines: [text('{"minutes":7,"reason":"' + LONG_RUN + '"}')] },
      {
        title: '其它',
        level: 0,
        lines: [
          text('{'),
          text('  "finish_reason": "tool_calls",'),
          text('  "usage": { "total_tokens": 418 }'),
          text('}'),
        ],
      },
    ],
  },
]

/**
 * 展开态的块清单：两条痕迹都摊开。
 *
 * ⚠️ 折叠着的块清单量不到版面（`<details>` 里的东西不参与排版），
 *    而判据 9 要量的正是**展开之后**的长行会不会撑破版面 —— 所以这里在挂载后
 *    把这两行的折叠条打开（行数据里没有「展开」这个字段，它只是这一屏的取景）。
 */
const openTraces = () => ({
  /** 挂载后把这两行的折叠条打开：结构检查要量的是**展开之后**的版面 */
  setup() {
    const root = ref<HTMLElement | null>(null)
    onMounted(() => {
      for (const el of root.value?.querySelectorAll('details.trace') ?? []) {
        ;(el as HTMLDetailsElement).open = true
      }
    })
    return { root }
  },
  template: '<div ref="root" class="flex h-full flex-col bg-page"><story /></div>',
})

/** 分块渲染：一条模型输入（两条消息）+ 一条模型原始回复 */
export const DebugBlocks: Story = {
  decorators: [openTraces],
  args: {
    rows: [
      blockRow(
        0,
        'request',
        '📤 模型输入（2 条消息）',
        '{ "messages": [ { "role": "system", "content": "…" } ] }',
        REQUEST_BLOCKS,
      ),
      blockRow(1, 'model', '🔍 模型原始回复', '{ "choices": [ { "message": { … } } ] }', REPLY_BLOCKS),
    ],
  },
}
