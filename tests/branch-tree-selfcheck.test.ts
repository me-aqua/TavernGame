// @vitest-environment jsdom
/**
 * 票 69 · 段 8b-① 的**自检**：上面那 14 条判据"凭什么能红、一次能红几条"。
 *
 * 契约 `.team/test/2026-09-22/contract-69.md` §四（故障注入表）。这一件**不是产品判据**，
 * 它拿一份**照契约长的替身**（进不了产品的测试替身）跑 `support/branch-tree.ts` 里那同一批
 * `CHECKS`：替身全绿 ⇒ 那些判据不是永远红的；再按 `fault` 把某一样**整条关掉** ⇒ 数它们红几条。
 *
 * ⚠️ `fault` 一次只关一样，关的都是"整条能力"（整棵树 / 整个表 / 整条标记），不是改一个数。
 * ⚠️ 那些"红了几条"是**冻结的期望值**：谁把某条判据改弱或删掉，这里当场红 —— 这就是本队
 *    「0 红 = 没牙」的落地形态。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { i18n } from '../src/i18n'
import { schemaElement, schemaFields } from '../src/game/card-state'
import {
  CHECKS,
  ENGINE_ROOTS,
  TREE_PATHS,
  type AnyWrapper,
  fieldsOf,
  schemaAtPath,
  underEngine,
  typeOf,
} from './support/branch-tree'
/** 挂出来的替身一律收摊（与判据那一件同一个习惯） */
afterEach(() => {
  document.body.innerHTML = ''
})

/** 造替身那棵树：`fault` 指名这一次把哪一样整条关掉（空串 = 照契约长全） */
function stubHtml(fault: string, picked: string): string {
  const rows = fault === 'notree' ? [] : TREE_PATHS.map((path) => ({ path, inert: false }))
  // 混进树里的标量：**真的多一行**（裁决 1 的字面意思：标量字段不许进树）
  if (fault === 'scalars') rows.push({ path: fieldsOf(TREE_PATHS[0])[0], inert: true })
  const nav = rows
    .map((row) => {
      const kind =
        fault === 'kinds' || row.inert ? '' : ` data-branch-type="${typeOf(schemaAtPath(row.path))}"`
      const on = row.path === picked ? ' data-branch-on' : ''
      const taken = row.path === ENGINE_ROOTS[0] ? ' data-branch-takeover' : ''
      return `<button data-branch-node="${row.path}"${kind}${on}${taken}>${row.path}</button>`
    })
    .join('')
  const head = picked === '' ? '<p data-branch-none></p>' : `<h2 data-branch-title>${picked}</h2>`
  const order = fault === 'roworder' ? [...fieldsOf(picked)].reverse() : fieldsOf(picked)
  const keys = fault === 'noform' ? [] : order
  const fields = keys.map((key, index) => fieldRowHtml(fault, picked, key, index === 0)).join('')
  const table = picked === '' || fields === '' ? '' : `<div data-branch-form>${fields}</div>`
  const legacy = fault === 'legacy' ? '<form data-card-form></form><button data-add="action"></button>' : ''
  return (
    `<section data-col="content">${nav}</section>` +
    `<section data-col="edit"><div data-mid>${head}${table}</div></section>` +
    legacy
  )
}

/**
 * 表里的一行：`roworder` 倒序、`rowname` 换个名字、`ctrls` 塞个输入框、
 * `nodeclare` 不报初值、`treemark-parent-only` 只标第一行（其余行不标 —— A5a 要拦的就是它）。
 */
function fieldRowHtml(fault: string, parent: string, key: string, first: boolean): string {
  const readonly = fault === 'readonly' ? '' : ' data-field-readonly'
  const marked = underEngine(parent + '.' + key)
  // `treemark-parent-only`：只给第一行打标记（其余行漏掉 —— A5a 现在逐行数，会红）
  const taken = (fault === 'treemark-parent-only' ? first : marked) ? ' data-field-takeover' : ''
  const label = fault === 'rowname' ? String(fieldsOf(parent)[0]) : key
  const ctrl = fault === 'ctrls' ? '<input data-field-value />' : ''
  const initial = fault === 'nodeclare' ? '' : ` data-field-initial="${declaredInitial(parent, key)}"`
  const attrs = ['data-field-row', `data-field-key="${key}"`, `data-field-parent="${parent}"`]
  const open = `<div ${attrs.join(' ')}${readonly}${taken}${initial}>`
  return `${open}<span data-field-name>${label}</span>${ctrl}</div>`
}

/** 卡里那一栏有没有声明 `initial`（替身照卡的声明报，与真组件同一个来源） */
function declaredInitial(parent: string, key: string): string {
  const node = schemaAtPath(parent)
  // ⚠️ `Schema` 含字符串缩写、还可能是 `undefined`，而 `schemaFields` / `schemaElement`
  //    认得字符串缩写（直接取 `node.fields` 会被类型拦下：那是 `object` 独有的键）
  const own = node === undefined ? undefined : schemaFields(node)
  const element = node === undefined ? undefined : schemaElement(node)
  const scope = own ?? (element === undefined ? undefined : schemaFields(element))
  const field = scope === undefined ? undefined : scope[key]
  return typeof field === 'object' && field !== null && Object.hasOwn(field, 'initial') ? 'yes' : 'no'
}

/**
 * 替身：一份照契约长的最小界面（左栏那棵树 + 中栏那张只读表），`innerHTML` 铺出来、
 * 点击走事件委托。它**不进产品**，只为让那 14 条判据在一个"做对了"的树上跑一遍。
 */
const BranchStub = defineComponent({
  name: 'BranchEditorStub',
  props: { fault: { type: String, default: '' } },
  /** 点树上一行 = 选中它（其余和真界面一样） */
  setup(props) {
    const picked = ref('')
    /** 点到了哪一行：把 `data-branch-node` 的值记下来当选中 */
    const onClick = (event: MouseEvent) => {
      const row = (event.target as Element).closest('[data-branch-node]')
      if (row) picked.value = row.getAttribute('data-branch-node') ?? ''
    }
    return () => h('div', { 'data-card-editor': '', innerHTML: stubHtml(props.fault, picked.value), onClick })
  },
})

/** 挂一版替身：同一批判据在它身上跑（`fault` 决定关掉哪一样） */
function stub(fault: string): AnyWrapper {
  return mount(BranchStub, {
    props: { fault },
    global: { plugins: [i18n] },
    attachTo: document.body,
  }) as AnyWrapper
}

/** 在替身上跑完那 14 条判据，返回红了的那些编号（**每条各挂一版**：判据之间不许互相带状态） */
async function redsOn(fault: string): Promise<string[]> {
  const red: string[] = []
  for (const check of CHECKS) {
    const w = stub(fault)
    try {
      await check.run(w)
    } catch {
      red.push(check.id)
    } finally {
      w.unmount()
    }
  }
  return red
}

/**
 * 故障矩阵：一次整条关掉一样能力，数它红几条。第一条是**通道自检**（替身照契约长 ⇒ 0 红），
 * 有了它，下面那些数才不是"永远红"。
 *
 * ⚠️ 这些数**不是推出来的**：`.team/test/2026-09-22/probe-69-simulate-selfcheck.mjs` 把替身与
 *    16 条判据的逻辑各照抄一遍跑出来的（本机跑不了 vitest），**组长 2026-09-22 的全权限复跑**
 *    又把 `notree`/`scalars`/`noform`/`readonly` 四条对过一遍 —— 两处一致。
 */
const FAULTS: Array<{ fault: string; reds: string[] }> = [
  { fault: '', reds: [] },
  {
    fault: 'notree',
    reds: [
      'A1a',
      'A1b',
      'A1c',
      'A1d',
      'A2b',
      'A2c',
      'A2d',
      'A3a',
      'A3b',
      'A4a',
      'A4b',
      'A5a',
      'A5b',
      'A6a',
      'A6b',
    ],
  },
  { fault: 'scalars', reds: ['A1a', 'A1b', 'A1d'] },
  { fault: 'kinds', reds: ['A1c'] },
  { fault: 'noform', reds: ['A2b', 'A2c', 'A2d', 'A3a', 'A3b', 'A4a', 'A4b', 'A5a', 'A5b'] },
  { fault: 'roworder', reds: ['A2b', 'A2c', 'A3a'] },
  { fault: 'rowname', reds: ['A3b'] },
  { fault: 'readonly', reds: ['A4a', 'A5b'] },
  { fault: 'ctrls', reds: ['A4b'] },
  { fault: 'legacy', reds: ['A4b'] },
  { fault: 'nodeclare', reds: ['A2d'] },
  // S3 复核补的洞：只标 `world.time` 的**第一行**、其余四个整数不标 ——
  // A5a 原来只断"有那么几行带"，这种也全绿（组长 2026-09-22 点头 ⇒ 用例数 +1）
  { fault: 'treemark-parent-only', reds: ['A5a'] },
]

describe('self-check: these criteria can go red, and by how much', () => {
  for (const one of FAULTS) {
    it(`T ${one.fault || 'as-contracted'} turns exactly [${one.reds.join(' ')}] red`, async () => {
      expect(await redsOn(one.fault)).toEqual(one.reds)
    })
  }
})
