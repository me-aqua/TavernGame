/**
 * 票 60 · 段 4「几刀删除」：七样已拍板砍掉的东西不该再留在卡里。
 *
 * 契约 `.team/test/2026-09-19/contract-60.md`；S0 在 `.team/leader/2026-09-19/段4-S0.md`。
 *
 * ⚠️ **同名不同义**（S0 §四，跟段 1 那个 `required` 是同一族）：
 *   · 地图条目的 `kind`（来源）**要删**；关系里的 `kind`（who / kind / story）**要留**（判据 2 反控）；
 *   · `world.location` 那一枝**要删**；散文里提到「位置」的句子**不在本段的判据里**
 *     （S0 §五：不顺手改散文）—— 契约 §2 点名了这件事，别把它读成"漏了"。
 * ⚠️ 全 ASCII：`.githooks/checks/ascii.mjs` 连 `tests/` 里的字符串字面量一起拦 ⇒
 *   卡是按 JSON 模块读进来的；剧本里那个中文字用**码点**构造（见 `CHAIN_CHAR`）。
 */
import { describe, expect, it } from 'vitest'
import { parseCard, type CardData } from '../src/game/card'
import { toolSchemas } from '../src/game/card-actions'
import longNight from '../cards/long-night.json'
import morningwind from '../cards/morningwind.json'
import nightWatch from '../cards/night-watch.json'

/** 两张受影响的卡（`night-watch.json` 本来就干净，判据 10 守它别被弄脏） */
const CARDS: Array<{ name: string; card: Record<string, unknown> }> = [
  { name: 'morningwind', card: morningwind as Record<string, unknown> },
  { name: 'long-night', card: longNight as Record<string, unknown> },
]

/**
 * 剧本里「故事链」那个字 —— 删掉的那段就是它的唯一出处。
 *
 * ⚠️ 这里只能用码点构造：`ascii.mjs` 连测试里的中文字面量一起拦（票 54 实测）。
 * 判据是**代理**：那个字从 `script` 里消失 = 那段没了（契约 §2 写明了它是代理，不是字面核对）。
 */
const CHAIN_CHAR = String.fromCharCode(0x94fe)

/** 按字面路径取值（卡里的 `fields` / `of` 就是普通键，所以直接走） */
function at(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    const scope = node as Record<string, unknown> | undefined
    return scope === undefined || scope === null ? undefined : scope[key]
  }, root)
}

/** 一个动作的 `path`（`world.map`）在卡的 schema 里对应的路径（`state.world.fields.map`） */
function schemaPathOf(actionPath: string): string {
  return 'state.' + actionPath.split('.').join('.fields.')
}

/** `whoIsWhere` 每一条的三个栏目（R20 ③：位置只有一处可查） */
const WHERE_FIELDS = ['area', 'scene', 'spot']

/** 卡里的节点与动作（形状固定：`graph.nodes` / `actions`） */
function nodesOf(card: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (at(card, 'graph.nodes') ?? {}) as Record<string, Record<string, unknown>>
}

function actionsOf(card: Record<string, unknown>): Record<string, Record<string, unknown>> {
  return (at(card, 'actions') ?? {}) as Record<string, Record<string, unknown>>
}

describe('the seven deletions: nothing of them may stay in the cards', () => {
  it('1 the story-chain branch is gone, and no action points at it any more', () => {
    for (const { name, card } of CARDS) {
      expect(at(card, 'state.world.fields.chains'), name).toBeUndefined()
      for (const [id, action] of Object.entries(actionsOf(card))) {
        const path = action.path
        if (typeof path === 'string') expect(path.startsWith('world.chains'), name + '.' + id).toBe(false)
      }
    }
  })

  it('2 the relations kind is still there (the other sense of the same word)', () => {
    const relations = at(CARDS[0].card, 'state.roles.of.fields.relations')
    expect(relations, 'morningwind must still describe relations').toBeDefined()
    expect(at(CARDS[0].card, 'state.roles.of.fields.relations.of.fields.kind')).toBeDefined()
    expect(at(CARDS[0].card, 'state.roles.of.fields.relations.of.fields.story')).toBeDefined()
  })

  it('3 the location branch is gone, and whoIsWhere carries the three-part shape', () => {
    for (const { name, card } of CARDS) {
      expect(at(card, 'state.world.fields.location'), name).toBeUndefined()
      expect(at(card, 'state.world.fields.map'), name + ' must still have the map').toBeDefined()
    }
    // ⚠️ R20 ③：位置只剩一处可查 ⇒ `whoIsWhere` **每一条都是 {area, spot, scene}**，不再是一个字符串。
    //    这里**不**断 `of` 的具体写法（对象/引用都行），只断"三条栏目齐全"。
    const where = at(CARDS[0].card, 'state.world.fields.whoIsWhere') as Record<string, unknown> | undefined
    expect(where, 'morningwind must still have whoIsWhere').toBeDefined()
    expect(Object.keys((at(where, 'of.fields') ?? {}) as Record<string, unknown>).sort()).toEqual(
      WHERE_FIELDS,
    )
    const initial = (at(where, 'initial') ?? {}) as Record<string, unknown>
    expect(Object.keys(initial).length, 'whoIsWhere must have entries').toBeGreaterThan(0)
    for (const [who, entry] of Object.entries(initial)) {
      expect(Object.keys(entry as Record<string, unknown>).sort(), who).toEqual(WHERE_FIELDS)
    }
  })

  it('4 move_to is gone (the action and every tool list that named it)', () => {
    for (const { name, card } of CARDS) {
      expect(at(card, 'actions.move_to'), name).toBeUndefined()
    }
  })

  it('5 the map entry kind is gone, from the schema and from every entry', () => {
    for (const { name, card } of CARDS) {
      expect(at(card, 'state.world.fields.map.of.fields.kind'), name).toBeUndefined()
      const initial = (at(card, 'state.world.fields.map.initial') ?? {}) as Record<string, unknown>
      for (const [area, entry] of Object.entries(initial)) {
        expect((entry as Record<string, unknown>).kind, name + '.' + area).toBeUndefined()
      }
    }
  })

  it('6 the tier field is gone, from the schema and from every role', () => {
    const roles = at(CARDS[0].card, 'state.roles') as Record<string, unknown> | undefined
    expect(roles, 'morningwind still has roles').toBeDefined()
    expect(at(CARDS[0].card, 'state.roles.of.fields.tier')).toBeUndefined()
    const initial = (at(CARDS[0].card, 'state.roles.initial') ?? {}) as Record<string, unknown>
    for (const [who, entry] of Object.entries(initial)) {
      expect((entry as Record<string, unknown>).tier, who).toBeUndefined()
    }
  })

  it('7 the story-chain paragraph is gone from the script', () => {
    for (const { name, card } of CARDS) {
      expect(JSON.stringify(at(card, 'script')), name + ': the chain paragraph must be gone').not.toContain(
        CHAIN_CHAR,
      )
    }
  })

  it('8 verify no longer holds update_role, while cast still does', () => {
    const nodes = nodesOf(CARDS[0].card)
    expect(nodes.verify?.tools, 'the proofreading step must not write roles').not.toContain('update_role')
    expect(nodes.cast?.tools, 'the cast step still creates roles').toContain('update_role')
  })

  it('12 the map prompt and the map tools description no longer name the deleted fields', () => {
    // ⚠️ S0 §五之二：那两句（「更新 location 与 whoIsWhere」「地图条目要带 kind」）**允许改** ——
    //    理由是**删除的直接后果**：留着就是让模型照着不存在的字段干活，不是"顺手改措辞"。
    // ⚠️ **只查地图节点**：`kind` 在另一个语境里是**要留的**（关系标签 —— 判据 2），
    //    而角色节点的提示词正当地写着「`relations` 写标签 + 经历（`kind` + `story`）」——
    //    全局扫 `kind` 会把那条正当用法判成红（我第一版就是这么写的，被参考实现的读数当场抓出来）。
    const map = nodesOf(CARDS[0].card).map
    expect(map, 'morningwind still has a map node').toBeDefined()
    const prompt = JSON.stringify(map?.prompt ?? '')
    expect(prompt, 'the map node prompt must not name location').not.toContain('location')
    expect(prompt, 'the map node prompt must not name kind').not.toContain('kind')

    // ⚠️ **同一族的另一半**：**schema 的 `note` 也会到模型面前** —— `toolSchemas()` 产生的
    //    `function.description` 就是"动作的 what + 路径上的 note"（实测：`add_place` 的说明里原样印着
    //    `- [world.map] …带「来源」（作者预设 / AI 生成）…`）⇒ 只守节点提示词等于只守了一半。
    //    范围（口径写在契约 §3 的注里）：**所有工具说明**不许出现 `chains` / `location` / `move_to` / `tier` /「来源」；
    //    而 `kind` **只在写地图那一枝的工具**里禁 —— 关系那一枝的 `kind` 是要留的（判据 2）。
    const SOURCE = String.fromCharCode(0x6765, 0x6e90) // 「来源」：被删的 kind 的 note 里那个词（中文字面量进不了这个文件）
    const KNOWN = String.fromCharCode(0x5df2, 0x77e5) // 「未知」的反面：「已知」——那个栏目整张卡里从来没有过
    const gone = ['chains', 'location', 'move_to', 'tier', SOURCE, KNOWN]
    for (const { name, card } of CARDS) {
      for (const nodeId of (at(card, 'graph.topology') ?? []) as string[]) {
        for (const tool of toolSchemas(card as unknown as CardData, nodeId)) {
          const text = tool.function.description
          for (const word of gone) {
            expect(text, name + '.' + tool.function.name + ' names ' + word).not.toContain(word)
          }
          const path = (actionsOf(card)[tool.function.name] ?? {}).path
          if (typeof path === 'string' && path.startsWith('world.map')) {
            expect(text, name + '.' + tool.function.name + ' names the map kind').not.toContain('kind')
          }
        }
      }
    }
  })

  it('13 the lead has a starting position in whoIsWhere (R20 part two)', () => {
    // R20 ②「主控的位置并入谁在哪」⇒ 新开局那一帧必须答得出"你在哪"（今天 initial 里只有萨伦）。
    // 键 = **主控的名字**（R20：顶栏「场景」靠主控的名字查表）—— 名字从卡里现取，不写死、也不写中文字面量。
    const card = CARDS[0].card
    const leadName = at(card, 'state.lead.fields.name.initial') ?? at(card, 'opening.defaultName')
    expect(typeof leadName, 'the card must declare the lead name').toBe('string')
    const initial = (at(card, 'state.world.fields.whoIsWhere.initial') ?? {}) as Record<string, unknown>
    const start = initial[leadName as string] as Record<string, unknown> | undefined
    expect(start, 'the lead must have a starting position under ' + String(leadName)).toBeDefined()
    expect(Object.keys(start ?? {}).sort(), 'the lead entry has the three fields').toEqual(WHERE_FIELDS)
    for (const field of WHERE_FIELDS) expect(typeof start?.[field], field).toBe('string')
  })
})

describe('the cards must stay loadable and consistent', () => {
  it('9 both cards still load (parseCard does not throw)', () => {
    for (const { name, card } of CARDS) {
      expect(() => parseCard(JSON.stringify(card)), name).not.toThrow()
    }
  })

  it('10 no dangling reference is left behind (S0 risk 2)', () => {
    for (const { name, card } of CARDS) {
      for (const [id, action] of Object.entries(actionsOf(card))) {
        const path = action.path
        if (typeof path !== 'string') continue
        expect(at(card, schemaPathOf(path)), name + '.' + id + ' points at ' + path).toBeDefined()
      }
      for (const [id, node] of Object.entries(nodesOf(card))) {
        for (const tool of (node.tools ?? []) as string[]) {
          expect(actionsOf(card)[tool], name + '.' + id + ' names the tool ' + tool).toBeDefined()
        }
        for (const read of (node.reads ?? []) as string[]) {
          expect(at(card, 'state.' + read), name + '.' + id + ' reads ' + read).toBeDefined()
        }
      }
    }
  })

  it('11 night-watch is not dirtied: it never had any of the seven', () => {
    const card = nightWatch as Record<string, unknown>
    expect(at(card, 'state.world')).toBeUndefined()
    expect(at(card, 'state.roles')).toBeUndefined()
    expect(at(card, 'state.chains')).toBeUndefined()
    expect(at(card, 'actions.move_to')).toBeUndefined()
    expect(at(card, 'actions.update_role')).toBeUndefined()
    expect(JSON.stringify(at(card, 'script'))).not.toContain(CHAIN_CHAR)
    expect(() => parseCard(JSON.stringify(card))).not.toThrow()
  })
})
