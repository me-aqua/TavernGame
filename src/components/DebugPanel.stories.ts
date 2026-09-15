import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DebugPanel from './DebugPanel.vue'
import { currentCard } from '../game/current-card'
import { instantiate } from '../game/card-state'
import { format } from '../game/card-calendar'
import type { ToolCall } from '../stores/game'
import type { GameData } from '../types/state'

/**
 * 调试面板（设计第 13 节）：卡图 / 引擎状态 / 工具调用三块。
 *
 * 数据是这一局的真值（状态树来自当前卡的初值）+ 一份编出来的痕迹：
 * 一次成功的时间推进、一次参数被拒的地图调用、一次退回重来。
 * 面板本身只读，故事里也没有一颗按钮会改游戏状态。
 */
const state = instantiate(currentCard)
const timeLabel = format(currentCard.time.calendar, currentCard.time.initial)

/** 正在跑的那个节点（卡里的第二个）—— 活卡图的高亮 */
const running = currentCard.graph.topology[1]

/** 这一轮还没提交的工作副本（事务里那份；故事里造一份假的看看样子） */
const draft: GameData = {
  meta: { turn: 3, card: { id: 'demo', name: 'demo', version: '0.0.0', format: 'card/3' } },
  time: currentCard.time.initial,
  state,
  events: [],
  timeline: [],
}

const tools: ToolCall[] = [
  {
    node: currentCard.graph.topology[4],
    tool: 'advance_time',
    args: '{"minutes":5,"reason":"从醒来坐到桌边"}',
    result: '🕐 时间推进：5 分钟（现在是 2026 年 9 月 14 日 · 星期一 · 晚上）',
    writes: [{ path: 'time', value: { year: 2026, month: 9, day: 14, hour: 19, minute: 35 } }],
    failed: false,
    redoFrom: null,
  },
  {
    node: currentCard.graph.topology[5],
    tool: 'move_to',
    args: '{"area":"镇郊"}',
    result: 'move_to: spot is required',
    writes: [],
    failed: true,
    redoFrom: null,
  },
  {
    node: currentCard.graph.topology[8],
    tool: 'redo',
    args: '{"from":"cast","why":"正文引用了角色表里没有的东西"}',
    result: '已退回「角色」重跑',
    writes: [],
    failed: false,
    redoFrom: currentCard.graph.topology[6],
  },
]

const meta = {
  title: '组件/DebugPanel',
  component: DebugPanel,
  decorators: [
    () => ({ template: '<div class="story-bg relative h-[560px] overflow-hidden"><story /></div>' }),
  ],
  args: {
    card: currentCard,
    state,
    timeLabel,
    turn: 2,
    draft: null,
    writes: [
      { path: 'time', value: { year: 2026, month: 9, day: 14, hour: 19, minute: 35 } },
      { path: 'world.location', value: { area: '晨风镇', spot: '醉猫旅店', scene: '旅店大堂' } },
    ],
    tools,
    running,
    failed: [currentCard.graph.topology[6]],
  },
} satisfies Meta<typeof DebugPanel>

export default meta
type Story = StoryObj<typeof meta>

/** 卡图：正在跑的节点高亮，被退回的那个标红 */
export const Graph: Story = {}

/** 引擎状态：四个顶层分支 + 时间 + 回合 + 本轮写入清单 */
export const EngineState: Story = { args: { initialTab: 'state' } }

/** 工作副本：同一个面板切到草稿（只看这一层，不改游戏状态） */
export const Draft: Story = { args: { initialTab: 'state', initialDraft: true, draft } }

/** 工具调用：一次成功、一次参数被拒、一次退回重来 */
export const Tools: Story = { args: { initialTab: 'tools' } }

/** 空：还没有回合跑过（没有写入、没有工具调用、没有节点在跑） */
export const Empty: Story = {
  args: { initialTab: 'tools', writes: [], tools: [], running: null, failed: [] },
}
