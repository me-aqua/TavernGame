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

// ⚠️ Node 22+ 有**原生 localStorage**（不给 --localstorage-file 时取值是 undefined，
//    直接用会抛 "Cannot read properties of undefined"）。vitest 的 node 环境沿用
//    这个坏掉的原生实现，所以必须用 defineProperty 覆盖掉它。
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

beforeEach(() => {
  存储.clear()
})
