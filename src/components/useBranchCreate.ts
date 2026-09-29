/**
 * 「新建一枝」那一族（票 8e）—— 已建还没落卡的那几枝 · 那一枝怎么拼出来 · 名字与必收项的规矩。
 *
 * 形状与另外四族（`useStepDraft` / `useBranchDraft` / `useDisplayDraft` / `usePromptDraft`）**同一个**：
 * 值只活在内存里，**落卡只走顶栏那颗保存**（脏并进 `useBranchDraft` 那条并集、`applyTo` 写进同一份
 * 深拷卡）⇒ 这一层一个字节都不碰卡与存储。
 * ⚠️ **只算不画**：面板那几个控件由 `BranchCreateForm.vue` 铺（表单自己拿着那几格的字），
 *    这里管的是值与规矩 —— 与另外几族同一条分工（表单组件铺屏、composable 现算）。
 * ⚠️ **两个 composable 互相看不见**：本件不 import `./useBranchDraft` 的任何**值**（只借它的行形状
 *    `NavRow` 当类型），反过来它也不知道本件存在 —— 「卡里的枝 ∪ 草稿里的枝」那一处合并在
 *    `CardEditor`，与另外几族的接线同一处。
 * ⚠️ **一枝 = `state` 的一个顶层键**（`StateSchema` 的一格）。形状与必收项照 `checkSchema` 的规矩
 *    （`values: []` / 缺 `of` / 空 `fields` 一律拒）—— 界面在这里是替作者记住卡格式，不是自己发明规矩。
 * ⚠️ 名字那三条（空 / 点号 / `__proto__`）界面自己挡：校验器一件都不管（实测三样都过 `checkSchema`），
 *    而 `__proto__` 更连键都落不下 —— 那会变成"界面报成功、卡里根本没有它"（`useBranchDraft` 守的是同一件事）。
 * ⚠️ 🔴 **今天建出来的枝存不进卡**（S0 §三 选的**乙案**）：引擎要求每一枝都有动作写它
 *    （`checkBranchKeepers`，`src/game/card.ts`），而本票**不建配套动作** ⇒ 这张卡保存必被拒。
 *    界面因此**当场说清**（那句提示住在 `CardEditor`，文案是 `card.branchUnwritten`）—— 那是引擎的规矩，
 *    不是界面绕得过去的。🔴 **甲案（建枝顺带建一条写它的动作）落地那天，那句提示与真浏览器那条判据
 *    要连编号一起翻面**：那时候"保存会被拦"不再成立。
 * ⚠️ 这里没有生命周期钩子、也不 `useI18n`：翻译走 `src/i18n.ts` 的模块级 `t`（在组件外翻译）。
 */
import { computed, ref, type ComputedRef } from 'vue'
import { t } from '../i18n'
import { schemaType, type Schema } from '../game/card-state'
import type { CardData } from '../game/card'
import type { NavRow } from './useBranchDraft'

/** 六种形状（契约 §1.3）—— 就是 `SchemaType` 那六个字面名；显示名复用 `card.kind.*`（票 70 落的） */
export const SHAPES = ['string', 'integer', 'enum', 'list', 'map', 'object'] as const
/** 六种形状里的一个 */
export type Shape = (typeof SHAPES)[number]
/** 能当元素 / 字段形状的两种 —— 格式里唯二能缩写的两种（别的形状自己还要 `values` / `of` / `fields`） */
export const SCALARS = ['string', 'integer'] as const
/** 那两种里的一种 */
export type Scalar = (typeof SCALARS)[number]

/** 面板那几格的值（`BranchCreateForm` 自己拿着它们，到 `planBranch` 来只问一件事：能不能建、建成什么） */
export interface CreateInput {
  /** 六选一选中的形状（它没选出来之前 `planBranch` 不会被问） */
  shape: Shape
  /** 枝名（`state` 那个顶层键的名字） */
  name: string
  /** enum 的白名单原文（逗号分隔；空段不算） */
  values: string
  /** list / map 的元素形状（**没有默认值**：缺 `of` 那一态要真的到得了） */
  of: Scalar | ''
  /** object 那第一个字段的名字与形状（空字段表过不了卡自己的校验） */
  key: string
  field: Scalar
}

/** 「建出来」的判决：要么是一个 schema，要么是一句人话（`problem` 已经按当前语言翻好了） */
export type CreateVerdict = { schema: Schema } | { problem: string }

/** 本件对外那几样（`CardEditor` 的接线吃它） */
export interface BranchCreateApi {
  /** 草稿里那几枝的树行（`CardEditor` 拿它并进左栏那棵树） */
  rows: ComputedRef<NavRow[]>
  /** 这些名字已经占了（卡里已有的顶层枝 + 草稿里刚建的）—— 面板拿它挡重名 */
  taken: ComputedRef<string[]>
  /** 草稿里有没有新建的枝（并进那条 `dirty`：顶栏那颗保存跟着醒） */
  dirty: ComputedRef<boolean>
  /** 把草稿里那几枝写进深拷卡（与另外几族的 `applyTo` 写的是同一份卡） */
  applyTo(next: CardData): void
  /** 存下去之后那几枝就在卡里了 ⇒ 草稿清空 */
  markSaved(): void
  /** 「建出来」过了规矩的那一枝：进草稿 */
  add(name: string, schema: Schema): void
}

/**
 * 一个键名的三种非法形状 —— 返回 locale 键，合法就是空串。
 *
 * 两处名字共用它（新枝名与 `object` 的第一个字段名）：**"空"与"点号"各有一句自己的人话**
 * （`emptyKey` / `dotKey` 由调用方给），`__proto__` 那句两处共用 —— 它说的就是同一件事。
 * 点号 ⇒ 状态路径按点号分段，带点号的键名永远选不中；`__proto__` ⇒ 赋值不建那个键、还改掉原型。
 */
function nameProblem(name: string, emptyKey: string, dotKey: string): string {
  if (name === '') return emptyKey
  if (name.includes('.')) return dotKey
  if (name === '__proto__') return 'card.fieldNameProto'
  return ''
}

/** enum 那格白名单：逗号分隔、掐掉空段（空串过不了卡自己的 `checkValues`） */
function valuesOf(text: string): string[] {
  return text
    .split(',')
    .map((one) => one.trim())
    .filter((one) => one !== '')
}

/**
 * 面板那几格 → 一枝的 schema；哪一条不过就回**那句人话**（文案在 locale 里，这里只挑是哪一条）。
 *
 * 名字三条与三条必收项都在这一个函数里：**卡格式的规矩只写一份**（`checkSchema` 认的与界面挡的
 * 是同几条，分开写迟早走散）。`taken` 是"这些名字已经占了"（卡里已有的枝 + 草稿里刚建的）。
 */
export function planBranch(input: CreateInput, taken: string[]): CreateVerdict {
  const name = input.name.trim()
  const wrong = nameProblem(name, 'card.branchNameEmpty', 'card.branchNameDot')
  if (wrong !== '') return { problem: t(wrong) }
  if (taken.includes(name)) return { problem: t('card.branchNameTaken') }
  if (input.shape === 'enum') {
    const values = valuesOf(input.values)
    if (values.length === 0) return { problem: t('card.branchValuesEmpty') }
    return { schema: { type: 'enum', values } }
  }
  if (input.shape === 'list' || input.shape === 'map') {
    if (input.of === '') return { problem: t('card.branchOfMissing') }
    return { schema: { type: input.shape, of: { type: input.of } } }
  }
  if (input.shape === 'object') {
    const key = input.key.trim()
    const badKey = nameProblem(key, 'card.branchFieldsEmpty', 'card.fieldNameDot')
    if (badKey !== '') return { problem: t(badKey) }
    return { schema: { type: 'object', fields: { [key]: { type: input.field } } } }
  }
  return { schema: { type: input.shape } }
}

/**
 * 挂起「新建一枝」那一族。
 *
 * @param input.card 现取当前卡（getter：`props.card` 换了要跟着变）—— 重名要问它卡里已有的顶层枝
 */
export function useBranchCreate(input: { card: () => CardData }): BranchCreateApi {
  /** 已建、还没落卡的枝：名字 → schema（卡里此刻没有它们，只活在这份草稿里） */
  const created = ref<Record<string, Schema>>({})

  /** 草稿里那几枝的树行（`taken` 恒 false：引擎不接管新枝；形状就是刚选的那个） */
  const rows = computed<NavRow[]>(() =>
    Object.entries(created.value).map(([path, node]) => ({
      path,
      kind: schemaType(node),
      taken: false,
    })),
  )
  /** 已经占掉的名字：卡里的顶层枝 + 草稿里刚建的那几枝 */
  const taken = computed(() => [...Object.keys(input.card().state), ...Object.keys(created.value)])
  /** 草稿里有没有新建的枝 */
  const dirty = computed(() => Object.keys(created.value).length > 0)

  /** 「建出来」那一枝进草稿（卡与存储一个字节都不动 —— 那是顶栏那颗保存的事） */
  function add(name: string, schema: Schema): void {
    created.value[name] = schema
  }

  /** 把草稿里那几枝写进深拷卡（与另外几族的 `applyTo` 同一份卡、同一处接线） */
  function applyTo(next: CardData): void {
    for (const [name, node] of Object.entries(created.value)) next.state[name] = node
  }

  /** 存下去之后那几枝就在卡里了 ⇒ 草稿清空 */
  function markSaved(): void {
    created.value = {}
  }

  return { rows, taken, dirty, applyTo, markSaved, add }
}
