/**
 * src/game/opening.ts —— 把卡的「开局」翻译成新游戏开头要的那两样事实（决定 #31 / #42）。
 *
 * 开局块只给**事实**：主控的默认名、第一轮的要求。开场正文由模型现写（决定 #31），
 * 所以这里不产生任何正文 —— 它是引擎自带的开场指令（prompts/<lang>/opening.md）
 * 加上卡里这几条要求，一起进「玩家」那一段。
 *
 * 纯函数、不 import Vue、不认 i18n：「默认名为空时用什么」是调用方的事。
 */
import type { CardData } from './card'

/** 开头要的两样事实 */
export interface OpeningFacts {
  /** 主控的默认名；卡给空串 = 这张卡不预设名字（界面按当前语言兜底） */
  name: string
  /** 第一轮的要求（与引擎的开场指令一起进「玩家」那一段） */
  requirements: string[]
}

/** 从一张**已校验**的卡里读出开局事实（形状由 game/card.ts 守，这里只读不判） */
export function openingOf(card: CardData): OpeningFacts {
  return { name: card.opening.defaultName, requirements: [...card.opening.requirements] }
}
