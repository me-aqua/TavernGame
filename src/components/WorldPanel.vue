<script setup lang="ts">
/**
 * 世界那一栏：卡说这一侧有哪几块、什么顺序，这里就照那个顺序摆出来（决定 #15 / R12 / R59）。
 *
 * 它是玩家屏的**一栏**（左栏还是右栏由外层按卡的声明定）：一栏自己滚，块再多也挤不走正文。
 * 一栏 0 块照样在屏上，里面写一句「这一栏今天没有块」—— 那一侧没有块是卡的事实，不藏起来。
 *
 * **一块画成什么形状由声明里的格式定**（键值 / 列表 / 分组列表，三种预设，见 `game/display.ts`）：
 * 界面不认识任何块名，也不认识任何字段名（字段名由作者起，见 `state-view.ts` 的文件头），
 * 摊平一律走那一份按形状取数的取数器，不在这里另写一套。
 * 「当前所在」按**值相等**标出来：一个元素里含得上主控那条位置的值，就给它 `data-current`。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { WorldBlock } from './display-blocks'
import type { StateTree } from '../game/card-state'
import type { DisplayFormat, DisplaySide } from '../game/display'
import { entriesOf, isScalar, scalarText, textsOf, type StateEntry } from './state-view'

const { t } = useI18n()

const props = defineProps<{
  /** 这一栏是哪一侧（左栏 / 右栏）—— 它同时是根上的 `data-side` */
  side: DisplaySide
  /** 这一侧的那几块（顺序即声明顺序） */
  blocks: WorldBlock[]
  /** 这一局的状态树 —— 每块从它里面取自己那一段 */
  state: StateTree
}>()

/** 判「是不是就在这儿」：拿一个元素里的文字去比主控那几个位置（值相等是唯一的判据） */
type Mark = (text: string) => boolean

/** 一栏一行：键 + 值（值可能是空串 —— 空集合也占一栏，栏数不能少） */
interface PanelRow {
  key: string
  text: string
  current: boolean
}

/** 一串值里的一格 —— 每个值自己一个元素（`[data-value]` 落在它身上） */
interface PanelValue {
  text: string
  current: boolean
}

/** 一串值的那一栏：字段名 + 它底下每一个值 */
interface PanelList {
  key: string
  values: PanelValue[]
}

/** 一个条目 —— 分组列表的一组，或列表格式的一项 */
interface PanelEntry {
  key: string
  current: boolean
  rows: PanelRow[]
  lists: PanelList[]
}

/** 面板上的一块 —— 值已经从状态树取好、标记已经算好，模板只管摆 */
interface PanelBlock {
  name: string
  title: string
  format: DisplayFormat
  fields: PanelRow[]
  entries: PanelEntry[]
}

/** 一行一栏：标量照原样写，一串标量连成一行，其余（嵌套对象）留空 —— 面板是给人扫一眼的 */
function rowOf(here: Mark, { key, value }: StateEntry): PanelRow {
  const text = scalarText(value) || textsOf(value).join(' / ')
  return { key, text, current: here(key + text) }
}

/** 一串值：标量本身就是一格；对象条目取它自己的几行文字（值仍逐个在，只是不带栏目名） */
function valuesOf(here: Mark, list: unknown): PanelValue[] {
  const items = Array.isArray(list) ? list : []
  return items.flatMap((item) => {
    const texts = isScalar(item)
      ? [scalarText(item)]
      : entriesOf(item).map(({ key, value }) => rowOf(here, { key, value }).text)
    return texts.map((text) => ({ text, current: here(text) }))
  })
}

/** 一段状态摊成「一行一栏的那几栏」加「一串值的那几栏」—— 数组归后者（每个值要自己一个元素） */
function fieldsOf(here: Mark, value: unknown): { rows: PanelRow[]; lists: PanelList[] } {
  const rows: PanelRow[] = []
  const lists: PanelList[] = []
  for (const entry of entriesOf(value)) {
    if (Array.isArray(entry.value)) lists.push({ key: entry.key, values: valuesOf(here, entry.value) })
    else rows.push(rowOf(here, entry))
  }
  return { rows, lists }
}

/** 一个条目：名字 + 几栏 + 几串值。它的文字与模板画出来的那些东西同一份，标记按它算 */
function entryOf(here: Mark, key: string, value: unknown): PanelEntry {
  const { rows, lists } = fieldsOf(here, value)
  const text = [
    key,
    ...rows.map((row) => row.key + row.text),
    ...lists.flatMap((list) => [list.key, ...list.values.map((item) => item.text)]),
  ].join('')
  return { key, current: here(text), rows, lists }
}

/** 一块要画的东西：格式定形状，值从这一局的状态树现取 */
function blockOf(block: WorldBlock): PanelBlock {
  const current = block.current(props.state)
  const here: Mark = (text) => current.some((value) => text.includes(value))
  const value = block.value(props.state)
  if (block.format === 'key-value') {
    // 键值格式：这一枝的**每一栏**各一行 —— 数与形状都对得上「一栏一行」
    return {
      name: block.name,
      title: block.title,
      format: block.format,
      fields: entriesOf(value).map((entry) => rowOf(here, entry)),
      entries: [],
    }
  }
  // 列表格式的一项与分组列表的一组是同一件事：名字 + 它的那几栏（列表项的"名字"就是它自己那一行）
  const entries =
    block.format === 'list'
      ? (Array.isArray(value) ? value : []).map((item) => entryOf(here, scalarText(item), item))
      : entriesOf(value).map((entry) => entryOf(here, entry.key, entry.value))
  return { name: block.name, title: block.title, format: block.format, fields: [], entries }
}

/** 面板上的每一块 —— 状态树一动，这里跟着重算（画的永远是这一局的真相） */
const panel = computed(() => props.blocks.map(blockOf))
</script>

<template>
  <section
    :data-side="side"
    class="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface/60"
  >
    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
      <!-- 一栏 0 块：说一句它今天没有块（那一侧没有块是卡的事实，不许悄悄什么都不画） -->
      <p v-if="panel.length === 0" data-side-empty class="text-[11px] leading-snug text-faint">
        {{ t('play.emptySide') }}
      </p>

      <section v-for="block in panel" :key="block.name" :data-block="block.name">
        <h3 class="mb-1.5 text-[11px] font-semibold text-faint">{{ block.title }}</h3>

        <!-- 键值：这一枝的每一栏各一行 -->
        <template v-if="block.format === 'key-value'">
          <p
            v-for="row in block.fields"
            :key="row.key"
            data-field
            :data-current="row.current ? '' : undefined"
            class="text-[11px] leading-snug"
            :class="row.current ? 'text-accent' : 'text-muted'"
          >
            <span class="text-faint">{{ row.key }}</span>
            {{ row.text }}
          </p>
        </template>

        <!-- 列表 / 分组列表：一项（一组）一小块，块里一栏一行、一串值逐个画 -->
        <ul v-else class="space-y-1.5">
          <li
            v-for="(entry, index) in block.entries"
            :key="index"
            data-entry
            :data-current="entry.current ? '' : undefined"
            class="rounded-xl border px-2.5 py-1.5"
            :class="
              entry.current ? 'border-accent-line/70 bg-accent-soft/50' : 'border-line/60 bg-surface-2/40'
            "
          >
            <p
              v-if="entry.key"
              class="text-[12px] font-semibold"
              :class="entry.current ? 'text-accent' : 'text-muted'"
            >
              {{ entry.key }}
            </p>
            <p
              v-for="row in entry.rows"
              :key="row.key"
              data-field
              :data-current="row.current ? '' : undefined"
              class="mt-0.5 text-[11px] leading-snug text-muted"
            >
              <span class="text-faint">{{ row.key }}</span>
              {{ row.text }}
            </p>
            <div v-for="list in entry.lists" :key="list.key" class="mt-1 flex flex-wrap items-baseline gap-1">
              <span class="text-[11px] text-faint">{{ list.key }}</span>
              <span
                v-for="(item, at) in list.values"
                :key="at"
                data-value
                :data-current="item.current ? '' : undefined"
                class="rounded-full px-2 py-0.5 text-[11px] leading-tight"
                :class="item.current ? 'bg-accent text-page' : 'bg-surface-2 text-muted'"
              >
                {{ item.text }}
              </span>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </section>
</template>
