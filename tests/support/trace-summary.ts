/**
 * 票 55 的共享夹具：一条**真回合**里写出来的工具调用行与工具结果行。
 *
 * 为什么集中在这里：工具调用行与工具结果行各有一张用例表，两边都要先让**生产路径**
 * （`stores/turn.ts`）把这两行写出来 —— 摘要就是它写的。测试自己拼一份 `t(...)` 调用，
 * 断言到的只是测试造的那个对象，证不了产品会写什么。
 *
 * ⚠️ 语言必须在**跑回合之前**切：文案是写痕迹那一刻定下的数据，跑完再切语言不会改已写好的行。
 * ⚠️ 跑出来的两行都带 `detail`（协议原样的参数 / 引擎回传的结果）——「内容不丢」比的就是它。
 */
import { useGame } from '../../src/stores/game'
import { configureFakeProvider } from './game-fixtures'
import { cardTurnReplies, nodeWith } from './card-replies'
import { installFakeLlm, type FakeReply } from './fakeLlm'
import { label } from './trace-blocks'
import type { Row } from '../../src/stores/game'

/** 界面上的调试行（Row 的 debug 那一支）—— 契约要它带 detail、摘要收短 */
export type DebugRow = Extract<Row, { debug: true }>

/** 这一轮模型申请的工具（卡里的键；它按人名合并，结果会把写进去的值原样吐回来） */
export const TOOL = 'update_role'

/** 合并进去的人名（结果那一行会拿它当路径） */
export const ROLE_NAME = 'Pax'

/** 源串尾巴上的哨兵：它只该出现在**折叠起来的原文**里，不该出现在折叠条上 */
export const TAIL_SENTINEL = 'TAIL-SENTINEL'

/** 参数里的长正文：远超预览上限，末尾就是那个哨兵 */
export const LONG_NOTE = 'a long role note. '.repeat(8) + TAIL_SENTINEL

/** 模型给的参数（协议原样的一串 JSON）—— 摘要要收短的那个源串 */
export const LONG_ARGS = JSON.stringify({ name: ROLE_NAME, note: LONG_NOTE })

/** 只写人名、不写别的字段的参数（14 个字）：短到不该被截断 */
export const SHORT_ARGS = JSON.stringify({ name: ROLE_NAME })

/** 预览上限：**写死的那个值**（契约 §2）。超出才算截断，正好等于上限不算 */
export const PREVIEW_LIMIT = 40

/** 省略号标记的 locale 键（契约 §5）；`label()` 会在它缺失时当场停，不静默用 key 名当文案 */
export const PREVIEW_CUT_KEY = 'debug.previewCut'

/** 摘要该长的样子：不超上限就原样，超了就头 `PREVIEW_LIMIT` 个字 + 省略号标记 */
export function previewOf(source: string): string {
  return source.length <= PREVIEW_LIMIT ? source : source.slice(0, PREVIEW_LIMIT) + label(PREVIEW_CUT_KEY)
}

/**
 * 造一串**恰好 size 个字**的参数 JSON（`name` 之外只剩 `note`）。
 *
 * 边界用例要的是「正好等于上限」：多一个字就该截断，少一个字就不该。
 */
export function argsOfLength(size: number): string {
  const shell = JSON.stringify({ name: ROLE_NAME, note: '' })
  return JSON.stringify({
    name: ROLE_NAME,
    note: 'x'.repeat(size - shell.length),
  })
}

/** 折叠起来的原文（`detail`）与折叠条（`text`）—— 这两样就是本票要断言的东西 */
export interface TraceRows {
  tool: DebugRow
  result: DebugRow
}

/**
 * 跑一个真回合，让生产路径写下工具调用行与工具结果行。
 *
 * 参数由调用方给（长 / 短 / 正好卡在上限），假模型按协议回 `tool_calls`；
 * 回合里其余的节点照常跑（用的是 `card-replies` 那份按拓扑现取的假回复）。
 */
export async function runTurnWithArgs(args: string): Promise<TraceRows> {
  configureFakeProvider()
  const game = useGame()
  game.resetGame()
  // 调试关着时一条痕迹都不产生（`turn.ts` 写痕迹之前就先返回了）—— 这两行得开着调试才有
  game.debugMode.value = true
  const cast = nodeWith(TOOL)
  const replies: FakeReply[] = [{ toolCalls: [{ name: TOOL, arguments: args }] }, 'cast done']
  const fake = installFakeLlm(cardTurnReplies({ node: (id) => (id === cast ? replies : undefined) }))
  // 回合万一抛错也要把假 fetch 收回去：漏在 globalThis 上会让同一个文件后面几条用例
  // 拿到别人的假响应，红出来的原因就指向别处了
  try {
    await game.runTurnAction('look around')
  } finally {
    fake.restore()
  }

  const debug = game.rows.value.filter((row): row is DebugRow => row.debug)
  const tool = debug.find((row) => row.kind === 'tool')
  const result = debug.find((row) => row.kind === 'toolResult')
  if (!tool || !result) throw new Error('the turn wrote no tool / toolResult trace')
  return { tool, result }
}
