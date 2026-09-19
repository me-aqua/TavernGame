import type { Meta, StoryObj } from '@storybook/vue3-vite'
import BookPanel from './BookPanel.vue'
import type { Row } from '../stores/game'

/**
 * 古书跨页：左页行动、右页叙事，一回合一次翻页。
 *
 * 故事只声明「事件流 + 当前回目」；分组、分页、最新页落点都由组件从 rows 现算。
 * 这里的几种状态是玩家真会看到的：开场「序」、最新一回、模型还没落笔、长回答的续页、出错。
 */
function line(kind: 'action' | 'narration', text: string, id = 0): Row {
  return { id, kind, text, debug: false }
}

const SCENE = { area: '晨风镇', spot: '酒馆', scene: '大堂' }
const TWO_TURNS = [
  line('action', '我推开酒馆的门，看看里面都有谁。', 1),
  line(
    'narration',
    '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒、木炭和湿羊毛的味道。\n\n柜台后站着一位头发花白的女人，她正把一只锡杯擦得发亮。',
    2,
  ),
  line('action', '我走向柜台，问她最近镇上有没有什么怪事。', 3),
  line(
    'narration',
    '她停下手里的活，抬眼看了看你，又看了看窗边那桌。\n\n「怪事？」她把声音压低了些，「码头算不算。三天里，两条船回来都是空的——人没了，货还在。」',
    4,
  ),
]

const meta = {
  title: '组件/BookPanel',
  component: BookPanel,
  decorators: [
    () => ({ template: '<div class="story-bg flex h-[780px] flex-col overflow-hidden"><story /></div>' }),
  ],
  args: {
    rows: TWO_TURNS,
    turn: 6,
    busy: false,
    status: null,
    scene: SCENE,
    timeLabel: '2026 年 9 月 15 日 · 星期二 · 上午',
    cardName: '晨风镇',
  },
} satisfies Meta<typeof BookPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 最新一回：左页是刚写下的行动，右页是模型的回答，首字做了手抄本式的 drop cap */
export const Default: Story = {}

/** 开场：还没有行动，左页是「序」，右页正在写入开场白 */
export const Prologue: Story = {
  args: {
    rows: [
      line(
        'narration',
        '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒、木炭和湿羊毛的味道。\n\n柜台后站着一位头发花白的女人，她正把一只锡杯擦得发亮。',
        1,
      ),
    ],
    turn: 0,
  },
}

/** 行动刚提交、模型还在跑：右页空白，只有一滴墨和节点进度 */
export const Writing: Story = {
  args: {
    rows: [line('action', '我推开酒馆的门，看看里面都有谁。', 1)],
    busy: true,
    status: { kind: 'busy', text: '正在跑「故事」…' },
  },
}

/** 长回答：仍然只占这一回的一页；页面自己滚，不再拆成续页 */
export const LongAnswer: Story = {
  args: {
    rows: [
      line('action', '我沿着码头往北走。', 1),
      line(
        'narration',
        '潮水把木栈道泡得发黑。你数到第七根柱子时，听见有人在低声说话——两个影子蹲在最后一条船的阴影里，其中一个手里握着什么东西，反了一下月光。'.repeat(
          5,
        ),
        2,
      ),
    ],
    turn: 7,
  },
}

/** 出错了：右页保留模型没写成的原因，玩家可以直接再落一笔 */
export const Failed: Story = {
  args: {
    rows: [line('action', '我去码头看看', 1)],
    status: { kind: 'error', text: '生成失败：mock upstream failure' },
  },
}
