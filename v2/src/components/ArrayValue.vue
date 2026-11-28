<script setup lang="ts">
/**
 * 数组值的编辑块（阶段 3 契约 §4.2 / §4.3 + 增补 §四.3 / §四.4）：item 列表 + 每项每个字段一个控件。
 *
 * 一个组件管三种情况，由传进来的 `code` 的元素类型决定：
 *   · `array`（数组元素或数组字段）⇒ item 列表：`[data-array]`（存档模式的当前值是 `[data-current-array]`）；
 *   · `object` 字段 ⇒ 一组字段行：`[data-array-object]`，对象本身不再套 item；
 *   · **有孩子的标量字段** ⇒ 一组孩子行（自己的输入由上一层那一行负责，值住 `<code>.0`）。
 * 嵌套（对象里套数组、数组里套对象）靠**组件自己递归**；值永远是**整份**往上抛（`change`）：
 * 数组在 `tree` 里是一份 JSON，改一项也要整份交给 `setInitial`（没有「按下标改一格」的路径）。
 *
 * 显示只用中文名（`field.name`）：code 只住在 `data-*` 钩子里，界面上看不见。
 * 只读块（存档模式）不渲染加 / 删按钮，控件 `disabled`。
 *
 * 两条 UI 口径（增补 §四.3 / §四.4）：
 *   · item 卡**直接从第一字段那一行开始**：删除按钮 `[data-array-remove]` 挂在**第一字段同一行**
 *     （不是绝对定位、不是单独一行），第一字段上方没有空白高度；
 *   · 整数字段每一行在输入框右边带 `[data-array-range]` 小字 `min~max`（`integerRangeOf` 的生效上下限，
 *     与 `StateForm` 的 `[data-initial-range]` 同一把尺）。
 *
 * **引用（ref）字段**（`2.6.1 来源` 这种）：值格子换成 `RefValueEditor`（别的字段仍是各自的控件），
 * 候选从 `sourceItems` 给的源数组值里现算（卡模式默认读卡里的初始值，跨根按 code 找）。
 *
 * **删 item 会清掉引用**（引用契约 §8.3）：删之前先看有哪些引用指向这个数组 ——
 * 删完都会低于 `min` ⇒ 整笔拒绝（`[data-delete-error]` 点名它们）；都还合法 ⇒ 先弹确认
 * （`confirm` 交给页面那一层），确认后才删 item 并把新引用值交给上层写回。
 *
 * `top` 只由初始值块传 true：`[data-array-item]` / `data-array-index` 是**顶层 item 列表**的钩子，
 * 嵌套数组不重复挂它（否则「外层有几个 item」会被内层的 item 数污染）。
 */
import { ref, computed } from 'vue'
import RefValueEditor from './RefValueEditor.vue'
import { cascadeOf, initialItemsOf } from './ref-support'
import type { RefChange, RefUse } from './ref-support'
import { arrayItemOf, childrenOf, integerRangeOf, isItemId, isRecord } from '../core/statetree'
import type { ArrayValue, ItemObject, ItemValue, StateElement } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  /** 整棵状态树：item 的字段定义与默认值都从它取 */
  state: StateElement[]
  /** 容器 code：数组元素 / 数组字段 / object 字段 */
  code: string
  value: unknown
  /** 存档模式的当前值块：只读、`[data-current-array]` */
  current?: boolean
  /** 顶层初始值块：给 item 挂 `[data-array-item]` / `[data-array-index]` */
  top?: boolean
  disabled?: boolean
  /** 源数组值的取法（ref 字段的候选）：缺省读卡里的初始值（跨根按 code 找） */
  sourceItems?: (code: string) => unknown
  /** 有哪些引用直接指向这个数组（删 item 前要按 min 判）：缺省 = 不做引用检查 */
  refsOf?: (code: string) => RefUse[]
  /** 删 item 会清掉引用时的确认（文案 → 确认后执行）：缺省 = 不弹确认、直接删 */
  confirm?: (message: string, run: () => void) => void
}>()
const emit = defineEmits<{
  /** 这一层的整份值（数组 = item 列表；object = 那个对象） */
  change: [value: ArrayValue | ItemObject]
  /** 删 item 之后被清掉的引用值（上层按值路径写回初始值表） */
  refs: [changes: RefChange[]]
}>()

/** 这个容器的元素类型决定渲染形态（数组 ⇒ item 列表，别的 ⇒ object 字段块） */
const isArray = computed(() => props.state.find((item) => item.code === props.code)?.type === 'array')

/** 这一层的字段定义（顺序 = 左栏编号顺序） */
const fields = computed(() => childrenOf(props.state, props.code))

/** 数组 ⇒ 每个 item；object ⇒ 它自己那一个值（统一成列表，模板只写一遍） */
const items = computed<ItemObject[]>(() => {
  if (isArray.value) return Array.isArray(props.value) ? (props.value as ItemObject[]) : []
  return [isRecord(props.value) ? (props.value as ItemObject) : {}]
})

/** 往外抛：数组抛整份列表，object 抛列表里那一个对象 */
function commit(next: ItemObject[]): void {
  emit('change', isArray.value ? next : next[0])
}

/** 改一项里的一个字段 */
function setField(index: number, fieldCode: string, value: ItemValue): void {
  commit(items.value.map((item, at) => (at === index ? { ...item, [fieldCode]: value } : item)))
}

/** 追加一项：默认值来自 `arrayItemOf`（与「加字段」共用同一个真源） */
function addItem(): void {
  commit([...items.value, arrayItemOf(props.state, props.code, items.value)])
}

/** 被删除 item 挡住时的那条红字（点名会掉到 `min` 以下的引用） */
const deleteError = ref<string | null>(null)

/**
 * 删掉一项：先看有哪些引用指向这个数组 ——
 *   · 删完会低于 `min` ⇒ 整笔拒绝，红字点名那些引用，item 一个都不动；
 *   · 删完都还合法 ⇒ 有引用就先让页面弹确认（「删除并清空 N 个引用」），确认后才删；
 *   · 没有引用 ⇒ 直接删（`confirm` / `refsOf` 没给也一样）。
 */
function removeItem(index: number): void {
  const list = items.value
  const target = list[index]
  const id = isRecord(target) && isItemId(target.id) ? target.id : undefined
  const uses = id === undefined ? [] : (props.refsOf?.(props.code) ?? [])
  const { changes, blocked } = cascadeOf(uses, id ?? '')
  if (blocked.length > 0) {
    deleteError.value = t('editor.refDeleteBlocked', {
      refs: blocked.map((use) => use.element.code).join(' / '),
    })
    return
  }
  deleteError.value = null
  /** 真做的那一步：先写回被清掉的引用值，再删 item */
  const remove = (): void => {
    if (changes.length > 0) emit('refs', changes)
    commit(list.filter((_, at) => at !== index))
  }
  if (changes.length === 0 || props.confirm === undefined) {
    remove()
    return
  }
  props.confirm(t('editor.refCascadeConfirm', { count: changes.length }), remove)
}

/** 源数组的 item 列表（ref 字段的候选）：卡模式默认读卡里的初始值，当前值模式由上层给 */
function itemsOfSource(code: string | undefined): unknown {
  if (code === undefined) return undefined
  if (props.sourceItems !== undefined) return props.sourceItems(code)
  return initialItemsOf(props.state, code)
}

/** 整数控件的 `min~max` 小字：与校验共用 `integerRangeOf` 的生效上下限 */
function rangeOf(field: StateElement): string {
  const { min, max } = integerRangeOf(field)
  return `${min}~${max}`
}

/**
 * 这一项里的字段行：字段与普通节点同权 —— 标量字段可以**同时有自己的值和子字段**，
 * 有孩子时自己的值住 `<code>.0`（扁平值路径口径），孩子用它们的 code 递归一层组件。
 */
function hasChildren(field: StateElement): boolean {
  return childrenOf(props.state, field.code).length > 0
}

/** 标量字段自己的值：有孩子时是 `{<code>.0>: …, 孩子: …}` 里的那一格，没孩子就是裸值 */
function ownValue(raw: ItemValue | undefined, field: StateElement): ItemValue {
  // 引用的空值就是 null（不是空串）：少了这一条，值编辑器会把它读成「一条空引用」
  if (field.type === 'ref') return raw ?? null
  if (!hasChildren(field)) return (raw ?? '') as ItemValue
  return (isRecord(raw) ? (raw[`${field.code}.0`] ?? '') : '') as ItemValue
}

/** 自己那一格的 DOM 钩子：仍是字段 code（有孩子时值取 `<code>.0`，钩子不变） */
function ownHook(field: StateElement): string {
  return field.code
}

/** 把字段自己的值写回去：有孩子时保留孩子那一层，只换 `<code>.0` */
function setOwnValue(index: number, field: StateElement, value: ItemValue): void {
  if (!hasChildren(field)) {
    setField(index, field.code, value)
    return
  }
  const current = items.value[index]?.[field.code]
  const holder = isRecord(current) ? current : {}
  setField(index, field.code, { ...holder, [`${field.code}.0`]: value } as ItemObject)
}

/** 文本 / 下拉控件：值原样落进草稿 */
function onText(index: number, field: StateElement, event: Event): void {
  setOwnValue(index, field, (event.target as HTMLInputElement | HTMLSelectElement).value)
}

/** 整数控件：空输入不写草稿（输入框恢复旧值），合法整数才更新 */
function onInteger(index: number, field: StateElement, event: Event): void {
  const input = event.target as HTMLInputElement
  if (input.value.trim() === '') {
    input.value = String(ownValue(items.value[index]?.[field.code], field))
    return
  }
  const value = Number(input.value)
  if (Number.isInteger(value)) setOwnValue(index, field, value)
}
</script>

<template>
  <div
    class="array"
    :data-array="isArray && !current ? code : undefined"
    :data-current-array="isArray && current ? code : undefined"
    :data-array-object="isArray ? undefined : code"
  >
    <div
      v-for="(item, index) in items"
      :key="index"
      class="item"
      :data-array-item="top && isArray ? '' : undefined"
      :data-array-index="top && isArray ? index + 1 : undefined"
    >
      <!-- 一行一个字段：有孩子的字段 = 自己那一行（值住 `<code>.0`）+ 下面递归孩子；没孩子就是裸值 -->
      <div v-for="(field, fieldIndex) in fields" :key="field.code" class="field-group">
        <div class="field">
          <span class="field-name ellipsis" :data-array-field-name="field.code">{{ field.name }}</span>
          <select
            v-if="field.type === 'enum'"
            :data-array-field="ownHook(field)"
            :value="ownValue(item[field.code], field)"
            :disabled="disabled"
            @change="onText(index, field, $event)"
          >
            <option v-for="option in field.values ?? []" :key="option" :value="option">{{ option }}</option>
          </select>
          <template v-else-if="field.type === 'integer'">
            <input
              type="number"
              class="num"
              :data-array-field="ownHook(field)"
              :value="ownValue(item[field.code], field)"
              :disabled="disabled"
              @input="onInteger(index, field, $event)"
            />
            <span class="field-range" data-array-range>{{ rangeOf(field) }}</span>
          </template>
          <input
            v-else-if="field.type === 'text'"
            :data-array-field="ownHook(field)"
            :value="ownValue(item[field.code], field)"
            :disabled="disabled"
            @input="onText(index, field, $event)"
          />
          <!-- 引用字段（`2.6.1 来源` 这种）：值格子是同一套行构建器，候选来自它自己的源数组 -->
          <RefValueEditor
            v-else-if="field.type === 'ref'"
            :state="state"
            :element="field"
            :items="itemsOfSource(field.refSource)"
            :value="ownValue(item[field.code], field)"
            :disabled="disabled"
            @change="(value) => setOwnValue(index, field, value as ItemValue)"
          />
          <!-- 对象 / 数组字段：值整份挂在字段 code 上，孩子由下一层组件渲染 -->
          <!-- 删除按钮与**第一个字段同一行**：卡片直接从第一行开始，没有空白首行 -->
          <button
            v-if="isArray && !disabled && fieldIndex === 0"
            type="button"
            class="icon item-action"
            data-array-remove
            :title="t('editor.arrayRemove')"
            :aria-label="t('editor.arrayRemove')"
            @click="removeItem(index)"
          >
            {{ t('common.remove') }}
          </button>
        </div>
        <ArrayValue
          v-if="hasChildren(field)"
          class="field-children"
          :state="state"
          :code="field.code"
          :value="item[field.code]"
          :disabled="disabled"
          :source-items="sourceItems"
          :refs-of="refsOf"
          :confirm="confirm"
          @change="(value) => setField(index, field.code, value)"
          @refs="(changes) => emit('refs', changes)"
        />
      </div>
      <!-- 一个字段都没有的坏卡没有「第一行」可挂：单独给一行，按钮不至于消失 -->
      <div v-if="isArray && !disabled && fields.length === 0" class="field">
        <button
          type="button"
          class="icon item-action"
          data-array-remove
          :title="t('editor.arrayRemove')"
          :aria-label="t('editor.arrayRemove')"
          @click="removeItem(index)"
        >
          {{ t('common.remove') }}
        </button>
      </div>
    </div>

    <span v-if="isArray && items.length === 0" class="empty" data-array-empty>{{
      t('editor.arrayEmpty')
    }}</span>
    <!-- 删除被引用 item 被拒的原因：点名会低于 min 的那些引用，item 一个都不许少 -->
    <span v-if="deleteError !== null" class="delete-error" data-delete-error>{{ deleteError }}</span>
    <button v-if="isArray && !disabled" type="button" class="add" data-array-add @click="addItem">
      {{ t('editor.arrayAdd') }}
    </button>
  </div>
</template>

<style scoped>
.array {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding-left: 8px;
  border-left: 1px solid var(--line);
}

/*
 * 一个 item 是一张卡片：删除按钮**挂在第一个字段那一行的末尾**（与字段名 / 控件同一行），
 * 所以卡片直接从第一行开始，不会多出一条空白首行。
 */
.item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--line);
  border-radius: 6px;
}

.item-action {
  flex: 0 0 auto;
  margin-left: 2px;
}

/* 一个字段：自己那一行 + （有孩子时）下面一层孩子 */
.field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.field-children {
  margin-left: 12px;
}

.field {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.field-name {
  flex: 0 1 auto;
  max-width: 34%;
  font-size: var(--fs2);
}

/* 值控件占剩下的宽度（数字框保持 `.num` 的 72px，与初始值行同一把尺） */
.field > input:not(.num),
.field > select {
  flex: 1 1 auto;
  min-width: 0;
}

.num {
  flex: 0 0 auto;
  width: 72px;
}

/* 整数格的 min~max 小字：与校验共用 integerRangeOf 的生效上下限；盒高与输入框一致，同一行对齐 */
.field-range {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  height: var(--control-h);
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.empty {
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.delete-error {
  font-size: var(--fs3);
  color: var(--danger);
}

.add {
  align-self: flex-start;
}
</style>
