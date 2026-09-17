<script setup lang="ts">
/**
 * 块清单：把一条调试痕迹里的提示词按它**本来有的段**画出来。
 *
 * 段的边界与每一行的结构都由装配器交出（`agent/prompts.ts` 的 BlockGroup）——
 * 这里一行文本都不切：切错了不会报错，只会静默显示成另一副样子。
 *
 * 三条版面规矩都落在这个模板里：正文**逐字保留换行**（一行一个元素、空行也是），
 * 小标题有独立的样子（`### ` 那一行），长行自动折行不撑破版面（`.story-text`）。
 */
import { useI18n } from 'vue-i18n'
import { blockText, type BlockGroup } from '../agent/prompts'

const { t } = useI18n()

defineProps<{
  /** 一条消息一组（模型输入有好几条消息），组里按段折叠 */
  groups: BlockGroup[]
}>()
</script>

<template>
  <div data-blocks class="mt-2 flex flex-col gap-3">
    <section
      v-for="(group, index) in groups"
      :key="index"
      :data-message="index"
      :data-role="group.role"
      class="flex flex-col gap-1"
    >
      <p data-message-title class="border-l-2 border-accent-line pl-2 text-[11px] text-faint">
        {{ group.title }}
      </p>
      <!-- 折叠靠原生 details：点标题条就能开合，不写 JS；只有整行的第一块默认展开 -->
      <details
        v-for="(block, at) in group.blocks"
        :key="at"
        data-block
        :open="index === 0 && at === 0"
        class="rounded border border-line bg-surface px-2.5 py-1"
      >
        <summary data-block-title class="min-h-6 cursor-pointer py-1 text-[12px] text-muted">
          {{ block.title }}
          <span class="text-faint">{{ t('debug.blockSize', { count: blockText(block).length }) }}</span>
        </summary>
        <div
          data-block-body
          class="story-text mt-1 border-t border-line pt-1 text-[12px] leading-relaxed text-faint"
        >
          <!-- 一行一个元素：空行也要占一行（min-h-[1lh]），长行由 .story-text 折行 -->
          <p
            v-for="(line, n) in block.lines"
            :key="n"
            v-text="line.text"
            data-block-line
            :data-block-subhead="line.kind === 'subhead' ? '' : undefined"
            class="min-h-[1lh]"
            :class="line.kind === 'subhead' ? 'mt-1 font-medium text-text' : ''"
          ></p>
        </div>
      </details>
    </section>
  </div>
</template>
