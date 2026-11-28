/**
 * 数组字段权限判据的共用夹具：**只有纯数据与纯函数，没有一行产品代码**。
 *
 * 两份判据共用这三件事：
 *   · `cardWithRefs` —— 把 `check` 节点两面眼睛换成给定清单（另一侧清空，避免两条规则互相借力）；
 *   · `withArrayValue` —— 换掉 `2.4` 的初始值（只动根 `2` 那一张表）；
 *   · `twoOuterNestedCard` —— 两个外层 item、内层「附魔」分别 1 / 2 项，写形状的层数靠它咬。
 *
 * ⚠️ 与 `array-fixtures.js` 一样：判据与契约冲突时先怀疑这里；这里不 import 产品代码。
 */
import { nestedCard, nestedItems } from './array-fixtures.js'

/** 把 `check` 节点的两面眼睛换成给定清单（别的节点原样） */
export function cardWithRefs(card, { reads = [], writable = [] } = {}) {
  return {
    ...card,
    chain: card.chain.map((node) => (node.id === 'check' ? { ...node, reads, writable } : node)),
  }
}

/** 换掉 `2.4` 的初始值（只动根 `2` 那一张表） */
export function withArrayValue(card, value) {
  return {
    ...card,
    state: card.state.map((item) =>
      item.code === '2' ? { ...item, initial: { ...item.initial, 2.4: value } } : item,
    ),
  }
}

/** 嵌套卡的两个外层 item：内层「附魔」分别有 1 / 2 项 */
export function twoOuterNestedItems() {
  const [first] = nestedItems()
  const second = {
    '2.4.1': '斗篷',
    '2.4.2': {
      '2.4.2.1': '稀有',
      '2.4.2.2': [
        { '2.4.2.2.1': '微光', '2.4.2.2.2': 1 },
        { '2.4.2.2.1': '回响', '2.4.2.2.2': 9 },
      ],
    },
  }
  return [JSON.parse(JSON.stringify(first)), second]
}

/** 一张两外层 item 的嵌套卡（其余骨架照 `nestedCard`） */
export function twoOuterNestedCard() {
  return withArrayValue(nestedCard(), twoOuterNestedItems())
}
