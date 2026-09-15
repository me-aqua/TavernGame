<script setup lang="ts">
/**
 * 卡界面：浮层里的卡图 + 节点编辑表单（设置面板「查看 / 编辑卡图」打开它）。
 *
 * 形态按决定 #24：绝对定位的浮层盖在故事上，不挤占正文 —— 关了它下面还是原来那一屏。
 * 保存走**与导入同一套校验**（importCard：卡格式 + 显示词汇表），通过才落盘；失败原样
 * 显示在表单里。落盘成功只 emit saved，reload 由外层做（引擎与显示映射都在模块加载期
 * 读卡，见 game/current-card.ts）。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CardGraph from './CardGraph.vue'
import CardNodeForm from './CardNodeForm.vue'
import { cardMeta, importCard, type CardSource } from '../game/current-card'
import type { CardData } from '../game/card'
import * as K from '../game/card-keys'

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
}>()

/** 选中的节点 id；空串 = 还没选 */
const selected = ref('')
/** 保存失败的原因（原样显示，不吞） */
const error = ref('')

const meta = computed(() => cardMeta(props.card))
const sourceLabel = computed(() =>
  props.source === 'imported' ? t('card.sourceImported') : t('card.sourceBuiltin'),
)

/** 卡里「图」那一块（卡已校验，形状由 game/card.ts 守） */
function graphOf(card: CardData): Record<string, unknown> {
  return (card[K.KEY_DECL] as Record<string, unknown>)[K.KEY_GRAPH] as Record<string, unknown>
}

/** 节点 id → 它的三个键（名 / 职责 / 输出） */
function nodesOf(card: CardData): Record<string, Record<string, unknown>> {
  return graphOf(card)[K.KEY_NODES] as Record<string, Record<string, unknown>>
}

/** 节点 id → 提示词.节点[id]（一行一条） */
function promptsOf(card: CardData): Record<string, string[]> {
  return (card[K.KEY_PROMPT] as Record<string, unknown>)[K.KEY_NODES] as Record<string, string[]>
}

/** 正在编辑的那个节点；没选中就是 null */
const editing = computed(() => {
  if (!selected.value) return null
  const node = nodesOf(props.card)[selected.value]
  return {
    id: selected.value,
    name: node[K.KEY_NODE_NAME] as string,
    duty: node[K.KEY_DUTY] as string,
    output: node[K.KEY_OUTPUT] as Record<string, unknown>,
    prompt: promptsOf(props.card)[selected.value],
  }
})

/** 选一个节点（顺手清掉上一个节点留下的报错） */
function select(id: string) {
  selected.value = id
  error.value = ''
}

/**
 * 保存：把改过的三个字段写回整张卡，再跑与导入同一套校验。
 *
 * 先在副本上改（卡本来就来自 JSON，整份复制最省事）：校验失败时内存里那张必须原样 ——
 * 它还在被引擎与界面用着。
 */
function save(value: { name: string; duty: string; prompt: string[] }) {
  const next = JSON.parse(JSON.stringify(props.card)) as CardData
  const node = nodesOf(next)[selected.value]
  node[K.KEY_NODE_NAME] = value.name
  node[K.KEY_DUTY] = value.duty
  promptsOf(next)[selected.value] = value.prompt
  error.value = ''
  try {
    importCard(JSON.stringify(next))
    emit('saved')
  } catch (err) {
    // 边界：表单是人填的（重名 / 空提示词都可能）—— 失败要显示出来，存储原样不动
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
      <header class="flex shrink-0 items-start justify-between gap-2 border-b border-line px-4 py-3">
        <div class="min-w-0">
          <h2 class="text-[15px] font-semibold text-text">{{ t('card.graphTitle') }}</h2>
          <p class="mt-0.5 text-[11.5px] text-muted">
            {{ t('card.meta', { name: meta.name, version: meta.version, source: sourceLabel }) }}
          </p>
        </div>
        <button
          data-card-close
          :aria-label="t('card.close')"
          :title="t('card.close')"
          class="flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
          @click="emit('close')"
        >
          {{ t('card.closeIcon') }}
        </button>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <p class="mb-2 text-[11.5px] text-muted">{{ t('card.graphLegend') }}</p>
        <CardGraph :card="card" :selected="selected" @select="select" />
        <p v-if="!editing" class="mt-2 text-[12px] text-faint">{{ t('card.graphHint') }}</p>
        <CardNodeForm
          v-else
          :key="editing.id"
          :id="editing.id"
          :name="editing.name"
          :duty="editing.duty"
          :output="editing.output"
          :prompt="editing.prompt"
          :error="error"
          @save="save"
        />
      </div>
    </div>
  </div>
</template>
