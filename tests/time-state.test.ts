/**
 * 票 62 · 段 5：**时间搬进世界状态**（裁决 R39）。
 *
 * 契约 `.team/test/2026-09-19/contract-62.md`；S0 在 `.team/leader/2026-09-19/段5-S0.md`。
 *
 * 这一段把"这一局现在是几点"从**引擎私有的一个字段**（`GameData` 顶层的 `time`）搬进
 * **卡的 state 树**（`world.time`）—— 于是它跟着存档、跟着 `redo` 的部分回滚、跟着事务提交，
 * 与地点、背包那些状态一视同仁（这正是 R39 要的收益）。
 *
 * ⚠️ 时钟那一段的路径是**引擎点名的**（与 `world.map` / `lead.pack` 同类：引擎要按它取时刻、
 *    推进时刻、给界面念时刻）⇒ 键名与路径由引擎定，不由作者改（段 3 的判据 8 守同一件事）。
 * ⚠️ 全 ASCII：`.githooks/checks/ascii.mjs` 连 `tests/` 里的字符串字面量一起拦 ⇒
 *    断言消息一律英文；卡里的中文一律从卡现取，不写进这个文件。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCard, type CardData } from '../src/game/card'
import { advance, checkTime, format, type TimeValue } from '../src/game/card-calendar'
import { createInitialState, isRecord, normalize } from '../src/game/save'
import { runTurn, type AgentEvent } from '../src/agent/agent'
import { currentCard } from '../src/game/current-card'
import * as cardTime from '../src/game/card-time'
import { useGame } from '../src/stores/game'
import longNight from '../cards/long-night.json'
import morningwind from '../cards/morningwind.json'
import nightWatch from '../cards/night-watch.json'
import { EXAMPLE_CARD, LONG_NIGHT_CARD, NIGHT_WATCH_CARD } from './support/card-fixtures'
import {
  advanceTimeCall,
  cardPassReplies,
  cardTurnReplies,
  CARD_TOPOLOGY,
  redoCall,
  storyNodeOf,
  timeNodeOf,
} from './support/card-replies'
import { configureFakeProvider, createAgentContext } from './support/game-fixtures'
import { installFakeLlm, type FakeLlm, type FakeReply } from './support/fakeLlm'

/* ---- 测试自己编的 fixture（模型回复与玩家行动），不是产品文案 ---- */
const PLAYER_ACTION = 'I wait by the fire'
const STORY_TEXT = 'The embers settle.'
const SECOND_STORY = 'The fire is out.'
const TIME_MINUTES = 90
const TIME_REASON = 'kept watch'
const REDO_WHY = 'the clock reads wrong'

/** 时钟所在的那一枝与那一格 —— 引擎点名的路径（见文件头） */
const WORLD = 'world'
const CLOCK = 'time'
const CLOCK_PATH = WORLD + '.' + CLOCK

/** 时刻的五个部分（卡声明的形状：五个整数，不是字符串、不是时间戳） */
const CLOCK_PARTS = ['year', 'month', 'day', 'hour', 'minute']

/** 这一票的探针动作名 —— 测试自己编的名字，不是卡里那个 */
const PROBE_ACTION = 'probe_set_clock'

/** 一份时刻的字段表（探针卡自己拼时钟那一段时用） */
const CLOCK_FIELDS: Record<string, string> = {
  year: 'integer',
  month: 'integer',
  day: 'integer',
  hour: 'integer',
  minute: 'integer',
}

/**
 * 三张卡的**原始 JSON** —— 走 **JSON 模块**而不是 `readFileSync`。
 *
 * 为什么：读数通道（`.tools/probe-62-hooks.mjs`）要在**加载时**把时钟搬进状态树；
 * 从磁盘现读会绕过它，于是"参考实现"那条通道根本改不到卡（我第一版就是这么写的，
 * 参考实现当场报 `card time.initial: unknown key`）。
 */
const RAW_CARDS: Record<string, Record<string, unknown>> = {
  [EXAMPLE_CARD]: morningwind as unknown as Record<string, unknown>,
  [LONG_NIGHT_CARD]: longNight as unknown as Record<string, unknown>,
  [NIGHT_WATCH_CARD]: nightWatch as unknown as Record<string, unknown>,
}

const FILES = [EXAMPLE_CARD, LONG_NIGHT_CARD, NIGHT_WATCH_CARD]
const CARDS: Array<{ file: string; card: CardData; json: Record<string, unknown> }> = FILES.map((file) => {
  const json = cardJson(file)
  return { file, json, card: parseCard(JSON.stringify(json)) }
})

let fake: FakeLlm | null = null

beforeEach(() => {
  configureFakeProvider()
})

afterEach(() => {
  fake?.restore()
  fake = null
})

/** 真卡 JSON 的一份深拷贝（反例都从它改一处 —— 不在这里手抄第二份卡） */
function cardJson(file: string): Record<string, unknown> {
  const card = RAW_CARDS[file]
  if (card === undefined) throw new Error('not a card in this fixture: ' + file)
  return JSON.parse(JSON.stringify(card)) as Record<string, unknown>
}

/** 点号路径 → 值；中间缺一段就是 undefined */
function atPath(root: unknown, path: string): unknown {
  let scope: unknown = root
  for (const segment of path.split('.')) {
    if (!isRecord(scope) || !Object.hasOwn(scope, segment)) return undefined
    scope = scope[segment]
  }
  return scope
}

/**
 * 状态树里的时刻。
 *
 * ⚠️ 读不到就**抛**，不返回 undefined —— 读一个不存在的键、靠兜底通过，是这几票反复抓的假绿；
 *    抛出来的错也顺带证明这一段真的走到了（判据红了也说得清是哪一处）。
 */
function clockOf(data: Record<string, unknown>): TimeValue {
  const clock = atPath(data, 'state.' + CLOCK_PATH)
  if (!isRecord(clock)) throw new Error('the state tree has no ' + CLOCK_PATH)
  return clock as unknown as TimeValue
}

/** 把一份时刻写进某个状态树的 `world.time`（改 `world` 这个属性本身，响应式一定看得见） */
function writeClock(data: Record<string, unknown>, clock: TimeValue): void {
  const state = data.state as Record<string, unknown>
  const world = isRecord(state[WORLD]) ? (state[WORLD] as Record<string, unknown>) : {}
  state[WORLD] = { ...world, [CLOCK]: clock }
}

/** 卡里**声明初始时刻**的地方（顶层 `time.initial` 与状态 schema 里那一格的 `initial`） */
function initialClockPlaces(json: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const top = json[CLOCK]
  if (isRecord(top) && isRecord(top.initial)) out.push(top.initial)
  const clockSchema = atPath(json, 'state.' + WORLD + '.fields.' + CLOCK)
  if (isRecord(clockSchema) && isRecord(clockSchema.initial)) out.push(clockSchema.initial)
  return out
}

/** 卡声明的初始时刻（一处都没有就抛：这张卡没声明开局几点） */
function declaredClock(json: Record<string, unknown>): TimeValue {
  const places = initialClockPlaces(json)
  if (places.length === 0) throw new Error('the card declares no starting clock')
  return places[0] as unknown as TimeValue
}

/**
 * 一份"**另一条路**也能把时钟写动"的卡：拿真卡的 JSON 加一个把时钟写动的探针动作，
 * 并把它加进推时间那个节点的工具白名单。
 *
 * 为什么要这条夹具：`advance_time` 是**引擎算出来的**推法，两条路会一起动；
 * 只有走**另一条只写状态树的路**，「引擎手里那份」与「树里那份」才会分开 —— 判据 4 要抓的就是那个缝。
 * 卡自己已经声明了时钟那一段就沿用它（这一段落地之后正是这样）。
 * 返回改过的 JSON 与解析好的卡 —— 判据 1 还要在这个 JSON 上把初始时刻改坏再载入一次。
 */
function craftedCard(file: string): { card: CardData; node: string; json: Record<string, unknown> } {
  const node = timeNodeOf(parseCard(JSON.stringify(cardJson(file))))
  const json = cardJson(file)
  const state = json.state as Record<string, unknown>
  const world = isRecord(state[WORLD]) ? (state[WORLD] as Record<string, unknown>) : {}
  state[WORLD] = world
  const fields = isRecord(world.fields) ? (world.fields as Record<string, unknown>) : {}
  world.fields = fields
  if (fields[CLOCK] === undefined) {
    fields[CLOCK] = { type: 'object', initial: declaredClock(json), fields: CLOCK_FIELDS }
  }
  ;(json.actions as Record<string, unknown>)[PROBE_ACTION] = {
    whenToUse: 'when the clock has to move',
    what: 'set the clock',
    principles: 'merge the whole clock in one call',
    path: CLOCK_PATH,
    mode: 'merge',
  }
  const tools = atPath(json, 'graph.nodes.' + node + '.tools')
  if (Array.isArray(tools)) tools.push(PROBE_ACTION)
  return { card: parseCard(JSON.stringify(json)), node, json }
}

/** 模型在协议层申请一次"把时钟写动"（走那条只写状态树的探针动作） */
function clockCall(clock: TimeValue): FakeReply {
  return { toolCalls: [{ name: PROBE_ACTION, arguments: JSON.stringify(clock) }] }
}

/** 一次请求里给模型看的那段用户文本（「现在」那一行就在里面） */
function userTextOf(messages: Array<{ role: string; content: string }>): string {
  const user = messages.find((message) => message.role === 'user')
  if (user === undefined) throw new Error('the request has no user message')
  return user.content
}

/** 挑出事件流里的状态写入（类型守卫 —— 联合类型上直接取属性 TS 不窄化） */
function writesOf(events: AgentEvent[]): Array<Extract<AgentEvent, { type: 'stateChange' }>> {
  return events.filter(
    (evt): evt is Extract<AgentEvent, { type: 'stateChange' }> => evt.type === 'stateChange',
  )
}

describe('the clock is declared by the card, in the state tree', () => {
  it('1 every card declares the clock under world, and its starting value fits that calendar', () => {
    for (const { file, json, card } of CARDS) {
      // ① 时钟那一段在状态 schema 里（形状与别的枝一样，走同一套校验）
      expect(
        atPath(card, 'state.' + WORLD + '.fields.' + CLOCK),
        file + ' declares no ' + CLOCK_PATH,
      ).toBeDefined()

      // ② 卡声明的初始时刻必须落在**它自己的历法**里：月 13 这种值当场拒
      //    ⚠️ 这一半要拿**声明了时钟的卡**才验得动 ⇒ 用探针卡（它按构造声明了那一段），
      //       今天真卡上跑不到这里，读数里要如实写明"红的是哪一半"。
      const probe = craftedCard(file)
      const places = initialClockPlaces(probe.json)
      expect(places.length, file + ' declares no starting clock').toBeGreaterThan(0)
      for (const place of places) place.month = 13
      expect(() => parseCard(JSON.stringify(probe.json)), file + ' took a month 13 clock').toThrow()
      // 对照：同一份卡不动那一处就能过（红的理由与判据想守的是同一件事）
      expect(() => parseCard(JSON.stringify(json)), file + ' must parse').not.toThrow()
    }
  })

  it('2 the engine holds no clock of its own any more', () => {
    for (const { file, json, card } of CARDS) {
      const data = createInitialState(card) as unknown as Record<string, unknown>
      expect(Object.hasOwn(data, CLOCK), file + ' still carries a top-level ' + CLOCK).toBe(false)
      // 时刻在状态树里，而且就是卡声明的那一份
      expect(clockOf(data), file + ' has no clock in the tree').toEqual(declaredClock(json))
    }
  })
})

describe('advancing time writes the state tree', () => {
  it('3 advance_time moves the clock inside the tree, and the trace points into the tree', async () => {
    fake = installFakeLlm(
      cardTurnReplies({ story: STORY_TEXT, time: { minutes: TIME_MINUTES, reason: TIME_REASON } }),
    )
    const ctx = createAgentContext()
    const events: AgentEvent[] = []
    const before = clockOf(ctx.data as unknown as Record<string, unknown>)

    await runTurn(ctx, { action: PLAYER_ACTION, onEvent: (evt) => events.push(evt) })

    const after = clockOf(ctx.data as unknown as Record<string, unknown>)
    expect(after).toEqual(advance(currentCard.time.calendar, before, TIME_MINUTES))
    expect(Object.hasOwn(ctx.data, CLOCK), 'the working copy still carries a top-level ' + CLOCK).toBe(false)
    // 痕迹里的那条写入必须能在状态树里解析到那一刻（一个裸 'time' 解析不到）。
    // ⚠️ 挑**推时间那个节点**写的那条：别的节点（写地图 / 写角色）也会写状态，
    //    取"最后一条"会挑错人，判据就红得不对。
    const timeNode = timeNodeOf()
    const written = writesOf(events).filter((evt) => evt.node === timeNode)
    expect(written.length, 'the time node wrote no state').toBeGreaterThan(0)
    expect(
      atPath(ctx.data.state, written[0].path),
      'the traced path is not a state path: ' + written[0].path,
    ).toEqual(after)
    // 模型拿到的那条工具结果里也得有推进量（顺手守一下"结果回传"没被这一段碰坏）
    const timeIndex = CARD_TOPOLOGY.indexOf(timeNode)
    const followUp = fake.calls[timeIndex + 1].body.messages ?? []
    const result = followUp.find((message) => message.role === 'tool')
    expect(result?.content).toContain(String(TIME_MINUTES))
  })

  it('4 there is exactly one clock: moving it in the tree moves what the model and the panel read', async () => {
    // ---- 模型那一面：走**另一条只写状态树的路**写时钟，后面每个节点的「现在」都得跟着走 ----
    // ⚠️ 「后面每个节点」不是"同一个节点的第二次请求"：一个节点的提示词在它**开跑时**装配一次，
    //    节点内的工具往返共用那一份（`card-graph.ts` 的 `runNode` 只调一次 `buildNodeMessages`）。
    //    所以能看见这次写入的是**它之后的那些节点**（`fake.calls` 里从 index + 2 起）。
    const { card, node } = craftedCard(EXAMPLE_CARD)
    const moved: TimeValue = { ...declaredClock(cardJson(EXAMPLE_CARD)), hour: 3, minute: 7 }
    fake = installFakeLlm(
      cardTurnReplies({
        card,
        story: STORY_TEXT,
        node: (id) => (id === node ? [clockCall(moved), 'clock set'] : undefined),
      }),
    )
    const state = { data: createInitialState(card), loadError: null }
    await runTurn(createAgentContext(state, card), { action: PLAYER_ACTION })

    const index = card.graph.topology.indexOf(node)
    expect(clockOf(state.data as unknown as Record<string, unknown>), 'the write missed the tree').toEqual(
      moved,
    )
    const later = fake.calls.slice(index + 2)
    expect(later.length, 'no node ran after the write').toBeGreaterThan(0)
    for (const call of later) {
      expect(
        userTextOf(call.body.messages ?? []),
        'a later node still reads a clock that is not the one in the state tree',
      ).toContain(format(card.time.calendar, moved))
    }

    // ---- 面板那一面：只改状态树，顶栏那条时间标签必须跟着变 ----
    const g = useGame()
    g.resetGame()
    const tree = g.stateTree.value as Record<string, unknown>
    const probe: TimeValue = { ...declaredClock(cardJson(EXAMPLE_CARD)), hour: 5, minute: 45 }
    writeClock({ state: tree }, probe)
    expect(g.timeLabel.value, 'the panel clock does not follow the state tree').toBe(
      format(currentCard.time.calendar, probe),
    )
  })

  it('9 the clock is not repeated in the state snapshot the model reads', async () => {
    // 一正：「现在」那一行仍在，而且带的是状态树里那一刻 —— **它是时钟唯一的事实来源**
    // 一反：同一段文本里不再有那一格的结构化副本（状态快照里的一行 `time:`）
    //      —— 同一个事实说两遍是项目明令禁止的；两处一旦不一致，模型会挑错的那份去叙事。
    fake = installFakeLlm(
      cardTurnReplies({ story: STORY_TEXT, time: { minutes: TIME_MINUTES, reason: TIME_REASON } }),
    )
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })

    const clock = clockOf(ctx.data as unknown as Record<string, unknown>)
    // 最后一次请求发生在推进之后（推时间的节点在拓扑中间，后面的节点都看得见新时刻）
    const text = userTextOf(fake.calls[fake.calls.length - 1].body.messages ?? [])
    expect(text, 'the request no longer carries the formatted clock line').toContain(
      format(currentCard.time.calendar, clock),
    )
    const lines = text.split('\n').map((line) => line.trim())
    expect(lines, 'the state snapshot still repeats the clock').not.toContain(CLOCK + ':')
  })
})

describe('the clock travels with the tree', () => {
  it('5 the save carries the clock inside the tree, and an off-calendar clock is refused', async () => {
    fake = installFakeLlm(
      cardTurnReplies({ story: STORY_TEXT, time: { minutes: 1440, reason: TIME_REASON } }),
    )
    const ctx = createAgentContext()
    await runTurn(ctx, { action: PLAYER_ACTION })
    const advanced = clockOf(ctx.data as unknown as Record<string, unknown>)

    const saved = JSON.parse(JSON.stringify(ctx.data)) as Record<string, unknown>
    const back = normalize(saved, currentCard)
    expect(clockOf(back as unknown as Record<string, unknown>)).toEqual(advanced)
    expect(Object.hasOwn(back, CLOCK), 'the save round trip brought a top-level ' + CLOCK + ' back').toBe(
      false,
    )

    // 越界的时刻（月 13）读档时必须拒 —— schema 只认"整数"，历法那一道不能丢
    const bad = JSON.parse(JSON.stringify(ctx.data)) as Record<string, unknown>
    writeClock(bad, { ...advanced, month: 13 })
    expect(() => normalize(bad, currentCard), 'a month 13 clock got through the save').toThrow()
    // 对照：同一份存档把月改回合法值就能过（拒的是那个值，不是这份存档的形状）
    const ok = JSON.parse(JSON.stringify(ctx.data)) as Record<string, unknown>
    writeClock(ok, { ...advanced, month: 12 })
    expect(() => normalize(ok, currentCard), 'a legal clock was refused').not.toThrow()
  })

  it('6 redo rolls the clock back with the tree (the point of R39)', async () => {
    const TIME = timeNodeOf()
    const STORY = storyNodeOf()
    const VERIFY = CARD_TOPOLOGY.find((id) => cardHasTool(currentCard, id, 'redo')) as string
    // 第一遍：时间节点推进 10 小时（够「值得记」）；校对要求退回**时间节点本身**
    fake = installFakeLlm([
      ...cardPassReplies(CARD_TOPOLOGY, (id) => {
        if (id === TIME) return [advanceTimeCall(TIME_MINUTES * 7, TIME_REASON), 'time first pass']
        if (id === VERIFY) return redoCall(TIME, REDO_WHY)
        return undefined
      }),
      // 重跑那一段：时间原地不动 —— 被撤掉的那次推进不能在时钟与时间线上留痕
      ...cardPassReplies(CARD_TOPOLOGY.slice(CARD_TOPOLOGY.indexOf(TIME)), (id) =>
        id === STORY ? SECOND_STORY : undefined,
      ),
    ])
    const ctx = createAgentContext()
    const before = clockOf(ctx.data as unknown as Record<string, unknown>)

    await runTurn(ctx, { action: PLAYER_ACTION })

    expect(
      clockOf(ctx.data as unknown as Record<string, unknown>),
      'the clock survived the rollback',
    ).toEqual(before)
    expect(ctx.data.timeline).toEqual([])
  })
})

describe('the reverse controls: what must not move', () => {
  it('7 the card declares its starting clock in exactly one place', () => {
    for (const { file, json } of CARDS) {
      const places = initialClockPlaces(json)
      expect(places.length, file + ' declares a starting clock ' + String(places.length) + ' times').toBe(1)
    }
  })

  it('8 the calendar stays the card declaration, and counting minutes is unchanged', () => {
    const real = CARDS[0].card
    const custom = CARDS[2].card
    // 历法是卡的声明：一个用引擎预设、一个自己写一份（引擎不写死）
    expect(typeof real.time.calendar).toBe('string')
    expect(typeof custom.time.calendar).toBe('object')

    for (const { file, card } of CARDS) {
      const start = declaredClock(cardJson(file))
      const calendar = card.time.calendar
      // 形状仍是那五个整数（不许借搬家的机会改成字符串 / 时间戳）
      expect(Object.keys(start).sort(), file + ' changed the clock shape').toEqual([...CLOCK_PARTS].sort())
      for (const part of CLOCK_PARTS)
        expect(Number.isInteger(start[part as keyof TimeValue]), part).toBe(true)
      // 从分钟算：0 分钟原地不动；一小时就是历法里的一小时；一天等于 hours * minutesPerHour
      expect(advance(calendar, start, 0), file + ' moved on zero minutes').toEqual(start)
      const oneHour = advance(calendar, start, minutesPerHourOf(card))
      expect(oneHour.hour, file + ' did not move one hour').not.toBe(start.hour)
      const oneDay = advance(calendar, start, minutesPerDayOf(card))
      expect(oneDay.day, file + ' did not move one day').not.toBe(start.day)
      // 越界的时刻仍然被拒（月 13 / 时 24 那类）
      expect(() => checkTime(calendar, { ...start, month: 13 }, 'probe'), file + ' took month 13').toThrow()
    }
  })

  it('10 a tree without the clock fails fast instead of falling back to a made-up time', () => {
    // ⚠️ 这一条守的是**被改判过的那条行为**："缺那一格 ⇒ 当场抛"，不是"退回卡的初值"。
    //    评审 F2：三条"缺那一格"的路（读 / 写 / 摘掉）一次都没被执行过 ——
    //    把 throw 换成兜底，其余判据一条都不会红，而那正是"两份时钟"从后门回来。
    const clock: TimeValue = { ...declaredClock(cardJson(EXAMPLE_CARD)) }

    // ① 读：树里没有那一枝、没有那一格、那一格不是对象 —— 三种都抛
    expect(() => cardTime.clockIn({}), 'an empty tree must not answer with a time').toThrow(CLOCK)
    expect(() => cardTime.clockIn({ [WORLD]: {} })).toThrow(CLOCK)
    expect(() => cardTime.clockIn({ [WORLD]: { [CLOCK]: 'noon' } })).toThrow(CLOCK)
    // 反面：那一格在的时候**不**抛（否则上面三条可能是"什么都抛"的假绿）
    expect(cardTime.clockIn({ [WORLD]: { [CLOCK]: clock } })).toEqual(clock)

    // ② 写：没有 world 那一枝时抛（不许顺手建一枝 —— 那等于替卡做决定）
    expect(() => cardTime.writeClock({}, clock), 'writeClock invented the branch').toThrow(WORLD)

    // ③ 摘掉（给模型的快照用它）：那一格不在时**原样返回**，且不许无中生有一个时刻
    const bare = { [WORLD]: { map: {} } }
    expect(cardTime.withoutClock(bare)).toBe(bare)
    expect(cardTime.withoutClock({})).toEqual({})
    const withClock = { [WORLD]: { [CLOCK]: clock, map: {} } }
    expect(cardTime.withoutClock(withClock)).toEqual({ [WORLD]: { map: {} } })

    // ④ 真路：卡不声明那一格 ⇒ **载入就拒**（不是开局时才发现），而且报错要点出那一格。
    //    ⚠️ 这条是"缺那一格"唯一走得通的真路：读档那条先过 `pickState`（按 schema 校验），
    //    够不着 `clockIn` 的 throw（评审实测）。
    const noClock = cardJson(EXAMPLE_CARD)
    delete (atPath(noClock, 'state.' + WORLD + '.fields') as Record<string, unknown>)[CLOCK]
    expect(() => parseCard(JSON.stringify(noClock)), 'a card without the clock loaded').toThrow(CLOCK_PATH)
  })
})

/** 这张卡的历法里一小时多少分钟（预设 `real` 是 60；自定义历法读它自己那一格） */
function minutesPerHourOf(card: CardData): number {
  const calendar = card.time.calendar
  if (typeof calendar === 'string') return 60
  return calendar.day.minutesPerHour
}

/** 这张卡的历法里一天多少分钟（预设 `real` 是 24 小时） */
function minutesPerDayOf(card: CardData): number {
  const calendar = card.time.calendar
  if (typeof calendar === 'string') return 24 * 60
  return calendar.day.hours * calendar.day.minutesPerHour
}

/** 某个节点拿不拿得到这个动作（白名单不写 = 全部动作） */
function cardHasTool(card: CardData, id: string, tool: string): boolean {
  const tools = card.graph.nodes[id].tools
  return tools === undefined ? Object.hasOwn(card.actions, tool) : tools.includes(tool)
}
