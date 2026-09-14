/**
 * e2e 共用的夹具。
 *
 * 三件事集中在这里，避免每个 spec 各写一份：
 *   · 种子数据：localStorage 必须在应用脚本之前写好（语言 / 主题 / 存档 / 配置）
 *   · 假模型：用 page.route 拦住 chat/completions —— 不注入脚本、不改全局 fetch
 *   · 取词：断言用的界面文案走应用自己的 i18n 表（window.__dshE2E），不抄第二份
 */
import { expect, type Page } from '@playwright/test'

export const APP_PATH = '/TavernGame/'

/** 键名与产品代码保持一致；写错了这里会当场变红（读不到东西） */
export const LANG_KEY = 'tavernGame.lang'
export const THEME_KEY = 'tavernGame.theme'
export const SAVE_KEY = 'tavernGame.save'
export const CONFIG_KEY = 'tavernGame.config'
export const DEBUG_KEY = 'tavernGame.debug'

/**
 * 假模型的行为：
 *   narration = 直接写叙事；slow = 拖 5 秒（看得见「正在生成」）
 *   error = 上游 500；tools = 先调一次工具再写叙事
 */
export type FakeMode = 'narration' | 'slow' | 'error' | 'tools'

export const NARRATION = '灯芯爆了一下，屋里静了半息。'
const SLOW_MS = 5000
const REPLY_MS = 300
const TOOL_REASON = '聊到深夜'

/** 产品里配置项的形状（服务商/模型是假的，请求由 page.route 拦住） */
export const CONFIG = JSON.stringify({
  provider: 'custom',
  apiKey: 'sk-demo',
  apiBase: 'https://example.test/v1',
  model: 'demo-model',
  temperature: 0.85,
  maxAgentSteps: 5,
})

/** 一条事件（时间戳固定，截图才有可比性） */
export function event(kind: string, text: string, detail?: string): Record<string, unknown> {
  return { kind, text, ...(detail ? { detail } : {}), at: '2026-09-14T10:00:00.000Z' }
}

/** 一份存档：几段故事 + 时间线 */
export function saveWith(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    meta: { turn: 6 },
    player: { name: '无名者' },
    scene: { name: '晨风镇 · 酒馆', description: '炉火把墙面照成蜜色，海风从门缝里钻进来。' },
    time: { iso: '2026-09-15T09:00:00.000Z' },
    events: [
      event('action', '我推开酒馆的门，看看里面都有谁。'),
      event('narration', '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒和湿羊毛的味道。'),
    ],
    timeline: [
      {
        from: '9 月 13 日 · 晚上',
        to: '9 月 14 日 · 上午',
        reason: '在酒馆待到深夜，睡了一觉',
        elapsedMs: 43200000,
        at: '2026-09-14T02:00:00.000Z',
      },
    ],
    ...over,
  })
}

/** 在应用脚本之前写好 localStorage；值传 null 表示删掉这个键 */
export async function seedStorage(page: Page, values: Record<string, string | null>): Promise<void> {
  await page.addInitScript((entries: Array<[string, string | null]>) => {
    for (const [key, value] of entries) {
      if (value === null) localStorage.removeItem(key)
      else localStorage.setItem(key, value)
    }
  }, Object.entries(values))
}

/** 拦住模型的 HTTP 调用，返回可控的假回复 */
export async function fakeLlm(page: Page, mode: FakeMode = 'narration'): Promise<void> {
  await page.route('**/chat/completions', async (route) => {
    if (mode === 'error') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'mock upstream failure' } }),
      })
      return
    }
    if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
    else await new Promise((resolve) => setTimeout(resolve, REPLY_MS))

    const body = route.request().postDataJSON() as { messages?: Array<{ role?: string }> } | null
    const sawTool = (body?.messages ?? []).some((m) => m.role === 'tool')
    const wantsTool = mode === 'tools' && !sawTool
    const message = wantsTool
      ? {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'advance_time',
                arguments: JSON.stringify({ step: 1, unit: 'day', reason: TOOL_REASON }),
              },
            },
          ],
        }
      : { role: 'assistant', content: NARRATION }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message }] }),
    })
  })
}

/** 通过应用自己的 i18n 表取词（表在 window.__dshE2E 上，main.ts 暴露的） */
export function translate(page: Page, key: string, named: Record<string, unknown> = {}) {
  return page.evaluate(
    ({ key, named }) => {
      const api = (
        window as unknown as {
          __dshE2E?: { i18n: { global: { t: (k: string, n?: Record<string, unknown>) => string } } }
        }
      ).__dshE2E
      if (!api) throw new Error('window.__dshE2E is missing - the app did not mount')
      return api.i18n.global.t(key, named)
    },
    { key, named },
  )
}

/** 收集页面异常与 4xx/5xx；两个都必须为零才算通过 */
export function watchErrors(page: Page): { runtimeErrors: string[]; badResponses: string[] } {
  const runtimeErrors: string[] = []
  const badResponses: string[] = []
  page.on('pageerror', (err) => runtimeErrors.push(err.message.slice(0, 160)))
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().includes('favicon')) {
      badResponses.push(`${res.status()} ${res.url()}`)
    }
  })
  return { runtimeErrors, badResponses }
}

/** 打开应用并等它挂载（可选：种子数据、假模型、点开设置面板） */
export async function openApp(
  page: Page,
  options: {
    lang?: string
    theme?: string
    debug?: string
    save?: string | null
    config?: string | null
    fake?: FakeMode
  } = {},
): Promise<void> {
  if (options.fake) await fakeLlm(page, options.fake)
  await seedStorage(page, {
    [LANG_KEY]: options.lang ?? 'zh-CN',
    [THEME_KEY]: options.theme ?? null,
    [DEBUG_KEY]: options.debug ?? null,
    [SAVE_KEY]: options.save ?? null,
    [CONFIG_KEY]: options.config ?? null,
  })
  await page.goto(APP_PATH)
  await expect(page.locator('#app > *')).toHaveCount(1)
}
