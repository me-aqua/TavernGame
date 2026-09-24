// @vitest-environment jsdom
/**
 * 票 80（拆 `CardEditor.vue` 第二刀）：**搬出去那一族**的直接判据 —— 契约
 * `.team/test/2026-09-24/contract-80.md` §3 的 **B0–B9**。
 *
 * 为什么给它单独一份判据：那一族里有一串**各自有输入输出的真逻辑**，今天只被"七个判据文件挂在
 * 组件上"**间接**照到 —— 一处动了，红的是"那一屏不对"，读的人得自己往回找：
 *   · 左栏那棵树进什么 / 什么算"引擎接管"（`navRows`）
 *   · 中栏那张表的键序、`initial`、说明的取值优先（`fieldRows`）
 *   · `dirty` 是**三个来源的并集**（新行 / 待删·说明 / 一步那一族）
 *   · 关窗守卫"脏了才挂、干净就摘"，以及「继续」要**显式**摘（票 78 那条）
 *   · 唯一那条写路径：先深拷、只改动过的那几处、卡拒了只报不改
 *   · 草稿按「哪一格 + 哪个键」索引（同名键在不同格不许撞车）
 *
 * 🔴 **`useBranchDraft` 这个名字出现在这里不是巧合**：`.githooks/pre-commit` 的**检查 6**
 *    要求每个 `src/` 模块名在 `tests/` 里出现过 ⇒ 这份判据就是新模块的过路条（必须与实现同一笔）。
 *
 * ⚠️ **模块今天还不存在 ⇒ 用 `import(变数)` 而不是顶层具名 import**：顶层（哪怕字面量的）import
 *    会让收集期就去解析那个路径 —— 解析不到就**炸掉整份文件**，红的样子成了"测试坏了"；
 *    而这一条要的是"**功能没做**"的红（票 77 立的同一套写法）。
 * ⚠️ **一律在组件外面调它**：契约 §2 的签名里**没有生命周期钩子、也不 `useI18n`**
 *    （翻译走 `src/i18n.ts` 那个模块级的 `t`，它自己就写着"在组件外翻译"）——
 *    判据因此不需要 host 组件；若实现改回 `useI18n()` / 加生命周期钩子，这几条会**当场红**，
 *    那是**对的反馈**（签名变了，去改契约）。
 * ⚠️ **期望值全部从卡与 locale 现取**：一个中文键名、一句中文字面量都不手写
 *    （`.githooks/checks/ascii.mjs` 连 `tests/` 里的字符串字面量一起拦）。
 * ⚠️ **凡断"没有 / 是空"的地方都自带前提**（先证明"这一屏真的长得出来"）——
 *    免得"读不到东西"被当成"通过"（票 71 那族债的教训）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, ref, type EffectScope } from 'vue'
import { CLOCK_STATE_PATH } from '../src/game/card-time'
import { schemaElement, schemaFields } from '../src/game/card-state'
import { t } from '../src/i18n'
import { CARD_KEY } from './support/card-resources'
import { TREE_PATHS, card, fieldsOf, schemaAtPath, typeOf } from './support/branch-tree'

/** 搬进新模块的那一族（票 80 的切口；检查 6 要的就是这个名字） */
const MODULE = '../src/components/useBranchDraft'

/** 一棵根枝（`object`，点号路径能逐层解析）与引擎接管的整棵子树 */
const BRANCH = TREE_PATHS[0]
const TAKEN = CLOCK_STATE_PATH

/** 判据自己打进去的字（测试里的字符串字面量一律 ASCII） */
const NOTE_A = 'a note typed by the ticket-80 judge in the first node'
const NOTE_B = 'a note typed by the ticket-80 judge in the second node'

/** 这一族对外必须给出来的那几样（多给不算错，少给就是接缝破了） */
const REQUIRED: Array<[string, 'ref' | 'fn']> = [
  ['navRows', 'ref'],
  ['fieldRows', 'ref'],
  ['goneKeys', 'ref'],
  ['badKeys', 'ref'],
  ['failed', 'ref'],
  ['failure', 'ref'],
  ['fresh', 'ref'],
  ['dirty', 'ref'],
  ['discardAsk', 'ref'],
  ['save', 'fn'],
  ['setNote', 'fn'],
  ['toggleDel', 'fn'],
  ['addRow', 'fn'],
  ['cancelRow', 'fn'],
  ['setFresh', 'fn'],
  ['onResourceSaved', 'fn'],
  ['keepDraft', 'fn'],
  ['discardDraft', 'fn'],
  ['dispose', 'fn'],
]

/** 那一族**不许**漏出来的内部量（漏了就等于接缝变成双向的：编辑器又能自己算草稿键了） */
const INTERNAL = ['idOf', 'splitId', 'noteChanged']

/** 载入那一族：今天它不在 ⇒ 这一句就是"功能没做"那条红 */
async function loadFamily(): Promise<(input: unknown) => any> {
  const mod = (await import(/* @vite-ignore */ MODULE).catch(() => null)) as Record<string, unknown> | null
  expect(mod, 'the state/branch family has not been extracted yet: ' + MODULE).not.toBeNull()
  const builder = (mod as Record<string, unknown>).useBranchDraft
  expect(typeof builder, 'the module must export useBranchDraft').toBe('function')
  return builder as (input: unknown) => any
}

/** 一份这一族的挂法：编辑器给的那四样（卡 / 当前那一格 / 一步那一族的三件 / 该重载了） */
interface Harness {
  api: any
  picked: { value: string }
  stepDirty: { value: boolean }
  applyTo: any
  markSaved: any
  onSaved: any
  /** 两件端口的调用次序（`applyTo` → `markSaved` → `onSaved` 是契约里定死的） */
  calls: string[]
}

/** 当前挂着的那一份（收尾要 `dispose`：守卫挂在**共享的 `window`** 上，留着会串到下一条用例） */
let mounted: Harness | null = null

/**
 * 这一族挂在哪一个 effect scope 里 —— **判据要照真组件那样自己建一个**。
 *
 * ⚠️ 为什么必须有它：这一族在**组件外面**建（契约 §2.4 要求如此，为的是不要 Vue 警告）⇒
 *    **没有 scope 来停**它里面那条 `watch`。于是"这一刻排进队列、还没跑"的那次回调会在
 *    收尾之后被放出来，把守卫挂回**共享的 `window`** ⇒ 串进下一条用例。
 *    真组件里 `onBeforeUnmount` 摘守卫、**同一次卸载**里 Vue 还会 `scope.stop()`（`unmountComponent`：
 *    先跑 `bum` 再 `stop()`）—— 判据这边少了后半截，就得自己补上。
 *    🔴 **这不是实现的缺陷**：拿真组件量过，改动前后都是 `false`（见 `.tools/marta80-teardown.log`）。
 */
let scope: EffectScope | null = null

/** 挂一份这一族（`picked` 一开始空着，与真实接线一致） */
async function family(): Promise<Harness> {
  const useBranchDraft = await loadFamily()
  const picked = ref('')
  const stepDirty = ref(false)
  const calls: string[] = []
  const applyTo = vi.fn(() => {
    calls.push('applyTo')
  })
  const markSaved = vi.fn(() => {
    calls.push('markSaved')
  })
  const onSaved = vi.fn(() => {
    calls.push('onSaved')
  })
  const mine = effectScope()
  const api = mine.run(() =>
    useBranchDraft({
      card: () => card,
      picked: () => picked.value,
      steps: { dirty: computed(() => stepDirty.value), applyTo, markSaved },
      onSaved,
    }),
  ) as any
  scope = mine
  mounted = { api, picked, stepDirty, applyTo, markSaved, onSaved, calls }
  return mounted
}

/** 收尾：先摘守卫（真组件里 `onBeforeUnmount` 干的那一步），再停 scope（同一次卸载里 Vue 干的后一步） */
function release(): void {
  try {
    mounted?.api?.dispose?.()
    scope?.stop()
  } finally {
    scope = null
    mounted = null
  }
}

/** 关窗守卫此刻挂着没有：派一个可取消的 `beforeunload`，看它有没有被拦下 */
function guardUp(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

/** 编辑器刚写回存储的那张卡（没写过就是 `null`）—— 卡已过校验，直接读 */
function storedCard(): any {
  const text = localStorage.getItem(CARD_KEY)
  return text === null ? null : JSON.parse(text)
}

/**
 * 卡里那一格声明的那个键 —— **与 `fieldsOf` 同一套解析**：`object` 读自己的 `fields`，
 * `map` / `list` 读**元素形状**的 `of.fields`。
 *
 * 🔴 **这两套规则必须同源**（票 80 第二轮修的）：`sharedKey()` 用 `fieldsOf` 挑键，若这里改回
 *    "点号路径直取"（`card-state.schemaAt` 走 `schemaFields`，而它**只认 `type:'object'` 的 `fields`**），
 *    `map` / `list` 那一格就读成空 ⇒ **判据跟自己打架**，红的却是"实现少给了一个说明"。
 *    卡的读法只有一条：`object` 读 `fields`、`map` / `list` 读 `of.fields`（票 70 立的，`fieldsOf` 用的就是它）。
 */
function declared(path: string, key: string): any {
  const node = schemaAtPath(path)
  if (node === undefined) return undefined
  const own = schemaFields(node)
  if (own !== undefined) return own[key]
  const element = schemaElement(node)
  const inElement = element === undefined ? undefined : schemaFields(element)
  return inElement === undefined ? undefined : inElement[key]
}

/** 字典形态的那一格声明（数组 / 标量缩写就没有"声明的说明"这一说） */
function noteOf(path: string, key: string): string {
  const node = declared(path, key)
  if (typeof node !== 'object' || node === null) return ''
  const note = (node as { note?: unknown }).note
  return typeof note === 'string' ? note : ''
}

/** 那一行此刻显示着的说明（`fieldRows` 的读数；找不到那一行就当场红） */
function shownNote(api: any, key: string): string {
  const row = api.fieldRows.value.find((one: any) => one.key === key)
  expect(row, 'the mid table shows no row for this key: ' + key).toBeDefined()
  return row.note
}

/** 两格共用的那个键（草稿 id 的"哪一格"那一半就靠它验） */
function sharedKey(): { a: string; b: string; key: string } {
  for (const a of TREE_PATHS) {
    for (const b of TREE_PATHS) {
      if (a === b) continue
      const both = fieldsOf(a).find((key) => fieldsOf(b).includes(key))
      if (both !== undefined) return { a, b, key: both }
    }
  }
  throw new Error('the card has no field key shared by two nodes: this judge cannot run')
}

describe('R3 the state/branch family that moves out of CardEditor (ticket 80)', () => {
  it('B0 the seam: every contracted name is handed out, and the draft-key internals are not', async () => {
    const { api } = await family()
    for (const [name, kind] of REQUIRED) {
      expect(typeof api[name], 'the family must hand out ' + name).not.toBe('undefined')
      if (kind === 'fn') expect(typeof api[name], name + ' must be a function').toBe('function')
      else expect(api[name], name + ' must be a ref (the template reads it)').toHaveProperty('value')
    }
    for (const name of INTERNAL) {
      expect(
        api[name],
        name + ' is an internal of the draft-key arithmetic: handing it out makes the seam two-way',
      ).toBeUndefined()
    }
  })

  it('B1 the left tree is the card containers with a field table, and only the engine subtree is taken', async () => {
    const { api } = await family()
    const rows = api.navRows.value
    expect(Array.isArray(rows), 'navRows must hand out an array').toBe(true)
    expect(rows.length, 'the tree of the example card is not empty').toBeGreaterThan(0)
    // 行的先后不承诺（裁决 4）⇒ 比集合；每一行的 `kind` 才是逐行比的
    expect(
      [...rows.map((row: any) => row.path)].sort(),
      'the tree must be exactly the containers the card gives a non-empty field table',
    ).toEqual([...TREE_PATHS].sort())
    for (const row of rows) {
      expect(row.kind, 'the row must carry the type the card declares for ' + row.path).toBe(
        typeOf(schemaAtPath(row.path)),
      )
    }
    const taken = rows.filter((row: any) => row.taken).map((row: any) => row.path)
    expect(taken.length, 'the engine subtree must show up on the tree at all').toBeGreaterThan(0)
    expect(taken.sort(), 'only the subtree the engine names may be marked as taken').toEqual(
      TREE_PATHS.filter((path) => path === TAKEN || path.startsWith(TAKEN + '.')).sort(),
    )
  })

  it('B2 the mid table follows the picked node: card order, kinds, initial and the takeover flag', async () => {
    const { api, picked } = await family()
    picked.value = BRANCH
    const rows = api.fieldRows.value
    expect(
      rows.map((row: any) => row.key),
      'the table must follow the card order of that node',
    ).toEqual(fieldsOf(BRANCH))
    for (const row of rows) {
      const node = declared(BRANCH, row.key)
      expect(row.kind, 'the kind of ' + row.key + ' must come from the card').toBe(typeOf(node))
      expect(row.hasInitial, 'hasInitial must say whether the card declares that key for ' + row.key).toBe(
        typeof node === 'object' && node !== null && Object.hasOwn(node, 'initial'),
      )
      expect(row.taken, 'nothing under this branch is engine-owned').toBe(false)
      expect(row.note, 'an untouched note cell must show what the card declares for ' + row.key).toBe(
        noteOf(BRANCH, row.key),
      )
    }
    picked.value = TAKEN
    const locked = api.fieldRows.value
    expect(locked.length, 'the engine subtree has fields at all').toBeGreaterThan(0)
    expect(
      locked.every((row: any) => row.taken === true),
      'every row under the engine subtree is taken',
    ).toBe(true)
  })

  it('B3 dirty is the union of three sources, and each one on its own can make it dirty', async () => {
    const { api, picked, stepDirty } = await family()
    const keys = fieldsOf(BRANCH)
    expect(keys.length, 'this judge needs at least two fields in that branch').toBeGreaterThan(1)
    const first = keys[0]
    const second = keys[1]
    picked.value = BRANCH
    expect(api.dirty.value, 'an untouched editor is clean').toBe(false)

    // ① 说明草稿：改一处就脏，改回卡里的原值又是干净的
    api.setNote(first, 'a note typed by the ticket-80 judge')
    expect(api.dirty.value, 'a note draft must make the editor dirty').toBe(true)
    api.setNote(first, noteOf(BRANCH, first))
    expect(api.dirty.value, 'typing the card value back is not a change').toBe(false)

    // ② 待删：标一处就脏，撤销又干净
    api.toggleDel(second)
    expect(api.goneKeys.value, 'the pending delete must be readable for this node').toEqual([second])
    expect(api.dirty.value, 'a pending delete must make the editor dirty').toBe(true)
    api.toggleDel(second)
    expect(api.goneKeys.value, 'unticking the trash must clear it').toEqual([])
    expect(api.dirty.value, 'undoing the delete is not a change').toBe(false)

    // ③ 新行：开一行就脏，取消又干净（它不进待删）
    api.addRow()
    expect(api.fresh.value, 'the plus must open exactly one draft row').not.toBeNull()
    expect(api.dirty.value, 'an unsaved new row must make the editor dirty').toBe(true)
    api.cancelRow()
    expect(api.fresh.value, 'cancelling a row that never hit the card drops it').toBeNull()
    expect(api.goneKeys.value, 'a cancelled row must not become a pending delete').toEqual([])
    expect(api.dirty.value, 'cancelling the new row is not a change').toBe(false)

    // ④ 一步那一族的脏：本族自己那三样都干净时，它一个人也要能把 dirty 顶起来
    stepDirty.value = true
    expect(
      api.dirty.value,
      'the union must keep the step family as its third source (the ticket-77 clause)',
    ).toBe(true)
    stepDirty.value = false
    expect(api.dirty.value, 'nothing is dirty any more').toBe(false)
  })

  it('B4 the unload guard follows dirty, and dispose drops it even while dirty', async () => {
    const { api } = await family()
    await nextTick()
    expect(guardUp(), 'a clean editor must not block the unload').toBe(false)

    api.addRow()
    await nextTick()
    expect(guardUp(), 'a dirty editor must block the unload').toBe(true)

    api.cancelRow()
    await nextTick()
    expect(guardUp(), 'going clean again must drop the guard').toBe(false)

    api.setNote(fieldsOf(BRANCH)[0], 'a note typed by the ticket-80 judge')
    await nextTick()
    expect(guardUp(), 'that note draft is a change: the guard must be up').toBe(true)

    release()
    expect(
      guardUp(),
      'dispose() must drop the guard while the draft is still dirty (the shared window must be left clean)',
    ).toBe(false)
  })

  it('B5 a save the UI itself refuses: the reason is on screen, the card and the drafts are untouched', async () => {
    const cases: Array<[string, string]> = [
      ['', 'card.fieldNameEmpty'],
      ['a.b', 'card.fieldNameDot'],
      ['__proto__', 'card.fieldNameProto'],
      [fieldsOf(BRANCH)[0], 'card.fieldNameTaken'],
    ]
    for (const [name, key] of cases) {
      release()
      localStorage.removeItem(CARD_KEY)
      const { api, picked, markSaved, onSaved } = await family()
      picked.value = BRANCH
      api.addRow()
      api.setFresh('key', name)
      api.save()
      expect(api.failed.value, 'a refused save must raise the flag for a name like ' + name).toBe(true)
      // 期望值是**改动前那份 DOM 工件**上读到的原话（`.team/test/2026-09-24/probe-80-dom-before.txt`
      // 的 gesture-6 那一节，拍的是 HEAD 的字节）：`保存失败：新字段的键名不能为空`
      // —— 界面拒绝时屏上那句话是**包了一层 `card.saveFailed`** 的（locale：`"保存失败：{message}"`），
      // 不是那一句裸的原因。判据写裸原因就等于**要人去改用户看的文案**（那是行为改动，S0 §四.1 不许）。
      expect(
        api.failure.value,
        'the reason must be the whole sentence the locale puts on screen for ' + key,
      ).toBe(t('card.saveFailed', { message: t(key) }))
      expect(api.fresh.value, 'the refused row must survive: the drafts are not cleared').not.toBeNull()
      expect(api.dirty.value, 'a refused save leaves the editor dirty').toBe(true)
      expect(storedCard(), 'a refused save must not touch the storage').toBeNull()
      expect(markSaved.mock.calls.length, 'a refused save must not mark anything as saved').toBe(0)
      expect(onSaved.mock.calls.length, 'a refused save must not ask the outer layer to reload').toBe(0)
    }
  })

  it('B6 a new integer row only lands as a number for a canonical decimal literal', async () => {
    const cases: Array<[string, unknown]> = [
      ['7', 7],
      ['007', '007'],
      ['8.0', '8.0'],
    ]
    for (const [typed, lands] of cases) {
      release()
      localStorage.removeItem(CARD_KEY)
      const { api, picked } = await family()
      picked.value = BRANCH
      api.addRow()
      api.setFresh('key', 'probe_new')
      api.setFresh('kind', 'integer')
      api.setFresh('initial', typed)
      api.save()
      const stored = storedCard()
      if (typeof lands === 'number') {
        expect(api.failed.value, 'a canonical decimal literal must be accepted: ' + typed).toBe(false)
        expect(stored, 'the save must reach the storage: ' + typed).not.toBeNull()
        expect(
          stored.state[BRANCH].fields.probe_new.initial,
          'a canonical decimal literal becomes a number: ' + typed,
        ).toBe(lands)
      } else {
        // `007` / `8.0` 交给 `Number()` 都会被**静默改成另一个样子** ⇒ 一律原样交给卡去拒
        expect(api.failed.value, 'the card must refuse this literal: ' + typed).toBe(true)
        expect(stored, 'a refused literal must not reach the storage: ' + typed).toBeNull()
      }
    }
  })

  it('B7 a save that goes through: the ports are called in order, and only what changed lands', async () => {
    const { api, picked, applyTo, markSaved, onSaved, calls } = await family()
    const keys = fieldsOf(BRANCH)
    expect(keys.length, 'this judge needs at least three fields in that branch').toBeGreaterThan(2)
    const first = keys[0]
    const untouchedKey = keys[2]
    const untouched = JSON.stringify(declared(BRANCH, untouchedKey))
    picked.value = BRANCH
    api.setNote(first, 'a note typed by the ticket-80 judge')
    api.addRow()
    api.setFresh('key', 'probe_new')
    api.setFresh('kind', 'integer')
    api.setFresh('initial', '7')
    const cardBefore = JSON.stringify(card)
    api.save()

    expect(api.failed.value, 'this save must go through').toBe(false)
    expect(api.failure.value, 'a save that went through leaves no reason on screen').toBe('')
    expect(calls, 'the copy must reach the step family first, then be marked saved, then reload').toEqual([
      'applyTo',
      'markSaved',
      'onSaved',
    ])
    expect(applyTo.mock.calls.length, 'the step family must be handed the copy exactly once').toBe(1)
    expect(onSaved.mock.calls.length, 'the outer layer is asked to reload exactly once').toBe(1)
    expect(applyTo.mock.calls[0][0], 'both ports must be handed the very same deep copy').toBe(
      markSaved.mock.calls[0][0],
    )
    expect(
      JSON.stringify(card),
      'the save works on a deep copy: the card the props point at may not move',
    ).toBe(cardBefore)

    const stored = storedCard()
    expect(stored, 'a save that goes through must write the card back').not.toBeNull()
    expect(stored.state[BRANCH].fields[first].note, 'the note draft must land on that field').toBe(
      'a note typed by the ticket-80 judge',
    )
    expect(stored.state[BRANCH].fields[first].type, 'writing a note must not touch the type').toBe(
      declared(BRANCH, first).type,
    )
    expect(
      stored.state[BRANCH].fields[first].initial,
      'writing a note must not touch the declared initial',
    ).toBe(declared(BRANCH, first).initial)
    expect(
      Object.keys(stored.state[BRANCH].fields).at(-1),
      'a new key is only ever appended at the end (key order is the declared order)',
    ).toBe('probe_new')
    expect(
      JSON.stringify(stored.state[BRANCH].fields[untouchedKey]),
      'a field nobody touched must come out byte for byte the same',
    ).toBe(untouched)
    expect(api.fresh.value, 'the drafts are cleared once the card took them').toBeNull()
    expect(api.failed.value, 'nothing failed in this save').toBe(false)
    expect(api.dirty.value, 'the editor is clean again after a save that went through').toBe(false)
  })

  it('B8 a draft is indexed by node as well as key: the same key in two nodes must not collide', async () => {
    const { a, b, key } = sharedKey()
    // 前提：这一对格子必须"看得出一份草稿有没有串过去"（两边声明的说明都不是这两句）
    expect(noteOf(a, key), 'premise: the first node must not already declare that sentence').not.toBe(NOTE_A)
    expect(noteOf(b, key), 'premise: the second node must not already declare that sentence').not.toBe(NOTE_B)
    const { api, picked } = await family()
    picked.value = a
    api.setNote(key, NOTE_A)
    expect(shownNote(api, key), 'the draft must show up in the node it was typed in').toBe(NOTE_A)

    picked.value = b
    expect(shownNote(api, key), 'the second node must not inherit the first node draft').toBe(noteOf(b, key))
    api.setNote(key, NOTE_B)
    expect(shownNote(api, key), 'each node keeps its own note draft').toBe(NOTE_B)

    picked.value = a
    expect(shownNote(api, key), 'the first node still holds its own draft').toBe(NOTE_A)

    api.toggleDel(key)
    expect(api.goneKeys.value, 'the pending delete belongs to the node it was made in').toEqual([key])
    picked.value = b
    expect(api.goneKeys.value, 'the other node must not show that pending delete').toEqual([])
  })

  it('B9 the panel question: clean goes through, dirty asks, cancel keeps, continue drops the guard', async () => {
    const { api, onSaved } = await family()
    expect(api.discardAsk.value, 'nothing is being asked before the panel says anything').toBe(false)
    api.onResourceSaved()
    expect(onSaved.mock.calls.length, 'a clean editor lets the panel save through right away').toBe(1)
    expect(api.discardAsk.value, 'a clean editor must not be asked anything').toBe(false)

    api.addRow()
    await nextTick()
    expect(guardUp(), 'the new row is a draft: the guard is up').toBe(true)
    api.onResourceSaved()
    expect(api.discardAsk.value, 'a dirty editor must be asked first').toBe(true)
    expect(onSaved.mock.calls.length, 'asking is not letting it through').toBe(1)

    api.keepDraft()
    expect(api.discardAsk.value, 'cancelling closes the question').toBe(false)
    expect(api.fresh.value, 'cancelling keeps the draft word for word').not.toBeNull()
    expect(api.dirty.value, 'the editor is still dirty after cancelling').toBe(true)
    expect(onSaved.mock.calls.length, 'cancelling does not reload').toBe(1)
    await nextTick()
    expect(guardUp(), 'cancelling does not drop the guard either').toBe(true)

    api.onResourceSaved()
    expect(api.discardAsk.value, 'the panel can ask again').toBe(true)
    api.discardDraft()
    expect(api.discardAsk.value, 'continuing closes the question').toBe(false)
    expect(onSaved.mock.calls.length, 'continuing lets the reload through').toBe(2)
    expect(api.dirty.value, 'continuing does not wipe the drafts by itself').toBe(true)
    expect(
      guardUp(),
      'continuing must drop the guard explicitly: dirty is still true, so the watcher cannot fire',
    ).toBe(false)
  })
})

/**
 * 收尾：这一族会在**共享的 `window`** 上挂监听，一条用例留下的脏东西必须在这里摘干净。
 *
 * 🔴 **`expect` 那一句是这一轮补的、不是装饰**：第一版 `release()` 只有 `dispose()`，
 *    看起来"收尾了"、其实**漏**掉"挂起的那次 `watch` 会在收尾之后把守卫挂回来"——
 *    红的是**别的用例**（B9），而红的地方离病根很远。
 *    "收尾函数存在"不等于"收尾有效" ⇒ 给它一条断言，让漏掉的那条路径**当场**在这里现形。
 */
afterEach(async () => {
  release()
  await nextTick()
  expect(guardUp(), 'a test must not leave a guard on the shared window').toBe(false)
  document.body.innerHTML = ''
})
