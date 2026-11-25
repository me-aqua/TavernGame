/**
 * 建卡 / 建存档时用的纯函数（CONTRACT §2.1 的默认值就在这儿）。
 *
 * 单独一份的原因：**首页建卡**与**首页建存档**都要它，而这两件事必须给出同一张卡、同一棵树的形状 ——
 * 抄两份迟早会分叉（一份改了初值默认，另一份没改）。
 */
import type { Card, PromptBlock, StateElement, Tree } from './core/types'
import { OPENING_PROMPT_ID } from './core/schema'
import { t } from './i18n'

// 造一块「开场」：标题是数据，所以「建卡」这一处写进卡一次
function openingBlock(): PromptBlock {
  return { id: OPENING_PROMPT_ID, title: t('card.openingTitle'), body: '' }
}

/** 新建卡的默认三节点：id 与 name 都固定（CONTRACT §2.1 的表） */
const DEFAULT_CHAIN: Card['chain'] = [
  {
    id: 'time',
    type: 'time',
    name: t('default.node.time'),
    reads: [],
    writable: ['0'],
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
  },
  {
    id: 'check',
    type: 'normal',
    name: t('default.node.check'),
    reads: [],
    writable: [],
    readsUpstream: [],
    historyTurns: 0,
    prompt: '',
  },
  {
    id: 'output',
    type: 'output',
    name: t('default.node.output'),
    reads: [],
    writable: [],
    readsUpstream: ['check'],
    historyTurns: 3,
    prompt: '',
  },
]

// 新建一张卡：只有一个时间元素、一块「开场」提示词、契约 §2.1 那三个固定节点
export function freshCard(id: string, name: string): Card {
  return {
    schemaVersion: 1,
    id,
    name,
    state: [
      { code: '0', name: t('default.state.time'), note: '', type: 'string', initial: { day: 1, hour: 8 } },
    ],
    chain: DEFAULT_CHAIN.map((node) => ({
      ...node,
      reads: [...node.reads],
      writable: [...node.writable],
      readsUpstream: [...node.readsUpstream],
    })),
    prompts: [openingBlock()],
  }
}

/** 新建存档的状态树：逐个从卡的初值拷出来（时间那一格是对象，必须深拷贝） */
export function treeOf(card: Card): Tree {
  const tree: Tree = {}
  for (const element of card.state) {
    tree[element.code] =
      typeof element.initial === 'string'
        ? element.initial
        : { day: element.initial.day, hour: element.initial.hour }
  }
  return tree
}

/**
 * 深拷贝一张卡（新建存档时的 `cardSnapshot`）。
 *
 * 不用 `structuredClone`：卡是从 `ref()` 里拿出来的**响应式代理**，`structuredClone` 克隆不了 Proxy
 * （实测 DataCloneError，界面上表现为一句 E_UNKNOWN）。卡本身是纯 JSON 数据，走一遍 JSON 就是准的深拷贝。
 */
export function cloneCard(card: Card): Card {
  return JSON.parse(JSON.stringify(card)) as Card
}

/** 下一个可用的状态编码：从 1 往上找第一个空位（`0` 是时间，永远占着） */
export function nextStateCode(state: StateElement[]): string {
  const used = new Set(state.map((element) => element.code))
  for (let code = 1; ; code += 1) {
    if (!used.has(String(code))) return String(code)
  }
}

/** 下一个可用的提示词 id */
export function nextPromptId(prompts: PromptBlock[]): string {
  const used = new Set(prompts.map((prompt) => prompt.id))
  for (let index = 1; ; index += 1) {
    const id = `pr${index}`
    if (!used.has(id)) return id
  }
}
