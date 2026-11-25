<script setup lang="ts">
/**
 * 设置页的模型预设表（SPEC §5「设置」）。
 *
 * 一条预设 = 名称 / Base URL / 模型 / Key / 思考强度。Key 只住本机（`tg2.presets`），
 * 不写日志、不进卡；`[data-preset-key]` 用 password 输入框，屏幕上不回显明文。
 */
import type { Preset, Reasoning } from '../core/types'
import { t } from '../i18n'

defineProps<{ presets: Preset[] }>()

defineEmits<{
  add: []
  patch: [id: string, patch: Partial<Preset>]
  remove: [id: string]
}>()

const REASONINGS: Reasoning[] = ['off', 'low', 'medium', 'high']
</script>

<template>
  <div class="preset-list" data-preset-list>
    <div class="col-title">
      <span class="ellipsis">{{ t('settings.presets') }}</span>
      <button type="button" data-add-preset @click="$emit('add')">{{ t('settings.addPreset') }}</button>
    </div>
    <div class="rows scroll">
      <div v-for="preset in presets" :key="preset.id" class="preset" :data-preset="preset.id">
        <div class="row">
          <label class="field-row grow">
            <span class="field-label">{{ t('settings.presetName') }}</span>
            <input
              data-preset-name
              :value="preset.name"
              @input="$emit('patch', preset.id, { name: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <button
            type="button"
            :title="t('settings.deletePreset')"
            data-delete-preset
            @click="$emit('remove', preset.id)"
          >
            {{ t('common.remove') }}
          </button>
        </div>
        <div class="row">
          <label class="field-row grow">
            <span class="field-label">{{ t('settings.baseUrl') }}</span>
            <input
              data-preset-baseurl
              :value="preset.baseUrl"
              @input="$emit('patch', preset.id, { baseUrl: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="field-row grow">
            <span class="field-label">{{ t('settings.model') }}</span>
            <input
              data-preset-model
              :value="preset.model"
              @input="$emit('patch', preset.id, { model: ($event.target as HTMLInputElement).value })"
            />
          </label>
        </div>
        <div class="row">
          <label class="field-row grow">
            <span class="field-label">{{ t('settings.apiKey') }}</span>
            <input
              type="password"
              data-preset-key
              :value="preset.apiKey"
              autocomplete="off"
              @input="$emit('patch', preset.id, { apiKey: ($event.target as HTMLInputElement).value })"
            />
          </label>
          <label class="field-row">
            <span class="field-label">{{ t('settings.reasoning') }}</span>
            <select
              data-preset-reasoning
              :value="preset.reasoning"
              @change="
                $emit('patch', preset.id, {
                  reasoning: ($event.target as HTMLSelectElement).value as Reasoning,
                })
              "
            >
              <option v-for="level in REASONINGS" :key="level" :value="level">
                {{ t(`settings.reasoning.${level}`) }}
              </option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset-list {
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  width: 100%;
}

.rows {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.preset {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  min-width: 0;
}

/* 预设里的每一行（label + 输入框 / 删除按钮）也是 36 的行容器：控件 28 居中 */
.preset .row {
  height: var(--row-h);
}

.grow {
  flex: 1 1 auto;
}
</style>
