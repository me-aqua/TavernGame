/**
 * src/composables/useEscapeHtml.ts —— HTML 转义
 *
 * ⚠️ 有了 Vue 的模板，这个函数其实已经**几乎用不到了**：
 * 模板里的 {{ 变量 }} 和 :title="变量" 都是自动转义的，
 * 这是 Vue 相比手写 innerHTML 的一个实打实的安全收益。
 *
 * 留着它只有一个用途：确实必须用 v-html 时（目前项目里没有）。
 * 所以默认不引入；真要用 v-html，先问一句「能不能不用」。
 */
const 映射表: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (c) => 映射表[c])
}
