<script setup lang="ts">
/**
 * 角色纹章：从名字哈希出一枚**纹章**（星 / 楔 / 眼 + 一圈刻度），配一个专属色调。
 *
 * 它不是被切掉首字的印章 —— 「萨伦」不会显示成「萨」。完整名字永远在纹章旁边，
 * 纹章只负责「一眼认出这是谁」。主角多一圈金边与一枚冠。
 *
 * ⚠️ 画出来那三样（形 / 色 / 角度）只由**名字的字节**派生：同一个名字必得同一枚，
 *    改一个字就换一枚 —— 名字怎么起，纹章就怎么变，这是它的定义不是副作用。
 * ⚠️ 样式随件走（文件末尾那个 `<style scoped>`）：它不依赖任何全局类，放进哪一层都长得一样。
 */
import { computed } from 'vue'

const props = defineProps<{
  name: string
  /** 主角：金边 + 冠 */
  you?: boolean
  size?: 'sm' | 'md' | 'lg'
}>()

const TINTS = ['#c9a24a', '#b05a3a', '#5f8a7a', '#6f7fa8', '#b07a3a', '#8a5a7a']

/** 名字 → 一个非负整数种子（形 / 色 / 角度三样都从它派生） */
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

<style scoped>
/* 纹章本体：一枚圆章。外圈两道刻度（实线 + 虚线）由 `sigil-ring` 那一族画，
 * 里头的记号由 `sigil-mark` 那一族画 —— 记号颜色跟着行内 `color`（那个专属色调）走。 */
.sigil {
  position: relative;
  display: inline-grid;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 9999px;
  background: radial-gradient(circle at 38% 30%, rgb(255 240 200 / 0.12), rgb(0 0 0 / 0.2));
  box-shadow:
    inset 0 0 0 1px rgb(255 255 255 / 0.06),
    0 2px 8px rgb(0 0 0 / 0.35);
}

.sigil.sm {
  width: 2rem;
  height: 2rem;
}
.sigil.md {
  width: 2.75rem;
  height: 2.75rem;
}
.sigil.lg {
  width: 4.5rem;
  height: 4.5rem;
}
.sigil svg {
  width: 100%;
  height: 100%;
}
.sigil-ring {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  opacity: 0.75;
}
.sigil-ring-faint {
  fill: none;
  stroke: currentColor;
  stroke-width: 1;
  stroke-dasharray: 2 3;
  opacity: 0.3;
}
.sigil-mark {
  fill: currentColor;
  opacity: 0.85;
}
.sigil-eye {
  fill: #17110a;
  opacity: 0.8;
}
.sigil-crown {
  fill: currentColor;
  opacity: 0.95;
}
.sigil-you {
  box-shadow:
    inset 0 0 0 1px rgb(232 200 119 / 0.45),
    0 0 0 3px rgb(232 200 119 / 0.12),
    0 4px 12px rgb(0 0 0 / 0.45);
}
</style>
