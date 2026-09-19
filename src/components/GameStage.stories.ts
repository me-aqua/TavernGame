import type { Meta, StoryObj } from '@storybook/vue3-vite'
import GameStage from './GameStage.vue'
import type { Row } from '../stores/game'
import { displayOf, hudData, spotOf } from '../game/display'
import { createInitialState } from '../game/save'
import { currentCard } from '../game/current-card'

/**
 * 游戏舞台：左主角牌 + 故事链，中央叙事面板，右人物牌。
 *
 * 行动牌是舞台下的常驻条（App 里贴着输入区），所以这张故事只画舞台本身；
 * 整页矩阵里能看到行动牌、历史入口与输入区。HUD 数据全部从示例卡的状态树现读
 * （六项属性 / 关系 / 行囊 / 人物 / 地图 / 故事链），不在故事里抄一份内容。
 */
const state = createInitialState(currentCard).state
const hud = hudData(displayOf(currentCard), state)
const scene = spotOf(state)

function line(kind: 'action' | 'narration', text: string, id = 0): Row {
  return { id, kind, text, debug: false }
}

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
  title: '组件/GameStage',
  component: GameStage,
  decorators: [
    () => ({ template: '<div class="story-bg flex h-[820px] flex-col overflow-hidden"><story /></div>' }),
  ],
  args: {
    rows: TWO_TURNS,
    turn: 6,
    busy: false,
    status: null,
    scene,
    timeLabel: '2026 年 9 月 15 日 · 星期二 · 上午',
    cardName: currentCard.card.name,
    hud,
  },
} satisfies Meta<typeof GameStage>

export default meta
type Story = StoryObj<typeof meta>

/** 最新一回：左主角牌 / 右人物牌 / 中间的行动与回答 / 底部行动牌 */
export const Default: Story = {}

/** 开场：还没有行动，叙事面板正在写入开场白 */
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

/** 行动刚提交、模型还在跑：叙事面板只剩一滴墨与节点进度 */
export const Writing: Story = {
  args: {
    rows: [line('action', '我推开酒馆的门，看看里面都有谁。', 1)],
    busy: true,
    status: { kind: 'busy', text: '正在跑「故事」…' },
  },
}

/** 出错了：行动保留了，模型没写成的原因写在面板里 */
export const Failed: Story = {
  args: {
    rows: [line('action', '我去码头看看', 1)],
    status: { kind: 'error', text: '生成失败：mock upstream failure' },
  },
}
