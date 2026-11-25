/**
 * 模块边界判据（CONTRACT §1 / §9.3）。
 *
 * 这一层量的是「代码长在哪、往哪看」：
 *   · 核心模块（storage / errors / prompt / engine / schema）必须以 `.ts` 存在 —— 单测的入口就是它们；
 *   · `core/**` 不许 import Vue、不许碰 DOM（引擎要在 node 里跑）；
 *   · 全项目不许 import 旧站（`../../src/`、`@/`）、不许 import react / svelte、不许引入 vue-router / pinia；
 *   · 中文文案必须住在 `.json` 里（ascii 钩子查 `.ts/.vue/.js/.html/.css`，`.json` 是唯一干净的落点）。
 *
 * ⚠️ 「一个文件都没扫到」不是通过：`files.length === 0` 时先在这里红。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadModule } from './support/load.js'

/** `v2/src` 的绝对路径（本文件在 `v2/tests/`） */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

/** 递归列源文件（`.json` 也算：文案表要在这里被点名）；目录不存在直接给出契约级的人话 */
function sourceFiles() {
  let entries
  try {
    entries = readdirSync(SRC, { recursive: true })
  } catch (cause) {
    throw new Error('v2/src 不存在 —— 阶段 1 的实现一个文件都还没写（CONTRACT §1）', { cause })
  }
  return entries
    .map((entry) => String(entry).replaceAll('\\', '/'))
    .filter((entry) => /\.(ts|vue|mjs|html|css|json)$/.test(entry))
    .sort()
}

function readSource(relative) {
  return readFileSync(join(SRC, relative), 'utf8')
}

/** 在若干文件里找「匹配这些正则」的地方，返回人话清单（空数组 = 干净） */
function offendersIn(files, patterns) {
  const offenders = []
  for (const file of files) {
    const source = readSource(file)
    for (const pattern of patterns) {
      if (pattern.test(source)) offenders.push(`${file} 匹配 ${pattern}`)
    }
  }
  return offenders
}

describe('模块边界：核心模块在不在', () => {
  it('入口 + 路由 + 六个 core 模块 + 文案表都在', async () => {
    const files = sourceFiles()
    expect(files.length, 'v2/src 下一个源文件都没有 —— 这一层什么也没验').toBeGreaterThan(0)
    for (const required of [
      'main.ts',
      'router.ts',
      'core/storage.ts',
      'core/errors.ts',
      'core/prompt.ts',
      'core/engine.ts',
      'core/schema.ts',
      'locales/zh-CN.json',
    ]) {
      expect(files, `缺 ${required}（CONTRACT §1）`).toContain(required)
    }
  })
})

describe('模块边界：core 层不碰界面（node 里能单测）', () => {
  it('core/** 不 import Vue、不引用 document / window / localStorage 全局', () => {
    const core = sourceFiles().filter((file) => file.startsWith('core/'))
    expect(core.length, 'core/ 下一个文件都没有').toBeGreaterThan(0)
    expect(
      offendersIn(core, [
        /from\s+['"]vue['"]/,
        /from\s+['"]vue\//,
        /\bdocument\./,
        /\bwindow\./,
        /globalThis\.localStorage/,
      ]),
    ).toEqual([])
  })

  it('五个核心模块都能在 node 里 import（没有依赖 DOM 的副作用）', async () => {
    await loadModule('core/storage.ts', () => import('../src/core/storage.ts'))
    await loadModule('core/errors.ts', () => import('../src/core/errors.ts'))
    await loadModule('core/prompt.ts', () => import('../src/core/prompt.ts'))
    await loadModule('core/engine.ts', () => import('../src/core/engine.ts'))
    await loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
  })
})

describe('模块边界：不往旧站和别的框架里看', () => {
  it('全项目不 import 旧站 / react / svelte / vue-router / pinia', () => {
    expect(
      offendersIn(sourceFiles(), [
        /from\s+['"]react/,
        /from\s+['"]svelte/,
        /from\s+['"]@sveltejs\//,
        /from\s+['"]vue-router['"]/,
        /from\s+['"]pinia['"]/,
        /from\s+['"]\.\.\/\.\.\/src\//,
        /from\s+['"]@\//,
      ]),
    ).toEqual([])
  })

  it('示例卡是**资产**：只能住在 `data/`，而且只由入口引入（别处不许搬一份内容）', () => {
    const files = sourceFiles()
    const assets = files.filter((file) => file.startsWith('data/'))
    expect(assets.length, '`src/data/` 下应当有示例卡资产（晨风镇）').toBeGreaterThan(0)
    // 引用面收窄：只有入口（main.ts）可以 import data/ 下的资产
    const importers = files.filter((file) => /from\s+['"]\.\/data\//.test(readSource(file)))
    expect(importers, '示例卡只该由 main.ts 引入').toEqual(['main.ts'])
    // 也不许伸手去拿旧站根目录的 cards/（那是另一个应用的数据）
    expect(offendersIn(files, [/from\s+['"][^'"]*\/cards\//, /from\s+['"]\.\.\/\.\.\/cards\//])).toEqual([])
  })

  it('示例卡本身是合法数据：链是那三个固定节点，卡里没有 presetId（模型不进卡）', () => {
    const sample = JSON.parse(readFileSync(join(SRC, 'data', 'morningwind.json'), 'utf8'))
    expect(sample.schemaVersion).toBe(1)
    expect(typeof sample.id).toBe('string')
    expect(sample.name.length, '示例卡要有名字').toBeGreaterThan(0)
    expect(sample.state.length, '示例卡要有状态元素').toBeGreaterThan(1)
    expect(sample.state[0].code).toBe('0')
    expect(sample.chain.map((node) => node.id)).toEqual(['time', 'check', 'output'])
    expect(sample.chain.filter((node) => node.type === 'output')).toHaveLength(1)
    // 旧格式的一丝痕迹都不许有：没有校对节点、上游是数组不是布尔
    expect(sample.chain.some((node) => node.type === 'proof')).toBe(false)
    for (const node of sample.chain) {
      expect(Array.isArray(node.readsUpstream), `${node.id} 的上游不是数组`).toBe(true)
      expect(Object.keys(node), `${node.id} 不该带模型绑定`).not.toContain('presetId')
    }
    // 每张卡都带「开场」那一块（§2.1：缺它就是不合法的卡）
    expect(sample.prompts.some((prompt) => prompt.id === 'opening')).toBe(true)
  })

  it('示例卡过得了 validateCard（种子路径靠它 —— 不合法的卡不许被种进玩家的存储）', async () => {
    const { validateCard } = await loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
    const sample = JSON.parse(readFileSync(join(SRC, 'data', 'morningwind.json'), 'utf8'))
    expect(() => validateCard(sample)).not.toThrow()
  })
})

describe('模块边界：中文文案住在 json 里', () => {
  it('locales/zh-CN.json 能解析、至少一条、值是字符串', async () => {
    const files = sourceFiles()
    expect(files, '缺 locales/zh-CN.json（CONTRACT §9.3）').toContain('locales/zh-CN.json')
    const table = JSON.parse(readFileSync(join(SRC, 'locales', 'zh-CN.json'), 'utf8'))
    const entries = Object.entries(table)
    expect(entries.length, '文案表是空的 —— 界面上每一句中文都得在这').toBeGreaterThan(0)
    for (const [key, value] of entries) {
      expect(typeof value, `${key} 的值不是字符串`).toBe('string')
      expect(value.length, `${key} 是空串`).toBeGreaterThan(0)
    }
  })
})
