/**
 * 第 2 关的共用夹具：卡 / 存档 / 预设 / 内存版存储后端。
 *
 * 形状照 `.team/leader/2026-11-26/阶段2.1-状态树-契约草案-v5.md`（下称「v5 契约」）写 ——
 * 阶段 2.1 起状态元素有五种类型，时间值是公历六格；契约改了这里要跟着改
 * （夹具不是第二份真源，它是同一份形状的一份可执行副本 —— 判据与夹具对不上时，先怀疑夹具）。
 *
 * 🔴 **这里只有一种格式：v5 契约的形状**（老板 2026-11-25：不做旧卡兼容、不做迁移）。
 *    没有校对节点（`NodeType` 只有 time / normal / output）、`readsUpstream` 是**节点 id 数组**、
 *    每张卡都带 `opening` 提示词块。旧格式（`type:'string'` / `{day,hour}`）的卡在 `validateCard`
 *    就该被拒 —— 那是判据，不是夹具的活。
 *
 * ⚠️ 这两张夹具卡都是**扁平**的（没有「自身值 + 孩子」的节点）：`tree` 与 `state[]` 一一对应。
 *    带 `.0` 自身值的形状归 `support/state-fixtures.js`（v5 新增判据吃那一份）。
 *
 * ⚠️ 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络。
 *    vitest（node）与 Playwright（浏览器侧）都用它。
 */
import { TIME_VALUE } from './state-fixtures.js'

export { TIME_VALUE }

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

/** 每张卡必带的那块「开场」提示词（fixtures 里用 ASCII 记号，不抄产品文案） */
export const OPENING_PROMPT = { id: 'opening', title: 'opening', body: '' }

/**
 * 一条工作流节点（默认值 = 契约 §2.1 表里最简的那一列）。
 * 🔴 **没有 `presetId`**：模型绑定住在 `tg2.nodeModels`（§2.5），不在卡里。
 * 🔴 `readsUpstream` 是**节点 id 数组**（读哪些前面节点的输出），不是布尔。
 */
export function makeNode(id, type, over = {}) {
  return {
    id,
    type,
    name: id,
    reads: [],
    writable: [],
    readsUpstream: [],
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

/** 一个时间元素（2.2：year-minute 五格 + 模式 + 三个节日勾选 + 颗粒度上下界） */
function timeElement() {
  return {
    code: '0',
    name: 'time',
    note: '',
    type: 'time',
    timeMode: 'year-minute',
    granularityUpper: 'day',
    granularityLower: 'minute',
    holidays: { international: false, china: false, traditional: false },
    initial: { ...TIME_VALUE },
  }
}

/**
 * 三个根元素：`0` 时间 + 两个文本根，初值用**只会出现在初值里**的记号（眼睛断言要能不歧义地找它）。
 * 2.2 起 initial 只挂在根上：文本根的 initial 是「它自己那条值路径」的小表。
 */
function baseState() {
  return [
    timeElement(),
    { code: '1', name: 'place', note: '', type: 'text', initial: { 1: 'VAL_PLACE_A1' } },
    { code: '2', name: 'mood', note: '', type: 'text', initial: { 2: 'VAL_MOOD_B2' } },
  ]
}

/**
 * 「内容齐全」的一张卡（四节点：时间 / 判定 / 中间节点 / 输出）。
 *
 * 为什么留一个中间的 `extra`：上游是**按节点点名的名单**，判据要能看见
 * 「只读名单里的那个、而且按链顺序」—— 一个上游的链证不了这两件事。
 * 输出节点读 `check` + `extra`，不读 `time`（这样「没点名的上游不出现」也有得判）。
 */
export function makeCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c1',
    name: 'card one',
    state: baseState(),
    prompts: [
      { ...OPENING_PROMPT },
      { id: 'pr1', title: 'tone', body: 'BODY_ONE' },
      { id: 'pr2', title: 'style', body: 'BODY_TWO' },
    ],
    chain: [
      makeNode('time', 'time', { writable: ['0'], prompt: 'NODE_TIME' }),
      makeNode('check', 'normal', { writable: ['1', '2'], prompt: 'NODE_CHECK' }),
      makeNode('extra', 'normal', { prompt: 'NODE_EXTRA' }),
      makeNode('output', 'output', {
        reads: ['pr1', 'pr2', '1', '2'],
        readsUpstream: ['check', 'extra'],
        historyTurns: 3,
        prompt: 'NODE_OUT',
      }),
    ],
    ...over,
  }
}

/**
 * 契约 §2.1 的「新建卡」形状 —— id / 类型 / 编码 / 默认开关都对得上界面建出来的卡。
 * ⚠️ 只有 `name` 不同：那是**展示文案**（`cards.ts` 走 `t()` 给中文），夹具里用 ASCII 记号，
 *    判据不该跟着文案漂（e2e 里真建卡那一条另有断言钉文案）。
 */
export function freshCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-fresh',
    name: 'card fresh',
    state: [timeElement()],
    prompts: [{ ...OPENING_PROMPT }],
    chain: [
      makeNode('time', 'time', { writable: ['0'] }),
      makeNode('check', 'normal'),
      makeNode('output', 'output', { readsUpstream: ['check'], historyTurns: 3 }),
    ],
    ...over,
  }
}

/** 存档：`tree` 由**根 initial** 摊出来（深拷贝；时间根是五格时间值） */
export function makeSave(card, over = {}) {
  const tree = {}
  for (const root of card.state) {
    if (root.code.includes('.')) continue
    if (root.type === 'time') tree[root.code] = { ...root.initial }
    else Object.assign(tree, root.initial)
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
