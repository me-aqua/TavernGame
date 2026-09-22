/**
 * 票 66 · 段 7b：**一枝一个维护器**（R51）—— 结构校验 + 三张卡的维护器覆盖。
 *
 * 契约 `.team/test/2026-09-20/contract-66.md`；S0 `.team/leader/2026-09-20/段7b-S0.md`；
 * 裁决 R51 `.team/leader/2026-09-18/2026-09-18-显示面板裁决.md:1176-1209`。
 *
 * 这一份管两件事：
 *   1. **校验器**（判据 M2 / M4 / M5 / M6）：两条动作声明同一个 `path` ⇒ 拒；
 *      某个 state 枝没人维护 ⇒ 拒。夹具上做反例，每个反例只改一处。
 *   2. **三张卡**（判据 M7–M11）：每一枝都有维护器（**不留任何"某卡豁免"的例外**）、
 *      每条动作都有节点点名、新补的维护器在**主提示词**里点了名。
 *
 * ⚠️ **粒度 = `action.path` 精确相等，不是顶层键**（S0 §二 第 1 条）：`world` 那一枝被两条动作写
 *    （`add_place` → `world.map`、`set_whereabouts` → `world.谁在哪`），按顶层键算就是"一枝两个维护器"，
 *    **那是错的**。判据 M3 就是这一条的现场。
 *
 * ⚠️ **引擎效果写的枝不算"没人维护"**（S0 §二 第 2 条）：`advance_time`（`effect: "time"`）
 *    真的会写 `world.time` ⇒ 不排除它，三张卡都会因为 `world` 被误报。判据 M5 钉这一处。
 *
 * ⚠️ **中文一律来自卡或夹具**（`.githooks/checks/ascii.mjs` 连 `tests/` 里的字面量一起拦）：
 *    这一份里一个节点名、一个动作名、一句提示词都不写死，全部从卡现取。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, type Action, type CardData } from '../src/game/card'
import { minimalCard } from './support/card-fixtures'
import { CARDS } from './support/generator-moves'

const cardPath = (name: string): string => 'cards/' + name + '.json'

function load(name: string): CardData {
  return parseCard(readFileSync(cardPath(name), 'utf8'))
}

/**
 * 三张卡**按需**载入。
 *
 * ⚠️ 不在收集阶段读盘：卡一旦过不了校验，模块级那一次 `load()` 会让**整份文件载入即抛**，
 *    一条用例都跑不到 —— 那种红只证到"文件会红"，证不了"判据抓到了它"（工序 §S1 点名过）。
 */
const CACHE = new Map<string, CardData>()

function cardOf(name: string): CardData {
  const hit = CACHE.get(name)
  if (hit !== undefined) return hit
  const card = load(name)
  CACHE.set(name, card)
  return card
}

/** 三张卡逐张取一次，顺序 = 锚点表里的卡序 */
const realCards = (): Array<{ name: string; card: CardData }> =>
  CARDS.map((name) => ({ name, card: cardOf(name) }))

/** 夹具的一份可变副本（反例都在它上面改**一处**） */
function fixture(): any {
  return JSON.parse(JSON.stringify(minimalCard()))
}

/**
 * 删掉若干动作**连同节点白名单里的名字**。
 *
 * ⚠️ 只删动作不删白名单，`checkGraph` 的 `checkTools` 会先报"这个工具没声明"——
 *    红是红了，**红的不是被演的那一处**（那条读数会把人带偏）。
 */
function dropActions(card: any, keep: (action: any) => boolean): void {
  const kept: Record<string, unknown> = {}
  for (const [name, action] of Object.entries(card.actions)) {
    if (keep(action)) kept[name] = action
  }
  card.actions = kept
  for (const node of Object.values(card.graph.nodes) as any[]) {
    if (node.tools !== undefined) node.tools = node.tools.filter((name: string) => name in kept)
  }
}

/**
 * 跑一次校验，把抛出的错误读成文本（通过了就返回空串）。
 *
 * ⚠️ 走 `parseCard` 而不是读 `CardData`：这里问的是"**校验器认不认**这个形状"。
 */
function errorOf(card: unknown): string {
  try {
    parseCard(JSON.stringify(card))
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** 一条动作写到哪：path 型的枝（顶层键）或是哪种引擎效果（没有 path 就没有枝） */
function branchOf(action: Action): string | undefined {
  return action.path === undefined ? undefined : action.path.split('.')[0]
}

/**
 * 引擎效果**写进状态**的那一枝 —— 今天只有 `effect: "time"` 写 `state.world.time`。
 *
 * ⚠️ `effect: "redo"` **什么都不写** ⇒ 它不在这儿（它由回合循环回滚重跑，不落状态）。
 * ⚠️ 这一份是**判据自己的**算法（不是从实现里导出来的）：两边界说各写一遍，
 *    实现写错了判据才抓得到。位置的唯一事实来源是 `src/game/card-time.ts` 的
 *    `CLOCK_STATE_PATH`（`'world.time'`）。
 */
const EFFECT_BRANCH: Record<string, string> = { time: 'world' }

/** 一支的维护器：写它的动作名（按卡里的声明顺序），引擎效果写的枝也算在内 */
function maintainersOf(card: CardData, branch: string): string[] {
  const names = Object.entries(card.actions)
    .filter(([, action]) => branchOf(action) === branch)
    .map(([name]) => name)
  for (const [name, action] of Object.entries(card.actions)) {
    if (action.effect !== undefined && EFFECT_BRANCH[action.effect] === branch) names.push(name)
  }
  return names
}

/** 点名叫了这条动作的节点（拓扑顺序） */
function callersOf(card: CardData, action: string): string[] {
  return card.graph.topology.filter((id) => (card.graph.nodes[id].tools ?? []).includes(action))
}

describe('the validator: one path, one maintainer', () => {
  it('M1 the untouched fixture still parses (the negative control for every case below)', () => {
    expect(errorOf(fixture()), 'the fixture must be a valid card').toBe('')
  })

  it('M2 two actions that declare the same path are refused, and the failure names it', () => {
    const card = fixture()
    // 挑两条**各自维护一枝**的动作（名字从夹具现取，不写死）
    const [first, second] = Object.keys(card.actions)
    expect(branchOf(card.actions[first]), first + ' must be a path action').toBeDefined()
    card.actions[second].path = card.actions[first].path
    delete card.actions[second].effect

    const message = errorOf(card)
    expect(message, 'two actions on one path must be refused').not.toBe('')
    expect(message, 'the failure must name the path').toContain(card.actions[first].path)
    expect(message, 'the failure must name the first action').toContain(first)
    expect(message, 'the failure must name the second action').toContain(second)
  })

  it('M3 two paths inside one branch are fine (the granularity is the path, not the branch)', () => {
    const card = fixture()
    // 前置断言：这一段只有在夹具真的"一枝两 path"时才说明问题（否则它是一条恒真的守卫）
    const doubled = Object.keys(card.state).filter(
      (branch) =>
        Object.values(card.actions).filter((action) => branchOf(action as Action) === branch).length > 1,
    )
    expect(doubled.length, 'the fixture must have a branch with two paths').toBeGreaterThan(0)

    expect(errorOf(card), 'two paths of one branch must stay legal').toBe('')
  })

  it('M4 a state branch that no action writes is refused, and the failure names the branch', () => {
    const card = fixture()
    const roles = Object.keys(card.actions).filter(
      (name) => branchOf(card.actions[name]) === 'roles',
    ) as string[]
    expect(roles, 'the fixture must have exactly one maintainer for roles').toHaveLength(1)
    dropActions(card, (action) => branchOf(action) !== 'roles')

    const message = errorOf(card)
    expect(message, 'a branch with no maintainer must be refused').not.toBe('')
    expect(message, 'the failure must name the branch').toContain('roles')
  })

  it('M5 a branch the engine effect writes is not "unmaintained"', () => {
    const card = fixture()
    // 把写 `world` 的那两条动作全删掉 ⇒ `world` 只剩引擎的 advance_time（effect: time）在写它。
    // ⚠️ 这一条**只断言"整张卡还过"**：校验器遇到第一个坏枝就抛，把 roles 也弄坏的话
    //    报出来的是 roles，`world` 根本轮不到 —— 那条读数就测不出"引擎效果算不算维护器"了
    //    （第一版这么写过，故障注入 `f-effect-not-keeper` 当场照出它没有牙）。
    dropActions(card, (action) => branchOf(action) !== 'world')
    const dead = Object.keys(card.state).filter((branch) => maintainersOf(card, branch).length === 0)
    expect(dead, 'world must be kept by the effect alone here').toEqual([])
    expect(errorOf(card), 'effect "time" keeps world alive - the card must still pass').toBe('')
  })

  it('M6 an effect action is not a maintainer: redo writes nothing', () => {
    const card = fixture()
    const roles = Object.keys(card.actions).filter(
      (name) => branchOf(card.actions[name]) === 'roles',
    ) as string[]
    // 把那条动作**改成** effect: redo —— 名字还在、动作还在，但它什么都不写了
    card.actions[roles[0]] = {
      whenToUse: card.actions[roles[0]].whenToUse,
      what: card.actions[roles[0]].what,
      principles: card.actions[roles[0]].principles,
      effect: 'redo',
    }

    const message = errorOf(card)
    expect(message, 'redo must not count as a maintainer').not.toBe('')
    expect(message).toContain('roles')
  })
})

describe('the three cards: every branch has a maintainer', () => {
  it('M7 all three cards load through parseCard', () => {
    for (const { name, card } of realCards()) {
      expect(card, name).toBeDefined()
    }
  })

  it('M8 every branch of every card is written by something (reported per card)', () => {
    const report: string[] = []
    for (const { name, card } of realCards()) {
      for (const branch of Object.keys(card.state)) {
        const keepers = maintainersOf(card, branch)
        report.push(name + '.' + branch + ' <- ' + (keepers.join('+') || 'NOBODY'))
        expect(keepers.length, JSON.stringify(report)).toBeGreaterThan(0)
      }
    }
  })

  it('M9 every card keeps one maintainer per path (the path, not the branch)', () => {
    for (const { name, card } of realCards()) {
      const seen = new Map<string, string>()
      for (const [action, entry] of Object.entries(card.actions)) {
        if (entry.path === undefined) continue
        const owner = seen.get(entry.path)
        expect(owner, name + ': ' + entry.path + ' is kept by both ' + owner + ' and ' + action).toBe(
          undefined,
        )
        seen.set(entry.path, action)
      }
    }
  })

  it('M10 no card carries a dead action: every action is named by some node', () => {
    for (const { name, card } of realCards()) {
      for (const action of Object.keys(card.actions)) {
        expect(callersOf(card, action).length, name + '.' + action + ' has no caller').toBeGreaterThan(0)
      }
    }
  })

  it('M11 the new maintainers are reachable, and the step that owns them says so in its prompt', () => {
    // 「主控」那一枝是 R51 点名的那个洞；长夜号的「玩家画像」那一枝同样没人写。
    // 两条要求：① 维护它的那条动作**被某个节点点名**（否则运行期还是调不动 —— write_log 就是现场）；
    //          ② **点名它的那个节点，主提示词里出现这条动作的名字** —— 职责扩一句的机器口径。
    //             ⚠️ 钉在主提示词而不是 `duty` 上：`duty` **从来不进请求体**（票 65 量过），
    //                只改 duty 等于模型永远不知道这一步多了个工具。
    const targets = [
      { card: 'morningwind', branch: 'lead' },
      { card: 'long-night', branch: 'lead' },
      { card: 'long-night', branch: 'player' },
      { card: 'night-watch', branch: 'lead' },
    ]
    const report: string[] = []
    for (const { card: name, branch } of targets) {
      const card = cardOf(name)
      const keepers = maintainersOf(card, branch).filter((action) => callersOf(card, action).length > 0)
      report.push(name + '.' + branch + ' <- ' + (keepers.join('+') || 'NO REACHABLE KEEPER'))
      expect(keepers.length, JSON.stringify(report)).toBeGreaterThan(0)
      for (const action of keepers) {
        const named = callersOf(card, action).some((node) =>
          card.graph.nodes[node].prompt.join('\n').includes(action),
        )
        expect(named, name + ': some node must name ' + action + ' in its main prompt').toBe(true)
      }
    }
  })
})
