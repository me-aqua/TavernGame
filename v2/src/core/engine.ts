/**
 * 引擎（CONTRACT §4）：跑一回合。
 *
 * 一回合 = 一条 `action` 事件 + 按 `chain` 顺序逐节点各调用一次模型 + 收尾。
 * 三个纯函数（`resolveNodePreset` / `applyWrite` / `advanceTime`）单独拆出来，
 * 因为它们各自有一条不许出错的规矩，而规矩要能单测。
 *
 * 四条不许破的：
 *   · **不修改入参**：`save` / `card` / `presets` / `nodePresets` 只读，返回新的 save；
 *   · **只有 output 节点的文本进故事流**（narration），其余节点只进 `debug.responses`；
 *   · **模型从本地映射解析**（`tg2.nodeModels` 那一片），卡里没有、也不许有模型绑定；
 *   · **中止 = 什么都不写**：`E_ABORTED` 抛出时调用方拿回的还是原存档。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import { mockReply } from './mock'
import { buildPrompt } from './prompt'
import { isTimeValue, validateCard, validateSave } from './schema'
import type {
  Card,
  ChainNode,
  Preset,
  ProviderReply,
  Save,
  SaveEvent,
  TimeValue,
  TokenUsage,
  Tree,
} from './types'

/**
 * 每种节点允许调用哪些工具（阶段 1 就这两个）。
 * 写在这里而不是 provider 里：provider 是**按需加载**的（见 `runTurn` 里那句动态 import），
 * 这张表却要随时可用 —— 校验工具权限不该为了拿一张常量表把整个 SDK 拉进来。
 */
const TOOLS_FOR_NODE: Record<ChainNode['type'], string[]> = {
  time: ['advance_time'],
  normal: ['write_state'],
  output: [],
  proof: [],
}

/** 流式回调看到的事件：落盘事件 + 只在内存里过的 `chunk` */
export type StreamEvent = SaveEvent | { type: 'chunk'; text: string }

export interface DebugPayload {
  prompts: Record<string, string>
  responses: Record<string, string>
  tools: { nodeId: string; name: string; args: Record<string, unknown> }[]
  usage: TokenUsage | null
  presets: Record<string, string>
}

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
  debug: DebugPayload
}

const now = () => new Date().toISOString()

/** `tree['0']` 一定是个时间；不是就报结构错（校验之后不该发生，但类型上必须收窄） */
function timeOf(tree: Tree): TimeValue {
  const value = tree['0']
  if (!isTimeValue(value)) {
    throw new AppError('E_VALIDATION', { message: t('error.timeTree'), nextStep: t('next.home') })
  }
  return value
}

function aborted(): AppError {
  return new AppError('E_ABORTED')
}

/**
 * 推进时间：`hour += hours`，跨天进位，负数也按同一套取模。
 * 小时数必须是整数（非整数说明卡或模型给的参数坏了）。
 */
export function advanceTime(time: TimeValue, hours: number): TimeValue {
  if (!Number.isInteger(hours)) {
    throw new AppError('E_VALIDATION', {
      message: t('error.hoursInvalid'),
      nextStep: t('next.editor'),
      detail: { hours },
    })
  }
  const hour = time.hour + hours
  const day = time.day + Math.floor(hour / 24)
  return { day, hour: ((hour % 24) + 24) % 24 }
}

/**
 * 往状态树写一个字符串，返回**新** tree（入参一个字都不改）。
 * 越权（不在 `node.writable`）与悬空路径都算链的错（`E_CHAIN`）—— 它们违反的是
 * 卡里声明的 `writable`；值不是字符串则是数据错误（`E_VALIDATION`）。
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
  if (!node.writable.includes(path)) {
    throw new AppError('E_CHAIN', {
      message: t('error.writeNotAllowed', { node: node.id, path }),
      nextStep: t('next.editor'),
      detail: { path, writable: node.writable },
    })
  }
  if (!card.state.some((element) => element.code === path)) {
    throw new AppError('E_CHAIN', {
      message: t('error.writeMissing', { path }),
      nextStep: t('next.editor'),
      detail: { path },
    })
  }
  if (typeof value !== 'string') {
    throw new AppError('E_VALIDATION', {
      message: t('error.valueNotString'),
      nextStep: t('next.editor'),
      detail: { path, value },
    })
  }
  return { ...tree, [path]: value }
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

/** 执行一个被允许的工具调用，返回新 tree 与两条事件（`tool` + `write`） */
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
}): { tree: Tree; events: SaveEvent[] } {
  if (!TOOLS_FOR_NODE[node.type].includes(name)) {
    throw new AppError('E_CHAIN', {
      message: t('error.toolNotAllowed', { node: node.id, tool: name }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, tool: name },
    })
  }
  const at = now()
  if (name === 'advance_time') {
    const next = advanceTime(timeOf(tree), args.hours as number)
    return {
      tree: { ...tree, '0': next },
      events: [
        { type: 'tool', text: name, detail: { name, args }, at },
        { type: 'write', text: '0', detail: { path: '0', value: next }, at },
      ],
    }
  }
  const path = args.path
  if (typeof path !== 'string') {
    throw new AppError('E_VALIDATION', {
      message: t('error.field', { field: 'path' }),
      nextStep: t('next.editor'),
      detail: { nodeId: node.id, args },
    })
  }
  return {
    tree: applyWrite({ card, node, tree, path, value: args.value }),
    events: [
      { type: 'tool', text: name, detail: { name, args }, at },
      { type: 'write', text: path, detail: { path, value: args.value }, at },
    ],
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

  const turn = save.turn + 1
  const events: SaveEvent[] = []
  const debug: DebugPayload = { prompts: {}, responses: {}, tools: [], usage: null, presets: {} }

  /** 落盘事件（同时转发给 onEvent） */
  const push = (event: SaveEvent) => {
    events.push(event)
    onEvent?.(event)
  }

  push({ type: 'action', text: action, at: now() })

  let tree: Tree = save.tree
  let upstream = ''

  for (const node of card.chain) {
    if (signal?.aborted) throw aborted()
    push({ type: 'node', text: node.name, detail: { id: node.id, type: node.type }, at: now() })

    const preset = resolveNodePreset({ presets, nodePresets, nodeId: node.id })
    debug.presets[node.id] = preset.id

    // 提示词里的状态值读的是**回合开始时**那份 tree（write 在回合收尾才与叙事一起落盘），
    // 这样同一回合里前后节点看到的场景是同一份，不会出现「前一个节点刚改了什么、后一个看到半成品」。
    const prompt = buildPrompt({ card, save, node, action, upstream })
    debug.prompts[node.id] = prompt

    const onChunk = node.type === 'output' ? (text: string) => onEvent?.({ type: 'chunk', text }) : undefined

    const reply =
      preset.provider === 'mock'
        ? await mockReply({
            node,
            turn,
            action,
            onChunk,
            signal,
            delayMs: preset.mockChunkDelayMs ?? 0,
          })
        : // 真 provider 才按需把 AI SDK 那一块拉进来：首屏不必为了可能用不到的网络层付体积
          await import('./provider').then(({ callProvider }) =>
            callProvider({ preset, prompt, tools: TOOLS_FOR_NODE[node.type], onChunk, signal }),
          )

    if (signal?.aborted) throw aborted()
    debug.responses[node.id] = reply.text
    debug.usage = sumUsage(debug.usage, reply)

    for (const call of reply.toolCalls) {
      debug.tools.push({ nodeId: node.id, name: call.name, args: call.args })
      const executed = runTool({ card, node, tree, name: call.name, args: call.args })
      tree = executed.tree
      for (const event of executed.events) push(event)
    }

    if (node.type === 'output') push({ type: 'narration', text: reply.text, at: now() })
    upstream = reply.text
  }

  const nextSave: Save = {
    ...save,
    tree,
    events: [...save.events, ...events],
    turn,
    updatedAt: now(),
  }
  return { save: nextSave, events, debug }
}
