/**
 * 显示声明的**每一种坏形状**都过一遍（`src/game/display.ts`）。
 *
 * 为什么单独一份：契约那 27 条判据点名的是**五种**坏声明（路径不在 / 格式不认识 / 形状不符 /
 * 同枝两遍 / 多一个键）与三种格式画成什么；校验器与取数器还有几条只有**别的坏形状**才走得到：
 * `scene` 本身不是对象 · 少一个键 · 指到一条不是册子的枝 · 主控名字那一格是容器 ·
 * 册子或那一条根本不在状态里。它们同样是 R14 的一部分：**画不出来的声明 ⇒ 载入即失败**，
 * 而「取不到」时必须是空、不是崩。
 *
 * ⚠️ 这一份**不替代**契约那两份（`display-format.test.ts` / `display-render-dom.test.ts`）：
 *    它只管**坏形状的覆盖面**，不复述格式画成什么样子。
 * ⚠️ `tests/` 里的字符串必须 ASCII（`.githooks/checks/ascii.mjs` 连测试一起拦）：
 *    最小夹具里那些路径本来就是 ASCII，直接拿来用。
 */
import { describe, expect, it } from 'vitest'
import { parseCard } from '../src/game/card'
import { atPath, displayOf, sceneValues, type DisplayDecl } from '../src/game/display'
import { instantiate, type StateTree } from '../src/game/card-state'
import { fixture } from './support/card-fixtures'

/** 最小夹具里那几处路径（夹具自己声明的枝，见 `support/card-fixtures.ts`） */
const MAP = 'world.map'
const OBJECT = 'world.location'
const BOOK = 'world.whoIsWhere'
const NAME = 'lead.name'

/** 载入被拒时的报错原文；收下了就是空串（判据自己读那句话，别只断"抛了"） */
function rejectionOf(card: Record<string, unknown>): string {
  try {
    parseCard(JSON.stringify(card))
    return ''
  } catch (err) {
    return String((err as Error).message)
  }
}

/** 只改一处显示声明的夹具 */
function withDisplay(display: Record<string, unknown>): Record<string, unknown> {
  const card = fixture() as Record<string, any>
  card.display = { ...card.display, ...display }
  return card
}

/** 一份状态树：册子里有一条，字段有标量、空串、数字与容器 */
function tree(): StateTree {
  return instantiate(parseCard(JSON.stringify(fixture())))
}

describe('a scene source that cannot be drawn is refused, with the place named', () => {
  it('1 refuses a scene source that is not an object at all', () => {
    expect(rejectionOf(withDisplay({ scene: 'nope' })), 'a scene source that is not an object').toContain(
      'display.scene',
    )
  })

  it('2 refuses a scene source with a key missing', () => {
    // `who` 少了 —— 名字那一格指不出来，那条场景行就没有来源
    expect(rejectionOf(withDisplay({ scene: { path: BOOK } })), 'a scene source without "who"').toContain(
      'who',
    )
    expect(rejectionOf(withDisplay({ scene: { who: NAME } })), 'a scene source without "path"').toContain(
      'path',
    )
  })

  it('3 refuses a scene source pointing at a branch the card does not declare', () => {
    const message = rejectionOf(withDisplay({ scene: { path: 'world.nowhere', who: NAME } }))
    expect(message, 'a scene source pointing nowhere was accepted').toContain('world.nowhere')
  })

  it('4 refuses a scene source whose book is not a map (one row per name)', () => {
    const message = rejectionOf(withDisplay({ scene: { path: OBJECT, who: NAME } }))
    expect(message, 'a scene source pointing at a non-map branch was accepted').toContain(OBJECT)
  })

  it('5 refuses a scene source whose name cell the card does not declare', () => {
    const message = rejectionOf(withDisplay({ scene: { path: BOOK, who: 'lead.nobody' } }))
    expect(message, 'a scene source reading an undeclared name cell was accepted').toContain('lead.nobody')
  })

  it('6 refuses a scene source whose name cell is a container (the scene line needs a name)', () => {
    const message = rejectionOf(withDisplay({ scene: { path: BOOK, who: MAP } }))
    expect(message, 'a container was accepted as the name cell').toContain(MAP)
  })
})

describe('a sidebar entry of the wrong shape is refused, with the place named', () => {
  it('7 refuses an entry that is not an object', () => {
    expect(
      rejectionOf(withDisplay({ sidebar: ['nope'] })),
      'a bare string was accepted as an entry',
    ).toContain('display.sidebar[0]')
  })

  it('8 refuses a sidebar that is not a list', () => {
    expect(rejectionOf(withDisplay({ sidebar: MAP })), 'a string was accepted as the sidebar').toContain(
      'display.sidebar',
    )
  })

  it('9 refuses an entry whose fields are the wrong type', () => {
    // 三个字段各来一次：缺一个键、写错类型 —— 报错都要点名那一处
    const base = { path: MAP, title: 'the map', format: 'grouped' }
    expect(rejectionOf(withDisplay({ sidebar: [{ path: MAP, format: 'grouped' }] }))).toContain('title')
    expect(rejectionOf(withDisplay({ sidebar: [{ ...base, format: 7 }] }))).toContain('format')
    expect(rejectionOf(withDisplay({ sidebar: [{ ...base, path: 7 }] }))).toContain('path')
  })
})

describe('the readers answer with empty, never with a crash', () => {
  it('10 a path that runs off the tree is undefined, wherever it breaks', () => {
    const state = tree()
    expect(atPath(state, MAP), 'a branch the tree has').toBeDefined()
    expect(atPath(state, 'world.nowhere'), 'the first segment is missing').toBeUndefined()
    expect(atPath(state, MAP + '.nowhere'), 'a later segment is missing').toBeUndefined()
    expect(atPath(state, NAME + '.deeper'), 'a scalar has no branches under it').toBeUndefined()
  })

  it('11 the scene values are empty when the source, the book or the row is not there', () => {
    const state = tree()
    const decl = (scene?: DisplayDecl['scene']): DisplayDecl => ({ sidebar: [], ...(scene ? { scene } : {}) })

    // 卡没声明场景来源 ⇒ 空
    expect(sceneValues(decl(), state), 'a card without a scene source').toEqual([])
    // 册子不在状态里 ⇒ 空
    expect(sceneValues(decl({ path: 'world.nowhere', who: NAME }), state)).toEqual([])
    // 名字那一格不在状态里 ⇒ 空
    expect(sceneValues(decl({ path: BOOK, who: 'lead.nobody' }), state)).toEqual([])
    // 册子里没有主控那一条 ⇒ 空（新开局、名字还没写进册子时就是这样）
    expect(sceneValues(decl({ path: BOOK, who: NAME }), state)).toEqual([])
  })

  it('12 the scene values are the row string fields, in the card field order, non-empty only', () => {
    const state = tree() as Record<string, any>
    // ⚠️ 写进去的是册子在 `world` 那一枝里的**键**，不是整条路径
    state.world[BOOK.split('.')[1]] = {
      nobody: { area: 'a', spot: '', count: 3, scene: 'c', nested: { x: 'y' } },
    }
    const values = sceneValues({ sidebar: [], scene: { path: BOOK, who: NAME } }, state)
    expect(values, 'only the non-empty strings of that row, in field order').toEqual(['a', 'c'])
  })

  it('13 displayOf hands out copies in the declared order', () => {
    const card = parseCard(JSON.stringify(fixture()))
    const decl = displayOf(card)
    expect(decl.sidebar.map((entry) => entry.path)).toEqual(card.display.sidebar.map((entry) => entry.path))
    expect(decl.scene, 'the fixture declares a scene source').toEqual(card.display.scene)

    // 改副本不许动到卡自己（调用方拿到的是一份声明，不是卡的那两个对象）
    decl.sidebar[0].title = 'changed'
    if (decl.scene) decl.scene.who = 'changed'
    expect(card.display.sidebar[0].title, 'the card was mutated through the copy').not.toBe('changed')
    expect(card.display.scene?.who, 'the card was mutated through the copy').not.toBe('changed')
  })

  it('14 both cards load with their own declarations (nothing here is specific to one card)', () => {
    // 夹具没有 scene 时也载入（`scene` 是可选的）—— 取数器照样给空
    const withoutScene = fixture() as Record<string, any>
    delete withoutScene.display.scene
    const loaded = parseCard(JSON.stringify(withoutScene))
    expect(Object.hasOwn(displayOf(loaded), 'scene')).toBe(false)
    expect(sceneValues(displayOf(loaded), instantiate(loaded))).toEqual([])
  })
})
