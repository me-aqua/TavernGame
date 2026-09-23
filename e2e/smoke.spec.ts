/**
 * 功能冒烟 —— 在真实浏览器里跑构建产物，覆盖「玩家点得出来」的那些路径。
 *
 * 判据：**读运行时 DOM**，不读源码；每个用例结束都检查
 * 「没有页面异常、没有 4xx/5xx」（见文件末尾的 afterEach）。
 *
 * 等待一律用 Playwright 的自动等待：等的是「这个元素真的变成这样了」，不是固定 sleep。
 * ⚠️ 一轮要跑完卡里九个节点（时间 / 地图各多一次工具往返 ≈ 十来次模型调用），
 *    所以等开场与等回合都要给足超时 —— 假模型每次调用都要睡一下。
 */
import { expect, test, type Page } from '@playwright/test'
import {
  CONFIG,
  DEBUG_KEY,
  LANG_KEY,
  LEAD_NAME,
  LEAD_PLACE,
  MOVED_PLACE,
  NARRATION,
  OPENING_PLACE,
  PLACE_FIELDS,
  TIME_NODE,
  WHERE_PATH,
  WHO_KEY,
  openApp,
  saveWith,
  translate,
  watchErrors,
} from './fixtures'
import { PROBE, expectClean, type Probe } from './probe'
// 只读卡的 JSON：不 import 应用模块（那条链会拖进 i18n 的 .json，
// Playwright 的 ESM 加载器需要 import attribute，而 Vite 构建不需要）
import cardJson from '../cards/morningwind.json' with { type: 'json' }

/** 卡（期望值全部从卡里现读，不在这里抄一份内容） */
const CARD = cardJson as unknown as Record<string, any>

/** 浅色主题的页面底色（与 src/styles/main.css 的 token 对应） */
const LIGHT_BG = 'rgb(242, 244, 247)'
/** 时间标签的形状由历法决定，这里只看形状，不写死具体日期 */
const TIME_PATTERN = /^\d{4} 年 \d+ 月 \d+ 日 · 星期[日一二三四五六] · (上午|下午|晚上)$/
/** 一轮跑完要十来次模型调用 —— 等它跑完得给足时间 */
const TURN_TIMEOUT = 20_000

/**
 * R20：**主控的位置在 `whoIsWhere` 那本册子里** —— `world.location` 那一枝与 `move_to` 都没了。
 *
 * 每一条都是三栏（R20 ③），**键是主控的名字**（R20 ②）——
 * 卡的状态初值里现在就有主控那一条，新开局那一帧答得出"你在哪"。
 */
const LEAD = { name: LEAD_NAME, place: LEAD_PLACE }

/** 卡里那个声明了 role: story 的节点 id —— 叙事取自它 */
const STORY_NODE = (CARD.graph.topology as string[]).find(
  (id: string) => CARD.graph.nodes[id].role === 'story',
) as string

/**
 * 枝树那一屏的期望值：卡里"能编"的容器节点（自己有一张非空字段表的那种）。
 *
 * e2e 不 import 应用模块（见文件头），所以这一小段按卡的 JSON 再算一遍 —— 与组件层
 * `tests/support/branch-tree.ts` 的 `TREE_PATHS` 同一套走法：`object` 往 `fields` 下钻、
 * `map` / `list` 往 `of.fields` 下钻（元素形状那一段写成 `x.*`）。
 */
const TREE_ROWS: Array<{ path: string; fields: string[] }> = []
{
  /** 一段点号路径 → schema：`a.b` 走 `state.a.fields.b`，`a.*` 走元素形状（`of`） */
  const at = (path: string): Record<string, any> | undefined => {
    let current: any = CARD.state
    let scope: Record<string, any> | undefined = CARD.state
    for (const segment of path.split('.')) {
      if (segment === '*') {
        current = current?.of
        scope = current?.fields
        continue
      }
      if (scope === undefined || !Object.hasOwn(scope, segment)) return undefined
      current = scope[segment]
      scope = current?.fields
    }
    return current
  }
  /** 一格在中栏那张表里应有的行名：`object` 读自己的 `fields`，`map` / `list` 读元素形状的 */
  const fieldsOf = (path: string): string[] => {
    const node = at(path)
    if (node === undefined) return []
    if (node.fields !== undefined) return Object.keys(node.fields)
    return node.of?.fields === undefined ? [] : Object.keys(node.of.fields)
  }
  const seen = new Set<string>(Object.keys(CARD.state))
  const queue: string[] = [...seen]
  /** 放一个路径进队（空串丢弃、已经在队里过的不再进） */
  const push = (path: string): void => {
    if (path === '' || seen.has(path)) return
    seen.add(path)
    queue.push(path)
  }
  while (queue.length > 0) {
    const path = queue.shift() as string
    const node = at(path)
    if (node === undefined) continue
    const kind = typeof node === 'string' ? node : node.type
    const fields = fieldsOf(path)
    if (['object', 'map', 'list'].includes(kind) && fields.length > 0) TREE_ROWS.push({ path, fields })
    for (const key of Object.keys(node.fields ?? {})) push(path + '.' + key)
    // `*` 是元素形状那一段的标记，不是一格：它底下只再走字段，不许再套一层 `*`
    if (path.endsWith('.*')) continue
    if (node.of !== undefined) push(path + '.*')
  }
}

/**
 * 树上每一行的路径（**顺序不承诺**，见下面那段）。
 *
 * 与实现同一套走法（`CardEditor.vue:18` / `StateTreeNav.vue:20` 是**逐层向下**）：
 * S3 用两个独立通道证明过 —— 含整页巡检那张 `editor-open--laptop.png` 的左栏 22 行逐行相同。
 *
 * ⚠️ **票 71（2026-09-23）组长裁：树的显示顺序不算承诺。** 依据是设计 §二.3 给的那一句话
 *    ——设计图的行序是**前序**、实现是**逐层**，两边都没错，**"哪一行先出现"不是契约的一部分**。
 *    ⇒ 下面那条断言因此**改成集合相等**（与组件层的 `A1a` 同一口径）：`toEqual` 是**隐藏承诺**
 *    ——它会把"顺序"钉死在一个从没被承诺过的地方，任何人调整走法都会红，而那不是回归。
 *    ⚠️ 另一条**不动**：中栏那张表的**行序**是承诺（契约 A3 —— 卡的声明顺序是唯一的顺序）。
 */
const TREE_PATHS = TREE_ROWS.map((row) => row.path)

/** 某一格在中栏那张表里应有的行名 */
function treeFields(path: string): string[] {
  return TREE_ROWS.find((row) => row.path === path)?.fields ?? []
}

const watched = new WeakMap<Page, { runtimeErrors: string[]; badResponses: string[] }>()

test.beforeEach(async ({ page }) => {
  watched.set(page, watchErrors(page))
})

/**
 * 收尾检查：页面异常与 4xx/5xx 都必须为零。
 * 故意制造错误的用例（例如假模型返回 500）自己声明豁免。
 */
test.afterEach(async ({ page }, testInfo) => {
  const seen = watched.get(page)
  if (!seen) return
  expect(seen.runtimeErrors, '页面异常必须为零').toEqual([])
  const allowsBadResponses = testInfo.annotations.some((a) => a.type === 'allow-bad-responses')
  if (!allowsBadResponses) expect(seen.badResponses, '不能有 4xx/5xx').toEqual([])
})

test.describe('第一屏', () => {
  test('外壳、侧栏、时间标签、状态栏与按钮都在，且欢迎走状态行', async ({ page }) => {
    await openApp(page)

    // 状态浮层：时间、场景、回合都收在一小块里
    const pill = page.locator('aside')
    // 那条「场景」显示**主控在谁在哪里的那一条**（R20）：值来自册子，
    // 指路（册子在哪、主控名字在哪一格）由卡的 声明.显示.场景 说一次。
    // ⚠️ 这一条没有种存档 ⇒ 页面画的是**卡的开局那帧**，期望值要取卡里册子的初值
    //    （`OPENING_PLACE`），不是存档夹具写的那个位置（`LEAD_PLACE` 是 `saveWith` 种的）。
    await expect(pill.locator('.scene-name')).toContainText(OPENING_PLACE[PLACE_FIELDS.spot])
    await expect(pill.locator('[data-turn]')).toHaveText('0')
    // 侧栏在手机与桌面上是两种排布，:visible 只取当前那一份
    await expect(page.locator('.time-display:visible')).toHaveText(TIME_PATTERN)
    // 控件只剩悬浮按钮：设置（带连接状态点）与（本机开发才有的）调试开关
    await expect(page.locator('button[data-settings]')).toBeVisible()
    await expect(page.locator('button[data-settings] span.rounded-full')).toHaveCount(1)

    // 没配 API 时：欢迎语是**状态行**，不是故事行
    await expect(page.locator('.line')).toHaveCount(0)
    await expect(page.locator('[data-status]')).toHaveText(await translate(page, 'app.welcome'))
  })

  test('本机地址默认开调试，开关能关掉、能记住、也能再打开（面板入口跟着它）', async ({ page }) => {
    await openApp(page)

    const toggle = page.locator('button[data-debug]')
    await expect(toggle).toHaveText(await translate(page, 'header.debugToggleOn'))
    // 调试面板的入口就在它旁边，调试关掉时不渲染
    await expect(page.locator('button[data-debug-panel-toggle]')).toHaveCount(1)

    // 它必须紧挨着设置按钮、一起在右上角（justify-between 曾把它推到屏幕正中）
    const debugBox = await toggle.boundingBox()
    const settingsBox = await page.locator('button[data-settings]').boundingBox()
    expect(debugBox?.x ?? 0).toBeLessThan(settingsBox?.x ?? 0)
    expect(settingsBox?.x ?? 0).toBeGreaterThan((page.viewportSize()?.width ?? 0) / 2)

    await toggle.click()
    await expect(toggle).toHaveText(await translate(page, 'header.debugToggleOff'))
    await expect(page.locator('[data-status]')).toHaveText(await translate(page, 'app.debugOff'))
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), DEBUG_KEY)).toBe('off')
    await expect(page.locator('button[data-debug-panel-toggle]')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveText(await translate(page, 'header.debugToggleOn'))
    await expect(page.locator('button[data-debug-panel-toggle]')).toHaveCount(1)
  })
})

test.describe('世界面板', () => {
  test('按卡声明的块与顺序渲染，内容读状态树，高亮当前地点', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG })

    // 它是玩家点开的浮层：默认不在
    await expect(page.locator('[data-world-panel]')).toHaveCount(0)
    await page.locator('button[data-world]').click()
    const panel = page.locator('[data-world-panel]')
    await expect(panel).toBeVisible()

    // 块与顺序来自卡的 声明.显示.侧栏（期望值从卡里现读，不抄一份内容）
    const declared = (CARD.display.sidebar as Array<Record<string, string>>).map((block) => block.path)
    await expect(panel.locator('[data-block]')).toHaveCount(declared.length)
    const rendered = await panel
      .locator('[data-block]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-block')))
    expect(rendered).toEqual(declared)

    // 内容读的是**状态树**：区域一个不少、背包一件不少、角色字典里的人都在。
    // ⚠️ 钩子是通用的（`data-entry` / `data-value`，不含任何内容名）⇒ 数哪一块得先按
    //    `data-block`（那一条声明的路径）圈出来，面板整体的条目数分不出是哪一块的。
    const saved = JSON.parse(saveWith()) as { state: Record<string, any> }
    const areas = Object.keys(saved.state.world.map)
    const pack = saved.state.lead.pack as unknown[]
    const cast = Object.keys(saved.state.roles)
    await expect(panel.locator('[data-block="world.map"] [data-entry]')).toHaveCount(areas.length)
    await expect(panel.locator('[data-block="lead.pack"] [data-entry]')).toHaveCount(pack.length)
    for (const name of cast) await expect(panel).toContainText(name)

    // ⚠️ 当前地点（R20）：主控在谁在哪里的那一条 ⇒ 世界面板该把它标出来。
    //    标的是那一组与**那一个值自己**（`data-value` 落在每个值上），判据是值相等。
    const here = panel.locator('[data-block="world.map"] [data-value][data-current]')
    await expect(here).toHaveCount(1)
    await expect(here).toHaveText(LEAD.place[PLACE_FIELDS.spot])
    await expect(panel.locator('[data-block="world.map"] [data-entry][data-current]')).toHaveCount(1)

    await page.locator('button[data-world-close]').click()
    await expect(panel).toHaveCount(0)
  })
})

test.describe('调试面板', () => {
  test('能开：三块分页都在，卡图画出卡里的拓扑，引擎状态读出状态树', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG, debug: 'on' })

    await expect(page.locator('[data-debug-panel]')).toHaveCount(0)
    await page.locator('button[data-debug-panel-toggle]').click()
    const panel = page.locator('[data-debug-panel]')
    await expect(panel).toBeVisible()

    // ① 卡图：节点数 = 卡里拓扑的节点数
    await expect(panel.locator('.vue-flow__node')).toHaveCount((CARD.graph.topology as string[]).length)

    // ② 引擎状态：四个顶层分支逐层展开 + 时间 + 回合
    await panel.locator('[data-debug-tab="state"]').click()
    const saved = JSON.parse(saveWith()) as { state: Record<string, unknown>; meta: { turn: number } }
    const branches = await panel
      .locator('[data-debug-branch]')
      .evaluateAll((els) => els.map((el) => el.getAttribute('data-debug-branch')))
    expect(branches).toEqual(Object.keys(saved.state))
    await expect(panel).toContainText(String(saved.meta.turn))

    // ③ 工具调用：这一局还没有跑过工具，说的是「最近一轮没有工具调用」而不是空白
    await panel.locator('[data-debug-tab="tools"]').click()
    await expect(panel.locator('[data-debug-tools-empty]')).toHaveText(
      await translate(page, 'debug.toolsNone'),
    )

    // 结构判据与组件故事同一套（e2e/probe.ts）
    expectClean((await page.evaluate(PROBE)) as Probe)

    await panel.locator('[data-debug-close]').click()
    await expect(panel).toHaveCount(0)
  })

  test('活的卡图：一轮在跑的时候，正好一个节点标着「正在跑」', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG, debug: 'on', fake: 'narration' })

    await page.locator('textarea').fill('我去铁匠铺找萨伦')
    await page.getByRole('button', { name: await translate(page, 'composer.submit') }).click()
    // 面板是底部抽屉，压在输入卡片上 —— 先提交，再打开它看这一轮
    await page.locator('button[data-debug-panel-toggle]').click()

    // 一轮要跑两秒多：这段时间里图上恰好有一个节点是「在跑」（跑到哪个就亮哪个）
    await expect(page.locator('[data-node-state="active"]')).toHaveCount(1)
    await expect(page.locator('.line.narration').last()).toContainText(NARRATION, { timeout: TURN_TIMEOUT })
    // 跑完就没有「在跑」的节点了
    await expect(page.locator('[data-node-state="active"]')).toHaveCount(0)
  })

  test('工具调用失败过的节点在卡图上标红（引擎只回传错误，不抛）', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG, debug: 'on', fake: 'toolError' })

    await page.locator('textarea').fill('我去铁匠铺找萨伦')
    await page.getByRole('button', { name: await translate(page, 'composer.submit') }).click()
    await expect(page.locator('.line.narration').last()).toContainText(NARRATION, { timeout: TURN_TIMEOUT })

    await page.locator('button[data-debug-panel-toggle]').click()
    const failed = page.locator('[data-node-state="failed"]')
    await expect(failed).toHaveCount(1)
    // 标红的正是时间节点：它调的 advance_time 参数（负数）没过校验
    await expect(failed).toContainText(CARD.graph.nodes[TIME_NODE].name)
  })

  test('跑完一轮之后：工具调用一条条列着，卡图上跑过的节点还看得见', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG, debug: 'on', fake: 'narration' })

    await page.locator('textarea').fill('我去铁匠铺找萨伦')
    await page.getByRole('button', { name: await translate(page, 'composer.submit') }).click()
    await expect(page.locator('.line.narration').last()).toContainText(NARRATION, { timeout: TURN_TIMEOUT })

    await page.locator('button[data-debug-panel-toggle]').click()
    const panel = page.locator('[data-debug-panel]')
    await panel.locator('[data-debug-tab="tools"]').click()

    // 时间节点调了 advance_time、地图节点调了 set_whereabouts：工具名与原始参数都看得见
    const calls = panel.locator('[data-tool-call]')
    await expect(calls).toHaveCount(2)
    await expect(panel).toContainText('advance_time')
    await expect(panel).toContainText('"minutes"')
    await expect(panel).toContainText('set_whereabouts')
    await expect(panel).toContainText('"' + WHO_KEY + '"')
    // 原始参数里就是那条位置（假模型让地图节点把主控记到铁匠铺）——
    // ⚠️ R20 ③ 之后那一条是**三栏**（不再是"三段拼成的一条串"），所以这里断它的「地点」栏
    await expect(panel).toContainText(MOVED_PLACE[PLACE_FIELDS.spot])
    // 每次调用都写着它写了哪条路径 —— R20：位置写进「谁在哪」那本册子的**主控那一条**
    // （路径从卡自己的动作现读：段 3 之后那一段是中文的）
    await expect(panel).toContainText(WHERE_PATH + '.' + LEAD.name)

    // 引擎状态那一页：本轮写入清单跟着出来了
    await panel.locator('[data-debug-tab="state"]').click()
    await expect(panel.locator('[data-debug-write]')).toHaveCount(2)
    await expect(panel).toContainText(WHERE_PATH + '.' + LEAD.name)
  })
})

test.describe('设置面板', () => {
  test('打得开、列出服务商与字段、点背景关得上', async ({ page }) => {
    await openApp(page)
    await page.locator('button[data-settings]').click()

    const drawer = page.locator('.drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.locator('select option')).toHaveCount(6)
    // 四个输入字段各一个 label（引擎没有步数上限了，那条滑块连同它的 label 一起删掉了）
    await expect(drawer.locator('label')).toHaveCount(4)
    await expect(drawer.locator('button[data-test-connection]')).toBeVisible()

    // 点面板外面（左上角）才是「点背景关闭」，点正中会落在面板上
    await drawer.click({ position: { x: 4, y: 4 } })
    await expect(page.locator('.drawer')).toHaveCount(0)
  })
})

test.describe('卡', () => {
  // ⚠️ 票 69（段 8b-①）：这一条原来是「节点数 = 卡里拓扑，点节点出表单，声明只读」——
  //    8b-① 把卡图与「编一步」表单都移出了编辑器 ⇒ 那一段（`.vue-flow__node` 计数 +
  //    点节点出表单）**整段挪到 8c**（契约 `.team/test/2026-09-22/contract-69.md` §5 第 5 项）。
  //    卡图本身没死：调试面板那一条还在数 `.vue-flow__node`（`DebugPanel` 仍用着 `CardGraph`）。
  //    本票的现场在下一条（「左栏是枝的导航树」）。
  // ⚠️ 票 70（段 8b-②）：下一条里"中栏一个可编辑控件都没有"那三行**整条反过来了** ——
  //    说明格 / 垃圾桶 / 加字段是本票的活。契约 `.team/test/2026-09-22/contract-70.md` §5。
  test('卡图浮层：打得开、说清用的是哪张卡、结构判据干净、关得上', async ({ page }) => {
    await openApp(page)
    await page.locator('button[data-settings]').click()

    const section = page.locator('[data-card-section]')
    await expect(section).toBeVisible()
    await expect(section).toContainText(await translate(page, 'card.sourceBuiltin'))

    await section.locator('button[data-card-view]').click()
    const editor = page.locator('[data-card-editor]')
    await expect(editor).toBeVisible()

    // 结构判据与组件故事同一套（e2e/probe.ts）
    expectClean((await page.evaluate(PROBE)) as Probe)

    await editor.locator('button[data-card-close]').click()
    await expect(editor).toHaveCount(0)
  })

  test('左栏是枝的导航树：行 = 卡里能编的容器，中栏是可写的字段表', async ({ page }) => {
    await openApp(page)
    await page.locator('button[data-settings]').click()
    await page.locator('[data-card-section] button[data-card-view]').click()
    const editor = page.locator('[data-card-editor]')
    await expect(editor).toBeVisible()

    // ⚠️ 反面控制：这一条**必须**先证明树真的长出来了 —— 下面"There is one row per card
    //    node"与"点一行出的是那一格的表"两句只要树是空的就都恒真（"读不到东西"型假绿）。
    //    它也是"整条能力不在"时跑到的那一句（红得对，而且是红在钩子上）。
    await expect(editor.locator('[data-branch-nav]')).toBeVisible()

    // 旧接缝退场：卡图与「编一步」表单都不该再挂在编辑器里（口径 A7）
    await expect(editor.locator('[data-card-form]')).toHaveCount(0)

    // 每一行一个卡里的状态节点（期望值从卡现算，不抄第二份）。
    //
    // ⚠️ **票 71（2026-09-23）**：这一句原来是 `toEqual(TREE_PATHS)` —— 逐项相等，**把顺序也钉死了**。
    //    组长裁「树的显示顺序不算承诺」（设计 §二.3）⇒ 那句是**隐藏承诺**：谁调整走法（逐层 ⇄ 前序）
    //    都会红，而那不是回归。现在断的是**集合**（排序后逐个相等，与组件层 `A1a` 同一口径）：
    //    "少一行 / 多一行 / 名字写错"照样红，"只是换了先后"不再红。
    // ⚠️ **读的是 `data-branch-node` 属性，不是行上的可见文字**（S3 的 N-5）：组件层 `A1a` 读的也是它
    //    ⇒ 同源。读文字会**顺手多承诺一件事**（"行上显示的就是路径"），而设计只承诺三件。
    //    ⚠️ 中栏那张表的**行序仍然断**（下面 `toEqual(treeFields(pick))`）—— 那是契约 A3 承诺过的。
    const nav = editor.locator('[data-branch-node]')
    await expect(nav).toHaveCount(TREE_PATHS.length)
    const shown = await nav.evaluateAll((nodes) =>
      nodes.map((el) => el.getAttribute('data-branch-node') ?? ''),
    )
    expect([...shown].sort(), 'the tree must show exactly the card nodes, in any order').toEqual(
      [...TREE_PATHS].sort(),
    )

    // 点一行：中栏字幕、亮着的那一行、表里的行名三处说的是同一格
    const pick = TREE_PATHS[1]
    await editor.locator('[data-branch-node="' + pick + '"]').click()
    await expect(editor.locator('[data-branch-title]')).toContainText(pick)
    await expect(editor.locator('[data-branch-on]')).toHaveCount(1)
    expect(
      await editor
        .locator('[data-field-key]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-field-key'))),
    ).toEqual(treeFields(pick))
    // 🔴 票 70（段 8b-②）：这一格从**只读**变成了**可写** —— 上一票那句"没有输入框、没有垃圾桶、
    //    没有加字段"整条反过来了。现在断的是白名单：表里**只许**出现契约点名的那四个可编辑控件，
    //    而且**四个都要真的出现过**（少了后半句，"一个控件都没有"的实现照样绿 —— 那正是旧形状）。
    await expect(editor.locator('[data-card-save]')).toBeVisible()
    await expect(editor.locator('[data-field-note]')).toHaveCount(treeFields(pick).length)
    await editor.locator('[data-field-add]').click()
    await expect(editor.locator('[data-row-new]')).toHaveCount(1)
    for (const one of ['[data-field-key-new]', '[data-field-kind-new]', '[data-field-initial-new]']) {
      await expect(editor.locator(one)).toHaveCount(1)
    }
    expect(
      await editor.evaluate((root) => {
        const allowed =
          '[data-field-note], [data-field-key-new], [data-field-kind-new], [data-field-initial-new]'
        const inside = '[data-branch-form] input, [data-branch-form] select, [data-branch-form] textarea'
        return [...root.querySelectorAll(inside)].filter((el) => !el.matches(allowed)).length
      }),
      'the table may only hold the four editable controls of the contract',
    ).toBe(0)
    // 🔴 新那颗「＋」不许叫 `data-add`：编枝态那两颗是 8a 的保留集合（`visual.spec.ts` 逐项断过）
    await expect(editor.locator('[data-add]')).toHaveCount(2)
    await expect(editor.locator('[data-add="field"]')).toHaveCount(0)

    // 结构判据与组件故事同一套（e2e/probe.ts）—— 树的点按区也一起过 24×24
    expectClean((await page.evaluate(PROBE)) as Probe)
  })

  test('编一步：细条点一步 ⇒ 中栏换成那一屏，而且那一屏全是只读', async ({ page }) => {
    await openApp(page)
    await page.locator('button[data-settings]').click()
    await page.locator('[data-card-section] button[data-card-view]').click()
    const editor = page.locator('[data-card-editor]')
    await expect(editor).toBeVisible()

    const steps = CARD.graph.topology as string[]
    await expect(editor.locator('[data-step]'), 'the strip must list the steps of the card').toHaveCount(
      steps.length,
    )
    // 开屏：两条轴都空，中栏是显式空态（票 73 的 R2 —— 不自动选第 1 步）
    await expect(editor.locator('[data-branch-on]')).toHaveCount(0)
    await expect(editor.locator('[data-step-on]')).toHaveCount(0)
    await expect(editor.locator('[data-branch-none]')).toBeVisible()

    const first = steps[0]
    await editor.locator('[data-step="' + first + '"]').click()
    const screen = editor.locator('[data-step-form]')
    await expect(screen, 'picking a step must bring up the screen of that step').toBeVisible()
    await expect(editor.locator('[data-step-node]')).toHaveAttribute('data-step-node', first)
    await expect(editor.locator('[data-branch-none]'), 'the empty state must step aside').toHaveCount(0)
    await expect(editor.locator('[data-branch-form]'), 'only one of the two screens at a time').toHaveCount(0)
    await expect(editor.locator('[data-branch-title]')).toContainText(CARD.graph.nodes[first].name)
    await expect(editor.locator('[data-step-on]'), 'the strip lights the picked step').toHaveCount(1)
    await expect(editor.locator('[data-branch-on]'), 'the tree must go dark').toHaveCount(0)
    // R4：那一屏里一个可编控件都没有（本刀只读）
    expect(
      await screen.evaluate((root) => root.querySelectorAll('input, select, textarea').length),
      'this ticket shows the step read-only: no editable control may be inside that screen',
    ).toBe(0)

    // 点树上的一行 ⇒ 换回编枝那一屏，细条的高亮清掉
    await editor.locator('[data-branch-node]').first().click()
    await expect(editor.locator('[data-branch-form]')).toBeVisible()
    await expect(editor.locator('[data-step-form]')).toHaveCount(0)
    await expect(editor.locator('[data-step-on]')).toHaveCount(0)
    await expect(editor.locator('[data-branch-on]')).toHaveCount(1)
    // 反面控制：**同一句查询**在编枝那张表里数得出控件 —— 少了它，上面那句"0 个"什么也没验
    expect(
      await editor
        .locator('[data-branch-form] input, [data-branch-form] select, [data-branch-form] textarea')
        .count(),
      'the same query finds controls in the field table: without it the line above proves nothing',
    ).toBeGreaterThan(0)

    // 再点一步 ⇒ 树的高亮清掉（两条轴任一时刻最多一个非空）
    await editor.locator('[data-step="' + steps[1] + '"]').click()
    await expect(editor.locator('[data-step-form]')).toBeVisible()
    await expect(editor.locator('[data-branch-on]')).toHaveCount(0)

    expectClean((await page.evaluate(PROBE)) as Probe)
  })

  test('存着的卡读不出来：退回内置示例，状态行与卡一节都说明原因', async ({ page }) => {
    await openApp(page, { card: '{not valid json' })

    // 状态行那句话是 error 级（进行中会顶掉它，所以卡一节里还有一份留底）
    const prefix = (await translate(page, 'card.fallback', { message: '' })).split('\n')[0]
    await expect(page.locator('[data-status="error"]')).toContainText(prefix)

    await page.locator('button[data-settings]').click()
    const section = page.locator('[data-card-section]')
    await expect(section).toContainText(await translate(page, 'card.sourceBuiltin'))
    await expect(section.locator('[data-card-fallback]')).toBeVisible()
  })
})

test.describe('坏存档', () => {
  test('页面不白屏、说清楚坏了、并留一份备份', async ({ page }) => {
    await openApp(page, { save: '{not valid json' })

    await expect(page.locator('#app > *')).toHaveCount(1)
    const prefix = (await translate(page, 'app.startupCorrupted', { message: '' })).split('\n')[0]
    await expect(page.locator('[data-status="error"]')).toContainText(prefix)

    const backups = await page.evaluate(() =>
      Object.keys(localStorage).filter((key) => key.includes('.broken-')),
    )
    expect(backups).toHaveLength(1)
  })
})

test.describe('主题', () => {
  test('深色亮色都落在 <html> 上，底色确实不同', async ({ page }) => {
    await openApp(page, { theme: 'dark' })
    await expect(page.locator('html')).toHaveClass(/dark/)
    const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    expect(darkBg).not.toBe(LIGHT_BG)

    await openApp(page, { theme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(LIGHT_BG)
  })
})

test.describe('语言', () => {
  test('存储的选择优先于浏览器语言，切到英文后 html lang 与文案都跟着变', async ({ page }) => {
    await openApp(page, { lang: 'zh-CN' })
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await expect(page.locator('button[data-settings]')).toContainText(
      await translate(page, 'header.settings'),
    )

    // 语言与主题都收进了设置面板
    await page.locator('button[data-settings]').click()
    await page.locator('button[data-language-option]').nth(2).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('.drawer')).toContainText('Language')
    await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), LANG_KEY)).toBe('en')
    // 标签页标题也跟着语言走（index.html 里那个 title 只是 ASCII 占位）
    await expect(page).toHaveTitle(/TavernGame/)
    expect(await page.title()).not.toContain('游戏')
  })
})

test.describe('新游戏', () => {
  test('配好 key 就自动跑开场：故事区出一条正文，还没有玩家行动行', async ({ page }) => {
    await openApp(page, { config: CONFIG, fake: 'narration' })

    // 开场 = 卡里九个节点跑一遍，正文来自声明了 role: story 的那个节点
    await expect(page.locator('.line.narration')).toHaveCount(1, { timeout: TURN_TIMEOUT })
    await expect(page.locator('.line.narration')).toContainText(NARRATION)
    // 开场没有玩家原话，所以没有行动行
    await expect(page.locator('.line.action')).toHaveCount(0)
    // 回合数与状态：一回合落地之后状态行就该空了
    await expect(page.locator('aside [data-turn]:visible')).toHaveText('1')
    await expect(page.locator('[data-status]')).toHaveCount(0)
  })
})

test.describe('接着上次玩', () => {
  test('有存档时不播报、故事在屏幕上、回合数在侧栏', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG })

    // 恢复是默认行为，不该有任何播报
    await expect(page.locator('[data-status]')).toHaveCount(0)
    await expect(page.locator('.line')).toHaveCount(2)
    // 手机上侧栏是紧凑条（[data-turn-compact]），桌面才是卡片；:visible 只取看得见的那个
    await expect(page.locator('aside [data-turn]:visible')).toHaveText('6')
  })

  test('提交一次行动：行动与叙事按顺序进故事，回合数 +1', async ({ page }) => {
    await openApp(page, { save: saveWith(), config: CONFIG, fake: 'narration' })

    const action = '我去码头看看'
    await page.locator('textarea').fill(action)
    await page.getByRole('button', { name: await translate(page, 'composer.submit') }).click()

    // 存档里已经有一条行动，所以看最后一条
    await expect(page.locator('.line.action').last()).toHaveText(action)
    await expect(page.locator('.line.narration').last()).toContainText(NARRATION, { timeout: TURN_TIMEOUT })
    await expect(page.locator('aside [data-turn]:visible')).toHaveText('7')

    // 回合跑完状态行就该空了（进行中不是数据）
    await expect(page.locator('[data-status]')).toHaveCount(0)
  })

  test('模型出错时玩家看得到（这条允许 500）', async ({ page }, testInfo) => {
    testInfo.annotations.push({ type: 'allow-bad-responses' })
    await openApp(page, { save: saveWith(), config: CONFIG, fake: 'error' })

    await page.locator('textarea').fill('我去码头看看')
    await page.getByRole('button', { name: await translate(page, 'composer.submit') }).click()

    const prefix = (await translate(page, 'store.failed', { message: '' })).split('{message}')[0].trim()
    await expect(page.locator('[data-status="error"]')).toContainText(prefix, { timeout: TURN_TIMEOUT })
  })
})

// STORY_NODE 是卡里声明 role: story 的节点 —— 上面那条「开场出一条正文」测的就是它
export { STORY_NODE }
