<script setup lang="ts">
/**
 * 场景剪影：从地点名哈希出一座**抽象地标**（塔 / 拱门 / 林 / 山）与一枚月亮，
 * 低透明度铺在叙事面板后面。它不是写实原画，是「这一幕在哪儿」的一眼轮廓。
 *
 * 卡不提供图片也能有舞台感；换地点就换一张剪影。reduced motion 下静止。
 */
import { computed } from 'vue'

const props = defineProps<{ seed: string }>()

function hash(text: string): number {
  let value = 0
  for (let i = 0; i < text.length; i += 1) value = ((value << 5) - value + text.charCodeAt(i)) | 0
  return Math.abs(value)
}

const variant = computed(() => hash(props.seed) % 4)
</script>

<template>
  <svg class="scene-sigil" viewBox="0 0 400 240" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
    <circle cx="308" cy="58" r="34" class="scene-moon" />

    <g v-if="variant === 0">
      <!-- 塔 -->
      <path class="scene-mark" d="M104 214V92H88V66h18V40h18v26h20V66h18v26h-16v122Z" />
      <path class="scene-cut" d="M132 112h12v26h-12Z" />
      <path class="scene-cut" d="M132 156h12v26h-12Z" />
    </g>
    <g v-else-if="variant === 1">
      <!-- 拱门 / 遗迹 -->
      <path class="scene-mark" d="M78 214v-84q0-78 84-78t84 78v84h-34v-82q0-44-50-44t-50 44v82Z" />
      <path class="scene-cut" d="M146 214v-76q0-26 36-26t36 26v76Z" />
    </g>
    <g v-else-if="variant === 2">
      <!-- 林 -->
      <path class="scene-mark" d="M96 214v-40H72l24-42H78l32-54 32 54h-18l24 42h-24v40Z" />
      <path class="scene-mark" d="M200 214v-28h-18l18-32h-13l25-43 25 43h-13l18 32h-18v28Z" />
      <path class="scene-mark" d="M306 214v-34h-20l20-36h-15l27-46 27 46h-15l20 36h-20v34Z" />
    </g>
    <g v-else>
      <!-- 山 -->
      <path class="scene-mark" d="M24 214 108 78l52 76 44-52 68 112Z" />
      <path class="scene-cut" d="M108 78l22 32-16 12Z" />
      <path class="scene-cut" d="M204 102l18 30-14 9Z" />
    </g>

    <path class="scene-ground" d="M16 214H384" />
  </svg>
</template>
