// @vitest-environment jsdom
/**
 * 票 56：卡编辑器里的**资源库面板** —— 卡里那几块原始提示词看得见、读得到、改得动。
 *
 * 契约 `.team/test/2026-09-17/contract-56.md`（S0 是 `.team/leader/2026-09-17/` 那张任务卡）。
 * 判据四条：列全（名字用人话、顺序 = 卡的声明顺序）· 点开读得到逐字内容 ·
 * 改完保存要过**与导入同一套校验** · 校验不过时存储与错误提示各自是什么样。
 *
 * ⚠️ 断言一律走 `data-card-*` 钩子与 `t('key')`：选元素不按文案找，文案不抄字面量
 *    （测试代码必须 ASCII，中文只在 src/locales/*.json）。
 * ⚠️ 资源名与调试痕迹里那个名字**同一套 locale 键**（`prompts.settingBlock.*` / `prompts.*`）——
 *    用户要的就是「痕迹里看到的那块」在面板里对得上号。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CardResources from '../src/components/CardResources.vue'
import { importCard } from '../src/game/current-card'
import { i18n, t } from '../src/i18n'
import { CARD_KEY, EXAMPLE, savedCard } from './support/card-resources'
import { label, setLocale } from './support/trace-blocks'
import type { CardData } from '../src/game/card'

/** 卡里五块设定的键（顺序就是卡的声明顺序） */
const SETTING_KEYS = Object.keys(EXAMPLE.settings)

/** 除了五块设定之外，资源库里另外那三类（各自一件） */
const OTHER_RESOURCES = ['script', 'convention']

/** 卡里第一块设定的名字 —— 编辑用例改的就是它（从卡里现取，不写死中文字面量） */
const FIRST_BLOCK = SETTING_KEYS[0]

/** 挂载面板：接上真实 i18n，卡与错误都从 props 进 */
function panel(props: Record<string, unknown> = {}) {
  return mount(CardResources, {
    props: { card: EXAMPLE, error: '', ...props },
    global: { plugins: [i18n] },
  })
}

/** 某一块设定的正文（卡里那份行数组） */
function linesOf(key: string): string[] {
  return EXAMPLE.settings[key as keyof typeof EXAMPLE.settings]
}

/** 这一块在卡里**逐字**的文本 —— 面板要交出来的就是它 */
function textOf(key: string): string {
  return linesOf(key).join('\n')
}

/** 展开一个资源项（点它自己的展开钩子） */
async function open(w: ReturnType<typeof panel>, id: string): Promise<void> {
  await w.find('[data-card-resource="' + id + '"] [data-card-resource-open]').trigger('click')
}

/** 一个资源项里的正文编辑器 */
function editorOf(w: ReturnType<typeof panel>, id: string): HTMLTextAreaElement {
  return w.find('[data-card-resource="' + id + '"] [data-card-resource-text]').element as HTMLTextAreaElement
}

describe('CardResources: the resource library', () => {
  it('lists every resource in the card, in the card order', () => {
    const ids = panel()
      .findAll('[data-card-resource]')
      .map((el) => el.attributes('data-card-resource'))

    expect(ids).toEqual([...SETTING_KEYS, ...OTHER_RESOURCES])
  })

  it('names each resource the way the debug panel names it (locale, both languages)', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale)
      const w = panel()
      for (const key of SETTING_KEYS) {
        expect(w.find('[data-card-resource="' + key + '"]').text(), locale).toContain(
          label('prompts.settingBlock.' + key),
        )
      }
      for (const key of OTHER_RESOURCES) {
        expect(w.find('[data-card-resource="' + key + '"]').text(), locale).toContain(label('prompts.' + key))
      }
    }
  })

  it('writes its own four strings through locale keys (no hardcoded copy in the component)', async () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      setLocale(locale)
      const w = panel()
      const item = '[data-card-resource="' + FIRST_BLOCK + '"]'
      expect(w.text(), locale).toContain(label('card.resourcesTitle'))
      expect(w.find(item + ' [data-card-resource-open]').text(), locale).toBe(label('card.resourceOpen'))
      // 保存按钮在展开之后才在（未展开时不该出现一颗点了没用的按钮）
      expect(w.find(item + ' [data-card-resource-save]').exists(), locale).toBe(false)
      await open(w, FIRST_BLOCK)
      expect(w.find(item + ' [data-card-resource-save]').text(), locale).toBe(label('card.resourceSave'))
    }
    setLocale('zh-CN')
  })

  it('opens a setting block and hands out its lines verbatim', async () => {
    const w = panel()
    await open(w, FIRST_BLOCK)

    expect(editorOf(w, FIRST_BLOCK).value).toBe(textOf(FIRST_BLOCK))
    for (const line of linesOf(FIRST_BLOCK)) expect(editorOf(w, FIRST_BLOCK).value).toContain(line)
  })

  it('opens the other three resources and hands out their value as text', async () => {
    const w = panel()
    for (const id of OTHER_RESOURCES) await open(w, id)

    expect(editorOf(w, 'script').value).toBe(JSON.stringify(EXAMPLE.script, null, 2))
    expect(editorOf(w, 'convention').value).toBe(EXAMPLE.convention.join('\n'))
  })

  it('saves an edited block through the card import path and leaves the rest untouched', async () => {
    const w = panel()
    await open(w, FIRST_BLOCK)
    await w
      .find('[data-card-resource="' + FIRST_BLOCK + '"] [data-card-resource-text]')
      .setValue('first line\nsecond line')
    await w.find('[data-card-resource="' + FIRST_BLOCK + '"] [data-card-resource-save]').trigger('click')

    const stored = savedCard()
    expect(stored.settings[FIRST_BLOCK as keyof typeof stored.settings]).toEqual([
      'first line',
      'second line',
    ])
    // 别处的字节一个都不许动（整份卡逐块比）
    for (const key of SETTING_KEYS.filter((name) => name !== FIRST_BLOCK)) {
      expect(stored.settings[key as keyof typeof stored.settings], key).toEqual(linesOf(key))
    }
    expect(stored.script).toEqual(EXAMPLE.script)
    expect(stored.convention).toEqual(EXAMPLE.convention)
    expect(stored.card).toEqual(EXAMPLE.card)
    expect(w.emitted('saved')).toHaveLength(1)
  })

  it('refuses a block that breaks the card: nothing is written and the reason is shown', async () => {
    // ⚠️ 先种一份**已知文本**：`toBeNull()` 只证「存储里没有卡」，而这条用例全程没写过卡 ——
    //    把 importCard 换成空操作它照样绿。要证「一个字节不动」，得先有东西可比。
    const seeded = JSON.stringify(EXAMPLE, null, 2)
    localStorage.setItem(CARD_KEY, seeded)
    const before = JSON.stringify(EXAMPLE)

    const w = panel()
    await open(w, FIRST_BLOCK)
    // 清空正文：设定块是「非空的行数组」，而**一行空串是合法的** —— 所以这一判只能在组件里拦
    await w.find('[data-card-resource="' + FIRST_BLOCK + '"] [data-card-resource-text]').setValue('')
    await w.find('[data-card-resource="' + FIRST_BLOCK + '"] [data-card-resource-save]').trigger('click')

    expect(localStorage.getItem(CARD_KEY), 'a rejected save must not touch storage').toBe(seeded)
    expect(w.emitted('saved')).toBeUndefined()
    // 原因要有牙：模板前缀 + 那条「空正文」的说明（少了后半句，这条断言就该红）
    const shown = w.find('[data-card-error]').text()
    expect(shown).toContain(t('card.saveFailed', { message: '' }).trim())
    expect(shown).toContain(t('card.resourceEmpty'))
    // 卡本身也一个字节没动（保存前后各比一次整份 JSON —— 比「同一个引用」强）
    expect(JSON.stringify(EXAMPLE), 'a rejected save must not touch the card').toBe(before)
  })

  it('accepts a hand-written empty line: the guard really lives in the component', () => {
    // 反面证据：`['']`（一行空串）**过得去**校验器 —— 所以「清空正文」只能在组件那一层拦。
    // 这条自给自足（不借上一条用例的存储）：谁把组件里那一判删掉，用例 7 会红，而这条照旧绿。
    const card = JSON.parse(JSON.stringify(EXAMPLE)) as CardData
    card.settings[FIRST_BLOCK as keyof CardData['settings']] = ['']
    importCard(JSON.stringify(card))
    expect(
      (JSON.parse(localStorage.getItem(CARD_KEY) as string) as CardData).settings[
        FIRST_BLOCK as keyof CardData['settings']
      ],
    ).toEqual([''])
  })

  it('keeps the reason the parent handed back', () => {
    const reason = 'card settings.' + FIRST_BLOCK + ': must not be empty'
    expect(panel({ error: reason }).find('[data-card-error]').text()).toContain(reason)
  })
})
