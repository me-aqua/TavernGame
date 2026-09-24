/**
 * display 测试 —— 段 6 之后这一层只剩两件事：**节点显示名**，以及"引擎不再持有第二份块词表"。
 *
 * 这一份原来是 11 条（`displayOf` 的旧形状 / `checkRenderable` 的专用词表 / `mapOf` ·
 * `castOf` · `packOf` · `spotOf` 四个专用取数器）。段 6 把那些形状都换掉了：
 *   · 侧栏改成卡声明（路径 + 标题 + 格式），那份声明**只此一处** ⇒ 旧的块名词表没了；
 *   · 面板数据不再由引擎按块名取，改成按声明里的**路径**取 ⇒ 四个专用取数器没了。
 * ⇒ 声明侧的新判据在 `display-format.test.ts`，渲染侧在 `display-render-dom.test.ts`。
 *
 * ⚠️ 旧表读的是 `import * as card`（不是具名 import）：那两张表这一段**就是被删掉的东西**，
 *    具名 import 一个不存在的导出会在收集阶段炸掉整个文件（一条用例都跑不到）。
 */
import { describe, expect, it } from 'vitest'
import * as cardModule from '../src/game/card'
import * as displayModule from '../src/game/display'
import { nodeLabel } from '../src/game/display'
import { currentCard } from '../src/game/current-card'

/**
 * 引擎里那些"块名 → 路径 / 取数器"的老面孔（段 6 之后不该还在）。
 *
 * 两张表 + 转发它们的两个常量 + 四个按块名取数的函数：都是"引擎认识内容"的形态，
 * R12/R13 之后一块都不留 —— 声明在卡里，取数走声明里的路径。
 */
const OLD_BLOCK_TABLES = [
  'SIDEBAR_BLOCKS',
  'BLOCK_STATE_PATHS',
  'KNOWN_BLOCKS',
  'KNOWN_TOPBAR',
  'mapOf',
  'castOf',
  'packOf',
  'spotOf',
]

describe('the sidebar vocabulary lives in the card, not in the engine', () => {
  it('24 the engine keeps no block-name table of its own any more', () => {
    const still = OLD_BLOCK_TABLES.filter((name) =>
      Object.hasOwn(cardModule as unknown as Record<string, unknown>, name),
    ).concat(
      OLD_BLOCK_TABLES.filter((name) =>
        Object.hasOwn(displayModule as unknown as Record<string, unknown>, name),
      ),
    )
    expect(still, 'the engine still carries a block-name table: ' + still.join(' / ')).toEqual([])
  })

  it('25 the sidebar declaration is read straight out of the card, in the declared order', () => {
    const declared = (JSON.parse(JSON.stringify(currentCard.display)) as Record<string, any>)
      .sidebar as Array<Record<string, unknown>>
    expect(declared.length, 'the demo card declares an empty sidebar').toBeGreaterThan(0)
    // 一个事实只有一处能改：声明里那四样就是画出来要用的四样，引擎不另存一份
    for (const entry of declared) {
      expect(Object.keys(entry).sort(), 'a sidebar entry carries keys no entry has').toEqual([
        'format',
        'path',
        'side',
        'title',
      ])
    }
  })
})

describe('nodeLabel', () => {
  it('26 reads the display name the card gave the node', () => {
    const id = currentCard.graph.topology[0]
    expect(nodeLabel(currentCard, id)).toBe(currentCard.graph.nodes[id].name)
  })

  it('27 throws for a node the card does not have (no silent fallback to the id)', () => {
    expect(() => nodeLabel(currentCard, 'no-such-node')).toThrow('no-such-node')
  })
})
