/**
 * 引擎（CONTRACT §4）：跑一回合。
 *
 * 一回合 = 一条 `action` 事件 + 按 `chain` 顺序逐节点各调用一次模型 + 收尾。
 * 三个纯函数（`resolveNodePreset` / `applyWrite` / `advanceTime`）单独拆出来，
 * 因为它们各自有一条不许出错的规矩，而规矩要能单测。
 *
 * 四条不许破的：
 *   · **不修改入参**：`save` / `card` / `presets` / `nodePresets` 只读，返回新的 save；
 *   · **只有 output 节点的文本进故事流**（narration），其余节点只进 `trace` 事件；
 *   · **模型从本地映射解析**（`tg2.nodeModels` 那一片），卡里没有、也不许有模型绑定；
 *   · **中止 = 什么都不写**：`E_ABORTED` 抛出时调用方拿回的还是原存档。
 *
 * 调试读数**落盘**：每跑完一个节点追加一条 `trace`（提示词 / 思考 / 工具调用 / 返回 /
 * 用量 / 耗时 / 预设），回合末尾追加一条 `turnStats`（总耗时 / 总用量 / 吞吐）。
 * 两者既进 `save.events`，也经 `onEvent` 实时发出去 —— 对话页重开旧存档时不用再跑模型
 * 就能看见当时每一步（老板 2026-11-25 的口径：调试内联进故事流）。
 */
import { t } from '../i18n'
import { PROVIDER_TIMEOUT_MS, startDeadline } from './deadline'
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
  TraceDetail,
  TraceToolCall,
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
}

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

/**
 * 执行一个被允许的工具调用，返回新 tree、两条事件（`tool` + `write`）与一句执行结果。
 * `result` 只进 trace 的「工具调用」那一格（给人看），不参与任何状态。
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
      result: `day ${next.day} hour ${next.hour}`,
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
    result: String(args.value),
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

  for (const node of card.chain) {
    if (signal?.aborted) throw aborted()
    push({ type: 'node', text: node.name, detail: { id: node.id, type: node.type }, at: now() })

    const preset = resolveNodePreset({ presets, nodePresets, nodeId: node.id })

    // 提示词里的状态值读的是**本回合此刻**的 tree：前面的节点写进去的东西，后面节点看得见
    // （写入同时累积进本回合的 tree，回合收尾与叙事一起提交进新 save）。
    const prompt = buildPrompt({ card, save: { ...save, tree }, node, action, outputs })

    const onChunk = node.type === 'output' ? (text: string) => onEvent?.({ type: 'chunk', text }) : undefined

    // 计时只包住这一次模型调用（工具执行与事件记账不算进去）
    const startedAt = Date.now()
    let reply: ProviderReply
    if (preset.provider === 'mock') {
      reply = await mockReply({
        node,
        turn,
        action,
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
          tools: TOOLS_FOR_NODE[node.type],
          onChunk,
          signal,
          deadline,
        })
      } finally {
        deadline.clear()
      }
    }
    const durationMs = Date.now() - startedAt

    if (signal?.aborted) throw aborted()
    totalUsage = sumUsage(totalUsage, reply)

    const toolCalls: TraceToolCall[] = []
    for (const call of reply.toolCalls) {
      const executed = runTool({ card, node, tree, name: call.name, args: call.args })
      toolCalls.push({ name: call.name, args: call.args, result: executed.result })
      tree = executed.tree
      for (const event of executed.events) push(event)
    }

    const trace: TraceDetail = {
      nodeId: node.id,
      nodeName: node.name,
      nodeType: node.type,
      presetId: preset.id,
      prompt,
      thinking: reply.reasoning,
      toolCalls,
      output: reply.text,
      usage: reply.usage,
      durationMs,
      tps: tpsOf(reply.usage, durationMs),
      turn,
    }
    push({ type: 'trace', text: node.name, detail: trace, at: now() })

    if (node.type === 'output') push({ type: 'narration', text: reply.text, at: now() })
    outputs[node.id] = reply.text
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
  return { save: nextSave, events }
}
