/**
 * save 测试 —— 外部数据的**纯校验**：初始帧、卡的身份、字段规范化、状态树与 schema。
 *
 * 末尾还有一条：**事件 kind 那张表里的每一种都要能存档往返**（表本身从源码现读，见文末）。
 *
 * localStorage 的读写与坏档备份在 tests/storage.test.ts 与 tests/state.test.ts。
 */
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createInitialState, identityOf, normalize, parseSave } from '../src/game/save'
import { instantiate } from '../src/game/card-state'
import { clockIn } from '../src/game/card-time'
import { currentCard } from '../src/game/current-card'
import { t } from '../src/i18n'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import type { GameData } from '../src/types/state'

/* ---- 测试自己编的 fixture（非产品文案） ---- */
const TRUNCATED_JSON = '{ broken'
const JSON_STRING = '"a string"'
const FILLER = 'filler'

/** 一份合法存档的一份深拷贝（每个反例只改一处） */
function savedGame(): GameData {
  return JSON.parse(JSON.stringify(createInitialState(currentCard))) as GameData
}

describe('createInitialState', () => {
  it('builds a fresh tree per call (two games never share their arrays)', () => {
    const a = createInitialState(currentCard)
    const b = createInitialState(currentCard)
    expect(a).not.toBe(b)
    expect(a.state).not.toBe(b.state)
    // ⚠️ 时刻住在状态树里（R39）⇒ 两份开局不共享那一刻的那一格
    expect(clockIn(a.state)).not.toBe(clockIn(b.state))
    const untouched = structuredClone(b.state.roles)
    ;(a.state.roles as Record<string, unknown>)['someone'] = { tier: 'major' }
    expect(b.state.roles).toEqual(untouched)
  })

  it('carries the card identity and the card clock', () => {
    const d = createInitialState(currentCard)
    expect(d.meta.card).toEqual(identityOf(currentCard))
    expect(d.meta.turn).toBe(0)
    expect(clockIn(d.state)).toEqual(clockIn(instantiate(currentCard)))
    // 引擎手里没有第二份时钟（顶层那个字段没有了）
    expect(Object.hasOwn(d, 'time')).toBe(false)
  })

  it('works for any card (the identity follows the card, not the engine)', () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    expect(createInitialState(card).meta.card.id).toBe(card.card.id)
  })
})

describe('normalize - the card identity is a hard gate', () => {
  it('accepts a save written by the same card', () => {
    const d = normalize(savedGame(), currentCard)
    expect(d.meta.card).toEqual(identityOf(currentCard))
    expect(d.meta.turn).toBe(0)
  })

  it('refuses a save that records no card identity', () => {
    const save = savedGame()
    delete (save.meta as { card?: unknown }).card
    expect(() => normalize(save, currentCard)).toThrow(t('save.cardMissing'))
  })

  it('refuses a card identity whose fields are not strings', () => {
    const save = savedGame()
    ;(save.meta as { card: unknown }).card = { id: 42, version: '0.1.0', format: 'card/3' }
    expect(() => normalize(save, currentCard)).toThrow(t('save.cardMissing'))
  })

  it('refuses a save from another card (id differs)', () => {
    const other = createInitialState(loadCard(NIGHT_WATCH_CARD))
    expect(() => normalize(other, currentCard)).toThrow(other.meta.card.id)
  })

  it('refuses a save whose version differs (the schema may have moved)', () => {
    const save = savedGame()
    save.meta.card.version = '9.9.9'
    expect(() => normalize(save, currentCard)).toThrow(
      t('save.cardMismatch', { saved: '', current: '' }).slice(0, 8),
    )
  })

  it('refuses a save in another format', () => {
    const save = savedGame()
    save.meta.card.format = 'card/2'
    expect(() => normalize(save, currentCard)).toThrow('card/2')
  })

  it('refuses things that are not objects at all', () => {
    for (const bad of [null, undefined, [], 'x', 42, true]) {
      expect(() => normalize(bad, currentCard), String(bad)).toThrow(t('save.notValid'))
    }
  })
})

describe('normalize - field-level sanitation', () => {
  it('coerces the turn count to a number (a string would make endTurn concatenate "51")', () => {
    const save = savedGame()
    save.meta.turn = '7' as unknown as number
    expect(normalize(save, currentCard).meta.turn).toBe(7)

    const bad = savedGame()
    bad.meta.turn = -5
    expect(normalize(bad, currentCard).meta.turn).toBe(0)
  })

  it('fills missing events and timeline with empty arrays', () => {
    const save = savedGame() as unknown as Record<string, unknown>
    delete save.events
    delete save.timeline
    const d = normalize(save, currentCard)
    expect(d.events).toEqual([])
    expect(d.timeline).toEqual([])
  })

  it('drops events with an unknown kind and keeps the detail of the known ones', () => {
    const save = savedGame()
    save.events = [
      { kind: 'narration', text: 'story', at: '' },
      { kind: 'nonsense', text: 'not a thing', at: '' },
      { kind: 'tool', text: 'tool call', detail: '{"a":1}', at: '' },
      { kind: 'toolResult', text: 'result', detail: 42, at: '' },
    ] as GameData['events']
    const d = normalize(save, currentCard)
    expect(d.events.map((event) => event.kind)).toEqual(['narration', 'tool', 'toolResult'])
    expect(d.events[1].detail).toBe('{"a":1}')
    // detail 不是字符串就当没有，不让渲染层拿到数字
    expect(d.events[2].detail).toBeUndefined()
  })

  it('keeps the structured debug fields (node / tool / path) but value only on stateChange', () => {
    const save = savedGame()
    save.events = [
      {
        kind: 'stateChange',
        text: 'wrote world.location',
        node: 'map-node',
        tool: 'move_to',
        path: 'world.location',
        value: { area: 'x' },
        at: '',
      },
      // 手改过的存档什么都可能有：非字符串的结构化字段一律当没有
      { kind: 'tool', text: 'call', node: 7, tool: null, path: 'ignored', value: 1, at: '' },
    ] as unknown as GameData['events']
    const d = normalize(save, currentCard)
    expect(d.events[0].node).toBe('map-node')
    expect(d.events[0].tool).toBe('move_to')
    expect(d.events[0].path).toBe('world.location')
    expect(d.events[0].value).toEqual({ area: 'x' })
    expect(d.events[1].node).toBeUndefined()
    expect(d.events[1].tool).toBeUndefined()
    expect(d.events[1].path).toBe('ignored')
    expect(d.events[1].value).toBeUndefined()
  })

  it('keeps every story event in the stream (no cap on the model memory)', () => {
    const save = savedGame()
    save.events = Array.from({ length: 200 }, (_, i) => ({
      kind: 'narration',
      text: FILLER + i,
      at: '',
    })) as GameData['events']
    const d = normalize(save, currentCard)
    expect(d.events, 'reloading must not drop story events').toHaveLength(200)
    expect(d.events[0].text, 'the earliest story event survives the reload').toBe(FILLER + '0')
    expect(d.events.at(-1)?.text).toBe(FILLER + '199')
  })

  it('sanitizes timeline entries and caps them', () => {
    const save = savedGame()
    save.timeline = [
      { from: 'a', to: 'b', reason: 'r', minutes: '15', at: '' },
      { from: 'c' },
    ] as unknown as GameData['timeline']
    const d = normalize(save, currentCard)
    expect(d.timeline[0].minutes).toBe(15)
    expect(d.timeline[1].reason).toBe('')
    expect(d.timeline[1].minutes).toBe(0)

    const many = savedGame()
    many.timeline = Array.from({ length: 60 }, (_, i) => ({
      from: 'a' + i,
      to: 'b' + i,
      reason: '',
      minutes: 60,
      at: '',
    }))
    expect(normalize(many, currentCard).timeline).toHaveLength(40)
  })

  it('refuses a save whose state tree lost the clock', () => {
    const save = savedGame() as unknown as Record<string, unknown>
    const world = (save.state as Record<string, unknown>).world as Record<string, unknown>
    delete world.time
    expect(() => normalize(save, currentCard)).toThrow(t('save.badTime', { message: '' }).slice(0, 6))
  })
})

describe('normalize - the state tree must match the card schema', () => {
  it('refuses a branch the card does not declare', () => {
    const save = savedGame()
    save.state = { ...save.state, nowhere: {} }
    expect(() => normalize(save, currentCard)).toThrow('state.nowhere')
  })

  it('refuses a value that does not fit the schema', () => {
    const save = savedGame()
    const lead = save.state.lead as Record<string, unknown>
    // ⚠️ 段 3 之后作者起的键名是中文（测试代码必须 ASCII）⇒ 那两个名字从卡的 schema 里现取：
    //    「里面还有一层 fields 的那一段」+「它下面类型是 integer 的那一栏」
    const leadFields = (currentCard.state as unknown as { lead: { fields: Record<string, any> } }).lead.fields
    const traitsKey = Object.keys(leadFields).find((key) => leadFields[key].fields !== undefined) as string
    const numberKey = Object.keys(leadFields[traitsKey].fields).find(
      (key) => leadFields[traitsKey].fields[key].type === 'integer',
    ) as string
    const traits = lead[traitsKey] as Record<string, unknown>
    traits[numberKey] = 'strong'
    expect(() => normalize(save, currentCard)).toThrow('state.lead.' + traitsKey + '.' + numberKey)
  })

  it('refuses a state that is not an object', () => {
    const save = savedGame() as unknown as Record<string, unknown>
    save.state = 'nope'
    expect(() => normalize(save, currentCard)).toThrow(t('save.badState', { message: '' }).slice(0, 6))
  })

  it('refuses a clock outside the card calendar', () => {
    const save = savedGame()
    const world = save.state.world as Record<string, unknown>
    world.time = { ...(world.time as Record<string, unknown>), month: 13 }
    expect(() => normalize(save, currentCard)).toThrow('time.month')
  })
})

describe('parseSave (the import-file path)', () => {
  it('accepts a valid save', () => {
    const json = JSON.stringify(createInitialState(currentCard))
    expect(parseSave(json, currentCard).meta.card).toEqual(identityOf(currentCard))
  })

  it('rejects non-objects and arrays', () => {
    for (const bad of ['[]', JSON_STRING, '{"player": 1}', '{}']) {
      expect(() => parseSave(bad, currentCard), bad).toThrow()
    }
  })

  it('throws a parse error on broken JSON', () => {
    expect(() => parseSave(TRUNCATED_JSON, currentCard)).toThrow()
  })
})

/* ---- 事件 kind 那一张表：**从源码现读**，这里不抄第二份 ---- */

/** 表在哪（`EVENT_KINDS`）：存档清洗按它放行，不在表里的一律丢掉 */
const SAVE_SOURCE = 'src/game/save.ts'
/** 类型在哪（`EventKind` 联合）：**该有哪些 kind** 的权威声明 */
const KINDS_SOURCE = 'src/types/state.ts'
/** 表里没有、类型里也没有的那种 kind —— 负控用（手改过的存档里什么都可能有） */
const NOT_A_KIND = 'zzFake'

/**
 * 把一份源码读成 AST（只解析，不 resolve 任何东西、不起子进程）。
 *
 * ⚠️ 不用正则抠那几行：表的写法随排版变（多一个空行、换一种引号），而正则一失配
 *    就会「什么都没读到 ⇒ 遍历 0 次 ⇒ 绿」—— 静默失效的判据比没有判据更坏，
 *    所以读不出来一律由调用方抛出来（见下面两个函数）。
 */
function sourceFileOf(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true)
}

/** 在 AST 里找名为 name 的变量声明（找不到返回 null，由调用方喊出来） */
function variableNamed(node: ts.Node, name: string): ts.VariableDeclaration | null {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) return node
  for (const child of node.getChildren()) {
    const hit = variableNamed(child, name)
    if (hit !== null) return hit
  }
  return null
}

/** 在 AST 里找名为 name 的 type 别名（找不到返回 null，由调用方喊出来） */
function typeAliasNamed(node: ts.Node, name: string): ts.TypeAliasDeclaration | null {
  if (ts.isTypeAliasDeclaration(node) && node.name.text === name) return node
  for (const child of node.getChildren()) {
    const hit = typeAliasNamed(child, name)
    if (hit !== null) return hit
  }
  return null
}

/** 读对象字面量的键（只收 `kind: true` 与 `kind` 两种写法，引号剥掉） */
function objectKeys(literal: ts.ObjectLiteralExpression): string[] {
  const keys: string[] = []
  for (const property of literal.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
    keys.push(property.name.getText().replace(/^['"]|['"]$/g, ''))
  }
  return keys
}

/** 读那张事件 kind 表 —— 名字只在这里出现一次，别处一律用它读出来的结果 */
function tableKeysOf(tableName: string, file: string): string[] {
  const initializer = variableNamed(sourceFileOf(file), tableName)?.initializer
  if (initializer === undefined || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error('no object literal named ' + tableName + ' in ' + file)
  }
  const keys = objectKeys(initializer)
  if (keys.length === 0) throw new Error(tableName + ' reads as an empty table in ' + file)
  return keys
}

/** 读 `EventKind` 联合里声明了哪些 kind */
function declaredKindsOf(typeName: string, file: string): string[] {
  const alias = typeAliasNamed(sourceFileOf(file), typeName)
  if (alias === null || !ts.isUnionTypeNode(alias.type)) {
    throw new Error('no union type named ' + typeName + ' in ' + file)
  }
  return alias.type.types.map((member) => member.getText().replace(/^['"]|['"]$/g, ''))
}

describe('normalize - every kind in the event table survives a save round trip', () => {
  it('keeps an event of every kind the table and the type declare, and drops what is not one', () => {
    // 🔴 两张单子都**从源码现读**（表 + 它该对应的联合类型），这里一个 kind 名字都不写死：
    //    写死名单的判据，下次谁再加一种就当场失效 —— 而「加了一种、没有任何检查会红」
    //    正是这条判据要防的形状。
    const table = tableKeysOf('EVENT_KINDS', SAVE_SOURCE)
    const declared = declaredKindsOf('EventKind', KINDS_SOURCE)
    // 守卫：表与类型必须逐个对上 —— 表里少一行，"遍历表"就永远走不到那一种，这条判据会**静默变弱**
    expect(
      declared.filter((kind) => !table.includes(kind)),
      'declared but missing from the table',
    ).toEqual([])
    expect(
      table.filter((kind) => !declared.includes(kind)),
      'in the table but not declared anywhere',
    ).toEqual([])

    const save = savedGame()
    // 输入遍历**两张单子的并集**：表里少一种（漏登记）或多种（登记了类型里没有的）都会在这里露出来。
    // ➕ 负控两条：一条**根本不是事件**、一条 kind 谁都不认 —— 少了它们，这条判据分不出
    //    「每一种都留下来了」与「它其实什么都没丢」（清洗整个失效时，上面的断言照样绿）。
    const raw: unknown[] = [
      ...[...new Set([...table, ...declared])].map((kind) => ({ kind, text: 'round trip ' + kind, at: '' })),
      null,
      { kind: NOT_A_KIND, text: 'not a kind', at: '' },
    ]
    save.events = raw as GameData['events']

    // 存下去（写成 JSON）→ 读回来（parseSave 就是导入存档那条路）⇒ 还是那些 kind，一条不多一条不少
    const reloaded = parseSave(JSON.stringify(normalize(save, currentCard)), currentCard)
    expect(
      reloaded.events.map((event) => event.kind).sort(),
      'every declared kind must survive the round trip, and nothing else may',
    ).toEqual(declared.slice().sort())
  })
})
