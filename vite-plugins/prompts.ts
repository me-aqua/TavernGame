/**
 * Vite plugin: prompts as base64 virtual modules.
 *
 * Source of truth: `prompts/<lang>/<name>.md` (hand-written, committed).
 * Each file becomes a **virtual module** whose default export is its base64
 * payload — no generated file ever touches the working tree, so there is
 * nothing to regenerate and nothing to forget to commit.
 *
 * Why base64: prompts contain newlines, quotes, backticks, Markdown fences and
 * non-ASCII text. Inlining raw Markdown into a JS string literal risks a stray
 * backtick truncating the literal, and leaves every newline escaped and
 * unreadable in the bundle. Base64 sidesteps escaping entirely.
 *
 * ⚠️ Encoding, not encryption: base64 is reversible and any client-side string
 *    is obtainable. Never put anything truly secret in a prompt.
 *
 * ## Module id convention
 *
 *   virtual:prompt/<lang>/<name>     e.g. virtual:prompt/zh-CN/system
 *                                    virtual:prompt/en/tools
 *   virtual:prompt/<lang>/<name>.md  a trailing ".md" is tolerated
 *
 * The <lang> segment is **required** — it comes from the directory name, so a
 * prompt with no language folder has no addressable id (warned about at scan).
 *
 * ## HMR
 *
 * Editing a .md triggers a full reload in dev. Rewriting the importer chain for
 * a virtual module needs moduleGraph surgery that is easy to get subtly wrong;
 * a full reload here is instant and impossible to break.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite'

/** Virtual module namespace */
const NS = 'virtual:prompt/'
/** Marker so Vite never tries to resolve these ids as real files */
const RESOLVED_PREFIX = '\0' + NS

interface PromptEntry {
  /** Language segment, e.g. "zh-CN" or "en" */
  lang: string
  /** File name without extension, e.g. "system" */
  name: string
  /** Absolute path on disk */
  file: string
}

/**
 * Recursively collect prompts/<lang>/<name>.md
 *
 *   prompts/zh-CN/system.md  ->  { lang: "zh-CN", name: "system" }
 *   prompts/en/tools.md      ->  { lang: "en",    name: "tools" }
 *
 * A .md directly under prompts/ (only README.md should be) is skipped with a
 * warning: it has no addressable id because every id carries a language.
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

  /** "lang/name" -> on-disk file */
  const byKey = new Map<string, string>()
  /** Known language folders, for error messages */
  let locales: string[] = []

  /** 重新扫描提示词目录（启动时与文件变更时各一次） */
  function scan(): void {
    const entries = collectPrompts(join(root, 'prompts'))
    byKey.clear()
    for (const entry of entries) byKey.set(entry.lang + '/' + entry.name, entry.file)
    locales = [...new Set(entries.map((e) => e.lang))].sort()
  }

  /** Parse "virtual:prompt/zh-CN/system[.md]"; lang is required */
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
      // JSON.stringify handles escaping; base64 contains no quotes, so this is safe
      return (
        'export default ' +
        JSON.stringify(b64) +
        `
`
      )
    },

    /** 开发时监听提示词目录，改 .md 立刻生效 */
    configureServer(server: ViteDevServer) {
      // Watch the prompts tree; see the HMR note in the file header
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
