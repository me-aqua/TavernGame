import { computed, onUnmounted, ref } from 'vue'
import { cloneCard } from '../cards'
import type { Card } from '../core/types'

/** 撤销 / 复原两摞栈的上限（有界，防止长会话吃内存） */
const HISTORY_LIMIT = 50

/**
 * 编辑器草稿的撤销 / 复原（CONTRACT §8.2）。
 *
 * 两摞有界的卡深拷贝栈：每次改草稿前 `snapshot()` 压入当前卡；`undo()` / `redo()` 把当前卡压进
 * 对侧栈并弹出这一侧栈顶，交给页面 `restore()`（页面负责放回卡、标脏、收起成功提示与错误面板）。
 * 快捷键：`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Y` / `Ctrl/Cmd+Shift+Z` 复原；焦点在输入框里时交给浏览器，
 * `canKey()` 为假（确认层开着）时不响应。
 */
export function useEditorHistory(
  getCard: () => Card | null,
  restore: (card: Card) => void,
  canKey: () => boolean,
) {
  const undoStack = ref<Card[]>([])
  const redoStack = ref<Card[]>([])
  const canUndo = computed(() => undoStack.value.length > 0)
  const canRedo = computed(() => redoStack.value.length > 0)

  /** 改草稿前压快照；新改动清空复原栈（保存不清空） */
  function snapshot(): void {
    const current = getCard()
    if (!current) return
    undoStack.value = [...undoStack.value, cloneCard(current)].slice(-HISTORY_LIMIT)
    redoStack.value = []
  }

  /** 撤销一步：当前卡压进复原栈，弹出撤销栈顶交给 `restore` */
  function undo(): void {
    const current = getCard()
    const previous = undoStack.value[undoStack.value.length - 1]
    if (!current || previous === undefined) return
    undoStack.value = undoStack.value.slice(0, -1)
    redoStack.value = [...redoStack.value, cloneCard(current)].slice(-HISTORY_LIMIT)
    restore(previous)
  }

  /** 复原一步：当前卡压回撤销栈，弹出复原栈顶交给 `restore` */
  function redo(): void {
    const current = getCard()
    const next = redoStack.value[redoStack.value.length - 1]
    if (!current || next === undefined) return
    redoStack.value = redoStack.value.slice(0, -1)
    undoStack.value = [...undoStack.value, cloneCard(current)].slice(-HISTORY_LIMIT)
    restore(next)
  }

  /** 键盘：`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Y` / `Ctrl/Cmd+Shift+Z` 复原；编辑控件里不抢 */
  function onKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    const isUndo = key === 'z' && !event.shiftKey
    const isRedo = key === 'y' || (key === 'z' && event.shiftKey)
    if (!isUndo && !isRedo) return
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
      return
    }
    if (!canKey() || getCard() === null) return
    event.preventDefault()
    if (isUndo) undo()
    else redo()
  }

  window.addEventListener('keydown', onKeydown)
  onUnmounted(() => window.removeEventListener('keydown', onKeydown))

  return { canUndo, canRedo, snapshot, undo, redo }
}
