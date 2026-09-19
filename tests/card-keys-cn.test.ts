/**
 * 票 61 · 段 3：**作者起的字段名改中文**（卡里 schema 的键名不再要求 ASCII）。
 *
 * 契约 `.team/test/2026-09-19/contract-61.md`；S0 在 `.team/leader/2026-09-19/段3-S0.md`。
 *
 * ⚠️ **两条反面控制写在前面**（这两票我两次把范围写宽、两次被实测拦住）：
 *   ① **格式自己的键仍是 ASCII**（`type` / `fields` / `of` / `initial` / `note` / `state` / `settings` / `graph`…）；
 *   ② **动作名仍是 ASCII**（API 的函数名只收 `^[a-zA-Z0-9_-]+$`，段 2 实测 **HTTP 400**）。
 * ⚠️ 全 ASCII：`.githooks/checks/ascii.mjs` 连 `tests/` 里的字符串字面量一起拦 ⇒ 中文一律**码点构造**，
 *   卡本身按 JSON 模块读进来（见契约 §2 的说明）。
 */
import { describe, expect, it } from 'vitest'
import { parseCard, type CardData } from '../src/game/card'
import { toolSchemas } from '../src/game/card-actions'
import { cardSystemPrompt, nodePrompt } from '../src/agent/prompts'
import longNight from '../cards/long-night.json'
import morningwind from '../cards/morningwind.json'
import nightWatch from '../cards/night-watch.json'

/** 三张卡（`night-watch` 这一票先核过：它**有**作者起的键名 ⇒ 一起改，见契约 §1） */
const CARDS: Array<{ name: string; card: Record<string, unknown> }> = [
  { name: 'morningwind', card: morningwind as Record<string, unknown> },
  { name: 'long-night', card: longNight as Record<string, unknown> },
  { name: 'night-watch', card: nightWatch as Record<string, unknown> },
]

/**
 * schema **节点自己的**键（格式词表）—— 出现在节点上的只有这七个，不多不少。
 *
 * ⚠️ 这七个**也可以**是作者起的字段名（`note` / `role` / `name` 就是：三张卡里都有作者自己的同名字段）。
 * 判别靠**位置**，不靠名字：`fields` 表里的键是作者起的，节点上的键是格式的。
 */
const FORMAT_NODE_KEYS = new Set(['type', 'fields', 'of', 'initial', 'note', 'range', 'values'])

/**
 * 引擎**按路径点名**要的那几段状态 —— 这几段里的键**不许改中文**。
 *
 * 来历（判据 8 在参考实现上红过一次，是**判据对**）：`src/game/display.ts` 的
 * `BLOCK_STATE_PATHS`（`card.ts:47-51`）写死 `map: ['world.map']` / `cast: ['roles']` / `pack: ['lead.pack']`，
 * `SPOT_STATE_PATH`（`display.ts:114`）写死 `world.location` —— 这几段一改名，
 * `parseCard` 当场拒（实测原文：`block "map" needs state.world.map, which this card does not declare`），
 * 或者取数路径落空。
 *
 * ⚠️ **只有引擎自己写死的那四条**。`player.profile` / `world.whoIsWhere` 一度被我放进这份名单 ——
 *    **核过了，是错的**：全库 grep `whoIsWhere` / `profile` 在 `src/**` 里**一处都没有**
 *    （它们只是卡自己的 `actions[].path` 取值）⇒ 它们**可以改**，跟着动作路径一起改就行。
 */
const ENGINE_RESERVED_PATHS = new Set(['world.map', 'world.location', 'roles', 'lead.pack'])

/**
 * 引擎**自己起名**的词：工具参数（`value` / `minutes` / `reason` / `from` / `why`）、
 * 动作名、枝名、那四条引擎点名的路径段 —— 这些出现在模型看得见的文本里是**合法**的。
 *
 * 判据 5 的"裸名字"那一半要减掉它们（来历：`world.map` 这种路径段改不了，也不该被禁）。
 */
const ENGINE_VOCABULARY = new Set([
  'value',
  'minutes',
  'reason',
  'from',
  'why',
  'lead',
  'roles',
  'world',
  'player',
  'time',
  'story',
  'map',
  'location',
  'pack',
])

/**
 * 引擎**自己起名**的工具参数（`actions[].path` 指到标量时那个 `value`、`effect: "time"` 的
 * `minutes` / `reason`、`effect: "redo"` 的 `from` / `why`）—— 它们不是从卡的字段名派生的。
 *
 * ⚠️ 判据 6 第一版把工具参数**一律**要求中文 ⇒ 在参考实现上红得不对：
 *    改名改得再干净，`set_profile` 的参数照样叫 `value`（引擎给标量目标的固定名）。
 */
const ENGINE_OWN_PARAMS = new Set(['value', 'minutes', 'reason', 'from', 'why'])

/**
 * 段 3 之前那批**作者起的 ASCII 字段名** —— 判据 5 的"裸名字"那一半按这份名单扫。
 *
 * 来历：这不是我猜的，是**改名前实测出来的**（`node .tools/probe-61-keys.mjs` 的读数：
 * morningwind 64 / long-night 19 / night-watch 5，其中 ASCII 的 8 个就是下面留着的这几个）。
 * 名单写成常量，是为了让"改完之后文本里还有没有它们"能机械地查 —— 卡里已经查不到旧名字了。
 */
const OLD_FIELD_NAMES = [
  'name',
  'mood',
  'pack',
  'what',
  'when',
  'traits',
  'relations',
  'now',
  'map',
  'whoIsWhere',
  'profile',
  'race',
  'strength',
  'agility',
  'technique',
  'magic',
  'intellect',
  'charm',
  'skills',
  'bio',
  'personality',
  'who',
  'kind',
  'story',
  'count',
  'wearing',
  'injuries',
  'posture',
  'spots',
  'attitude',
  'loot',
  'loop',
  'floor1',
  'theme',
  'note',
  'scenes',
  'hostile',
  'neutral',
  'friendly',
  'down',
  'traces',
  'thing',
  'buyer',
  'role',
  'buys',
  'body',
  'mind',
  'clearance',
  'area',
  'spot',
  'scene',
]

/** `^[A-Za-z_][A-Za-z0-9_]*$` —— "还是个 ASCII 标识符" */
const ASCII_ID = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 旧英文键名的**墓碑单**（改名之后不许再出现在模型看得见的文本里）。
 *
 * 来历：我在改名**之前**把两张卡的提示词里"反引号包着的 ASCII 名"数了一遍，共 10 个
 * （`advance_time whoIsWhere now pack relations skills race kind story redo`）——
 * 其中 **`advance_time` / `redo` 是动作名**（要保持 ASCII，合法 ✓）、`story` 是 `role: "story"` 那个**格式值**（合法 ✓）
 * ⇒ 剩下这 8 个是**作者起的键名**，改完就不该再点名它们。
 */
const TOMBSTONES = [
  'whoIsWhere',
  'now',
  'pack',
  'relations',
  'skills',
  'race',
  'kind',
  'traits',
  'bio',
  'personality',
  'map',
  'profile',
]

/**
 * 一张卡里**作者起的字段/子键名**：每一层 schema 的 `fields` 表的键。
 *
 * ⚠️ 定义要写死在这儿，因为它**不是**"节点的键" —— 节点的键只有那七个格式词
 * （`type` / `fields` / `of` / `initial` / `note` / `range` / `values`），
 * 把节点键当字段名会一个都数不到（我第一版就是这样，读数 0 而 0 看着完全合理）。
 * `of` 里的元素 schema 照样往下（`relations` / `map` 的元素字段在那儿）。
 */
function fieldNames(card: Record<string, unknown>): string[] {
  const out: string[] = []
  const queue: unknown[] = Object.values((card.state ?? {}) as Record<string, unknown>)
  while (queue.length > 0) {
    const node = queue.shift()
    if (node === null || typeof node !== 'object') continue
    const fields = (node as Record<string, unknown>).fields
    for (const [key, sub] of Object.entries((fields ?? {}) as Record<string, unknown>)) {
      out.push(key)
      queue.push(sub)
    }
    const of = (node as Record<string, unknown>).of
    if (of !== null && typeof of === 'object') queue.push(of)
  }
  return out
}

/**
 * schema 里**允许改中文**的字段名 = 全部字段名 − 引擎按路径点名的那些（**按路径判，不按名字判**）。
 *
 * ⚠️ 例外不是我图省事：`world.map` / `roles` / `lead.pack` / `player.profile` 这几段是
 * **引擎自己写死**的取数路径（见 `ENGINE_RESERVED_PATHS` 的来历）。参考实现照判据 1 全改时
 * **判据 8 红了** —— 那次是判据对、实现错。范围以本函数为准。
 */
function renamableFieldNames(card: Record<string, unknown>): string[] {
  const reserved = new Set<string>()
  /** 往下走一遍，把"落在引擎点名路径上"的键名收进 `reserved` */
  const collect = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return
    for (const [key, sub] of Object.entries((node as Record<string, unknown>).fields ?? {})) {
      const child = path === '' ? key : path + '.' + key
      // 自己或**祖先**落在保留名单里 ⇒ 这一段的键不许改
      if (ENGINE_RESERVED_PATHS.has(child)) reserved.add(key)
      collect(sub, child)
    }
    collect((node as Record<string, unknown>).of, path === '' ? '*' : path + '.*')
  }
  for (const branch of branchNames(card)) collect((card.state as Record<string, unknown>)[branch], branch)
  return fieldNames(card).filter((key) => !reserved.has(key))
}

/** `state` 的直接子键 —— 引擎认的那四枝被 `BLOCK_STATE_PATHS` / 渲染器引用着，不许改名 */
function branchNames(card: Record<string, unknown>): string[] {
  return Object.keys((card.state ?? {}) as Record<string, unknown>)
}

/** 一份 schema 里所有字段的**点号路径**（`world.map` / `lead.pack` / `roles.*` …），核"引擎点名的路径还在" */
function schemaPathsOf(card: Record<string, unknown>): string[] {
  const out: string[] = []
  /** 从一份 schema 往下收字段路径；元素（`of`）只到**它自己那一层字段**为止，不再往下爆 */
  const walk = (node: unknown, prefix: string): void => {
    if (node === null || typeof node !== 'object') return
    for (const [key, sub] of Object.entries((node as Record<string, unknown>).fields ?? {})) {
      const path = prefix === '' ? key : prefix + '.' + key
      out.push(path)
      walk(sub, path)
    }
    const of = (node as Record<string, unknown>).of
    if (of !== null && typeof of === 'object') {
      const star = prefix === '' ? '*' : prefix + '.*'
      out.push(star)
      for (const [key, sub] of Object.entries((of as Record<string, unknown>).fields ?? {})) {
        out.push(star + '.' + key)
        walk(sub, star + '.' + key)
      }
    }
  }
  for (const branch of branchNames(card)) {
    // 枝名自己也是一条路径（`roles` 这种 map 枝没有 `fields`，不补这一条就只剩 `roles.*`）
    out.push(branch)
    walk((card.state as Record<string, unknown>)[branch], branch)
  }
  return out
}

/** 一个动作的 `path`（点号路径）在卡的 schema 里对应的路径：`a.b` → `state.a.fields.b` */
function schemaPathOf(actionPath: string): string {
  return 'state.' + actionPath.split('.').join('.fields.')
}

/** 按字面路径取值 */
function at(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    const scope = node as Record<string, unknown> | undefined
    return scope === undefined || scope === null ? undefined : scope[key]
  }, root)
}

/**
 * 模型看得见的那段文本 —— **口径由代码回答，不靠猜**。
 *
 * 三处来源（都在 `src/` 里查过）：
 *   · `cardSystemPrompt(card, node)` = 设定块（按节点的 `settings` 筛）+ 剧本 + 节点约定 + 生成器
 *     —— `src/agent/prompts.ts:191-198`；
 *   · `nodePrompt(card, node)` —— 节点自己的提示词（`prompts.ts:178-181`）；
 *   · `toolSchemas(card, node)` 的 `description` —— 作者写的 `what` + 这个动作写到的那几段 schema 的 `note`
 *     （`card-actions.ts:248-255` / `notesFor`）。
 *
 * ⚠️ 卡里的 `notes`（作者写给自己的备注）**不在**这里 —— 它不进任何提示词（我这一票核过）。
 */
function modelFacingText(card: Record<string, unknown>): string {
  const parts: string[] = []
  for (const nodeId of (at(card, 'graph.topology') ?? []) as string[]) {
    try {
      parts.push(cardSystemPrompt(card as unknown as CardData, nodeId))
      parts.push(nodePrompt(card as unknown as CardData, nodeId))
    } catch (err) {
      // ⚠️ 卡被改坏时（例如格式词被改名），提示词装配器会抛 —— 那是"红得对"，
      //    但这一条判据不该以抛错的形式红（说不清是哪一处），所以把错误也当成一段文本收进来。
      parts.push(String((err as Error)?.message ?? err))
    }
    for (const tool of toolSchemas(card as unknown as CardData, nodeId)) {
      parts.push(tool.function.description)
    }
  }
  return parts.join('\n')
}

/** 文本里有没有这个 ASCII 名字（**整词**：前后不能是标识符字符；`world.map` 里的 `map` 也算命中） */
function mentions(text: string, word: string): boolean {
  return new RegExp('(^|[^A-Za-z0-9_])' + word + '($|[^A-Za-z0-9_])').test(text)
}

/** 模型看得见的文本里出现过的旧 ASCII 字段名（减掉引擎自己的词 —— 那些合法） */
function leakedBareNames(card: Record<string, unknown>): string[] {
  const text = modelFacingText(card)
  return OLD_FIELD_NAMES.filter((word) => !ENGINE_VOCABULARY.has(word) && mentions(text, word))
}

describe('the author-chosen key names are no longer ASCII', () => {
  it('1 no field name is still an ASCII identifier', () => {
    for (const { name, card } of CARDS) {
      const all = fieldNames(card)
      const renamable = renamableFieldNames(card)
      const offenders = renamable.filter((key) => ASCII_ID.test(key))
      expect(
        offenders,
        name +
          ': ' +
          String(offenders.length) +
          ' of ' +
          String(renamable.length) +
          ' renamable field names are ASCII (' +
          String(all.length) +
          ' field names total, ' +
          String(all.length - renamable.length) +
          ' reserved by the engine)',
      ).toEqual([])
    }
  })

  it('6 the tool parameter names are Chinese too (a direct consequence)', () => {
    let cardDerivedTotal = 0
    for (const { name, card } of CARDS) {
      let cardDerived = 0
      for (const nodeId of (at(card, 'graph.topology') ?? []) as string[]) {
        for (const tool of toolSchemas(card as unknown as CardData, nodeId)) {
          for (const key of Object.keys(tool.function.parameters.properties ?? {})) {
            // 引擎自己起的参数名（标量目标的 `value`、`effect: "time"` 的 `minutes`/`reason`、
            // `redo` 的 `from`/`why`）不是从卡的字段名派生的，它们保持 ASCII 不算违规。
            if (ENGINE_OWN_PARAMS.has(key)) {
              expect(ASCII_ID.test(key), name + ' engine param ' + key).toBe(true)
              continue
            }
            cardDerived += 1
            expect(ASCII_ID.test(key), name + '.' + tool.function.name + ' parameter ' + key).toBe(false)
          }
        }
      }
      cardDerivedTotal += cardDerived
    }
    // 反面：别让"一个从卡派生的参数都没看到"也能通过（那这条判据就什么也没验）。
    // ⚠️ 只在**全局**数（`long-night` 只有 `advance_time` 一个动作，参数全是引擎自己的 ⇒ 它本来就是 0）。
    expect(cardDerivedTotal, 'no card-derived tool parameter in any card').toBeGreaterThan(0)
  })

  it('5 the model-facing text no longer names the old English keys', () => {
    for (const { name, card } of CARDS) {
      const text = modelFacingText(card)
      // ① 反引号形式（原口径）
      for (const old of TOMBSTONES) {
        expect(text, name + ' still names the old key ' + old).not.toContain('`' + old + '`')
      }
      // ② 点号路径：**允许**引擎点名的那几条（它们在模型看得见的文本里是合法引用），
      //    别的（= 作者起的字段拼出来的路径）一条都不许剩。
      const survivors = new Set(
        [...text.matchAll(/`?([a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9.]*)`?/g)].map((m) =>
          m[1].replace(/\.$/, ''),
        ),
      )
      const leaked = [...survivors].filter((path) => !ENGINE_RESERVED_PATHS.has(path))
      expect(leaked, name + ' still has a non-engine ASCII dotted path in model-facing text').toEqual([])
    }
  })

  // ⚠️ 同族第三次（组长判该修）：前两次漏的是"只查节点提示词、漏了工具说明"（判据 12 第一版）
  //    与"想全局禁 kind、被实测拦住"（第二版）。第三次漏的是**裸名字** ——
  //    `` `whoIsWhere` `` 有反引号才被 ① 抓到，而 `[world.whoIsWhere]` 里那个词是裸的。
  it('9 no bare old English key name reaches the model', () => {
    for (const { name, card } of CARDS) {
      const leaked = leakedBareNames(card)
      expect(leaked, name + ' still mentions these old key names in model-facing text').toEqual([])
      // 反面：确认**真的装配出了文本**（不是"扫了一段空字符串 = 全绿"）——
      // 至少要看到这个节点的显示名，而且文本得有一定长度。
      // ⚠️ 节点名**先断言它非空**：`?? ''` 取到空串时，`toContain('')` 恒真 ——
      //    那又是"读不到键、靠兜底通过"的同一个形状（`f-node-name` 那一轮逐族核出来的）。
      const text = modelFacingText(card)
      const firstNodeId = ((at(card, 'graph.topology') ?? []) as string[])[0]
      const nodeName = String(
        ((at(card, 'graph.nodes.' + firstNodeId) ?? {}) as Record<string, unknown>).name ?? '',
      )
      expect(nodeName.length, name + ' node ' + firstNodeId + ' has no display name').toBeGreaterThan(0)
      expect(text.length, name + ' model-facing text looks empty').toBeGreaterThan(200)
      expect(text, name + ' model-facing text does not contain the node name ' + nodeName).toContain(nodeName)
    }
  })
})

describe('the reverse controls: what must stay ASCII', () => {
  it('2 the format keys are still exactly the engine vocabulary', () => {
    for (const { name, card } of CARDS) {
      const bad: string[] = []
      const seen = new Set<string>()
      // ⚠️ 逐枝进 —— 别把整个 `state` 喂进来：`state` 自己那张表的键是**枝名**（作者起的），
      //    它们归判据 8 管；混进来会让这条反面控制红得不对（实测踩过，就是这一条）。
      const queue: unknown[] = branchNames(card).map(
        (branch) => (card.state as Record<string, unknown>)[branch],
      )
      while (queue.length > 0) {
        const node = queue.shift()
        if (node === null || typeof node !== 'object') continue
        for (const key of Object.keys(node as Record<string, unknown>)) {
          seen.add(key)
          // 节点上只许出现那七个格式词，而且必须是 ASCII ——
          // 改名改过头（`类型` / `字段`）两条都拦得住。作者起的名字在 `fields` 表里，不经这里。
          if (!FORMAT_NODE_KEYS.has(key)) bad.push(key)
          if (!ASCII_ID.test(key)) bad.push(key)
        }
        const fields = (node as Record<string, unknown>).fields
        if (fields !== null && typeof fields === 'object') {
          for (const sub of Object.values(fields as Record<string, unknown>)) queue.push(sub)
        }
        queue.push((node as Record<string, unknown>).of)
      }
      for (const key of Object.keys(card)) expect(ASCII_ID.test(key), name + ' top-level ' + key).toBe(true)
      expect(bad, name + ' has a renamed (or unknown) schema node key').toEqual([])
      // `type` / `fields` 是**每一张卡都在用**的格式词：它们还在，就说明"改名"没有变成"删格式"
      for (const key of ['type', 'fields']) {
        expect(seen.has(key), name + ' schema node lost ' + key).toBe(true)
      }
      const branch = at(card, 'state.' + branchNames(card)[0]) as Record<string, unknown>
      expect(typeof branch.type, name + ' schema node keeps type').toBe('string')
      expect(
        Object.keys((branch.fields ?? {}) as object).length,
        name + ' first branch must carry fields',
      ).toBeGreaterThan(0)
    }
  })

  it('3 the action names are still ASCII (the API refuses anything else)', () => {
    for (const { name, card } of CARDS) {
      const actions = (card.actions ?? {}) as Record<string, unknown>
      for (const action of Object.keys(actions)) {
        // ① 动作名自己（它**就是**发给 API 的函数名）
        expect(ASCII_ID.test(action), name + ' action ' + action).toBe(true)
        // ② `nodes[].tools` 点名的那些也必须还是动作名 —— 改名改到它们头上，
        //    节点就指向一个不存在的工具（判据 4 也守这一条，这里点名到"动作名"这条口径上）
        for (const [id, node] of Object.entries(
          (at(card, 'graph.nodes') ?? {}) as Record<string, Record<string, unknown>>,
        )) {
          for (const tool of (node.tools ?? []) as string[]) {
            expect(actions[tool], name + '.' + id + ' names a vanished tool ' + tool).toBeDefined()
          }
        }
      }
    }
  })

  it('8 the branches and the engine-named paths are still ASCII', () => {
    for (const { name, card } of CARDS) {
      // ① 枝名：`state` 的直接子键（`BLOCK_STATE_PATHS` / 渲染器 / 存档点名的是它们）
      for (const branch of branchNames(card)) {
        expect(ASCII_ID.test(branch), name + ' branch ' + branch).toBe(true)
      }
      // ② `nodes[].reads` 取的是枝名
      for (const [id, node] of Object.entries(
        (at(card, 'graph.nodes') ?? {}) as Record<string, Record<string, unknown>>,
      )) {
        for (const read of (node.reads ?? []) as string[]) {
          expect(ASCII_ID.test(read), name + '.' + id + ' reads ' + read).toBe(true)
        }
      }
      // ③ 引擎**按路径点名**的那几段：**这张卡声明了的**必须原样还在（那一段一个字符都没变）
      const paths = schemaPathsOf(card)
      for (const wanted of ENGINE_RESERVED_PATHS) {
        // ⚠️ map 型的那一枝只产出 `roles.*` 这一条路径（它的元素是任意人名）⇒ 前缀也算"声明了"
        const present = paths.some((path) => path === wanted || path.startsWith(wanted + '.'))
        if (!present) continue
        for (const segment of wanted.split('.')) {
          expect(ASCII_ID.test(segment), name + ' reserved path segment ' + segment).toBe(true)
        }
        expect(
          paths.some((path) => path === wanted),
          name + ' has no literal ' + wanted + ' path any more (only element paths like ' + wanted + '.*)',
        ).toBe(true)
      }
    }
  })
})

describe('the rename must not leave a dangling reference', () => {
  it('4 every path / read still points at something that exists', () => {
    for (const { name, card } of CARDS) {
      for (const [id, action] of Object.entries(
        (card.actions ?? {}) as Record<string, Record<string, unknown>>,
      )) {
        const path = action.path
        if (typeof path !== 'string') continue
        expect(at(card, schemaPathOf(path)), name + '.' + id + ' points at ' + path).toBeDefined()
        // ⚠️ `action.key` **不去 schema 里找**：它指的是 map 的**键**（`world.map` 的 `area`、`world.whoIsWhere` 的 `who`），
        //    那是调用时给的参数名，不是 schema 里的栏目（我第一版把它当引用查 ⇒ 判据 4 红得不对，已去掉）。
      }
      for (const [id, node] of Object.entries(
        (at(card, 'graph.nodes') ?? {}) as Record<string, Record<string, unknown>>,
      )) {
        for (const read of (node.reads ?? []) as string[]) {
          expect(at(card, 'state.' + read), name + '.' + id + ' reads ' + read).toBeDefined()
        }
        for (const tool of (node.tools ?? []) as string[]) {
          const actions = (card.actions ?? {}) as Record<string, unknown>
          expect(actions[tool], name + '.' + id + ' names the tool ' + tool).toBeDefined()
        }
      }
    }
  })

  it('7 the cards still load', () => {
    for (const { name, card } of CARDS) {
      expect(() => parseCard(JSON.stringify(card)), name).not.toThrow()
    }
  })
})
