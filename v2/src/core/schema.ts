/**
 * 卡 / 存档的结构校验（CONTRACT §6.1）。
 *
 * 两种错分得很清：**结构坏了**是 `E_VALIDATION`（缺字段、悬空引用、schemaVersion 不认），
 * **链的规矩坏了**是 `E_CHAIN`（输出个数、校对/时间上限、首节点读上游、id 重复、历史轮数）。
 * 分这么细是因为下一步不一样：前者回首页重开，后者回编辑器改链。
 *
 * 对多出来的字段**宽容**：旧卡里残留 `presetId` 之类不报错 —— 模型绑定早就搬去
 * `tg2.nodeModels` 了（§2.5），这里只是不认它，也不拦它。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import type { Card, ChainNode, Save, TimeValue } from './types'

const NODE_TYPES = ['time', 'normal', 'output', 'proof'] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** `{ day, hour }` 形状（时间元素的值） */
export function isTimeValue(value: unknown): value is TimeValue {
  return isRecord(value) && typeof value.day === 'number' && typeof value.hour === 'number'
}

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

function validateState(card: Card): void {
  const state = requireArray(card.state, 'card.state')
  if (state.length === 0)
    throw new AppError('E_VALIDATION', { message: t('error.field', { field: 'card.state' }) })
  state.forEach((raw, index) => {
    if (!isRecord(raw)) throw badField(`card.state[${index}]`)
    const code = requireString(raw.code, `card.state[${index}].code`)
    requireString(raw.name, `card.state[${index}].name`)
    requireString(raw.note, `card.state[${index}].note`)
    if (raw.type !== 'string') throw badField(`card.state[${index}].type`)
    if (code === '0') {
      if (!isTimeValue(raw.initial)) throw badField(`card.state[${index}].initial`)
    } else {
      requireString(raw.initial, `card.state[${index}].initial`)
    }
  })
  const time = state[0] as Record<string, unknown>
  if (time.code !== '0')
    throw new AppError('E_VALIDATION', { message: t('error.field', { field: 'card.state[0].code' }) })
  if (new Set(state.map((element) => (element as Record<string, unknown>).code)).size !== state.length) {
    throw new AppError('E_VALIDATION', { message: t('error.field', { field: 'card.state.code' }) })
  }
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
  if (typeof node.readsUpstream !== 'boolean') throw badField(`card.chain[${index}].readsUpstream`)
  if (!Number.isInteger(node.historyTurns) || node.historyTurns < 0) {
    throw new AppError('E_CHAIN', {
      message: t('error.historyTurns', { node: node.id }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, historyTurns: node.historyTurns },
    })
  }
  requireString(node.prompt, `card.chain[${index}].prompt`)
  return node
}

/**
 * 链的规矩（SPEC §2）：恰好一个输出、最多一个校对、最多一个时间、至少一个节点、
 * 首节点不读上游、id 不重复。
 */
function validateChain(card: Card): void {
  const chain = requireArray(card.chain, 'card.chain') as unknown[]
  if (chain.length === 0) {
    throw new AppError('E_CHAIN', { message: t('error.chainEmpty'), nextStep: t('next.editor') })
  }
  const nodes = chain.map((raw, index) => validateNode(raw, index))

  const countOf = (type: string) => nodes.filter((node) => node.type === type).length
  const outputs = countOf('output')
  if (outputs !== 1) {
    throw new AppError('E_CHAIN', {
      message: t('error.chainOutput', { count: outputs }),
      nextStep: t('next.editor'),
      detail: { outputs },
    })
  }
  if (countOf('proof') > 1) {
    throw new AppError('E_CHAIN', { message: t('error.chainProof'), nextStep: t('next.editor') })
  }
  if (countOf('time') > 1) {
    throw new AppError('E_CHAIN', { message: t('error.chainTime'), nextStep: t('next.editor') })
  }
  if (nodes[0].readsUpstream) {
    throw new AppError('E_CHAIN', {
      message: t('error.chainFirstUpstream', { node: nodes[0].id }),
      nextStep: t('next.editor'),
      detail: { nodeId: nodes[0].id },
    })
  }
  const ids = nodes.map((node) => node.id)
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index)
  if (duplicate !== undefined) {
    throw new AppError('E_CHAIN', {
      message: t('error.chainDuplicate', { node: duplicate }),
      nextStep: t('next.editor'),
      detail: { nodeId: duplicate },
    })
  }

  // 引用必须存在：reads 指向提示词 id 或状态 code，writable 只指向状态 code
  const promptIds = new Set((card.prompts as { id: string }[]).map((prompt) => prompt.id))
  const codes = new Set((card.state as { code: string }[]).map((element) => element.code))
  for (const node of nodes) {
    for (const ref of node.reads) {
      if (!promptIds.has(ref) && !codes.has(ref)) {
        throw new AppError('E_VALIDATION', {
          message: t('error.readsMissing', { node: node.id, ref }),
          nextStep: t('next.editor'),
          detail: { nodeId: node.id, ref },
        })
      }
    }
    for (const code of node.writable) {
      if (!codes.has(code)) {
        throw new AppError('E_VALIDATION', {
          message: t('error.writesMissing', { node: node.id, ref: code }),
          nextStep: t('next.editor'),
          detail: { nodeId: node.id, code },
        })
      }
    }
  }
}

/** 卡的结构 + 链的规矩；不合法就抛 `AppError` */
export function validateCard(card: Card): void {
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
}

/**
 * 存档校验。给了 `card` 就一并核对「状态树覆盖卡的每个 code」「卡带 id 对得上」——
 * 这是引擎入场那一步用的形态；存储层读盘时没有卡可比，只校验它自己那一半。
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
  if ('0' in save.tree && !isTimeValue(save.tree['0'])) {
    throw new AppError('E_VALIDATION', { message: t('error.timeTree'), nextStep: t('next.home') })
  }
  if (!card) return
  if (save.cardId !== card.id) {
    throw new AppError('E_VALIDATION', {
      message: t('error.cardIdMismatch'),
      nextStep: t('next.home'),
      detail: { cardId: save.cardId, card: card.id },
    })
  }
  for (const element of card.state) {
    if (!(element.code in save.tree)) {
      throw new AppError('E_VALIDATION', {
        message: t('error.treeMissing', { code: element.code }),
        nextStep: t('next.home'),
        detail: { code: element.code },
      })
    }
  }
}
