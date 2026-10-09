/**
 * 「新建一枝」那一族（票 8e；票 8f 补上「配套动作」）—— 已建还没落卡的那几枝 · 那一枝怎么拼出来 ·
 * 名字与必收项的规矩 · 顺带建出来的那条写它的动作。
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
 * 🔴 **票 8f（甲案）：勾着建的那一枝**顺带**配一条写它的动作**（引擎要求每一枝都有维护器：
 *    `checkBranchKeepers`，`src/game/card.ts`）—— 那条动作与枝一起进草稿、一起落卡；
 *    摘掉那个勾就是乙案那条路：这枝还没有人写，界面当场说清（`unwritten` 就是那份名单）。
 * 🔴 **"界面说建成了"与"保存真能落"必须是同一件事**（评审点名的 C2）：白名单去重 · 动作名避开
 *    撞名 · 非 ASCII 枝名退兜底名 —— 三处都只为一件事：拼出来的那张卡过得了格式校验。
 * ⚠️ 这里没有生命周期钩子、也不 `useI18n`：翻译走 `src/i18n.ts` 的模块级 `t`（在组件外翻译）。
 */
import { computed, ref, type ComputedRef } from 'vue'
import { t } from '../i18n'
import { schemaType, type Schema } from '../game/card-state'
import type { Action, CardData } from '../game/card'
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
  /** 草稿里**还没有动作写它**的那几枝（界面当场说清用的就是这一份） */
  unwritten: ComputedRef<string[]>
  /** 草稿里有没有新建的枝（并进那条 `dirty`：顶栏那颗保存跟着醒） */
  dirty: ComputedRef<boolean>
  /** 把草稿里那几枝写进深拷卡（与另外几族的 `applyTo` 写的是同一份卡） */
  applyTo(next: CardData): void
  /** 存下去之后那几枝就在卡里了 ⇒ 草稿清空 */
  markSaved(): void
  /** 「建出来」过了规矩的那一枝：进草稿（`withAction` = 顺带把配套动作也建出来） */
  add(name: string, schema: Schema, withAction: boolean): void
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

/**
 * enum 那格白名单：逗号分隔、掐掉空段、**同一个值只留第一次出现的位置**。
 *
 * ⚠️ 去重不是风格：白名单是**集合**，而 `checkValues`（`card-state.ts:149`）**拒重复** ——
 *    照抄两遍同一个值的话，界面会报成功、保存被格式拒（`A4a` 钉的就是这一条）。
 *    留第一次出现的位置：作者敲的顺序就是白名单的顺序。
 */
function valuesOf(text: string): string[] {
  const out: string[] = []
  for (const one of text.split(',')) {
    const value = one.trim()
    if (value !== '' && !out.includes(value)) out.push(value)
  }
  return out
}

/** 工具名的形状（引擎那份在 `card.ts:179`）—— 界面这一份是替作者记住它 */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/
/** 配套动作的名字：`set_` + 枝名（枝名是中文时它过不了工具名那条，见下） */
const ACTION_PREFIX = 'set_'
/** 枝名变不成合法工具名时的兜底名字（工具名只收 ASCII，而枝名可以是中文） */
const ACTION_FALLBACK = 'set_branch'
/** `map` 那一枝的条目名（引擎对 map 的动作**要求**给一个） */
const MAP_KEY = 'name'

/**
 * 这一枝的配套动作（契约 §1.2）：`path` 就是这一枝 · 三段从 locale 现取 · `mode` 是普通的写。
 *
 * ⚠️ **名字只收 ASCII** ⇒ `set_` + 枝名过不了那条正则时退回 `ACTION_FALLBACK`，再与 `used`
 *    （卡里已有的动作名 + 本次草稿里已经建过的）逐个避开：撞名会**静默吃掉**卡里原来那条动作
 *    （JSON 里同名键只留一个），而保存那一步看不出来（`checkOneKeeper` 只认"一条 path 一个动作"）。
 * ⚠️ `key` 只有 `map` 那一枝写：引擎对 map 的动作要求它、对别的形状**拒收**它（`card.ts:291-297`）。
 */
function actionOf(name: string, schema: Schema, used: string[]): { key: string; action: Action } {
  const base = TOOL_NAME.test(ACTION_PREFIX + name) ? ACTION_PREFIX + name : ACTION_FALLBACK
  let key = base
  for (let round = 2; used.includes(key); round += 1) key = base + '_' + round
  const action: Action = {
    whenToUse: t('card.branchActionWhen', { name }),
    what: t('card.branchActionWhat', { name }),
    principles: t('card.branchActionPrinciples', { name }),
    path: name,
    mode: 'set',
  }
  if (schemaType(schema) === 'map') action.key = MAP_KEY
  return { key, action }
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
 * 草稿里的一枝：它自己 + 配套动作（`action` 为 `null` 就是乙案那条路：这枝还没有人写）。
 *
 * ⚠️ 名字与动作本身分开存：落卡要的是"写进 `actions` 里哪一格"，界面报数要的是"这一枝有没有人写"。
 */
interface CreatedBranch {
  /** 这一枝的 schema */
  schema: Schema
  /** 配套动作在 `actions` 里的名字（没有动作就是空串） */
  actionKey: string
  /** 配套动作本身（没有就是 `null`） */
  action: Action | null
}

/**
 * 挂起「新建一枝」那一族。
 *
 * @param input.card 现取当前卡（getter：`props.card` 换了要跟着变）—— 重名要问它卡里已有的顶层枝，
 *   避动作名要问它已有的动作名
 */
export function useBranchCreate(input: { card: () => CardData }): BranchCreateApi {
  /** 已建、还没落卡的枝：名字 → 那一枝（卡里此刻没有它们，只活在这份草稿里） */
  const created = ref<Record<string, CreatedBranch>>({})

  /** 草稿里那几枝的树行（`taken` 恒 false：引擎不接管新枝；形状就是刚选的那个） */
  const rows = computed<NavRow[]>(() =>
    Object.entries(created.value).map(([path, one]) => ({
      path,
      kind: schemaType(one.schema),
      taken: false,
    })),
  )
  /** 已经占掉的名字：卡里的顶层枝 + 草稿里刚建的那几枝 */
  const taken = computed(() => [...Object.keys(input.card().state), ...Object.keys(created.value)])
  /** 草稿里**还没有动作写它**的那几枝（勾着配套动作建出来的那一枝不在这一份里） */
  const unwritten = computed(() =>
    Object.entries(created.value)
      .filter(([, one]) => one.action === null)
      .map(([path]) => path),
  )
  /** 草稿里有没有新建的枝 */
  const dirty = computed(() => Object.keys(created.value).length > 0)

  /** 「建出来」那一枝进草稿（卡与存储一个字节都不动 —— 那是顶栏那颗保存的事） */
  function add(name: string, schema: Schema, withAction: boolean): void {
    const used = [
      ...Object.keys(input.card().actions),
      ...Object.values(created.value).map((one) => one.actionKey),
    ].filter((key) => key !== '')
    const paired = withAction ? actionOf(name, schema, used) : null
    created.value[name] = {
      schema,
      actionKey: paired === null ? '' : paired.key,
      action: paired === null ? null : paired.action,
    }
  }

  /** 把草稿里那几枝写进深拷卡（与另外几族的 `applyTo` 同一份卡、同一处接线） */
  function applyTo(next: CardData): void {
    for (const [name, one] of Object.entries(created.value)) {
      next.state[name] = one.schema
      if (one.action !== null) next.actions[one.actionKey] = one.action
    }
  }

  /** 存下去之后那几枝就在卡里了 ⇒ 草稿清空 */
  function markSaved(): void {
    created.value = {}
  }

  return { rows, taken, unwritten, dirty, applyTo, markSaved, add }
}
