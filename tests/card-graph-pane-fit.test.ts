// @vitest-environment jsdom
/**
 * 票 72 · S1：卡图的视口必须跟着**画布尺寸**收敛（判据 F1–F3 + 量具自检 S1/S2）。
 *
 * 被测行为：`CardGraph.vue:107-113` 的 `fitInBox` —— 拟合（`fitView`）之后把位移夹回容器
 * （`x ∈ [0, 宽 x (1 - 缩放)]`），而**拟合本身**按当时的容器宽度算缩放。它在 `:194` 的
 * `onPaneReady` 上跑**一次**；尺寸在那之后变了，视口不会重算 ⇒ 画布伸出容器
 * （整页巡检的 `offenders`，确定性复现见 `.tools/leader72-repro.log`）。
 *
 * 这一层断的是**接线**：`vue-flow` 的 store 是替身（`fakeFlow`，见下）。真件那一层是
 * `.tools/marta72-pane-fit.mjs`（真浏览器 + 真 `expectClean`），归有权限的人跑 ——
 * 两条腿缺一条都会留下"这条路径没人扫"的窟窿。
 *
 * ⚠️ 替身不是"随手给一个数"：它的 `fitView` 照 vue-flow 的语义写（缩到装得下、居中、不放大）。
 *    1280 那一格算出来的视口（x=0 / zoom=1）与组长在真浏览器里量到的节点 `[957..1167]` 对得上
 *    （推导见契约 §二）。
 * ⚠️ 判据比 `offenders` **更严**：`offenders` 比的是**窗口**边界（`e2e/probe.ts:18`），
 *    这里比的是**容器**边界 —— 这里绿了，那些元素在真浏览器里就不会伸出窗口。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, watch, type Ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import CardGraph from '../src/components/CardGraph.vue'
import { parseCard } from '../src/game/card'
import { EXAMPLE_CARD } from './support/card-fixtures'

/* eslint-disable vue/one-component-per-file -- 这一件里有三个测试替身（卡图那一层与两个参考件），都不是产品组件 */

/** 视口（与 vue-flow 的 `viewport` 同一个形状：位移 + 缩放） */
interface Viewport {
  x: number
  y: number
  zoom: number
}

/** 容器盒子的尺寸（与 vue-flow 的 `dimensions` 同一个形状） */
interface Box {
  width: number
  height: number
}

/** 替身 store 的当前实例 —— `vi.mock` 的工厂会被提到文件最前面，所以它只能挂在 `vi.hoisted` 上 */
const holder = vi.hoisted(() => ({ current: null as unknown }))

/**
 * 只换 `useVueFlow` 这一个导出：其余（`VueFlow` / `Handle` / `Position` …）都留真的，
 * 组件与模板一个字节不用改。
 */
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vue-flow/core')>()
  return { ...actual, useVueFlow: () => holder.current }
})

/**
 * 卡图的内容尺寸（流坐标）—— 从组长在真浏览器里的读数反推：1280 那一格 `.card-graph` 是
 * 1256 宽、视口落在 x=0 / zoom=1，最右那个节点量到 `[957..1167]`（`.tools/leader72-repro.log`）。
 */
const CONTENT = { width: 1167, height: 300 }

/** 真浏览器里量到的两个容器尺寸：1280 那一格（宽 1256）与缩到 900 之后那一格（宽 876） */
const WIDE: Box = { width: 1256, height: 420 }
const NARROW: Box = { width: 876, height: 320 }

/** 替身 store：真件让组件看的那几个口子，外加量具自己的记录 */
interface FakeFlow {
  viewport: Ref<Viewport>
  dimensions: Ref<Box>
  fitView: (params?: unknown) => Promise<void>
  setViewport: (next: Viewport) => Promise<void>
  onPaneReady: (callback: () => void) => void
  /** 每一次拟合用的那个盒子（真件里是 `fitView` 自己读的） */
  fits: Box[]
  /** 每一次写视口（真件里 `setViewport` 是 Promise） */
  writes: Viewport[]
  /** 注册上来的 pane-ready 回调（测试自己触发，不靠真 vue-flow 就绪） */
  ready: Array<() => void>
}

/** 造一个替身：`dimensions` 与 `viewport` 从 vue-flow 的初值起步 */
function fakeFlow(box: Box): FakeFlow {
  const dimensions = ref<Box>({ ...box })
  const viewport = ref<Viewport>({ x: 0, y: 0, zoom: 1 })
  const fits: Box[] = []
  const writes: Viewport[] = []
  const ready: Array<() => void> = []
  return {
    dimensions,
    viewport,
    fits,
    writes,
    ready,
    // 拟合 = 缩到装得下、居中、不放大（vue-flow 的 `fitView` 语义；留白参数不参与这一层）
    fitView: async () => {
      const { width, height } = dimensions.value
      fits.push({ ...dimensions.value })
      const zoom = Math.min(1, width / CONTENT.width, height / CONTENT.height)
      viewport.value = {
        x: (width - CONTENT.width * zoom) / 2,
        y: (height - CONTENT.height * zoom) / 2,
        zoom,
      }
    },
    // 写视口：真件里它也是 Promise（组件那边 `await setViewport(...)`）
    setViewport: async (next: Viewport) => {
      writes.push({ ...next })
      viewport.value = { ...next }
    },
    onPaneReady: (callback: () => void) => void ready.push(callback),
  }
}

/**
 * 把一条**已经发生**的事件链排空：尺寸变了 ⇒ `watch` 回调 ⇒ `await fitView(...)` ⇒ 夹取 ⇒
 * `await setViewport(...)`。
 *
 * ⚠️ 这不是"等一会儿再看"（S0 §四.5 禁的是那种赌）：尺寸是测试自己改的，事件必然发生，
 *    这里只是把那几跳微任务走完。
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await nextTick()
    await flushPromises()
  }
}

/** 替身画的那一层：卡图不渲染真的 vue-flow（jsdom 没有布局，这里也不需要） */
const FlowStub = defineComponent({
  name: 'VueFlow',
  setup: () => () => h('div', { class: 'flow-stub' }),
})

/** 示例卡（与别的组件测试同一份夹具：卡是唯一事实来源，测试里不抄内容） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))

/** 造一屏：一个新的替身 store，外加挂在它上面的卡图 */
function scene(box: Box) {
  const fake = fakeFlow(box)
  holder.current = fake
  const graph = mount(CardGraph, { props: { card }, global: { stubs: { VueFlow: FlowStub } } })
  return { fake, graph }
}

/** 造一屏参考件（量具自检用）：同一个替身 store，挂的是手写的那个组件 */
function referenceScene(component: unknown, box: Box) {
  const fake = fakeFlow(box)
  holder.current = fake
  const graph = mount(component as Parameters<typeof mount>[0])
  return { fake, graph }
}

/** 让替身报出"画布就绪"（真件里这是 vue-flow 的 `onPaneReady`） */
async function paneReady(): Promise<void> {
  for (const callback of (holder.current as FakeFlow).ready) callback()
  await settle()
}

/**
 * 场景包含的三条（容差 1px —— 与 `e2e/probe.ts:18` 的 `r.right > vw + 1` 同一个口径）。
 *
 * 三条各管一件事：位移不往左跑 · **画布那一层**（宽度 = 容器宽）不往右跑 · **图的内容**
 * 不往右跑。缩到装不下时，管用的是第三条 —— 那正是"只重夹位移、不重新拟合"修不好的地方。
 */
function containment(fake: FakeFlow): {
  width: number
  left: number
  layerRight: number
  contentRight: number
} {
  const { width } = fake.dimensions.value
  const { x, zoom } = fake.viewport.value
  return { width, left: x, layerRight: x + width * zoom, contentRight: x + CONTENT.width * zoom }
}

/** 断"这一刻场景待在容器盒子里"—— 三条一起看，红了要能一眼看出是哪一条 */
function expectInBox(fake: FakeFlow, where: string): void {
  const seen = containment(fake)
  const at = ' (viewport ' + JSON.stringify(fake.viewport.value) + ', box ' + seen.width + ')'
  expect(seen.left, where + ': the viewport must not be shifted left of the box' + at).toBeGreaterThanOrEqual(
    -1,
  )
  expect(seen.layerRight, where + ': the canvas layers must stay inside the box' + at).toBeLessThanOrEqual(
    seen.width + 1,
  )
  expect(seen.contentRight, where + ': the graph itself must stay inside the box' + at).toBeLessThanOrEqual(
    seen.width + 1,
  )
}

describe('CardGraph fits its viewport into the pane box', () => {
  it('F1 (guard) the pane-ready fit ends up inside the box it was told', async () => {
    const { fake, graph } = scene(WIDE)
    await paneReady()

    // 这两条是**量具的活口**：替身没被用上（mock 没生效）时，它们先红 ——
    // 不然 F2/F3 的红可能是"什么都没跑"（红错了地方）
    expect(fake.fits.length, 'the component never asked the fake store to fit').toBeGreaterThan(0)
    expect(fake.fits.at(-1), 'the pane-ready fit must use the box the store reports').toEqual(WIDE)
    // 夹取真的跑了：拟合之后组件自己又写了一次视口（只 fitView 不写 = 那一层会伸出盒子）
    expect(fake.writes.length, 'the component never wrote the clamped viewport back').toBeGreaterThan(0)
    // 1280 那一格今天就是干净的：拟合居中留下 44.5 的位移，被夹回 0（上限 = 1256 x (1 - 1)）
    expectInBox(fake, 'at pane ready')

    graph.unmount()
  })

  it('F2 the viewport is refitted when the pane box changes', async () => {
    const { fake, graph } = scene(WIDE)
    await paneReady()

    // 容器从 1256 缩到 876（真浏览器读数里的那一格）。事件由替身**自己发**：确定、不靠竞态
    fake.dimensions.value = { ...NARROW }
    await settle()

    expectInBox(fake, 'after the pane shrank')

    graph.unmount()
  })

  it('F3 the final viewport depends on the final box, not on the path it took', async () => {
    // ② 对照：一开始就是 876（同一个最终尺寸，另一条路径）—— 两条腿都走**产品本身**
    const control = scene(NARROW)
    await paneReady()
    const straight = { ...control.fake.viewport.value }
    expectInBox(control.fake, 'the control: 876 from the start')
    control.graph.unmount()

    // ③ 被测：1280 → 缩到 876
    const { fake, graph } = scene(WIDE)
    await paneReady()
    fake.dimensions.value = { ...NARROW }
    await settle()
    const walked = { ...fake.viewport.value }
    graph.unmount()

    expect(walked, 'the same final box must end at the same viewport').toEqual(straight)
  })
})

// 量具自检：**绿是够得到的**，而且**看着像修复的那半招修不好**。
//
// F2/F3 在今天的实现上必须是红的；但"红"也可能是**量具的错**（尺寸替换触发不了 `watch`、
// `settle()` 排不干净微任务）。这里拿两个手写的参考件把这条路走一遍 —— 它们与 `CardGraph`
// 用同一个替身 store，所以走的正是组件将来要走的那条路。

/** 参考件甲：接上"**尺寸变了就重跑一遍**"那一句（拟合 + 夹取都重跑） */
const Refit = defineComponent({
  name: 'Refit',
  /** 不画东西：它只把那条接线接上（卡图长什么样归组件故事管） */
  setup() {
    const fake = holder.current as FakeFlow
    /** 拟合 + 夹取（两段照 `CardGraph.vue` 的 `fitInBox` 写） */
    async function refit() {
      await fake.fitView({ padding: 0.1 })
      const { width } = fake.dimensions.value
      const zoom = Math.min(fake.viewport.value.zoom, 1)
      const x = Math.min(Math.max(fake.viewport.value.x, 0), width * (1 - zoom))
      await fake.setViewport({ ...fake.viewport.value, x, zoom })
    }
    fake.onPaneReady(() => void refit())
    watch(fake.dimensions, () => void refit())
    return () => h('div', { class: 'refit' })
  },
})

/** 参考件乙：看着像修复的那半招 —— **只重夹位移，缩放还是按老盒子算的** */
const ClampOnly = defineComponent({
  name: 'ClampOnly',
  /** 同样不画东西：它只把"只重夹位移"那条接线接上 */
  setup() {
    const fake = holder.current as FakeFlow
    /** 只把位移夹回盒子 */
    async function clamp() {
      const { width } = fake.dimensions.value
      const zoom = Math.min(fake.viewport.value.zoom, 1)
      const x = Math.min(Math.max(fake.viewport.value.x, 0), width * (1 - zoom))
      await fake.setViewport({ ...fake.viewport.value, x, zoom })
    }
    /** 拟合 + 夹取（开局那一遍与今天一样） */
    async function prime() {
      await fake.fitView({ padding: 0.1 })
      await clamp()
    }
    fake.onPaneReady(() => void prime())
    watch(fake.dimensions, () => void clamp())
    return () => h('div', { class: 'clamp-only' })
  },
})

describe('self-check: this harness can tell a fix from the tempting half-fix', () => {
  it('S1 a refit wired to the pane size puts the scene back in the box', async () => {
    const { fake, graph } = referenceScene(Refit, WIDE)
    await paneReady()
    fake.dimensions.value = { ...NARROW }
    await settle()

    expectInBox(fake, 'reference: after the pane shrank')

    graph.unmount()
  })

  it('S2 re-clamping the shift alone is not a fix: the graph still does not fit', async () => {
    const { fake, graph } = referenceScene(ClampOnly, WIDE)
    await paneReady()
    fake.dimensions.value = { ...NARROW }
    await settle()

    const seen = containment(fake)
    expect(
      seen.contentRight,
      'a clamp-only fix leaves the graph wider than the box (zoom is still 1)',
    ).toBeGreaterThan(seen.width)

    graph.unmount()
  })
})
