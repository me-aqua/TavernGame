/**
 * 票 65 · 段 7a：**节点与动作的声明形状** —— 声明侧的判据。
 *
 * 契约 `.team/test/2026-09-20/contract-65.md`；S0 `.team/leader/2026-09-19/段7-S0.md`。
 * ⚠️ 契约 **§8 组长裁决**（`:552-568`）把这一份的两条判据打回过，**15 / 16 就是补的那一条**。
 *
 * 这一份管三件事（S0 §三 的口径 1–3）：
 *   1. 卡里**不再有** `generators`（顶层）与 `uses`（节点）；
 *   2. 卡顶层那张 `actions` 表，**每条动作自带三段**（`whenToUse` / `what` / `principles`）；
 *   3. 原来那张生成器表里的 30 行原则**搬进了干活那一步的主提示词**，而且**一条只属于一步**。
 *
 * ⚠️ **判据 1/2 与判据 15/16 是两件事，别把它们当一个**（组长裁决 8.2）：
 *    1/2 读的是 `cards/*.json`（**卡里**有没有那个键）；15/16 走 `parseCard`（**校验器还认不认**那个键）。
 *    **S2 只改卡、忘了改词表** ⇒ 1/2 照样全绿，而校验器仍然接受 `generators` ⇒ 下一张卡写上去**静默通过**。
 *    故障注入的 `f-wordlist-untouched` 就是这一处的现场证据。
 *
 * ⚠️ **只读卡文件、不进引擎**（引擎那一半在 `card-actions-declaration.test.ts`）。
 * ⚠️ 中文一律**码点构造或走夹具文本**（`.githooks/checks/ascii.mjs` 连 `tests/` 里的字面量一起拦）：
 *    动作三段的**值**在卡里是中文，用例用「值等于卡里那一份」判断，不抄原文。
 * ⚠️ 期望值从**卡现取**：这里一个节点 id、一个节点名、一个动作名都不写死。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, type CardData } from '../src/game/card'
import { PRINCIPLE_MOVES, MOVED_LINES as MOVED_PRINCIPLE_LINES } from './support/generator-moves'
import { minimalCard } from './support/card-fixtures'

/** 三张卡：这一段的形状对**每一张**都成立，不是只对示例卡（S0 §四 点名三张一起量） */
const CARD_NAMES = ['morningwind', 'long-night', 'night-watch'] as const

const cardPath = (name: string): string => 'cards/' + name + '.json'

function load(name: string): CardData {
  return parseCard(readFileSync(cardPath(name), 'utf8'))
}

const CARDS = CARD_NAMES.map((name) => ({ name, card: load(name) }))

/** 原始 JSON —— 问「键在不在」必须看它：走 `CardData` 的读法会把不认识的键吃掉 */
function raw(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(cardPath(name), 'utf8')) as Record<string, unknown>
}

/** 按名字取那一张卡（用例里只写卡名，不重复路径） */
const cardOf = (name: string): CardData =>
  (CARDS.find((entry) => entry.name === name) as { card: CardData }).card

/**
 * 跑一次校验，把抛出的错误读成文本（通过了就返回空串）。
 *
 * ⚠️ **不看 `CardData` 的读法**：15/16 问的是"校验器认不认这个键"，
 *    所以拿**原始 JSON 的副本**（或夹具）改一处再喂给 `parseCard`。
 */
function errorOf(card: unknown): string {
  try {
    parseCard(JSON.stringify(card))
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** 两个**被删掉**的键名 —— 用码点拼，免得它们以字面量形式出现在这个文件里 */
const GENERATORS = String.fromCharCode(0x67, 0x65, 0x6e, 0x65, 0x72, 0x61, 0x74, 0x6f, 0x72, 0x73)
const USES = String.fromCharCode(0x75, 0x73, 0x65, 0x73)

/** 动作条目认的三个键 —— 格式自己的词表（ASCII）；段 3 那条"作者起的字段名改中文"不管它 */
const ACTION_SEGMENTS = ['whenToUse', 'what', 'principles'] as const

/** 节点认的七个键：原来那八个里去掉 `uses` */
const NODE_KEYS = ['name', 'duty', 'prompt', 'role', 'tools', 'reads', 'settings']

/** 顶层键：原来十二个，去掉 `generators` 之后十一个（⚠️ 比**按集合**比，不比顺序 —— 卡自己的键序由作者定） */
const TOP_LEVEL_KEYS = [
  'card',
  'settings',
  'script',
  'convention',
  'graph',
  'actions',
  'state',
  'time',
  'opening',
  'display',
  'notes',
]

/**
 * 旧 `generators` 表里那些原则（一条一行，S1 从起点树上抄下来的）+ 每条的归属。
 *
 * 为什么单独存成文本：这一段的判据要回答「那些原则有没有活着进主提示词」，而原则的原文是
 * **中文**（`.githooks/checks/ascii.mjs` 不许代码文件里出现中文字面量）⇒ 数据进 `.txt`，
 * 用例按行读、逐条断言；这一份模块只做解析，所以它自己是纯 ASCII。
 *
 * ⚠️ 行数是多少**不在这段注释里报** —— 机器数出来的那个数写在 `DECLARED_PRINCIPLE_LINES` 上，
 * 改一处而不改另一处就在这里红（判据 6）。
 */
const MOVED_LINES = MOVED_PRINCIPLE_LINES

/** 那张旧表一共几行 —— 与契约 §2.3 的读数对账（改一处而不改另一处就在这里红） */
const DECLARED_PRINCIPLE_LINES = 30

/** 一条动作的三段文本（顺序 = 格式声明的顺序） */
const segmentsOf = (card: CardData, name: string): string[] =>
  ACTION_SEGMENTS.map((key) => (card.actions[name] as unknown as Record<string, string>)[key])

/** 一个节点的主提示词并成一段文本 */
const promptOf = (card: CardData, id: string): string => card.graph.nodes[id].prompt.join('\n')

/** 全卡所有节点的主提示词并成一段（问"这一句到底还在不在卡里"） */
const allPrompts = (card: CardData): string => card.graph.topology.map((id) => promptOf(card, id)).join('\n')

describe('the card no longer declares generators or uses', () => {
  it('1 the top level keeps eleven keys, and generators is not one of them', () => {
    for (const { name, card } of CARDS) {
      expect(card, name + ' must still load through parseCard').toBeDefined()
      const keys = Object.keys(raw(name))
      expect(keys, name).not.toContain(GENERATORS)
      // ⚠️ **按集合比，不比顺序**：三张卡自己的键序不同（长夜号把 `time` 放在 `actions` 前面）——
      //    那是作者的事，不属于这一段。这一段管的是"键集少了哪一个"。
      expect([...keys].sort(), name).toEqual([...TOP_LEVEL_KEYS].sort())
    }
  })

  it('2 no node declares uses, and the node keys are exactly the seven', () => {
    for (const { name, card } of CARDS) {
      const nodes = (raw(name).graph as { nodes: Record<string, Record<string, unknown>> }).nodes
      for (const id of card.graph.topology) {
        const keys = Object.keys(nodes[id])
        expect(keys, name + '.' + id).not.toContain(USES)
        for (const key of keys) {
          expect(NODE_KEYS, name + '.' + id + ' declares ' + key).toContain(key)
        }
        for (const key of ['name', 'duty', 'prompt']) {
          expect(keys, name + '.' + id + ' must still declare ' + key).toContain(key)
        }
      }
    }
  })
})

describe('every action carries its own three segments', () => {
  it('3 each entry has exactly whenToUse / what / principles, plus the write shape', () => {
    // 动作条目认两种形状（决定 #49）：`path` / `mode` / `key` 或 `effect` —— 加上那三段。
    // ⚠️ 契约 §2.1 的口径：`path` 与 `effect` 二选一（`checkActions` 今天就在查），
    //    `mode` / `key` 只对 path 型合法 —— 这一条只要求"三段都在、没有第四种东西"。
    for (const { name, card } of CARDS) {
      const names = Object.keys(card.actions)
      expect(names.length, name + ' must declare at least one action').toBeGreaterThan(0)
      for (const action of names) {
        const entry = card.actions[action] as unknown as Record<string, unknown>
        const keys = Object.keys(entry)
        for (const key of ACTION_SEGMENTS) {
          expect(keys, name + '.' + action + ' must carry ' + key).toContain(key)
        }
        for (const key of keys) {
          expect([...ACTION_SEGMENTS, 'path', 'effect', 'mode', 'key'], name + '.' + action).toContain(key)
        }
        const writes = ['path', 'effect'].filter((key) => keys.includes(key))
        expect(writes.length, name + '.' + action + ' writes through exactly one shape').toBe(1)
      }
    }
  })

  it('4 all three segments are non-empty text', () => {
    for (const { name, card } of CARDS) {
      for (const action of Object.keys(card.actions)) {
        const entry = card.actions[action] as unknown as Record<string, unknown>
        for (const key of ACTION_SEGMENTS) {
          const value = entry[key]
          expect(typeof value, name + '.' + action + '.' + key + ' must be a string').toBe('string')
          expect(
            (value as string).length,
            name + '.' + action + '.' + key + ' must not be empty',
          ).toBeGreaterThan(0)
        }
      }
    }
  })

  it('5 the action names stay ASCII (they go into the tools protocol)', () => {
    for (const { name, card } of CARDS) {
      for (const action of Object.keys(card.actions)) {
        expect(action, name + ': an action name is a tool name').toMatch(/^[a-zA-Z0-9_-]+$/)
      }
    }
  })
})

describe('the old generator principles live in the prompt of the step that works', () => {
  it('6 the catalog has exactly as many lines as the contract says', () => {
    // ⚠️ 这一条是**报数对账的机器版**：契约 §2.3 写死的行数变了而这里没变 ⇒ 当场红。
    //    另外两个数一并报出来（不是硬断言，是留痕）：其中几条没有自己的锚点、用整句探。
    expect(MOVED_LINES.length, 'tests/support/generator-principles.txt').toBe(DECLARED_PRINCIPLE_LINES)
    expect(PRINCIPLE_MOVES.length, 'rows that name a target step').toBeLessThanOrEqual(
      DECLARED_PRINCIPLE_LINES,
    )
  })

  /** 那 30 行一句都不许丢 —— 用**锚点**探（有两条没写锚点 ⇒ 落回整句） */
  it.each(MOVED_LINES.map((line, index) => ({ index: index + 1, anchor: line.anchor ?? line.text })))(
    '7 moved line $index is still somewhere in the card',
    ({ anchor }) => {
      const carriers = CARDS.filter(({ card }) => allPrompts(card).includes(anchor)).map(({ name }) => name)
      expect(carriers.length, JSON.stringify(anchor) + ' is in ' + JSON.stringify(carriers)).toBeGreaterThan(
        0,
      )
    },
  )

  /** 一条原则只属于一步（R54）：既不许丢，也不许两份走样的原则 */
  it.each(MOVED_LINES.map((line, index) => ({ index: index + 1, anchor: line.anchor ?? line.text })))(
    '8 moved line $index is carried by exactly one node of one card',
    ({ anchor }) => {
      const carriers: string[] = []
      for (const { name, card } of CARDS) {
        for (const id of card.graph.topology) {
          if (promptOf(card, id).includes(anchor)) carriers.push(name + '.' + id)
        }
      }
      expect(carriers.length, JSON.stringify(anchor) + ' is carried by ' + JSON.stringify(carriers)).toBe(1)
    },
  )

  it('9 the probe can tell a sentence that is in no card at all (a negative control)', () => {
    const absent = String.fromCharCode(0x8fd9, 0x53e5, 0x8bdd, 0x4e0d, 0x5728, 0x5361, 0x91cc)
    // 反面控制：这份判据得**分得清**"在"和"不在"，否则上面那一组永远是绿的
    expect(allPrompts(cardOf('morningwind'))).not.toContain(absent)
    for (const { card } of CARDS) {
      expect(allPrompts(card), 'a sentence that is in no card').not.toContain(absent)
    }
  })
})

describe('each principle landed on the step the card author decided', () => {
  it('10 no two anchors are substrings of each other (a collision would merge two principles)', () => {
    for (const move of PRINCIPLE_MOVES) {
      for (const other of PRINCIPLE_MOVES) {
        if (other === move) continue
        expect(
          move.anchor === other.anchor || move.anchor.includes(other.anchor),
          JSON.stringify(move.text) + ' shares an anchor with ' + JSON.stringify(other.text),
        ).toBe(false)
      }
    }
  })

  it.each(PRINCIPLE_MOVES.map((move, index) => ({ index: index + 1, ...move })))(
    '11 anchor $index is carried by exactly one node of its card',
    ({ anchor, text, card, node }) => {
      const source = cardOf(card)
      const carriers = source.graph.topology.filter((id) => promptOf(source, id).includes(anchor))
      expect(carriers.length, JSON.stringify(text) + ' -> ' + JSON.stringify(carriers)).toBe(1)
      expect(carriers[0], JSON.stringify(text)).toBe(node)
    },
  )

  it.each(PRINCIPLE_MOVES.map((move, index) => ({ index: index + 1, ...move })))(
    '12 anchor $index landed on the step the table names',
    ({ anchor, text, card, node }) => {
      const source = cardOf(card)
      expect(source.graph.nodes[node], card + ' must have a ' + node + ' node').toBeDefined()
      expect(promptOf(source, node), JSON.stringify(text)).toContain(anchor)
    },
  )

  it('13 the moved principles did not come back as an action segment', () => {
    for (const { name, card } of CARDS) {
      for (const action of Object.keys(card.actions)) {
        for (const text of segmentsOf(card, action)) {
          for (const { anchor, text: principle } of PRINCIPLE_MOVES) {
            expect(text, name + '.' + action + ' must not carry ' + JSON.stringify(principle)).not.toContain(
              anchor,
            )
          }
        }
      }
    }
  })

  it('14 every orphan table went into the node the table names', () => {
    // 老板 2026-09-20 拍：**两张卡的两个孤儿**（长夜号「按需长舱段」· 夜班「海上的东西」）
    // 一律并入正文节点 ⇒ 逐卡核：这张卡里被搬进去的每一行，都必须落在同一组节点上。
    // ⚠️ 正文那一步按**卡自己的 role** 找（`story` 是引擎词表，节点名不是）。
    for (const name of ['long-night', 'night-watch']) {
      const card = cardOf(name)
      const story = card.graph.topology.find((id) => card.graph.nodes[id].role === 'story') as string
      expect(story, name + ' must have exactly one story node').toBeDefined()
      const inCard = MOVED_LINES.filter((line) => allPrompts(card).includes(line.anchor ?? line.text))
      const carried = MOVED_LINES.filter((line) => promptOf(card, story).includes(line.anchor ?? line.text))
      expect(inCard.length, name + ' must really carry a moved set').toBeGreaterThan(0)
      expect(carried.length, name + ': the story node must carry all of it').toBe(inCard.length)
    }
  })
})

describe('the validator no longer accepts the two removed keys', () => {
  /**
   * ⚠️ **这一组与判据 1/2 不是一回事**（组长裁决 §8.2）：
   *    1/2 读 `cards/*.json` —— 问"卡里有没有那个键"；这里走 `parseCard` —— 问"**校验器还认不认**那个键"。
   *    **S2 只改卡、忘了改词表**（`TOP_LEVEL_KEYS` / `NODE_KEYS`）⇒ 1/2 照样全绿，
   *    而下一张卡写上 `generators` 会**静默通过** —— 这正是"静默失效的检查和通过的检查长得一模一样"。
   *
   * ⚠️ **这一组用共享夹具 `minimalCard()`，不读盘** —— 两个理由：
   *    ① 夹具是"一份处处自洽的最小卡"，**多一个键**正是它的标准反例形状；
   *    ② 读 `cards/*.json` 会被读数通道的**卡改写**遮住（S3 打回后补的一次故障注入里实测：
   *       故障把 `generators` 加回词表之后，读盘的卡当场 `missing top-level key "generators"`
   *       ⇒ 整份文件载入即抛，**判据根本没机会跑**）。夹具走的是测试自己那一份数据，不受卡改写影响。
   *
   * ⚠️ **这不是新增结构校验**（S0 §六 禁的是 `R51` 那条"一枝被两步写"）：
   *    它只是把**既有的键集严判**（`checkTopLevel` / `checkOptionalKeys`）钉到机器上。
   */
  it('15 parseCard refuses a card that still declares generators, and names the key', () => {
    // 反面控制：**同一份夹具不改那一处时必须过**（否则"被拒"可能来自别处，这条就白写了）
    expect(errorOf(minimalCard()), 'the untouched fixture must still parse').toBe('')

    const withTable = minimalCard()
    withTable.generators = []
    expect(errorOf(withTable), 'a card with a generators key must be refused').not.toBe('')
    expect(errorOf(withTable), 'the failure must name the key').toContain(GENERATORS)
  })

  it('16 parseCard refuses a node that still declares uses, and names the key', () => {
    expect(errorOf(minimalCard()), 'the untouched fixture must still parse').toBe('')

    // 挑**第一个**节点（不写死 id：节点名是作者起的）
    const source = minimalCard() as { graph: { nodes: Record<string, Record<string, unknown>> } }
    const [id] = Object.keys(source.graph.nodes)
    source.graph.nodes[id].uses = []
    expect(errorOf(source), 'a node with a uses key must be refused (' + id + ')').not.toBe('')
    expect(errorOf(source), 'the failure must name the key (' + id + ')').toContain(USES)
  })
})
