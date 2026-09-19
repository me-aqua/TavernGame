<script setup lang="ts">
/**
 * 主角角色牌：状态树里的 lead —— 这一局「你」是谁。
 *
 * 它是角色扮演的第一屏：名字是标题，下面按作者写下的顺序摊开「当下 / 固有 / 关系 / 携带」。
 * 界面只按 JSON 的形状画（标量 = 一行、对象 = 键值、列表 = 条目），不认识任何具体字段 ——
 * 换一张卡照样画得出来。唯一的界面约定是条目里的 name / count / note（与 state-view 同一套）。
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { isRecord } from '../../game/save'
import { ITEM_NAME, ITEM_NOTE, itemOf, linesOf, noteOf, scalarText } from '../state-view'

const { t } = useI18n()

const props = defineProps<{
  /** lead：主控的那一段状态 */
  lead: unknown
  /** 别的块已经专门展示的字段（例如 pack），角色牌里不再重复 */
  hidden?: string[]
}>()

interface SheetRow {
  key: string
  text: string
}

interface SheetItem {
  title: string
  count: string
  note: string
  detail: string
}

interface SheetSection {
  key: string
  kind: 'scalar' | 'lines' | 'list'
  text: string
  rows: SheetRow[]
  items: SheetItem[]
}

/** 作者把主控写成了对象才画；不是对象（卡没声明 / 结构不对）就整块消失 */
const person = computed<Record<string, unknown> | null>(() =>
  isRecord(props.lead) ? (props.lead as Record<string, unknown>) : null,
)

const name = computed(() => (person.value ? scalarText(person.value[ITEM_NAME]) : ''))
/** 主角的印记永远是「你」，不拿名字首字 —— 「无名者」会变成「无」，像在说没有这个人 */
const sealText = computed(() => t('world.youSeal'))

/**
 * 列表条目。没有 name 的条目（关系那种 who / kind / story）拿第一行标量当标题，
 * 其余行拼成一句 —— 这样界面上不会出现一排裸键名，关系读起来还是一句话。
 */
function listItems(value: unknown): SheetItem[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const view = itemOf(item)
    const note = noteOf(item)
    if (view.title) {
      return {
        title: view.title,
        count: view.count,
        note,
        detail: view.lines
          .filter((line) => line.key !== ITEM_NOTE)
          .map((line) => line.text)
          .join(t('sidebar.separator')),
      }
    }
    const lines = linesOf(item)
    const [first, ...rest] = lines
    return {
      title: first?.text ?? '',
      count: view.count,
      note: '',
      detail: rest.map((line) => line.text).join(t('sidebar.separator')),
    }
  })
}

/** 主控这一段的摊平结果：按卡里字段的先后顺序，不排序；别的块展示的字段跳过 */
const sections = computed<SheetSection[]>(() => {
  if (!person.value) return []
  const hidden = new Set(props.hidden ?? [])
  return Object.entries(person.value)
    .filter(([key]) => key !== ITEM_NAME && !hidden.has(key))
    .map(([key, value]): SheetSection => {
      const text = scalarText(value)
      if (text !== '') return { key, kind: 'scalar', text, rows: [], items: [] }
      if (Array.isArray(value)) return { key, kind: 'list', text: '', rows: [], items: listItems(value) }
      return { key, kind: 'lines', text: '', rows: linesOf(value), items: [] }
    })
    .filter((section) =>
      section.kind === 'scalar'
        ? section.text !== ''
        : section.kind === 'list'
          ? section.items.length > 0
          : section.rows.length > 0,
    )
})
</script>

<template>
  <article v-if="person" data-self class="space-y-3">
    <header class="flex items-center gap-3">
      <span class="seal" aria-hidden="true">{{ sealText }}</span>
      <div class="min-w-0">
        <p class="text-[10px] tracking-[0.2em] text-faint uppercase">
          {{ t('world.selfKicker') }}
        </p>
        <p v-if="name" data-self-name class="truncate font-serif text-[17px] font-semibold text-text">
          {{ name }}
        </p>
      </div>
    </header>

    <div v-if="sections.length" class="space-y-2.5">
      <section v-for="section in sections" :key="section.key" :data-self-field="section.key">
        <p class="text-[10px] tracking-[0.14em] text-faint uppercase">{{ section.key }}</p>

        <p v-if="section.kind === 'scalar'" class="mt-0.5 text-[12.5px] leading-relaxed text-muted">
          {{ section.text }}
        </p>

        <dl v-else-if="section.kind === 'lines'" class="mt-1 space-y-0.5">
          <div v-for="row in section.rows" :key="row.key" class="flex gap-2">
            <dt class="w-[5.5rem] shrink-0 truncate text-[10px] leading-snug tracking-wide text-faint">
              {{ row.key }}
            </dt>
            <dd class="text-[12px] leading-snug text-muted">{{ row.text }}</dd>
          </div>
        </dl>

        <ul v-else class="mt-1 space-y-1.5">
          <li
            v-for="(item, index) in section.items"
            :key="item.title + index"
            class="border-l border-line/70 pl-2"
            data-self-item
          >
            <p class="text-[12.5px] leading-snug text-text">
              {{ item.title }}
              <span v-if="item.count" class="ml-1 text-[11px] text-accent tabular-nums">
                {{ t('world.itemCount', { count: item.count }) }}
              </span>
            </p>
            <p v-if="item.note" class="text-[11.5px] leading-snug text-muted">{{ item.note }}</p>
            <p v-if="item.detail" class="mt-0.5 text-[11.5px] leading-snug text-muted">
              {{ item.detail }}
            </p>
          </li>
        </ul>
      </section>
    </div>
  </article>
</template>
