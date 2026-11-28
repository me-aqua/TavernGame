/**
 * 文档锁（评审 F3）：数组字段的类型锁不能只写「数组字段只留 array」。
 *
 * 同一个事实在代码里有两种数组字段：**0 个字段**的数组字段可以换 `text` / `integer` / `enum`
 * （`StateForm.vue` 的 `typeOptions` 给四档），**有字段**的数组字段才只留 `array`。
 * `v2/CONTRACT.md` 的 §8.2 与 `StateForm.vue` 的类型下拉注释必须同时写出这两档；
 * 只写「数组字段只留 array」会把下一个照文档改代码的人带回旧口径。
 *
 * 这两条是**文档判据**，只读文本、不 import 产品代码；改文案时以契约
 * `.team/test/2026-11-28/契约-评审F1F2-数组字段换数组与消失引用.md` §五 为准。
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

describe('文档口径 · 数组字段的类型锁（评审 F3）', () => {
  it('CONTRACT §8.2 同时写「0 个字段四档」与「有字段只留 array」', () => {
    const line = lineWith(read(CONTRACT), '[data-state-type]')
    expect(line, '必须点名 0 个字段这一档').toContain('0 个字段')
    expect(line, '必须写出四档').toContain('四档')
    expect(line, '必须点名有字段这一档').toContain('有字段')
    expect(line, '旧口径「数组字段只留 array」不能原样留着').not.toContain('；数组字段只留 `array`')
  })

  it('StateForm.vue 的类型下拉注释同样分两档，不再写死「数组字段只留 array」', () => {
    const line = lineWith(read(STATE_FORM), '选项由 `typeOptions` 决定')
    expect(line, '必须写出四档').toContain('四档')
    expect(line, '必须提到有字段这一档').toContain('有字段')
    expect(line, '旧口径「数组字段只留 array」不能原样留着').not.toContain('数组字段只留 array')
  })
})
