/**
 * 卡 / 存档的结构校验（CONTRACT §6.1），外加数据类型与工具的派生规则（§4.3）。
 *
 * 两种错分得很清：**结构坏了**是 `E_VALIDATION`（缺字段、悬空引用、状态树形状），
 * **链的规矩坏了**是 `E_CHAIN`（输出个数、时间上限、id 重复、上游只能往前读）。
 * 分这么细是因为下一步不一样：前者回首页重开，后者回编辑器改链。
 *
 * 状态树那半的规则**不在这里重写**：它们住在 `core/statetree.ts` 的 `cardIssues`（保存按钮与这里共用
 * 同一份清单），这一份只做形状层的收窄（数组 / 字符串 / 记录），然后抛第一条问题。
 *
 * 对多出来的字段**宽容**：卡里带 `presetId` 之类不报错 —— 模型绑定住在 `tg2.nodeModels`（§2.5），
 * 这里不认它，也不拦它。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import { cardIssues, elementOfPath, isTimeValue, pathsOf, valueFits } from './statetree'
import type { Card, ChainNode, Save, StateElement } from './types'

// 值路径 ↔ 元素的那一格住在 `statetree.ts`（卡校验、存档校验、界面三处共用）；老的调用方从这里取
export { elementOfPath }

const NODE_TYPES = ['time', 'normal', 'output'] as const

/** 每张卡都带的那块「开场」提示词：对话页把它的正文当故事的第一段（§8.3） */
export const OPENING_PROMPT_ID = 'opening'

/** 节点「调用重试次数」的上限：`retryCount ∈ [0, 5]` 的整数，缺省 0（§2.1） */
export const MAX_RETRY_COUNT = 5

/**
 * 一个节点拿到哪些工具 —— **由 `writable` 里每个引用覆盖到的值路径派生**（CONTRACT §4.3）。
 * 引用可以是元素 code（覆盖自身值 + 整棵子树），也可以是 `<code>.0`（只覆盖那个自身值）。
 *
 *   覆盖到时间元素的自身值 ⇒ `advance_time`（推进时间）；覆盖到任何非时间、非结构体的值 ⇒
 *   `write_state`（文字 / 数字 / 下拉）；两样都覆盖 ⇒ 两个工具；一样都没有 ⇒ 没有工具。
 *   **输出节点一个工具都没有**（它只产故事；`validateChain` 要求它的 `writable` 是空的）。
 *
 * 这是工具权限的唯一真源：引擎执行工具（`runTool`）与 provider 拿到的工具表都从它来。
 * 看**值路径**而不是看 `code === '0'`：v5 里哪些 code 是时间由元素类型决定。
 */
export function toolsForNode(card: Card, node: ChainNode): string[] {
  if (node.type === 'output') return []
  const tools: string[] = []
  const covered = node.writable.flatMap((ref) => pathsOf(card.state, ref))
  const [timePath] = pathsOf(card.state, '0')
  if (timePath !== undefined && covered.includes(timePath)) tools.push('advance_time')
  if (covered.some((path) => writableValueAt(card, path))) tools.push('write_state')
  return tools
}

/** 一条值路径是不是 `write_state` 能写的（有自身值、且不是时间） */
function writableValueAt(card: Card, path: string): boolean {
  const element = elementOfPath(card.state, path)
  return element !== undefined && element.type !== 'time' && element.type !== 'object'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function badField(field: string): AppError {
  return new AppError('E_VALIDATION', { message: t('error.field', { field }), detail: { field } })
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw badField(field)
  return value
}

function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw badField(field)
  return value
}

/**
 * 状态元素的**形状**（只判数组 / 字符串这类外壳）。编号、深度、类型字段、初始值这些规矩住在
 * `cardIssues` —— 保存按钮与这里共用同一份，别在这儿重写一遍。
 */
function validateState(card: Card): void {
  const state = requireArray(card.state, 'card.state')
  state.forEach((raw, index) => {
    if (!isRecord(raw)) throw badField(`card.state[${index}]`)
    requireString(raw.code, `card.state[${index}].code`)
    requireString(raw.name, `card.state[${index}].name`)
    requireString(raw.note, `card.state[${index}].note`)
    requireString(raw.type, `card.state[${index}].type`)
  })
}

function validatePrompts(card: Card): void {
  const prompts = requireArray(card.prompts, 'card.prompts')
  prompts.forEach((raw, index) => {
    if (!isRecord(raw)) throw badField(`card.prompts[${index}]`)
    requireString(raw.id, `card.prompts[${index}].id`)
    requireString(raw.title, `card.prompts[${index}].title`)
    requireString(raw.body, `card.prompts[${index}].body`)
  })
  if (new Set(prompts.map((prompt) => (prompt as Record<string, unknown>).id)).size !== prompts.length) {
    throw new AppError('E_VALIDATION', { message: t('error.field', { field: 'card.prompts.id' }) })
  }
  if (!prompts.some((prompt) => (prompt as Record<string, unknown>).id === OPENING_PROMPT_ID)) {
    throw new AppError('E_VALIDATION', {
      message: t('error.openingMissing'),
      nextStep: t('next.editor'),
      detail: { field: `card.prompts.${OPENING_PROMPT_ID}` },
    })
  }
}

function validateNode(raw: unknown, index: number): ChainNode {
  if (!isRecord(raw)) throw badField(`card.chain[${index}]`)
  const node = raw as unknown as ChainNode
  requireString(node.id, `card.chain[${index}].id`)
  requireString(node.name, `card.chain[${index}].name`)
  if (!NODE_TYPES.includes(node.type)) throw badField(`card.chain[${index}].type`)
  requireArray(node.reads, `card.chain[${index}].reads`).forEach((ref) =>
    requireString(ref, `card.chain[${index}].reads`),
  )
  requireArray(node.writable, `card.chain[${index}].writable`).forEach((code) =>
    requireString(code, `card.chain[${index}].writable`),
  )
  requireArray(node.readsUpstream, `card.chain[${index}].readsUpstream`).forEach((id) =>
    requireString(id, `card.chain[${index}].readsUpstream`),
  )
  if (!Number.isInteger(node.historyTurns) || node.historyTurns < 0) {
    throw new AppError('E_CHAIN', {
      message: t('error.historyTurns', { node: node.id }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, historyTurns: node.historyTurns },
    })
  }
  // 缺省 0：旧卡没有这一格也合法（不迁移、不回写）
  if (
    node.retryCount !== undefined &&
    (!Number.isInteger(node.retryCount) || node.retryCount < 0 || node.retryCount > MAX_RETRY_COUNT)
  ) {
    throw new AppError('E_CHAIN', {
      message: t('error.retryCount', { node: node.id }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, retryCount: node.retryCount },
    })
  }
  requireString(node.prompt, `card.chain[${index}].prompt`)
  return node
}

/**
 * 只收节点的字段形状（数组 / 字符串 / 历史轮数 / 重试次数）。链的**规矩**（恰好一个输出、最多一个时间、
 * id 唯一、上游只能往前读、引用必须存在、输出节点不许写）住在 `cardIssues` ——
 * 与保存按钮共用那一份清单，这里不重写。
 *
 * 写权限只由 `writable` 决定，不按节点类型收窄：时间节点与普通节点都可以写时间元素 `'0'`，
 * 也都可以写普通元素 —— 拿到哪个工具由 code 覆盖到的值路径派生（`toolsForNode`）。
 */
function validateChain(card: Card): void {
  const chain = requireArray(card.chain, 'card.chain') as unknown[]
  chain.forEach((raw, index) => validateNode(raw, index))
}

/**
 * 卡的结构 + 链的规矩；不合法就抛 `AppError`（第一条问题的错误码）。
 *
 * `initial: false` ⇒ 不判初始值（校验清单原样交给 `cardIssues`）：存档编辑器保存时用的是这一支，
 * 它要判的是「新的快照容不容得下这一份存档的当前树」，不是「卡的种子值合不合法」。
 */
export function validateCard(card: Card, options: { initial?: boolean } = {}): void {
  if (!isRecord(card)) throw new AppError('E_VALIDATION', { message: t('error.field', { field: 'card' }) })
  if (card.schemaVersion !== 1) {
    throw new AppError('E_VALIDATION', {
      message: t('error.schemaVersion', { key: 'tg2.cards' }),
      nextStep: t('next.home'),
      detail: { schemaVersion: card.schemaVersion },
    })
  }
  requireString(card.id, 'card.id')
  requireString(card.name, 'card.name')
  validateState(card)
  validatePrompts(card)
  validateChain(card)
  const [first] = cardIssues(card, options)
  if (first) {
    throw new AppError(first.errorCode, {
      message: first.message,
      nextStep: t('next.editor'),
      detail: { code: first.code, path: first.path },
    })
  }
}

/**
 * 存档校验。给了 `card` 就一并核对「游戏卡 id 对得上」「状态树**覆盖全部值路径**且没有多余键」——
 * 这是引擎入场那一步用的形态；存储层读盘时没有卡可比，只校验它自己那一半（时间必须是六格）。
 */
export function validateSave(save: Save, card?: Card): void {
  if (!isRecord(save)) throw new AppError('E_VALIDATION', { message: t('error.field', { field: 'save' }) })
  if (save.schemaVersion !== 1) {
    throw new AppError('E_VALIDATION', {
      message: t('error.schemaVersion', { key: 'tg2.saves' }),
      nextStep: t('next.home'),
      detail: { schemaVersion: save.schemaVersion },
    })
  }
  if (typeof save.id !== 'string' || save.id === '') throw badField('save.id')
  if (typeof save.cardId !== 'string' || save.cardId === '') throw badField('save.cardId')
  if (!Number.isInteger(save.turn) || save.turn < 0) {
    throw new AppError('E_VALIDATION', {
      message: t('error.turn'),
      nextStep: t('next.home'),
      detail: { turn: save.turn },
    })
  }
  if (!Array.isArray(save.events)) {
    throw new AppError('E_VALIDATION', { message: t('error.events'), nextStep: t('next.home') })
  }
  if (!isRecord(save.tree)) throw badField('save.tree')
  // 值的形状分两半：时间只住在 `0`（给了卡按卡的模式判，没给卡三种形状都收）；
  // 其它值要么是标量，要么是数组 / item 对象 —— 后者有卡时由下面的类型段按字段形状严格判，
  // 没卡时按 JSON 形状收下（与「没给卡时时间三种形状都收」同一条口径）。
  const timeMode = card?.state[0]?.type === 'time' ? card.state[0].timeMode : undefined
  for (const [path, value] of Object.entries(save.tree)) {
    if (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) continue
    if (path === '0') {
      if (isTimeValue(value, timeMode)) continue
      throw new AppError('E_VALIDATION', {
        message: t('error.timeTree'),
        nextStep: t('next.home'),
        detail: { path, value },
      })
    }
    if (Array.isArray(value) || isRecord(value)) continue
    throw new AppError('E_VALIDATION', {
      message: t('error.timeTree'),
      nextStep: t('next.home'),
      detail: { path, value },
    })
  }
  if (!card) return
  if (save.cardId !== card.id) {
    throw new AppError('E_VALIDATION', {
      message: t('error.cardIdMismatch'),
      nextStep: t('next.home'),
      detail: { cardId: save.cardId, card: card.id },
    })
  }
  // 值路径 = 每个 code 覆盖到的路径；有孩子的节点自身值是 `<code>.0`，`object` 的自身 code 不是值路径
  const paths = new Set(card.state.flatMap((element) => pathsOf(card.state, element.code)))
  for (const path of paths) {
    if (!(path in save.tree)) {
      throw new AppError('E_VALIDATION', {
        message: t('error.treeMissing', { code: path }),
        nextStep: t('next.home'),
        detail: { code: path },
      })
    }
  }
  for (const path of Object.keys(save.tree)) {
    if (!paths.has(path)) {
      throw new AppError('E_VALIDATION', {
        message: t('error.treeExtra', { path }),
        nextStep: t('next.home'),
        detail: { path },
      })
    }
  }
  for (const element of card.state) {
    if (element.type === 'object') continue
    // 数组的字段定义不是值路径（`pathsOf` 给空）⇒ 只由拥有它的数组值那一格判
    const path = ownPathIn(card, element)
    if (path === undefined) continue
    if (!valueFits(card.state, element, save.tree[path])) {
      throw new AppError('E_VALIDATION', {
        message: t('error.treeValue', { path }),
        nextStep: t('next.home'),
        detail: { code: element.code },
      })
    }
  }
}

/** 元素在树里的自身值路径（`pathsOf` 的首项就是它；结构体与数组字段没有这一格，调用方先跳过） */
function ownPathIn(card: Card, element: StateElement): string | undefined {
  return pathsOf(card.state, element.code)[0]
}
