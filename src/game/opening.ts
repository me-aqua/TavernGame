/**
 * src/game/opening.ts —— 把卡的「开局」事实翻译成新游戏的第一帧（决定 #31 / #42）。
 *
 * 开局块只给**事实**：起始时刻 / 初始位置 / 默认名；开场正文由 AI 现写（决定 #31）。
 * 这一阶段引擎只消费其中三样 —— 时刻、场景名、主控默认名。区域与地点、以及
 * 「可让玩家起名」都还没有消费者，读进来只会多一个没人维护的字段（决定 #42）。
 *
 * 纯函数、不 import Vue、不认 i18n：「默认名为空时用什么」是调用方的事。
 */
import type { CardData } from './card'
import type { OpeningFacts } from './save'
import * as K from './card-keys'

/**
 * 从一张**已校验**的卡里读出开局事实。
 *
 * ⚠️ 下面的断言以 card.ts 校验通过为前提：卡是外部数据，形状只在那个边界守一次，
 *    在这里再判一遍就等于留了第二份会腐烂的规则。
 */
export function openingOf(card: CardData): OpeningFacts {
  const decl = card[K.KEY_DECL] as Record<string, unknown>
  const opening = decl[K.KEY_OPENING] as Record<string, unknown>
  const start = opening[K.KEY_START] as Record<string, string>
  return {
    iso: opening[K.KEY_START_TIME] as string,
    sceneName: start[K.KEY_SCENE],
    playerName: opening[K.KEY_DEFAULT_NAME] as string,
  }
}
