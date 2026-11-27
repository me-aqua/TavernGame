/**
 * 阶段 2.2（初始值归根 + 公历三模式 + 节日）的共用夹具：**只有卡 / 存档数据，没有一行产品代码**。
 *
 * 形状照 `.team/test/2026-11-27/契约-阶段2.2-初始值归根与公历时间节日.md`（下称「2.2 契约」）：
 *   · `initial` 只挂在**根元素**上；根 initial = 整棵子树的扁平值表（时间根例外：就是时间值本身）；
 *   · 时间值有三种模式：`year-minute` / `year-date` / `days-minute`（没有秒）；
 *   · 时间元素带 `timeMode` + `holidays`（天数模式没有 `holidays`）。
 *
 * ⚠️ **这是新形状的一份可执行副本，不是第二份真源**：判据与它冲突时先怀疑它。
 * ⚠️ 旧的 `support/fixtures.js` / `support/state-fixtures.js` 仍是 2.1 形状（第 3 关同批迁移）；
 *    这一份只给 2.2 的新判据与 e2e 用。
 *
 * 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络；单测与 e2e 共用。
 */

/** 时间初值：2024-02-10（周六）08:30 —— 这天是春节，节日判据有确定答案 */
export const TIME_V6 = { year: 2024, month: 2, day: 10, hour: 8, minute: 30 }

/** 天数模式的初值（没有年月） */
export const TIME_DAYS_V6 = { day: 5, hour: 8, minute: 30 }

/** 三个节日勾选的缺省：全关 */
export function holidaysV6(over = {}) {
  return { international: false, china: false, traditional: false, ...over }
}

/** 一个状态元素；缺省 name 用 code（判据不依赖文案） */
export function elementV6(code, type, over = {}) {
  return { code, name: code, note: '', type, ...over }
}

/** 时间元素（根）：三种模式各给一份合法的初值；天数模式**没有** holidays */
export function timeElementV6({ mode = 'year-minute', time, holidays, over = {} } = {}) {
  // 严格形状：每个模式只给**恰好**那几格（year-minute 5 / year-date 3 / days-minute 3），不许更细
  const initial =
    time ??
    (mode === 'days-minute'
      ? { ...TIME_DAYS_V6 }
      : mode === 'year-date'
        ? { year: TIME_V6.year, month: TIME_V6.month, day: TIME_V6.day }
        : { ...TIME_V6 })
  const base = {
    code: '0',
    name: 'time',
    note: '',
    type: 'time',
    timeMode: mode,
    initial,
    ...over,
  }
  if (mode !== 'days-minute') base.holidays = holidays ?? holidaysV6()
  return base
}

/**
 * 一棵覆盖 A / B 两面的状态树（根 initial 就在根元素身上）：
 *
 * ```text
 * 0 时间（time，模式由参数给）
 * 1 世界（object，initial 三个键）
 *   1.1 区域（enum A1/A2，自身值 + 孩子 ⇒ 自身值住 1.1.0）
 *     1.1.1 地点（text）
 *   1.2 天气（text）
 * 2 玩家（object，initial 两个键）
 *   2.1 名字（text）
 *   2.2 体力（integer 0..100，步幅 1..10）
 * ```
 */
export function stateV6({ mode = 'year-minute', time, holidays } = {}) {
  return [
    timeElementV6({ mode, time, holidays }),
    elementV6('1', 'object', { initial: { '1.1.0': 'A1', '1.1.1': 'SITE_X', 1.2: 'MOOD_Y' } }),
    elementV6('1.1', 'enum', { values: ['A1', 'A2'] }),
    elementV6('1.1.1', 'text'),
    elementV6('1.2', 'text'),
    elementV6('2', 'object', { initial: { 2.1: 'HERO', 2.2: 80 } }),
    elementV6('2.1', 'text'),
    elementV6('2.2', 'integer', { min: 0, max: 100, stepMin: 1, stepMax: 10 }),
  ]
}

/** 一条工作流节点（默认值 = 最简合法列） */
export function nodeV6(id, type, over = {}) {
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

/** 三节点链：时间 / 判定 / 输出；`check` 读时间（节日行才有地方出现）与状态 */
export function chainV6() {
  return [
    nodeV6('time', 'time', { writable: ['0'] }),
    nodeV6('check', 'normal', {
      reads: ['0', '1.1', '1.2', '2.1', '2.2'],
      writable: ['1.1', '1.2', '2.1', '2.2'],
    }),
    nodeV6('output', 'output', { reads: ['1.1', '1.2'], readsUpstream: ['check'], historyTurns: 3 }),
  ]
}

/** 一张 2.2 形状的卡（每张卡必须有 `opening`） */
export function v6Card(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-v6',
    name: 'v6 card',
    state: stateV6(),
    chain: chainV6(),
    prompts: [
      { id: 'opening', title: 'opening', body: '' },
      { id: 'pr1', title: 'tone', body: 'BODY_ONE' },
    ],
    ...over,
  }
}

/** 按 code 找元素（找不到返回 undefined —— 判据自己断言它存在） */
export function elementOf(card, code) {
  return card.state.find((item) => item.code === code)
}

/** 某个根元素的 initial 表（时间根返回包一层 `{ 0: 时间值 }`，方便统一读） */
export function rootInitialOf(card, code) {
  const root = elementOf(card, code)
  if (!root) return undefined
  return root.type === 'time' ? { [code]: root.initial } : root.initial
}

/** 从根 initial 摊平成树（夹具侧的独立算法，判据拿它造存档；不 import 产品代码） */
export function treeOf(card) {
  const tree = {}
  for (const root of card.state) {
    if (root.code.includes('.')) continue
    if (root.type === 'time') tree[root.code] = { ...root.initial }
    else for (const [path, value] of Object.entries(root.initial ?? {})) tree[path] = value
  }
  return tree
}

/** 一份合法的存档（`tree` 用夹具自己的算法展开；`cardSnapshot` 是卡的深拷贝） */
export function v6Save(card = v6Card(), over = {}) {
  return {
    schemaVersion: 1,
    id: 's-v6',
    cardId: card.id,
    cardSnapshot: JSON.parse(JSON.stringify(card)),
    name: 'v6 save',
    turn: 0,
    tree: treeOf(card),
    events: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** 一张给定模式 / 初值 / 节日的卡（e2e 与单测都要它） */
export function cardWithTime({ mode = 'year-minute', time, holidays, id = 'c-time' } = {}) {
  return v6Card({ id, state: stateV6({ mode, time, holidays }) })
}
