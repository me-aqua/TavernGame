<script setup lang="ts">
/**
 * 编辑器外壳：顶栏 + 四栏栅格 + 工作流细条 + 底部宽度标尺（票 67 · 段 8a 的骨架）。
 *
 * 四栏 = 内容 300 · 细条 120 · 编辑 自适应 · 公共提示词 290，栏间距 10px；底部那条标尺与
 * 栅格**共用同一份 `--cols`**，所以四段逐个对齐。中栏里只有一个长滚动体 `[data-mid]`，
 * 正在编的那一块从它的插槽进去。
 *
 * ⚠️ 中栏那一格的字幕是**当前在编什么**：编枝时是那一格路径（`branch`），编一步时是**那一步的名字**
 *    （`selected` 那一步的）。**两条轴都驱动中栏** —— `CardEditor` 保证至多一个非空（票 73 · 段 8c-①）。
 * ⚠️ 「编辑」列那个 ＋ 是**节点导向**的（加一个动作），编枝时收起来。
 *
 * ⚠️ 尺寸一律走 `src/styles/main.css` 的尺度层：整页探针会数外壳自己的文字用了几档字号，
 *    多一档就红（插进来的卡图 / 表单 / 资源库有各自的长相，不算）。
 * ⚠️ ≤820px 降级成「一栏 + 抽屉」：中栏独占整宽、左右两栏收成贴边的抽屉、细条收成顶栏下
 *    那条横带、标尺压成一行文字。**抽屉关着必须是 `display: none`** —— 靠 translateX 挪出屏
 *    会被 e2e/probe.ts 记成「伸出视口的元素」，整页检查当场全红。两颗面板开关住在横带里。
 * ⚠️ ≤599px **且**竖屏另有一条闸门：只留「身份 + ✕」与一句提示（见 `<style>` 末尾那条媒体查询）。
 * ⚠️ 三个「＋」的点按区 24x24，画出来还是 `--h-btn` 那个小方块（probe 拦小于 24px 的目标）。
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CardData } from '../game/card'

const { t } = useI18n()

const props = defineProps<{
  /** 要编辑的卡：细条列的就是它的拓扑，一个都不多一个都不少 */
  card: CardData
  /** 当前选中的节点 id；空串 = 还没选 */
  selected: string
  /** 中栏正在编的那一格（状态树里的点号路径）；空串 = 还没选 */
  branch: string
  /** 顶栏那一行身份（卡名 / 版本 / 来源），外层算好 */
  meta: string
  /** 右栏那块面板开着没有 —— 开合状态在外层，这里只画 */
  promptsOpen: boolean
  /** 有没保存的改动没有（顶栏那颗「保存」干净时按不动） */
  dirty: boolean
}>()

const emit = defineEmits<{
  close: []
  /** 顶栏那颗按钮：外层把右栏面板开合一下 */
  toggleResources: []
  /** 顶栏那颗「保存」：外层把草稿提交上去 */
  save: []
  select: [id: string]
  'add-branch': []
  'add-action': []
  'add-step': []
}>()

/** 细条里的步骤 = 卡里的拓扑，顺序原样（不自己编号，也不增删） */
const steps = computed(() => props.card.graph.topology)
/** 细条与横带里那一步的名字：那一轴选的还是**节点** */
const current = computed(() =>
  props.selected ? props.card.graph.nodes[props.selected].name : t('card.stepNone'),
)
/**
 * 中栏那一格的字幕 = 正在编的那一格：编枝时是那一格的路径，编一步时是**那一步的名字**；
 * 还没选就是那句「还没选」。
 *
 * ⚠️ 两条轴由 `CardEditor` 保证互斥 ⇒ 这里 `branch` 与 `selected` 至多一个非空，
 *    先判 `branch` 不会把一步的名字盖掉。
 */
const subtitle = computed(() => props.branch || current.value)
/** 底部标尺那四个数就是四栏宽度（第三段是弹性的，写不出具体数） */
const ruler = computed(() => ['300px', '120px', t('card.rulerFit'), '290px'])
/** 两颗抽屉开关：住在横带里（窄档从顶栏搬过去，把地方让给卡名），宽屏由 CSS 收起来 */
const toggles = computed(() => [
  { name: 'content', label: t('card.drawerContent') },
  { name: 'prompts', label: t('card.drawerPrompts') },
])
/** 横屏那条横带上的「换一步」开着没有 */
const picking = ref(false)
/** 横屏下开着的是哪一个抽屉（空串 = 两个都关着） */
const drawer = ref('')

/** 顶栏那颗开合按钮：同一个再点一下就收回去 */
function toggleDrawer(name: string) {
  drawer.value = drawer.value === name ? '' : name
}

/** 从横带上换一步：选中它就够了，顺手把菜单收掉 */
function pick(id: string) {
  picking.value = false
  emit('select', id)
}
</script>

<template>
  <div class="shell-wrap">
    <header data-top class="top">
      <div class="top-id">
        <h2 class="top-name">{{ t('card.graphTitle') }}</h2>
        <p class="top-meta">{{ meta }}</p>
      </div>
      <button
        type="button"
        data-card-resources-open
        class="top-btn"
        :aria-expanded="promptsOpen ? 'true' : 'false'"
        @click="emit('toggleResources')"
      >
        {{ t('card.resourcesTitle') }}
      </button>
      <!-- 保存：一次把说明 / 加字段 / 删字段一起提交；干净时按不动（改回原值也算干净） -->
      <button type="button" data-card-save class="top-btn" :disabled="!dirty" @click="emit('save')">
        {{ t('card.save') }}
      </button>
      <button
        type="button"
        data-card-close
        class="top-btn top-icon"
        :aria-label="t('card.close')"
        :title="t('card.close')"
        @click="emit('close')"
      >
        {{ t('card.closeIcon') }}
      </button>
    </header>

    <!-- 窄 且 竖那一屏：这套编辑器放不下，只留身份 + ✕ 与这一句（宽 ≥600 或横过来就回来） -->
    <section data-rotate>
      <h2 v-text="t('card.rotateTitle')" />
      <p v-text="t('card.rotateBody')" />
    </section>

    <!-- 横带：细条 120 的降级形态，只显示当前那一步 + 换一步（宽屏下不出现） -->
    <div class="band">
      <span class="band-k">{{ t('card.shellFlow') }}</span>
      <button type="button" @click="picking = !picking">{{ current }}</button>
      <template v-if="picking">
        <button v-for="id in steps" :key="id" type="button" @click="pick(id)">
          {{ card.graph.nodes[id].name }}
        </button>
      </template>
      <!-- 两颗面板开关：口径 A 从顶栏搬来这里（把宽度让给卡名），DOM 序排在步骤按钮之后 -->
      <button
        v-for="one in toggles"
        :key="one.name"
        type="button"
        class="top-btn"
        :data-drawer-toggle="one.name"
        :aria-expanded="drawer === one.name ? 'true' : 'false'"
        @click="toggleDrawer(one.name)"
      >
        {{ one.label }}
      </button>
    </div>

    <div data-shell>
      <section data-col="content" data-drawer="content" :class="{ 'is-open': drawer === 'content' }">
        <div class="col-head">
          <h2 class="col-name">{{ t('card.shellContent') }}</h2>
          <button
            type="button"
            data-add="branch"
            class="plus"
            :aria-label="t('card.addBranch')"
            @click="emit('add-branch')"
          >
            <span class="plus-sq">+</span>
          </button>
        </div>
        <div class="col-body"><slot name="content" /></div>
      </section>

      <section data-col="flow" data-flow>
        <div class="col-head">
          <h2 class="col-name">{{ t('card.shellFlow') }}</h2>
          <button
            type="button"
            data-add="step"
            class="plus"
            :aria-label="t('card.addStep')"
            @click="emit('add-step')"
          >
            <span class="plus-sq">+</span>
          </button>
        </div>
        <div class="strip">
          <button
            v-for="(id, index) in steps"
            :key="id"
            type="button"
            class="step"
            :data-step="id"
            :data-step-on="id === selected ? '' : null"
            @click="emit('select', id)"
          >
            <span class="step-n">{{ index + 1 }}</span>
            <span class="step-name">{{ card.graph.nodes[id].name }}</span>
          </button>
        </div>
      </section>

      <section data-col="edit">
        <div class="col-head">
          <h2 class="col-name">{{ t('card.shellEdit') }}</h2>
          <span class="col-sub" data-branch-title>{{ subtitle }}</span>
          <!-- 这一颗是**节点导向**的（加一个动作）：编枝时中栏编的是状态树，它就不该在 -->
          <button
            v-if="!branch"
            type="button"
            data-add="action"
            class="plus"
            :aria-label="t('card.addAction')"
            @click="emit('add-action')"
          >
            <span class="plus-sq">+</span>
          </button>
        </div>
        <div data-mid>
          <slot name="mid" />
        </div>
      </section>

      <section data-col="prompts" data-drawer="prompts" :class="{ 'is-open': drawer === 'prompts' }">
        <div class="col-head">
          <h2 class="col-name">{{ t('card.shellPrompts') }}</h2>
        </div>
        <div class="col-body">
          <slot name="prompts" />
          <p v-if="!promptsOpen" class="hint">{{ t('card.promptsClosed') }}</p>
        </div>
      </section>
    </div>

    <div data-ruler>
      <span v-for="(width, index) in ruler" :key="index" data-ruler-seg>{{ width }}</span>
    </div>
  </div>
</template>

<style scoped>
/* 四栏宽度只写这一处：上面的栅格与底下的标尺都吃它（口径 1/2 靠它俩对齐） */
.shell-wrap {
  --cols: 300px 120px minmax(0, 1fr) 290px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* ---------- 顶栏 ---------- */
.top {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
  height: 48px;
  padding: 0 var(--s2) 0 var(--s3);
  border-bottom: 1px solid var(--color-line);
}
/* 身份那一块先让位、再截断：96px 是地板 —— 挤穿了宁可顶栏溢出（有判据抓），也不许把卡名吞成 0 */
.top-id {
  min-width: 96px;
  margin-right: auto;
  overflow: hidden;
}
.top-name {
  margin: 0;
  font-size: var(--fs1);
  font-weight: 600;
  color: var(--color-text);
}
.top-meta {
  margin: 0;
  overflow: hidden;
  font-size: var(--fs3);
  color: var(--color-muted);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.top-btn,
.band button {
  flex: none;
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 var(--s2);
  border: 1px solid var(--color-line);
  border-radius: var(--r2);
  background: var(--color-surface);
  color: var(--color-muted);
  font-family: inherit;
  font-size: var(--fs2);
  cursor: pointer;
}
/* 收起那颗只有一个符号：方一点、不撑宽 */
.top-icon {
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
}
/* 干净时那颗「保存」按不动：灰掉，但**一直在位**（要看见"还没存"这件事） */
.top-btn:disabled {
  color: var(--color-faint);
  cursor: default;
}
/* 抽屉的开合按钮只有降级形态用得上 */
[data-drawer-toggle] {
  display: none;
}
/* 横带（≤820px 才出现）：细条 120 的降级形态 */
.band {
  display: none;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s1) var(--s2);
  padding: var(--s1) var(--s3);
  border-bottom: 1px solid var(--color-line);
}
.band-k {
  font-size: var(--fs3);
  color: var(--color-faint);
}
/* 竖屏那一屏的提示块：默认收起，只在文件末尾那条闸门（窄 且 竖）里现形 */
[data-rotate] {
  display: none;
  flex: 1;
  flex-direction: column;
  justify-content: center;
  padding: var(--s4) var(--s3);
  text-align: center;
}
[data-rotate] h2 {
  margin: 0 0 var(--s2);
  font-size: var(--fs1);
  color: var(--color-text);
}
[data-rotate] p {
  margin: 0;
  font-size: var(--fs2);
  color: var(--color-muted);
}
/* ---------- 四栏 ---------- */
[data-shell] {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: var(--cols);
  gap: var(--gut);
  padding: var(--gut);
}
[data-col] {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: var(--r3);
  background: var(--color-surface);
}
.col-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s2) var(--s1) var(--s3);
}
.col-name {
  margin: 0;
  font-size: var(--fs1);
  font-weight: 600;
  color: var(--color-text);
}
.col-sub {
  min-width: 0;
  overflow: hidden;
  font-size: var(--fs3);
  color: var(--color-faint);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.col-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--s2) var(--s2) var(--s3);
}
/* 中栏：单列、唯一那个长滚动体 */
[data-mid] {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--s5);
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--s3) var(--s2) var(--s3) var(--s3);
}
.hint {
  margin: 0;
  font-size: var(--fs2);
  color: var(--color-faint);
}
/* 三个「＋」：点按区 24x24，画出来是 18px 的小方块 */
.plus {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: auto;
  padding: 0;
  border: 0;
  background: none;
  cursor: pointer;
}
.plus-sq {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--h-btn);
  height: var(--h-btn);
  border: 1px solid var(--color-line);
  border-radius: var(--r1);
  background: var(--color-surface);
  color: var(--color-accent);
  font-size: var(--fs2);
  line-height: 1;
}
/* ---------- 工作流细条 ---------- */
.strip {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--s1) var(--s2);
}
.step {
  display: flex;
  align-items: center;
  gap: var(--s1);
  width: 100%;
  min-height: 24px;
  padding: 0 var(--s1);
  border: 0;
  border-radius: var(--r1);
  background: none;
  color: var(--color-muted);
  font-family: inherit;
  font-size: var(--fs2);
  text-align: left;
  cursor: pointer;
}
.step-n {
  flex: none;
  width: 11px;
  font-size: var(--fs3);
  color: var(--color-faint);
}
.step-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
/* 高亮 = 左竖条 + 加粗（不只靠颜色） */
.step[data-step-on] {
  color: var(--color-accent);
  font-weight: 600;
  box-shadow: inset 2px 0 0 var(--color-accent);
}
/* ---------- 底部标尺：与上面四栏同一套栅格 ---------- */
[data-ruler] {
  flex: none;
  display: grid;
  grid-template-columns: var(--cols);
  gap: var(--gut);
  padding: 0 var(--gut) var(--gut);
}
[data-ruler-seg] {
  text-align: center;
  font-size: var(--fs3);
  color: var(--color-faint);
}
/* ---------- ≤820px：一栏 + 抽屉 ---------- */
@media (max-width: 820px) {
  [data-shell] {
    position: relative;
    grid-template-columns: minmax(0, 1fr);
  }
  [data-col='flow'] {
    display: none;
  }
  .band {
    display: flex;
  }
  [data-drawer-toggle] {
    display: inline-flex;
  }
  /* 左右两栏改成贴边的抽屉：**关着就是 display:none**，不是挪出屏 */
  [data-col='content'],
  [data-col='prompts'] {
    display: none;
    position: absolute;
    top: 0;
    bottom: 0;
    border-radius: 0;
  }
  [data-col='content'] {
    left: 0;
    width: 300px;
  }
  [data-col='prompts'] {
    right: 0;
    width: 290px;
  }
  [data-col='content'].is-open,
  [data-col='prompts'].is-open {
    display: flex;
  }
  /* 标尺压成一行文字：单栏模式下四段栅格会与屏幕上的栏错位 */
  [data-ruler] {
    display: block;
    padding: var(--s2) var(--s3) var(--s3);
  }
  [data-ruler-seg] {
    display: inline-block;
    margin-right: var(--s3);
  }
}
/* ---------- ≤599px 且竖屏：不给编辑 —— 必须排在 ≤820 之后（同特异性下 `.is-open` 会漏出来） ---------- */
@media (max-width: 599px) and (orientation: portrait) {
  [data-card-resources-open],
  [data-card-save],
  [data-shell],
  .band,
  [data-ruler] {
    display: none;
  }
  [data-rotate] {
    display: flex;
  }
}
</style>
