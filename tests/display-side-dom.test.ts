// @vitest-environment jsdom
/**
 * 票 68 · S1：**玩家屏那一屏的 DOM 结构** —— 两栏 / 归属 / 顺序 / 空栏 / 闸门（jsdom 那一层）。
 *
 * 契约 `.team/test/2026-09-24/contract-68.md` §三（三档结构契约）· §五.2（D 族）· §七（闸门）。
 * 纯逻辑那一半（校验器 K + 分栏 D1–D4）在 `tests/display-side.test.ts` —— 两件**别混**。
 *
 * ⚠️ **这一件断的是"接线 + 结构"，不是"几何"**：jsdom 没有布局（每个盒子的矩形都是 0），
 *    三档的**档位**与"左在正文左边"那种读数量在 `e2e/visual.spec.ts`（真浏览器，组长跑）。
 *    这里能断的三样：**栏在不在**、**哪块在哪一栏**、**DOM 序**。
 * ⚠️ **闸门那一半这里只断"提示块在 DOM 里"**（不是 `v-if`）—— 可见性是媒体查询的事，
 *    jsdom 里断不了（票 74 的教训：窄档那三件全按纯 CSS 落，正是因为这一层没有布局）。
 * ⚠️ 字符串一律 ASCII（`tests/` 不豁免 `ascii.mjs`）⇒ 卡里的中文一律从卡 / i18n 现取。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import App from '../src/App.vue'
import WorldPanel from '../src/components/WorldPanel.vue'
import { world } from '../src/components/display-blocks'
import { instantiate } from '../src/game/card-state'
import { currentCard } from '../src/game/current-card'
import { i18n } from '../src/i18n'

/** 内置示例卡（morningwind）：六块、左三右三 —— 期望值全部从卡现取，不抄一份内容 */
const card = currentCard
const state = instantiate(card)
const declared = JSON.parse(JSON.stringify(card.display.sidebar)) as Array<Record<string, any>>

/** 这一件里当前挂着的那一版 `App`（挂在 `document.body` 上，收尾要 `unmount`） */
let mounted: VueWrapper | null = null

afterEach(() => {
  mounted?.unmount()
  mounted = null
  document.body.innerHTML = ''
})

/** 挂上真 `App`（玩家屏那一屏就是它） */
function openPlayer(): void {
  mounted = mount(App, { global: { plugins: [i18n] }, attachTo: document.body }) as VueWrapper
}

/** 文档里的全部栏（`[data-side]`） */
function columns(): Element[] {
  return Array.from(document.querySelectorAll('[data-side]'))
}

/** 文档里的全部块 */
function blocks(): Element[] {
  return Array.from(document.querySelectorAll('[data-block]'))
}

/** 一块声明对应的那个元素（按 `data-block` 的值找，不拼 CSS 选择器 —— 路径里可能有中文） */
function blockOf(path: string): Element | undefined {
  return blocks().find((el) => el.getAttribute('data-block') === path)
}

/** 一个元素落在哪一栏里（没有栏就是 null） */
function sideOf(el: Element | undefined): string | null {
  return el?.closest('[data-side]')?.getAttribute('data-side') ?? null
}

/** 两个节点的先后（真文档序，`FOLLOWING` = 前者在后者之前） */
function comesBefore(first: Element | null, second: Element | null): boolean {
  if (first === null || second === null) return false
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

/**
 * 一份两语的 locale 表（读真文件，不从 i18n 实例反推）。
 *
 * ⚠️ `play` 今天是**新命名空间** ⇒ 一律用可选链取，缺键时给一条能看懂的失败信息
 *    （直接取值会抛 TypeError，那条红读起来像"测试坏了"）。
 */
function localeOf(name: string): Record<string, any> {
  return JSON.parse(readFileSync('src/locales/' + name + '.json', 'utf8')) as Record<string, any>
}

/** 两句提示的键名（`play.*` 那一对，契约 §七.3） */
const GATE_KEYS = ['rotateTitle', 'rotateBody'] as const

describe('the player screen itself', () => {
  it('S4 the real App mounts and puts its chrome on screen (so the criteria below have an object)', () => {
    openPlayer()
    // 这一条今天必须绿：它证明"红"来自结构，不是来自"App 压根没挂上"
    expect(document.querySelector('button[data-settings]'), 'the App did not mount').not.toBe(null)
    expect(
      document.querySelectorAll('.composer-row').length,
      'the composer is not on screen',
    ).toBeGreaterThan(0)
    expect(declared.length, 'the card declares no sidebar entry, so these criteria measure nothing').toBe(6)
  })

  it('D5 the player screen hands out exactly two columns, one block per declaration', () => {
    openPlayer()
    expect(
      columns().length,
      'the player screen has no side columns at all (today the blocks live in a drawer that is closed)',
    ).toBe(2)
    expect(
      columns()
        .map((el) => el.getAttribute('data-side'))
        .sort(),
      'the two columns must be left and right',
    ).toEqual(['left', 'right'])
    // 一块不多一块不少：每块只出现一次（不许为"块带"克隆一份）
    expect(
      blocks().map((el) => el.getAttribute('data-block')),
      'the number of blocks on screen does not match the card',
    ).toHaveLength(declared.length)
  })

  it('D6 every block sits in the column its declaration named, and in no other', () => {
    openPlayer()
    const seen: string[] = []
    for (const entry of declared) {
      const path = String(entry.path)
      const el = blockOf(path)
      expect(el, 'the declared block is not on screen at all: ' + path).toBeDefined()
      expect(sideOf(el), 'block ' + path + ' is not in the column its declaration named').toBe(
        String(entry.side),
      )
      seen.push(path)
    }
    // 反面（R3）：`left` 的块不许落在右栏、`right` 的块不许落在左栏 —— 只断"有两条栏"抓不住分错边
    const crossed = declared
      .filter((entry) => sideOf(blockOf(String(entry.path))) !== String(entry.side))
      .map((entry) => String(entry.path))
    expect(crossed, 'these blocks are drawn on the wrong side').toEqual([])
    expect(seen.length, 'no block was compared against its declaration').toBe(declared.length)
  })

  it('D7 the DOM order is left column, story, right column, and each column keeps the declared order', () => {
    openPlayer()
    const left = columns().find((el) => el.getAttribute('data-side') === 'left') as Element | undefined
    const right = columns().find((el) => el.getAttribute('data-side') === 'right') as Element | undefined
    const story = document.querySelector('[data-story]')
    expect(story, 'the story column has no hook of its own, so its place in the DOM cannot be read').not.toBe(
      null,
    )
    expect(comesBefore(left ?? null, story), 'the left column must come before the story').toBe(true)
    expect(comesBefore(story, right ?? null), 'the right column must come after the story').toBe(true)

    // 栏内顺序 = 声明里该侧的相对顺序（界面不许自己重排）
    for (const [side, column] of [
      ['left', left],
      ['right', right],
    ] as const) {
      const wanted = declared
        .filter((entry) => String(entry.side) === side)
        .map((entry) => String(entry.path))
      const shown = Array.from(column?.querySelectorAll('[data-block]') ?? []).map((el) =>
        el.getAttribute('data-block'),
      )
      expect(
        shown,
        'the ' + side + ' column does not draw the declared blocks in the declared order',
      ).toEqual(wanted)
    }
  })

  it('D8 the drawer is gone: none of its three hooks is on the player screen any more', () => {
    openPlayer()
    for (const selector of ['[data-world-panel]', '[data-world]', '[data-world-close]']) {
      expect(document.querySelector(selector), 'the world drawer is still on screen: ' + selector).toBe(null)
    }
    // 反面控制：那一层真挂上过（组件还在），只是玩家屏不该再有它的入口
    expect(world.length, 'the demo card declares no blocks, so D5-D8 measured nothing').toBe(declared.length)
  })

  it('D10 the gate notice is in the DOM by default (it is a media query, not a v-if)', () => {
    openPlayer()
    const notice = document.querySelector('[data-play-rotate]')
    expect(
      notice,
      'the player screen has no [data-play-rotate]: a portrait phone would be shown the game anyway',
    ).not.toBe(null)
    const text = notice?.textContent ?? ''
    for (const key of GATE_KEYS) {
      expect(text, 'the notice does not spell ' + key).toContain(String(i18n.global.t('play.' + key)))
    }
  })
})

describe('one column on its own', () => {
  it('D9 a column with no blocks says so instead of drawing nothing', () => {
    const w = mount(WorldPanel, { props: { side: 'left', blocks: [], state } })
    expect(w.attributes('data-side'), 'the column does not carry the side it was handed').toBe('left')
    expect(w.findAll('[data-block]')).toHaveLength(0)
    const empty = w.find('[data-side-empty]')
    expect(empty.exists(), 'an empty column draws nothing at all: the player cannot tell why').toBe(true)
    expect(empty.text(), 'the empty column must say it in the player text').toBe(
      String(i18n.global.t('play.emptySide')),
    )
  })
})

describe('the two texts a portrait phone gets', () => {
  it('D11 both locales carry play.rotateTitle / play.rotateBody / play.emptySide', () => {
    for (const name of ['zh-CN', 'en']) {
      const locale = localeOf(name)
      for (const key of [...GATE_KEYS, 'emptySide']) {
        const value = locale.play?.[key]
        expect(typeof value, name + ' has no play.' + key).toBe('string')
        expect(String(value).length, name + ' play.' + key + ' is empty').toBeGreaterThan(0)
      }
    }
  })

  it('D11b the player text is not the editor text (the player does not edit anything)', () => {
    for (const name of ['zh-CN', 'en']) {
      const locale = localeOf(name)
      expect(
        String(locale.play?.rotateBody),
        name + ': the player screen copied the editor sentence word for word',
      ).not.toBe(String(locale.card?.rotateBody))
      expect(
        String(locale.play?.rotateTitle),
        name + ': the title is the same sentence in both screens on purpose (design section 10.3)',
      ).toBe(String(locale.card?.rotateTitle))
    }
    // zh 那一句得说"玩"，不能说"编"（照抄编辑器就是假话）
    const zh = String(localeOf('zh-CN').play?.rotateBody)
    expect(zh, 'the player sentence talks about playing').toContain('\u73a9')
    expect(zh, 'the player sentence still talks about the card editor').not.toContain('\u7f16\u8f91\u5668')
  })
})
