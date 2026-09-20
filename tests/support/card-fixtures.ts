/**
 * 卡测试的共享夹具 —— 校验 / 状态 / 动作 / 渲染四组用例都用这一份。
 *
 * 最小卡故意小到只剩结构：两个节点、一份小状态、三个动作（path / time / redo 三种形状）。
 * 校验器的反例都在它的副本上改一处，于是「被拒」能归因到那一处；其余用例用它证明
 * 那些机制只认卡里的声明，不认特定一张卡的内容。
 *
 * ⚠️ 全部字符串都是 ASCII：.githooks/checks/ascii.mjs 连测试里的中文字面量也拦。
 */
import { readFileSync } from 'node:fs'
import { parseCard, type CardData } from '../../src/game/card'

/** 仓库里的示例卡 —— 九节点那张（卡的唯一事实来源之一） */
export const EXAMPLE_CARD = 'cards/morningwind.json'

/** 格式验收样板 —— 设计第 11 节那张最小完整卡 */
export const NIGHT_WATCH_CARD = 'cards/night-watch.json'

/** 第二张卡 —— 两个节点的最小卡 */
export const LONG_NIGHT_CARD = 'cards/long-night.json'

/** 夹具里两个节点的 id（拓扑里各出现一次） */
export const NODE_A = 'first'
export const NODE_B = 'second'

/**
 * 把仓库里的一张真卡读进来（走 card.ts 的校验）。
 *
 * 夹具只用仓库里的卡，不手抄第二份 —— 卡改了，测试跟着卡走。
 */
export function loadCard(path: string): CardData {
  return parseCard(readFileSync(path, 'utf8'))
}

/** 一份处处自洽的最小卡 —— 每个反例都只改它的一处 */
export function minimalCard(): Record<string, unknown> {
  return {
    card: {
      id: 'tester.demo',
      name: 'demo',
      version: '0.1.0',
      compat: '>=0.9.0',
      author: 'tester',
      format: 'card/4',
      language: 'en',
      summary: 'a minimal card',
    },
    settings: {
      world: ['a small world'],
      core: ['nothing is magic here'],
      common: ['rope', 'lamp'],
      style: ['short sentences'],
      lead: ['an ordinary person'],
    },
    script: { truth: 'nothing is what it seems' },
    convention: ['write text only', 'no json blocks'],
    graph: {
      topology: [NODE_A, NODE_B],
      nodes: {
        [NODE_A]: {
          name: 'first',
          duty: 'does the first thing',
          prompt: ['prompt line'],
          tools: ['set_place'],
          reads: ['world'],
          uses: ['places'],
        },
        [NODE_B]: {
          name: 'second',
          duty: 'writes the story',
          prompt: ['prompt line'],
          role: 'story',
          tools: [],
        },
      },
    },
    actions: {
      set_place: { what: 'move the lead', path: 'world.location' },
      move_lead: { what: 'merge the lead now', path: 'lead.now', mode: 'merge' },
      add_role: { what: 'write a role', path: 'roles', key: 'name', mode: 'merge' },
      set_where: { what: 'record where someone is', path: 'world.whoIsWhere', key: 'who' },
      grow: { what: 'append a line', path: 'lead.pack', mode: 'push' },
      advance_time: { what: 'pass time', effect: 'time' },
      redo: { what: 'redo a step', effect: 'redo' },
    },
    state: {
      lead: {
        type: 'object',
        fields: {
          name: { type: 'string', initial: 'nobody' },
          pack: { type: 'list', initial: ['rope'], of: 'string' },
          now: {
            type: 'object',
            fields: { mood: 'string', injuries: { type: 'list', of: 'string' } },
          },
        },
      },
      roles: {
        type: 'map',
        initial: {},
        of: {
          type: 'object',
          fields: {
            tier: {
              type: 'enum',
              values: ['major', 'minor'],
              note: 'major gets four segments',
            },
            mood: 'string',
          },
        },
      },
      world: {
        type: 'object',
        fields: {
          location: {
            type: 'object',
            initial: { area: 'a', spot: 'b', scene: 'c' },
            fields: { area: 'string', spot: 'string', scene: 'string' },
            note: 'where the lead is',
          },
          map: {
            type: 'map',
            initial: {},
            of: { type: 'object', fields: { kind: 'string', note: 'string' } },
          },
          whoIsWhere: { type: 'map', initial: {}, of: 'string' },
          // 时钟那一格（R39：时刻是世界状态的一部分，声明在 state.world.time）
          time: {
            type: 'object',
            initial: { year: 2026, month: 9, day: 14, hour: 19, minute: 30 },
            fields: {
              year: 'integer',
              month: 'integer',
              day: 'integer',
              hour: 'integer',
              minute: 'integer',
            },
          },
        },
      },
      player: { type: 'object', fields: { profile: { type: 'string', initial: 'a tester' } } },
    },
    time: { calendar: 'real' },
    generators: [{ name: 'places', applies: 'when a place is needed', principles: ['grow one at a time'] }],
    opening: { canName: true, defaultName: 'nobody', requirements: ['write the opening'] },
    display: {
      layout: 'full screen',
      // 一段 6：侧栏条目 = 一枝状态的路径 + 标题 + 一种预设格式（三种各来一条；
      // 分组列表 ↔ map、键值 ↔ object、列表 ↔ list —— 容器名就是下面 `state` 里的 `type`）
      sidebar: [
        { path: 'world.map', title: 'the map', format: 'grouped' },
        { path: 'world.location', title: 'where the lead is', format: 'key-value' },
        { path: 'roles', title: 'the cast', format: 'grouped' },
        { path: 'lead.pack', title: 'the pack', format: 'list' },
      ],
      // 「场景」那条固定状态行的来源：册子 + 主控名字那一格
      scene: { path: 'world.whoIsWhere', who: 'lead.name' },
      time: 'a date and a segment',
      scroll: 'scroll when full',
    },
    notes: {
      state: 'four segments: traits / relations / pack / now',
      extra: ['a note line', 'another note line'],
    },
  }
}

/** 夹具的可变副本（反例里改坏一处用） */
export function fixture(): any {
  return JSON.parse(JSON.stringify(minimalCard()))
}

/** 夹具的一份完整类型副本（给需要 CardData 的用例用） */
export function typedFixture(): CardData {
  return minimalCard() as unknown as CardData
}
