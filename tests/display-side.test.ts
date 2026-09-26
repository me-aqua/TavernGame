/**
 * 票 68 · S1：显示块声明「放哪一边」—— **校验器层（K）与分栏层（D）**（纯逻辑，不需要 DOM）。
 *
 * 契约 `.team/test/2026-09-24/contract-68.md` §一 / §二 / §三.4 / §四 / §五.1 / §五.2 / §八。
 * 口径源 `.team/leader/2026-09-24/票68-S0.md`（八项内容）+ 老板 2026-09-24 的「A：必填 + 提戳」。
 *
 * ⚠️ **S1 的产物，所以这一件在 S2 落地之前必须是红的** —— 而且**每条要红在它自己那件事上**：
 *    · 「引擎还不认 `side` 这个键」是一种红（今天的主色）；
 *    · 「`side` 的值是 `middle` 却被收下了」是**另一种**红。
 *    两者混在一起时，判据的牙就说不清了（票 74 那一族：`?.` 挂在不存在的东西上，红得毫无信息）。
 *
 * ⚠️ 这一件**不吃共享夹具 `card-fixtures` 的那张卡**：夹具已经换成新格式（多一个 `side`），
 *    今天载入会先被"不认识的键"拒掉 —— 那样 K2–K8 全会红在同一句话上，分不出各条要断什么。
 *    ⇒ 这里有**自己的一份最小卡**（下面 `demo()`），反例都只在它上面改一处。
 * ⚠️ 字符串一律 ASCII：`.githooks/checks/ascii.mjs` 的 `TEST_TOOL` 只豁免 `e2e/` 与 `*.stories.ts`，
 *    `tests/` **不豁免** ⇒ 卡里的中文（`占满整屏` / `抽屉` / `栏` / `玩`）一律写成 `\uXXXX`。
 *    路径名（`world.谁在哪` 之类）**一律从卡现取**，不在这里抄一份。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as displayBlocks from '../src/components/display-blocks'
import { worldBlocks } from '../src/components/display-blocks'
import { CARD_FORMAT, parseCard } from '../src/game/card'
import { displayOf, type DisplayDecl } from '../src/game/display'
import { EXAMPLE_CARD, LONG_NIGHT_CARD, NIGHT_WATCH_CARD, fixture } from './support/card-fixtures'

/** 两个合法取值（契约 §一.1：只有这两个，大小写敏感） */
const SIDES = ['left', 'right'] as const

/** 语文上的常量：`占满整屏` —— 形态一变它就成了假话（契约 §四.2） */
const SAYS_FULL_SCREEN = '\u5360\u6ee1\u6574\u5c4f'
/** `抽屉` —— 世界面板那一层本票撤了 */
const SAYS_DRAWER = '\u62bd\u5c49'
/** `世界面板` —— 被撤掉那一层的**名字**（票 68b 补：撤了抽屉之后，卡里那句 `scroll` 还在叫它） */
const SAYS_WORLD_PANEL = '\u4e16\u754c\u9762\u677f'
/** `栏`（U+680F）—— 新形态那句话里该出现的字（判据 K12 只要求"提了一句"）
 *  ⚠️ 2026-09-24 改前是 `'\u6805'`＝「栅」（错字：注释与契约都写着「栏」）。
 *     写错的 `\uXXXX` **编译得过、跑得起来**，只会让 K12 去断另一个字 ⇒ 量具自检见
 *     `.tools/marta68-codepoints.mjs`（它把两份判据里每一处中文转义逐字解出来对账）。 */
const SAYS_COLUMN = '\u680f'

/**
 * 卡里那三段**给人看的散文**（`card.ts` 的 `layout` / `time` / `scroll` —— 引擎不读它们）。
 *
 * ⚠️ 票 68b 把 K11 的扫描面从"只有 `layout`"扩到这三段：只扫 `layout` 会漏掉
 *    `scroll` 里那句「世界面板放不下就加滚动条」—— 那是本票抓到的**真假话**。
 */
const PROSE_KEYS = ['layout', 'time', 'scroll'] as const

/** 三张真卡（期望值从卡现取；**不从源码里抄路径名**） */
const CARDS = [
  { name: 'morningwind', path: EXAMPLE_CARD },
  { name: 'night-watch', path: NIGHT_WATCH_CARD },
  { name: 'long-night', path: LONG_NIGHT_CARD },
] as const

/** 读一张真卡（原样 JSON：有些判据要看"卡里到底写没写那个键"） */
function rawOf(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, any>
}

/** 一张卡声明的侧栏条目 */
function entriesOf(raw: Record<string, any>): Array<Record<string, any>> {
  return raw.display.sidebar as Array<Record<string, any>>
}

/**
 * 一条声明该放哪一边 —— **规则**（契约 §四.1）：`world.*` / `roles` ⇒ 左，其余（`lead.*`）⇒ 右。
 *
 * ⚠️ 这条规则是**算得出来**的（设计 §二.4 那三条理由的第二条）：新卡加一块时归属不用回头问设计。
 */
function wantedSide(path: string): string {
  const branch = path.split('.')[0]
  return branch === 'world' || branch === 'roles' ? 'left' : 'right'
}

/**
 * 一份最小的声明卡 —— **这一件自己的夹具**，反例都只在它的副本上改一处。
 *
 * 四条声明各带一个 `side`（左 3 / 右 1），路径就是共享夹具那四条（`world.map` /
 * `world.location` / `roles` / `lead.pack`），于是"哪一枝放哪边"与真卡的规则一致。
 *
 * ⚠️ **格式戳从引擎现取**（`CARD_FORMAT`）：本票要把它从 `card/4` 提到 `card/5`，
 *    写死任何一个都会让这一件在**本票的前后两半**里各错一次。
 */
function demo(): Record<string, any> {
  const card = fixture() as Record<string, any>
  card.card.format = CARD_FORMAT
  card.display.sidebar = [
    { path: 'world.map', title: 'the map', format: 'grouped', side: 'left' },
    { path: 'world.location', title: 'where the lead is', format: 'key-value', side: 'left' },
    { path: 'roles', title: 'the cast', format: 'grouped', side: 'left' },
    { path: 'lead.pack', title: 'the pack', format: 'list', side: 'right' },
  ]
  return card
}

/** 一份只有 `display` 的声明（不经过卡校验 —— 解构那一层吃的就是它） */
function declOf(entries: Array<Record<string, unknown>>): DisplayDecl {
  return { sidebar: entries as unknown as DisplayDecl['sidebar'] }
}

/**
 * 载入这张卡该抛的那句话 —— 收下了就是**这条判据的实得**（不是异常逃逸）。
 *
 * ⚠️ 它抛的是自己的错（"it was accepted"）：那是"拒了但理由不对"与"压根没收下"的分界，
 *    两条要看得见地区分开（票 71 那一族）。
 */
function rejectionOf(card: unknown): string {
  try {
    parseCard(JSON.stringify(card))
  } catch (error) {
    return (error as Error).message
  }
  throw new Error('the card was accepted, but this ticket says it must be refused')
}

// ---------------------------------------------------------------------------
// 量具自检（今天必须绿）—— 证明"读卡 / 拒收 / 解构"这三条通道是活的
// ---------------------------------------------------------------------------

describe('the reading channels behind these criteria are alive', () => {
  it('S1 the three cards in the repo load today', () => {
    let entries = 0
    for (const { name, path } of CARDS) {
      const loaded = parseCard(readFileSync(path, 'utf8'))
      expect(loaded.card.id.length, name + ' loaded without an id').toBeGreaterThan(0)
      const declared = rawOf(path).display.sidebar
      expect(Array.isArray(declared), name + ': the raw JSON declares no sidebar list').toBe(true)
      entries += declared.length
    }
    // 反面：三张卡一条声明都没有也照样"全过"（那读卡这条通道什么都没验）
    // ⚠️ 不逐张要求 > 0：`long-night` 声明的就是空表（那是它的合法形状，契约 3.3）
    expect(entries, 'no card in the repo declares a sidebar entry at all').toBeGreaterThan(0)
  })

  it('S2 a bad declaration really comes back as the card refusal, not as our own error', () => {
    // 侧面证明 `rejectionOf` 报的是**卡自己**那句话（拿一条与 side 无关的坏声明试）
    const broken = demo()
    broken.display.sidebar = 'nope'
    expect(rejectionOf(broken), 'the refusal must name the place, not our own bookkeeping').toContain(
      'display.sidebar',
    )
  })

  it('S3 worldBlocks is one block per declaration, in order (the split layer reads this)', () => {
    const decl = declOf([
      { path: 'world.map', title: 'the map', format: 'grouped', side: 'left' },
      { path: 'lead.pack', title: 'the pack', format: 'list', side: 'right' },
    ])
    expect(worldBlocks(decl).map((block) => block.name)).toEqual(decl.sidebar.map((entry) => entry.path))
  })
})

// ---------------------------------------------------------------------------
// K 族 —— 校验器层
// ---------------------------------------------------------------------------

describe('K: a sidebar entry must name the side it is drawn on', () => {
  it('K1 a declaration that names a side loads, and displayOf hands the side out unchanged', () => {
    const decl = displayOf(parseCard(JSON.stringify(demo())))
    expect(
      decl.sidebar.map((entry) => entry.side),
      'the side does not survive into the declaration the screen draws from',
    ).toEqual(['left', 'left', 'left', 'right'])
  })

  it('K2 a missing side is refused, and the refusal names the entry', () => {
    // 整张卡的每一条都不写 side（不是只删一条）—— 这样今天的实得是"卡被收下了"，
    // 而不是"另一条的多余键先把它拒了"（两种红的成因必须分得开）
    const broken = demo()
    broken.display.sidebar = broken.display.sidebar.map(
      (entry: Record<string, unknown>) =>
        ({ path: entry.path, title: entry.title, format: entry.format }) as Record<string, unknown>,
    )
    const message = rejectionOf(broken)
    expect(message, 'the refusal must name the entry that forgot its side').toContain('display.sidebar[0]')
    expect(message, 'the refusal must say which key is missing').toContain('side')
  })

  it('K3 a side that is not one of the two values is refused, with the place and the value named', () => {
    const broken = demo()
    broken.display.sidebar[1].side = 'middle'
    const message = rejectionOf(broken)
    expect(message, 'the refusal must name the field, not just the entry').toContain(
      'display.sidebar[1].side',
    )
    expect(message, 'the refusal must quote the value it did not like').toContain('"middle"')
    expect(message, 'the refusal must say which two values exist').toContain('left')
    expect(message).toContain('right')
  })

  it('K4 the two values are case sensitive (no silent toLowerCase on the way in)', () => {
    for (const [index, value] of [
      [0, 'Left'],
      [2, 'RIGHT'],
    ] as const) {
      const broken = demo()
      broken.display.sidebar[index].side = value
      const message = rejectionOf(broken)
      expect(message, 'a case variant was accepted: ' + value).toContain(
        'display.sidebar[' + index + '].side',
      )
      expect(message, 'the refusal must quote the variant it saw').toContain(JSON.stringify(value))
    }
  })

  it('K5 a side that is not text at all is refused, and says what it wanted', () => {
    const broken = demo()
    broken.display.sidebar[0].side = 7
    const message = rejectionOf(broken)
    expect(message, 'the refusal must name the field').toContain('display.sidebar[0].side')
    expect(message, 'the refusal must say it wanted a non-empty string').toContain('string')
  })

  it('K6 the key set stays closed: one extra key next to the side is still an unknown key', () => {
    const broken = demo()
    broken.display.sidebar[0].where = 'left'
    const message = rejectionOf(broken)
    expect(message, 'an extra key rode along with the side').toContain('display.sidebar[0].where')
  })

  it('K7 an empty sidebar is still legal (nothing to place, nothing to refuse)', () => {
    const broken = demo()
    broken.display.sidebar = []
    expect(() => parseCard(JSON.stringify(broken)), 'an empty sidebar was refused').not.toThrow()
  })

  it('K8 the refusal points at the entry that is wrong, by its index', () => {
    const broken = demo()
    broken.display.sidebar[2].side = 'up'
    const message = rejectionOf(broken)
    expect(message, 'the third entry must be named as [2]').toContain('display.sidebar[2].side')
    expect(message, 'the refusal must quote the value it saw').toContain('"up"')
  })
})

describe('K: the three cards carry the side their branches imply', () => {
  it('K9 every declared block in every card names the side its top branch implies', () => {
    let checked = 0
    for (const { name, path } of CARDS) {
      for (const entry of entriesOf(rawOf(path))) {
        const where = name + ' ' + String(entry.path)
        expect(SIDES as readonly unknown[], where + ' side vocabulary').toContain(entry.side)
        expect(String(entry.side), where + ': the side does not match its top branch').toBe(
          wantedSide(String(entry.path)),
        )
        checked += 1
      }
    }
    // 反面：一张卡都没声明也照样"全过"（那这条判据什么都没验）
    expect(checked, 'no sidebar entry was checked in any card').toBeGreaterThan(0)
  })

  it('K9b the demo card is three blocks left and three blocks right', () => {
    const sides = entriesOf(rawOf(EXAMPLE_CARD)).map((entry) => entry.side)
    expect(
      sides.filter((side) => side === 'left'),
      'the left column',
    ).toHaveLength(3)
    expect(
      sides.filter((side) => side === 'right'),
      'the right column',
    ).toHaveLength(3)
  })
})

describe('K: the prose in the cards stops saying what is no longer true', () => {
  it('K10 long-night still has no layout key at all (this ticket does not add one)', () => {
    const raw = rawOf(LONG_NIGHT_CARD)
    expect(
      Object.hasOwn(raw.display, 'layout'),
      'long-night grew a layout key: that is outside this ticket',
    ).toBe(false)
  })

  it('K11 no card prose names the full screen, the drawer, or the world panel any more', () => {
    // 票 68b：扫描面从"只有 `layout`"扩到三段散文（`layout` / `time` / `scroll`），
    // 词表多一个 `世界面板` —— 只扫 `layout` 就漏掉 `scroll` 里那句「世界面板放不下就加滚动条」。
    let read = 0
    for (const { name, path } of CARDS) {
      const display = rawOf(path).display as Record<string, unknown>
      for (const key of PROSE_KEYS) {
        if (!Object.hasOwn(display, key)) continue
        read += 1
        const prose = String(display[key])
        expect(prose.length, name + '.' + key + ': the prose is empty').toBeGreaterThan(0)
        for (const [what, word] of [
          ['a story that takes the whole screen', SAYS_FULL_SCREEN],
          ['a drawer', SAYS_DRAWER],
          ['the world panel (removed in ticket 68)', SAYS_WORLD_PANEL],
        ] as const) {
          expect(prose, name + '.' + key + ' still says ' + what).not.toContain(word)
        }
      }
    }
    // 反面：一张卡都没有散文也照样"全过"（那这条判据什么都没读）
    expect(read, 'no card prose was read at all').toBeGreaterThan(0)
  })

  it('K12 the two cards with a layout say the blocks live in columns', () => {
    for (const path of [EXAMPLE_CARD, NIGHT_WATCH_CARD]) {
      expect(
        String(rawOf(path).display.layout ?? ''),
        path + ': the prose does not mention a column',
      ).toContain(SAYS_COLUMN)
    }
  })
})

describe('K: the format stamp moved to card/5', () => {
  it('K13 the engine constant is card/5 and every card in the repo carries it', () => {
    expect(CARD_FORMAT, 'the engine still reads the old stamp').toBe('card/5')
    for (const { name, path } of CARDS) {
      expect(rawOf(path).card.format, name + ' still carries the old stamp').toBe(CARD_FORMAT)
    }
  })
})

// ---------------------------------------------------------------------------
// D 族 —— 解构 / 分栏层（纯逻辑那一半；DOM 那一半在 display-side-dom.test.ts）
// ---------------------------------------------------------------------------

/** `blocksOfSide` 今天还不存在 ⇒ 用命名空间取，别让整份文件在**收集阶段**就炸掉 */
const splitModule = displayBlocks as unknown as Record<string, unknown>

/** 把一块表按一侧筛出来（函数不在就是这条判据自己的红） */
function blocksOfSide(blocks: unknown, side: string): Array<Record<string, any>> {
  const fn = splitModule.blocksOfSide
  expect(typeof fn, 'the split of blocks into sides has no pure-function entry point (contract 3.4)').toBe(
    'function',
  )
  return (fn as (list: unknown, one: string) => Array<Record<string, any>>)(blocks, side)
}

describe('D: every block carries the side its declaration named', () => {
  it('D1 worldBlocks puts the declared side on the block it builds', () => {
    const decl = declOf([
      { path: 'world.map', title: 'the map', format: 'grouped', side: 'left' },
      { path: 'roles', title: 'the cast', format: 'grouped', side: 'left' },
      { path: 'lead.pack', title: 'the pack', format: 'list', side: 'right' },
    ])
    expect(
      worldBlocks(decl).map((block) => (block as unknown as Record<string, unknown>).side),
      'the block does not know which side it belongs to',
    ).toEqual(decl.sidebar.map((entry) => entry.side))
  })

  it('D2 the side split has a pure-function entry point of its own', () => {
    expect(
      typeof splitModule.blocksOfSide,
      'blocksOfSide is missing: the screen would have to filter inline, and nothing could pin it',
    ).toBe('function')
  })

  it('D3 the split is a filter: declared order kept, nothing added, nothing copied', () => {
    const decl = declOf([
      { path: 'world.map', title: 'the map', format: 'grouped', side: 'left' },
      { path: 'lead.pack', title: 'the pack', format: 'list', side: 'right' },
      { path: 'roles', title: 'the cast', format: 'grouped', side: 'left' },
    ])
    const built = worldBlocks(decl)
    const left = blocksOfSide(built, 'left')
    const right = blocksOfSide(built, 'right')

    expect(
      left.map((block) => block.name),
      'the left column, in declared order',
    ).toEqual(['world.map', 'roles'])
    expect(
      right.map((block) => block.name),
      'the right column, in declared order',
    ).toEqual(['lead.pack'])
    // 一块不多一块不少：两侧拼起来就是原表（顺序也是原序 —— 左在前、右在后）
    expect([...left, ...right].length, 'a block was dropped or duplicated by the split').toBe(built.length)
    // 筛，不是复制：同一块在两侧还是同一个对象（复制会让"一块"变成两份事实）
    expect(left[0], 'the split copied the block instead of filtering').toBe(built[0])
  })

  it('D4 a card with one right block and a card with no blocks at all', () => {
    const nightBlocks = worldBlocks(displayOf(rawOf(NIGHT_WATCH_CARD) as never))
    expect(
      nightBlocks.map((block) => block.name),
      'night-watch declares one block',
    ).toHaveLength(1)
    expect(
      (nightBlocks[0] as unknown as Record<string, unknown>).side,
      'the single block of night-watch must stay on the right',
    ).toBe('right')
    expect(blocksOfSide(nightBlocks, 'left'), 'a one-sided card still has an empty other side').toEqual([])

    const longBlocks = worldBlocks(displayOf(rawOf(LONG_NIGHT_CARD) as never))
    expect(longBlocks, 'long-night declares an empty sidebar').toEqual([])
    expect(blocksOfSide(longBlocks, 'left').length + blocksOfSide(longBlocks, 'right').length).toBe(0)
  })
})
