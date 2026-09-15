/**
 * 卡 JSON 的字符串叶子 —— 「渲染不丢内容」那条判据的公共实现。
 *
 * 渲染器与校验器都只认结构、不认某一篇内容的形状，所以「有没有丢东西」也只能从结构上问：
 * 把 JSON 里每一个字符串都找出来，逐个对照产物。两份测试共用它，别各写一份。
 */

/** 一份 JSON 里全部字符串叶子（对象与数组逐层下探，数组里的字符串也算叶子） */
export function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value)
  else if (Array.isArray(value)) value.forEach((item) => stringLeaves(item, out))
  else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) stringLeaves(item, out)
  }
  return out
}
