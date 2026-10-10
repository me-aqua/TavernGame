/**
 * B16 第 8 条 · **撞上上下文上限时，报出来的那句话**（S2 判据 · 文末那两条「别的限额」的负控是第 4 关打回后补的）。
 *
 * 票面：`.team/leader/todo.md` 的 B16 #8 + 组长 S1。
 *   **做**：在 `src/agent/llm.ts` 的非 2xx 分支里，把服务商说的「输入太长 / 超上下文」那一族**认出来**，
 *          换成一句人话（说清"开局以来的故事全都在发、已经超过模型能吃的长度"＋长期出路是压缩）。
 *   **不做**：输入预估 · 阈值 · 截断（编一个数要么天天误报，要么挡住正常的长故事）。
 *   为什么标在非 2xx 分支：**只有那里手里有服务商的原话**（权威信号），不是我们猜的数字。
 *
 * 验收口径 = **静态断言那一层**：夹具造响应、跑 `chat()`、看报出来的那句话。**不发真网络请求。**
 * 本票**没有 GUI 那一格**（它不产生界面变化，只是那句话本身）。
 *
 * 三层判据（下面的用例名逐条对上）：
 *   ① 正控 3 条 —— 三种形态都要认出来：`error.message` 里有原话 / `message` 空而原话只在正文里 /
 *      **413 那一族**（🔴 状态码只当粗筛，判据是**服务商的原话** —— 组长 2026-10-10 裁决）
 *   ② 文案守卫 1 条 —— 那句人话在两个 locale 里都在，而且**说到点上**（太长 ＋ 出路）
 *   ③ 负控 8 条 —— 别的形态一律照旧走 `t('llm.httpError')`（普通 4xx / 5xx / 另一理由的 400 /
 *      空 detail / HTML 网关页 / **413 但正文说的是另一件事** / **429 说速率配额** / **402 说消费额度**）
 *
 * ⚠️ 两条护栏判据（`tests/prompts.test.ts` 的"400 条故事全都要发"、`tests/save.test.ts` 的"读档一条不丢"）
 *    **一个字都没动** —— 它们证明这一票没有顺手给历史加窗口。
 *
 * ⚠️ **代码字面量**里的中文一律走 `\uXXXX`：`ascii.mjs` 先剥注释再查（注释里的中文放行，
 *    代码里的中文字面量才是它要抓的），而判据要断的正是中文文案里有没有那层意思。
 */
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chat } from '../src/agent/llm'
import { clearConfig, saveConfig } from '../src/agent/config'
import { i18n, t } from '../src/i18n'
import { installFakeLlmError } from './support/fakeLlm'
import type { ChatMessage } from '../src/types/state'

/** 那句人话的键名：判据与实现之间的契约（条文本票落在 `.team/test/2026-10-10/`） */
const PLAIN_KEY = 'llm.tooLong'

/** locale 表所在目录（`src/locales/` 是代码里唯一允许中文常住的地方） */
const LOCALE_DIR = 'src/locales'

/** 两份 locale 都要有那句话：只加一份的话英文界面会退化成打印键名 */
const LOCALES = ['zh-CN', 'en'] as const

/** 假响应固定带这个 statusText（`installFakeLlmError` 给的），期望文案里要用 */
const STATUS_TEXT = 'Error'

const MESSAGES: ChatMessage[] = [{ role: 'user', content: 'hello' }]

/**
 * 那句话必须说到的两层意思，按 locale 分家。
 *
 * 判的是**词族**不是整句：实现换措辞不该假红，但"没说到点上"必须红。
 * 中文一律用 `\uXXXX` 转义写（码点由 `.team/test/2026-10-10/make-escapes.mjs` 产出并回读校验过）。
 */
const TOO_LONG_WORDS: Record<string, RegExp> = {
  'zh-CN': /\u592a\u957f|\u8d85\u957f|\u8fc7\u957f|\u8d85\u8fc7[^\u3002\uff01\uff1f\n]{0,12}\u957f\u5ea6/,
  en: /too long|longer than|over the limit|exceeds? the|maximum context/i,
}

/** 长期出路那一层意思（压缩 / 摘要一族） */
const WAY_OUT_WORDS: Record<string, RegExp> = {
  'zh-CN': /\u538b\u7f29|\u6458\u8981|\u603b\u7ed3|\u7f29\u77ed|\u7cbe\u7b80/,
  en: /compress|summar|shorten|condense/i,
}

/**
 * 样例句：**不是**实现必须说的话，只用来证明上面两族词**能被一句话满足**。
 *
 * 为什么必须有它：起点红的判据分不清「有牙」与「写死了不可能绿」——
 * 拿一句合情合理的话跑一遍词族，才证明它真的能转绿。措辞照外聘报告 §3.1 的提议。
 */
const SPECIMEN_ZH =
  '\u5f00\u5c40\u4ee5\u6765\u7684\u6545\u4e8b\u5168\u90fd\u5728\u53d1\u7ed9\u6a21\u578b\uff0c\u73b0\u5728\u5df2\u7ecf\u8d85\u8fc7\u6a21\u578b\u80fd\u5403\u4e0b\u7684\u957f\u5ea6\uff1b\u957f\u671f\u7684\u529e\u6cd5\u662f\u538b\u7f29\u6210\u6458\u8981\u3002'

/** 同一句样例句的英文面（英文面本来就是 ASCII，不必转义） */
const SPECIMEN_EN =
  'The story since the beginning is sent in full and is now longer than this model can take in. The long term fix is to compress it into a summary.'

/** 正控 A 的服务商原话：上限写在 `error.message` 里（OpenAI 那一族的措辞） */
const LIMIT_MESSAGE =
  "This model's maximum context length is 65536 tokens. However, your messages resulted in 81234 tokens."

/** 正控 A 的响应体：`error.message` 有原话，`code` 也点了名 */
const LIMIT_IN_MESSAGE = JSON.stringify({
  error: { message: LIMIT_MESSAGE, type: 'invalid_request_error', code: 'context_length_exceeded' },
})

/**
 * 正控 B 的响应体：`error.message` **是空的**，原话只在正文里，而且**排在 300 字符之后**。
 *
 * 为什么非排在 300 之后：兜底只留响应体前 300 字符（`llm.ts:206`）⇒
 * 只读兜底那一段的判定**永远标不出这一条**。尺寸由下面的自检用例作证。
 * 前面的填充是网关真会给的东西（请求号 + 上游重试记录），不含任何长度词。
 */
const LIMIT_DEEP_IN_BODY = JSON.stringify({
  error: {
    message: '',
    type: 'invalid_request_error',
    request_id: 'req_0123456789abcdef0123456789abcdef',
    upstream_attempts: [
      'gw-eu-west-1 upstream returned 503 after 812ms',
      'gw-eu-west-2 upstream returned 503 after 903ms',
      'gw-eu-west-3 upstream returned 503 after 744ms',
      'gw-us-east-1 upstream returned 503 after 1180ms',
      'gw-us-east-2 upstream returned 503 after 1096ms',
      'gw-ap-south-1 upstream returned 503 after 1320ms',
      'gw-ap-south-2 upstream returned 503 after 1275ms',
      'gw-sa-east-1 upstream returned 503 after 1408ms',
    ],
    diagnostics: {
      summary: "This model's maximum context length is 65536 tokens, however you requested 81234 tokens.",
    },
  },
})

/** 任何"长度那一族"的词：自检用它证明正控 B 的填充里一个都没有 */
const ANY_LENGTH_WORD = /context|token|length|maximum|too long|exceed|limit/i

/** 正控 C 的服务商原话：413 那一族也会说同一堵墙 */
const LIMIT_413_MESSAGE = "Request entity too large: the prompt is past this model's maximum context length."

/**
 * 正控 C 的响应体：**413** ＋ 正文明说超上下文 —— 这一格**要认**（组长 2026-10-10 裁决）。
 *
 * 裁定的口径：**判定只看服务商的原话**，状态码只当粗筛、**不当判据** ⇒
 * "太长"那一族挂在 4xx 的哪一个上都认。它与负控那条「413 但正文说的是另一件事」合起来
 * 正好钉住这个口子：**说的才认，没说的不许认**。
 */
const LIMIT_IN_413 = JSON.stringify({
  error: { message: LIMIT_413_MESSAGE, type: 'invalid_request_error', code: 'context_length_exceeded' },
})

/** 502 网关页：真网关给的 HTML，不是 JSON（也短于 300 字符 ⇒ 兜底那段截断动不了它） */
const GATEWAY_HTML =
  '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n'

/** 500 的响应体：JSON 但没有 `message` ⇒ 走兜底那段 */
const OPAQUE_BODY = JSON.stringify({ error: { code: 'E_UPSTREAM' } })

/** 413 的响应体：说了另一件事（边缘策略拒绝），**没有一句**关于模型能吃的长度 */
const REFUSED_413 = JSON.stringify({
  error: { message: 'Request refused by the edge policy for this account' },
})

/**
 * 负控夹具：**别的形态一律照旧**。
 *
 * `detail` 逐条写死（不在这里重算那段兜底逻辑）：判据要比的是**今天报出来的那句话**，
 * 在判据里把被测代码的推导再抄一遍，等于让两边一起错。
 * ⚠️ 每条 body 都短于 300 字符 ⇒ 无论实现动没动那处截断，期望值都一样（由自检用例守着）。
 */
const OTHER_FAILURES: Array<{ name: string; status: number; body: string; detail: string }> = [
  {
    name: 'an ordinary 401 keeps the provider message',
    status: 401,
    body: JSON.stringify({ error: { message: 'Invalid API key' } }),
    detail: 'Invalid API key',
  },
  {
    name: 'a 500 without a message keeps the raw body',
    status: 500,
    body: OPAQUE_BODY,
    detail: OPAQUE_BODY,
  },
  {
    name: 'a 400 for another reason keeps the provider message',
    status: 400,
    body: JSON.stringify({
      error: { message: 'messages[1].role must alternate between user and assistant' },
    }),
    detail: 'messages[1].role must alternate between user and assistant',
  },
  {
    name: 'a 400 with an empty body keeps an empty detail',
    status: 400,
    body: '',
    detail: '',
  },
  {
    name: 'an HTML gateway page is not JSON and keeps the raw page',
    status: 502,
    body: GATEWAY_HTML,
    detail: GATEWAY_HTML,
  },
  {
    name: 'a 413 that names something else is not a context wall',
    status: 413,
    body: REFUSED_413,
    detail: 'Request refused by the edge policy for this account',
  },
]

let restore: (() => void) | null = null

beforeEach(() => {
  // 参考语言：那句话最先写在它里面，而英文面在缺键时会退化成打印键名（假绿）
  useLocale('zh-CN')
})

afterEach(() => {
  restore?.()
  restore = null
  clearConfig()
})

/** 把引擎语言切到一种 locale：报出来的那句话跟着它走 */
function useLocale(locale: string): void {
  ;(i18n.global.locale as unknown as { value: string }).value = locale
}

/** 引擎现在说的是哪种语言（正控要比的就是这一种语言的原文） */
function activeLocale(): string {
  return String((i18n.global.locale as unknown as { value: string }).value)
}

/** 一份 locale 里某个点路径键的原文；键不在时给空串 —— "没有"与"说了别的"必须分得开 */
function localeSentence(locale: string, key: string): string {
  const table = JSON.parse(readFileSync(LOCALE_DIR + '/' + locale + '.json', 'utf8')) as Record<
    string,
    unknown
  >
  let node: unknown = table
  for (const step of key.split('.')) {
    if (node === null || typeof node !== 'object') return ''
    node = (node as Record<string, unknown>)[step]
  }
  return typeof node === 'string' ? node : ''
}

/** 那句人话在当前语言里的原文 —— 期望值从盘上现读，不在这里手抄一份字形 */
function plainSentence(): string {
  return localeSentence(activeLocale(), PLAIN_KEY)
}

/**
 * 一句话里**不随参数变**的片段（`{...}` 是占位符，值由调用方给）。
 *
 * 比整句耐改：实现给 `t()` 传什么参数都不影响这些片段，而"那句话在不在"全靠它们。
 * 太短的片段（标点、单字）不当作判据 —— 它们不指向任何意思。
 */
function literalRuns(sentence: string): string[] {
  return sentence
    .split(/\{[^}]*\}/)
    .map((run) => run.trim())
    .filter((run) => run.length >= 4)
}

/** 造一个非 2xx 响应、跑一次 `chat()`，把报出来的那句话交出来 */
async function messageFrom(status: number, body: string): Promise<string> {
  saveConfig({
    provider: 'custom',
    apiKey: 'k',
    apiBase: 'https://api.example.test/v1',
    model: 'm',
  })
  restore = installFakeLlmError(status, body)
  const err = await chat(MESSAGES).then(
    () => null,
    (e: unknown) => e as Error,
  )
  if (!err) throw new Error('expected chat() to reject on a non-2xx response')
  return err.message
}

/** 今天那句话的样子：服务商原话 + 状态码（负控要比的就是它，一个字节都不许变） */
function providerFacingSentence(status: number, detail: string): string {
  return t('llm.httpError', { status, statusText: STATUS_TEXT, detail })
}

describe('a provider that says the input is past the context limit', () => {
  it('replaces the raw provider text with the plain sentence when error.message says it', async () => {
    const message = await messageFrom(400, LIMIT_IN_MESSAGE)

    // 先断**行为**：今天报出来的就是那句天书，所以这一条现在红 —— 红在被测对象上，不是红在夹具上
    expect(message, 'the raw provider sentence must not be the whole answer any more').not.toBe(
      providerFacingSentence(400, LIMIT_MESSAGE),
    )

    // 再断那句话本身在不在：键缺了的话，上面那条能靠"随便改点别的"混过去，而下面这条会空转
    const runs = literalRuns(plainSentence())
    expect(
      runs.length,
      'the locale carries no sentence under ' + PLAIN_KEY + ', so the check below is vacuous',
    ).toBeGreaterThan(0)
    for (const run of runs) {
      expect(message, 'the player must be told, in their own language, what hit the wall').toContain(run)
    }
  })

  it('still catches the limit when error.message is empty and the body says it past the fallback slice', async () => {
    const message = await messageFrom(400, LIMIT_DEEP_IN_BODY)

    // 今天这一段只交出兜底那 300 字符，而诊断排在它后面 ⇒ 一个字都没到玩家眼前，所以这一条现在红。
    // 比的是**不等**：那处截断留不留，这条都成立。
    expect(message, 'the diagnosis sat past the 300-char fallback, and the wall went unrecognised').not.toBe(
      providerFacingSentence(400, LIMIT_DEEP_IN_BODY.slice(0, 300)),
    )

    const runs = literalRuns(plainSentence())
    expect(
      runs.length,
      'the locale carries no sentence under ' + PLAIN_KEY + ', so the check below is vacuous',
    ).toBeGreaterThan(0)
    for (const run of runs) {
      expect(message, 'a diagnosis past the fallback slice must still be recognised').toContain(run)
    }
  })

  it('recognises the wall behind a 413 as well, because the provider words are the signal', async () => {
    const message = await messageFrom(413, LIMIT_IN_413)

    // 状态码只当粗筛：今天这一格同样只交出服务商原话（改完应当已经是那句人话）
    expect(message, 'a 413 that names the context wall is still the wall').not.toBe(
      providerFacingSentence(413, LIMIT_413_MESSAGE),
    )

    const runs = literalRuns(plainSentence())
    expect(
      runs.length,
      'the locale carries no sentence under ' + PLAIN_KEY + ', so the check below is vacuous',
    ).toBeGreaterThan(0)
    for (const run of runs) {
      expect(message, 'the status code must not stop the wall from being recognised').toContain(run)
    }
  })
})

describe('the plain sentence itself', () => {
  it('is carried by both locales and names the wall and the way out', () => {
    for (const locale of LOCALES) {
      const sentence = localeSentence(locale, PLAIN_KEY)
      expect(sentence, locale + ' has no sentence under ' + PLAIN_KEY).not.toBe('')
      expect(
        TOO_LONG_WORDS[locale].test(sentence),
        locale + ': the sentence must say the input is past what the model can take in',
      ).toBe(true)
      expect(
        WAY_OUT_WORDS[locale].test(sentence),
        locale + ': the sentence must point at compression as the long-term way out',
      ).toBe(true)
    }
  })
})

describe('every other failure keeps the sentence it has today', () => {
  for (const one of OTHER_FAILURES) {
    it(one.name, async () => {
      const message = await messageFrom(one.status, one.body)
      expect(message, 'this failure is not about length: its sentence must not change').toBe(
        providerFacingSentence(one.status, one.detail),
      )
      for (const run of literalRuns(plainSentence())) {
        expect(message, 'the too-long sentence must not appear on a failure of another kind').not.toContain(
          run,
        )
      }
    })
  }
})

describe('fixture self-check', () => {
  it('the strict fixture hides every length word past the 300-char fallback slice', () => {
    expect(
      LIMIT_DEEP_IN_BODY.search(ANY_LENGTH_WORD),
      'the fixture names the wall before the fallback slice: then it proves nothing about reading the body',
    ).toBeGreaterThan(300)
  })

  it('every negative fixture body is too short for the 300-char fallback to change it', () => {
    for (const one of OTHER_FAILURES) {
      expect(one.body.length, one.name + ': a long body would pin the fallback truncation').toBeLessThan(300)
    }
  })

  it('the two word families can be satisfied by a sentence, so the red can turn green', () => {
    expect(TOO_LONG_WORDS['zh-CN'].test(SPECIMEN_ZH), 'zh: no sentence could ever match').toBe(true)
    expect(WAY_OUT_WORDS['zh-CN'].test(SPECIMEN_ZH), 'zh: no sentence could ever match').toBe(true)
    expect(TOO_LONG_WORDS.en.test(SPECIMEN_EN), 'en: no sentence could ever match').toBe(true)
    expect(WAY_OUT_WORDS.en.test(SPECIMEN_EN), 'en: no sentence could ever match').toBe(true)
  })

  it('the run-based assertion has teeth: it holds on the sentence and misses without it', () => {
    const runs = literalRuns(SPECIMEN_ZH)
    expect(runs.length, 'a plausible sentence must yield at least one stable run').toBeGreaterThan(0)

    const carrying = 'HTTP 400 Bad Request\n' + SPECIMEN_ZH
    for (const run of runs) expect(carrying).toContain(run)

    const bare = 'HTTP 400 Bad Request\nmaximum context length is 65536 tokens'
    const missed = runs.filter((run) => !bare.includes(run))
    expect(missed.length, 'a message without the sentence must be rejected by these runs').toBeGreaterThan(0)
  })
})

/**
 * 4xx ＋ 正文说的是**别的限额** ⇒ 照旧：这两条负控是打回之后补上的，也是那条修复的牙。
 *
 * 打回的理由：实现里那条正则的 `exceed(?:s|ed|ing)?[^.]{0,24}\blimit\b` 这一臂，
 * 24 个字符的间隔**装得下"别的限额"** —— `exceeded token rate limit` 里只隔 12 个字符，
 * 于是真报文（Azure 的 429 token 配额）会被认成"上下文太长"，而玩家该做的是等一会儿或提额。
 * 既有那 14 条里没有一条覆盖"别的 limit" ⇒ 不补这两条，正则改完照样全绿（**修了没牙**）。
 *
 * 🔴 裁决（组长 2026-10-10，写在这里免得下一个人以为漏了）：
 *   **漏 = 口径允许，误伤 = 不许** ⇒ 本段**只加负控**。
 *   `Request entity too large`（光句）与 `context_length_exceeded`（机器码单独出现）这两条
 *   "该命中却被漏"的**刻意不补正控** —— 补了会把修复逼向"放宽正则"，正好是反方向。
 *
 * 两个词族分家（为什么不是一条）：只挑"速率 / 配额"那一族，修的人可能只堵那一条；
 * 两条并排，"凡 exceed…limit 都认"这种宽臂一条都过不去。
 *   A 速率 / 配额 —— Azure 的 token rate limit（429）
 *   B 额度 / 计费 —— 月度消费额度（402 Payment Required）
 *
 * ⚠️ 两条的 `detail` 都非空 ⇒ 兜底那处 `slice(0, 300)` 落不到它们身上（它只在 `detail` 为空时才用）
 *    ⇒ 期望值与那处截断无关。夹具体长 185 / 77 字符，正则命中在第 117 / 38 个字符
 *    （量于 `.team/test/2026-10-10/measure-new-negatives.log`）。
 * ⚠️ 本文件头的三层判据按现状写：负控 8 条（含本段这两条）；加上自检 4 条，全文件 16 条。
 */
const RATE_LIMIT_MESSAGE =
  'Requests to the ChatCompletions_Create Operation under Azure OpenAI API version 2024-02-01 have exceeded token rate limit of your current OpenAI S0 pricing tier.'

/** 额度 / 计费那一族的措辞：说的是账单，不是模型能吃多长 */
const SPENDING_LIMIT_MESSAGE = 'Your account has exceeded the monthly spending limit.'

/** 两条负控夹具：4xx ＋ 说的是别的限额 ⇒ 报出来的那句话一个字节都不许变 */
const OTHER_LIMIT_FAILURES: Array<{ name: string; status: number; body: string; detail: string }> = [
  {
    name: 'a 429 about a token rate limit is not a context wall',
    status: 429,
    body: JSON.stringify({ error: { message: RATE_LIMIT_MESSAGE } }),
    detail: RATE_LIMIT_MESSAGE,
  },
  {
    name: 'a 402 about a monthly spending limit is not a context wall',
    status: 402,
    body: JSON.stringify({ error: { message: SPENDING_LIMIT_MESSAGE } }),
    detail: SPENDING_LIMIT_MESSAGE,
  },
]

describe('a 4xx that names some other limit keeps the sentence it has today', () => {
  for (const one of OTHER_LIMIT_FAILURES) {
    it(one.name, async () => {
      const message = await messageFrom(one.status, one.body)

      // 别的限额不是那堵墙：报出来的话必须还是"服务商原话 ＋ 状态码"
      expect(message, 'another kind of limit is not the context wall: the sentence must not change').toBe(
        providerFacingSentence(one.status, one.detail),
      )

      // 再断那句人话没混进来：只靠上面那条，把两句拼在一起也能过去
      for (const run of literalRuns(plainSentence())) {
        expect(
          message,
          'the too-long sentence must not appear on a failure about another limit',
        ).not.toContain(run)
      }
    })
  }
})
