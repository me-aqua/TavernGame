/**
 * 票 56 的共享夹具：资源库面板与节点勾选区共用的那几件小事。
 *
 * 为什么集中在这里：`card-resources-dom.test.ts`（面板 / 勾选区的 DOM 契约）与
 * `card-resource-request.test.ts`（勾选真的改变发出去的请求）都要**同一份**「编辑器写回哪里」
 * 「怎么把写回去的那张卡读回来」——各写一份必然走偏，而契约只认**面板写进存储的那份文本**。
 *
 * ⚠️ 资源的**名字**一律从 locale 现取（`prompts.settingBlock.*` 就是调试痕迹里显示的那一套），
 *    本文件与三个测试文件里都不许出现中文字面量（.githooks/checks/ascii.mjs 连测试也拦）。
 */
import { readFileSync } from 'node:fs'
import { parseCard, type CardData } from '../../src/game/card'
import { EXAMPLE_CARD } from './card-fixtures'

/** 编辑器写回的那一份卡 —— 与 src/game/current-card.ts 的存储键一致 */
export const CARD_KEY = 'tavernGame.card'

/** 示例卡：九个节点，`settings` 逐节点声明（有的不带 style） */
export const EXAMPLE = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))

/** 没写某条声明的节点（卡格式的语义：不写 = 全发） */
export function declaresNothing(card: CardData, node: string, key: string): boolean {
  return !Object.hasOwn(card.graph.nodes[node], key)
}

/**
 * 一份「每个节点都写全了声明」的卡副本。
 *
 * 用在要**把声明消掉、看钩子回落到哪一档**的用例上：卡里没写的键在界面上是「全勾」，
 * 于是「全勾 → 取消一个 → 再勾回来」这条来回只有它能跑完（示例卡里没有这样的节点）。
 */
export function withEveryDeclaration(card: CardData): CardData {
  const copy = JSON.parse(JSON.stringify(card)) as CardData
  const settings = Object.keys(copy.settings)
  for (const id of copy.graph.topology) {
    const node = copy.graph.nodes[id] as { settings?: string[] }
    node.settings = [...settings]
  }
  return copy
}

/**
 * 界面上一次「勾 / 取消勾」落在卡里的那一串块名（写的顺序不重要，读的时候按卡序）。
 *
 * 面板把勾选集交给外层，外层写回节点的 `settings`；这份读法是**卡序**，
 * 于是「勾选顺序」不会把断言弄脆。
 */
export function declaredSettings(card: CardData, node: string): string[] | undefined {
  return (card.graph.nodes[node] as { settings?: string[] }).settings
}

/**
 * 把编辑器写进存储的那份文本读回来（走真校验器）。
 *
 * ⚠️ **这是「界面 → 请求」那条链的中间站**：断言必须从这份卡长出请求，而不是从测试自己
 *    拼的对象 —— 否则证明的是「测试会拼卡」，不是「面板改的那张卡有用」。
 */
export function savedCard(): CardData {
  const text = localStorage.getItem(CARD_KEY)
  if (text === null) throw new Error('the editor wrote no card into storage')
  return parseCard(text)
}

/**
 * 一块设定在**卡正文里**的标志行（卡内容不随界面语言变，标志行才在两种语言下都能用）。
 *
 * 取第一行非空的行：设定块以 `---` 分栏，头一行是 `【地理】` 这类标题行。
 */
export function markerOf(card: CardData, key: string): string {
  const line = card.settings[key as keyof CardData['settings']].find((text) => text !== '')
  if (line === undefined) throw new Error('setting block ' + key + ' has no non-empty line')
  return line
}
