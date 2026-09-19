/**
 * e2e 共用的测试数据与帮手。
 *
 * 三件事集中在这里，避免每个 spec 各写一份：
 *   · 种子数据：localStorage 必须在应用脚本之前写好（语言 / 主题 / 存档 / 配置）
 *   · 假模型：用 page.route 拦住 chat/completions —— 不注入脚本、不改全局 fetch；
 *     它**按节点回话**：时间节点先调 advance_time、地图节点先调 set_whereabouts，其余回文字
 *   · 取词：检查界面文案时走应用自己的 i18n 表（window.__dshE2E），不抄第二份
 *
 * ⚠️ 不 import 应用模块（那条链会拖进 i18n 的 .json，Playwright 的 ESM 加载器要
 *    import attribute）：卡只读 JSON，状态树按卡的 state 自己实例化一份最小的。
 */
import { expect, type Page } from '@playwright/test'
import cardJson from '../cards/morningwind.json' with { type: 'json' }

export const APP_PATH = '/TavernGame/'

/** 键名与产品代码保持一致；写错了这里会当场变红（读不到东西） */
export const LANG_KEY = 'tavernGame.lang'
export const THEME_KEY = 'tavernGame.theme'
export const SAVE_KEY = 'tavernGame.save'
export const CONFIG_KEY = 'tavernGame.config'
export const DEBUG_KEY = 'tavernGame.debug'
/** 活动卡（值就是卡的 JSON 文本）：坏卡要能造出来，所以键名在这里也留一份 */
export const CARD_KEY = 'tavernGame.card'

/** 卡（唯一事实来源）与它的图；节点 id 全部从卡里现读，不写死节点名 */
const CARD = cardJson as unknown as Record<string, any>
const GRAPH = CARD.graph as { topology: string[]; nodes: Record<string, Record<string, any>> }
const TOPOLOGY = GRAPH.topology
const NODES = GRAPH.nodes

/** 本回合的叙事取自声明了 role: story 的那个节点 —— 引擎也只认这条声明 */
export const STORY_NODE = TOPOLOGY.find((id) => NODES[id].role === 'story') as string

/** 声明了某个动作的节点：工具白名单写在卡的 graph.nodes[id].tools 里 */
function nodeWithAction(action: string): string {
  return TOPOLOGY.find((id) => (NODES[id].tools ?? []).includes(action)) as string
}

/** 时间节点（调 advance_time）—— 冒烟用例拿它断言「标红的是哪一个」 */
export const TIME_NODE = nodeWithAction('advance_time')

/**
 * 地图节点 —— R20 之后**移动由 `set_whereabouts` 承担**（`move_to` 与 `world.location` 都没了）。
 */
const MAP_NODE = nodeWithAction('set_whereabouts')

/** 主控在 `whoIsWhere` 那本册子上的键 —— 从卡的初值现读（`lead.name`），不在这里抄一份 */
export const LEAD_NAME: string = CARD.state.lead.fields.name.initial

/**
 * R20：**主控的位置在 `world.whoIsWhere` 里**（不再是独立的一枝 `world.location`），
 * 移动由地图节点的 `set_whereabouts` 写进去。
 *
 * 每一条都是 `{area, spot, scene}` 三栏（R20 ③："scene 对所有人都有"）—— 卡里
 * `whoIsWhere.of` 的形状就是它；**键是主控的名字**（R20 ②）。
 */
export const LEAD_PLACE = { area: '晨风镇', spot: '酒馆', scene: '大堂' }

/** 地图节点这一轮把主控记到哪儿（假模型让地图节点调 `set_whereabouts` 写的那一条） */
export const MOVED_PLACE = { area: '晨风镇', spot: '萨伦铁匠铺', scene: '铺面' }

/**
 * 假模型的行为：
 *   narration = 按「这次是哪个节点」分别回话：时间节点第一次回一条 advance_time 的
 *               tool_calls（引擎执行完会再问一次），第二次才回文字；地图节点第一次回
 *               set_whereabouts；故事节点回正文；其余节点回一段普通文字
 *   slow      = 第一次调用拖 5 秒（看得见「正在生成开场…」）；error = 上游 500
 *   toolError = 时间节点的第一个参数故意给个负数：引擎不抛错，把结构化错误回传给模型
 *               （于是这一轮里有一个「工具调用失败过」的节点，调试图上要标红）
 *
 * ⚠️ 引擎按卡里的图跑，而且**不解析模型输出**：要引擎做的事只能来自原生工具调用
 *    （决定 #46）。所以假模型必须按协议回 tool_calls —— 回一段「JSON 代码块」没用。
 */
export type FakeMode = 'narration' | 'slow' | 'error' | 'toolError'

export const NARRATION = '灯芯爆了一下，屋里静了半息。'
const SLOW_MS = 5000
/** 每次假回复的耗时：一轮十来个节点，太长会把冒烟用例拖到超时 */
const REPLY_MS = 200
const TIME_REASON = '聊到深夜'
/** 这一轮推进的分钟数（卡的历法里的一分钟） */
const TIME_MINUTES = 5
/** toolError 模式给的那个参数：负数过不了引擎的校验（引擎只回传错误，不抛） */
const BAD_MINUTES = -3

/** 这次请求是哪个节点发出来的：看最后一条 user 消息里最后出现的那个节点显示名 */
function nodeOf(messages: Array<{ role?: string; content?: string }>): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  let found = ''
  let at = -1
  for (const id of TOPOLOGY) {
    const index = last.lastIndexOf('## ' + NODES[id].name)
    if (index > at) {
      at = index
      found = id
    }
  }
  return found
}

/** 每个节点被问过几次（时间 / 地图节点第一次要求调工具、第二次才回文字） */
type AskedCounts = Map<string, number>

/** 一条「只调工具、不写字」的回复（协议原样：content 空 + tool_calls） */
function toolCall(id: string, name: string, args: Record<string, unknown>): Record<string, unknown> {
  return {
    role: 'assistant',
    content: '',
    tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
  }
}

/**
 * 该节点的假回复（协议消息）。
 *
 * ⚠️ 时间与地图节点：第一次 content 为空、只回 tool_calls（「只调工具没写字」是合法的
 *    一步），引擎执行完再问一次，那次才回文字。
 */
function messageOf(id: string, asked: AskedCounts, mode: FakeMode): Record<string, unknown> {
  const count = (asked.get(id) ?? 0) + 1
  asked.set(id, count)

  if (id === TIME_NODE && count === 1) {
    const minutes = mode === 'toolError' ? BAD_MINUTES : TIME_MINUTES
    return toolCall('call-time', 'advance_time', { minutes, reason: TIME_REASON })
  }
  if (id === MAP_NODE && count === 1) {
    return toolCall('call-map', 'set_whereabouts', { who: LEAD_NAME, ...MOVED_PLACE })
  }
  if (id === STORY_NODE) return { role: 'assistant', content: NARRATION }
  return { role: 'assistant', content: id + ' node output' }
}

/** 产品里配置项的形状（服务商/模型是假的，请求由 page.route 拦住） */
export const CONFIG = JSON.stringify({
  provider: 'custom',
  apiKey: 'sk-demo',
  apiBase: 'https://example.test/v1',
  model: 'demo-model',
  temperature: 0.85,
})

/** 一条事件（时间戳固定，截图才有可比性） */
export function event(kind: string, text: string, detail?: string): Record<string, unknown> {
  return { kind, text, ...(detail ? { detail } : {}), at: '2026-09-14T10:00:00.000Z' }
}

/**
 * 一行写入痕迹：写成的值存的是**结构化真值**（`value`），不是一份 JSON 文本 ——
 * 给人看的展开体由界面从 value 现写（stores/game.ts 的 detailOf）。
 */
export function writeEvent(text: string, value: unknown): Record<string, unknown> {
  return { kind: 'stateChange', text, value, at: '2026-09-14T10:00:00.000Z' }
}

/**
 * 按卡的 state 建一棵初始状态树：只取写了 initial 的字段（与引擎同一套规则）。
 *
 * e2e 不 import 应用模块（见文件头），所以这十来行在这里重写一份 —— 它只认「initial」
 * 这个键，不认任何一张卡的内容。
 */
function instantiate(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return undefined
  const node = schema as { initial?: unknown; fields?: Record<string, unknown> }
  if (Object.hasOwn(node, 'initial')) return JSON.parse(JSON.stringify(node.initial))
  const fields = node.fields ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, sub] of Object.entries(fields)) {
    const value = instantiate(sub)
    if (value !== undefined) out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

/** 新游戏的第一帧（与引擎的 createInitialState 同一份形状：meta / time / state / …） */
function initialState(): Record<string, unknown> {
  const state: Record<string, unknown> = {}
  for (const [branch, schema] of Object.entries(CARD.state as Record<string, unknown>)) {
    const value = instantiate(schema)
    if (value !== undefined) state[branch] = value
  }
  return {
    meta: { turn: 0, card: identity() },
    time: { ...CARD.time.initial },
    state,
    events: [],
    timeline: [],
  }
}

/** 存档里记的卡身份 —— spec 覆盖 meta（例如把回合数调大）时必须带上它，不然存档会被判成别人的 */
export const CARD_IDENTITY: Record<string, string> = identity()

/** 存档里记的卡身份（判亲只比 id / version / format） */
function identity(): Record<string, string> {
  return {
    id: CARD.card.id,
    name: CARD.card.name,
    version: CARD.card.version,
    format: CARD.card.format,
  }
}

/** 一份存档：卡身份 + 卡的状态初值 + 几段故事 + 时间线 */
export function saveWith(over: Record<string, unknown> = {}): string {
  const data = initialState()
  const state = data.state as Record<string, any>
  // 主控站在镇上的酒馆里 —— R20：位置记在 whoIsWhere 那本册子的**主控那一条**上
  // （面板的「当前所在」与顶栏那条「场景」都该读它；今天它们还读着已删的 world.location）
  state.world.whoIsWhere = { ...state.world.whoIsWhere, [LEAD_NAME]: { ...LEAD_PLACE } }
  return JSON.stringify({
    ...data,
    meta: { turn: 6, card: identity() },
    time: { year: 2026, month: 9, day: 15, hour: 9, minute: 0 },
    events: [
      event('action', '我推开酒馆的门，看看里面都有谁。'),
      event('narration', '门轴发出一声长叹。暖黄的光从屋里涌出来，混着麦酒和湿羊毛的味道。'),
    ],
    timeline: [
      {
        from: '2026 年 9 月 14 日 · 星期一 · 晚上',
        to: '2026 年 9 月 15 日 · 星期二 · 上午',
        reason: '在酒馆待到深夜，睡了一觉',
        minutes: 810,
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
  let calls = 0
  /** 每个节点问过几次：时间 / 地图节点的工具往返靠它区分第一次与第二次 */
  const asked: AskedCounts = new Map()
  await page.route('**/chat/completions', async (route) => {
    if (mode === 'error') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'mock upstream failure' } }),
      })
      return
    }
    // 一轮里每个节点各调一次（工具往返多一次）：只有第一次拖时间（否则十几次叠起来会拖垮超时）
    const first = calls === 0
    calls += 1
    if (mode === 'slow' && first) await new Promise((resolve) => setTimeout(resolve, SLOW_MS))
    else await new Promise((resolve) => setTimeout(resolve, REPLY_MS))

    const body = route.request().postDataJSON() as {
      messages?: Array<{ role?: string; content?: string }>
    } | null
    const message = messageOf(nodeOf(body?.messages ?? []), asked, mode)

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
    card?: string | null
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
    // 不传 = 没存过卡（内置示例）—— 与产品行为一致，所以默认是 null
    [CARD_KEY]: options.card ?? null,
  })
  await page.goto(APP_PATH)
  await expect(page.locator('#app > *')).toHaveCount(1)
}
