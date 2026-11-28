/**
 * 「读写覆盖对称」这一票的共用夹具（`.team/test/2026-11-28/契约-读写覆盖对称.md`）。
 *
 * 形状是为**四类元素**各留一个位子，判据才能逐条翻面：
 *   · `1` / `2` 文字根**同时有自己的值和子元素**（读 / 写只该覆盖自己的值）；
 *   · `1.3` / `2.2` / `2.3.2` / `3.3` 数组（容器：覆盖所有 item 字段）；
 *   · `3` / `2.3` / `2.2.4` 对象（没有自身值：覆盖孩子）；
 *   · `2.2.3` / `2.4` 数组 item 字段 / 普通元素：标量 + 孩子（只覆盖自己的值）。
 *
 * ```text
 * 0 时间（time）
 * 1 world（text，自身值 + 孩子）            initial: 1.0 / 1.1.0 / 1.1.1 / 1.2 / 1.3
 *   1.1 region（enum，自身值 + 孩子）
 *     1.1.1 site（text）
 *   1.2 weather（text）
 *   1.3 goods（array）
 *     1.3.1 item（text）
 *     1.3.2 count（integer）
 * 2 player（text，自身值 + 孩子）           initial: 2.0 / 2.1 / 2.2 / 2.3 / 2.4.0 / 2.4.1
 *   2.1 hero（text）
 *   2.2 bag（array）
 *     2.2.1 item（text）
 *     2.2.2 count（integer）
 *     2.2.3 note（text，自身值 + 孩子）
 *       2.2.3.1 detail（text）
 *     2.2.4 tags（object）
 *       2.2.4.1 kind（text）
 *     2.2.5 entries（array）
 *       2.2.5.1 word（text）
 *   2.3 attr（object）
 *     2.3.1 quality（enum）
 *     2.3.2 enchants（array）
 *       2.3.2.1 name（text）
 *       2.3.2.2 power（integer）
 *   2.4 note（text，自身值 + 孩子）
 *     2.4.1 detail（text）
 * 3 config（object）
 *   3.1 lang（text）
 *   3.2 volume（integer）
 *   3.3 list（array）
 *     3.3.1 entry（text）
 * ```
 *
 * ⚠️ 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络；单测与 e2e 共用。
 */

/** 时间初值：2024-02-10（周六）08:30 */
export const TIME = { year: 2024, month: 2, day: 10, hour: 8, minute: 30 }

/** 一个状态元素；缺省 name 用 code */
export function element(code, type, over = {}) {
  return { code, name: code, note: '', type, ...over }
}

/** 时间根 */
export function timeElement() {
  return element('0', 'time', {
    name: 'time',
    timeMode: 'year-minute',
    initial: { ...TIME },
    holidays: { international: false, china: false, traditional: false },
  })
}

/** `2.2 bag` 的两项：标量 / 对象 / 数组字段都出场，值记号互不复用（断言找不到 = 真的没读） */
export function bagItems() {
  return [
    {
      '2.2.1': 'SWORD',
      '2.2.2': 1,
      '2.2.3': { '2.2.3.0': 'NOTE_N0', '2.2.3.1': 'DETAIL_D0' },
      '2.2.4': { '2.2.4.1': 'TAG_COMMON' },
      '2.2.5': [{ '2.2.5.1': 'WORD_FIRE' }],
    },
    {
      '2.2.1': 'SHIELD',
      '2.2.2': 2,
      '2.2.3': { '2.2.3.0': 'NOTE_N1', '2.2.3.1': 'DETAIL_D1' },
      '2.2.4': { '2.2.4.1': 'TAG_RARE' },
      '2.2.5': [{ '2.2.5.1': 'WORD_ICE' }],
    },
  ]
}

/** 根元素的初始值表（只有根元素带 initial） */
export function rootInitials() {
  return {
    1: {
      '1.0': 'WORLD_OWN',
      '1.1.0': 'REGION_OWN',
      '1.1.1': 'SITE_X',
      1.2: 'WEATHER_SUN',
      1.3: [{ '1.3.1': 'RING', '1.3.2': 2 }],
    },
    2: {
      '2.0': 'PLAYER_OWN',
      2.1: 'HERO',
      2.2: bagItems(),
      // object 没有自己的值：它的孩子就是扁平表里的孩子路径（不能嵌成 `2.3: {...}`）
      '2.3.1': 'QUALITY_RARE',
      '2.3.2': [{ '2.3.2.1': 'ENCHANT_FIRE', '2.3.2.2': 9 }],
      '2.4.0': 'NOTE_OWN',
      '2.4.1': 'NOTE_DETAIL',
    },
    3: {
      3.1: 'LANG_ZH',
      3.2: 5,
      3.3: [{ '3.3.1': 'LIST_X' }],
      // object 里放一个「标量 + 孩子」：container 读整段时，它的孩子也要在（回归）
      '3.4.0': 'CONFIG_NOTE',
      '3.4.1': 'CONFIG_DETAIL',
    },
  }
}

/** 一张覆盖夹具卡；`over` 可以换 id / state / chain */
export function coverageCard(over = {}) {
  const initial = rootInitials()
  const card = {
    schemaVersion: 1,
    id: 'c-coverage',
    name: 'coverage card',
    state: [
      timeElement(),
      element('1', 'text', { name: 'world', initial: initial[1] }),
      element('1.1', 'enum', { name: 'region', values: ['REGION_OWN', 'REGION_ALT'] }),
      element('1.1.1', 'text', { name: 'site' }),
      element('1.2', 'text', { name: 'weather' }),
      element('1.3', 'array', { name: 'goods' }),
      element('1.3.1', 'text', { name: 'item' }),
      element('1.3.2', 'integer', { name: 'count', min: 0, max: 999 }),
      element('2', 'text', { name: 'player', initial: initial[2] }),
      element('2.1', 'text', { name: 'hero' }),
      element('2.2', 'array', { name: 'bag' }),
      element('2.2.1', 'text', { name: 'item' }),
      element('2.2.2', 'integer', { name: 'count', min: 0, max: 999 }),
      element('2.2.3', 'text', { name: 'note' }),
      element('2.2.3.1', 'text', { name: 'detail' }),
      element('2.2.4', 'object', { name: 'tags' }),
      element('2.2.4.1', 'text', { name: 'kind' }),
      element('2.2.5', 'array', { name: 'entries' }),
      element('2.2.5.1', 'text', { name: 'word' }),
      element('2.3', 'object', { name: 'attr' }),
      element('2.3.1', 'enum', { name: 'quality', values: ['QUALITY_COMMON', 'QUALITY_RARE'] }),
      element('2.3.2', 'array', { name: 'enchants' }),
      element('2.3.2.1', 'text', { name: 'name' }),
      element('2.3.2.2', 'integer', { name: 'power', min: 0, max: 10 }),
      element('2.4', 'text', { name: 'note' }),
      element('2.4.1', 'text', { name: 'detail' }),
      element('3', 'object', { name: 'config', initial: initial[3] }),
      element('3.1', 'text', { name: 'lang' }),
      element('3.2', 'integer', { name: 'volume', min: 0, max: 100 }),
      element('3.3', 'array', { name: 'list' }),
      element('3.3.1', 'text', { name: 'entry' }),
      element('3.4', 'text', { name: 'note' }),
      element('3.4.1', 'text', { name: 'detail' }),
    ],
    prompts: [
      { id: 'opening', title: 'opening', body: '' },
      { id: 'pr1', title: 'tone', body: 'BODY_ONE' },
    ],
    chain: [
      {
        id: 'time',
        type: 'time',
        name: 'time',
        reads: [],
        writable: ['0'],
        readsUpstream: [],
        historyTurns: 0,
        prompt: '',
      },
      {
        id: 'check',
        type: 'normal',
        name: 'check',
        reads: [],
        writable: [],
        readsUpstream: [],
        historyTurns: 0,
        prompt: '',
      },
      {
        id: 'output',
        type: 'output',
        name: 'output',
        reads: [],
        writable: [],
        readsUpstream: ['check'],
        historyTurns: 0,
        prompt: '',
      },
    ],
  }
  return { ...card, ...over }
}

/** 从卡摊平成树（夹具侧自己的算法，不 import 产品代码） */
export function coverageTree(card = coverageCard()) {
  const tree = {}
  for (const root of card.state) {
    if (root.code.includes('.')) continue
    if (root.type === 'time') tree[root.code] = { ...root.initial }
    else Object.assign(tree, JSON.parse(JSON.stringify(root.initial ?? {})))
  }
  return tree
}

/** 一份合法存档（`cardSnapshot` 是卡的深拷贝） */
export function coverageSave(card = coverageCard(), over = {}) {
  return {
    schemaVersion: 1,
    id: 's-coverage',
    cardId: card.id,
    cardSnapshot: JSON.parse(JSON.stringify(card)),
    name: 'coverage save',
    turn: 0,
    tree: coverageTree(card),
    events: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** 把 `check` 节点的两面眼睛换成给定清单（其余节点原样） */
export function cardWithRefs(card = coverageCard(), { reads = [], writable = [] } = {}) {
  return {
    ...card,
    chain: card.chain.map((node) => (node.id === 'check' ? { ...node, reads, writable } : node)),
  }
}

/** 按 code 找元素（找不到返回 undefined —— 判据自己断言它存在） */
export function elementOf(card, code) {
  return card.state.find((item) => item.code === code)
}
