/**
 * 「编一块显示」那一族的草稿 —— 票 8d-① 新增（照 `useStepDraft.ts` 的形状）。
 *
 * `display.sidebar[]` 每一条的四个键（`path` / `title` / `format` / `side`）都只改在**草稿**里；
 * 落卡是 `useBranchDraft` 那一条写路径（本件交出 `applyTo` 与脏，顶栏那颗「保存」一起提交）。
 *
 * ⚠️ **路径与格式一一对应**（`display.ts:50` 的 `FORMAT_CONTAINER` 是私表）：容器定死了那条路径
 *    唯一合法的格式 ⇒ **单独改 `format` 在任何卡上都存不下去**，要连 `path` 一起改。
 * ⚠️ **「＋」的路径由调用方挑**（编辑器挑左栏树上"第一枝没被画过、容器是 `object` 的"）：示例卡上
 *    **没有自由的 `map` 枝**，初值挑 `grouped` 会当场存不下去（票面 §八 订正 2）。
 * ⚠️ **草稿的底是"屏上那张卡"**（`shown`）：存完之后草稿与它逐字相同 ⇒ 顶栏那颗按钮自己变回
 *    按不动，不必另记一份"刚存过"；**没动过的条目一个字节都不写**。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { t } from '../i18n'
import { DISPLAY_FORMATS, DISPLAY_SIDES, type DisplayEntry } from '../game/display'
import type { CardData } from '../game/card'

/** 明细里可编的那四个键 */
export type DisplayKey = 'path' | 'title' | 'format' | 'side'

/** 这一族对外的那几样（`CardEditor` 照这个接线） */
export interface DisplayDraftApi {
  /** 屏上那几条声明（草稿优先）—— 顺序就是画出来的顺序 */
  entries: ComputedRef<DisplayEntry[]>
  /** 正在编的那一条的序号（null = 一条都没选：明细整块不在） */
  at: Ref<number | null>
  /** 干净 ⇔ 草稿与屏上那张卡里那一条数组逐字相同 */
  dirty: ComputedRef<boolean>
  /** 点列表里的一行 */
  pick(index: number): void
  /** 「＋」：加一条到末尾，并立刻选中它（`path` 由调用方按容器挑） */
  add(path: string): void
  /** 明细里某一格的值 */
  setField(index: number, key: DisplayKey, value: string): void
  /** 把草稿写进那份深拷卡（**只有真有草稿时才动**） */
  applyTo(next: CardData): void
}

/** 换一个键的值：`format` / `side` 的值来自那两张词表（控件就是它们，挑不出别的） */
function withField(entry: DisplayEntry, key: DisplayKey, value: string): DisplayEntry {
  if (key === 'path') return { ...entry, path: value }
  if (key === 'title') return { ...entry, title: value }
  if (key === 'format') return { ...entry, format: value as DisplayEntry['format'] }
  return { ...entry, side: value as DisplayEntry['side'] }
}

/** 挂起「编一块显示」那一族：`input.shown` 是屏上那张卡（getter） */
export function useDisplayDraft(input: { shown: () => CardData }): DisplayDraftApi {
  /** 改过的整条数组（null = 一个字没改：屏上显示卡里的） */
  const draft = ref<DisplayEntry[] | null>(null)
  /** 正在编的那一条 */
  const at = ref<number | null>(null)
  /** 卡里那一条数组（草稿的底，「改没改」也拿它比） */
  const base = computed(() => input.shown().display.sidebar)
  const entries = computed(() => draft.value ?? base.value)
  const dirty = computed(
    () => draft.value !== null && JSON.stringify(draft.value) !== JSON.stringify(base.value),
  )

  /** 改一处：整条数组先逐条浅拷（卡自己那几条一个字节都不动），改完记成草稿 */
  function write(change: (list: DisplayEntry[]) => void): void {
    const list = entries.value.map((entry) => ({ ...entry }))
    change(list)
    draft.value = list
  }

  /** 点列表里的一行：明细换成那一条 */
  function pick(index: number): void {
    at.value = index
  }

  /** 「＋」：格式与侧取词表第一个（`key-value` 要的就是 `object` 容器，与调用方挑的路径相符） */
  function add(path: string): void {
    write((list) => {
      list.push({
        path,
        title: t('card.displayNewTitle'),
        format: DISPLAY_FORMATS[0],
        side: DISPLAY_SIDES[0],
      })
    })
    at.value = entries.value.length - 1
  }

  /** 明细里某一格改了（序号是界面上那一条的序号） */
  function setField(index: number, key: DisplayKey, value: string): void {
    write((list) => {
      list[index] = withField(list[index], key, value)
    })
  }

  /** 把草稿写进那份深拷卡（整条数组写回；没草稿时一个字节都不动） */
  function applyTo(next: CardData): void {
    if (draft.value === null) return
    next.display.sidebar = draft.value.map((entry) => ({ ...entry }))
  }

  return { entries, at, dirty, pick, add, setField, applyTo }
}
