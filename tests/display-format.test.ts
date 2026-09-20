/**
 * 票 63 · 段 6：**侧栏条目 = 一枝状态的路径 + 标题 + 一种预设格式**（R12/R13/R14）。
 *
 * 契约 `.team/test/2026-09-19/contract-63.md`；S0 `.team/leader/2026-09-19/段6-S0.md`。
 *
 * 这一件测**声明侧**：卡里写的那一份声明对不对、载入期拦不拦得住。
 *   · 侧栏条目只认三样：`path`（状态路径）/ `title`（标题）/ `format`（预设格式）；
 *   · 三种格式各自要求那一枝是**什么容器**（键值 ↔ object / 列表 ↔ list / 分组列表 ↔ map）；
 *   · 对不上就**载入即失败**（R14）—— 坏声明不许静默少画一块。
 *     ⚠️ 那条纪律原来住在 `src/components/display-blocks.ts` 的头注释里（模块加载期炸）；
 *        形状换成卡声明之后它搬进卡校验器，**这一件就是它的新家**。
 *   · 渲染侧（三种格式画得出什么）在 `display-render-dom.test.ts`。
 *
 * ⚠️ 卡里的东西一律当**数据**读（`display` 段按 unknown 取），不 import 它的类型：
 *    这一件的判据自己核形状，S2 怎么给那些名字起类型是 S2 的事。
 * ⚠️ `tests/` 里的字符串必须 ASCII（`.githooks/checks/ascii.mjs` 连测试一起拦）：
 *    卡里那几条中文路径与栏名一律**码点构造**，卡本身按 JSON 模块读进来。
 */
import { describe, expect, it } from 'vitest'
import * as card from '../src/game/card'
import { schemaAt, schemaFields, schemaType, type Schema, type StateSchema } from '../src/game/card-state'
import longNight from '../cards/long-night.json'
import morningwind from '../cards/morningwind.json'
import nightWatch from '../cards/night-watch.json'

/** 作者起的名字（段 3 改成中文）—— 码点构造，见文件头 */
const WHERE_PATH = 'world.' + '\u8c01\u5728\u54ea' // world.谁在哪（那本册子）
const LEAD_NAME_PATH = 'lead.' + '\u540d\u79f0' // lead.名称（主控的名字那一格）

/** 三种预设格式的名字 —— 引擎词表，保持 ASCII（界面上的中文标签走 i18n） */
const FORMATS = ['key-value', 'list', 'grouped'] as const

/** 格式 → 它要求那一枝是什么容器。容器名是**卡自己的 schema 词表**（`SchemaType`）。 */
const FORMAT_CONTAINER: Record<string, string> = {
  'key-value': 'object',
  list: 'list',
  grouped: 'map',
}

/** 三张卡（同一份判据在每一张上跑一遍，不许只在一张上成立） */
const CARDS: Array<{ name: string; raw: unknown }> = [
  { name: 'morningwind', raw: morningwind },
  { name: 'long-night', raw: longNight },
  { name: 'night-watch', raw: nightWatch },
]

/** 一份卡的深拷贝：反例都在副本上改一处，好让「被拒」能归因到那一处 */
function copy(raw: unknown): Record<string, any> {
  return JSON.parse(JSON.stringify(raw))
}

/** 卡里 `display` 那一段，当数据读（形状由这一件的判据自己核） */
function displayOf(raw: unknown): Record<string, any> {
  return copy(raw).display as Record<string, any>
}

/** 那一份声明（`display.sidebar`）—— 段 6 之后每项都是 `{path, title, format}` */
function entriesOf(raw: unknown): Array<Record<string, any>> {
  return (displayOf(raw).sidebar ?? []) as Array<Record<string, any>>
}

/** 一项的身份，用在失败信息里：新形状是路径，旧形状是块名（两代都读得出来） */
function identityOf(entry: Record<string, any>): string {
  return String(entry.path ?? entry.block)
}

/** 载入一张卡（形状由卡校验器守）—— 载入不了就抛，红的理由落在调用它的那条判据上 */
function load(raw: unknown): card.CardData {
  return card.parseCard(JSON.stringify(raw))
}

/** 载入被拒时的报错原文；收下了就是空串（判据自己读那句话，别只断"抛了"） */
function rejectionOf(raw: unknown): string {
  try {
    card.parseCard(JSON.stringify(raw))
    return ''
  } catch (err) {
    return String((err as Error).message)
  }
}

/** 一格 schema 的容器类型（`a.b` → `state.a.fields.b`）—— 走引擎自己的取法，不抄一份 */
function containerAt(loaded: card.CardData, path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined
  const schema: Schema | undefined = schemaAt(loaded.state, path)
  return schema === undefined ? undefined : schemaType(schema)
}

/** 某个 schema 节点的初值（`state.a.fields.b.initial`）—— 夹具的真相从卡现取 */
function initialAt(raw: unknown, path: string): unknown {
  const schema = schemaAt(copy(raw).state as StateSchema, path)
  return typeof schema === 'string' || schema === undefined ? undefined : schema.initial
}

/**
 * 卡里**点名得到**的路径按容器分类 —— 从 `state` 那张表直接走一遍，不依赖侧栏声明。
 *
 * 反例要能造得出来：路径从 schema 里挑，而不是从（还没换成新形状的）声明里挑。
 * `of` 里的元素路径不算（它没有确定的名字，不是一条能声明的枝）。
 */
function pathsByContainer(root: StateSchema): Record<string, string[]> {
  const out: Record<string, string[]> = { object: [], list: [], map: [] }
  /** 往下走一份 schema：容器就是它自己这一条路径，object 还要再进它的字段 */
  const walk = (schema: Schema, path: string): void => {
    const type = schemaType(schema)
    if (type !== 'object') {
      if (type === 'list' || type === 'map') out[type].push(path)
      return
    }
    out.object.push(path)
    for (const [key, sub] of Object.entries(schemaFields(schema) ?? {})) walk(sub, path + '.' + key)
  }
  for (const [branch, schema] of Object.entries(root)) walk(schema, branch)
  return out
}

/** 只有一条声明的卡（反例都这么造：一条声明、一处坏） */
function cardWith(entry: Record<string, unknown>): Record<string, any> {
  const broken = copy(morningwind)
  broken.display.sidebar = [entry]
  return broken
}

describe('a sidebar entry names one branch, a title and one preset format', () => {
  it('1 every card declares display.sidebar, and every entry is exactly {path, title, format}', () => {
    for (const { name, raw } of CARDS) {
      expect(Object.hasOwn(displayOf(raw), 'sidebar'), name + ' declares no display.sidebar').toBe(true)
      expect(Array.isArray(displayOf(raw).sidebar), name + ' display.sidebar is not a list').toBe(true)
      for (const entry of entriesOf(raw)) {
        const where = name + ' ' + identityOf(entry)
        expect(Object.keys(entry).sort(), where + ' carries keys no entry has').toEqual([
          'format',
          'path',
          'title',
        ])
        expect(typeof entry.title, where + ' title').toBe('string')
        expect(String(entry.title).length, where + ' title is empty').toBeGreaterThan(0)
        expect(FORMATS as readonly unknown[], where + ' format vocabulary').toContain(entry.format)
        expect(typeof entry.path, where + ' path').toBe('string')
        expect(String(entry.path).length, where + ' path is empty').toBeGreaterThan(0)
      }
    }
  })

  it('2 the declared format must match the container of the branch it names', () => {
    let checked = 0
    for (const { name, raw } of CARDS) {
      const loaded = load(raw)
      for (const entry of entriesOf(raw)) {
        const where = name + ' ' + identityOf(entry)
        const container = containerAt(loaded, entry.path)
        expect(container, where + ' names a branch this card has no schema for').toBeDefined()
        expect(
          container,
          where + ' is a ' + String(container) + ' but declares format ' + String(entry.format),
        ).toBe(FORMAT_CONTAINER[String(entry.format)])
        checked += 1
      }
    }
    // 反面：别让"一张卡都没声明"也能过（那这一条就什么都没验）
    expect(checked, 'no sidebar entry was checked in any card').toBeGreaterThan(0)
  })

  it('3 one block is one branch: the declared paths are pairwise different', () => {
    for (const { name, raw } of CARDS) {
      const paths = entriesOf(raw).map(identityOf)
      expect(new Set(paths).size, name + ' declares the same branch twice: ' + paths.join(' / ')).toBe(
        paths.length,
      )
    }
  })

  it('4 the demo card uses all three formats (R15: every preset has a real block)', () => {
    const used = new Set(entriesOf(morningwind).map((entry) => String(entry.format)))
    for (const format of FORMATS) {
      expect([...used], 'the demo card never uses the "' + format + '" format').toContain(format)
    }
  })

  it('5 the map group is one block per branch (no block reads two branches)', () => {
    const paths = entriesOf(morningwind).map(identityOf)
    // 那一组今天的枝就这两条（`world.location` 已被 R20 删掉，当前所在并进册子）
    expect(paths, 'the demo card draws the area table in no block of its own').toContain('world.map')
    expect(paths, 'the demo card draws the whereabouts book in no block of its own').toContain(WHERE_PATH)
    expect(
      paths.filter((path) => path === 'world.map' || path === WHERE_PATH).length,
      'the same branch is drawn by more than one block',
    ).toBe(2)
  })
})

describe('the load-time contract: a declaration the engine cannot draw is refused', () => {
  it('6 a path the card does not declare is refused, and the message names it', () => {
    const message = rejectionOf(cardWith({ path: 'world.nowhere', title: 'x', format: 'grouped' }))
    expect(message, 'a block pointing at a branch this card has no schema for was accepted').toContain(
      'world.nowhere',
    )
  })

  it('7 an unknown format is refused with its name, and the three known ones are accepted', () => {
    const paths = pathsByContainer(copy(morningwind).state as StateSchema)
    expect(paths.map.length, 'the demo card declares no map branch').toBeGreaterThan(0)
    const message = rejectionOf(cardWith({ path: paths.map[0], title: 'x', format: 'nowhere' }))
    expect(message, 'an unknown format was accepted (that block would silently never be drawn)').toContain(
      'nowhere',
    )
    // ⚠️ 还要断**理由**：形状那一处也会拒（容器对不上），而它的报错里**同样有格式名** ——
    //    只断格式名的话，把词表检查整个拿掉这条照样绿（"格式词表有没有牙"就没人看着了）。
    expect(message, 'refused, but not because the format is outside the vocabulary').toContain(
      'is no preset format',
    )
    // 反面：词表里那三个，各自在一条形状相符的枝上都必须收得下
    for (const format of FORMATS) {
      const path = paths[FORMAT_CONTAINER[format]][0]
      expect(path, 'the demo card has no ' + FORMAT_CONTAINER[format] + ' branch').toBeDefined()
      expect(
        rejectionOf(cardWith({ path, title: 'x', format })),
        'the known format ' + format + ' was refused on ' + path,
      ).toBe('')
    }
  })

  it('8 a format that does not match the branch container is refused (all three mismatches)', () => {
    const paths = pathsByContainer(copy(morningwind).state as StateSchema)
    const mismatches: Array<[string, string]> = [
      ['object', 'grouped'],
      ['list', 'key-value'],
      ['map', 'list'],
    ]
    for (const [container, format] of mismatches) {
      const path = paths[container][0]
      expect(path, 'the demo card has no ' + container + ' branch to break').toBeDefined()
      const message = rejectionOf(cardWith({ path, title: 'x', format }))
      expect(message, 'a ' + container + ' branch declared as ' + format + ' was accepted').toContain(path)
      expect(message, 'the refusal does not say which format was declared').toContain(format)
    }
  })

  it('9 the same branch declared twice is refused (one block is one branch, no exceptions)', () => {
    const broken = copy(morningwind)
    const first = broken.display.sidebar[0] as Record<string, unknown>
    broken.display.sidebar.push({ ...first })
    const message = rejectionOf(broken)
    expect(message, 'two blocks were allowed to read the same branch').toContain(identityOf(first))
  })

  it('10 an entry with a key no entry has is refused (a bad declaration must not be ignored)', () => {
    const paths = pathsByContainer(copy(morningwind).state as StateSchema)
    // `note` 是旧形状的第二把键（今天合法）—— 新形状里它没有位置，必须被点名拒掉
    const message = rejectionOf(
      cardWith({ path: paths.map[0], title: 'x', format: 'grouped', note: 'leftover' }),
    )
    expect(message, 'an entry carrying a leftover key was accepted').toContain('note')
  })

  it('11 the top bar declares no game state any more (R32: everything shows in the sidebar)', () => {
    for (const { name, raw } of CARDS) {
      expect(Object.hasOwn(displayOf(raw), 'topbar'), name + ' still declares display.topbar').toBe(false)
    }
    // 引擎那一侧：**词表这个导出本身**不许还在（这一条读的是引擎自己，不是卡）。
    // ⚠️ 写成 `?? []` 再断 `not.toContain('time')` 是**恒真**的（导出没了 ⇒ 空表 ⇒ 永远过），
    //    读起来像断言、其实什么都没守；要守的是"它不存在"。
    expect(
      Object.hasOwn(card as unknown as Record<string, unknown>, 'TOPBAR_ITEMS'),
      'the engine still exports a top bar vocabulary',
    ).toBe(false)
    // 反面：把 topbar 加回去 ⇒ 拒（旧键不再是合法的声明）
    const broken = copy(morningwind)
    broken.display.topbar = ['time']
    expect(rejectionOf(broken), 'display.topbar was accepted again').not.toBe('')
  })

  it('12 the scene line names the whereabouts book and the lead name cell', () => {
    const loaded = load(morningwind)
    const scene = displayOf(morningwind).scene as { path?: unknown; who?: unknown } | undefined
    expect(scene, 'the demo card declares no scene source').toBeDefined()
    const path = String(scene?.path)
    const who = String(scene?.who)
    expect(path, 'the demo card points its scene line somewhere else').toBe(WHERE_PATH)
    expect(containerAt(loaded, path), 'the scene source must be the whereabouts book (a map)').toBe('map')
    expect(who, 'the demo card reads the lead name from somewhere else').toBe(LEAD_NAME_PATH)
    const whoType = containerAt(loaded, who)
    expect(['map', 'list', 'object'], 'the lead name cell is not a scalar').not.toContain(whoType)
    // 新开局那一帧必须答得出「你在哪」：名字那一格的初值就是册子里的一条键
    const book = initialAt(morningwind, path)
    const leadName = initialAt(morningwind, who)
    expect(typeof leadName, 'the lead name cell has no initial value').toBe('string')
    expect(
      Object.keys(book as Record<string, unknown>),
      'the opening frame cannot say where the lead is',
    ).toContain(leadName)
  })

  it('13 a card without a scene source still loads, but a bad one is refused', () => {
    // 反面控制：`scene` 是可选的 —— 缺了不许把整张卡拦下来（long-night 就没有那本册子）
    expect(Object.hasOwn(displayOf(longNight), 'scene')).toBe(false)
    expect(() => load(longNight), 'a card without a scene source was refused').not.toThrow()
    // 反面中的反面：留着 scene、却指向一条**不是册子**（map）的枝 ⇒ 拒
    const broken = copy(morningwind)
    broken.display.scene = { path: 'lead.pack', who: LEAD_NAME_PATH }
    expect(rejectionOf(broken), 'a scene source pointing at a non-map branch was accepted').not.toBe('')
  })
})
