/**
 * 编辑器的左右两栏宽度与拖拽（CONTRACT §8.2）：**自由度只有左宽 / 右宽**，中栏恒为余量。
 *
 * 单独一份的原因：夹取规则（两个分隔条都夹着中栏的最小宽）、双击复位、松手落盘这三件事
 * 与「选中什么、保存什么」无关，而 `EditorPage` 已经贴着 800 行闸。
 */
import { reactive } from 'vue'
import type { Ref } from 'vue'
import { asAppError, storage } from '../app-context'
import type { AppError } from '../core/errors'
import { DEFAULT_SETTINGS } from '../core/storage'

const LEFT = { min: 200, max: 480 }
const RIGHT = { min: 240, max: 560 }
/** 中栏的最小宽度：两条分隔条都夹着它，先扣掉再谈左右能多宽 */
const MIDDLE_MIN = 320
const STRIP_WIDTH = 96
const SPLITTER_WIDTH = 6

/** 编辑器栏宽的状态与动作；`rowEl` 是页面那一条四栏横带，`setError` 由页面给（落盘失败进页内错误条） */
export function useEditorColumns(rowEl: Ref<HTMLElement | null>, setError: (error: AppError) => void) {
  const columns = reactive({
    left: DEFAULT_SETTINGS.editorColumns.left,
    right: DEFAULT_SETTINGS.editorColumns.right,
  })

  /** 读一次玩家存过的栏宽（打开编辑器时调；读不出来就沿用默认值） */
  function loadColumns(): void {
    const settings = storage().loadSettings()
    columns.left = settings.editorColumns.left
    columns.right = settings.editorColumns.right
  }

  /**
   * 栏宽的夹取：左 / 右各自 [min, max]，**并且中栏不许小于 320**。
   * 所以每条栏的上限不是写死的常数，而是「当前可用宽度」：
   * `可用 = 总宽 - 另一栏 - 细条 - 中栏最小 - 两条分隔条`，再与自己那一档的 max 取小。
   * 1280 宽、右栏 320 时左栏能到 480；右栏 390 时左栏就只能到 462 —— 中栏那 320 谁也挤不掉。
   * （窗口本身窄到连中栏 320 都放不下时，退回各栏自己的 min：那时哪一栏都不该被压成 0。）
   */
  function clampWidth(px: number, range: { min: number; max: number }, room: number): number {
    const ceiling = Math.max(range.min, Math.min(range.max, room))
    return Math.round(Math.min(ceiling, Math.max(range.min, px)))
  }

  /** 这一栏最多能有多宽：把另一栏、细条、中栏最小与分隔条都先扣掉 */
  function roomFor(which: 'left' | 'right'): number {
    const width = rowEl.value?.clientWidth ?? 0
    const other = which === 'left' ? columns.right : columns.left
    return width - other - STRIP_WIDTH - MIDDLE_MIN - SPLITTER_WIDTH * 2
  }

  /** 栏宽落盘（拖拽松手与双击复位各一次；拖动过程里不写，免得每次 pointermove 都刷 localStorage） */
  function persistColumns(): void {
    try {
      const settings = storage().loadSettings()
      storage().saveSettings({
        ...settings,
        editorColumns: { left: Math.round(columns.left), right: Math.round(columns.right) },
      })
    } catch (cause) {
      setError(asAppError(cause))
    }
  }

  /**
   * 拖分隔条：分隔条**跟着指针走** —— 两条分隔条各自贴在「它右边那一栏」的左边缘上。
   *   · 左分隔条在左栏右侧：往右拖 ⇒ 左栏变宽（`+dx`）；
   *   · 右分隔条在右栏左侧：往左拖 ⇒ 右栏变宽（`-dx`）。
   * 双击恢复默认 280 / 320。
   */
  function startDrag(which: 'left' | 'right', event: PointerEvent): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = which === 'left' ? columns.left : columns.right
    // 拖动中：左栏吃正向位移、右栏吃反向位移，各自夹在允许区间里
    const move = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX
      if (which === 'left') columns.left = clampWidth(startWidth + dx, LEFT, roomFor('left'))
      else columns.right = clampWidth(startWidth - dx, RIGHT, roomFor('right'))
    }
    // 松手：摘掉两个监听，并把这一档栏宽落盘
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      persistColumns()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** 双击分隔条：那一栏回到默认宽并落盘 */
  function resetColumns(which: 'left' | 'right'): void {
    if (which === 'left') columns.left = DEFAULT_SETTINGS.editorColumns.left
    else columns.right = DEFAULT_SETTINGS.editorColumns.right
    persistColumns()
  }

  return { columns, loadColumns, startDrag, resetColumns }
}
