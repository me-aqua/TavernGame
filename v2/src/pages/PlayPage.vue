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
 * 发送（老板 2026-11-25）：点发送 / 回车后**立刻**把这一句行动当 `[data-pending-action]` 挂到
 * 时间轴上（乐观副本，排在本回合的 trace 之前），**同一时刻清空输入框**；第一段正文还没到时，
 * 下面一行 `[data-generating]`「生成中……」。正文一到就换成流式 narration、行动气泡留着；
 * 回合成功时存档事件里已经有这条行动 ⇒ 撤掉副本（不重复）；停止 / 出错则副本与半截正文一起撤掉，
 * 并把刚才那句放回输入框（存档不变）。
 *
 * 右上角 `[data-debug-toggle]` 决定**故事流里看不看逐节点读数**：开着时每个节点一张卡片
 * （提示词组装 / 思考 / 工具调用 / 输出 / 用量与耗时），关着时只剩故事与每回合一行合计读数。
 * `?debug=1` 只是它的初始状态。
 *
 * 🔴 **读数来自存档**：每个节点的 trace 与每回合的 turnStats 都落在 `save.events` 里 ——
 * 所以打开一份旧存档再点开调试，也能看见当时每一步（不用重跑模型）。
 *
 * 🔴 **读盘失败时只留表头 + 错误面板**（`loadFailed`）：存档 / 卡快照读不进来时，
 * 页面上的故事流与输入区一律不渲染 —— 那两者后面挂着「写回整份存档」，坏数据一被写回
 * 就再也拿不回来了。闸门**不能**挂在 `error` 上：`error` 也装着回合中途的 provider 错误，
 * 那种失败之后故事与输入框必须还在。
 */
import { computed, onMounted, ref } from 'vue'
import ErrorPanel from '../components/ErrorPanel.vue'
import StoryView from '../components/StoryView.vue'
import type { StoryItem } from '../components/types'
import { asAppError, storage } from '../app-context'
import { AppError } from '../core/errors'
import { runTurn } from '../core/engine'
import { OPENING_PROMPT_ID, validateCard, validateSave } from '../core/schema'
import type { Preset, Save, SaveEvent, TraceDetail, TurnStatsDetail } from '../core/types'
import { t } from '../i18n'
import { routeHash } from '../router'

const props = defineProps<{ cardId: string; saveId: string }>()

const save = ref<Save | null>(null)
const presets = ref<Preset[]>([])
const nodePresets = ref<Record<string, string>>({})
const error = ref<AppError | null>(null)
/** 读盘失败：故事流 / 输入框 / 发送 / 调试开关都不许出现（一写盘就会覆盖盘上那份坏存档） */
const loadFailed = ref(false)
const running = ref(false)
const streaming = ref('')
const draft = ref('')
/**
 * 这一回合**还没落盘**的行动：点发送就挂上故事流（乐观），回合成功 / 停止 / 出错时撤掉。
 * 成功时 `save.events` 里已经有一条同样的 `action`，留着它就是两个气泡。
 */
const pendingAction = ref('')
const status = ref('')
const debugEnabled = ref(new URLSearchParams(location.search).get('debug') === '1')
/** 本轮**还没落盘**的 trace / turnStats：边跑边显示，回合结束就并进 `save.events` */
const liveEvents = ref<SaveEvent[]>([])
let controller: AbortController | null = null

/** 故事的第一段：「开场」那块公共提示词的正文（空则不放） */
const openingBody = computed(
  () => save.value?.cardSnapshot.prompts.find((prompt) => prompt.id === OPENING_PROMPT_ID)?.body ?? '',
)

/**
 * 故事流时间轴：按 `save.events` 的顺序排，再拼上本轮还在路上的那几条。
 *   · action / narration：永远在；
 *   · trace：只在调试开着时放进来（历史回合的 trace 也在存档里，所以加载旧存档也看得见）；
 *   · turnStats：永远在（紧凑一行合计读数）。
 * 本回合的乐观行动插在**已落盘事件之后、实时 trace 之前** —— 行动是这一回合的开头。
 */
const items = computed<StoryItem[]>(() => {
  const timeline: StoryItem[] = []
  /** 把一条存档事件翻译成时间轴上的一项（trace 另看调试开关） */
  const push = (event: SaveEvent) => {
    if (event.type === 'action' || event.type === 'narration') {
      timeline.push({ type: event.type, text: event.text })
    } else if (event.type === 'trace' && debugEnabled.value) {
      timeline.push({ type: 'trace', trace: event.detail as TraceDetail })
    } else if (event.type === 'turnStats') {
      timeline.push({ type: 'turnStats', stats: event.detail as TurnStatsDetail })
    }
  }
  if (openingBody.value !== '') timeline.push({ type: 'narration', text: openingBody.value })
  for (const event of save.value?.events ?? []) push(event)
  if (pendingAction.value !== '') {
    timeline.push({ type: 'action', text: pendingAction.value, pending: true })
  }
  for (const event of liveEvents.value) push(event)
  return timeline
})

onMounted(() => {
  try {
    // 只按 id 校验要打开的这一份存档：盘上别的坏存档与它无关
    const found = storage().loadSaveById(props.saveId)
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
  // 只替换这一份，别把盘上其它存档（包括坏掉的那些）洗掉
  const entries = storage()
    .loadSaveEntries()
    .map((entry) => (entry.save?.id === next.id ? { raw: next, save: next } : entry))
  storage().saveSavesLoose(entries.map((entry) => entry.raw))
}

async function send(): Promise<void> {
  const current = save.value
  const action = draft.value
  if (!current || running.value || action === '') return
  running.value = true
  streaming.value = ''
  error.value = null
  liveEvents.value = []
  pendingAction.value = action
  // 输入框立刻清空（与乐观气泡同一时刻）；停止 / 出错时再放回去（catch 里）
  draft.value = ''
  controller = new AbortController()
  try {
    const result = await runTurn({
      card: current.cardSnapshot,
      save: current,
      presets: presets.value,
      nodePresets: nodePresets.value,
      action,
      signal: controller.signal,
      // 实时事件：正文增量拼进 streaming；trace / turnStats 先驻在 liveEvents 里
      onEvent: (event) => {
        if (event.type === 'chunk') streaming.value += event.text
        // trace / turnStats 也实时发出来：调试开着时，卡片在这一回合跑完之前就逐张出现
        else if (event.type === 'trace' || event.type === 'turnStats') liveEvents.value.push(event)
      },
    })
    save.value = result.save
    liveEvents.value = []
    persistSave(result.save)
    status.value = t('play.status', { turn: result.save.turn })
  } catch (cause) {
    const failure = asAppError(cause)
    // 停止不是错误现场：半截文本丢掉、输入框留着刚才那句话，不弹错
    if (failure.code !== 'E_ABORTED') error.value = failure
    // 停止 / 出错：把刚发出去的那句放回输入框（玩家没改过才放）
    if (draft.value === '') draft.value = action
  } finally {
    running.value = false
    streaming.value = ''
    // 中止 / 出错时这一回合的存档没写：刚收到的 trace 也不能留在屏幕上
    liveEvents.value = []
    // 乐观行动只在跑的时候存在：成功时存档里已经有这条 action，中止 / 出错时它不算数
    pendingAction.value = ''
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
        <StoryView :items="items" :streaming="streaming" :generating="running && streaming === ''" />

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

/* 调试开着 = accent 实心 + accent-ink（与 `.chip[data-on='true']` / 选中节点同一套语义）；关着仍是普通按钮 */
[data-debug-toggle][data-on='true'] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
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
