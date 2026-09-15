/**
 * tools/render-card.mjs 的类型声明 —— 渲染器是 .mjs（npm run render:card 直接跑 node），
 * 而 tests/render-card.test.ts 要 import 它；TS 见到 .mjs 会去找同名的 .d.mts。
 */

/** 一张卡（已经是解析过的 JSON）→ 人读的 markdown 文本 */
export function renderCard(card: Record<string, unknown>, source: string): string

/** 命令行入口：argv = [卡.json?, 输出.md?] */
export function main(argv: string[]): void
