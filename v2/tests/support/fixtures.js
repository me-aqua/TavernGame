/**
 * 第 2 关的共用夹具：卡 / 存档 / 预设 / 内存版存储后端。
 *
 * 形状照 `v2/CONTRACT.md` §2 / §7 写；契约改了这里要跟着改（夹具不是第二份真源，
 * 它是同一份形状的一份可执行副本 —— 判据与夹具对不上时，先怀疑夹具）。
 *
 * ⚠️ 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络。
 *    vitest（node）与 Playwright（浏览器侧）都用它。
 */

/** 契约 §7：mock 提供方。测试里一切「跑一回合」都用它，不联外网。 */
export const MOCK_PRESET = {
  id: 'p-mock',
  name: 'mock',
  provider: 'mock',
  baseUrl: '',
  model: 'mock-1',
  apiKey: '',
  reasoning: 'off',
  mockChunkDelayMs: 0,
}

/** 第二个预设：只为「这个节点用了哪个预设」那条判据准备（行为与第一个一样） */
export const MOCK_PRESET_B = { ...MOCK_PRESET, id: 'p-mock-b', name: 'mock-b' }

/**
 * 一条工作流节点（默认值 = 契约 §2.1 表里最简的那一列）。
 * 🔴 **没有 `presetId`**：模型绑定住在 `tg2.nodeModels`（§2.5），不在卡里。
 */
export function makeNode(id, type, over = {}) {
  return {
    id,
    type,
    name: id,
    reads: [],
    writable: [],
    readsUpstream: false,
    historyTurns: 0,
    prompt: '',
    ...over,
  }
}

/**
 * 这张卡的模型映射（`tg2.nodeModels` 里那一片）：每个节点都指向同一个预设。
 * 引擎收的是 `presets` 池子 + `nodePresets` 这一片。
 */
export function nodeModelsFor(card, presetId = MOCK_PRESET.id) {
  return Object.fromEntries(card.chain.map((node) => [node.id, presetId]))
}

/** 三个元素：`0` 时间 + 两个文本，初值用**只会出现在初值里**的记号（眼睛断言要能不歧义地找它） */
function baseState() {
  return [
    { code: '0', name: 'time', note: '', type: 'string', initial: { day: 1, hour: 8 } },
    { code: '1', name: 'place', note: '', type: 'string', initial: 'VAL_PLACE_A1' },
    { code: '2', name: 'mood', note: '', type: 'string', initial: 'VAL_MOOD_B2' },
  ]
}

/**
 * 「内容齐全」的一张卡：两块公共提示词、两个可写元素、输出节点读全、校对节点读上游。
 * 引擎 / 提示词那一侧的单测用它。
 */
export function makeCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c1',
    name: 'card one',
    state: baseState(),
    prompts: [
      { id: 'pr1', title: 'tone', body: 'BODY_ONE' },
      { id: 'pr2', title: 'style', body: 'BODY_TWO' },
    ],
    chain: [
      makeNode('time', 'time', { writable: ['0'], prompt: 'NODE_TIME' }),
      makeNode('check', 'normal', { writable: ['1', '2'], prompt: 'NODE_CHECK' }),
      makeNode('output', 'output', {
        reads: ['pr1', 'pr2', '1', '2'],
        readsUpstream: true,
        historyTurns: 3,
        prompt: 'NODE_OUT',
      }),
      makeNode('proof', 'proof', { readsUpstream: true, prompt: 'NODE_PROOF' }),
    ],
    ...over,
  }
}

/**
 * 契约 §2.1 的「新建卡」**结构**默认值 —— id / 类型 / 编码 / 默认开关都对得上界面建出来的卡。
 * ⚠️ 只有 `name` 不同：那是**展示文案**（`cards.ts` 走 `t()` 给中文），夹具里用 ASCII 记号，
 *    判据不该跟着文案漂（e2e 里真建卡那一条另有断言钉文案）。
 */
export function freshCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-fresh',
    name: 'card fresh',
    state: [{ code: '0', name: 'time', note: '', type: 'string', initial: { day: 1, hour: 8 } }],
    prompts: [],
    chain: [
      makeNode('time', 'time', { writable: ['0'] }),
      makeNode('check', 'normal', { writable: [] }),
      makeNode('output', 'output', { readsUpstream: true, historyTurns: 3 }),
      makeNode('proof', 'proof', { readsUpstream: true }),
    ],
    ...over,
  }
}

/** 存档：`tree` 由卡的初值逐个拷出来（深拷贝；`0` 是对象） */
export function makeSave(card, over = {}) {
  const tree = {}
  for (const element of card.state) {
    tree[element.code] =
      element.code === '0' ? { day: element.initial.day, hour: element.initial.hour } : element.initial
  }
  return {
    schemaVersion: 1,
    id: 's1',
    cardId: card.id,
    cardSnapshot: JSON.parse(JSON.stringify(card)),
    name: 'save one',
    turn: 0,
    tree,
    events: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** 一个已完成的回合（`action` + `narration`），提示词历史断言用 */
export function turnEvents(turn, action, narration) {
  const at = `2026-01-0${turn}T00:00:00.000Z`
  return [
    { type: 'action', text: action, at },
    { type: 'narration', text: narration, at },
  ]
}

/**
 * 内存版存储后端：与 `localStorage` 同形（getItem / setItem / removeItem），
 * 另记一份写入键清单 —— 「只许写 tg2.* 四个键」那条判据要靠它。
 */
export function fakeBackend(initial = {}) {
  const map = new Map(Object.entries(initial))
  const writes = []
  return {
    writes,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
      writes.push(key)
    },
    removeItem: (key) => {
      map.delete(key)
    },
    keys: () => [...map.keys()].sort(),
  }
}

/** 事件收集器：传给 runTurn 的 onEvent */
export function collect() {
  const events = []
  return { events, onEvent: (event) => events.push(event) }
}
