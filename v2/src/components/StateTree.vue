<script setup lang="ts">
/**
 * 左栏 · 状态树（CONTRACT §8.2）：按 code 缩进的一棵扁平树，一行一个**可见**元素。
 *
 * 一条铁律：**`.0` 不单独出行** —— 它是节点自身值的保留槽，属于父行那一行。
 * 所以「有自身值的行」显示的就是它的值：有孩子时取 `<code>.0`，没孩子时取 `<code>`；
 * 结构体（`object`）没有自身值，那一格不渲染。
 *
 * 眼睛按 S1 / S2 露出来：
 *   · **S1**（选中工作流节点）：每行两只**文字按钮**【读】【写】；`data-on` 是「这一行整段都被读到 / 写到」，
 *     `data-tri` 是父行的三态（`all` 满 / `some` 半 / `none` 未）—— 父行覆盖**自身值 + 整棵子树**，
 *     所以只点了孩子时父行是「半」；子节点按钮只切自己。手写 / 导入的卡里可能直接写了 `<code>.0`
 *     （只取自身值）—— 那时父行就是「半」，`.0` 自己不占一行。
 *   · **S2**（选中状态元素）：栏顶 `[data-add-state]`（新顶层元素）、每行 `[data-add-child]`（加子元素，
 *     第 5 层不出现、时间没有）与 `[data-delete-state]`（删这一棵，时间没有）。
 *
 * `structureLocked`（存档编辑器）把 `+` / 加子元素 / 删除**整块拿掉**（不渲染、不是禁用）：
 * 那一侧的卡结构是冻结的，只许改名字 / 备注 / 初值与眼睛。
 */
import { computed } from 'vue'
import { codeDepth, formatTime, pathsOf } from '../core/statetree'
import type { ChainNode, StateElement, TimeValue, Tree } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  elements: StateElement[]
  /** 每一行要显示的自身值（卡模式 = 初值树；存档模式 = 存档的树） */
  values: Tree
  node: ChainNode | null
  selectedCode: string | null
  /** 结构锁死：不渲染新元素 / 加子元素 / 删除（默认 false = 卡编辑器） */
  structureLocked?: boolean
}>()

defineEmits<{
  add: []
  select: [code: string]
  remove: [code: string]
  'add-child': [code: string]
  'toggle-read': [code: string, tri: 'all' | 'some' | 'none']
  'toggle-write': [code: string, tri: 'all' | 'some' | 'none']
}>()

/** 第 5 层（可见深度 5）不再加孩子 */
const MAX_DEPTH = 5

/** 一个 code 的自身值路径；结构体没有自身值（`undefined` ⇒ 不渲染那一格） */
function ownValuePath(element: StateElement): string | undefined {
  return element.type === 'object' ? undefined : pathsOf(props.elements, element.code)[0]
}

/** 行里显示的值：时间走公历格式，其余按原样 */
function ownValueOf(element: StateElement): string | undefined {
  const path = ownValuePath(element)
  if (path === undefined) return undefined
  const value = props.values[path]
  if (value === undefined) return undefined
  return typeof value === 'object' ? formatTime(value as TimeValue) : String(value)
}

/**
 * 节点这一只眼睛覆盖到的值路径。引用可能是元素 code（覆盖自身值 + 整棵子树），也可能是
 * `<code>.0`（只覆盖那个自身值）；`reads` 里还有提示词 id —— `pathsOf` 对这两类之外的输入返回 `[]`。
 */
const coveredPaths = computed(() => {
  const node = props.node
  const covered: Record<'read' | 'write', Set<string>> = { read: new Set(), write: new Set() }
  if (!node) return covered
  for (const [field, list] of [
    ['read', node.reads],
    ['write', node.writable],
  ] as const) {
    for (const ref of list) for (const path of pathsOf(props.elements, ref)) covered[field].add(path)
  }
  return covered
})

/** 三态：这一行的值路径全被覆盖 = `all`，都没 = `none`，只覆盖一部分 = `some` */
function triOf(field: 'read' | 'write', code: string): 'all' | 'some' | 'none' {
  const paths = pathsOf(props.elements, code)
  const hit = paths.filter((path) => coveredPaths.value[field].has(path)).length
  if (hit === 0) return 'none'
  return hit === paths.length ? 'all' : 'some'
}

/** 输出节点不写状态：它一只写眼睛都没有（`writable` 必须是空的） */
function showsWrite(): boolean {
  return props.node !== null && props.node.type !== 'output'
}
</script>

<template>
  <div class="state-tree" data-state-tree>
    <div class="panel-head">
      <div class="col-title" data-panel-title>
        <span class="ellipsis">{{ t('editor.stateTitle') }}</span>
      </div>
      <button
        v-if="!structureLocked && selectedCode !== null"
        type="button"
        class="icon panel-head-action"
        data-add-state
        :title="t('editor.addState')"
        :aria-label="t('editor.addState')"
        @click="$emit('add')"
      >
        +
      </button>
    </div>
    <div class="rows scroll">
      <div
        v-for="element in elements"
        :key="element.code"
        class="state-row"
        :class="{ selected: element.code === selectedCode }"
        :data-state-item="element.code"
        :data-depth="codeDepth(element.code)"
        :style="{ marginLeft: `${(codeDepth(element.code) - 1) * 12}px` }"
        @click="$emit('select', element.code)"
      >
        <span class="state-code" data-state-code>{{ element.code }}</span>
        <span class="state-name ellipsis" data-state-name>{{ element.name }}</span>
        <span v-if="ownValueOf(element) !== undefined" class="state-value ellipsis" data-state-value>
          {{ ownValueOf(element) }}
        </span>
        <template v-if="node">
          <button
            type="button"
            class="chip"
            data-eyes="read"
            :data-on="triOf('read', element.code) === 'all' ? 'true' : 'false'"
            :data-tri="triOf('read', element.code)"
            :title="t('editor.readEye')"
            @click.stop="$emit('toggle-read', element.code, triOf('read', element.code))"
          >
            {{ t('editor.eyeRead') }}
          </button>
          <button
            v-if="showsWrite()"
            type="button"
            class="chip"
            data-eyes="write"
            :data-on="triOf('write', element.code) === 'all' ? 'true' : 'false'"
            :data-tri="triOf('write', element.code)"
            :title="t('editor.writeEye')"
            @click.stop="$emit('toggle-write', element.code, triOf('write', element.code))"
          >
            {{ t('editor.eyeWrite') }}
          </button>
        </template>
        <button
          v-if="
            !structureLocked &&
            selectedCode !== null &&
            element.type !== 'time' &&
            codeDepth(element.code) < MAX_DEPTH
          "
          type="button"
          class="icon"
          :data-add-child="element.code"
          :title="t('editor.addChild')"
          :aria-label="t('editor.addChild')"
          @click.stop="$emit('add-child', element.code)"
        >
          +
        </button>
        <button
          v-if="!structureLocked && selectedCode !== null && element.type !== 'time'"
          type="button"
          class="icon"
          data-delete-state
          :title="t('editor.deleteState')"
          @click.stop="$emit('remove', element.code)"
        >
          {{ t('common.remove') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.state-tree {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
}

.rows {
  flex: 1 1 auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.state-row {
  display: flex;
  gap: 4px;
  align-items: center;
  min-width: 0;
  height: var(--row-h);
  padding: 3px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: var(--panel);
  cursor: pointer;
}

/* 悬停只把边框变深、不铺底色；这一条要在 .selected 之前，选中行的 accent 边框才不被盖掉 */
.state-row:hover {
  border-color: var(--line-strong);
}

/* 选中 = 深强调底 + 浅字（与首页卡行 / 提示词块同一套三态）；字重 600，与未选中行区分 */
.state-row.selected {
  border-color: var(--accent);
  background: var(--active-bg);
  color: var(--active-ink);
  font-weight: 600;
}

.state-code {
  flex: 0 0 auto;
  font-size: var(--fs3);
  color: var(--ink-soft);
  min-width: 14px;
}

/* 编号是次要文字，深底上跟着换浅色（ink-soft 压在 accent 上只有 1.2:1） */
.state-row.selected .state-code {
  color: var(--active-ink);
}

.state-name {
  flex: 1 1 auto;
  font-size: var(--fs2);
}

/* 自身值是次要读数：占一行里剩下的位置，长了省略号 */
.state-value {
  flex: 0 1 auto;
  max-width: 40%;
  font-size: var(--fs3);
  color: var(--ink-soft);
}

.state-row.selected .state-value {
  color: var(--active-ink);
}
</style>
