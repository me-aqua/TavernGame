/// <reference types="vite/client" />

/** 调试开关：在浏览器控制台执行 __DEBUG = true 打开（见 composables/useTurn.ts） */
interface Window {
  __DEBUG?: boolean
}

/**
 * 提示词虚拟模块（由 vite-plugins/prompts.ts 提供）。
 * 默认导出是**纯 base64 字符串**；语言段来自 prompts/<lang>/ 目录名。
 * 声明成宽泛的 `string` 是有意的：模块 id 由提示词文件名决定，
 * 逐个列举会在每次加提示词时都要改这里。
 */
declare module 'virtual:prompt/*' {
  const base64: string
  export default base64
}
