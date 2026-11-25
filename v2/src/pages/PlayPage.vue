<script setup lang="ts">
/**
 * 对话页（SPEC §5）：故事流 → 输入框 + 发送；流式、可停止、每回合自动存档。
 *
 * 三条最要紧的语义：
 *   · **跑的一律是 `save.cardSnapshot`**（不是 `tg2.cards` 里那张现卡）——
 *     改卡只影响之后新建的存档，旧存档按它冻结时的那张卡跑（SPEC §9.4）；
 *   · **停止 = 什么都不写**：本轮半截文本丢掉、故事流回到回合开始前、存档一个字节没动；
 *   · **没有封面 / 开始按钮**：打开存档直接看到「开场」这一块提示词的正文（故事的第一段），
 *     下面是故事流与输入区。
 *
 * 右上角 `[data-debug-toggle]` 决定调试面板看不看：开着是逐节点读数（提示词 / 返回 / token /
 * t/s / 耗时），关着时页面上只剩最终故事与本回合总耗时。`?debug=1` 只是它的初始状态。
 *
 * 🔴 **读盘失败时只留表头 + 错误面板**（`loadFailed`）：存档 / 卡快照读不进来时，
 * 页面上的故事流与输入区一律不渲染 —— 那两者后面挂着「写回整份存档」，坏数据一被写回
 * 就再也拿不回来了。闸门**不能**挂在 `error` 上：`error` 也装着回合中途的 provider 错误，
 * 那种失败之后故事与输入框必须还在。
 */
import { computed, onMounted, ref } from 'vue'
import DebugPanel from '../components/DebugPanel.vue'
import ErrorPanel from '../components/ErrorPanel.vue'
import StoryView from '../components/StoryView.vue'
import type { StoryLine } from '../components/types'
import { asAppError, storage } from '../app-context'
import { AppError } from '../core/errors'
import type { DebugPayload } from '../core/engine'
import { runTurn } from '../core/engine'
import { OPENING_PROMPT_ID, validateCard, validateSave } from '../core/schema'
import type { Preset, Save } from '../core/types'
import { t } from '../i18n'
import { routeHash } from '../router'

const props = defineProps<{ cardId: string; saveId: string }>()

const save = ref<Save | null>(null)
const presets = ref<Preset[]>([])
const nodePresets = ref<Record<string, string>>({})
const error = ref<AppError | null>(null)
/** 读盘失败：故事流 / 输入框 / 发送 / 调试面板都不许出现（一写盘就会覆盖盘上那份坏存档） */
const loadFailed = ref(false)
const running = ref(false)
const streaming = ref('')
const draft = ref('')
const status = ref('')
const debug = ref<DebugPayload | null>(null)
const debugEnabled = ref(new URLSearchParams(location.search).get('debug') === '1')
let controller: AbortController | null = null

/** 故事的第一段：「开场」那块公共提示词的正文（空则不放） */
const openingBody = computed(
  () => save.value?.cardSnapshot.prompts.find((prompt) => prompt.id === OPENING_PROMPT_ID)?.body ?? '',
)

const lines = computed<StoryLine[]>(() => {
  const events = save.value?.events ?? []
  const story: StoryLine[] = events
    .filter((event) => event.type === 'action' || event.type === 'narration')
    .map((event) => ({ type: event.type as StoryLine['type'], text: event.text }))
  if (openingBody.value !== '') story.unshift({ type: 'narration', text: openingBody.value })
  return story
})

onMounted(() => {
  try {
    const saves = storage().loadSaves()
    const found = saves.find((item) => item.id === props.saveId)
    if (!found)
      throw new AppError('E_VALIDATION', { message: t('error.missingSave'), nextStep: t('next.home') })
    if (found.cardId !== props.cardId) {
      throw new AppError('E_VALIDATION', { message: t('error.cardIdMismatch'), nextStep: t('next.home') })
    }
    validateCard(found.cardSnapshot)
    validateSave(found, found.cardSnapshot)
    save.value = found
    presets.value = storage().loadPresets()
    nodePresets.value = storage().loadNodeModels()[props.cardId] ?? {}
    if (found.turn > 0) status.value = t('play.status', { turn: found.turn })
  } catch (cause) {
    loadFailed.value = true
    error.value = asAppError(cause)
  }
})

function persistSave(next: Save): void {
  const saves = storage()
    .loadSaves()
    .map((item) => (item.id === next.id ? next : item))
  storage().saveSaves(saves)
}

async function send(): Promise<void> {
  const current = save.value
  const action = draft.value
  if (!current || running.value || action === '') return
  running.value = true
  streaming.value = ''
  error.value = null
  controller = new AbortController()
  try {
    const result = await runTurn({
      card: current.cardSnapshot,
      save: current,
      presets: presets.value,
      nodePresets: nodePresets.value,
      action,
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'chunk') streaming.value += event.text
      },
    })
    save.value = result.save
    persistSave(result.save)
    debug.value = result.debug
    draft.value = ''
    status.value = t('play.status', { turn: result.save.turn })
  } catch (cause) {
    const failure = asAppError(cause)
    // 停止不是错误现场：半截文本丢掉、输入框留着刚才那句话，不弹错
    if (failure.code !== 'E_ABORTED') error.value = failure
  } finally {
    running.value = false
    streaming.value = ''
    controller = null
  }
}

function stop(): void {
  controller?.abort()
}

function goBack(): void {
  location.hash = routeHash({ name: 'home' })
}
</script>

<template>
  <div class="page" data-page="play">
    <header class="page-bar">
      <button type="button" data-back @click="goBack">{{ t('nav.back') }}</button>
      <span class="page-title ellipsis">{{ save ? save.cardSnapshot.name : cardId }}</span>
      <span class="muted">{{ save ? save.name : saveId }}</span>
      <span class="spacer"></span>
      <span v-if="!debugEnabled && debug" class="muted" data-turn-ms>
        {{ t('play.turnMs', { ms: Math.round(debug.totalMs) }) }}
      </span>
      <span class="turn" data-turn>{{ save ? save.turn : 0 }}</span>
      <span class="muted status ellipsis" data-status>{{ status }}</span>
      <button
        type="button"
        data-debug-toggle
        :data-on="debugEnabled ? 'true' : 'false'"
        @click="debugEnabled = !debugEnabled"
      >
        {{ t('play.debugToggle') }}
      </button>
    </header>

    <ErrorPanel v-if="error" :error="error" />

    <div v-if="!loadFailed" class="page-body">
      <div class="play-main">
        <StoryView :lines="lines" :streaming="streaming" />

        <div class="composer">
          <textarea
            v-model="draft"
            class="input"
            data-action-input
            :disabled="running"
            :placeholder="t('play.inputPlaceholder')"
            @keydown.enter.exact.prevent="send"
          ></textarea>
          <button type="button" data-send :disabled="running || draft === ''" @click="send">
            {{ t('play.send') }}
          </button>
          <button v-if="running" type="button" data-stop @click="stop">{{ t('play.stop') }}</button>
        </div>
      </div>

      <DebugPanel v-if="debugEnabled" :debug="debug" />
    </div>
  </div>
</template>

<style scoped>
.spacer {
  flex: 1 1 auto;
}

.turn {
  flex: 0 0 auto;
  font-weight: 600;
  font-size: var(--fs1);
  min-width: 20px;
  text-align: right;
}

.status {
  flex: 0 1 auto;
  max-width: 220px;
}

.play-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.composer {
  flex: 0 0 auto;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 10px 12px;
  border-top: 1px solid var(--line);
  background: var(--panel-2);
  min-width: 0;
}

.input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 44px;
  max-height: 160px;
}
</style>
