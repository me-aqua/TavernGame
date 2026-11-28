/**
 * 阶段 3 数组节点（第 2 关）的共用夹具：**只有卡 / 存档数据，没有一行产品代码**。
 *
 * 形状照 `.team/test/2026-11-28/契约-阶段3-数组.md`（下称「数组契约」）：
 *   · 数组元素 `type: 'array'`，值住在**节点自己的 code**（`2.4`），是 item 结构体列表；
 *   · item 的键 = 字段的完整 code（`2.4.1` / `2.4.2`），值是字段值；
 *   · 子元素是字段定义（schema），不是值路径；没有 `2.4.0`；
 *   · 初始值仍然只挂根元素：`root.initial['2.4']` 就是整份数组。
 *
 * 三张卡：
 *   · `holdCard()`    —— 最简背包：`2.4 背包`（物品 text / 数量 integer 0..999），三项初始值；
 *   · `nestedCard()`  —— 嵌套：`2.4.2 属性`（object）里再放 `2.4.2.2 附魔`（array），深度 5；
 *   · `deepCard()` / `tooDeepCard()` —— 深度 5 合法 / 深度 6 超界。
 *
 * ⚠️ 这是同一份形状的一份可执行副本，不是第二份真源：判据与契约冲突时先怀疑它。
 * ⚠️ 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络；单测与 e2e 共用。
 */

/** 时间初值：2024-02-10（周六）08:30 */
export const TIME = { year: 2024, month: 2, day: 10, hour: 8, minute: 30 }

/** 背包的三项初始值（键是字段 code，不是中文名；item 带隐藏 id，阶段 4 起所有数组 item 都有） */
export function holdItems() {
  return [
    { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1 },
    { id: 'id_2', '2.4.1': '斗篷', '2.4.2': 1 },
    { id: 'id_3', '2.4.1': '银币', '2.4.2': 3 },
  ]
}

/** 三个节日勾选的缺省：全关（时间根要它） */
export function holidays() {
  return { international: false, china: false, traditional: false }
}

/** 一个状态元素；缺省 name 用 code（判据不依赖文案） */
export function element(code, type, over = {}) {
  return { code, name: code, note: '', type, ...over }
}

/** 时间根 */
export function timeElement() {
  return element('0', 'time', {
    name: '时间',
    timeMode: 'year-minute',
    initial: { ...TIME },
    holidays: holidays(),
  })
}

/** 三节点链：时间 / 判定 / 输出；判定能读能写 `2.4`（数组容器 code） */
export function holdChain() {
  return [
    {
      id: 'time',
      type: 'time',
      name: '时间',
      reads: [],
      writable: ['0'],
      readsUpstream: [],
      historyTurns: 0,
      prompt: '',
    },
    {
      id: 'check',
      type: 'normal',
      name: '判定',
      reads: ['2.1', '2.4'],
      writable: ['2.1', '2.4'],
      readsUpstream: [],
      historyTurns: 0,
      prompt: '',
    },
    {
      id: 'output',
      type: 'output',
      name: '输出',
      reads: ['2.4'],
      writable: [],
      readsUpstream: ['check'],
      historyTurns: 3,
      prompt: '',
    },
  ]
}

/**
 * 最简背包卡：
 *
 * ```text
 * 0 时间（time）
 * 1 世界（object）        initial: 1.1 = A1
 *   1.1 区域（text）
 * 2 玩家（object）        initial: 2.1 / 2.2 / 2.3 / 2.4
 *   2.1 名字（text）
 *   2.2 体力（integer 0..100，步幅 1..10）
 *   2.3 状态（enum：正常 / 受伤）
 *   2.4 背包（array）
 *     2.4.1 物品（text）
 *     2.4.2 数量（integer 0..999）
 * ```
 */
export function holdCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-array',
    name: 'array card',
    state: [
      timeElement(),
      element('1', 'object', { name: '世界', initial: { 1.1: 'A1' } }),
      element('1.1', 'text', { name: '区域' }),
      element('2', 'object', {
        name: '玩家',
        initial: { 2.1: '旅人', 2.2: 80, 2.3: '正常', 2.4: holdItems() },
      }),
      element('2.1', 'text', { name: '名字' }),
      element('2.2', 'integer', { name: '体力', min: 0, max: 100, stepMin: 1, stepMax: 10 }),
      element('2.3', 'enum', { name: '状态', values: ['正常', '受伤'] }),
      element('2.4', 'array', { name: '背包', note: '身上的东西' }),
      element('2.4.1', 'text', { name: '物品' }),
      element('2.4.2', 'integer', { name: '数量', min: 0, max: 999 }),
    ],
    chain: holdChain(),
    prompts: [
      { id: 'opening', title: '开场', body: '' },
      { id: 'pr1', title: '世界观', body: 'BODY_ONE' },
    ],
    ...over,
  }
}

/** 嵌套背包的初始值：object 字段里再套一个 array 字段（深度 5；两层数组的 item 各自从 id_1 起） */
export function nestedItems() {
  return [
    {
      id: 'id_1',
      '2.4.1': '短剑',
      '2.4.2': {
        '2.4.2.1': '普通',
        '2.4.2.2': [{ id: 'id_1', '2.4.2.2.1': '锋锐', '2.4.2.2.2': 2 }],
      },
    },
  ]
}

/**
 * 数组卡：骨架照 `holdCard`（根 `0` / `1` / `2` 与 `2` 的孩子 `2.1`–`2.4` 都齐），
 * 只把 `2.4` 这棵字段子树换成给定字段、初始值换成给定数组。
 *
 * 编号铁律对数组字段同样成立：夹具自带缺号会让每一条用例都红，分不清是夹具坏了还是功能没做。
 */
function arrayFieldCard({ id, name, initial, fields }) {
  const base = holdCard()
  const state = [
    ...base.state.filter((item) => item.code !== '2.4' && !item.code.startsWith('2.4.')),
    element('2.4', 'array', { name: '背包' }),
    ...fields,
  ].map((item) => (item.code === '2' ? { ...item, initial: { ...item.initial, 2.4: initial } } : item))
  return {
    ...base,
    id,
    name,
    state,
    chain: base.chain.map((node) =>
      node.id === 'check' ? { ...node, reads: ['2.4'], writable: ['2.4'] } : node,
    ),
  }
}

/**
 * 嵌套卡（字段定义 + 值都递归）：
 *
 * ```text
 * 2.4 背包（array）
 *   2.4.1 物品（text）
 *   2.4.2 属性（object）
 *     2.4.2.1 品质（enum：普通 / 稀有）
 *     2.4.2.2 附魔（array）
 *       2.4.2.2.1 名称（text）
 *       2.4.2.2.2 强度（integer 0..10）
 * ```
 */
export function nestedCard(over = {}) {
  return {
    ...arrayFieldCard({
      id: 'c-nested',
      name: 'nested card',
      initial: nestedItems(),
      fields: [
        element('2.4.1', 'text', { name: '物品' }),
        element('2.4.2', 'object', { name: '属性' }),
        element('2.4.2.1', 'enum', { name: '品质', values: ['普通', '稀有'] }),
        element('2.4.2.2', 'array', { name: '附魔' }),
        element('2.4.2.2.1', 'text', { name: '名称' }),
        element('2.4.2.2.2', 'integer', { name: '强度', min: 0, max: 10 }),
      ],
    }),
    ...over,
  }
}

/** 深度 5 的初始值：2.4.1(object) → 2.4.1.1(object) → 2.4.1.1.1(text) */
export function deepItems() {
  return [{ id: 'id_1', '2.4.1': { '2.4.1.1': { '2.4.1.1.1': 'L5' } } }]
}

/** 深度 5（`2.4.1.1.1`）合法 */
export function deepCard(over = {}) {
  return {
    ...arrayFieldCard({
      id: 'c-deep-array',
      name: 'deep array card',
      initial: deepItems(),
      fields: [
        element('2.4.1', 'object', { name: '层一' }),
        element('2.4.1.1', 'object', { name: '层二' }),
        element('2.4.1.1.1', 'text', { name: '层三' }),
      ],
    }),
    ...over,
  }
}

/** 深度 6（`2.4.1.1.1.1`）超界 */
export function tooDeepCard() {
  return arrayFieldCard({
    id: 'c-too-deep-array',
    name: 'too deep array card',
    initial: [{ id: 'id_1', '2.4.1': { '2.4.1.1': { '2.4.1.1.1': { '2.4.1.1.1.1': 'L6' } } } }],
    fields: [
      element('2.4.1', 'object', { name: '层一' }),
      element('2.4.1.1', 'object', { name: '层二' }),
      element('2.4.1.1.1', 'object', { name: '层三' }),
      element('2.4.1.1.1.1', 'text', { name: '层四' }),
    ],
  })
}

/** 从卡摊平成树（夹具侧的独立算法；数组 / 对象都深拷贝） */
export function treeOf(card) {
  const tree = {}
  for (const root of card.state) {
    if (root.code.includes('.')) continue
    if (root.type === 'time') tree[root.code] = { ...root.initial }
    else Object.assign(tree, JSON.parse(JSON.stringify(root.initial ?? {})))
  }
  return tree
}

/** 一份合法存档（`tree` 用夹具自己的算法展开；`cardSnapshot` 是卡的深拷贝） */
export function holdSave(card = holdCard(), over = {}) {
  return {
    schemaVersion: 1,
    id: 's-array',
    cardId: card.id,
    cardSnapshot: JSON.parse(JSON.stringify(card)),
    name: 'array save',
    turn: 0,
    tree: treeOf(card),
    events: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** 按 code 找元素（找不到返回 undefined —— 判据自己断言它存在） */
export function elementOf(card, code) {
  return card.state.find((item) => item.code === code)
}

/** 改一个元素的字段（其余原样） */
export function patchElement(card, code, change) {
  return { ...card, state: card.state.map((item) => (item.code === code ? { ...item, ...change } : item)) }
}

/** 把一条值写进所属根元素的 initial 表（只用于 `2` 这棵子树） */
export function withInitialValue(card, path, value) {
  const rootCode = path.split('.')[0]
  return {
    ...card,
    state: card.state.map((item) =>
      item.code === rootCode ? { ...item, initial: { ...item.initial, [path]: value } } : item,
    ),
  }
}

/** 从 initial 表里删掉一条值路径 */
export function withoutInitialValue(card, path) {
  const rootCode = path.split('.')[0]
  return {
    ...card,
    state: card.state.map((item) => {
      if (item.code !== rootCode) return item
      const initial = { ...item.initial }
      delete initial[path]
      return { ...item, initial }
    }),
  }
}
