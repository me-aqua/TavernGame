<script setup lang="ts">
/**
 * 角色纹章：从名字哈希出一枚**纹章**（星 / 楔 / 眼 + 一圈刻度），配一个专属色调。
 *
 * 它不是被切掉首字的印章 —— 「萨伦」不会显示成「萨」。完整名字永远在纹章旁边，
 * 纹章只负责「一眼认出这是谁」。主角多一圈金边与一枚冠。
 */
import { computed } from 'vue'

const props = defineProps<{
  name: string
  /** 主角：金边 + 冠 */
  you?: boolean
  size?: 'sm' | 'md' | 'lg'
}>()

const TINTS = ['#c9a24a', '#b05a3a', '#5f8a7a', '#6f7fa8', '#b07a3a', '#8a5a7a']

function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = ((value << 5) - value + text.charCodeAt(i)) | 0
  return Math.abs(value)
}

const seed = computed(() => hash(props.name))
const tint = computed(() => (props.you ? '#e8c877' : TINTS[seed.value % TINTS.length]))
const variant = computed(() => seed.value % 3)
const rotation = computed(() => (props.you ? 0 : (seed.value % 40) - 20))
</script>

<template>
  <span
    class="sigil"
    :class="[size ?? 'md', { 'sigil-you': you }]"
    :style="{ color: tint }"
    :title="name"
    :aria-label="name"
    role="img"
  >
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="28.5" class="sigil-ring" />
      <circle cx="32" cy="32" r="23" class="sigil-ring-faint" />
      <g :transform="`rotate(${rotation} 32 32)`">
        <path
          v-if="variant === 0"
          class="sigil-mark"
          d="M32 7 37.5 26.5 57 32 37.5 37.5 32 57 26.5 37.5 7 32 26.5 26.5Z"
        />
        <path
          v-else-if="variant === 1"
          class="sigil-mark"
          d="M32 9 49 27 41 27 49 38 32 55 15 38 23 27 15 27Z"
        />
        <template v-else>
          <path class="sigil-mark" d="M9 32Q32 12 55 32Q32 52 9 32Z" />
          <circle cx="32" cy="32" r="6" class="sigil-eye" />
        </template>
      </g>
      <path v-if="you" class="sigil-crown" d="M21 13 26 6 32 12 38 6 43 13 41 18H23Z" />
    </svg>
  </span>
</template>
