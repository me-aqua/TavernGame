/**
 * Test environment shims.
 *
 * game/GameState.ts uses localStorage, which Node does not have — a minimal
 * in-memory implementation stands in. Cleared before every test so cases
 * cannot leak state into each other.
 */
import { config } from '@vue/test-utils'
import { i18n } from '../src/i18n'

const storage = new Map<string, string>()

const localStorageShim: Storage = {
  /** 键的数量 */
  get length() {
    return storage.size
  },
  /** 清空全部 */
  clear: () => storage.clear(),
  /** 取值；没有这个键返回 null（与浏览器一致） */
  getItem: (k: string) => (storage.has(k) ? (storage.get(k) as string) : null),
  /** 按下标取键名 */
  key: (i: number) => [...storage.keys()][i] ?? null,
  /** 删键 */
  removeItem: (k: string) => void storage.delete(k),
  /** 写值；一律转成字符串（同浏览器） */
  setItem: (k: string, v: string) => void storage.set(k, String(v)),
}

// ⚠️ Node 22+ has a **native localStorage** (its value is undefined unless
//    --localstorage-file is given, so using it throws "Cannot read properties
//    of undefined"). Vitest's node environment inherits that broken native
//    implementation, so it must be overridden with defineProperty.
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
 * Every component calls useI18n(), so mounting without the plugin throws
 * "Need to install with app.use". Installing it once globally keeps that
 * boilerplate out of every test file.
 */
config.global.plugins = [i18n]

/*
 * Pin the locale for every test. The app starts at 'en' and useLanguage() applies
 * the real choice on mount, but tests evaluate core modules directly, so the
 * locale must be explicit or assertions would depend on the host machine.
 *
 * zh-CN is pinned because it is the reference language: English falls back to
 * printing the key name, which would let a missing key pass a "not Chinese" check.
 * Chinese literals in test files are checked by .githooks/checks/ascii.mjs.
 */
;(i18n.global.locale as unknown as { value: string }).value = 'zh-CN'

beforeEach(() => {
  storage.clear()
})
