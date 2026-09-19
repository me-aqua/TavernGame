<script setup lang="ts">
/**
 * 游戏舞台：左栏主角牌 + 故事链，中央叙事面板，右栏人物牌。
 * 行动牌是舞台下的常驻底栏（App 里，贴在输入区上方）；小屏自动收成单栏
 * （主角条 / 叙事 / 人物），舞台自己滚，输入区与行动牌始终在屏幕底部。
 *
 * 数据由 App 用 `game/display.ts` 的 hudData(卡的显示声明, 状态树) 算好传进来 ——
 * 舞台不认识任何一张卡的内容，也不自己读状态。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import CastHud from './CastHud.vue'
import NarrativePanel from './NarrativePanel.vue'
import QuestHud from './QuestHud.vue'
import SelfHud from './SelfHud.vue'
import { peopleHud } from './hud'
import SceneSigil from './world/SceneSigil.vue'
import type { HudData, Spot } from '../game/display'
import type { Row, Status } from '../stores/game'

const { t } = useI18n()

const props = defineProps<{
  rows: Row[]
  turn: number
  busy: boolean
  status: Status | null
  scene: Spot
  timeLabel: string
  cardName: string
  hud: HudData
}>()

const emit = defineEmits<{ history: []; world: [] }>()

const sceneLabel = computed(() => {
  const parts = [props.scene.spot, props.scene.scene].filter((part) => part !== '')
  return parts.length > 0 ? parts.join(t('sidebar.separator')) : props.scene.area
})
const sceneSeed = computed(() => `${props.scene.area}${props.scene.spot}${props.scene.scene}`)

/** 手机主角条里的在场人物：在场的排前面 */
const party = computed(() =>
  [...peopleHud(props.hud.cast, props.hud.where, props.hud.location)].sort(
    (a, b) => Number(b.present) - Number(a.present),
  ),
)
</script>

<template>
  <div class="game-stage" data-game-stage>
    <SceneSigil :seed="sceneSeed" />

    <div class="game-grid">
      <div class="stage-left">
        <SelfHud :lead="hud.lead" :people="party" />
        <QuestHud class="stage-quests" :chains="hud.chains" />
      </div>

      <main class="stage-main">
        <NarrativePanel
          :rows="rows"
          :turn="turn"
          :busy="busy"
          :status="status"
          :scene-label="sceneLabel"
          :time-label="timeLabel"
          :card-name="cardName"
          :sigil-seed="sceneSeed"
          @history="emit('history')"
        />
      </main>

      <div class="stage-right">
        <CastHud :roles="hud.cast" :where="hud.where" :here="hud.location" @open="emit('world')" />
      </div>
    </div>
  </div>
</template>
