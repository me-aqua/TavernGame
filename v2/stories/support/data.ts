/**
 * 组件故事用的样例数据（**纯数据，全 ASCII**）。
 *
 * 为什么单开一份：几个故事要的是同一张卡 / 同一个节点 / 同一批预设 —— 各写一份迟早不一致，
 * 而不一致的样例会让「结构检查通过」这件事变得没意义。
 */
import type { DebugPayload } from '../../src/core/engine'
import type { ChainNode, Preset, StateElement } from '../../src/core/types'

export const ELEMENTS: StateElement[] = [
  { code: '0', name: 'time', note: '', type: 'string', initial: { day: 1, hour: 8 } },
  { code: '1', name: 'place', note: 'where the scene happens', type: 'string', initial: 'VAL_PLACE_A1' },
  { code: '2', name: 'mood', note: '', type: 'string', initial: 'VAL_MOOD_B2' },
]

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

export const DEBUG: DebugPayload = {
  prompts: {
    time: '> act one\n\nNODE_TIME',
    check: '[node:check] > act one',
    output: 'BODY_ONE\n\n1 place = VAL_PLACE_A1\n\n> act one\n\nNODE_OUT',
  },
  responses: { time: '', check: '', output: '[mock] turn 1: act one' },
  tools: [
    { nodeId: 'time', name: 'advance_time', args: { hours: 1 } },
    { nodeId: 'check', name: 'write_state', args: { path: '1', value: 'mock-t1' } },
  ],
  usage: { inputTokens: 128, outputTokens: 64, totalTokens: 192 },
  presets: {
    time: 'p-deepseek-v4-flash',
    check: 'p-deepseek-v4-flash',
    output: 'p-deepseek-v4-pro',
  },
  nodes: {
    time: { durationMs: 12, usage: null, tps: null },
    check: { durationMs: 9, usage: null, tps: null },
    output: {
      durationMs: 320,
      usage: { inputTokens: 128, outputTokens: 64, totalTokens: 192 },
      tps: 200,
    },
  },
  totalMs: 360,
}
