/**
 * 让 `vue-tsc` 认得 `*.vue` 模块（没有它，每个 import 进来的单文件组件都是 any）。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
