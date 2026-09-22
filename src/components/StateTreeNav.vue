<script setup lang="ts">
/**
 * 左栏：卡声明的状态树的**枝树**（票 69 · 段 8b-①）。
 *
 * 只画不算 —— 行由 `CardEditor` 从卡里现算传进来（卡的知识只住一处）。这里管三件事：
 * 一行一个容器节点、缩进照层级、选中的那一行亮着。
 *
 * ⚠️ 行的文字**必须正好是卡里的点号路径**：组件层的判据逐行比它，真浏览器里也逐行比它的
 *    `textContent` ⇒ 层级只能用缩进表达，行里一个字都不许多（三角 / 类型 / 计数都不行）。
 * ⚠️ 每个点按区 ≥ 24×24（`e2e/probe.ts` 数 `button` 的矩形，矮一截就进 `smallTargets`）。
 * ⚠️ 每一行还报 `data-branch-depth`（＝路径的段数）：缩进本来就是按它算的 ——
 *    行的先后不承诺（裁决 4），"谁归谁"由它读得出来。
 * ⚠️ 字号只用 `--fs1/2/3` 三档（整页巡检会数 `[data-card-editor]` 里用了几档）。
 * ⚠️ 引擎接管那一行**不禁用**：看一眼是允许的，改不了是这一票的常态 —— 它的长相按项目里
 *    「只读 ＝ 左竖条 + 灰字」那一套（`data-branch-takeover` 是给判据与真浏览器读的）。
 */
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

defineProps<{
  /** 树的行：卡的声明顺序、逐层向下 */
  rows: Array<{ path: string; kind: string; taken: boolean }>
  /** 当前选中的那一格（点号路径）；空串 = 还没选 */
  picked: string
}>()

const emit = defineEmits<{ pick: [path: string] }>()

/** 缩进：路径几段就缩几级（`*` 也算一段 —— 它就是元素形状那一层） */
function indent(path: string): string {
  return 'calc(var(--s3) * ' + (path.split('.').length - 1) + ')'
}
</script>

<template>
  <nav data-branch-nav class="nav" :aria-label="t('card.treeLabel')">
    <button
      v-for="row in rows"
      :key="row.path"
      type="button"
      class="row"
      :style="{ paddingLeft: indent(row.path) }"
      :data-branch-node="row.path"
      :data-branch-type="row.kind"
      :data-branch-depth="row.path.split('.').length"
      :data-branch-on="row.path === picked ? '' : null"
      :data-branch-takeover="row.taken ? '' : null"
      @click="emit('pick', row.path)"
    >
      {{ row.path }}
    </button>
  </nav>
</template>

<style scoped>
.nav {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
/* 一行一格：点按区 24 高（整页巡检的下限），文字长了截断、不把栏撑宽 */
.row {
  display: block;
  width: 100%;
  min-height: 24px;
  padding-right: var(--s2);
  border: 0;
  border-radius: var(--r1);
  background: none;
  color: var(--color-muted);
  font-family: inherit;
  font-size: var(--fs2);
  line-height: 24px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
/* 引擎接管的那些格子：左竖条 + 灰字（项目里「只读」的长相） */
.row[data-branch-takeover] {
  color: var(--color-faint);
  box-shadow: inset 2px 0 0 var(--color-line);
}
/* 选中：左竖条 + 加粗 + 强调色（不只靠颜色） */
.row[data-branch-on] {
  color: var(--color-accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--color-accent);
}
</style>
