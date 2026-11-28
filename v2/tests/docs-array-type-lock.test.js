/**
 * 文档锁（本票 §2 / §3）：**数组字段的类型锁只有一档** —— 有没有字段都列四档。
 *
 * 旧口径（`0 个字段四档 / 有字段只留 array`）在本票被推翻：有字段的数组字段换成标量时
 * 每个外层实例取第一个内层 item，其余丢弃（`CONTRACT §2.1`）。`v2/CONTRACT.md` 的 §8.2
 * 与 `StateForm.vue` 的类型下拉注释必须同时写出新口径；只留旧句子会把下一个照文档改代码的人
 * 带回旧行为。
 *
 * 这两条是**文档判据**，只读文本、不 import 产品代码；口径来源是
 * `.team/test/2026-11-28/契约-数组字段转标量-类型下拉-撤销重做.md` §2.4 / §3。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACT = join(HERE, '..', 'CONTRACT.md')
const STATE_FORM = join(HERE, '..', 'src', 'components', 'StateForm.vue')

function read(path) {
  return readFileSync(path, 'utf8')
}

/** 找到含某个锚点的唯一一行；找不到就让这条判据红（不静默跳过） */
function lineWith(text, anchor) {
  const line = text.split('\n').find((candidate) => candidate.includes(anchor))
  expect(line, `文档里找不到锚点：${anchor}`).toBeTruthy()
  return line
}

describe('文档口径 · 数组字段的类型锁（本票 §2.4 / §3）', () => {
  it('CONTRACT §8.2 写「数组字段一律四档」，两者都覆盖，不再留旧分档', () => {
    const line = lineWith(read(CONTRACT), '[data-state-type]')
    expect(line, '必须写出四档').toContain('四档')
    expect(line, '必须覆盖「有字段」这一档').toContain('有字段')
    expect(line, '必须覆盖「0 个字段」这一档').toContain('0 个字段')
    expect(line, '旧口径「有字段只留 array」不能原样留着').not.toContain('有字段只留 `array`')
    expect(line, '旧口径「0 个字段列四档」不能原样留着').not.toContain('0 个字段列四档')
  })

  it('StateForm.vue 的类型下拉注释同样写四档，不再写死「有字段只留 array」', () => {
    const line = lineWith(read(STATE_FORM), '选项由 `typeOptions` 决定')
    expect(line, '必须写出四档').toContain('四档')
    expect(line, '必须提到数组字段').toContain('数组字段')
    expect(line, '旧口径「只留 array」不能原样留着').not.toContain('只留 array')
  })
})
