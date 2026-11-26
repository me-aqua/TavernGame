/**
 * 组件故事用的样例数据（**纯数据，全 ASCII**）。
 *
 * 为什么单开一份：几个故事要的是同一张卡 / 同一个节点 / 同一批预设 —— 各写一份迟早不一致，
 * 而不一致的样例会让「结构检查通过」这件事变得没意义。
 */
import type { TraceDetail, TurnStatsDetail, Tree } from '../../src/core/types'
import type { ChainNode, Preset, StateElement } from '../../src/core/types'

/**
 * 五种类型都出场的一小棵状态树（`0` 时间 / `1` 下拉带一个孩子 / `2` 文字 / `3` 数字 / `4` 结构体）。
 * `1` 有孩子 ⇒ 它的自身值在 `VALUES['1.0']`，孩子是 `1.1`。
 */
export const ELEMENTS: StateElement[] = [
  {
    code: '0',
    name: 'time',
    note: '',
    type: 'time',
    initial: { year: 1024, month: 9, day: 17, hour: 18, minute: 30, second: 0 },
    granularityUpper: 'day',
    granularityLower: 'minute',
  },
  {
    code: '1',
    name: 'place',
    note: 'where the scene happens',
    type: 'enum',
    values: ['VAL_PLACE_A1', 'VAL_PLACE_B2'],
    initial: 'VAL_PLACE_A1',
  },
  { code: '1.1', name: 'site', note: '', type: 'text', initial: 'VAL_SITE_C3' },
  { code: '2', name: 'mood', note: '', type: 'text', initial: 'VAL_MOOD_B2' },
  {
    code: '3',
    name: 'hp',
    note: '',
    type: 'integer',
    min: 0,
    max: 100,
    stepMin: 1,
    stepMax: 10,
    initial: 80,
  },
  { code: '4', name: 'bag', note: '', type: 'object' },
  { code: '4.1', name: 'item', note: '', type: 'text', initial: 'VAL_ITEM_D4' },
]

/** 与 `ELEMENTS` 对应的扁平值（左栏每行显示的自身值） */
export const VALUES: Tree = {
  0: { year: 1024, month: 9, day: 17, hour: 18, minute: 30, second: 0 },
  '1.0': 'VAL_PLACE_A1',
  '1.1': 'VAL_SITE_C3',
  2: 'VAL_MOOD_B2',
  3: 80,
  '4.1': 'VAL_ITEM_D4',
}

// 造一个最简节点：没给的字段就是「不读不写不带上游、0 回合、空提示词」
export function makeNode(over: Partial<ChainNode> & { id: string; type: ChainNode['type'] }): ChainNode {
  return {
    name: over.id,
    reads: [],
    writable: [],
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
    ...over,
  }
}

export const TIME_NODE = makeNode({ id: 'time', type: 'time', writable: ['0'] })
export const CHECK_NODE = makeNode({ id: 'check', type: 'normal', writable: ['1', '2'], historyTurns: 2 })
export const OUTPUT_NODE = makeNode({
  id: 'output',
  type: 'output',
  reads: ['pr1', '1', '2'],
  readsUpstream: ['check'],
  historyTurns: 3,
  prompt: 'NODE_OUT',
})

export const CHAIN: ChainNode[] = [TIME_NODE, CHECK_NODE, OUTPUT_NODE]

export const PROMPTS = [
  { id: 'opening', title: 'opening', body: '' },
  { id: 'pr1', title: 'tone', body: 'BODY_ONE' },
  { id: 'pr2', title: 'style', body: 'BODY_TWO' },
]

export const PRESETS: Preset[] = [
  {
    id: 'p-deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-pro',
    apiKey: '',
    reasoning: 'medium',
  },
  {
    id: 'p-deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    apiKey: '',
    reasoning: 'off',
  },
]

/** 一个时间节点的 trace（有工具调用、没有正文、没有思考、没有用量） */
export const TRACE_TIME: TraceDetail = {
  nodeId: 'time',
  nodeName: 'time',
  nodeType: 'time',
  presetId: 'p-deepseek-v4-flash',
  prompt: '> act one\n\nday 1 hour 8',
  thinking: '',
  toolCalls: [{ name: 'advance_time', args: { amount: 1, unit: 'day' }, result: 'day 1 hour 9' }],
  output: '',
  usage: null,
  durationMs: 12,
  tps: null,
  turn: 1,
}

/** 一个输出节点的 trace（有思考、有正文、有用量） */
export const TRACE_OUTPUT: TraceDetail = {
  nodeId: 'output',
  nodeName: 'output',
  nodeType: 'output',
  presetId: 'p-deepseek-v4-pro',
  prompt: 'BODY_ONE\n\n1 place = VAL_PLACE_A1\n\n> act one\n\nNODE_OUT',
  thinking: 'THINK_ONE\nTHINK_TWO',
  toolCalls: [],
  output: '[mock] turn 1: act one',
  usage: { inputTokens: 128, outputTokens: 64, totalTokens: 192 },
  durationMs: 320,
  tps: 200,
  turn: 1,
}

/** 一回合的合计读数（跟在故事流里那一回合的末尾） */
export const TURN_STATS: TurnStatsDetail = {
  turn: 1,
  totalMs: 360,
  usage: { inputTokens: 128, outputTokens: 64, totalTokens: 192 },
  tps: 53.3,
}
