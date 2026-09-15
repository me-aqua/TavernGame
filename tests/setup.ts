/**
 * 测试环境垫片。
 *
 * store 与 utils/storage.ts 都用 localStorage，Node 没有 —— 这里放一个最小的内存
 * 实现顶上，每个用例前清空，避免用例之间串状态。
 */
import { config } from '@vue/test-utils'
import { i18n } from '../src/i18n'

const storage = new Map<string, string>()

const localStorageShim: Storage = {
  get length() {
    return storage.size
  },
  clear: () => storage.clear(),
  getItem: (k: string) => (storage.has(k) ? (storage.get(k) as string) : null),
  key: (i: number) => [...storage.keys()][i] ?? null,
  removeItem: (k: string) => void storage.delete(k),
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
}

// ⚠️ Node 22+ 有**原生 localStorage**（不给 --localstorage-file 时它的值是 undefined，
//    一用就抛 "Cannot read properties of undefined"）。Vitest 的 node 环境会继承这个
//    坏掉的实现，所以必须用 defineProperty 覆盖掉。
try {
  localStorage.setItem('__probe', '1')
  localStorage.removeItem('__probe')
} catch {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageShim,
    configurable: true,
    writable: true,
  })
}

/*
 * 每个组件都会调 useI18n()，不装插件直接挂载会抛 "Need to install with app.use"。
 * 全局装一次，省掉每个测试文件里的样板。
 */
config.global.plugins = [i18n]

/*
 * 把每个测试的 locale 钉死。应用从 'en' 启动、真实选择由 useLanguage() 在挂载时应用，
 * 而测试直接求值核心模块，所以 locale 必须显式设置，否则断言会取决于跑测试的机器。
 *
 * 钉在 zh-CN 是因为它是参考语言：英文会退化成打印 key 名，那样「缺 key」也能通过
 * 「不是中文」这类检查。测试文件里的中文字面量由 .githooks/checks/ascii.mjs 检查。
 */
;(i18n.global.locale as unknown as { value: string }).value = 'zh-CN'

beforeEach(() => {
  storage.clear()
  // ⚠️ jsdom 环境里探针会用上**它自己的** localStorage（上面那份垫片只在 Node 的原生
  //    localStorage 坏掉时才顶上来），于是只清垫片等于清了个寂寞 —— 用例之间照样串。
  //    两个都清：哪个在用都干净。
  localStorage.clear()
  // ⚠️ 每个用例都把语言重置回参考语言：模型提示词现在按 locale 选（模型语言跟随界面
  //    语言），一个用例切到 'en' 不还原，后面所有用例都会拿到英文提示词而失败。
  ;(i18n.global.locale as unknown as { value: string }).value = 'zh-CN'
})
