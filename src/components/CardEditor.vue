<script setup lang="ts">
/**
 * 卡界面：四栏外壳里的**枝树 + 只读字段表**（设置面板「查看 / 编辑卡图」打开它）。
 *
 * 形态按决定 #24：绝对定位的浮层盖在故事上，不挤占正文 —— 关了它下面还是原来那一屏。
 * 四栏骨架（顶栏 / 内容 / 工作流 / 编辑 / 公共提示词 / 宽度标尺）是 EditorShell 的事。
 *
 * 本票（8b-①）只做**读**：左栏列出卡里「能编」的容器节点（一棵枝树），点一格 ⇒ 中栏是
 * 那一格的**只读字段表**。「说明可编辑 / 垃圾桶 / 加一个字段 / 保存」是 8b-②，
 * 「编一步」（节点表单）是 8c —— 所以卡图与旧的节点表单都不再挂在这里（`CardGraph` 仍在
 * `DebugPanel` 里用着，`CardNodeForm` 留给 8c）。
 *
 * ⚠️ **卡的知识只走这一条路**：树与表都在这里从 `card.state` 现算，两个子组件只画收到的行
 *    —— 于是「组件层绿、真浏览器红」那种两份走法漂移没有了。
 * ⚠️ **什么进树**：这一格自己有一张**非空字段表**才进树（`object` 自己的 `fields`，
 *    `map` / `list` 的元素形状 `of.fields`）；元素是标量的 `list`（`地点` 那种）点进去是
 *    一张空表，不是一格。
 * ⚠️ 树是**逐层向下**（宽度优先）展开的：行的顺序 = 卡的声明顺序，一层走完再走下一层。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BranchForm from './BranchForm.vue'
import CardResources from './CardResources.vue'
import EditorShell from './EditorShell.vue'
import StateTreeNav from './StateTreeNav.vue'
import { CLOCK_STATE_PATH } from '../game/card-time'
import { isRecord } from '../game/card-read'
import { schemaElement, schemaFields, schemaType, type Schema } from '../game/card-state'
import { cardMeta, type CardSource } from '../game/current-card'
import type { CardData } from '../game/card'

const { t } = useI18n()

const props = defineProps<{
  /** 要编辑的卡（当前卡） */
  card: CardData
  /** 它在哪来的（标题里说清正在编辑哪一张） */
  source: CardSource
}>()

const emit = defineEmits<{
  close: []
  /** 改完也存下了 —— 外层负责 reload */
  saved: []
  /** 三栏各自的「＋」：本票只抛事件，改卡是 8b-②–8e 的事 */
  'add-branch': []
  'add-action': []
  'add-step': []
}>()

/** 选中的**那一格**（卡里的点号路径）；空串 = 还没选 */
const picked = ref('')
/** 细条里选中的节点 id；空串 = 还没选（中栏编的是枝，节点那一轴 8c 才接上） */
const selected = ref('')
/** 资源库面板开着没有（顶栏那颗按钮开合它） */
const resourcesOpen = ref(false)

const meta = computed(() => cardMeta(props.card))
const sourceLabel = computed(() =>
  props.source === 'imported' ? t('card.sourceImported') : t('card.sourceBuiltin'),
)
/** 顶栏那一行身份（外壳只负责画） */
const metaLine = computed(() =>
  t('card.meta', { name: meta.value.name, version: meta.value.version, source: sourceLabel.value }),
)

/** 能进树的类型：只有容器（标量字段留在中栏那张表里） */
const CONTAINERS = ['object', 'map', 'list']

/**
 * 一段路径在卡里的 schema：`a.b` 走 `fields`，`a.*` 走元素形状（`of`）。
 *
 * 比 `card-state` 的 `schemaAt` 多认 `*` 那一段 —— 树里 `roles.*` 这种行代表的是**元素形状**，
 * 它自己不是一格，但它的字段是。
 */
function schemaOf(path: string): Schema | undefined {
  let current: Schema | undefined
  let scope: Record<string, Schema> | undefined = props.card.state
  for (const segment of path.split('.')) {
    if (segment === '*') {
      current = current === undefined ? undefined : schemaElement(current)
      scope = current === undefined ? undefined : schemaFields(current)
      continue
    }
    if (scope === undefined || !Object.hasOwn(scope, segment)) return undefined
    current = scope[segment]
    scope = schemaFields(current)
  }
  return current
}

/** 一格的字段表：`object` 读自己的 `fields`，`map` / `list` 读**元素形状**的 `of.fields` */
function fieldsOf(path: string): Record<string, Schema> {
  const node = schemaOf(path)
  if (node === undefined) return {}
  const own = schemaFields(node)
  if (own !== undefined) return own
  const element = schemaElement(node)
  const inElement = element === undefined ? undefined : schemaFields(element)
  return inElement ?? {}
}

/** 这一行写没写 `initial` —— 「开局在不在」的唯一开关（缩写形式 `"string"` 没有可写的键） */
function declaresInitial(node: Schema): boolean {
  return isRecord(node) && Object.hasOwn(node, 'initial')
}

/**
 * 这一格在不在**引擎点名的那棵子树**里（连底下每一格）。
 *
 * 今天只有时钟那一格，而它的名字由引擎自己定（`card-time.ts` 的 `CLOCK_STATE_PATH`）——
 * 卡里那五个整数也是引擎词表，所以它整棵只读。
 */
function underEngine(path: string): boolean {
  return path === CLOCK_STATE_PATH || path.startsWith(CLOCK_STATE_PATH + '.')
}

/** 左栏那棵树：卡里「能编」的容器节点，卡的声明顺序、逐层向下 */
const navRows = computed(() => {
  const rows: Array<{ path: string; kind: string; taken: boolean }> = []
  const seen = new Set<string>(Object.keys(props.card.state))
  const queue: string[] = [...seen]
  /** 放一个路径进队（空串丢弃、已经在队里过的不再进） */
  const push = (path: string): void => {
    if (path === '' || seen.has(path)) return
    seen.add(path)
    queue.push(path)
  }
  while (queue.length > 0) {
    const path = queue.shift() as string
    const node = schemaOf(path)
    if (node === undefined) continue
    if (CONTAINERS.includes(schemaType(node)) && Object.keys(fieldsOf(path)).length > 0) {
      rows.push({ path, kind: schemaType(node), taken: underEngine(path) })
    }
    for (const key of Object.keys(schemaFields(node) ?? {})) push(path + '.' + key)
    // `*` 是元素形状那一段的标记、不是一格：它底下只再走字段，不再套第二层
    if (path.endsWith('.*')) continue
    const element = schemaElement(node)
    if (element !== undefined) push(path + '.*')
  }
  return rows
})

/** 中栏那张表：选中那一格的字段，卡的声明顺序 */
const fieldRows = computed(() =>
  Object.entries(fieldsOf(picked.value)).map(([key, node]) => ({
    key,
    kind: schemaType(node),
    hasInitial: declaresInitial(node),
    taken: underEngine(picked.value + '.' + key),
  })),
)

/** 点树上的一行：中栏换成那一格的字段表（顺手清掉上一格留下的选中态） */
function pick(path: string): void {
  picked.value = path
}
</script>

<template>
  <div
    data-card-editor
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div
      class="flex max-h-[92vh] w-full max-w-[980px] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl xl:max-w-[1240px] 2xl:max-w-[1400px]"
    >
      <EditorShell
        :card="card"
        :selected="selected"
        :branch="picked"
        :meta="metaLine"
        :prompts-open="resourcesOpen"
        @close="emit('close')"
        @toggle-resources="resourcesOpen = !resourcesOpen"
        @select="selected = $event"
        @add-branch="emit('add-branch')"
        @add-action="emit('add-action')"
        @add-step="emit('add-step')"
      >
        <!-- 左栏：卡声明的那棵状态树（选一格就在中栏编它） -->
        <template #content>
          <StateTreeNav :rows="navRows" :picked="picked" @pick="pick" />
        </template>

        <!-- 中栏：选中那一格的只读字段表；还没选就是一格显式的空态 -->
        <template #mid>
          <BranchForm v-if="picked" :path="picked" :rows="fieldRows" />
          <p v-else data-branch-none class="none">{{ t('card.branchNone') }}</p>
        </template>

        <!-- 右栏：公共提示词的读与改（8d 才换成新表单） -->
        <template #prompts>
          <CardResources v-if="resourcesOpen" :card="card" error="" @saved="emit('saved')" />
        </template>
      </EditorShell>
    </div>
  </div>
</template>

<style scoped>
/* 还没编任何一格时的显式空态（字号只用三档里的一档） */
.none {
  margin: 0;
  font-size: var(--fs2);
  color: var(--color-faint);
}
</style>
