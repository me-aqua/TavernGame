// @vitest-environment jsdom
/**
 * 搬进来的「能用的」第三件：`StoryCover`（开场封面）。
 *
 * 三条要守的性质（票面清单）：
 *   ① **卡名与简介真的出现在封面上** —— 玩家开局第一眼看到的就是这一张；
 *   ② **没配 API 时说的是人话** —— locale 表里那一句，不是 `cover.unconfigured` 这种键名；
 *   ③ **点「开始」才往外抛 `start`** —— 封面自己不往里走。
 *
 * 🔴 三条里牙最容易被拔掉的是 ③：把 `@click` 接到别的 emit 上、或者干脆让它挂载就抛，
 *    **封面照样画得一模一样**（①② 全绿）—— 所以 ③ 那一组既断"点了才抛"，也断"没点什么都不抛"。
 * 🔴 ② 那一组断的是**两件事**：文案等于 locale 表里那一句，且**不等于键名本身**
 *    （后面半句是这条判据的承重墙：locale 少一个键时 i18n 会把键名原样吐出来，
 *    只断"有文字"的话那种坏法照样绿）。
 *
 * ⚠️ `tests/` 里的字符串一律 ASCII（钩子查这一层，`npm run check` 看不见）⇒
 *    中文卡名 / 简介写成 `\uXXXX` 转义，期望文案从 `src/locales/*.json` 现读。
 * ⚠️ 这一件**不测样式**（颜色 / 字体 / 尺寸 / 动效）：那些归组件故事那一层与整页巡检看，
 *    这里也不按样式找元素。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import StoryCover from '../src/components/StoryCover.vue'
import { i18n } from '../src/i18n'
import type { Status } from '../src/stores/game'

/** 一张卡的名字与简介（卡里的就是中文；这里写成转义，见文件头） */
const NAME_A = '\u6668\u98ce\u9547'
const SUMMARY_A =
  '\u8fb9\u5883\u5c0f\u9547\u5916\u6709\u5ea7\u5730\u7262\uff0c\u6ca1\u4eba\u77e5\u9053\u5b83\u6709\u591a\u6df1\u3002'
/** 另一张卡（换卡就换封面：名字与简介都不同） */
const NAME_B = '\u957f\u591c'
const SUMMARY_B = '\u4e00\u5bbf\u4e0d\u7761\u7684\u4eba\uff0c\u624d\u77e5\u9053\u591c\u6709\u591a\u957f\u3002'
/** 一条通知（状态行那一支的夹具） */
const NOTICE = '\u4e0a\u4e00\u5c40\u7559\u4e0b\u7684\u901a\u77e5\uff1a\u5b58\u6863\u5df2\u5bfc\u51fa'

/** 封面的五个入参 */
interface CoverProps {
  name: string
  summary: string
  configured: boolean
  busy: boolean
  status: Status | null
}

/** 两份 locale（读真文件，不从 i18n 实例反推）—— 只声明这一件用到的那几段 */
interface LocaleTable {
  app: { generatingOpening: string }
  cover: Record<'kicker' | 'gm' | 'unconfigured' | 'configure' | 'start', string>
}

function localeOf(name: string): LocaleTable {
  return JSON.parse(readFileSync('src/locales/' + name + '.json', 'utf8')) as LocaleTable
}

const ZH = localeOf('zh-CN')
const EN = localeOf('en')

type AnyWrapper = VueWrapper<any>

/** 挂一张封面跑一段判据、跑完收摊（每条判据各挂一版：判据之间不许互相带状态） */
async function onCover(
  run: (w: AnyWrapper) => Promise<void>,
  props: Partial<CoverProps> = {},
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<void> {
  i18n.global.locale.value = locale
  const w = mount(StoryCover, {
    props: {
      name: NAME_A,
      summary: SUMMARY_A,
      configured: false,
      busy: false,
      status: null,
      ...props,
    },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
  try {
    // 断言之前先确认封面真的画出来了：下面有几条是"某个东西**不该在**"（没配 API 时没有开始键、
    // 生成中没有开始键）。整块没渲染时那种判据会**静默变绿** —— "照不到"不是"通过了"。
    expect(w.find('[data-cover]').exists(), 'the cover did not render at all').toBe(true)
    await run(w)
  } finally {
    w.unmount()
  }
}

/** 一个锚点上的文字（读不到就当场报，不静默给空串） */
function textAt(w: AnyWrapper, selector: string): string {
  const el = w.find(selector)
  expect(el.exists(), 'the cover is missing ' + selector).toBe(true)
  return el.text()
}

/** 点一个锚点（读不到就当场报） */
async function clickAt(w: AnyWrapper, selector: string): Promise<void> {
  const el = w.find(selector)
  expect(el.exists(), 'the cover is missing ' + selector).toBe(true)
  await el.trigger('click')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('StoryCover: the card name and its summary are on the cover', () => {
  it('shows the card name as the cover title', async () => {
    await onCover(async (w) => {
      expect(textAt(w, '[data-cover-name]')).toBe(NAME_A)
    })
  })

  it('shows the card summary on the cover', async () => {
    await onCover(async (w) => {
      expect(textAt(w, '[data-cover-summary]')).toBe(SUMMARY_A)
    })
  })

  it('draws whichever card it was given: two cards, two different covers', async () => {
    // 名字与简介**两样都换**：只把其中一样钉在模板上的写法，这一条会红
    let one = ''
    let two = ''
    await onCover(async (w) => {
      one = textAt(w, '[data-cover-name]') + '|' + textAt(w, '[data-cover-summary]')
    })
    await onCover(
      async (w) => {
        two = textAt(w, '[data-cover-name]') + '|' + textAt(w, '[data-cover-summary]')
      },
      { name: NAME_B, summary: SUMMARY_B },
    )
    expect(one).not.toBe(two)
    expect(two).toBe(NAME_B + '|' + SUMMARY_B)
  })

  it('fixture guard: the names really are the Chinese a card carries', async () => {
    // ⚠️ 这一条**不碰组件**：它量的是夹具本身（不然"两个串不相等"那条可能只是"两个 ASCII 串"）。
    //    所以「整块没渲染」那种注入下**它照样绿是应该的** —— 它不是组件的判据。
    expect(NAME_A.codePointAt(0) ?? 0, 'the fixture must start with a non-ASCII character').toBe(0x6668)
  })
})

describe('StoryCover: without an API key it says something a player can read', () => {
  it('says the unconfigured sentence from the locale table', async () => {
    await onCover(async (w) => {
      expect(textAt(w, '[data-status="info"]')).toBe(ZH.cover.unconfigured)
    })
  })

  it('says it in English when the interface is English', async () => {
    await onCover(
      async (w) => {
        expect(textAt(w, '[data-status="info"]')).toBe(EN.cover.unconfigured)
      },
      {},
      'en',
    )
  })

  it('shows the sentence itself, never the message key', async () => {
    // 承重墙：locale 少了这个键时 i18n 原样吐键名 —— 只断"有文字"的话那种坏法照样绿
    await onCover(async (w) => {
      const shown = textAt(w, '[data-status="info"]')
      expect(shown).not.toBe('cover.unconfigured')
      expect(shown, 'the locale table must carry a real sentence').toBe(ZH.cover.unconfigured)
      expect(ZH.cover.unconfigured.length).toBeGreaterThan(8)
    })
  })

  it('offers the way to settings on that button', async () => {
    await onCover(async (w) => {
      expect(textAt(w, '[data-cover-configure]')).toBe(ZH.cover.configure)
    })
  })

  it('says what it is doing while the opening is being written', async () => {
    // 生成中那一档：没有节点进度时说的话，同样是人话（`app.generatingOpening` 是共享键）
    await onCover(
      async (w) => {
        expect(textAt(w, '[data-status="busy"]')).toBe(ZH.app.generatingOpening)
      },
      { configured: true, busy: true },
    )
  })

  it('shows the notice it was handed instead of the welcome', async () => {
    await onCover(
      async (w) => {
        expect(textAt(w, '[data-status="error"]')).toBe(NOTICE)
        expect(w.find('[data-status="info"]').exists(), 'the welcome is still on screen').toBe(false)
      },
      { configured: true, status: { kind: 'error', text: NOTICE } },
    )
  })
})

describe('StoryCover: the story starts only when the player clicks start', () => {
  it('emits nothing at all by just being on screen', async () => {
    // 封面自己不许往里走：挂上去就抛 start 的实现，这一条红
    await onCover(async (w) => {
      expect(w.emitted('start')).toBeUndefined()
      expect(w.emitted('configure')).toBeUndefined()
    })
  })

  it('emits start, once, when the start button is clicked', async () => {
    await onCover(
      async (w) => {
        await clickAt(w, '[data-cover-start]')
        expect(w.emitted('start')).toHaveLength(1)
        expect(w.emitted('configure'), 'clicking start also asked for settings').toBeUndefined()
      },
      { configured: true },
    )
  })

  it('sends the player to settings instead when nothing is configured', async () => {
    await onCover(async (w) => {
      await clickAt(w, '[data-cover-configure]')
      expect(w.emitted('configure')).toHaveLength(1)
      expect(w.emitted('start'), 'an unconfigured cover let the story start').toBeUndefined()
    })
  })

  it('offers no start button at all without an API key', async () => {
    await onCover(async (w) => {
      expect(w.find('[data-cover-start]').exists()).toBe(false)
    })
  })

  it('offers no start button while the opening is still being written', async () => {
    // 生成中按得动"开始"就是两次开局：这一条断的是"才开始"
    await onCover(
      async (w) => {
        expect(w.find('[data-status="busy"]').exists(), 'nothing says it is generating').toBe(true)
        expect(w.find('[data-cover-start]').exists()).toBe(false)
      },
      { configured: true, busy: true },
    )
  })

  it('offers exactly one way forward on the cover', async () => {
    // 封面只有一颗键：多出第二颗（或第二处可点）就是多了一条没人守的入口
    await onCover(
      async (w) => {
        expect(w.findAll('button')).toHaveLength(1)
      },
      { configured: true },
    )
  })
})
