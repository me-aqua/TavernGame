/**
 * 引擎（CONTRACT §4）：跑一回合。
 *
 * 一回合 = 一条 `action` 事件 + 按 `chain` 顺序逐节点调用模型 + 收尾。
 * 每个节点按 `retryCount` 最多试 `1 + retryCount` 次：一次尝试里的工具调用要么全生效、要么全丢弃，
 * 失败就带着上一轮的错误块重试，耗尽则抛最后一次的错误（不返回存档）。
 * 三个纯函数（`resolveNodePreset` / `applyWrite` / `advanceTime`）单独拆出来，
 * 因为它们各自有一条不许出错的规矩，而规矩要能单测。
 *
 * 四条不许破的：
 *   · **不修改入参**：`save` / `card` / `presets` / `nodePresets` 只读，返回新的 save；
 *   · **只有 output 节点的文本进故事流**（narration），其余节点只进 `trace` 事件；
 *   · **模型从本地映射解析**（`tg2.nodeModels` 那一片），卡里没有、也不许有模型绑定；
 *   · **中止 = 什么都不写**：`E_ABORTED` 抛出时调用方拿回的还是原存档。
 *
 * 调试读数**落盘**：每跑完一个节点追加一条 `trace`（提示词 / 思考 / 每次尝试的工具调用与错误 / 返回 /
 * 用量 / 耗时 / 预设），回合末尾追加一条 `turnStats`（总耗时 / 总用量 / 吞吐）。
 * 两者既进 `save.events`，也经 `onEvent` 实时发出去 —— 对话页重开旧存档时不用再跑模型
 * 就能看见当时每一步（老板 2026-11-25 的口径：调试内联进故事流）。
 */
import { t } from '../i18n'
import { PROVIDER_TIMEOUT_MS, startDeadline } from './deadline'
import { AppError } from './errors'
import { mockReply } from './mock'
import { arrayFieldRulesOf, buildPrompt, fieldWriteRuleOf } from './prompt'
import { elementOfPath, toolsForNode, validateCard, validateSave } from './schema'
import {
  advanceTime,
  arrayRootOf,
  arrayValueFits,
  childrenOf,
  cloneValue,
  elementAt,
  enumValueFits,
  fieldValueFits,
  formatTime,
  integerRangeOf,
  integerStepFits,
  integerValueFits,
  fieldWriteCoveredBy,
  isFieldRef,
  isInsideArray,
  valueFits,
  isRecord,
  isTimeValue,
  normalizeWriteValue,
  pathsOf,
  WriteValueError,
  type WriteValueProblem,
  refElementOf,
  refPathsOf,
  refTreeIssues,
  refValueIssues,
  refChildOwnerBlocked,
  assignIdsDeep,
  itemIdsOf,
  unitsOfMode,
} from './statetree'
import { advanceTimeArgsOf, writeStateArgsOf } from './tool-definitions'
import type {
  Card,
  ChainNode,
  ItemObject,
  ItemValue,
  Preset,
  ProviderReply,
  ProviderToolCall,
  Save,
  SaveEvent,
  StateElement,
  TimeMode,
  TimeUnit,
  TimeValue,
  TokenUsage,
  TraceAttempt,
  TraceAttemptError,
  TraceDetail,
  TraceToolCall,
  Tree,
} from './types'

// `advanceTime` 的语义是公历推进（`statetree.ts`），这里转出一份：老的调用方写的还是 `engine.ts`
export { advanceTime }

/** 流式回调看到的事件：落盘事件 + 只在内存里过的 `chunk` */
export type StreamEvent = SaveEvent | { type: 'chunk'; text: string }

export interface RunTurnArgs {
  card: Card
  save: Save
  /** 本机预设池（`tg2.presets` 整张表） */
  presets: Preset[]
  /** 这张卡那一片映射（`tg2.nodeModels[cardId]`），可以缺省 */
  nodePresets?: Record<string, string>
  action: string
  onEvent?: (event: StreamEvent) => void
  signal?: AbortSignal
}

export interface RunTurnResult {
  save: Save
  events: SaveEvent[]
}

const now = () => new Date().toISOString()

function timeAt(card: Card, tree: Tree): TimeValue {
  const value = tree[timePathOf(card)]
  if (!isTimeValue(value, timeElementOf(card).timeMode)) {
    throw new AppError('E_VALIDATION', { message: t('error.timeTree'), nextStep: t('next.home') })
  }
  return value
}

function aborted(): AppError {
  return new AppError('E_ABORTED')
}

/**
 * 时间元素（卡里唯一的那一个，`state[0]`）。引擎这一层只负责从卡里取出它；
 * 推进本身住在 `statetree.ts`，允许哪些单位由它的 `timeMode` 决定。
 */
function timeElementOf(card: Card): StateElement {
  const time = card.state[0]
  if (!time || time.type !== 'time') {
    throw new AppError('E_VALIDATION', { message: t('issue.timeFirst'), nextStep: t('next.editor') })
  }
  return time
}

/** 时间元素的值路径：`tree` 里它永远是自己的 code（时间没有孩子） */
function timePathOf(card: Card): string {
  return pathsOf(card.state, timeElementOf(card).code)[0]
}

/**
 * 往状态树写一个值，返回**新** tree（入参一个字都不改）。
 *
 * 合法路径 = `node.writable` 里某个引用覆盖的权限路径（`pathsOf`；引用可以是元素 code、
 * `<code>.0`、数组容器 `2.4`，或数组字段 `2.4.1`）；其余一律 `E_CHAIN`。时间只能走 `advance_time`；
 * 结构体没有自身值；值的类型由元素决定（文字 / 整数含上下限与单次步幅 / 下拉白名单），不符合 ⇒ `E_VALIDATION`。
 *
 * 数组两种写法（权限引用决定模型能用哪种）：
 *   · 数组容器 `2.4` ⇒ **整表替换**（可增删项目）；
 *   · 数组字段 `2.4.1` ⇒ 一个**长度 = 当前项目数**的数组，逐个 item 只改这一格（不增删项目、不动别的字段）。
 */
export function applyWrite({
  card,
  node,
  tree,
  path,
  value,
}: {
  card: Card
  node: ChainNode
  tree: Tree
  path: string
  value: unknown
}): Tree {
  const element = elementOfPath(card.state, path)
  const field = isFieldRef(card.state, path) ? refElementOf(card.state, path) : undefined
  if (element?.type === 'time') {
    throw new AppError('E_CHAIN', {
      message: t('error.writeTime', { node: node.id }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, path },
    })
  }
  const coveredRefs = node.writable.flatMap((ref) => refPathsOf(card.state, ref))
  /** 写源数组容器 ⇒ 自动获得直接引用者的**自身值**写权限（字段写不传播、反向不传播） */
  const derived = new Set<string>()
  for (const element of card.state) {
    if (element.type !== 'ref' || element.refSource === undefined) continue
    if (!coveredRefs.includes(element.refSource)) continue
    // 顶层 ref：自身值就是它的值路径；item 级 ref：自身值是那个字段列（更深也一样）
    // 但 item 级 ref 带子元素时不派生：字段列写会连关系子元素一起替换
    if (isInsideArray(card.state, element.code) && childrenOf(card.state, element.code).length > 0) continue
    const ownPath = isInsideArray(card.state, element.code)
      ? element.code
      : pathsOf(card.state, element.code)[0]
    if (ownPath !== undefined) derived.add(ownPath)
  }
  const covered =
    derived.has(path) ||
    coveredRefs.includes(path) ||
    // 字段写：逐字引用，或者它的**数组容器**祖先（容器写 ⊇ 字段写；字段引用不授权整表）
    (field !== undefined && fieldWriteCoveredBy(card.state, node.writable, path))
  if (!covered) {
    throw new AppError('E_CHAIN', {
      message:
        element || field
          ? t('error.writeNotAllowed', { node: node.id, path })
          : t('error.writeMissing', { path }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, path, writable: node.writable },
    })
  }
  if (!element && !field) {
    throw new AppError('E_CHAIN', {
      message: t('error.writeMissing', { path }),
      nextStep: t('next.editor'),
      detail: { path },
    })
  }
  // 关系子元素：ref 自身值为 null 时写它 ⇒ E_VALIDATION（顶层 / item 级 / 更深一律覆盖）
  const blockedRef = refChildOwnerBlocked(card.state, tree, path)
  if (blockedRef !== undefined) {
    throw new AppError('E_VALIDATION', {
      message: t('error.writeRefChildEmpty', { code: blockedRef }),
      nextStep: t('next.editor'),
      detail: { code: blockedRef, path },
    })
  }
  /** 值 / 范围不合就报这一条（中文，带上路径与类型，方便排障） */
  const reject = () =>
    new AppError('E_VALIDATION', {
      message: t('error.valueNotFit', { path }),
      nextStep: t('next.editor'),
      detail: { path, value, type: (element ?? field)?.type },
    })
  /** 归一化失败（未知键 / 同字段写两次 / 同名歧义）：中文消息点名路径与出问题的字段 */
  const rejectNormalize = (problem: WriteValueProblem) =>
    new AppError('E_VALIDATION', {
      message:
        problem.kind === 'unknown'
          ? t('error.writeValueUnknown', { path, key: problem.key })
          : problem.kind === 'duplicate'
            ? t('error.writeValueDuplicate', { path, field: problem.field })
            : t('error.writeValueAmbiguous', {
                path,
                name: problem.name,
                fields: problem.fields.join(t('prompt.enumSeparator')),
              }),
      nextStep: t('next.editor'),
      detail: { path, ...problem },
    })
  /** 把提示词的中文名 / 自身 换成 code；归一化失败 ⇒ 点名字段的 E_VALIDATION */
  const normalize = (incoming: unknown): unknown | undefined => {
    try {
      return normalizeWriteValue(card.state, path, incoming)
    } catch (cause) {
      if (cause instanceof WriteValueError) throw rejectNormalize(cause.problem)
      throw cause
    }
  }
  // 数组字段（`2.4.1` 这类引用，没有值路径）：整列替换。
  // 值**按数组层嵌套**：最外层长度 = 外层 item 数；路上每穿过一个 array 字段就多一层数组，
  // 每层长度 = 那一层的当前 item 数；最内层按字段类型判。形状不对 ⇒ `E_VALIDATION`，tree 不动。
  if (element === undefined) {
    const arrayCode = arrayRootOf(card.state, path) as string
    const incoming = normalize(value)
    const patched =
      incoming === undefined
        ? undefined
        : patchFieldLayer(card.state, arrayCode, tree[arrayCode], path, incoming)
    if (patched === undefined) throw reject()
    const nextTree = { ...tree, [arrayCode]: patched as Tree[string] }
    const [refIssue] = refTreeIssues(card, nextTree)
    if (refIssue !== undefined) {
      throw new AppError('E_VALIDATION', {
        message: refIssue.message,
        nextStep: t('next.editor'),
        detail: { code: refIssue.code, path: refIssue.path },
      })
    }
    return nextTree
  }
  // 值的类型与范围由元素决定；数字 / 下拉的规矩与卡校验同一份（`statetree`），这里不重写
  if (element.type === 'text') {
    if (typeof value !== 'string') throw reject()
  } else if (element.type === 'enum') {
    if (!enumValueFits(element, value)) throw reject()
  } else if (element.type === 'integer') {
    // 模型可能把 JSON 数字写成字符串（schema 的 `value` 两样都收）：数字字符串按整数收下，
    // 落进 tree 的是**数字**；非数字串（`"abc"` / 空串）照旧拒，然后才查上下限与单次步幅。
    const numeric = typeof value === 'string' ? Number(value.trim()) : value
    if (typeof value === 'string' && value.trim() === '') throw reject()
    if (!integerValueFits(element, numeric) || !integerStepFits(element, numeric, tree[path])) throw reject()
    value = numeric
  } else if (element.type === 'array') {
    // 数组整表替换：先归一中文字段名，再补 / 保留隐藏 id（旧 id 必须原样带回，新 item 由机器生成）
    const incoming = normalize(value)
    if (incoming === undefined || !Array.isArray(incoming)) throw reject()
    const oldIds = new Set(itemIdsOf(tree[path]))
    const supplied = itemIdsOf(incoming)
    for (const id of supplied) {
      if (!oldIds.has(id)) {
        throw new AppError('E_VALIDATION', {
          message: t('error.writeValueUnknown', { path, key: id }),
          nextStep: t('next.editor'),
          detail: { path, id },
        })
      }
    }
    const withIds = assignIdsDeep(card.state, element, incoming, tree[path])
    if (!arrayValueFits(card.state, path, withIds)) throw reject()
    value = withIds
  } else if (element.type === 'ref') {
    const sourceItems = element.refSource === undefined ? undefined : tree[element.refSource]
    const [refIssue] = refValueIssues(card.state, element, value, sourceItems)
    if (refIssue !== undefined) {
      throw new AppError('E_VALIDATION', {
        message: refIssue,
        nextStep: t('next.editor'),
        detail: { path, code: element.code },
      })
    }
    if (!valueFits(card.state, element, value)) throw reject()
  }
  const nextTree = { ...tree, [path]: value as Tree[string] }
  const [refIssue] = refTreeIssues(card, nextTree)
  if (refIssue !== undefined) {
    throw new AppError('E_VALIDATION', {
      message: refIssue.message,
      nextStep: t('next.editor'),
      detail: { code: refIssue.code, path: refIssue.path },
    })
  }
  return nextTree
}

/**
 * 按数组层写字段：`container` 是当前这一层数组的 code（最外层容器 / 中间的 array 字段），
 * `current` 是它现在的 item 列表，`incoming` 是「这一层每个 item 的值」。
 * 形状不对返回 `undefined`（调用方转 `E_VALIDATION`，tree 一个字不动）。
 */
function patchFieldLayer(
  state: Card['state'],
  container: string,
  current: unknown,
  ref: string,
  incoming: unknown,
): unknown[] | undefined {
  if (!Array.isArray(current) || !Array.isArray(incoming) || current.length !== incoming.length) {
    return undefined
  }
  const next = cloneValue(current) as unknown[]
  for (let at = 0; at < next.length; at += 1) {
    const item = next[at]
    if (!isRecord(item)) return undefined
    const patched = patchFieldInItem(state, container, item, ref, incoming[at])
    if (patched === undefined) return undefined
    next[at] = patched
  }
  return next
}

/**
 * 在一层 item 对象里沿字段 code 下钻：**有孩子的字段**（对象字段、或「自身值 + 孩子」的标量字段）
 * 继续往里走，**array 字段多一层数组**（值继续按层嵌套），到 `ref` 自己那一格就按字段类型判值并写入。
 * 返回新的 item；形状不对 ⇒ `undefined`。
 */
function patchFieldInItem(
  state: Card['state'],
  container: string,
  item: Record<string, unknown>,
  ref: string,
  incoming: unknown,
): ItemObject | undefined {
  const nextCode = `${container}.${ref.slice(container.length + 1).split('.')[0]}`
  const next = { ...item } as ItemObject
  if (nextCode === ref) {
    const field = elementAt(state, ref)
    const fixed = assignIdsDeep(state, field, incoming, item[ref])
    if (!fieldValueFits(state, field, fixed)) return undefined
    next[ref] = fixed as ItemValue
    return next
  }
  const field = elementAt(state, nextCode)
  if (field.type === 'array') {
    const patched = patchFieldLayer(state, nextCode, item[nextCode], ref, incoming)
    if (patched === undefined) return undefined
    next[nextCode] = patched as ItemValue
    return next
  }
  if (childrenOf(state, nextCode).length === 0 || !isRecord(item[nextCode])) return undefined
  const patched = patchFieldInItem(state, nextCode, item[nextCode], ref, incoming)
  if (patched === undefined) return undefined
  next[nextCode] = patched
  return next
}

/**
 * 一个节点的模型从哪来（§4.1）：映射里有它 ⇒ 按 id 在池子里找；没有 ⇒ 池子的第一个。
 * 找不到就报 `E_VALIDATION` —— **不静默退回第一个**（那会让「预设被删了」看起来像正常）。
 */
export function resolveNodePreset({
  presets,
  nodePresets,
  nodeId,
}: {
  presets: Preset[]
  nodePresets?: Record<string, string>
  nodeId: string
}): Preset {
  const mappedId = nodePresets?.[nodeId]
  if (mappedId !== undefined) {
    const mapped = presets.find((preset) => preset.id === mappedId)
    if (mapped) return mapped
    throw new AppError('E_VALIDATION', {
      message: t('error.presetGone', { node: nodeId }),
      nextStep: t('next.settings'),
      detail: { nodeId, presetId: mappedId },
    })
  }
  const first = presets[0]
  if (!first) {
    throw new AppError('E_VALIDATION', {
      message: t('error.noPreset'),
      nextStep: t('next.settings'),
      detail: { nodeId },
    })
  }
  return first
}

/**
 * 执行一个被允许的工具调用，返回新 tree、两条事件（`tool` + `write`）与一句执行结果。
 * `result` 只进 trace 的「工具调用」那一格（给人看），不参与任何状态。
 *
 * 工具权限**只看 `toolsForNode`**（由 `writable` 的数据类型派生）—— 它同时也是喂给模型的工具表，
 * 所以「模型能叫什么」与「引擎许不许可」是同一份名单。
 */
function runTool({
  card,
  node,
  tree,
  name,
  args,
}: {
  card: Card
  node: ChainNode
  tree: Tree
  name: string
  args: Record<string, unknown>
}): { tree: Tree; events: SaveEvent[]; result: string } {
  if (!toolsForNode(card, node).includes(name)) {
    throw new AppError('E_CHAIN', {
      message: t('error.toolNotAllowed', { node: node.id, tool: name }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, tool: name },
    })
  }
  const at = now()
  if (name === 'advance_time') {
    // 能走到这里就说明时间元素在 `node.writable` 里（`toolsForNode` 只在这种情况下发这个工具），
    // 所以这一分支只看参数与模式，不再问一遍权限。实参名与 provider 声明的 schema 同一份。
    const { amount, unit } = advanceTimeArgsOf(args)
    const element = timeElementOf(card)
    const path = timePathOf(card)
    const mode = element.timeMode as TimeMode
    const next = advanceTime(timeAt(card, tree), amount as number, unit as TimeUnit, { mode })
    return {
      tree: { ...tree, [path]: next },
      events: [
        { type: 'tool', text: name, detail: { name, args }, at },
        { type: 'write', text: path, detail: { path, value: next }, at },
      ],
      result: formatTime(next, mode),
    }
  }
  // 实参名与 provider 声明的 schema 同一份（`tool-definitions.ts`）
  const { path, value } = writeStateArgsOf(args)
  if (typeof path !== 'string') {
    throw new AppError('E_VALIDATION', {
      message: t('error.field', { field: 'path' }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, args },
    })
  }
  const next = applyWrite({ card, node, tree, path, value })
  // 事件记的是**真正落进 tree 的值**（数字字符串已被收成数字；数组整表就是新列表；
  // 数组字段写的是那一列的值，tree 里没有一条独立路径可以取）
  const written = isFieldRef(card.state, path) ? value : next[path]
  return {
    tree: next,
    events: [
      { type: 'tool', text: name, detail: { name, args }, at },
      { type: 'write', text: path, detail: { path, value: written }, at },
    ],
    result: typeof written === 'object' ? JSON.stringify(written) : String(written),
  }
}

function sumUsage(usage: TokenUsage | null, reply: ProviderReply): TokenUsage | null {
  if (!reply.usage) return usage
  if (!usage) return { ...reply.usage }
  return {
    inputTokens: usage.inputTokens + reply.usage.inputTokens,
    outputTokens: usage.outputTokens + reply.usage.outputTokens,
    totalTokens: usage.totalTokens + reply.usage.totalTokens,
  }
}

/** 每秒输出 token 数：没有用量、或耗时为 0（量不出速率）时给 `null` */
function tpsOf(usage: TokenUsage | null, durationMs: number): number | null {
  if (!usage || durationMs <= 0) return null
  return usage.outputTokens / (durationMs / 1000)
}

/**
 * 失败调用落在哪条值路径上：`advance_time` 是时间元素的自身值路径；
 * 工具名不在节点工具表里时没有路径可写 ⇒ `（无）`（契约 §4「工具执行失败」块）。
 */
function failurePathOf(card: Card, node: ChainNode, call: ProviderToolCall): string {
  if (!toolsForNode(card, node).includes(call.name)) return t('prompt.retryNone')
  if (call.name === 'advance_time') return timePathOf(card)
  const { path } = writeStateArgsOf(call.args)
  return typeof path === 'string' ? path : t('prompt.retryNone')
}

/**
 * 「正确值形状」的指引：**从目标元素的类型派生**，不是复述模型的原文。
 *   · 文本 / 整数 / 下拉 ⇒ JSON 值形状（整数带该元素的上下限与步幅）；
 *   · 时间 ⇒ 只能走 `advance_time`，列该时间模式允许的单位；
 *   · 路径不存在 ⇒ 列这个节点可写的值路径；
 *   · 工具名不在工具表里 ⇒ 列这个节点实际允许的工具。
 */
function guidanceOf(card: Card, node: ChainNode, call: ProviderToolCall): string {
  const tools = toolsForNode(card, node)
  const separator = t('prompt.listSeparator')
  if (!tools.includes(call.name)) {
    return t('prompt.retryGuidanceTools', { tools: tools.join(separator) })
  }
  if (call.name === 'advance_time') {
    const mode = timeElementOf(card).timeMode as TimeMode
    return t('prompt.retryGuidanceTime', { units: unitsOfMode(mode).join(separator) })
  }
  const { path } = writeStateArgsOf(call.args)
  // 数组字段引用：写的是「每个 item 一格」，值按数组层嵌套（长度各等于那一层的当前 item 数）
  if (typeof path === 'string' && isFieldRef(card.state, path)) {
    return fieldWriteRuleOf(card.state, path)
  }
  const element = typeof path === 'string' ? elementOfPath(card.state, path) : undefined
  if (!element) {
    return t('prompt.retryGuidancePaths', {
      paths: [...new Set(node.writable.flatMap((ref) => refPathsOf(card.state, ref)))].join(separator),
    })
  }
  if (element.type === 'time') return t('prompt.retryGuidanceAdvance')
  if (element.type === 'array') {
    return t('prompt.retryGuidanceArray', { fields: arrayFieldRulesOf(card.state, element.code) })
  }
  if (element.type === 'integer') {
    const { min, max, stepMin, stepMax } = integerRangeOf(element)
    return t('prompt.retryGuidanceInteger', { min, max, stepMin, stepMax })
  }
  if (element.type === 'enum') {
    return t('prompt.retryGuidanceEnum', {
      values: (element.values ?? []).join(separator),
    })
  }
  return t('prompt.retryGuidanceText')
}

/**
 * 重试时追加到提示词末尾的 `<工具执行失败>` 块：只写**上一轮**那一条错误。
 * 它必须是提示词的最后一个块（`prompt.trimEnd()` 以 `</工具执行失败>` 结尾）。
 */
function failureBlockOf({
  card,
  node,
  error,
  call,
}: {
  card: Card
  node: ChainNode
  error: TraceAttemptError
  call: ProviderToolCall
}): string {
  const block = t('prompt.retryBlock')
  return [
    `<${block}>`,
    t('prompt.retryTool', { tool: error.tool }),
    t('prompt.retryPath', { path: error.path }),
    t('prompt.retryCode', { code: error.code }),
    t('prompt.retryMessage', { message: error.message }),
    t('prompt.retryGuidance', { guidance: guidanceOf(card, node, call) }),
    `</${block}>`,
  ].join('\n')
}

// 跑一回合：校验 -> 记行动 -> 逐节点调模型与执行工具 -> 收尾（返回新 save）
export async function runTurn({
  card,
  save,
  presets,
  nodePresets,
  action,
  onEvent,
  signal,
}: RunTurnArgs): Promise<RunTurnResult> {
  validateCard(card)
  validateSave(save, card)
  if (signal?.aborted) throw aborted()

  const turnStartedAt = Date.now()
  const turn = save.turn + 1
  const events: SaveEvent[] = []
  /** 本回合所有节点的用量之和（turnStats 用） */
  let totalUsage: TokenUsage | null = null

  /** 落盘事件（同时转发给 onEvent） */
  const push = (event: SaveEvent) => {
    events.push(event)
    onEvent?.(event)
  }

  push({ type: 'action', text: action, at: now() })

  let tree: Tree = save.tree
  /** 本回合已执行节点的输出，按节点 id 索引（提示词的上游段从这里取） */
  const outputs: Record<string, string> = {}
  /** 这张卡的时间模式：真 provider 的工具表按它收窄 `advance_time.unit` 的枚举（卡已校验过） */
  const timeMode = timeElementOf(card).timeMode as TimeMode

  /**
   * 跑一个节点：最多 `1 + retryCount` 次模型尝试。
   *
   * 一次尝试 = 一次模型调用 + 执行它回的全部工具调用；**这次尝试是原子的** —— 任一工具失败 ⇒
   * 这一轮的 tree 与 `tool` / `write` 事件全部丢弃，本回合的 tree 一个字不动、事件一条不落。
   * 还有剩余次数 ⇒ 把上一轮的错误拼成 `<工具执行失败>` 块追加到提示词末尾再调；耗尽 ⇒ 抛**最后一次**的错误。
   * 成功 ⇒ 返回这次尝试的 tree / 事件 / trace 读数（提交由调用方做）。
   */
  async function runNode({
    node,
    preset,
    tree,
    basePrompt,
  }: {
    node: ChainNode
    preset: Preset
    tree: Tree
    basePrompt: string
  }): Promise<{
    tree: Tree
    toolCalls: TraceToolCall[]
    events: SaveEvent[]
    reply: ProviderReply
    prompt: string
    attempts: TraceAttempt[]
    durationMs: number
  }> {
    const attempts: TraceAttempt[] = []
    const retryCount = node.retryCount ?? 0
    const onChunk = node.type === 'output' ? (text: string) => onEvent?.({ type: 'chunk', text }) : undefined
    let prompt = basePrompt
    let durationMs = 0

    for (let attemptIndex = 0; ; attemptIndex += 1) {
      if (signal?.aborted) throw aborted()
      // 计时只包住模型调用（工具执行与事件记账不算进去）；重试时累加这一节点的全部尝试
      const startedAt = Date.now()
      let reply: ProviderReply
      if (preset.provider === 'mock') {
        reply = await mockReply({
          card,
          node,
          turn,
          action,
          prompt,
          onChunk,
          signal,
          delayMs: preset.mockChunkDelayMs ?? 0,
        })
      } else {
        // 真 provider 才按需把 AI SDK 那一块拉进来：首屏不必为可能用不到的网络层付体积。
        // 🔴 60 秒那颗定时器要在 import **之前**起：它必须在「这次调用开始」时就存在，
        //    而不是等 chunk 下载完 —— 否则一个慢网络就能把「超时」变成永远等不到。
        const deadline = startDeadline(PROVIDER_TIMEOUT_MS)
        try {
          const { callProvider } = await import('./provider')
          reply = await callProvider({
            preset,
            prompt,
            // 工具表**按 writable 覆盖到的值派生**（与 runTool 的许可同一份名单）；
            // `advance_time.unit` 的枚举再按这张卡的时间模式收窄（模型看不到模式外的单位）
            tools: toolsForNode(card, node),
            timeMode,
            onChunk,
            signal,
            deadline,
          })
        } finally {
          deadline.clear()
        }
      }
      durationMs += Date.now() - startedAt

      if (signal?.aborted) throw aborted()
      totalUsage = sumUsage(totalUsage, reply)

      const toolCalls: TraceToolCall[] = []
      const attemptEvents: SaveEvent[] = []
      let workingTree = tree
      let failure: { record: TraceAttemptError; cause: AppError; call: ProviderToolCall } | null = null
      for (const call of reply.toolCalls) {
        try {
          const executed = runTool({ card, node, tree: workingTree, name: call.name, args: call.args })
          workingTree = executed.tree
          toolCalls.push({ name: call.name, args: call.args, result: executed.result })
          attemptEvents.push(...executed.events)
        } catch (cause) {
          // 工具执行抛的都是 AppError；别的错误是产品 bug，照原样冒出去（不吞、不重试）
          if (!(cause instanceof AppError)) throw cause
          failure = {
            record: {
              tool: call.name,
              path: failurePathOf(card, node, call),
              code: cause.code,
              message: cause.message,
            },
            cause,
            call,
          }
          break
        }
      }

      attempts.push({ index: attemptIndex, toolCalls, error: failure?.record ?? null })
      // 成功：只有这一次尝试的 tree / 事件生效（唯一会提交给本回合的那一份）
      if (!failure)
        return { tree: workingTree, toolCalls, events: attemptEvents, reply, prompt, attempts, durationMs }
      // 失败：workingTree / attemptEvents 到此为止（不入 tree、不落事件）；耗尽就抛最后一次的错误
      if (attemptIndex === retryCount) throw failure.cause
      prompt = `${basePrompt}\n\n${failureBlockOf({ card, node, error: failure.record, call: failure.call })}`
    }
  }

  for (const node of card.chain) {
    if (signal?.aborted) throw aborted()
    push({ type: 'node', text: node.name, detail: { id: node.id, type: node.type }, at: now() })

    const preset = resolveNodePreset({ presets, nodePresets, nodeId: node.id })

    // 提示词里的状态值读的是**本回合此刻**的 tree：前面的节点写进去的东西，后面节点看得见
    // （写入同时累积进本回合的 tree，回合收尾与叙事一起提交进新 save）。
    // 重试时这一段是 base prompt，错误块由 `runNode` 追加在它末尾。
    const basePrompt = buildPrompt({ card, save: { ...save, tree }, node, action, outputs })
    const done = await runNode({ node, preset, tree, basePrompt })
    tree = done.tree
    for (const event of done.events) push(event)

    const trace: TraceDetail = {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      presetId: preset.id,
      prompt: done.prompt,
      thinking: done.reply.reasoning,
      toolCalls: done.toolCalls,
      attempts: done.attempts,
      output: done.reply.text,
      usage: done.reply.usage,
      durationMs: done.durationMs,
      tps: tpsOf(done.reply.usage, done.durationMs),
      turn,
    }
    push({ type: 'trace', text: node.name, detail: trace, at: now() })

    if (node.type === 'output') push({ type: 'narration', text: done.reply.text, at: now() })
    outputs[node.id] = done.reply.text
  }

  const totalMs = Date.now() - turnStartedAt
  push({
    type: 'turnStats',
    text: `turn ${turn}`,
    detail: { turn, totalMs, usage: totalUsage, tps: tpsOf(totalUsage, totalMs) },
    at: now(),
  })

  const nextSave: Save = {
    ...save,
    tree,
    events: [...save.events, ...events],
    turn,
    updatedAt: now(),
  }
  // 提交之前再验一次：本回合写进 tree 的东西必须让整份存档仍然合法（时间格尤其）。
  // 不合法 ⇒ 抛中文错误、不返回新存档，调用方按「本回合没发生」处理。
  validateSave(nextSave, card)
  return { save: nextSave, events }
}
