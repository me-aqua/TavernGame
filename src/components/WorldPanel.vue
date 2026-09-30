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
 *
 * 右栏还挂两件装饰（都只在 `side === 'right'` 那一侧）：**主控徽记**一行小条（滚动容器里的第一行，
 * 名字由卡声明的那条指路读出来）与**地标剪影**（根上的底纹，只在 `min-width: 1280px` 画）。
 * 两件都靠调用方喂进来的两个字符串，这里不自己读卡、也不猜身份 —— `leadName` 空或种子空就整件不画。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import CharacterSigil from './world/CharacterSigil.vue'
import SceneSigil from './world/SceneSigil.vue'
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
  /** 主控的名字：卡声明的「谁在哪」那条指路读出来的那个值（读不到就是空串） */
  leadName?: string
  /** 地标剪影的种子：册子里主控那一条的字面串（`scene.join(' · ')`，与侧栏同一份口径） */
  sceneSeed?: string
}>()

/** 剪影的种子：一个字的差别就该换一座地标，所以空种子与有种子是两件事 */
const seed = computed(() => props.sceneSeed ?? '')

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

/**
 * 剪影只在**两栏那一档**（`min-width: 1280px` = Tailwind `xl`，也是 `player-screen.css` 里两栏的断点）画。
 *
 * ⚠️ 这是一条**媒体查询**，只是住在 JS 里：`v-if` 要的是"元素根本不在 DOM 里"（理由见模板里那一段），
 *    而 CSS 做不到"从 DOM 里拿掉"。断点不新造：1280 与那条 `@media` 逐字同值。
 * ⚠️ jsdom 没有真布局、`matchMedia` 也不在：那时这一档恒为假 ⇒ 剪影不画 —— 这是对的，
 *    组件故事与窄屏一样，本来就画不出"宽到两栏"这件事。
 */
const wideScreen = ref(false)
const wideQuery = '(min-width: 1280px)'

/** 挂上一条媒体查询：先读当前答案（挂载那一刻窗口可能已经够宽），再跟着它变 */
function watchWideScreen(): void {
  if (typeof matchMedia !== 'function') return
  const list = matchMedia(wideQuery)
  wideScreen.value = list.matches
  list.addEventListener('change', (event) => {
    wideScreen.value = event.matches
  })
}

onMounted(watchWideScreen)

/**
 * 主控那一行要不要画 —— 判据是**这一栏自己的高**，不是视口高，也不是栏宽。
 *
 * 🔴 **为什么必须问运行时**（2026-09-30 第二轮评审打回 C2 的现场）：
 *    · **视口高**那一版（`@media (max-height: 200px)`）**任何承诺工位都命不中** ——
 *      这一栏在窄横那一档被 `--band-max` 压到几十像素，而**视口高一直是 320**（最短的承诺工位就是 480×320）。
 *    · **容器查询**那一版**压根没被编出来**：Tailwind 4.3.3 的 `@max` 变体两处硬编码**宽度**
 *      （比较的是 `width`），且 `--container-*` 那十三个值全是宽 ⇒ 那个按**高度**写的工具类
 *      在那个命名空间里解析不出来。构建产物实测：**`@max` 0 命中**（变体确实没编）。
 *      ⚠️ **别把那条工具类的名字照抄进散文里** —— Tailwind v4 的自动扫描**吃 `.vue` 注释与 `.md`**：
 *      写成工具类样子的那串会被当成**真类**编进产物（实测：我们注释里写过的两条工具类 ——
 *      一条按**高**、一条按**宽** —— **都**被编进了 CSS；行为无影响，但"产物里没有它"这句话会变成假的
 *      —— 它已经骗过一次复核）。
 *    ⇒ 只剩"量这个元素自己"这一条路：`ResizeObserver` 读**那一栏的内容高**（与挂载那句同一把尺，见下）。
 * ⚠️ jsdom 里没有 `ResizeObserver`（也没有布局）⇒ 这一档恒为假、**那一行不画**。
 *    ⚠️ 但**组件故事那一层不是这一档**：`npm run stories` 跑的是**真 Chromium**
 *    （`build-storybook` + `e2e/stories.spec.ts`），故事把这一栏钉在 560px 高 ⇒ **`ResizeObserver` 在那里是真跑的**。
 *    "画不出真栏高"说的是 **vitest 那一层（jsdom）**，别把两层说成一件事。
 */
const tallEnough = ref(false)
const LEAD_ROW_MIN = 200
const rowBox = ref<HTMLElement | null>(null)
let rowObserver: ResizeObserver | null = null

/**
 * 量那一栏自己的高：够高才画那一行。挂载时先读一次（`ResizeObserver` 只在变化时回调）。
 *
 * 🔴 **两处必须用同一把尺**：`clientHeight`（含 padding、不含边框）——**不要**在回调里改用
 *    `entry.contentRect.height`（那是**内容盒**）。两者差的就是上下 padding：**实测 24px**
 *    （这个滚动容器盒子高 **562**、上下 padding 各 **12**、**边框 0** ⇒ 内容盒 **538**；
 *    量具 `.team/dev/2026-09-30/wiring/probe-ruler.mjs`，读数 `r5-ruler.log`）。
 *    两把尺混用会在"栏高恰好落在那 **24px** 的带里"时**先画一帧再撤**（评审抓到的真 bug）。
 *    `box: 'border-box'` 那种写法也能对齐，但"读同一个属性"更直白、也更难写歪。
 */
function watchPanelHeight(): void {
  const box = rowBox.value
  if (box === null || typeof ResizeObserver !== 'function') return
  rowObserver = new ResizeObserver(() => {
    tallEnough.value = box.clientHeight >= LEAD_ROW_MIN
  })
  rowObserver.observe(box)
  tallEnough.value = box.clientHeight >= LEAD_ROW_MIN
}

onMounted(watchPanelHeight)
onUnmounted(() => rowObserver?.disconnect())
</script>

<template>
  <section
    :data-side="side"
    class="relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface/60"
  >
    <!-- 地标剪影：这一栏的底纹（贴在下沿）。`relative` 在根上，它才挂得住这一栏而不是外层那层壳。
         ⚠️ 收起走的是 `v-if`（**不是** CSS 的 `display:none`）：判据读的是 `querySelectorAll('.scene-sigil')`
            的**条数**，藏起来的元素在 DOM 里照样数得到（实测：CSS 收起时 count=1、盒子 0×0）。
            🔴 **这一档在两层判据里"各照到一半"**（别说成"组件故事照不到它"—— 那句是错的）：
            · **组件故事那一层照得到**：`npm run stories` 跑的是**真 Chromium**、视口 1280×800、
              右栏那一篇还声明了 `tags: ['sigil']` ⇒ 那条"屏上有剪影"的硬断**是真的在守着**（它是绿的）；
            · **它照不到的是"窄档不画"那一半**：故事只有 1280 那一档视口 ⇒ "900 宽上没有剪影"这条
              只有真浏览器判据（`e2e/wiring.spec.ts` 的 A6b）能断；
            · **vitest（jsdom）那一层两半都照不到**（没有布局、`matchMedia` 恒假）。 -->
    <span v-if="side === 'right' && leadName && seed && wideScreen" class="scene">
      <SceneSigil :seed="seed" />
    </span>

    <!-- 这个 div 就是"那一栏的内容区"：`watchPanelHeight` 量它的高（`ResizeObserver`），
         矮到放不下主控那一行时整条不画。 -->
    <div ref="rowBox" class="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
      <!-- 主控那一行小条：一枚 `sm` 徽记 + 名字。跟着状态滚，不浮。
           `tallEnough` 由 `ResizeObserver` 量**这个容器自己的高**得出（不是视口高、不是栏宽）。 -->
      <p v-if="side === 'right' && leadName && tallEnough" data-lead class="lead-row">
        <CharacterSigil :name="leadName" you size="sm" />
        <span class="lead-name">{{ leadName }}</span>
      </p>

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

<style scoped>
/* 两件装饰的落点（它们的样式随件走，这里只管"摆在哪、什么档不画"）。

   "哪一档画"那两条**都不在这里**：剪影按**栏宽**收（`wideScreen` 那个 `v-if`）·
   徽记那一行按**栏高**收（`watchPanelHeight` 那个 `ResizeObserver` + `tallEnough`）。
   ⚠️ 两条都必须是 `v-if`（不是 CSS 收起）：剪影那条因为判据读**条数**，徽记这条因为它量的是
   **运行时的栏高** —— 而**不能按视口高猜**：窄横那一档这一栏被 `--band-max` 压到几十像素，
   而**视口高一直是 320**（最短的承诺工位就是 480×320）⇒ 视口高永远命不中。 */

/* 那一栏矮到放不下这条水印时的**收口**（组长 2026-09-30 裁"加"；契约 §6.3 明说：机制有牙、
   但在今天这几个工位上一次都不参与 ⇒ **不当它有判据**）：`height: min(46vh, 26rem)` 在矮栏上会伸出父层、
   被根的 `overflow-hidden` **无声切掉** —— 这一条把它夹在栏高之内。
   ⚠️ 它声明的是 `.scene-sigil` 自己，而那个元素只有件那边的 scope 属性 ⇒ 必须 `:deep()`。 */
.scene :deep(.scene-sigil) {
  max-height: 100%;
}

/* 主控那一行小条的排法。"矮到放不下就整条不画"那一条不在这里，也不在 CSS 里 ——
   它住在 `watchPanelHeight`（`ResizeObserver` 量那一栏的内容高），理由见那边那段注释。 */
.lead-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}

.lead-name {
  min-width: 0;
  overflow: hidden;
  color: var(--color-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
