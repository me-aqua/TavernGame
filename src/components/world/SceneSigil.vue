<script setup lang="ts">
/**
 * 场景剪影：从地点名哈希出一座**抽象地标**（塔 / 拱门 / 林 / 山）与一枚月亮，
 * 低透明度铺在叙事面板后面。它不是写实原画，是「这一幕在哪儿」的一眼轮廓。
 *
 * 卡不提供图片也能有舞台感；换地点就换一张剪影。reduced motion 下静止。
 *
 * ⚠️ 画出来那座地标只由**种子字符串的字节**派生：同一个地名必得同一张，改一个字就换一张。
 * ⚠️ 样式随件走（文件末尾那个 `<style scoped>`）：它不依赖任何全局类，放进哪一层都长得一样。
 */
import { computed } from 'vue'

const props = defineProps<{ seed: string }>()

/** 种子字符串 → 一个非负整数（四座地标里挑一座） */
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

<style scoped>
/* 铺在叙事后面的水印：整幅贴在容器下沿，只留一层轮廓（`opacity` 由呼吸动效在两档间走）。
 * ⚠️ 定位是 `absolute` —— 它要的是**父层**有定位（消费方那一层的事）。 */
.scene-sigil {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 0;
  width: 100%;
  height: min(46vh, 26rem);
  color: #7d5f2a;
  opacity: 0.14;
  pointer-events: none;
  animation: scene-breathe 9s ease-in-out infinite;
}
.scene-sigil .scene-mark {
  fill: currentColor;
}
.scene-sigil .scene-cut {
  fill: rgb(20 12 6 / 0.55);
}
.scene-sigil .scene-moon,
.scene-sigil .scene-ground {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}
.scene-sigil .scene-moon {
  opacity: 0.7;
}
.scene-sigil .scene-ground {
  opacity: 0.6;
}

@keyframes scene-breathe {
  0%,
  100% {
    opacity: 0.12;
    transform: translateY(0);
  }
  50% {
    opacity: 0.18;
    transform: translateY(-4px);
  }
}

/* 文件头那句「reduced motion 下静止」兑现的地方：玩家把这个偏好打开时，这层水印不许再呼吸。
 * 它是一条**独立**的规则（不进上面那族），因为媒体查询里的声明要能被单独读出来。 */
@media (prefers-reduced-motion: reduce) {
  .scene-sigil {
    animation: none;
  }
}
</style>
