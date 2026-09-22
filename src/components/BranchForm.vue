<script setup lang="ts">
/**
 * 中栏：选中那一格的**可写字段表**（票 70 · 段 8b-②；上一票是只读的）。
 *
 * 一行一个字段：卡里的键名 · 界面词的类型 · 说明（本票开始可编）· 开局在不在（`initial`）·
 * 行尾一颗垃圾桶；表尾一行是「＋ 加一个字段」。
 *
 * ⚠️ 只画不算：行、草稿、待删都由 `CardEditor` 现算传进来（卡的知识只住一处），
 *    这一层只铺屏 + 把人的动作抛上去。
 * ⚠️「只读」在本票**只剩一种意思**：引擎接管（`data-field-readonly` ⇔ `data-field-takeover`）。
 *    接管行**整行不可写** —— 没有输入控件、行尾不画垃圾桶（那个位置写「引擎接管」），
 *    说明那一格是 `[data-field-note-locked]`，而且**不带**空标记：占位符的意思是「你可以填」。
 * ⚠️「说明」**每一行**都交出一格（裁决 3）：有没有内容由卡决定，不由界面的规则决定 ——
 *    「带 note 的行才可编」是当前卡的状态，不是表的口径。
 * ⚠️ 表尾那颗 ＋ 用 `data-field-add`，**绝不能叫 `data-add`**：`data-add` 是 8a 的保留集合
 *    （整页巡检按它数编枝态那两个 ＋），改名会把那两条判据一起打红。
 * ⚠️ 字号只用 `--fs1/2/3` 三档（整页巡检数 `[data-card-editor]` 里出现过几档，
 *    `<option>` 的文字也进那次普查）；点按区 ≥24×24（`e2e/probe.ts` 数 button 的矩形）。
 * ⚠️ 列不写死宽度：窄档（1004–1279）下五列会折行，那是本票在那一档的正式形态。
 */
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  /** 这一格在卡里的点号路径（表里每一行都属于它） */
  path: string
  /**
   * 这一格的字段：卡的声明顺序。
   *
   * `note` 是**当前显示**的说明（草稿优先，没改过就是卡里的）—— 「空框 + 空标记」那一态
   * 由它是不是空串决定。
   */
  rows: Array<{ key: string; kind: string; hasInitial: boolean; taken: boolean; note: string }>
  /** 待删的行（保存时才真删） */
  gone: string[]
  /** 上一次保存被拒 ⇒ 这次改动**牵动过**的每一行 */
  badKeys: string[]
  /** 上一次保存被拒（新行不带键名，所以它单独一个标记） */
  failed: boolean
  /** 刚开出来、还没保存的那一行；null = 没开 */
  fresh: { key: string; kind: string; note: string; initial: string } | null
}>()

const emit = defineEmits<{
  /** 老行说明格的草稿 */
  note: [key: string, text: string]
  /** 行尾那颗垃圾桶：老行是「待删 ⇄ 撤销」 */
  del: [key: string]
  /** 表尾那颗「＋ 加一个字段」 */
  add: []
  /** 新行自己的垃圾桶：那一行还没落过盘 ⇒ 是「取消」，不进待删 */
  cancel: []
  /** 新行四格的草稿 */
  fresh: [cell: 'key' | 'kind' | 'note' | 'initial', text: string]
}>()

/** 新行的键名格 —— 开出来就拿到焦点（键盘上直接开打，不用再点一次） */
const keyBox = ref<HTMLInputElement | null>(null)

watch(
  () => props.fresh !== null,
  (open) => {
    if (!open) return
    void nextTick(() => keyBox.value?.focus())
  },
)

/** 输入控件里的字 */
function textOf(event: Event): string {
  return (event.target as HTMLInputElement).value
}
</script>

<template>
  <div data-branch-form class="form">
    <div class="head">
      <span class="cell key">{{ t('card.fieldKey') }}</span>
      <span class="cell kind">{{ t('card.fieldKind') }}</span>
      <span class="cell note">{{ t('card.fieldNote') }}</span>
      <span class="cell initial">{{ t('card.fieldInitial') }}</span>
      <span class="cell tail" />
    </div>

    <div
      v-for="row in rows"
      :key="row.key"
      class="row"
      data-field-row
      :data-field-key="row.key"
      :data-field-parent="path"
      :class="{ 'is-gone': gone.includes(row.key) }"
      :data-field-readonly="row.taken ? '' : null"
      :data-field-takeover="row.taken ? '' : null"
      :data-field-initial="row.hasInitial ? 'yes' : 'no'"
      :data-row-pending-del="gone.includes(row.key) ? '' : null"
      :data-row-bad="badKeys.includes(row.key) ? '' : null"
    >
      <span class="cell key" data-field-name>{{ row.key }}</span>
      <span class="cell kind">{{ t('card.kind.' + row.kind) }}</span>
      <!-- 说明：可编的那一态是一个框；接管行是灰字无框的原文（不给「你可以填」的暗示） -->
      <input
        v-if="!row.taken"
        class="cell note"
        data-field-note
        type="text"
        :value="row.note"
        :title="row.note"
        :placeholder="t('card.fieldNoteEmpty')"
        :data-field-note-empty="row.note === '' ? '' : null"
        @input="emit('note', row.key, textOf($event))"
      />
      <span
        v-else
        class="cell note locked"
        data-field-note-locked
        :title="t('card.fieldLockedWhy')"
        v-text="row.note"
      />
      <span class="cell initial">{{ row.hasInitial ? t('card.initialYes') : t('card.initialNo') }}</span>
      <!-- 接管行那个位置写「为什么这儿没有控件」：不画灰垃圾桶、也不画禁用输入框 -->
      <span v-if="row.taken" class="cell tail">{{ t('card.fieldLocked') }}</span>
      <button
        v-else
        type="button"
        class="trash"
        data-field-del
        :title="gone.includes(row.key) ? t('card.fieldUndo') : t('card.fieldDel')"
        :aria-label="gone.includes(row.key) ? t('card.fieldUndo') : t('card.fieldDel')"
        @click="emit('del', row.key)"
      >
        {{ t('card.fieldDelIcon') }}
      </button>
    </div>

    <!-- 刚开出来、还没落过盘的那一行：它只活在界面上，保存那一刻才进卡 -->
    <div
      v-if="fresh"
      class="row"
      data-field-row
      data-row-new
      :data-field-parent="path"
      :data-field-initial="fresh.initial.trim() === '' ? 'no' : 'yes'"
      :data-row-bad="failed ? '' : null"
    >
      <input
        ref="keyBox"
        class="cell key"
        data-field-key-new
        type="text"
        :value="fresh.key"
        @input="emit('fresh', 'key', textOf($event))"
      />
      <select
        class="cell kind"
        data-field-kind-new
        :value="fresh.kind"
        @change="emit('fresh', 'kind', textOf($event))"
      >
        <option value="string">{{ t('card.kind.string') }}</option>
        <option value="integer">{{ t('card.kind.integer') }}</option>
      </select>
      <input
        class="cell note"
        data-field-note
        type="text"
        :value="fresh.note"
        :placeholder="t('card.fieldNoteEmpty')"
        :data-field-note-empty="fresh.note === '' ? '' : null"
        @input="emit('fresh', 'note', textOf($event))"
      />
      <input
        class="cell initial-new"
        data-field-initial-new
        type="text"
        :value="fresh.initial"
        @input="emit('fresh', 'initial', textOf($event))"
      />
      <button
        type="button"
        class="trash"
        data-field-del
        :title="t('card.fieldCancel')"
        :aria-label="t('card.fieldCancel')"
        @click="emit('cancel')"
      >
        {{ t('card.fieldDelIcon') }}
      </button>
    </div>

    <button type="button" class="add" data-field-add @click="emit('add')">
      {{ t('card.fieldAdd') }}
    </button>
  </div>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: var(--s1);
  min-width: 0;
}
.head,
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s1) var(--s2);
  min-width: 0;
  min-height: var(--h-ctl);
}
.head {
  color: var(--color-faint);
  font-size: var(--fs3);
}
.row {
  border-radius: var(--r1);
  color: var(--color-text);
  font-size: var(--fs2);
}
/* 键名与说明两列分剩下的宽：窄了就折行，不横向溢出（中栏是 overflow-x: hidden） */
.cell.key,
.cell.note {
  flex: 1 1 8rem;
  min-width: 0;
}
.cell.kind,
.cell.initial,
.cell.initial-new,
.cell.tail {
  flex: 0 0 auto;
}
span.cell.key {
  overflow: hidden;
  font-size: var(--fs1);
  white-space: nowrap;
  text-overflow: ellipsis;
}
span.cell.kind,
span.cell.initial,
span.cell.tail {
  color: var(--color-faint);
  font-size: var(--fs3);
}
/* 可编的格子：白底 + 框（只读/可写不靠颜色，靠有没有框） */
input.cell,
select.cell {
  height: var(--h-ctl);
  padding: 0 var(--s1);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--fs2);
}
input.cell:focus,
select.cell:focus {
  border-color: var(--color-accent-line);
}
/* `<option>` 的文字也进整页那次字号普查 ⇒ 与 `<select>` 同一档 */
select.cell option {
  font-size: var(--fs2);
}
.cell.note.locked {
  overflow: hidden;
  color: var(--color-faint);
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 行尾那颗垃圾桶：点按区 24×24（整页巡检的下限），画出来只有一个字 */
.trash {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--r1);
  background: none;
  color: var(--color-faint);
  font-family: inherit;
  font-size: var(--fs2);
  line-height: 1;
  cursor: pointer;
}
.trash:hover {
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
/* 表尾那颗 ＋：整行宽、≥24 高 */
.add {
  width: 100%;
  min-height: 24px;
  padding: 0 var(--s1);
  border: 1px dashed var(--color-line);
  border-radius: var(--r1);
  background: none;
  color: var(--color-accent);
  font-family: inherit;
  font-size: var(--fs2);
  cursor: pointer;
}
.add:hover {
  border-color: var(--color-accent-line);
  background: var(--color-accent-soft);
}
/* 待删：字划掉 + 灰（还没落盘，撤销就在原处那颗按钮上） */
.row.is-gone {
  color: var(--color-faint);
  text-decoration: line-through;
}
/* 引擎接管：整行按项目里「只读」的长相（左竖条 + 灰字），标记本身也在行上 */
.row[data-field-takeover] {
  color: var(--color-faint);
  box-shadow: inset 2px 0 0 var(--color-line);
}
/* 保存被拒时指到的那一行：左竖条换成危险色（不只靠颜色，行是名单里点出来的） */
.row[data-row-bad] {
  box-shadow: inset 2px 0 0 var(--color-danger);
}
</style>
