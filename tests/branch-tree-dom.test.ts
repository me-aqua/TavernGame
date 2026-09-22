// @vitest-environment jsdom
/**
 * 票 69 · 段 8b-①：**左栏枝树 + 中栏只读字段表**的判据（A1–A6，16 条）。
 *
 * 契约 `.team/test/2026-09-22/contract-69.md`；口径来自 S0 `.team/leader/2026-09-22/段8b-S0.md`
 * 的 **§十二 A1–A7**（配 §十一 的 16 条裁决）。判据表、期望值、DOM 读数都在
 * `tests/support/branch-tree.ts`（与自检那一件共用同一份）。
 *
 * ⚠️ **几何不在这里量**（jsdom 没有布局）：列宽、横向溢出、点按区 24×24、旧接缝退场
 *    都在 `e2e/smoke.spec.ts` 的「左栏是枝的导航树」那条用例里对着真浏览器量。
 * ⚠️ 判据一律挂在 `CardEditor.vue` 这个**现成的接缝**上（`card-ui.test.ts:359` 已经这么挂）：
 *    新组件是它内部 import 的子组件（契约点名 `src/components/StateTreeNav.vue` 与
 *    `src/components/BranchForm.vue`），但必须能被 `CardEditor` 渲染出来 —— 这条钉住的是
 *    「换内容不换接缝」，也让"功能没做"的红落在**钩子不在**上，不是"模块找不到"上。
 *
 * 🔴 功能没做时这一族全红（今天就是），而且红在「钩子不在」上 ——
 *    "这些判据凭什么能红"在 `branch-tree-selfcheck.test.ts`（替身 + 十一次故障注入）。
 */
import { afterEach, describe, it } from 'vitest'
import { CHECKS, editor } from './support/branch-tree'

/** 挂出来的东西一律收摊：槽里的组件都要卸载，收工要清干净 */
afterEach(() => {
  document.body.innerHTML = ''
})

describe('the branch tree and the read-only field table (A1-A6)', () => {
  for (const check of CHECKS) {
    it(`${check.id} ${check.what}`, async () => {
      const w = editor()
      try {
        await check.run(w)
      } finally {
        w.unmount()
      }
    })
  }
})
