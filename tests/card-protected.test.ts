/**
 * 票「给受保护容器补一档」（调研第 3 条）· S2 判据 —— **本文件是先红的**（功能还没做）。
 *
 * 契约 `.team/test/2026-10-09/contract-protected.md`；S1 `.team/leader/2026-10-09/S1-定形-受保护容器.md`。
 *
 * 被测的那件事只有一句：**状态树上被声明成"受保护"的那一格，只要它是容器
 * （object / map / list），就不许被 `set` 整体替换**（`card-actions.ts:373` 那句"顶层整体替换"）；
 * `merge` / `push` 与**没声明**的枝逐字照旧。
 *
 * 🔴 **只有静态层那一层**（组长 2026-10-09 裁定 ②）：拒绝发生在**卡格式校验**里
 * （`validateCard` / `parseCard` 抛错），`runAction` 里**一个字都不加** ——
 * 理由：静态层更强（校验期就拦）· 应用加载路径走不到运行层（`current-card.ts:36/43` 的卡都过了校验）·
 * 而且 `src/game/card-actions.ts` 那一阵子是另一张票的地盘（少碰它是纯赚）。
 * ⚠️ **代价**（`P13` 拿一条用例钉着，别让下一个以为"静态层全覆盖了"）：**静态层拦不住
 * "绕过校验直接调引擎"的那条路** —— 今天没有那条路，将来可能有。
 *
 * ⚠️ 本文件是**黑盒**的：一条都不 import 实现里那个判据函数 —— 只断
 *    `validateCard` 抛什么（静态层）、`runAction` 回什么（"照旧"那一档）。
 * ⚠️ 全 ASCII（`.githooks/checks/ascii.mjs` 连 `tests/` 里的字面量一起拦）⇒
 *    真卡里的中文键名一律**从卡里现取**，不在这里抄。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, validateCard } from '../src/game/card'
import { runAction } from '../src/game/card-actions'
import { instantiate, schemaAt, schemaType } from '../src/game/card-state'
import { EXAMPLE_CARD, LONG_NIGHT_CARD, NIGHT_WATCH_CARD, minimalCard } from './support/card-fixtures'

/** 跑一段代码，把抛出的错误读成文本（没抛就返回空串）—— 与 `card-schema-6.test.ts` 同一把尺 */
function errorOf(run: () => unknown): string {
  try {
    run()
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** 夹具副本上的那一格 schema（`world.location` → `state.world.fields.location`） */
function nodeAt(card: any, path: string): any {
  const segments = path.split('.')
  let node = card.state[segments[0]]
  for (const segment of segments.slice(1)) node = node.fields[segment]
  return node
}

/** 把那一格声明成受保护（其余一个字节不动） */
function markProtected(card: any, path: string): any {
  nodeAt(card, path).protected = true
  return card
}

/** 一份夹具的副本，其中一格已声明受保护 */
function protectedFixture(path: string): any {
  return markProtected(minimalCard(), path)
}

/** 某一格 schema 的类型（路径不在卡里就当场报 —— 判据不许在"什么都没读到"时也绿） */
function typeAt(card: any, path: string): string {
  const node = schemaAt(card.state, path)
  if (node === undefined) throw new Error('no such path in this card: ' + path)
  return schemaType(node)
}

/** 一个动作跑完之后读了什么（"照旧"那一档都从它出发） */
function run(card: any, name: string, args: unknown): { outcome: any; state: any; before: string } {
  const state = instantiate(card)
  const before = JSON.stringify(state)
  const outcome = runAction(card, state, name, args)
  return { outcome, state, before }
}

/** 三张真卡的路径（`cards/**` 是唯一的事实来源，这里只引路径） */
const REAL_CARDS = [EXAMPLE_CARD, LONG_NIGHT_CARD, NIGHT_WATCH_CARD]

describe('P1-P3: the declaration itself', () => {
  it('P1 accepts protected on each of the three container shapes', () => {
    // 反面控制：没声明的夹具本来就必须过（不然下面三条红了也说不清是谁的错）
    expect(
      errorOf(() => validateCard(minimalCard())),
      'the plain fixture must load',
    ).toBe('')
    for (const path of ['lead.now', 'roles', 'lead.pack']) {
      const card = protectedFixture(path)
      expect(nodeAt(card, path).protected, path + ' was not marked').toBe(true)
      expect(
        errorOf(() => validateCard(card)),
        path + ' (a container) must be allowed to be protected',
      ).toBe('')
    }
  })

  it('P2 refuses protected on a scalar node, at that path', () => {
    const card = protectedFixture('player.profile')
    expect(typeAt(card, 'player.profile')).toBe('string')
    const problem = errorOf(() => validateCard(card))
    // ⚠️ 报错里的路径是**卡里的 JSON 路径**（`state.<枝>.fields.<字段>`，`card.ts` 的老规矩），
    //    不是我这张量具用的点号路径 —— 第一版断错了这一处，是**判据错**、不是实现错。
    // ⚠️⚠️ 更要紧的是**必须断"理由"那一半**：只断路径的话，功能没做时那句
    //    `state.player.fields.profile.protected: unknown key` 里**恰好也有这个路径**
    //    ⇒ 判据会**为错误的理由变绿**（实测踩过：全量里这两条绿、单跑却红）。
    expect(problem, 'a scalar must not be protected').toContain('state.player.fields.profile.protected')
    expect(problem, 'and it must say why (not "unknown key")').toContain('only a container')
  })

  it('P3 refuses a value that is not true (false is a sentence that says nothing)', () => {
    for (const value of [false, 'yes', 1]) {
      const card = markProtected(minimalCard(), 'lead.now')
      nodeAt(card, 'lead.now').protected = value
      const problem = errorOf(() => validateCard(card))
      expect(problem, JSON.stringify(value) + ' must be refused').toContain('state.lead.fields.now.protected')
      // 同上：断"理由"，不然 `unknown key` 那句会让这一条假绿
      expect(problem, JSON.stringify(value) + ' must be refused for the right reason').toContain(
        'must be true',
      )
    }
  })
})

describe('P4-P8: the card format is the only gate (the static layer)', () => {
  it('P4 refuses the card when an action sets a protected object', () => {
    const card = protectedFixture('world.location')
    expect(typeAt(card, 'world.location')).toBe('object')
    const problem = errorOf(() => validateCard(card))
    expect(problem, 'set on a protected object').toContain('actions.set_place.path')
    expect(problem, 'and it must name the protected path').toContain('world.location')
  })

  it('P5 refuses a set on a protected map, but still allows one whose entry is a scalar', () => {
    const onMap = protectedFixture('roles')
    onMap.actions.add_role.mode = 'set'
    expect(typeAt(onMap, 'roles')).toBe('map')
    expect(
      errorOf(() => validateCard(onMap)),
      'set on a protected map',
    ).toContain('actions.add_role.path')

    // 反面：受保护的 map 里**条目是标量**时，`set` 写的就是那一条字面量 ⇒ 照旧放行
    const scalarMap = protectedFixture('world.whoIsWhere')
    expect(typeAt(scalarMap, 'world.whoIsWhere')).toBe('map')
    expect(
      errorOf(() => validateCard(scalarMap)),
      'a scalar entry is the field-by-field write itself',
    ).toBe('')
  })

  it('P6 refuses a set on a protected list, but still allows a push onto it', () => {
    const replacing = protectedFixture('lead.pack')
    replacing.actions.grow.mode = 'set'
    expect(typeAt(replacing, 'lead.pack')).toBe('list')
    expect(
      errorOf(() => validateCard(replacing)),
      'set on a protected list',
    ).toContain('actions.grow.path')

    // push 只有追加一条路（`card-actions.ts` 里全库没有清空路径）⇒ 它不受这一档管辖
    const pushing = protectedFixture('lead.pack')
    expect(
      errorOf(() => validateCard(pushing)),
      'push only ever appends',
    ).toBe('')
  })

  it('P7 still accepts a set whose write target is a scalar inside a protected branch', () => {
    const card = protectedFixture('player')
    expect(typeAt(card, 'player.profile')).toBe('string')
    expect(
      errorOf(() => validateCard(card)),
      'a scalar write is the field-by-field write itself',
    ).toBe('')
  })

  it('P8 still accepts a merge into a protected container', () => {
    expect(
      errorOf(() => validateCard(protectedFixture('lead.now'))),
      'merge into a protected object',
    ).toBe('')
    // 逐字段写那条路真的开着：把 `set_place` 改成 merge，同一张受保护的卡就合法了
    const merged = protectedFixture('world.location')
    merged.actions.set_place.mode = 'merge'
    expect(
      errorOf(() => validateCard(merged)),
      'merge into a protected object, on the same card',
    ).toBe('')
  })
})

describe('P9-P11: the engine layer did not move (runtime, byte for byte)', () => {
  it('P9 writes a whole object exactly as it did before this ticket', () => {
    const card = minimalCard()
    const { outcome, state } = run(card, 'set_place', { area: 'x', spot: 'y', scene: 'z' })
    expect(outcome).toEqual({
      ok: true,
      kind: 'state',
      result: 'wrote world.location = {"area":"x","spot":"y","scene":"z"}',
      change: { path: 'world.location', value: { area: 'x', spot: 'y', scene: 'z' } },
    })
    expect(state.world.location).toEqual({ area: 'x', spot: 'y', scene: 'z' })
  })

  it('P10 runs every write a protected card is still allowed to declare', () => {
    // 受保护的枝上允许的那几样，跑起来的读数与没声明时逐字相同
    const merged = run(protectedFixture('lead.now'), 'move_lead', { mood: 'calm' })
    expect(merged.outcome).toEqual({
      ok: true,
      kind: 'state',
      result: 'merged lead.now = {"mood":"calm"}',
      change: { path: 'lead.now', value: { mood: 'calm' } },
    })
    expect(merged.state.lead.now).toEqual({ mood: 'calm' })

    const pushed = run(protectedFixture('lead.pack'), 'grow', { value: 'lamp' })
    expect(pushed.outcome.ok, JSON.stringify(pushed.outcome)).toBe(true)
    expect(pushed.state.lead.pack).toEqual(['rope', 'lamp'])

    const scalar = run(protectedFixture('world'), 'set_where', { who: 'Salen', value: 'the forge' })
    expect(scalar.outcome.ok, JSON.stringify(scalar.outcome)).toBe(true)
    expect(scalar.state.world.whoIsWhere).toEqual({ Salen: 'the forge' })
  })

  it('P11 no card in the repo declares a set on an object, and all three still load', () => {
    let pathActions = 0
    let setActions = 0
    for (const file of REAL_CARDS) {
      const card = parseCard(readFileSync(file, 'utf8'))
      for (const [name, action] of Object.entries(card.actions)) {
        if (action.path === undefined) continue
        pathActions += 1
        const mode = action.mode ?? 'set'
        if (mode !== 'set') continue
        setActions += 1
        expect(
          typeAt(card, action.path),
          file + '.' + name + ' sets a whole object at ' + action.path,
        ).not.toBe('object')
      }
    }
    // 夹具自检：真的数到了东西（不然这条判据在"一张卡都没读到"时也绿）
    expect(pathActions, 'no path action was read at all').toBeGreaterThan(0)
    expect(setActions, 'no set action was read at all').toBeGreaterThan(0)
  })
})

describe('P12-P14: the reverse controls, the boundary, and the fixture itself', () => {
  it('P12 flips one key: protected turns the same card from allowed into refused', () => {
    const open = minimalCard()
    expect(
      errorOf(() => validateCard(open)),
      'without the declaration',
    ).toBe('')
    const closed = protectedFixture('world.location')
    // ⚠️ **不许只写 `not.toBe('')`**：功能没做时那句 `unknown key` 也满足它 ⇒ 判据会为错误的理由变绿
    //    （`P2`/`P3` 就是这么假绿过一次的 —— 同族的第三处，这次是**单跑读数**把它逼出来的）
    const problem = errorOf(() => validateCard(closed))
    expect(problem, 'with the declaration').toContain('actions.set_place.path')
    expect(problem, 'and for the right reason').toContain('is protected')
    // 两面对撞的另一半：同一张卡把声明去掉，同一条 set 动作又要放行
    const again = protectedFixture('world.location')
    delete nodeAt(again, 'world.location').protected
    expect(
      errorOf(() => validateCard(again)),
      'declaration removed again',
    ).toBe('')
  })

  it('P13 the boundary: runAction is NOT a second gate (this is the price of the ruling)', () => {
    // 🔴 已知边界，不是待修的洞：拒绝只发生在**卡格式校验**那一层。
    //    今天没有"绕过校验直接调引擎"的那条路（`current-card.ts:36/43` 的卡都过了校验），
    //    但将来可能有 ⇒ 这条判据把边界钉住：**将来谁补上运行层，就会看见它红**，
    //    那时要连契约 §4.2 一起改（别让下一个以为"静态层全覆盖了"）。
    const bypassing = protectedFixture('world.location')
    const { outcome, state } = run(bypassing, 'set_place', { area: 'x', spot: 'y', scene: 'z' })
    expect(outcome.ok, 'a card that never went through validateCard is not stopped at runtime').toBe(true)
    expect(state.world.location).toEqual({ area: 'x', spot: 'y', scene: 'z' })
  })

  it('P14 the fixture self-check: the declared path is really the one under test', () => {
    const card = protectedFixture('world.location')
    expect(nodeAt(card, 'world.location').protected).toBe(true)
    expect(nodeAt(card, 'world.location').type).toBe('object')
    // 没被点名的邻格必须还是干净的（别让"整张卡都受保护"也算过）
    expect(nodeAt(card, 'world.map').protected).toBeUndefined()
    expect(nodeAt(card, 'lead.now').protected).toBeUndefined()
  })
})
