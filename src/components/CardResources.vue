<script setup lang="ts">
/**
 * 资源库面板：把卡里那几块原始提示词（五块设定 / 剧本 / 节点约定 / 生成器）摆出来看与改。
 *
 * 资源不是卡里的新键，是**既有内容的一种视图** —— 五块设定按卡的声明顺序，然后是剧本、
 * 节点约定、生成器（生成器一条一件，名字取它自己的 `name`，那是作者写的、不翻译）。
 * 名字走 `prompts.*` 那套键 —— 与调试痕迹里显示的是同一串，用户要的就是两边对得上号。
 *
 * 每项点开才交出正文（`style` 那 233 行不许默认铺开）：行数组按 `\n` 拼，`script` /
 * `generators` 是 JSON 文本。存回走 `importCard` —— 与导入卡同一条路（卡格式 + 显示词汇表
 * 两道校验），通过才落盘；失败原样显示原因，**内存里那张卡一个字节都不动**，
 * 成功也只 emit saved（reload 是外层的事）。
 */
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { importCard } from '../game/current-card'
import type { CardData } from '../game/card'

const { t } = useI18n()

const props = defineProps<{
  /** 要看的卡（当前卡） */
  card: CardData
  /** 外层校验失败的原因（原样显示，不吞）；没有就是空串 */
  error: string
}>()

const emit = defineEmits<{
  /** 改完也存下了 —— 外层负责 reload */
  saved: []
}>()

/** 一项资源：钩子用的 id、给人看的名字、正文的可编辑形态 */
interface Resource {
  id: string
  label: string
  text: string
}

/** 卡里的全部资源，顺序 = 卡自己的声明顺序（契约 §2.2） */
function resourceList(card: CardData): Resource[] {
  const settings = Object.entries(card.settings).map(([key, lines]) => ({
    id: key,
    label: t('prompts.settingBlock.' + key),
    text: lines.join('\n'),
  }))
  return [
    ...settings,
    { id: 'script', label: t('prompts.script'), text: JSON.stringify(card.script, null, 2) },
    { id: 'convention', label: t('prompts.convention'), text: card.convention.join('\n') },
    {
      id: 'generators',
      label: t('prompts.generators'),
      text: JSON.stringify(card.generators, null, 2),
    },
    ...card.generators.map((generator) => ({
      id: generator.name,
      label: generator.name,
      text: JSON.stringify(generator, null, 2),
    })),
  ]
}

/**
 * 展开着的那几项 + 各自的草稿。
 *
 * 展开是**同时可以好几项**的：读 `style` 的时候要能对得上 `world`（资源之间是互相印证的关系），
 * 展开一项就把别的收掉等于逼人来回点。
 */
const open = ref<Record<string, boolean>>({})
const drafts = ref<Record<string, string>>({})
/** 这一项保存失败的原因；再展开时清掉 */
const failed = ref('')

/** 展开 / 收起一项：展开时从卡里现取正文，顺手清掉上一项留下的报错 */
function toggle(id: string): void {
  failed.value = ''
  if (open.value[id]) {
    open.value[id] = false
    return
  }
  open.value[id] = true
  drafts.value[id] = resourceList(props.card).find((entry) => entry.id === id)?.text ?? ''
}

/**
 * 把这一项的正文写回卡：先在副本上改，再走与导入同一套校验，通过才落盘。
 *
 * 校验失败时连内存里那张卡都不许动 —— 它还在被引擎与界面用着。
 */
function save(id: string): void {
  const text = drafts.value[id] ?? ''
  // ⚠️ 这一判不能交给校验器：行数组只拒**空表**（`[]`），一行空串是合法的
  //    （提示词里本来就有空行）—— 清空一段正文存下去，卡里就留下一段空正文
  if (text.trim() === '') {
    failed.value = t('card.saveFailed', { message: t('card.resourceEmpty') })
    return
  }
  const next = JSON.parse(JSON.stringify(props.card)) as CardData
  if (Object.hasOwn(next.settings, id)) {
    next.settings[id as keyof CardData['settings']] = text.split('\n')
  } else if (id === 'script') {
    next.script = JSON.parse(text) as Record<string, unknown>
  } else if (id === 'convention') {
    next.convention = text.split('\n')
  } else {
    // 一条生成器：卡里按名字索引，改的是那一条
    const found = next.generators.find((generator) => generator.name === id)
    if (found === undefined) return
    Object.assign(found, JSON.parse(text))
  }
  failed.value = ''
  try {
    importCard(JSON.stringify(next))
    emit('saved')
  } catch (err) {
    // 边界：正文是人填的（手写的 JSON 可能不合法）—— 失败要显示出来，存储原样不动
    failed.value = t('card.saveFailed', { message: (err as Error).message })
  }
}
</script>

<template>
  <section data-card-resources class="rounded-xl border border-line bg-surface-2 p-3">
    <h3 class="text-[12.5px] font-semibold text-accent">{{ t('card.resourcesTitle') }}</h3>

    <p
      v-if="error || failed"
      data-card-error
      class="mt-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] leading-relaxed text-danger"
      v-text="failed || error"
    />

    <ul class="mt-2 space-y-1">
      <li
        v-for="resource in resourceList(card)"
        :key="resource.id"
        :data-card-resource="resource.id"
        class="rounded-lg border border-line bg-page px-3 py-2"
      >
        <div class="flex items-center justify-between gap-3">
          <span class="min-w-0 truncate text-[12.5px] text-text">{{ resource.label }}</span>
          <button
            type="button"
            data-card-resource-open
            class="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-muted transition-colors hover:bg-surface-2 hover:text-text"
            @click="toggle(resource.id)"
          >
            {{ t('card.resourceOpen') }}
          </button>
        </div>

        <template v-if="open[resource.id]">
          <textarea
            v-model="drafts[resource.id]"
            data-card-resource-text
            rows="8"
            spellcheck="false"
            class="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[12px] leading-relaxed text-text outline-none transition-colors focus:border-accent-line"
          />
          <button
            type="button"
            data-card-resource-save
            class="mt-2 rounded-lg bg-accent px-3 py-1.5 text-[12px] font-semibold text-page transition-opacity hover:opacity-90"
            @click="save(resource.id)"
          >
            {{ t('card.resourceSave') }}
          </button>
        </template>
      </li>
    </ul>
  </section>
</template>
