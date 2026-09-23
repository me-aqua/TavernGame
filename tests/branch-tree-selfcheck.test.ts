// @vitest-environment jsdom
/**
 * 票 70 · 段 8b-② 的**自检**：那 27 条判据"凭什么能红、一次能红几条"。
 *
 * 契约 `.team/test/2026-09-22/contract-70.md` §4（故障注入表）。这一件**不是产品判据**：
 * 它拿一份**照契约长的替身**（进不了产品的测试替身）跑 `support/branch-tree.ts` 里那同一批
 * `CHECKS`：替身全绿 ⇒ 那些判据不是永远红的；再按 `fault` 把某一样**整条关掉** ⇒ 数它们红几条。
 *
 * ⚠️ `fault` 一次只关一样，关的都是"整条能力"（整棵树 / 整个表 / 整条标记 / 整个保存路径）。
 * ⚠️ 那些"红了几条"是**冻结的期望值**：谁把某条判据改弱或删掉，这里当场红 —— 这就是本队
 *    「0 红 = 没牙」的落地形态。
 * ⚠️ 本票的替身**自己会改卡**（深拷 → 只改这几处 → `importCard` → 失败只报不改）：
 *    照契约 §1.4 那条保存路径长，否则写的那一族判据（B2 / B3 / B4）在替身上永远是红的，
 *    "能绿"就没人证得了。
 * ⚠️ 判据那一侧**每次重新查 DOM**（组件换格 / 保存 / 报错都可能整行重画）：替身用
 *    `innerHTML` 铺屏，抓着上一次的元素不放就是点一个已经离屏的节点。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { i18n } from '../src/i18n'
import { importCard } from '../src/game/current-card'
import { schemaElement, schemaFields } from '../src/game/card-state'
import {
  CHECKS,
  ENGINE_ROOTS,
  TREE_PATHS,
  type AnyWrapper,
  type CardJson,
  declaredNote,
  fieldsOf,
  schemaAtPath,
  tableIn,
  underEngine,
  typeOf,
} from './support/branch-tree'
import { card } from './support/branch-tree'
/** 挂出来的替身一律收摊（与判据那一件同一个习惯） */
afterEach(() => {
  document.body.innerHTML = ''
})

/** 替身的状态：草稿 / 待删 / 那一行新行 / 报错 —— 只够让那 27 条判据跑一遍 */
interface StubState {
  /** 选中的那一格（空串 = 还没选） */
  picked: string
  /** 说明的草稿，按「哪一格 + 哪个键」索引（换格再切回来还在） */
  notes: Record<string, string>
  /** 待删的行（保存时才真删） */
  gone: Record<string, boolean>
  /** 刚开出来、还没保存的那一行（同时只开一行） */
  fresh: { key: string; kind: string; note: string; initial: string } | null
  /** 上一次保存被拒的原因（空串 = 没有） */
  error: string
  /** 上一次保存被拒了 ⇒ 这次改动涉及的行都打上 `data-row-bad` */
  bad: boolean
}

/** 这一行在这次保存里被改过吗（报错时要指出**是哪一行** —— 契约 §1.4） */
function involved(s: StubState, parent: string, key: string): boolean {
  const id = idOf(parent, key)
  if (s.gone[id] === true) return true
  const draft = s.notes[id]
  return draft !== undefined && draft.trim() !== (declaredNote(parent, key) ?? '').trim()
}

/** 草稿的 id：哪一格 + 哪个键 */
function idOf(parent: string, key: string): string {
  return parent + '|' + key
}

/**
 * 铺进 `innerHTML` 的那点转义。
 *
 * ⚠️ 卡里的 `note` **真的带引号**（`{"好感": 80}` 那种）—— 不转义就会把 `value="…"` 提前收掉，
 *    于是替身报的是"值少了一截"（第一次跑出来的就是这条，长得像判据写错了）。
 */
function esc(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
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

/** 说明那一格：可编的一个输入框、只读的一行文字（契约 §三.1 的两态） */
function noteCellHtml(fault: string, taken: boolean, note: string): string {
  if (fault === 'nonote' || taken) return `<span data-field-note-locked>${esc(note)}</span>`
  const empty = note === '' ? ' data-field-note-empty' : ''
  // `deadctrls`：控件都在、形状也对，就是**一个都点不动**（票 71 的 A4c 要咬的就是它）
  const dead = fault === 'deadctrls' ? ' disabled' : ''
  return `<input data-field-note value="${esc(note)}"${empty}${dead}>`
}

/** 行尾那一格：可删的一颗垃圾桶、接管行写"为什么没有"（老板拍的：界面不做硬锁） */
function tailHtml(fault: string, taken: boolean): string {
  if (taken || fault === 'nodel') return '<span class="locked"></span>'
  return '<button data-field-del>-</button>'
}

/** 表里的一行（说明格 / 初值列 / 行尾三样都照契约长） */
function rowHtml(fault: string, s: StubState, parent: string, key: string, first: boolean): string {
  const taken = underEngine(parent + '.' + key)
  const mark = fault === 'readonlyall' ? true : fault === 'readonly' ? false : taken
  const attrs = ['data-field-row', `data-field-key="${key}"`, `data-field-parent="${parent}"`]
  if (fault !== 'nodeclare') attrs.push(`data-field-initial="${declaredInitial(parent, key)}"`)
  if (mark) attrs.push('data-field-readonly')
  if (s.gone[idOf(parent, key)]) attrs.push('data-row-pending-del')
  if (s.bad && involved(s, parent, key)) attrs.push('data-row-bad')
  const label = fault === 'rowname' ? String(fieldsOf(parent)[0]) : key
  // `treemark-parent-only`：只给第一行打标记（其余行漏掉 —— A5a 逐行数，会红）
  const shown = fault === 'treemark-parent-only' ? first : taken
  if (shown) attrs.push('data-field-takeover')
  const cells = [
    `<span data-field-name>${esc(label)}</span>`,
    '<span class="kind"></span>',
    noteCellHtml(fault, taken, declaredNote(parent, key) ?? ''),
    `<span class="initial">${declaredInitial(parent, key)}</span>`,
    tailHtml(fault, taken),
  ]
  // 白名单之外多出来的一个控件：只长在作者的行上（长在接管行上会顺带踩到 A4a，那就不是"一次只关一样"）
  if (fault === 'ctrls' && !taken) cells.push('<input data-field-value>')
  return `<div ${attrs.join(' ')}>${cells.join('')}</div>`
}

/** 刚开出来的那一行（保存之前它只活在界面上） */
function freshHtml(fault: string, s: StubState, parent: string): string {
  const f = s.fresh
  if (f === null) return ''
  const attrs = [
    'data-field-row',
    'data-row-new',
    `data-field-parent="${parent}"`,
    `data-field-initial="${f.initial.trim() === '' ? 'no' : 'yes'}"`,
  ]
  if (s.bad) attrs.push('data-row-bad')
  const dead = fault === 'deadctrls' ? ' disabled' : ''
  return (
    `<div ${attrs.join(' ')}>` +
    `<input data-field-key-new value="${esc(f.key)}"${dead}>` +
    '<select data-field-kind-new' +
    dead +
    '><option value="string">text</option><option value="integer">number</option></select>' +
    noteCellHtml(fault, false, f.note) +
    `<input data-field-initial-new value="${esc(f.initial)}"${dead}>` +
    tailHtml(fault, false) +
    '</div>'
  )
}

/** 有改动吗（干净 ⇒ 保存按不动）—— 草稿与卡里的值**逐字**比 */
function dirty(s: StubState): boolean {
  if (s.fresh !== null) return true
  if (Object.values(s.gone).some(Boolean)) return true
  return Object.entries(s.notes).some(([id, text]) => {
    const [parent, key] = id.split('|')
    const want = declaredNote(parent, key) ?? ''
    return text.trim() === '' ? want !== '' : text !== want
  })
}

/** 造替身那一屏：顶栏 + 左栏树 + 中栏表（`fault` 指名这一次把哪一样整条关掉） */
function stubHtml(fault: string, s: StubState): string {
  const rows = fault === 'notree' ? [] : TREE_PATHS.map((path) => ({ path, inert: false }))
  // 混进树里的标量：**真的多一行**（裁决 1 的字面意思：标量字段不许进树）
  if (fault === 'scalars') rows.push({ path: fieldsOf(TREE_PATHS[0])[0], inert: true })
  const nav = rows
    .map((row) => {
      const kind =
        fault === 'kinds' || row.inert ? '' : ` data-branch-type="${typeOf(schemaAtPath(row.path))}"`
      const depth = fault === 'nodepth' ? '' : ` data-branch-depth="${row.path.split('.').length}"`
      const on = row.path === s.picked ? ' data-branch-on' : ''
      const taken = row.path === ENGINE_ROOTS[0] ? ' data-branch-takeover' : ''
      return `<button data-branch-node="${esc(row.path)}"${kind}${depth}${on}${taken}>${esc(row.path)}</button>`
    })
    .join('')
  const head = s.picked === '' ? '<p data-branch-none></p>' : `<h2 data-branch-title>${esc(s.picked)}</h2>`
  const order = fault === 'roworder' ? [...fieldsOf(s.picked)].reverse() : fieldsOf(s.picked)
  const keys = s.picked === '' || fault === 'noform' ? [] : order
  const body =
    keys.map((key, index) => rowHtml(fault, s, s.picked, key, index === 0)).join('') +
    freshHtml(fault, s, s.picked)
  const table =
    keys.length === 0 ? '' : `<div data-branch-form>${body}<button data-field-add>add a field</button></div>`
  const save = fault === 'nosave' ? '' : `<button data-card-save${dirty(s) ? '' : ' disabled'}>save</button>`
  const error = s.error === '' ? '' : `<p data-card-error>${esc(s.error)}</p>`
  const legacy = fault === 'legacy' ? '<form data-card-form></form><button data-add="action"></button>' : ''
  return (
    `<header data-top>${save}</header>` +
    `<section data-col="content">${nav}</section>` +
    `<section data-col="edit"><div data-mid>${head}${error}${table}</div></section>` +
    legacy
  )
}

/**
 * 替身照契约 §1.4 那条保存路径改卡：深拷 → 只改这几处 → `importCard` → 失败只报不改。
 *
 * ⚠️ 界面自己挡的三件事（W7）在这里：trim 后非空 · 不含 `.` · 不与同格已有的键重名 ——
 *    校验器一件都不管（实测：`""` / `" "` / `"a.b"` 全都过 `checkSchema`）。
 */
function save(s: StubState, done: () => void): void {
  const next = JSON.parse(JSON.stringify(card)) as CardJson
  for (const [id, text] of Object.entries(s.notes)) {
    const [parent, key] = id.split('|')
    const field = tableIn(next, parent)[key]
    if (field === undefined) continue
    if (text.trim() === '') delete field.note
    else field.note = text.trim()
  }
  for (const id of Object.keys(s.gone)) {
    if (!s.gone[id]) continue
    const [parent, key] = id.split('|')
    delete tableIn(next, parent)[key]
  }
  if (s.fresh !== null) {
    const name = s.fresh.key.trim()
    if (name === '') {
      s.error = 'the key name must not be empty'
      s.bad = true
      return
    }
    if (name.includes('.')) {
      s.error = 'the key name must not contain a dot'
      s.bad = true
      return
    }
    const table = tableIn(next, s.picked)
    if (Object.hasOwn(table, name)) {
      s.error = 'this node already has that key'
      s.bad = true
      return
    }
    const field: Record<string, unknown> = { type: s.fresh.kind }
    if (s.fresh.initial.trim() !== '') {
      field.initial = s.fresh.kind === 'integer' ? Number(s.fresh.initial) : s.fresh.initial
    }
    if (s.fresh.note !== '') field.note = s.fresh.note
    table[name] = field
  }
  try {
    importCard(JSON.stringify(next))
    s.error = ''
    s.bad = false
    s.notes = {}
    s.gone = {}
    s.fresh = null
    done()
  } catch (err) {
    // 边界：改动是人填的 —— 卡拒了只报不改（存储与内存都不动）
    s.error = (err as Error).message
    s.bad = true
  }
}

/**
 * 替身：一份照契约长的最小界面（顶栏那颗保存 + 左栏树 + 中栏可写字段表），`innerHTML` 铺出来、
 * 点击与输入走事件委托。它**不进产品**，只为让那 27 条判据在一个"做对了"的界面上跑一遍。
 */
const BranchStub = defineComponent({
  name: 'BranchEditorStub',
  props: { fault: { type: String, default: '' } },
  emits: ['saved'],
  /** 替身的状态都在这一个 ref 里：点与输入改它，渲染函数照它铺那一屏 */
  setup(props, { emit }) {
    const s = ref<StubState>({ picked: '', notes: {}, gone: {}, fresh: null, error: '', bad: false })
    /** 点树上的一行 = 选中它（顺手把没保存的新行收掉） */
    const onClick = (event: MouseEvent) => {
      const el = event.target as Element
      const node = el.closest('[data-branch-node]')
      if (node) {
        s.value.picked = node.getAttribute('data-branch-node') ?? ''
        s.value.fresh = null
        return
      }
      if (el.closest('[data-field-add]')) {
        s.value.fresh = { key: '', kind: 'string', note: '', initial: '' }
        // 新行的键名格拿到焦点（判据 B3a 断它）
        void nextTick(() => {
          const box = document.querySelector('[data-row-new] [data-field-key-new]')
          if (box instanceof HTMLElement) box.focus()
        })
        return
      }
      const row = el.closest('[data-field-row]')
      if (el.closest('[data-field-del]') && row !== null) {
        if (row.hasAttribute('data-row-new')) {
          s.value.fresh = null
          return
        }
        const id = idOf(row.getAttribute('data-field-parent') ?? '', row.getAttribute('data-field-key') ?? '')
        s.value.gone[id] = !s.value.gone[id]
        return
      }
      if (el.closest('[data-card-save]')) save(s.value, () => emit('saved'))
    }
    /** 输入：说明那一格按行分流（新行的三格各有自己的草稿） */
    const onInput = (event: Event) => {
      const el = event.target as HTMLInputElement
      const row = el.closest('[data-field-row]')
      if (row === null) return
      const parent = row.getAttribute('data-field-parent') ?? ''
      if (el.hasAttribute('data-field-key-new') && s.value.fresh !== null) {
        s.value.fresh.key = el.value
        return
      }
      if (el.hasAttribute('data-field-kind-new') && s.value.fresh !== null) {
        s.value.fresh.kind = el.value
        return
      }
      if (el.hasAttribute('data-field-initial-new') && s.value.fresh !== null) {
        s.value.fresh.initial = el.value
        return
      }
      if (!el.hasAttribute('data-field-note')) return
      if (row.hasAttribute('data-row-new') && s.value.fresh !== null) s.value.fresh.note = el.value
      else s.value.notes[idOf(parent, row.getAttribute('data-field-key') ?? '')] = el.value
    }
    return () =>
      h('div', {
        'data-card-editor': '',
        innerHTML: stubHtml(props.fault, s.value),
        onClick,
        onInput,
      })
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

/** 在替身上跑完那 27 条判据，返回红了的那些编号（**每条各挂一版**：判据之间不许互相带状态） */
async function redsOn(fault: string): Promise<string[]> {
  const red: string[] = []
  for (const check of CHECKS) {
    const w = stub(fault)
    try {
      await check.run(w)
    } catch (err) {
      if (process.env.ZOF70_DEBUG === '1') console.log(check.id + ' :: ' + (err as Error).message)
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
 * ⚠️ 这些数是**跑出来的**（`node .tools/zof69-vitest.mjs tests/branch-tree-selfcheck.test.ts`），
 *    不是推出来的 —— 8b-① 那一票在这件事上栽过两次（凭"注入 ⇒ 哪条会红"推期望值）。
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
      'A1e',
      'A2b',
      'A2c',
      'A2d',
      'A3a',
      'A3b',
      'A4a',
      'A4b',
      'A4c',
      'A5a',
      'A5b',
      'A6a',
      'A6b',
      'B1a',
      'B2a',
      'B2b',
      'B3a',
      'B3b',
      'B3c',
      'B3d',
      'B4a',
      'B4b',
      'B4c',
    ],
  },
  { fault: 'scalars', reds: ['A1a', 'A1b', 'A1d'] },
  { fault: 'kinds', reds: ['A1c'] },
  { fault: 'nodepth', reds: ['A1e'] },
  {
    fault: 'noform',
    reds: [
      'A2b',
      'A2c',
      'A2d',
      'A3a',
      'A3b',
      'A4a',
      'A4b',
      'A4c',
      'A5a',
      'A5b',
      'B1a',
      'B2a',
      'B2b',
      'B3a',
      'B3b',
      'B3c',
      'B3d',
      'B4a',
      'B4b',
      'B4c',
    ],
  },
  { fault: 'roworder', reds: ['A2b', 'A2c', 'A3a'] },
  { fault: 'rowname', reds: ['A3b'] },
  { fault: 'readonly', reds: ['A4a'] },
  { fault: 'readonlyall', reds: ['A4a', 'A5b'] },
  { fault: 'ctrls', reds: ['A4b'] },
  // 票 71 的 A4c：四个控件都在、形状也对，就是全 `disabled` —— 只有"能不能用"那一条咬得到
  { fault: 'deadctrls', reds: ['A4c', 'B2a', 'B2b', 'B3a', 'B3b', 'B3c', 'B4a', 'B4b'] },
  { fault: 'legacy', reds: ['A4b'] },
  { fault: 'nodeclare', reds: ['A2d'] },
  // 票 69 那条洞（只标第一行）：A4a 改成"逐行 ⇔"之后**多红一条** A4a —— 标记落在作者的行上，
  // 而 A4a 现在两边都管。A5b 同时红是因为那张表里"接管行"少了、`readonly` 就露出来了。**三条都是对的。**
  { fault: 'treemark-parent-only', reds: ['A4a', 'A5a', 'A5b'] },
  { fault: 'nonote', reds: ['A4b', 'A4c', 'B1a', 'B2a', 'B2b', 'B4a'] },
  { fault: 'nodel', reds: ['B3a', 'B3d', 'B4c'] },
  { fault: 'nosave', reds: ['A4c', 'B2a', 'B2b', 'B3b', 'B3c', 'B3d', 'B4a', 'B4b', 'B4c'] },
]

describe('self-check: these criteria can go red, and by how much', () => {
  for (const one of FAULTS) {
    it(`T ${one.fault || 'as-contracted'} turns exactly [${one.reds.join(' ')}] red`, async () => {
      const red = await redsOn(one.fault)
      // `ZOF70_DEBUG=1` 时打一行机器可读的读数：改判据之后重算这张表靠它
      // （`node .team/test/2026-09-22/probe-70-reds.mjs <原始输出>`）
      if (process.env.ZOF70_DEBUG === '1') {
        console.log('ZOF70 ' + (one.fault || 'as-contracted') + ' => [' + red.join(' ') + ']')
      }
      expect(red).toEqual(one.reds)
    })
  }
})
