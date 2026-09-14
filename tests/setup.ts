/**
 * 测试环境的浏览器 API 垫片。
 *
 * core/state.ts 要用 localStorage，Node 里没有 —— 用一个最小的内存实现顶上。
 * 每个测试文件开始前清空，避免测试之间互相影响。
 */
const 存储 = new Map<string, string>()

const localStorageShim: Storage = {
  get length() {
    return 存储.size
  },
  clear: () => 存储.clear(),
  getItem: (k: string) => (存储.has(k) ? (存储.get(k) as string) : null),
  key: (i: number) => [...存储.keys()][i] ?? null,
  removeItem: (k: string) => void 存储.delete(k),
  setItem: (k: string, v: string) => void 存储.set(k, String(v)),
}

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageShim,
  configurable: true,
  writable: true,
})

beforeEach(() => {
  存储.clear()
})
