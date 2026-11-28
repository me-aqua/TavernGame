import { onUnmounted, ref } from 'vue'

/**
 * 一次性成功提示（`[data-save-ok]`）：`flash()` 显示，`timeout` 毫秒后自己消失；
 * 连着闪两次就从第二次重新计时；`hide()` 可提前收起（改草稿 / 撤销 / 复原都立刻收）。
 * 组件卸载时清掉计时器。
 */
export function useFlashMessage(timeout = 3000) {
  const visible = ref(false)
  let timer: number | undefined

  /** 显示提示，并从这一刻起重新计时 */
  function flash(): void {
    visible.value = true
    window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      visible.value = false
    }, timeout)
  }

  /** 立刻收起提示（不计时） */
  function hide(): void {
    visible.value = false
  }

  onUnmounted(() => window.clearTimeout(timer))

  return { visible, flash, hide }
}
