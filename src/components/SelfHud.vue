<script setup lang="ts">
/**
 * 主角牌 HUD：名字 / 纹章 / 数值属性 / 此刻标签 / 关系 / 行囊。
 *
 * 数据全部来自 `lead` 那一段（卡声明了 self 块才有），按形状摊开；
 * 桌面是左栏的完整角色牌，手机上收成一条「名字 + 此刻」的横条（细节在手册里）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { selfHud, type HudPerson } from './hud'
import CharacterSigil from './world/CharacterSigil.vue'

const { t } = useI18n()

const props = defineProps<{
  /** lead：主控那一段状态 */
  lead: unknown
  /** 已知人物（手机压在主角条里；桌面由右侧人物牌负责） */
  people?: HudPerson[]
}>()

const self = computed(() => selfHud(props.lead))
const party = computed(() => (props.people ?? []).slice(0, 2))
</script>

<template>
  <section class="hud-panel self-hud" data-self-hud>
    <header class="self-head flex items-center gap-2.5">
      <CharacterSigil :name="self.name || t('hud.self')" you size="md" />
      <div class="min-w-0">
        <p class="hud-kicker">{{ t('hud.self') }}</p>
        <p class="hud-name truncate" data-self-name>{{ self.name || t('hud.self') }}</p>
      </div>
    </header>

    <div v-if="party.length" class="self-party" data-self-party>
      <span
        v-for="person in party"
        :key="person.name"
        class="self-party-card"
        :title="person.name"
        :data-self-party-name="person.name"
      >
        <CharacterSigil :name="person.name" size="sm" />
        <span class="truncate">{{ person.name }}</span>
      </span>
    </div>

    <div v-if="self.stats.length" class="self-stats mt-3">
      <p class="hud-title">{{ t('hud.stats') }}</p>
      <ul class="mt-1.5 grid grid-cols-2 gap-x-2.5 gap-y-1">
        <li v-for="stat in self.stats" :key="stat.key" class="flex min-w-0 items-center gap-1.5">
          <span class="hud-kicker w-[4.6rem] truncate">{{ stat.key.split('.').at(-1) }}</span>
          <span class="hud-stat-value">{{ stat.value }}</span>
          <span class="hud-bar"><span :style="{ width: `${Math.round(stat.ratio * 100)}%` }" /></span>
        </li>
      </ul>
    </div>

    <div v-if="self.badges.length" class="self-now mt-3">
      <p class="hud-title">{{ t('hud.now') }}</p>
      <ul class="mt-1.5 flex flex-wrap gap-1">
        <li v-for="badge in self.badges" :key="badge.key" class="hud-chip">{{ badge.value }}</li>
      </ul>
    </div>

    <div class="self-relations mt-3">
      <p class="hud-title">{{ t('hud.relations') }}</p>
      <ul v-if="self.relations.length" class="mt-1.5 space-y-1">
        <li v-for="rel in self.relations" :key="rel.name + rel.detail" class="hud-relation">
          <span class="hud-relation-name">{{ rel.name }}</span>
          <span v-if="rel.detail" class="hud-relation-detail">{{ rel.detail }}</span>
        </li>
      </ul>
      <p v-else class="hud-empty">{{ t('hud.relationsEmpty') }}</p>
    </div>

    <div class="self-pack mt-3">
      <p class="hud-title">
        {{ t('hud.pack') }}
        <span v-if="self.packCount" class="hud-count">
          {{ t('hud.items', { count: self.packCount }) }}
        </span>
      </p>
      <ul v-if="self.pack.length" class="mt-1.5 flex flex-wrap gap-1">
        <li v-for="item in self.pack" :key="item" class="hud-chip">{{ item }}</li>
      </ul>
      <p v-else class="hud-empty">{{ t('hud.packEmpty') }}</p>
    </div>
  </section>
</template>
