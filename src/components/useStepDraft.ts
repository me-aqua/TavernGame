/**
 * 「编一步」那一族的草稿 —— 票 77 从 `CardEditor.vue` **原样搬出来**的（行为一个字节没动）。
 *
 * 为什么单独一层：`CardEditor.vue` 做完 8c-② 之后**正好顶到 550 行的上限**，下一个碰它的票会先被拦。
 * 这一族自带**两条真逻辑**（原先只被"整份卡逐字比"**间接**照到，现在有自己的判据
 * `tests/use-step-draft.test.ts`）：
 *   ① `cardDraft` 的三栏缺省语义：`tools` / `reads` **不写 = 全给**，`settings` **不写 = 全不给**（票 76）；
 *   ② `setStepPick` 勾回来是**插回候选表里的位置**（不是接到末尾 —— 保存只改人动过的那几处）。
 *
 * ⚠️ **只画不算那一半不在这里**：`StepForm` 只管铺屏与抛事件，值与草稿都由这里现算。
 * ⚠️ **这里没有生命周期钩子、也不碰 i18n** —— 判据在**组件外面**直接调它，加 `onMounted` / `useI18n`
 *    会让那几条当场红（签名变了）。
 * ⚠️ **写路径仍然只有一条**：`applyTo` 只改传进来的那份深拷卡，**落盘是编辑器 `save()` 的事**。
 * ⚠️ **选择那一轴不归这里**：`selected` 由编辑器传进来（它是一个可写的 ref，写它就是"选中那一步"），
 *    "两条轴互斥"仍然落在编辑器那**一个** `target` 上。
 * ⚠️ 🔴 **解构之后别再把这些名字包回一个对象**（`const steps = useStepDraft(…)` + 模板里写 `steps.roster` / `v-bind="steps.stepValues"`）：
 *    从 composable 解构出来之后，编译器把这几个名字的 `setup-ref` / `setup-const` **一律降级成 `setup-maybe-ref`**。
 *    今天无害（模板走 `$setup.X`，proxy 对任何 setup 键都 `unref`）—— 但**一旦包回对象、或把它们内联进 setup**，
 *    就正好落回那个坑：模板拿到的会是 **ref 本身**（`v-if` 恒真、`v-bind` 展开成空、props 全丢 ⇒ 渲染期崩）。
 *    ⇒ **要么像编辑器那样在顶层解构**，要么把返回包成 `reactive`。（票 77 的 S2 踩过一次，只有端到端那条探针咬到它。）
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { CardData } from '../game/card'

/** 一步的草稿：文本三样 + 三栏名单（`prompt` 是多行框里那**一整段文本**，落卡时才按行切回数组） */
export type StepDraft = {
  name: string
  duty: string
  prompt: string
  tools: string[]
  reads: string[]
  settings: string[]
}

/** 三栏的候选表：卡里那三张表本身，顺序照卡 */
interface Roster {
  tools: string[]
  reads: string[]
  settings: string[]
}

/** 这一族对外的那几样（`CardEditor` 与 `tests/use-step-draft.test.ts` 都照这个用） */
export interface StepDraftApi {
  /** 屏上的那张卡：存过就以存下去的那份为准 */
  shown: ComputedRef<CardData>
  /** 三栏的候选 */
  roster: ComputedRef<Roster>
  /** 那一屏要显示的值；`null` = 那一步那一屏整个不画 */
  stepValues: ComputedRef<StepDraft | null>
  /** 这一族的脏（编辑器把它并进自己那一行） */
  dirty: ComputedRef<boolean>
  /** 点细条上的一步 */
  pickStep: (id: string) => void
  /** 文本控件的草稿 */
  setStepText: (key: 'name' | 'duty' | 'prompt', value: string) => void
  /** 一栏勾选的草稿 */
  setStepPick: (key: 'tools' | 'reads' | 'settings', name: string, on: boolean) => void
  /** 把草稿写进那份深拷卡（**只写真的改过的那几样**） */
  applyTo: (next: CardData) => void
  /** 记下刚存下去的那份卡 */
  markSaved: (next: CardData) => void
}

/**
 * 挂起「编一步」那一族。
 *
 * @param input.card 现取当前卡（getter：`props.card` 换了要跟着变）
 * @param input.selected 细条里选中的那一步（节点 id，空串 = 那一轴没亮）—— **写它就是选中那一步**
 */
export function useStepDraft(input: { card: () => CardData; selected: Ref<string> }): StepDraftApi {
  const { selected } = input

  /** 一步的草稿（没有这一条 = 这一步没改过，屏上显示卡里的值） */
  const stepDrafts = ref<Record<string, StepDraft>>({})
  /** 上一次写进存储的那份卡（`null` = 这一次挂载还没存过） */
  const written = ref<CardData | null>(null)
  /** 屏上的那张卡：存过就以存下去的那份为准（外层收到 `saved` 才 reload，在那之前 props 是旧的） */
  const shown = computed(() => written.value ?? input.card())

  const roster = computed(() => ({
    tools: Object.keys(shown.value.actions),
    reads: Object.keys(shown.value.state),
    settings: Object.keys(shown.value.settings),
  }))

  /**
   * 卡里那一步现在的样子 —— 一份草稿就是从它长出来的。
   *
   * 🔴 **三栏的缺省语义各不相同**：`tools` / `reads` 不写 = **全给**（`card-actions.ts:104` · `card-state.ts:345`）；`settings` 不写 = **全不给**（票 76）。
   */
  function cardDraft(id: string): StepDraft {
    const node = shown.value.graph.nodes[id]
    return {
      name: node.name,
      duty: node.duty,
      prompt: node.prompt.join('\n'),
      tools: [...(node.tools ?? Object.keys(shown.value.actions))],
      reads: [...(node.reads ?? Object.keys(shown.value.state))],
      settings: [...(node.settings ?? [])],
    }
  }

  /**
   * 草稿与卡里的值**逐字相同**吗（改回原值 = 没改，顶栏那颗按钮要跟着变回按不动）。
   * ⚠️ 两边都是 `cardDraft` 那个形状长出来的（键序一致）⇒ 逐串比就够。
   */
  function stepChanged(id: string): boolean {
    const draft = stepDrafts.value[id]
    return draft !== undefined && JSON.stringify(draft) !== JSON.stringify(cardDraft(id))
  }

  const stepValues = computed<StepDraft | null>(() =>
    selected.value === '' ? null : (stepDrafts.value[selected.value] ?? cardDraft(selected.value)),
  )

  /** 这一族的脏：还有哪一步的草稿与卡里的值不一样 */
  const dirty = computed(() => Object.keys(stepDrafts.value).some(stepChanged))

  /** 记一处改动（第一次改这一步时从卡里长一份草稿出来；没选任何一步就什么都不做） */
  function editStep(id: string, change: (draft: StepDraft) => void): void {
    if (id === '') return
    const draft = { ...(stepDrafts.value[id] ?? cardDraft(id)) }
    change(draft)
    stepDrafts.value = { ...stepDrafts.value, [id]: draft }
  }

  /** 点细条上的一步：中栏换成那一步的编屏，可以直接改（树那一轴随之清掉） */
  function pickStep(id: string): void {
    selected.value = id
  }

  /** 文本控件的草稿 */
  function setStepText(key: 'name' | 'duty' | 'prompt', value: string): void {
    editStep(selected.value, (draft) => (draft[key] = value))
  }

  /**
   * 一栏勾选的草稿：取消勾就摘掉，勾上就**插到它在候选表里的位置**（不是接到末尾）——
   * 保存**只改人动过的那几处**（D1 逐字比整份卡），排在末尾会把卡里原来那几样的先后也改掉。
   */
  function setStepPick(key: 'tools' | 'reads' | 'settings', name: string, on: boolean): void {
    editStep(selected.value, (draft) => {
      const list = draft[key]
      if (!on) draft[key] = list.filter((one) => one !== name)
      else if (!list.includes(name)) {
        const at = list.findIndex((one) => roster.value[key].indexOf(one) > roster.value[key].indexOf(name))
        draft[key] = at === -1 ? [...list, name] : [...list.slice(0, at), name, ...list.slice(at)]
      }
    })
  }

  /** 把这一族的草稿写进那份深拷卡 —— **只写真的改过的那几样**（见下面那段注释） */
  function applyTo(next: CardData): void {
    for (const id of Object.keys(stepDrafts.value)) {
      if (!stepChanged(id)) continue
      const draft = stepDrafts.value[id]
      const card = cardDraft(id)
      const node = next.graph.nodes[id]
      // 🔴 **只写真的改过的那几样**：卡没写 `tools` / `reads` / `settings` 这个键时，"不写"与
      //    "写全"在引擎那边等价，可它是**作者没写的一个键** —— 顺手补进卡里就是"保存多改一处"
      //    （D1 逐字比整份卡要拦的正是这件事）。`name` / `duty` / `prompt` 是必写键，不必判。
      if (draft.name !== card.name) node.name = draft.name
      if (draft.duty !== card.duty) node.duty = draft.duty
      // 主提示词一行一条：空行也是卡里的一行 ⇒ 多行框按 `\n` 切回数组
      if (draft.prompt !== card.prompt) node.prompt = draft.prompt.split('\n')
      // 三栏名单：顺序也算（它是卡里的声明顺序）⇒ 逐串比
      if (JSON.stringify(draft.tools) !== JSON.stringify(card.tools)) node.tools = draft.tools
      if (JSON.stringify(draft.reads) !== JSON.stringify(card.reads)) node.reads = draft.reads
      if (JSON.stringify(draft.settings) !== JSON.stringify(card.settings)) node.settings = draft.settings
    }
  }

  /**
   * 记下**刚存下去的那份卡**：草稿与它逐字相同 ⇒ 又是干净的，而别的步也读得到最新的那张卡。
   * ⚠️ 一步的草稿**不清**（它记的就是"这一步屏上现在是什么"）—— 真实外层收到 `saved` 会 reload
   *    整张卡，那时组件整个重建，这两样自然都不在。
   */
  function markSaved(next: CardData): void {
    written.value = next
  }

  return { shown, roster, stepValues, dirty, pickStep, setStepText, setStepPick, applyTo, markSaved }
}
