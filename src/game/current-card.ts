/**
 * src/game/current-card.ts —— 应用当前认的那张卡，以及换卡 / 存卡的动作。
 *
 * 两张来源：localStorage 里存的（导入或编辑过的，键 tavernGame.card，值是卡的 JSON 文本），
 * 没有就用内置示例卡 cards/morningwind.json。存的卡过两道校验 —— 卡格式（card.ts 的
 * parseCard）与显示词汇表（界面画不出来的声明 = 那一块玩家永远看不到）；任何一步失败都
 * 退回内置卡，并把原因留在 cardStartup 里让界面播报：一张错的卡会变成玩家第一屏看到的
 * 世界，静默退回等于骗他。
 *
 * ⚠️ 换卡之后必须整页 location.reload()：引擎（agent/agent.ts）与显示块映射
 *    （components/display-blocks.ts）都在**模块加载期**读这张卡 —— reload 是唯一
 *    不会漏掉消费者的做法。所以这里只负责落盘 / 删键，reload 由调用方（界面）做。
 */
// import attribute 是 ESM 的规范写法：没有它，用原生 ESM 加载器直接加载这个模块的工具
// 会拒绝 .json（Playwright 的 TS 加载器就是这样报错的）；Vite 构建与 vue-tsc 两种写法都认
import cardJson from '../../cards/morningwind.json' with { type: 'json' }
import { parseCard, validateCard, type CardData } from './card'
import { checkRenderable, displayOf } from './display'

/** 活动卡的存储键（与存档 / 配置一样，谁用谁定义） */
const CARD_KEY = 'tavernGame.card'

/** 卡从哪来：内置示例 or 玩家导入的（界面要显示这件事） */
export type CardSource = 'builtin' | 'imported'

/** 启动那次选卡的结果 —— failed 是原始报错（带 JSON 路径），翻译成文案是界面的事 */
export interface CardStartup {
  source: CardSource
  /** 存着的卡用不了时的原因；用上了（或压根没存）就是 null */
  failed: string | null
}

/** 卡格式 + 显示词汇表两道校验；通不过就抛错并带 JSON 路径 */
function renderable(card: CardData): CardData {
  checkRenderable(displayOf(card))
  return card
}

/**
 * 内置示例卡（唯一事实来源 cards/morningwind.json）。
 *
 * 它是仓库里的编译期数据，坏掉只能是代码改错了 —— 所以直接启动即失败，没有「退回」可言。
 */
const builtinCard: CardData = renderable(validateCard(cardJson))

/** 启动选卡：有存的就用存的（过校验），否则退回内置卡并记下原因 */
function activate(): { card: CardData; startup: CardStartup } {
  const stored = localStorage.getItem(CARD_KEY)
  if (stored === null) return { card: builtinCard, startup: { source: 'builtin', failed: null } }
  try {
    return { card: renderable(parseCard(stored)), startup: { source: 'imported', failed: null } }
  } catch (err) {
    // 边界：存着的卡是外部数据（玩家导入或手改 localStorage）—— 退回内置卡并让界面播报
    return { card: builtinCard, startup: { source: 'builtin', failed: (err as Error).message } }
  }
}

const active = activate()

/** 当前卡（已通过校验）—— 用到卡的地方都从这里取 */
export const currentCard: CardData = active.card

/** 启动那次选卡的结果：来源与失败原因（App 挂载时拿它播报） */
export const cardStartup: CardStartup = active.startup

/** 一张卡在存储里的规范写法：缩进两格的 JSON —— 与导出的文件逐字一致 */
function cardText(card: CardData): string {
  return JSON.stringify(card, null, 2)
}

/**
 * 导入 / 保存一张卡：先过与启动同一套校验，**通过才落盘**，失败抛错（带 JSON 路径）
 * 且存储原样不动。调用方负责 reload —— 见文件头。
 */
export function importCard(text: string): void {
  localStorage.setItem(CARD_KEY, cardText(renderable(parseCard(text))))
}

/** 导出当前卡的 JSON 文本（文件名由界面决定） */
export function exportCardText(): string {
  return cardText(currentCard)
}

/** 恢复内置示例：删掉存储里的那张卡。调用方负责 reload —— 见文件头 */
export function resetToBuiltinCard(): void {
  localStorage.removeItem(CARD_KEY)
}

/** 卡名 / 版本 / ID —— 界面显示与导出文件名都用它（卡已校验，直接读） */
export function cardMeta(card: CardData): { id: string; name: string; version: string } {
  return { id: card.card.id, name: card.card.name, version: card.card.version }
}
