/**
 * 阶段 4 · 引用（第 2 关）的共用夹具：**只有卡 / 存档数据与纯函数，没有一行产品代码**。
 *
 * 形状照 `.team/leader/2026-11-28/阶段4-引用-契约草案.md`（下称「引用契约」）：
 *   · 数组 item 带**隐藏 id**（`id_1` / `id_2`…）：每个数组各自从 `id_1` 起，数组内唯一；
 *   · `type: 'ref'` 的元素有 `refSource`（必须是数组）/ `refFields`（源 item 的直接子字段）/
 *     可选 `refFilter`（单字段等值）/ `min` / `max`；`max = 1` 是单引用，`max > 1` 是多引用；
 *   · 值层存 id：单引用是 `id | null`，多引用是 `null | 有序不重复的 id[]`；零条统一 `null`；
 *   · ref 可以带子元素：有子元素时自身值住 `<code>.0`（`2.5.0`），子元素值住 `<code>.<编号>`。
 *
 * 一张卡 `refCard()`（`2.5` 主手 = 带筛选的 0..1 单引用）：
 *
 * ```text
 * 0 时间（time, year-minute）
 * 1 世界（object）              initial: 1.1 / 1.2 / 1.3 / 1.4 / 1.5
 *   1.1 区域（enum）· 1.2 天气（enum）· 1.3 氛围（text）
 *   1.4 增益定义（array）        item: id + 1.4.1 名称 / 1.4.2 描述
 *   1.5 角色（array）            item: id + 1.5.1 角色名 / 1.5.2 派系
 * 2 玩家（object）              initial: 2.1 … 2.7
 *   2.1 名字（text）· 2.2 体力（integer）· 2.3 状态（enum）
 *   2.4 背包（array）            item: id + 2.4.1 物品 / 2.4.2 数量 / 2.4.3 可手持（是/否）
 *   2.5 主手（ref → 2.4，筛选 2.4.3 = 是，投影 2.4.1，0..1）
 *   2.6 当前增益（array）        item: id + 2.6.1 来源（ref → 1.4，1..1）/ 2.6.2 严重程度（enum）
 *   2.7 副手（ref → 2.4，无筛选，投影 2.4.1，0..1）—— 第二个直接引用者
 * 3 编组（object）              initial: 3.1 / 3.2
 *   3.1 名称（text）
 *   3.2 队伍（ref → 1.5，投影 1.5.1，2..4）—— 多引用
 * ```
 *
 * 两个派生卡：
 *   · `refChildCard()` —— `2.5` 带子元素 `2.5.1 握法`（enum）/ `2.5.2 临时附魔`（text），
 *     自身值因此住 `2.5.0`（引用契约 §4.3）；
 *   · `nestedBagCard()` —— `2.4` 里多一个**嵌套数组字段** `2.4.4 内袋`，另有 `2.8 内袋主手`
 *     引用它（测「传播只走直接引用」：写 `2.4` 不许带出写 `2.8`）；
 *   · `objectFieldBagCard()` —— `2.4` 里多一个**对象字段** `2.4.4 附魔`（测「投影 / 筛选字段只允许
 *     text / integer / enum」）。
 *
 * ⚠️ 这是同一份形状的一份可执行副本，不是第二份真源：判据与契约冲突时先怀疑它。
 * ⚠️ 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络。
 */

/** 时间初值：2024-02-10（周六）08:30 */
export const TIME = { year: 2024, month: 2, day: 10, hour: 8, minute: 30 }

/** 一个状态元素；缺省 name 用 code（判据不依赖文案） */
export function element(code, type, over = {}) {
  return { code, name: code, note: '', type, ...over }
}

/** 一个引用元素：`refSource` / `refFields` / `min` / `max` 显式写出来，可选 `refFilter` */
export function refElement(code, name, over = {}) {
  return { code, name, note: '', type: 'ref', ...over }
}

/** 一条链节点（缺省 = 最简合法列） */
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

/** 时间根 */
export function timeElement() {
  return element('0', 'time', {
    name: '时间',
    timeMode: 'year-minute',
    initial: { ...TIME },
    holidays: { international: false, china: false, traditional: false },
  })
}

/** 背包三项（`2.4.3 可手持`：短剑 / 斗篷 = 是，银币 = 否） */
export function bagItems() {
  return [
    { id: 'id_1', '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
    { id: 'id_2', '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': '是' },
    { id: 'id_3', '2.4.1': '银币', '2.4.2': 3, '2.4.3': '否' },
  ]
}

/** 增益定义两项（另一个数组，所以它的 `id_1` 与背包的 `id_1` 是两条不同记录） */
export function buffDefs() {
  return [
    { id: 'id_1', '1.4.1': '微醺', '1.4.2': '脚步有点飘' },
    { id: 'id_2', '1.4.1': '潮湿', '1.4.2': '衣服贴在身上' },
  ]
}

/** 角色三项 */
export function chars() {
  return [
    { id: 'id_1', '1.5.1': '艾琳', '1.5.2': '游侠' },
    { id: 'id_2', '1.5.1': '阿拉贡', '1.5.2': '王族' },
    { id: 'id_3', '1.5.1': '莱戈拉', '1.5.2': '游侠' },
  ]
}

/** 玩家当前的增益实例：`2.6.1 来源` 指向 `1.4` 的 id */
export function activeBuffs() {
  return [
    { id: 'id_1', '2.6.1': 'id_1', '2.6.2': '轻' },
    { id: 'id_2', '2.6.1': 'id_2', '2.6.2': '中' },
  ]
}

/**
 * `2` 这棵子树的初始值（玩家）。
 * `mainHand` / `offHand` 是引用值：单引用是 `id | null`。
 *
 * ⚠️ 初始值是**扁平表**（键是完整 code）：引用带子元素时，自身值住 `2.5.0`、子元素住 `2.5.1` /
 * `2.5.2`，**没有** `2.5` 这个键（与文本节点带子元素时的 `1.1.0` 同一套口径；契约 §三末条）。
 */
export function playerInitial(over = {}) {
  return {
    2.1: '旅人',
    2.2: 80,
    2.3: '正常',
    2.4: bagItems(),
    2.5: 'id_1',
    2.6: activeBuffs(),
    2.7: null,
    ...over,
  }
}

/** `3` 这棵子树的初始值（编组）：`3.2 队伍` 是 2..4 的多引用，初始两条 */
export function partyInitial(over = {}) {
  return { 3.1: '远征队', 3.2: ['id_1', 'id_2'], ...over }
}

/**
 * 玩家根那张扁平表：引用带子元素时把 `2.5` 拆成 `2.5.0`（自身值）+ `2.5.1` / `2.5.2`（子元素）。
 * 子元素的初值故意不取白名单第一项（`双手` / `火`），这样「清空成默认值」是可观察的。
 */
function playerInitialOf({ mainHand, mainHandChildren, extra }) {
  const table = { ...playerInitial(extra) }
  if (mainHandChildren) {
    delete table['2.5']
    table['2.5.0'] = mainHand
    table['2.5.1'] = '双手'
    table['2.5.2'] = '火'
  } else if (mainHand !== 'id_1') {
    table['2.5'] = mainHand
  }
  return table
}

/** 一条链：时间 / 判定 / 输出；判定读写引用与源数组 */
export function refChain() {
  return [
    node('time', 'time', { name: '时间', writable: ['0'] }),
    node('check', 'normal', {
      name: '判定',
      reads: ['1.1', '1.4', '1.5', '2.1', '2.4', '2.5', '2.6', '2.7', '3.2'],
      writable: ['1.1', '1.4', '1.5', '2.1', '2.4', '2.5', '2.6', '2.7', '3.2'],
    }),
    node('output', 'output', {
      name: '输出',
      reads: ['1.1', '1.4', '2.4', '2.5', '2.6', '3.2'],
      readsUpstream: ['check'],
      historyTurns: 3,
    }),
  ]
}

/** 引用卡的元素表；`extraFields` / `extraElements` 给派生卡追加格子 */
export function refState(over = {}) {
  const {
    mainHandChildren = false,
    bagFields = [],
    extraElements = [],
    extraPlayerInitial = {},
    mainHand = 'id_1',
  } = over
  const mainHandChildrenState = mainHandChildren
    ? [
        element('2.5.1', 'enum', { name: '握法', values: ['单手', '双手'] }),
        element('2.5.2', 'text', { name: '临时附魔' }),
      ]
    : []
  return [
    timeElement(),
    element('1', 'object', {
      name: '世界',
      initial: {
        1.1: '晨风镇',
        1.2: '雨',
        1.3: '炉火噼啪，麦酒和湿羊毛的味道',
        1.4: buffDefs(),
        1.5: chars(),
      },
    }),
    element('1.1', 'enum', { name: '区域', values: ['晨风镇', '镇郊'] }),
    element('1.2', 'enum', { name: '天气', values: ['晴', '雨'] }),
    element('1.3', 'text', { name: '氛围' }),
    element('1.4', 'array', { name: '增益定义' }),
    element('1.4.1', 'text', { name: '名称' }),
    element('1.4.2', 'text', { name: '描述' }),
    element('1.5', 'array', { name: '角色' }),
    element('1.5.1', 'text', { name: '角色名' }),
    element('1.5.2', 'enum', { name: '派系', values: ['游侠', '王族', '商队'] }),
    element('2', 'object', {
      name: '玩家',
      initial: playerInitialOf({ mainHand, mainHandChildren, extra: extraPlayerInitial }),
    }),
    element('2.1', 'text', { name: '名字' }),
    element('2.2', 'integer', { name: '体力', min: 0, max: 100 }),
    element('2.3', 'enum', { name: '状态', values: ['正常', '受伤'] }),
    element('2.4', 'array', { name: '背包' }),
    element('2.4.1', 'text', { name: '物品' }),
    element('2.4.2', 'integer', { name: '数量', min: 0, max: 999 }),
    element('2.4.3', 'enum', { name: '可手持', values: ['是', '否'] }),
    ...bagFields,
    refElement('2.5', '主手', {
      refSource: '2.4',
      refFields: ['2.4.1'],
      refFilter: { field: '2.4.3', value: '是' },
      min: 0,
      max: 1,
    }),
    ...mainHandChildrenState,
    element('2.6', 'array', { name: '当前增益' }),
    refElement('2.6.1', '来源', { refSource: '1.4', refFields: ['1.4.1', '1.4.2'], min: 1, max: 1 }),
    element('2.6.2', 'enum', { name: '严重程度', values: ['轻', '中', '重'] }),
    refElement('2.7', '副手', { refSource: '2.4', refFields: ['2.4.1'], min: 0, max: 1 }),
    element('3', 'object', { name: '编组', initial: partyInitial() }),
    element('3.1', 'text', { name: '名称' }),
    refElement('3.2', '队伍', { refSource: '1.5', refFields: ['1.5.1'], min: 2, max: 4 }),
    ...extraElements,
  ]
}

/** 引用卡（`2.5 主手` 不带子元素 ⇒ 自身值住 `2.5`） */
export function refCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-ref',
    name: 'ref card',
    state: refState(),
    chain: refChain(),
    prompts: [
      { id: 'opening', title: '开场', body: '' },
      { id: 'pr1', title: '世界观', body: 'BODY_ONE' },
    ],
    ...over,
  }
}

/** 引用卡（`2.5 主手` 带子元素 ⇒ 自身值住 `2.5.0`，子元素住 `2.5.1` / `2.5.2`） */
export function refChildCard(over = {}) {
  return {
    ...refCard(),
    id: 'c-ref-child',
    name: 'ref child card',
    state: refState({ mainHandChildren: true }),
    ...over,
  }
}

/**
 * 嵌套数组卡：`2.4 背包` 里多一个数组字段 `2.4.4 内袋`（字段 `2.4.4.1 物品`），
 * 另有 `2.8 内袋主手` 引用 `2.4.4` —— 用来测「写 `2.4` 不带出写 `2.8`」。
 * 内袋 item 自己也有隐藏 id（嵌套数组是另一个数组，从 `id_1` 起）。
 */
export function nestedBagCard(over = {}) {
  const items = bagItems().map((item, index) =>
    index === 0 ? { ...item, '2.4.4': [{ id: 'id_1', '2.4.4.1': '药膏' }] } : { ...item, '2.4.4': [] },
  )
  const state = refState({
    bagFields: [element('2.4.4', 'array', { name: '内袋' }), element('2.4.4.1', 'text', { name: '物品' })],
    extraElements: [
      refElement('2.8', '内袋主手', { refSource: '2.4.4', refFields: ['2.4.4.1'], min: 0, max: 1 }),
    ],
    extraPlayerInitial: { 2.4: items, 2.8: 'id_1' },
  })
  return { ...refCard(), id: 'c-ref-nested', name: 'ref nested card', state, ...over }
}

/**
 * 对象字段卡：`2.4` 里多一个对象字段 `2.4.4 附魔`（子字段 `2.4.4.1 名`）。
 * 用它测「投影字段只能 text / integer / enum」——对象字段不是可选投影。
 */
export function objectFieldBagCard(over = {}) {
  const items = bagItems().map((item) => ({ ...item, '2.4.4': { '2.4.4.1': '火' } }))
  const state = refState({
    bagFields: [element('2.4.4', 'object', { name: '附魔' }), element('2.4.4.1', 'text', { name: '名' })],
    extraPlayerInitial: { 2.4: items },
  })
  return { ...refCard(), id: 'c-ref-object', name: 'ref object card', state, ...over }
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
export function saveOf(card = refCard(), over = {}) {
  return {
    schemaVersion: 1,
    id: 's-ref',
    cardId: card.id,
    cardSnapshot: JSON.parse(JSON.stringify(card)),
    name: 'ref save',
    turn: 0,
    tree: over.tree ?? treeOf(card),
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

/** 换一条链节点的字段（其余原样） */
export function patchNode(card, id, change) {
  return { ...card, chain: card.chain.map((node) => (node.id === id ? { ...node, ...change } : node)) }
}

/** 某个链节点 */
export function nodeOf(card, id) {
  return card.chain.find((node) => node.id === id)
}

/** 把一条值写进所属根元素的 initial 表 */
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

/** 追加一个元素（其余原样） */
export function withElement(card, item) {
  return { ...card, state: [...card.state, item] }
}

/** 整份换掉某个数组的值（`2.4` / `1.4` / `1.5` / `2.6`） */
export function withArrayValue(card, code, items) {
  return withInitialValue(card, code, items)
}

/** 树里换一条值（不动卡） */
export function withTreeValue(tree, path, value) {
  return { ...JSON.parse(JSON.stringify(tree)), [path]: value }
}

// —— 提示词那一侧的读法（三个判据文件共用；`\n\n` 分隔的块，块以标记开头） ——

/** 某个块（`\n\n` 分隔，块以标记开头）；没有这一块 ⇒ undefined */
export function blockOf(prompt, marker) {
  return prompt.split('\n\n').find((block) => block.startsWith(marker))
}

/** 状态段里的非空行（没有状态段 ⇒ null） */
export function stateLines(prompt, marker = '<世界状态树>') {
  const block = blockOf(prompt, marker)
  if (block === undefined) return null
  return block
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

/** 可写段里的非空行（没有可写段 ⇒ null） */
export function writableLines(prompt, marker = '<可写状态>') {
  return stateLines(prompt, marker)
}

/** 一行的 `：` 后面那一格（JSON / 约束） */
export function payloadOf(line) {
  const at = line.indexOf('：')
  if (at <= 0) throw new Error(`行里缺少全角冒号：${line}`)
  return line.slice(at + 1)
}

/** 以 `- <code>「` 开头的那一行（找不到返回 undefined，调用方断言并报出实际行） */
export function lineOf(lines, code) {
  return lines.find((item) => item.startsWith(`- ${code}「`))
}
