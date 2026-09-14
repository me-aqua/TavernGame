/**
 * Vite 插件：把提示词变成 base64 虚拟模块。
 *
 * 真值来源：`prompts/<lang>/<name>.md`（手写、进仓库）。每个文件变成一个**虚拟模块**，
 * default 导出是它的 base64 内容 —— 不产生中间文件，所以没有「忘了重新生成」这种事。
 *
 * 为什么用 base64：提示词里有换行、引号、反引号、Markdown 围栏与非 ASCII 文本。
 * 把原始 Markdown 内联进 JS 字符串，一个野反引号就能截断字面量，而且换行全被转义、
 * 在产物里没法读。base64 彻底绕开转义。
 *
 * ⚠️ 是编码不是加密：base64 可逆，客户端字符串谁都拿得到。别往提示词里放真机密。
 *
 * ## 模块 id 约定
 *
 *   virtual:prompt/<lang>/<name>     例如 virtual:prompt/zh-CN/system
 *   virtual:prompt/<lang>/<name>.md  末尾的 ".md" 允许存在
 *
 * <lang> 段是**必需的**：它来自目录名，所以没有语言目录的提示词没有可寻址的 id
 * （扫描时告警）。
 *
 * ## HMR
 *
 * 改 .md 会触发整页刷新。为虚拟模块重写 importer 链要动 moduleGraph，很容易错得
 * 很微妙；整页刷新是瞬时的，而且不可能坏。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'

/** 虚拟模块命名空间 */
const NS = 'virtual:prompt/'
/** 标记位：让 Vite 不把这些 id 当成真实文件去解析 */
const RESOLVED_PREFIX = '\0' + NS

interface PromptEntry {
  /** 语言段，例如 "zh-CN" 或 "en" */
  lang: string
  /** 不带扩展名的文件名，例如 "system" */
  name: string
  file: string
}

/**
 * 递归收集 prompts/<lang>/<name>.md
 *
 *   prompts/zh-CN/system.md  ->  { lang: "zh-CN", name: "system" }
 *
 * 直接放在 prompts/ 下的 .md（只该有 README.md）跳过并告警：每个 id 都带语言段，
 * 它没有可寻址的 id。
 */
function collectPrompts(root: string): PromptEntry[] {
  const entries: PromptEntry[] = []
  const skipped: string[] = []

  /** 递归收集目录下的提示词（跳过 README，它没有语言段） */
  function walk(dir: string): void {
    for (const item of readdirSync(dir)) {
      const full = join(dir, item)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!item.endsWith('.md') || item === 'README.md') continue

      const rel = relative(root, full)
      const parts = rel.split(/[\\/]/)
      const name = parts.pop()!.replace(/\.md$/, '')
      const lang = parts[0]
      if (!lang) {
        skipped.push(rel)
        continue
      }
      entries.push({ lang, name, file: full })
    }
  }
  walk(root)

  if (skipped.length) {
    console.warn(
      '[prompts] skipped prompts without a language directory: ' +
        skipped.join(', ') +
        ' (they belong in prompts/<lang>/)',
    )
  }
  return entries
}

/** 把 prompts/<lang>/*.md 变成 virtual:prompt/<lang>/<name> 虚拟模块 */
export function promptsPlugin(): Plugin {
  let root = process.cwd()

  /** "lang/name" -> 磁盘文件 */
  const byKey = new Map<string, string>()
  /** 已知的语言目录，用于报错信息 */
  let locales: string[] = []

  /** 重新扫描提示词目录（启动时与文件变更时各一次） */
  function scan(): void {
    const entries = collectPrompts(join(root, 'prompts'))
    byKey.clear()
    for (const entry of entries) byKey.set(entry.lang + '/' + entry.name, entry.file)
    locales = [...new Set(entries.map((e) => e.lang))].sort()
  }

  /** 解析 "virtual:prompt/zh-CN/system[.md]"；lang 必须有 */
  function parseId(id: string): { lang?: string; name?: string } {
    const rest = id.slice(NS.length).replace(/\.md$/, '')
    const parts = rest.split('/')
    if (parts.length >= 2) return { lang: parts[0], name: parts[1] }
    return { name: parts[0] }
  }

  return {
    name: 'taverngame:prompts',

    /** 拿到真实 root 后扫描一次：提示词 id 依赖目录结构 */
    configResolved(config: ResolvedConfig) {
      root = config.root
      scan()
    },

    /** 校验模块 id：语言段必须有，且文件必须真实存在 */
    resolveId(id) {
      if (!id.startsWith(NS)) return null
      const { lang, name } = parseId(id)
      if (!lang || !name) {
        throw new Error(
          '[prompts] module id must include a language: ' +
            id +
            '. Correct form: virtual:prompt/zh-CN/system (known languages: ' +
            (locales.join(', ') || 'none found') +
            ')',
        )
      }
      const key = lang + '/' + name
      if (!byKey.has(key)) {
        throw new Error(
          '[prompts] no prompt named "' + key + '". Available: ' + [...byKey.keys()].sort().join(', '),
        )
      }
      return RESOLVED_PREFIX + key
    },

    /** 构建期把 Markdown 转成 base64 字符串随包发布（不产生中间文件） */
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null
      const key = id.slice(RESOLVED_PREFIX.length)
      const file = byKey.get(key)
      if (!file) throw new Error('[prompts] virtual module "' + key + '" has no backing file')

      const text = readFileSync(file, 'utf8')
      const b64 = Buffer.from(text, 'utf8').toString('base64')
      // JSON.stringify 负责转义；base64 里没有引号，这样拼是安全的
      return (
        'export default ' +
        JSON.stringify(b64) +
        `
`
      )
    },

    /** 开发时监听提示词目录，改 .md 立刻生效 */
    configureServer(server: ViteDevServer) {
      // 监听提示词目录，理由见文件头的 HMR 说明
      server.watcher.add(join(root, 'prompts'))
    },

    /** 提示词变了就整页刷新：它会被拼进 system 消息，缓存里那份必须作废 */
    handleHotUpdate({ file, server }) {
      if (!file.includes(root + '/prompts') || !file.endsWith('.md')) return
      scan()
      server.ws.send({ type: 'full-reload' })
      return []
    },
  }
}
