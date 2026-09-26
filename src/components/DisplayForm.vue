<script setup lang="ts">
/**
 * 中栏：**一条显示声明的四个键**（票 8d-①「编一块显示」那一形态的屏）。
 *
 * 上面是 `display.sidebar[]` 的列表（一行一条：第几条 + 它的 `path`），点一条 ⇒ 下面那屏编那一条；
 * 表尾一颗「＋」。**只加不减**：删一条会砸旧存档，那是另一张票的事（S0 裁决 2）。
 *
 * ⚠️ 只画不算：列表、选中号、草稿都由 `useDisplayDraft` 现算传进来（卡的知识只住一处），
 *    这一层只铺屏 + 把人的动作抛上去。
 * ⚠️ `format` / `side` **只能挑不能打**：两个 `<select>` 的选项就是 `src/game/display.ts`
 *    那两张词表（`<option>` 的文字用引擎词本身，与 `card.declRole` 那种"原样显示"同一条纪律）。
 * ⚠️ 字号只用 `--fs1/2/3` 三档（根上一句 `font-size`，控件 `font: inherit`）；
 *    点按区 ≥24×24（整页巡检数 `button` 的矩形）⇒ 行与 ＋ 都是 `min-height: 24px`。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { DISPLAY_FORMATS, DISPLAY_SIDES, type DisplayEntry } from '../game/display'
import type { DisplayKey } from './useDisplayDraft'

const { t } = useI18n()

const props = defineProps<{
  /** 卡里那几条声明（草稿优先）—— 顺序就是画出来的顺序 */
  entries: DisplayEntry[]
  /** 正在编的那一条的序号；null = 一条都没选（明细整块不在） */
  at: number | null
}>()

const emit = defineEmits<{
  /** 点列表里的一行 */
  pick: [index: number]
  /** 明细里某一格的值 */
  field: [index: number, key: DisplayKey, value: string]
  /** 表尾那颗「＋」 */
  add: []
}>()

/** 明细那一屏编的那一条（没选就是 null） */
const editing = computed(() => (props.at === null ? null : props.entries[props.at]))

/** 明细里某一格改了：序号取当前选中那一条 */
function write(key: DisplayKey, event: Event): void {
  if (props.at === null) return
  emit('field', props.at, key, (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div data-display-form class="form">
    <button
      v-for="(entry, index) in entries"
      :key="index"
      type="button"
      class="row"
      :data-display-block="index"
      :data-display-on="index === at ? '' : null"
      @click="emit('pick', index)"
    >
      {{ index + 1 }} {{ entry.path }}
    </button>

    <!-- 卡里一条都没声明：明说「没有这一块」，那颗 ＋ 照样在 -->
    <p v-if="entries.length === 0" data-display-none class="none" v-text="t('card.displayNone')" />

    <!-- 明细：选中那一条的四个键（路径 / 标题是打的，格式 / 放哪边只能挑） -->
    <div v-if="editing" data-display-entry :data-display-index="at" class="entry">
      <label class="cell">
        <span>path</span>
        <input class="ctl" data-display-field="path" :value="editing.path" @input="write('path', $event)" />
      </label>
      <label class="cell">
        <span>title</span>
        <input
          class="ctl"
          data-display-field="title"
          :value="editing.title"
          @input="write('title', $event)"
        />
      </label>
      <label class="cell">
        <span>format</span>
        <select
          class="ctl"
          data-display-field="format"
          :value="editing.format"
          @change="write('format', $event)"
        >
          <option v-for="one in DISPLAY_FORMATS" :key="one" :value="one" v-text="one" />
        </select>
      </label>
      <label class="cell">
        <span>side</span>
        <select class="ctl" data-display-field="side" :value="editing.side" @change="write('side', $event)">
          <option v-for="one in DISPLAY_SIDES" :key="one" :value="one" v-text="one" />
        </select>
      </label>
    </div>

    <button
      type="button"
      class="row add"
      data-display-add
      @click="emit('add')"
      v-text="t('card.displayAdd')"
    />
  </div>
</template>

<style scoped>
/* 这一屏自己就是一张表：根上一句字号，里面的控件一律继承（整页巡检只认三档） */
.form {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  font-size: var(--fs2);
}
/* 一条声明一行：整行可点（≥24 高 = 整页巡检的下限），文字长了截断、不把栏撑宽 */
.row {
  width: 100%;
  min-height: 24px;
  padding: 0 var(--s1);
  border: 1px solid var(--color-line);
  border-radius: var(--r1);
  color: var(--color-muted);
  font: inherit;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
/* 就在编的那一条：强调色的框与字（明细跟着它开，不只靠颜色） */
.row[data-display-on] {
  border-color: var(--color-accent-line);
  color: var(--color-accent);
}
/* 卡里一条都没声明时那句话（空态不是"坏了"） */
.none {
  margin: 0;
  color: var(--color-faint);
}
/* 明细：四个键各一格；窄了就折行，不横向溢出 */
.entry {
  display: flex;
  flex-wrap: wrap;
  gap: var(--s1) var(--s2);
  color: var(--color-faint);
}
.cell {
  display: flex;
  flex: 1 1 8rem;
  flex-direction: column;
  min-width: 0;
}
/* 三个可编的形状共用一个长相：白底 + 框，高度走控件那一档 */
.ctl {
  height: var(--h-ctl);
  min-width: 0;
  padding: 0 var(--s1);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
}
/* `<option>` 的文字也进整页那次字号普查 ⇒ 与 `<select>` 同一档 */
.ctl option {
  font-size: var(--fs2);
}
/* 表尾那颗 ＋：整行宽、虚线框 —— 与「加一个字段」同一个长相 */
.row.add {
  border-style: dashed;
  background: none;
  color: var(--color-accent);
}
</style>
