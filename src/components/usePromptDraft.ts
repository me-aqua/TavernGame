/**
 * 「编公共提示词」那一族的草稿 —— 票 8d-② 新增（照 `useDisplayDraft.ts` 的三件套形状）。
 *
 * 第四栏列的是卡里那 **7 条**公共提示词：`settings` 的五块（**按卡的声明序**）+ `script` +
 * `convention`（顺序与现取法照退休的 `CardResources.vue:41-49`）。改哪一条都只落在**草稿**里，
 * 落卡是 `useBranchDraft` 那一条写路径（本件交出 `applyTo` 与脏，顶栏那颗「保存」一起提交）。
 *
 * ⚠️ **一条一份草稿、按 id 索引**：换一条再换回来，草稿还在；**改回原值 = 没改**（草稿收掉，
 *    顶栏那颗按钮跟着变回按不动）。
 * ⚠️ **`script` 那一条的正文是 JSON 文本**（它在卡里是唯一的自由对象）⇒ 存回去要 `JSON.parse`：
 *    坏 JSON **在草稿层就拦下**（`badEntry()` + `problem()`），不许交给 `importCard` 去发现 ——
 *    那句话落在 `[data-prompt-error]`、不是 `[data-card-error]`（S0 §六 裁决 3 的口径）。
 * ⚠️ **空正文不是坏值**（组长 2026-09-26 裁的口径）：卡只拒**空表**、一行空串是合法的
 *    （`card-read.ts:53`）⇒ **界面不许比引擎严** —— 清空一段行数组正文存得下去、也不给提示；
 *    退休面板那条「这一项不能留空」的守卫**不继承**（它那句文案也同日从两份 locale 里删掉）。
 * ⚠️ **"正在编哪一条"不在这里**：那一条轴只有一处（`CardEditor` 的 `target`），本件只算不选 ——
 *    于是"亮着的那一行"与"中栏画的那一屏"结构上不可能各说各的。
 * ⚠️ **草稿的底是"屏上那张卡"**（`shown`）：存完之后草稿与它逐字相同 ⇒ 顶栏那颗按钮自己变回
 *    按不动，本族不必另记一份"刚存过"；**没动过的条目一个字节都不写**。
 */
import { computed, ref, type ComputedRef } from 'vue'
import { t } from '../i18n'
import type { CardData } from '../game/card'

/** 那 7 条里的一条（第四栏照它画一行，中栏照它铺那一屏） */
export interface PromptEntry {
  /** 钩子用的 id，也是它在卡里的位置：五个 `settings` 键 / `script` / `convention` */
  id: string
  /** 给人看的名字（`prompts.*`）—— 与调试痕迹里显示的是同一串，用户要的就是两边对得上号 */
  name: string
  /** 正文：五块与规矩是行数组按 `\n` 拼；`script` 是 JSON 文本 */
  body: string
  /** 正文的行数（第四栏每一条都带它） */
  lines: number
}

/** 这一族对外的那几样（`CardEditor` 照这个接线） */
export interface PromptDraftApi {
  /** 卡里那 7 条（草稿优先）—— 顺序就是画出来的顺序 */
  entries: ComputedRef<PromptEntry[]>
  /** 干净 ⇔ 草稿与屏上那张卡里那一条逐字相同 */
  dirty: ComputedRef<boolean>
  /** 这一条正文过不了自己的格式时那句话（空串 = 没问题）—— 落在 `[data-prompt-error]` 上 */
  problem(id: string): string
  /** 正文改了（改的是哪一条由参数说） */
  setBody(id: string, text: string): void
  /** 保存之前问一句：草稿里有坏值就回**那一条的 id**（调用方把它挑到屏上），没有就回 null */
  badEntry(): string | null
  /** 把草稿写进那份深拷卡（**只有改动过的那几条才写**） */
  applyTo(next: CardData): void
}

/** 卡里那 7 条的底：id + 名字的 locale 键 + 正文（顺序 = 卡的声明序 → 剧本 → 规矩） */
interface Slot {
  id: string
  nameKey: string
  body: string
}

/**
 * 卡里那 7 条正文的现取法（照退休的 `CardResources.vue:41-49`，一个字节的口径都不新造）。
 *
 * ⚠️ 五块走 `Object.entries(card.settings)` —— **卡的声明序**就是画出来的顺序；`script` 在卡里
 *    不是行数组（自由对象）⇒ 只能当 JSON 文本编。
 */
function slotsOf(card: CardData): Slot[] {
  const blocks = Object.entries(card.settings).map(([key, lines]) => ({
    id: key,
    nameKey: 'prompts.settingBlock.' + key,
    body: lines.join('\n'),
  }))
  return [
    ...blocks,
    { id: 'script', nameKey: 'prompts.script', body: JSON.stringify(card.script, null, 2) },
    { id: 'convention', nameKey: 'prompts.convention', body: card.convention.join('\n') },
  ]
}

/**
 * 这一条正文过不了自己的格式时那句话（空串 = 没问题）。
 *
 * ⚠️ **只有 `script` 要过 JSON**：它那一段在卡里是自由对象 ⇒ 正文就是 JSON 文本；其余六条存回去
 *    只是按 `\n` 切行，切不出坏值（**空正文也不是坏值** —— 见下）。
 * ⚠️ **界面不许比引擎严**（组长 2026-09-26 裁的口径）：卡只拒**空表**、一行空串是合法的
 *    （`card-read.ts:53`）⇒ **清空一段行数组正文存得下去、也不给提示**；退休面板那条
 *    「这一项不能留空」的守卫**不继承**。
 *    `script` 空着由 `JSON.parse('')` 抛出来 ⇒ 它报的是"不是合法 JSON"那一句（同一个裁判，不是新规矩）。
 */
function problemOf(id: string, body: string): string {
  if (id !== 'script') return ''
  try {
    JSON.parse(body)
    return ''
  } catch {
    // 边界：正文是人手打的 JSON —— 坏值只报不改，落卡那一步根本不会走到
    return t('card.promptBadJson')
  }
}

/** 挂起「编公共提示词」那一族：`input.shown` 是屏上那张卡（getter） */
export function usePromptDraft(input: { shown: () => CardData }): PromptDraftApi {
  /** 改过的正文，按 id 索引（没有这一条 = 没改过：显示卡里的） */
  const drafts = ref<Record<string, string>>({})
  /** 卡里那 7 条（草稿的底，「改没改」也拿它比） */
  const base = computed(() => slotsOf(input.shown()))
  const entries = computed(() =>
    base.value.map((slot) => {
      const body = drafts.value[slot.id] ?? slot.body
      return { id: slot.id, name: t(slot.nameKey), body, lines: body.split('\n').length }
    }),
  )
  const dirty = computed(() => entries.value.some((one, index) => one.body !== base.value[index].body))

  /** 这一条正文过不了自己的格式时那句话（取不到那一条就回空串 —— 界面上就是"没有那句话"） */
  function problem(id: string): string {
    const found = entries.value.find((one) => one.id === id)
    return found === undefined ? '' : problemOf(found.id, found.body)
  }

  /** 正文改了：改回与卡里逐字相同就把草稿收掉（那是"没改"，不是"改成了一个一样的值"） */
  function setBody(id: string, text: string): void {
    const original = base.value.find((slot) => slot.id === id)
    if (original !== undefined && original.body === text) delete drafts.value[id]
    else drafts.value[id] = text
  }

  /** 保存之前问一句：草稿里有坏值就回那一条的 id（调用方把它挑到屏上） */
  function badEntry(): string | null {
    const bad = entries.value.find((one) => problemOf(one.id, one.body) !== '')
    return bad === undefined ? null : bad.id
  }

  /** 把草稿写进那份深拷卡（整份正文写回；没改过的那几条一个字节都不动） */
  function applyTo(next: CardData): void {
    base.value.forEach((slot, index) => {
      const body = entries.value[index].body
      if (body === slot.body) return
      if (Object.hasOwn(next.settings, slot.id)) {
        next.settings[slot.id as keyof CardData['settings']] = body.split('\n')
      } else if (slot.id === 'script') {
        next.script = JSON.parse(body) as Record<string, unknown>
      } else {
        next.convention = body.split('\n')
      }
    })
  }

  return { entries, dirty, problem, setBody, badEntry, applyTo }
}
