/**
 * src/composables/useDownload.ts —— 浏览器原生下载
 *
 * 浏览器不允许脚本直接「保存文件」，所以办法是：
 * 造一个隐藏的 <a download>，让它替你去点一下。
 */

/** 用隐藏的 <a download> 触发一次文件下载 */
export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // ⚠️ 不能紧跟 click() 同步释放：部分浏览器会在下载真正启动前就把 blob 撤掉。
  //    惯例是推迟到下一个事件循环。
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 弹出一个文件选择框，返回用户选中的文件（取消则返回 null） */
export function pickFile(accept = '.json,application/json'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => resolve(input.files?.[0] ?? null)
    // 用户直接关掉对话框时不会触发 change；这里不额外处理，
    // 因为 File 对话框没有可靠的取消事件，留着 Promise 挂着也无害。
    input.click()
  })
}
