<script setup lang="ts">
/**
 * 卡界面：四栏外壳里的卡图 + 节点编辑表单（设置面板「查看 / 编辑卡图」打开它）。
 *
 * 形态按决定 #24：绝对定位的浮层盖在故事上，不挤占正文 —— 关了它下面还是原来那一屏。
 * 四栏骨架（顶栏 / 内容 / 工作流 / 编辑 / 公共提示词 / 宽度标尺）是 EditorShell 的事，
 * 这里只管三件事：往里塞哪三块内容、选中了谁、保存走哪条路。
 *
 * 保存走**与导入同一套校验**（importCard：卡格式 + 显示词汇表），通过才落盘；失败原样
 * 显示在表单里。落盘成功只 emit saved，reload 由外层做（引擎与显示映射都在模块加载期
 * 读卡，见 game/current-card.ts）。
 *
 * 可改的只有节点的**名 / 职责 / 提示词**（graph.nodes[id] 里的那三处）与**这个节点读哪几块
 * 资源**（settings 勾选列）；role / tools / reads 是机制（卡给了谁什么权力），
 * 表单只读展示，保存时整份复制、一个字节不动。
 *
 * 资源库面板（CardResources）住右栏（公共提示词那一格）：它管卡里那几块原始提示词的读与改，
 * 保存走的也是同一个 importCard。
 *
 * 三个「＋」（加一枝 / 加一个动作 / 加一步）本票只把事件抛出去，**不动卡** ——
 * 8b–8e 才轮到"按下去真的长出东西"。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CardGraph from './CardGraph.vue'
import CardNodeForm from './CardNodeForm.vue'
import CardResources from './CardResources.vue'
import EditorShell from './EditorShell.vue'
import { cardMeta, importCard, type CardSource } from '../game/current-card'
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
  /** 三栏各自的「＋」：本票只抛事件，改卡是 8b–8e 的事 */
  'add-branch': []
  'add-action': []
  'add-step': []
}>()

/** 选中的节点 id；空串 = 还没选 */
const selected = ref('')
/** 保存失败的原因（原样显示，不吞） */
const error = ref('')
/** 资源库面板开着没有（顶栏那颗按钮开合它） */
const resourcesOpen = ref(false)

/** 卡里的五块设定 —— 勾选区那一列就是它们 */
const settingKeys = computed(() => Object.keys(props.card.settings))

const meta = computed(() => cardMeta(props.card))
const sourceLabel = computed(() =>
  props.source === 'imported' ? t('card.sourceImported') : t('card.sourceBuiltin'),
)
/** 顶栏那一行身份（外壳只负责画） */
const metaLine = computed(() =>
  t('card.meta', { name: meta.value.name, version: meta.value.version, source: sourceLabel.value }),
)

/** 正在编辑的那个节点；没选中就是 null */
const editing = computed(() => {
  if (!selected.value) return null
  const node = props.card.graph.nodes[selected.value]
  return {
    id: selected.value,
    name: node.name,
    duty: node.duty,
    prompt: node.prompt,
    role: node.role ?? null,
    tools: node.tools ?? null,
    reads: node.reads ?? null,
    settings: node.settings ?? null,
  }
})

/** 选一个节点（顺手清掉上一个节点留下的报错） */
function select(id: string) {
  selected.value = id
  error.value = ''
}

/**
 * 保存：把改过的三个字段写回节点，再跑与导入同一套校验。
 *
 * 先在副本上改（卡本来就来自 JSON，整份复制最省事）：校验失败时内存里那张必须原样 ——
 * 它还在被引擎与界面用着。
 */
function save(value: { name: string; duty: string; prompt: string[] }) {
  const next = JSON.parse(JSON.stringify(props.card)) as CardData
  const node = next.graph.nodes[selected.value]
  node.name = value.name
  node.duty = value.duty
  node.prompt = value.prompt
  error.value = ''
  try {
    importCard(JSON.stringify(next))
    emit('saved')
  } catch (err) {
    // 边界：表单是人填的（重名 / 空提示词都可能）—— 失败要显示出来，存储原样不动
    error.value = t('card.saveFailed', { message: (err as Error).message })
  }
}

/**
 * 勾选变了：把这个节点要读的设定块写回卡，再跑与导入同一套校验。
 *
 * ⚠️ 一个都没勾就**把这个键删掉**，不是写空表：卡格式里「不写 settings」＝ 五块全发，
 *    而空表会被校验器拒（`must not be empty`）—— 那是另一件事。
 *
 * 名单按**卡自己的键序**过滤一遍：界面上的先后不该进卡（卡的声明顺序是唯一的顺序），
 * 而界面上可能还留着卡里已经没有的块名（它由勾选列自己维护）。
 */
function markResources(value: { settings: string[] }) {
  const next = JSON.parse(JSON.stringify(props.card)) as CardData
  const node = next.graph.nodes[selected.value] as { settings?: string[] }
  const keptSettings = settingKeys.value.filter((key) => value.settings.includes(key))
  if (keptSettings.length) node.settings = keptSettings
  else delete node.settings
  error.value = ''
  try {
    importCard(JSON.stringify(next))
    emit('saved')
  } catch (err) {
    // 这里不往上抛：失败原因已经交给 error 显示在表单里了（不吞），而 importCard 是先校验后落盘
    // —— 校验没过时存储与内存里那张卡一个字节都没动，勾选这一步也没有需要回滚的东西
    error.value = t('card.saveFailed', { message: (err as Error).message })
  }
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
        :meta="metaLine"
        :prompts-open="resourcesOpen"
        @close="emit('close')"
        @toggle-resources="resourcesOpen = !resourcesOpen"
        @select="select"
        @add-branch="emit('add-branch')"
        @add-action="emit('add-action')"
        @add-step="emit('add-step')"
      >
        <!-- 左栏：卡图（本票暂留在那儿，8b 换成一枝一棵的导航树） -->
        <template #content>
          <CardGraph :card="card" :selected="selected" @select="select" />
        </template>

        <!-- 中栏：那个唯一的长滚动体里放「编一步」表单（8c 才换成新表单） -->
        <template #mid>
          <CardNodeForm
            v-if="editing"
            :key="editing.id"
            :id="editing.id"
            :name="editing.name"
            :duty="editing.duty"
            :prompt="editing.prompt"
            :role="editing.role"
            :tools="editing.tools"
            :reads="editing.reads"
            :settings="editing.settings"
            :setting-keys="settingKeys"
            :error="error"
            @save="save"
            @marks="markResources"
          />
        </template>

        <!-- 右栏：公共提示词的读与改（8d 才换成新表单） -->
        <template #prompts>
          <CardResources v-if="resourcesOpen" :card="card" error="" @saved="emit('saved')" />
        </template>
      </EditorShell>
    </div>
  </div>
</template>
