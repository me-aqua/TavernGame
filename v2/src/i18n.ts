/**
 * 文案表：key -> 中文。**所有中文都住在 locales/zh-CN.json**，代码里只出现 key。
 *
 * 为什么单开一份而不是直接 import json：两个读者（`t()` 与错误默认文案）都从这儿拿同一份
 * 表，插值规则也只写一处。core/ 下的模块也用它 —— 所以这里**不许 import vue**。
 *
 * 缺 key 直接抛错（不是回落到 key 本身）：打错一个 key 会在第一次渲染时当场炸，
 * 而不是在界面上留一行 "home.emptyCard" 这种东西给人猜。
 */
import table from './locales/zh-CN.json'

const messages = table as Record<string, string>

/** `t('home.cardCount', { count: 3 })` -> 把 `{count}` 换成 3 */
export function t(key: string, vars: Record<string, string | number> = {}): string {
  const template = messages[key]
  if (template === undefined) throw new Error(`missing locale key: ${key}`)
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = vars[name]
    return value === undefined ? whole : String(value)
  })
}
