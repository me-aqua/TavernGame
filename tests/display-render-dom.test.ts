// @vitest-environment jsdom
/**
 * 票 63 · 段 6：**三种预设格式画得出什么**（渲染侧）。
 *
 * 契约 `.team/test/2026-09-19/contract-63.md`；声明侧（卡里那份声明合法不合法）在
 * `display-format.test.ts`，这一件只管**画**：
 *   · 一块 = 卡里声明的一枝，顺序即声明顺序，`[data-block]` 的值就是那条路径；
 *   · 键值（object）/ 列表（list）/ 分组列表（map）各自的画法；
 *   · 数组字段里的**每个值单独一个元素**（「当前所在」得能落在那一个上，e2e 断的就是它）；
 *   · 「当前所在」按**值相等**标出来 —— 不认字段名（字段名是作者起的，见 `state-view.ts` 的文件头）；
 *   · 合法的空（空声明 / 空枝）不许抛。
 *
 * ⚠️ 期望值全部从卡与状态树**现取**：这一件里不写死区域名 / 人名 / 地点名（它们随卡变），
 *    也不按文案找元素（选元素一律用 `data-*` 钩子）。
 * ⚠️ `tests/` 里的字符串必须 ASCII：卡里的中文一律从卡现取。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WorldPanel from '../src/components/WorldPanel.vue'
import { world, worldBlocks } from '../src/components/display-blocks'
import { displayOf } from '../src/game/display'
import { parseCard } from '../src/game/card'
import { instantiate, type StateTree } from '../src/game/card-state'
import { currentCard } from '../src/game/current-card'

/** 当前卡（内置示例）—— 与 display-blocks 读的是同一张；读数通道改卡时两边一起改 */
const card = currentCard
/** 卡里 `display` 那一段，当数据读（形状由 display-format.test.ts 守） */
const display = JSON.parse(JSON.stringify(card.display)) as Record<string, any>
/** 卡里声明的侧栏块（顺序即画出来的顺序） */
const declared = display.sidebar as Array<Record<string, any>>
/** 开局那一帧的状态树 —— 面板画的永远是这一局的真相 */
const state = instantiate(card)
/**
 * 那本册子（段 4 之后「当前所在」唯一的来源）与主控名字那一格。
 *
 * ⚠️ 取不到时给空串、**不在模块加载期抛**：模块级抛错会让整个文件一条用例都进不了收集，
 *    那样读数就只剩"文件炸了"，看不出是哪几条判据红（票 56 评审点名过的形态）。
 */
const WHERE_PATH = String(display.scene?.path ?? '')
const LEAD_NAME_PATH = String(display.scene?.who ?? '')

/** 按点号路径取状态树里的一格（读不到就是 undefined，不抛） */
function at(tree: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((scope, key) => (scope as Record<string, unknown>)?.[key], tree)
}

/** 声明里第一条用某个格式的块 —— 找不到就抛（夹具自检走在被测行为之前） */
function pathOfFormat(format: string): string {
  const entry = declared.find((item) => item.format === format)
  if (entry === undefined) throw new Error('the demo card declares no "' + format + '" block')
  return String(entry.path)
}

/** 挂一栏（块来自当前卡；状态可换）—— 票 68 起组件是**一栏**，`side` 是它自己的那一侧 */
function panel(tree: StateTree = state) {
  return mount(WorldPanel, { props: { side: 'left', blocks: world, state: tree } })
}

/**
 * 一张卡 + 两处改动：往 `state` 里长两枝、再让侧栏点名它们 —— 卡自己的 schema 说了算。
 *
 * 这是 R12/R13 的判据要用的**新枝**：引擎从没见过它们，也不该认识它们。
 */
function grown(extra: Record<string, unknown>, entries: Array<Record<string, unknown>>) {
  const fresh = JSON.parse(JSON.stringify(card)) as Record<string, any>
  const world = fresh.state.world as { fields: Record<string, unknown> }
  for (const [name, field] of Object.entries(extra)) world.fields[name] = field
  fresh.display.sidebar = entries
  return parseCard(JSON.stringify(fresh))
}

/** 一块的骨架：标签 + **属性名**（值与文字都丢掉）—— 认格式的渲染器，两条枝同形 */
function skeletonOf(el: { element: Element }): string {
  /** 递归写一个元素的形状 */
  const shape = (node: Element): string => {
    const attrs = Array.from(node.attributes)
      .map((attr) => attr.name)
      .sort()
      .join(',')
    const kids = Array.from(node.children).map(shape).join(' ')
    return '<' + node.tagName.toLowerCase() + ' [' + attrs + ']>' + (kids ? '(' + kids + ')' : '')
  }
  return shape(el.element)
}

describe('the panel draws one block per declared branch', () => {
  it('14 the blocks come out in the declared order, keyed by the declared path', () => {
    const w = panel()
    const paths = declared.map((entry) => String(entry.path))
    expect(w.findAll('[data-block]').map((el) => el.attributes('data-block'))).toEqual(paths)
    // 每块的标题都画出来了（标题是卡里的内容，从卡现取）
    const text = w.text()
    for (const entry of declared) expect(text, 'block title').toContain(String(entry.title))
  })

  it('15 a grouped list draws every group, and every value of a list field on its own', () => {
    const areas = at(state, 'world.map') as Record<string, Record<string, unknown>>
    const names = Object.keys(areas)
    expect(names.length, 'the opening map has no area to draw').toBeGreaterThan(0)
    const w = panel()
    const block = w.find('[data-block="world.map"]')
    expect(block.exists(), 'the area table has no block of its own').toBe(true)
    expect(block.findAll('[data-entry]')).toHaveLength(names.length)
    const text = block.text()
    for (const name of names) {
      expect(text, 'area').toContain(name)
      // 每一处地点都是一个字符串数组 —— 哪一栏是地点由作者决定，界面只认形状
      for (const value of Object.values(areas[name])) {
        if (!Array.isArray(value)) continue
        for (const place of value) {
          // 数组里也可能有对象（那不是「一个值」）—— 这一条只管标量
          if (place === null || typeof place === 'object') continue
          expect(text, 'place').toContain(String(place))
          // 每个值自己一个元素：e2e 断的是"那一个元素"上的 `data-current`
          const own = block.findAll('[data-value]').filter((el) => el.text() === String(place))
          expect(own.length, 'place "' + String(place) + '" has no element of its own').toBeGreaterThan(0)
        }
      }
    }
  })

  it('16 a plain list keeps every field of every item', () => {
    const path = pathOfFormat('list')
    const items = at(state, path) as Array<Record<string, unknown>>
    expect(Array.isArray(items), 'the list block does not read a list').toBe(true)
    expect(items.length, 'the opening list is empty').toBeGreaterThan(0)
    const w = panel()
    const block = w.find('[data-block="' + path + '"]')
    expect(block.findAll('[data-entry]')).toHaveLength(items.length)
    const text = block.text()
    for (const item of items) {
      for (const value of Object.values(item)) {
        if (value === null || typeof value === 'object') continue
        expect(text, path + ' item field').toContain(String(value))
      }
    }
  })

  it('17 key-value draws one row per field of the branch', () => {
    const path = pathOfFormat('key-value')
    const branch = at(state, path) as Record<string, unknown>
    const fields = Object.keys(branch)
    expect(fields.length, 'the key-value block reads an empty branch').toBeGreaterThan(0)
    const w = panel()
    const block = w.find('[data-block="' + path + '"]')
    expect(block.findAll('[data-field]')).toHaveLength(fields.length)
    const text = block.text()
    for (const [key, value] of Object.entries(branch)) {
      expect(text, path + ' field name').toContain(key)
      if (value === null || typeof value === 'object') continue
      expect(text, path + ' field value').toContain(String(value))
    }
  })

  it('18 the current whereabouts are marked by value, and only those', () => {
    const leadName = at(state, LEAD_NAME_PATH) as string
    const row = at(state, WHERE_PATH + '.' + leadName) as Record<string, unknown>
    expect(row, 'the opening frame cannot say where the lead is').toBeDefined()
    const mine = Object.values(row).filter((value) => typeof value === 'string' && value !== '') as string[]
    expect(mine.length, 'the lead whereabouts are empty').toBeGreaterThan(0)

    const block = panel().find('[data-block="world.map"]')
    const marked = block.findAll('[data-current]')
    expect(marked.length, 'nothing is marked as the current whereabouts').toBeGreaterThan(0)
    // ① 标出来的每一条都在说主控那个位置
    for (const el of marked) {
      expect(
        mine.some((value) => el.text().includes(value)),
        'marked but not the lead: ' + el.text(),
      ).toBe(true)
    }
    // ② 区域一条、地点一条：那一个元素的文本**就是**那个值（e2e 断的正是这一条）
    const exact = marked.filter((el) => mine.includes(el.text().trim()))
    expect(exact.length, 'no single entry is exactly one of the lead whereabouts').toBeGreaterThan(0)
    // ③ 别人待的地方不许被标出来（反面）—— 比的是**元素文本本身**：
    //    组那一层的文本里含得下它底下的地点，那是结构，不是"标错了"
    const others = Object.entries(at(state, WHERE_PATH) as Record<string, Record<string, unknown>>).filter(
      ([name]) => name !== leadName,
    )
    expect(others.length, 'nobody else is in the whereabouts book').toBeGreaterThan(0)
    for (const [, other] of others) {
      for (const value of Object.values(other)) {
        if (typeof value !== 'string' || value === '' || mine.includes(value)) continue
        for (const el of marked) {
          expect(el.text().trim(), 'another character whereabouts was marked: ' + value).not.toBe(value)
        }
      }
    }
    // ④ 没被标的条目里也不许出现主控的位置（值相等是唯一的判据）
    const unmarked = block.findAll('[data-entry]').filter((el) => el.attributes('data-current') === undefined)
    for (const el of unmarked) {
      for (const value of mine) {
        expect(el.text(), 'an entry shows the lead whereabouts but is not marked').not.toContain(value)
      }
    }
  })

  it('19 an empty column and an empty branch: no blocks drawn, nothing throws', () => {
    // 一栏手里 0 块（票 68：`long-night` 的空表、或某一边本来就没有块）—— 一句提示，不抛
    const none = mount(WorldPanel, { props: { side: 'left', blocks: [], state } })
    expect(none.findAll('[data-block]')).toHaveLength(0)
    expect(
      none.find('[data-side-empty]').exists(),
      'an empty column must say so instead of drawing nothing at all',
    ).toBe(true)
    // 一枝是合法的空（空字典）：那一块照画（标题在），里面一条都没有
    const bare = JSON.parse(JSON.stringify(state)) as StateTree
    ;(bare.world as Record<string, unknown>).map = {}
    const block = panel(bare).find('[data-block="world.map"]')
    expect(block.exists(), 'an empty branch took its whole block away').toBe(true)
    expect(block.findAll('[data-entry]')).toHaveLength(0)
  })
})

describe('a preset format draws a shape, not a branch name', () => {
  it('20 a branch the engine never heard of is drawn with zero engine changes (R12)', () => {
    // 卡自己长出一枝、自己点名它 —— 引擎那一侧一个字都不改
    const fresh = grown(
      {
        weather: {
          type: 'object',
          initial: { sky: 'clear', wind: 'light' },
          fields: { sky: 'string', wind: 'string' },
        },
      },
      [{ path: 'world.weather', title: 'the weather', format: 'key-value', side: 'left' }],
    )
    const blocks = worldBlocks(displayOf(fresh))
    expect(
      blocks.map((block) => block.name),
      'the new branch is not one block',
    ).toEqual(['world.weather'])
    const w = mount(WorldPanel, { props: { side: 'left', blocks, state: instantiate(fresh) } })
    const block = w.find('[data-block="world.weather"]')
    expect(block.exists(), 'a branch no engine table knows has no block of its own').toBe(true)
    const text = block.text()
    expect(text, 'the new branch shows no field name').toContain('sky')
    expect(text, 'the new branch shows no value').toContain('clear')
    expect(text, 'the new branch shows no other value').toContain('light')
  })

  it('21 two branches of the same shape but different names come out the same way (R13)', () => {
    const fields = { one: 'string', two: 'string' }
    const fresh = grown(
      {
        left: { type: 'object', initial: { one: 'l-one', two: 'l-two' }, fields: { ...fields } },
        right: { type: 'object', initial: { one: 'r-one', two: 'r-two' }, fields: { ...fields } },
      },
      [
        { path: 'world.left', title: 'left', format: 'key-value', side: 'left' },
        { path: 'world.right', title: 'right', format: 'key-value', side: 'right' },
      ],
    )
    const w = mount(WorldPanel, {
      props: { side: 'left', blocks: worldBlocks(displayOf(fresh)), state: instantiate(fresh) },
    })
    const left = w.find('[data-block="world.left"]')
    const right = w.find('[data-block="world.right"]')
    expect(left.exists() && right.exists(), 'the two branches did not both get a block').toBe(true)
    expect(left.text(), 'the left branch does not draw its own values').toContain('l-one')
    expect(right.text(), 'the right branch does not draw its own values').toContain('r-one')
    // 骨架（标签 + 属性名，值与文字都丢掉）一样 ⇒ 渲染器认的是**格式**，没有按枝名写的专用渲染器
    expect(skeletonOf(right), 'the two branches are not drawn by the same shape').toBe(skeletonOf(left))
  })
})

describe('the panel is a function of what it is handed', () => {
  it('22 it follows the state tree, not a frozen opening frame', () => {
    const moved = JSON.parse(JSON.stringify(state)) as StateTree
    const row = at(moved, WHERE_PATH + '.' + String(at(state, LEAD_NAME_PATH))) as Record<string, unknown>
    const fresh: string[] = []
    for (const [key, value] of Object.entries(row)) {
      if (typeof value !== 'string' || value === '') continue
      row[key] = 'moved-' + key
      fresh.push(String(row[key]))
    }
    expect(fresh.length, 'the lead whereabouts are empty').toBeGreaterThan(0)

    const marked = panel(moved).findAll('[data-current]')
    expect(marked.length, 'nothing is marked after the lead moved').toBeGreaterThan(0)
    const texts = marked.map((el) => el.text().trim())
    for (const value of fresh) {
      expect(
        texts.some((text) => text === value || text.includes(value)),
        'the panel still draws the opening whereabouts: ' + value,
      ).toBe(true)
    }
  })

  it('23 it draws the blocks it is handed, in that order (no order of its own)', () => {
    const reversed = [...world].reverse()
    const w = mount(WorldPanel, { props: { side: 'left', blocks: reversed, state } })
    expect(w.findAll('[data-block]').map((el) => el.attributes('data-block'))).toEqual(
      reversed.map((block) => block.name),
    )
  })
})
