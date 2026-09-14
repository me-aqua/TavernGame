/**
 * src/game/current-card.ts —— 应用当前认的那张卡。
 *
 * 静态 import：卡在**构建期**就定下来（决定 #34：一张卡 = 一个自包含的 .json）。
 * 校验不过就是坏卡 —— 启动即失败，绝不「跳过坏卡、拿默认值接着跑」：
 * 一张错的卡会变成玩家第一屏看到的世界，而且看不出哪里错了。
 *
 * 将来能导入别的卡时，这里换成「选中的那一张」—— 现在只有一个消费者（开局），
 * 不做选择机制（决定 #42）。
 */
// import attribute 是 ESM 的规范写法：没有它，用原生 ESM 加载器直接加载这个模块的工具
// 会拒绝 .json（Playwright 的 TS 加载器就是这样报错的）；Vite 构建与 vue-tsc 两种写法都认
import cardJson from '../../cards/morningwind.json' with { type: 'json' }
import { validateCard, type CardData } from './card'

/** 当前卡（已通过校验）—— 用到卡的地方都从这里取 */
export const currentCard: CardData = validateCard(cardJson)
