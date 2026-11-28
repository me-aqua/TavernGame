/**
 * 阶段 4 · 引用（ref）的 e2e 夹具：**只有卡 / 存档数据，没有一行产品代码**。
 *
 * 形状照 `.team/leader/2026-11-28/阶段4-引用-契约草案.md`（下称「引用契约」）：
 *   · 数组 item 带隐藏 `id`（`id_1`…，数组内唯一，不进界面）；
 *   · `ref` 元素只存 `refSource` / `refFields` / `refFilter?` / `min` / `max`，值存 item 的 id；
 *   · 零条 = `null`（不是 `[]`）；`max = 1` 是单值，`max > 1` 是有序 id 列表；
 *   · `ref` 可以有子元素：有孩子时自身值住 `<code>.0`，孩子住 `<code>.<编号>`。
 *
 * 两张卡，各管一段：
 *   · `defCard()`  —— **定义层**用。今天就是合法卡（没有 ref 元素、数组都是空的 ⇒ 不需要隐藏 id），
 *                    所以红基线能精确落在「类型下拉里没有 ref」这一步，而不是「卡一打开就坏」；
 *   · `refCard()`  —— **值编辑器**用。阶段 4 之后合法（ref 元素 + 带 id 的 item）；
 *                    今天会因 `ref` 是未知类型而整张卡被校验拦下 —— 那也是红的，只是红在更早一步。
 *
 * ⚠️ 这是同一份形状的一份可执行副本，不是第二份真源：判据与契约冲突时先怀疑它。
 * ⚠️ 这里只有纯数据与纯函数：不 import 产品代码、不碰 DOM、不发网络。
 */
import { element, holdSave, holidays, timeElement, TIME } from '../../tests/support/array-fixtures.js'

export { TIME, element, holdSave, holidays, timeElement }

/** 背包三项的隐藏 id（数组内唯一；`1.4` 里另有一组同号 id，靠源数组区分） */
export const ID = { sword: 'id_1', cloak: 'id_2', coin: 'id_3', bow: 'id_9' }

/** 背包三项（`2.4`）：可手持 = 是 的只有短剑 / 斗篷 */
export function bagItems() {
  return [
    { id: ID.sword, '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
    { id: ID.cloak, '2.4.1': '斗篷', '2.4.2': 1, '2.4.3': '是' },
    { id: ID.coin, '2.4.1': '银币', '2.4.2': 3, '2.4.3': '否' },
  ]
}

/** 增益定义两项（根 `1` 的 `1.2`）：与 `2.4` 的 id 号相同，值完全不同 */
export function gainDefs() {
  return [
    { id: 'id_1', '1.2.1': '微醺', '1.2.2': '脚步有点飘' },
    { id: 'id_2', '1.2.1': '潮湿', '1.2.2': '衣服贴在身上' },
  ]
}

/**
 * 定义层用的卡（今天合法）：
 *
 * ```text
 * 0 时间（time）
 * 1 世界（object）      1.1 区域（text）
 * 2 玩家（object）
 *   2.1 名字（text）  2.2 体力（integer）  2.3 状态（enum）
 *   2.4 背包（array，空）
 *     2.4.1 物品（text） 2.4.2 数量（integer） 2.4.3 可手持（enum 是/否）
 *     2.4.4 属性（object）  2.4.4.1 品质（enum）
 *     2.4.5 附魔（array）   2.4.5.1 词条（text）
 *   2.5 主手（text，准备改成 ref）
 *   2.6 增益定义（array，空） 2.6.1 名称（text）
 *   2.7 队伍（array，空）     2.7.1 成员（text）
 *   2.8 队伍槽（array，空）   2.8.1 成员（text）   ← 用来验「源不能是自己所在的数组」
 * ```
 */
export function defCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-ref-def',
    name: 'ref definition card',
    state: [
      timeElement(),
      element('1', 'object', { name: '世界', initial: { 1.1: '晨风镇' } }),
      element('1.1', 'text', { name: '区域' }),
      element('2', 'object', {
        name: '玩家',
        initial: {
          2.1: '旅人',
          2.2: 80,
          2.3: '正常',
          2.4: [],
          2.5: '',
          2.6: [],
          2.7: [],
          2.8: [],
        },
      }),
      element('2.1', 'text', { name: '名字' }),
      element('2.2', 'integer', { name: '体力', min: 0, max: 100, stepMin: 1, stepMax: 10 }),
      element('2.3', 'enum', { name: '状态', values: ['正常', '受伤'] }),
      element('2.4', 'array', { name: '背包', note: '身上的东西' }),
      element('2.4.1', 'text', { name: '物品' }),
      element('2.4.2', 'integer', { name: '数量', min: 0, max: 999 }),
      element('2.4.3', 'enum', { name: '可手持', values: ['是', '否'] }),
      element('2.4.4', 'object', { name: '属性' }),
      element('2.4.4.1', 'enum', { name: '品质', values: ['普通', '稀有'] }),
      element('2.4.5', 'array', { name: '附魔' }),
      element('2.4.5.1', 'text', { name: '词条' }),
      element('2.5', 'text', { name: '主手' }),
      element('2.6', 'array', { name: '增益定义' }),
      element('2.6.1', 'text', { name: '名称' }),
      element('2.7', 'array', { name: '队伍' }),
      element('2.7.1', 'text', { name: '成员' }),
      element('2.8', 'array', { name: '队伍槽' }),
      element('2.8.1', 'text', { name: '成员' }),
    ],
    chain: [
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
    ],
    prompts: [
      { id: 'opening', title: '开场', body: '' },
      { id: 'pr1', title: '世界观', body: 'BODY_ONE' },
    ],
    ...over,
  }
}

/**
 * 值编辑器用的卡（阶段 4 之后合法）。六个 ref 各管一件事：
 *
 * ```text
 * 2.5 主手（→2.4，筛选 2.4.3=是，投影 2.4.1，0..1）      单值 / 筛选选择器 / 筛选失效
 * 2.6 队伍（→2.4，无筛选，投影 2.4.1，0..3）             多值行构建器 / 上限 / 删空
 * 2.7 任务链（→2.4，无筛选，投影 2.4.1，2..4）           低于 min / 删除被拦
 * 2.8 副手（→2.4，筛选 2.4.3=是，投影 2.4.1，0..1）      空值 + min 改 1 / 筛选后无候选
 * 2.9 主手关系（→2.4，筛选 2.4.3=是，投影 2.4.1，0..1）  带子元素（2.9.1 握法 / 2.9.2 临时附魔）
 * 2.10 混合容器（array，空）                           2.10.1/2/3 直接标量、2.10.4 对象、2.10.5 数组、2.10.6 ref
 * 2.11 试选（→2.10，投影 2.10.1，0..1）                  「只列直接标量字段」的对照
 * ```
 */
export function refCard(over = {}) {
  return {
    schemaVersion: 1,
    id: 'c-ref',
    name: 'ref card',
    state: [
      timeElement(),
      element('1', 'object', { name: '世界', initial: { 1.1: '晨风镇', 1.2: gainDefs() } }),
      element('1.1', 'text', { name: '区域' }),
      element('1.2', 'array', { name: '增益定义' }),
      element('1.2.1', 'text', { name: '名称' }),
      element('1.2.2', 'text', { name: '描述' }),
      element('2', 'object', {
        name: '玩家',
        initial: {
          2.1: '旅人',
          2.2: 80,
          2.3: '正常',
          2.4: bagItems(),
          2.5: ID.sword,
          2.6: [ID.cloak],
          2.7: [ID.cloak, ID.coin],
          2.8: null,
          // 带子元素的 ref：初始值表是**扁平**的（`2.9.0` 自身值 + `2.9.1` / `2.9.2` 子元素），
          // 与 `v2/tests/support/ref-fixtures.js` 的 refChildCard 同一形状（契约 §4.3）
          '2.9.0': null,
          '2.9.1': '',
          '2.9.2': '',
          '2.10': [],
          2.11: null,
        },
      }),
      element('2.1', 'text', { name: '名字' }),
      element('2.2', 'integer', { name: '体力', min: 0, max: 100, stepMin: 1, stepMax: 10 }),
      element('2.3', 'enum', { name: '状态', values: ['正常', '受伤'] }),
      element('2.4', 'array', { name: '背包', note: '身上的东西' }),
      element('2.4.1', 'text', { name: '物品' }),
      element('2.4.2', 'integer', { name: '数量', min: 0, max: 999 }),
      element('2.4.3', 'enum', { name: '可手持', values: ['是', '否'] }),
      element('2.5', 'ref', {
        name: '主手',
        refSource: '2.4',
        refFilter: { field: '2.4.3', value: '是' },
        refFields: ['2.4.1'],
        min: 0,
        max: 1,
      }),
      element('2.6', 'ref', { name: '队伍', refSource: '2.4', refFields: ['2.4.1'], min: 0, max: 3 }),
      element('2.7', 'ref', { name: '任务链', refSource: '2.4', refFields: ['2.4.1'], min: 2, max: 4 }),
      element('2.8', 'ref', {
        name: '副手',
        refSource: '2.4',
        refFilter: { field: '2.4.3', value: '是' },
        refFields: ['2.4.1'],
        min: 0,
        max: 1,
      }),
      element('2.9', 'ref', {
        name: '主手关系',
        refSource: '2.4',
        refFilter: { field: '2.4.3', value: '是' },
        refFields: ['2.4.1'],
        min: 0,
        max: 1,
      }),
      element('2.9.1', 'text', { name: '握法' }),
      element('2.9.2', 'text', { name: '临时附魔' }),
      element('2.10', 'array', { name: '混合容器' }),
      element('2.10.1', 'text', { name: '名称' }),
      element('2.10.2', 'integer', { name: '数字', min: 0, max: 99 }),
      element('2.10.3', 'enum', { name: '下拉', values: ['甲', '乙'] }),
      element('2.10.4', 'object', { name: '属性' }),
      element('2.10.4.1', 'enum', { name: '品质', values: ['普通', '稀有'] }),
      element('2.10.5', 'array', { name: '附魔' }),
      element('2.10.5.1', 'text', { name: '词条' }),
      element('2.10.6', 'ref', { name: '来源', refSource: '1.2', refFields: ['1.2.1'], min: 0, max: 1 }),
      element('2.11', 'ref', { name: '试选', refSource: '2.10', refFields: ['2.10.1'], min: 0, max: 1 }),
    ],
    chain: [
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
        reads: ['2.1', '2.4', '2.5', '2.6'],
        writable: ['2.1', '2.4'],
        readsUpstream: [],
        historyTurns: 0,
        prompt: '',
      },
      {
        id: 'output',
        type: 'output',
        name: '输出',
        reads: ['2.4', '2.5'],
        writable: [],
        readsUpstream: ['check'],
        historyTurns: 3,
        prompt: '',
      },
    ],
    prompts: [
      { id: 'opening', title: '开场', body: '' },
      { id: 'pr1', title: '世界观', body: 'BODY_ONE' },
    ],
    ...over,
  }
}

/**
 * 存档里的**当前**背包：与卡快照初值故意不同 ——
 * 没有「斗篷」，多了一把「长弓」（`id_9`）；`id_1` 仍是短剑、`id_3` 仍是银币。
 * 当前值选择器若读错了来源（读卡初值），会列出斗篷、列不出长弓 —— 判据就是靠这两条翻面。
 */
export function currentBagItems() {
  return [
    { id: ID.sword, '2.4.1': '短剑', '2.4.2': 1, '2.4.3': '是' },
    { id: ID.bow, '2.4.1': '长弓', '2.4.2': 1, '2.4.3': '是' },
    { id: ID.coin, '2.4.1': '银币', '2.4.2': 3, '2.4.3': '否' },
  ]
}

/** 一份合法存档：当前树的 `2.4` 换成 `currentBagItems()`，`2.6` 是零条（null） */
export function refSave(card = refCard(), over = {}) {
  const save = holdSave(card, { id: 's-ref', name: 'ref save' })
  return {
    ...save,
    tree: {
      ...save.tree,
      2.4: currentBagItems(),
      2.5: ID.sword,
      2.6: null,
      2.7: [ID.sword, ID.coin],
    },
    ...over,
  }
}
