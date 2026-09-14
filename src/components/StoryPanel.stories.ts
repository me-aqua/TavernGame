import type { Meta, StoryObj } from '@storybook/vue3-vite'
import StoryPanel from './StoryPanel.vue'
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

/** 造一行调试数据（模型输入/输出、工具调用、警告） */
const debugRow = (
  id: number,
  kind: 'request' | 'reply' | 'tool' | 'warn',
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

/** 常态：只有故事 */
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

/** 调试模式：模型输入输出与工具调用夹在叙事之间 */
export const Debug: Story = {
  args: {
    rows: [
      debugRow(0, 'request', '📤 模型输入（2 条消息）', '{ "model": "demo-model", "messages": [ … ] }'),
      debugRow(1, 'reply', '🔍 模型原始回复（1 次工具调用）', '{ "choices": [ … ] }'),
      story(2, 'action', '我推开酒馆的门，看看里面都有谁。'),
      debugRow(3, 'tool', '⚙ 调用 advance_time({"step":1,"unit":"day"})'),
      debugRow(4, 'warn', '⚠ 模型这一步只调用了工具，没有写叙事文字（第 1 步）'),
      story(5, 'narration', '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒和湿羊毛的味道。'),
    ],
  },
}
