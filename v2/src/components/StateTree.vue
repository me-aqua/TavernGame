<script setup lang="ts">
/**
 * 左栏 · 状态树（CONTRACT §8.2）：按 code 缩进的一棵扁平树，一行一个**可见**元素。
 *
 * 一条铁律：**`.0` 不单独出行** —— 它是节点自身值的保留槽，属于父行那一行。
 * 行里只有 **编号 / 名字 / 读 / 写 / 加子元素 / 删除**：初始值与当前值不在这里显示
 * （初始值在中栏下半部分改，当前值在存档编辑器里看）。
 *
 * 眼睛按 S1 / S2 露出来：
 *   · **S1**（选中工作流节点）：每行两只**文字按钮**【读】【写】；`data-on` / `data-tri` **只有 all / none**
 *     （老板口径：没有半态）—— 父行只看**自己的 ref 在不在**；**子行**（读 / 写同一套）看自己的 ref 或
 *     **object / array 祖先**的 ref（标量祖先不覆盖子行）。`reads` / `writable` 数组是唯一真源：
 *     关掉容器不会补隐藏的字段 ref。手写 / 导入的 `<code>.0`（只取自身值）也不再有半态。
 *     点标量行只动自己（开 / 关都不动后代 ref）；点 object / array 行开 = 去后代冗余、关 = 只摘自己。
 *   · **S2**（选中状态元素）：栏顶 `[data-add-state]`（新顶层元素）、每行 `[data-add-child]`（加子元素，
 *     第 5 层不出现、时间没有）与 `[data-delete-state]`（删这一棵，时间没有）。
 *
 * `structureLocked`（存档编辑器）把 `+` / 加子元素 / 删除**整块拿掉**（不渲染、不是禁用）：
 * 那一侧的卡结构是冻结的，只许改名字 / 备注 / 提示词与眼睛。
 *
 * 引用（`ref`）那一行在写眼睛旁边还挂一枚 `[data-derived-write="<源数组 code>"]` 小标签
 * （「随 2.4 级联」，引用契约 §8.4）：写源数组容器 ⇒ 引擎自动给**直接引用者自身值**的写权限。
 * 它只说明「派生」这件事，**不改眼睛的 all / none**：`data-on` / `data-tri` 仍只反映 `writable` 里那一格。
 */
import { computed } from 'vue'
import { MAX_DEPTH, codeDepth, refCoveredBy, refPathsOf } from '../core/statetree'
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
  'toggle-read': [code: string, tri: 'all' | 'none']
  'toggle-write': [code: string, tri: 'all' | 'none']
}>()

/** 输出节点不写状态：它一只写眼睛都没有（`writable` 必须是空的） */
function showsWrite(): boolean {
  return props.node !== null && props.node.type !== 'output'
}

/**
 * 这一行的眼睛只有 **all / none** 两态（老板口径：不许半态）：
 *   · **父行**只看**它自己的 ref 在不在**清单里（`2.4` 在 ⇒ 满；子字段开着也不算）；
 *   · **子行**（读 / 写同一套）：自己的 ref 在，或 **object / array 祖先**的 ref 在时为满
 *     （标量祖先不覆盖子行）。
 * `writable` / `reads` 数组是**唯一真源**：不开容器就只留显式字段 ref，不补隐藏 ref。
 * 点标量行只动自己（开 / 关都不动后代 ref）；点 object / array 行开 = 去后代冗余、关 = 只摘自己。
 */
function triOf(field: 'read' | 'write', code: string): 'all' | 'none' {
  const list = field === 'read' ? (props.node?.reads ?? []) : (props.node?.writable ?? [])
  // 读 / 写同一套覆盖口径：自己的 ref 或 object / array 祖先的 ref（标量祖先不覆盖子行）
  return refCoveredBy(props.elements, list, code) ? 'all' : 'none'
}

/**
 * 这一行能不能「加子元素」：时间不能、第 5 层不能；**数组子树里的标量字段也能加**
 * （字段与普通节点同权：可以同时有自己的值和子字段）。
 */
function showsAddChild(element: StateElement): boolean {
  return element.type !== 'time' && codeDepth(element.code) < MAX_DEPTH
}

/**
 * 每个引用元素的**派生写来源**（值 = 源数组 code）：这一列写权限按值路径展开之后包含它的 `refSource`
 * ⇒ 引擎在 `applyWrite` 里会自动给它**自身值**的写权限（引用契约 §8.4：只给自身值、不给关系子元素；
 * 字段写不传播、反向不传播）。展开用 `refPathsOf`，与引擎的 `coveredRefs` 是同一把尺。
 */
const derivedWrites = computed(() => {
  const covered = (props.node?.writable ?? []).flatMap((ref) => refPathsOf(props.elements, ref))
  const map = new Map<string, string>()
  for (const element of props.elements) {
    if (element.type !== 'ref' || element.refSource === undefined) continue
    if (covered.includes(element.refSource)) map.set(element.code, element.refSource)
  }
  return map
})

/** 这一行的派生写来源；没有派生权限 ⇒ `''`（模板据此决定画不画那枚标签） */
function derivedOf(code: string): string {
  return derivedWrites.value.get(code) ?? ''
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
          <!-- 派生写权限（源数组容器在这一列写权限里 ⇒ 引用自身值可写）：只说明来源，不改眼睛的两态 -->
          <span
            v-if="showsWrite() && derivedOf(element.code) !== ''"
            class="derived"
            :data-derived-write="derivedOf(element.code)"
            :title="t('editor.derivedWriteTitle', { source: derivedOf(element.code) })"
          >
            {{ t('editor.derivedWrite', { source: derivedOf(element.code) }) }}
          </span>
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

/*
 * 派生写权限的小标签：「随 2.4 级联」。虚线边框 + 次要字色 —— 它是一条说明，不是可点的 chip
 * （点它不切换任何东西；切换仍只在旁边那颗写眼睛上）。
 */
.derived {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  height: var(--control-h);
  padding: 0 6px;
  font-size: var(--fs3);
  line-height: 1;
  color: var(--ink-soft);
  border: 1px dashed var(--line-strong);
  border-radius: var(--radius);
}

/* 选中行是深底浅字：标签跟着换浅色，别在 accent 底上留一行看不清的灰 */
.state-row.selected .derived {
  color: var(--active-ink);
  border-color: var(--active-ink);
}
</style>
