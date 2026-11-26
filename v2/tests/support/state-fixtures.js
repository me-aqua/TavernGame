/**
 * 阶段 2.1（状态树 v5）的共用夹具：**只有卡 / 存档数据，没有一行产品代码**。
 *
 * 形状照 `.team/leader/2026-11-26/阶段2.1-状态树-契约草案-v5.md`（下称「v5 契约」）写：
 *   · `StateType` = `time` / `text` / `integer` / `enum` / `object`；
 *   · 节点可以**同时有自身值和孩子**：自身值住在 `<code>.0`，孩子从 `<code>.1` 起；
 *   · `object` 没有自身值（`initial` 不出现）；
 *   · 时间值是公历六格 `{ year, month, day, hour, minute, second }`。
 *
 * 共用夹具 `support/fixtures.js`（卡 / 存档 / 预设 / 存储后端）用的是**扁平的** v5 卡；
 * 这一份只给「自身值 + 孩子」（`.0`）、`pathsOf` / `initialTreeOf` / 深度这几类形状判据用。
 * `TIME_VALUE` 由两边共用（同一个时间初值，免得两个夹具各写一份）。
 *
 * ⚠️ 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络；单测与 e2e 共用。
 */

/** 时间初值：2024-01-01（周一）08:05:00 —— 星期几有确定答案，格式化判据靠它 */
export const TIME_VALUE = { year: 2024, month: 1, day: 1, hour: 8, minute: 5, second: 0 }

/** 一个状态元素；缺省 name 用 code（判据不依赖文案） */
export function element(code, type, over = {}) {
  return { code, name: code, note: '', type, ...over }
}

/**
 * 一份「五种类型都齐」的状态表：
 *
 * ```text
 * 0 时间（time）
 * 1 世界（object）
 *   1.1 区域（enum，自身值 + 孩子）
 *     1.1.1 地点（text）
 *   1.2 天气（text）
 * 2 玩家（object）
 *   2.1 名字（text）
 *   2.2 体力（integer 0..100，步幅 1..10）
 *   2.3 状态（enum）
 *   2.4 背包（object）
 *     2.4.1 物品（text）
 * ```
 */
export function stateV5() {
  return [
    element('0', 'time', {
      name: 'time',
      initial: { ...TIME_VALUE },
      granularityUpper: 'day',
      granularityLower: 'minute',
    }),
    element('1', 'object', { name: 'world' }),
    element('1.1', 'enum', { name: 'region', values: ['A1', 'A2'], initial: 'A1' }),
    element('1.1.1', 'text', { name: 'site', initial: 'SITE_X' }),
    element('1.2', 'text', { name: 'mood', initial: 'MOOD_Y' }),
    element('2', 'object', { name: 'player' }),
    element('2.1', 'text', { name: 'hero', initial: 'HERO' }),
    element('2.2', 'integer', { name: 'stamina', min: 0, max: 100, stepMin: 1, stepMax: 10, initial: 80 }),
    element('2.3', 'enum', { name: 'state', values: ['OK', 'HURT'], initial: 'OK' }),
    element('2.4', 'object', { name: 'bag' }),
    element('2.4.1', 'text', { name: 'item', initial: 'SWORD' }),
  ]
}

/** 一条工作流节点（默认值 = 最简合法列） */
export function node(id, type, over = {}) {
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
 * 与 `stateV5()` 配套的三节点链（时间 / 判定 / 输出）。
 * `check` 能写 `1.1`（父 code ⇒ 覆盖自身值 `1.1.0` 与孩子 `1.1.1`）与其余叶子。
 */
export function chainV5() {
  return [
    node('time', 'time', { writable: ['0'] }),
    node('check', 'normal', {
      reads: ['1.1', '1.2', '2.1', '2.2', '2.3', '2.4', '2.4.1'],
      // `2.4` 是 object（有子树、没有自身值）：它的 code 能进 writable，但写它自己要报错
      writable: ['1.1', '2.1', '2.2', '2.3', '2.4', '2.4.1'],
    }),
    node('output', 'output', { reads: ['1.1', '1.2'], readsUpstream: ['check'], historyTurns: 3 }),
  ]
}

/** 一张 v5 形状的卡（`state` / `chain` / `prompts` 都齐；每张卡必须有 `opening`） */
export function v5Card(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-v5',
    name: 'v5 card',
    state: stateV5(),
    chain: chainV5(),
    prompts: [
      { id: 'opening', title: 'opening', body: '' },
      { id: 'pr1', title: 'tone', body: 'BODY_ONE' },
    ],
    ...over,
  }
}

/** 换一份 state（造非法形状用；不动其他格） */
export function withState(card, state) {
  return { ...card, state }
}

/** 按 code 找元素（找不到返回 undefined —— 判据自己断言它存在） */
export function elementOf(card, code) {
  return card.state.find((item) => item.code === code)
}

/**
 * v5 契约 §7.2 的扁平树值（与 `stateV5()` 对应）：
 * 有孩子的节点用 `.0` 存自身值；`object`（`1` / `2` / `2.4`）没有键；叶子用自身 code。
 */
export function treeV5() {
  return {
    0: { ...TIME_VALUE },
    '1.1.0': 'A1',
    '1.1.1': 'SITE_X',
    1.2: 'MOOD_Y',
    2.1: 'HERO',
    2.2: 80,
    2.3: 'OK',
    '2.4.1': 'SWORD',
  }
}

/** 一份合法的存档（tree 用 `treeV5()`；`cardSnapshot` 是卡的深拷贝） */
export function v5Save(card = v5Card(), over = {}) {
  return {
    schemaVersion: 1,
    id: 's-v5',
    cardId: card.id,
    cardSnapshot: JSON.parse(JSON.stringify(card)),
    name: 'v5 save',
    turn: 0,
    tree: treeV5(),
    events: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/**
 * 深度 5 的卡：`1.1.1.1.1`（五段）是合法上界。
 * 中间几层都是**标量节点带孩子**（v5 契约 §2：不再自动转 object，类型描述的是自身值）。
 */
export function deepCard() {
  return v5Card({
    id: 'c-deep',
    state: [
      element('0', 'time', {
        initial: { ...TIME_VALUE },
        granularityUpper: 'day',
        granularityLower: 'minute',
      }),
      element('1', 'object'),
      element('1.1', 'text', { initial: 'L1' }),
      element('1.1.1', 'text', { initial: 'L2' }),
      element('1.1.1.1', 'text', { initial: 'L3' }),
      element('1.1.1.1.1', 'text', { initial: 'L4' }),
    ],
    chain: [
      node('time', 'time', { writable: ['0'] }),
      node('check', 'normal', { reads: ['1.1'], writable: ['1.1'] }),
      node('output', 'output', { reads: ['1.1'], readsUpstream: ['check'], historyTurns: 3 }),
    ],
  })
}

/** 深度 6（`1.1.1.1.1.1`）—— 超过上界，必须被拦 */
export function tooDeepCard() {
  const card = deepCard()
  return withState(card, [...card.state, element('1.1.1.1.1.1', 'text', { initial: 'L5' })])
}
