<script setup lang="ts">
/**
 * 左栏 · 状态树（CONTRACT §8.2）：按 code 缩进的一棵扁平树，一行一个**可见**元素。
 *
 * 一条铁律：**`.0` 不单独出行** —— 它是节点自身值的保留槽，属于父行那一行。
 * 行里只有 **编号 / 名字 / 读 / 写 / 加子元素 / 删除**：初始值与当前值不在这里显示
 * （初始值在中栏下半部分改，当前值在存档编辑器里看）。
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
 * 那一侧的卡结构是冻结的，只许改名字 / 备注 / 提示词与眼睛。
 */
import { computed } from 'vue'
import {
  MAX_DEPTH,
  codeDepth,
  elementOfPath,
  isFieldRef,
  isInsideArray,
  pathsOf,
  refCoveredBy,
  refsUnder,
} from '../core/statetree'
import type { ChainNode, StateElement } from '../core/types'
import { t } from '../i18n'

const props = defineProps<{
  elements: StateElement[]
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

/** 输出节点不写状态：它一只写眼睛都没有（`writable` 必须是空的） */
function showsWrite(): boolean {
  return props.node !== null && props.node.type !== 'output'
}

/**
 * 这一行的三态（`CONTRACT §8.2` / 增补 §六.2）：按**子树覆盖**算，不是按值路径交集。
 * 一行里的「格子」有两类：
 *   · 值路径（数组容器的值路径不算 —— 它的内容是字段，下面那一类在管）；
 *   · 数组字段引用（`2.4.1` 这类；容器 / 祖先引用覆盖它们）。
 * 全被覆盖 ⇒ `all`；一个都没 ⇒ `none`；其余 ⇒ `some`。
 * 于是「只开 `2.4.1`」⇒ 容器半、「两列都开」⇒ 容器满、「只开 `1.1.0`」⇒ `1.1` 半（旧行为不变）。
 */
function triOf(field: 'read' | 'write', code: string): 'all' | 'some' | 'none' {
  const list = field === 'read' ? (props.node?.reads ?? []) : (props.node?.writable ?? [])
  const values = pathsOf(props.elements, code).filter((path) => {
    const owner = elementOfPath(props.elements, path)
    return owner !== undefined && owner.type !== 'array'
  })
  const fieldRefs = refsUnder(props.elements, code).filter((ref) => isFieldRef(props.elements, ref))
  const total = values.length + fieldRefs.length
  if (total === 0) return 'none'
  const hit =
    values.filter((path) => coveredPaths.value[field].has(path)).length +
    fieldRefs.filter((ref) => refCoveredBy(props.elements, list, ref)).length
  if (hit === 0) return 'none'
  return hit === total ? 'all' : 'some'
}

/**
 * 这一行能不能「加子元素」：时间不能；数组字段里的**标量**不能（item 是纯 JSON 结构体，
 * 标量字段没有 `.0` 那一层，加孩子要由 `addChild` 报 `E_VALIDATION`）。
 */
function showsAddChild(element: StateElement): boolean {
  if (element.type === 'time' || codeDepth(element.code) >= MAX_DEPTH) return false
  return !isInsideArray(props.elements, element.code) || element.type === 'object' || element.type === 'array'
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
          v-if="!structureLocked && selectedCode !== null && showsAddChild(element)"
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
</style>
