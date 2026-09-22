// @vitest-environment jsdom
/**
 * 票 70 · 段 8b-②：**左栏枝树 + 中栏可写字段表**的判据（A1–A6 + B1–B4，27 条）。
 *
 * 契约 `.team/test/2026-09-22/contract-70.md`（上一票是 `contract-69.md`：那时中栏只读）；
 * 口径来自 S0 `.team/leader/2026-09-22/段8b2-S0.md` 的 **§十二 W1–W10**（配 §十一 的 11 条裁决）。
 * 判据表、期望值、DOM 读数都在 `tests/support/branch-tree.ts`（与自检那一件共用同一份）。
 *
 * ⚠️ **几何不在这里量**（jsdom 没有布局）：列宽、横向溢出、点按区 24×24、旧接缝退场
 *    都在 `e2e/smoke.spec.ts` 的「左栏是枝的导航树」那条用例里对着真浏览器量。
 * ⚠️ 判据一律挂在 `CardEditor.vue` 这个**现成的接缝**上（`card-ui.test.ts:359` 已经这么挂）：
 *    新组件是它内部 import 的子组件（契约点名 `src/components/StateTreeNav.vue` 与
 *    `src/components/BranchForm.vue`），但必须能被 `CardEditor` 渲染出来 —— 这条钉住的是
 *    「换内容不换接缝」，也让"功能没做"的红落在**钩子不在**上，不是"模块找不到"上。
 *
 * 🔴 **本票的起点读数：27 条里 14 条红**（A1e / A4a / A4b / A5b + 十条 B）—— 全是"**功能没做**"
 *    那一种红（写的那一族今天一条都不存在），红在**钩子不在**上。
 *    "这 14 条凭什么能红、又能绿"在 `branch-tree-selfcheck.test.ts`（替身 + 十七条故障注入）。
 */
import { afterEach, describe, it } from 'vitest'
import { CHECKS, editor } from './support/branch-tree'

/** 挂出来的东西一律收摊：槽里的组件都要卸载，收工要清干净 */
afterEach(() => {
  document.body.innerHTML = ''
})

describe('the branch tree and the writable field table (A1-A6, B1-B4)', () => {
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
