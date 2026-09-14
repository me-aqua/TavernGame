/**
 * 卡测试的共享夹具 —— 校验器与卡图（tests/card-graph.test.ts）都用这一份。
 *
 * 最小卡故意小到只剩结构：两个节点、约定里没有上游、设定块各一行。
 * 校验器的反例都在它的副本上改一处，于是「被拒」能归因到那一处；
 * 卡图那侧用它证明图的形状全部从 JSON 推得出来 —— 不认《晨风镇》的任何事实。
 */
import {
  CN_FIVE,
  CN_FOUR,
  CN_TEN,
  CN_TWO,
  GIVEN_BLOCKS,
  KEY_AREA,
  KEY_AUTHOR,
  KEY_BLOCK,
  KEY_CALENDAR,
  KEY_CARD,
  KEY_CARRY,
  KEY_COMPAT,
  KEY_CONVENTION,
  KEY_DISPLAY,
  KEY_DUTY,
  KEY_FORMAT,
  KEY_GENERATORS,
  KEY_GIVEN,
  KEY_ID,
  KEY_INHERENT,
  KEY_INITIAL,
  KEY_LANGUAGE,
  KEY_NAME,
  KEY_NODES,
  KEY_NODE_NAME,
  KEY_NOTE,
  KEY_NOW,
  KEY_OPENING,
  KEY_ORDER,
  KEY_OUTPUT,
  KEY_PLACE,
  KEY_PLACES,
  KEY_PRINCIPLE,
  KEY_PROFILE,
  KEY_PROMPT,
  KEY_RANGE,
  KEY_RELATION,
  KEY_ROLE,
  KEY_SCENE,
  KEY_SCRIPT,
  KEY_SIDEBAR,
  KEY_STAGES,
  KEY_START,
  KEY_STATE,
  KEY_TIER,
  KEY_TOPOLOGY,
  KEY_TYPE,
  KEY_VALUES,
  KEY_VERSION,
  KEY_WORLD,
  PUNCT_COLON,
  PUNCT_PERIOD,
  WORD_STAGE,
} from '../../src/game/card-keys'

/** 仓库里的示例卡 —— 卡的唯一事实来源，校验器与卡图都以它为准 */
export const EXAMPLE_CARD = 'cards/morningwind.json'

/** 夹具里两个节点的 id */
export const NODE_A = 'first'
export const NODE_B = 'second'

/** 节点约定里指代节点的圈号（⓪ 与 ①）；测试代码也得是 ASCII，所以转义写 */
const MARK_ZERO = '\u24ea'
const MARK_ONE = '\u2460'

/** 夹具里生成器原则的后半截（「个地点一个不少」）；测试代码也得是 ASCII，所以转义写 */
const PLACES_TAIL = '\u4e2a\u5730\u70b9\u4e00\u4e2a\u4e0d\u5c11'
/** 夹具里生成器的第一条原则：两个地点（数字必须跟必有地点数对得上） */
export const PRINCIPLE_TWO = CN_TWO + PLACES_TAIL
/** 同一个原则的「十个地点」版本 —— 用来走汉字数字的另一条解析路径 */
export const PRINCIPLE_TEN = CN_TEN + PLACES_TAIL
/** 同一个原则的「二十个地点」版本 */
export const PRINCIPLE_TWENTY = CN_TWO + CN_TEN + PLACES_TAIL

/** 夹具里状态.说明：四段：固有 / 关系 / 携带 / 当下。 */
export const NOTE =
  CN_FOUR +
  WORD_STAGE +
  PUNCT_COLON +
  [KEY_INHERENT, KEY_RELATION, KEY_CARRY, KEY_NOW].join(' / ') +
  PUNCT_PERIOD

/** 一个最小节点：六个键齐备、提示词非空 */
function node(id: string, order: number): Record<string, unknown> {
  return {
    [KEY_NODE_NAME]: id,
    [KEY_ID]: id,
    [KEY_ORDER]: order,
    [KEY_DUTY]: 'duty',
    [KEY_PROMPT]: ['prompt'],
    [KEY_OUTPUT]: { value: 'string' },
  }
}

/** 一份处处自洽的最小卡 —— 校验器的每个反例都只改它的一处 */
export function minimalCard(): Record<string, unknown> {
  return {
    [KEY_CARD]: {
      [KEY_ID]: 'tester.demo',
      [KEY_NAME]: 'demo',
      [KEY_VERSION]: '0.1.0',
      [KEY_COMPAT]: '>=0.1.0',
      [KEY_AUTHOR]: 'tester',
      [KEY_FORMAT]: 'card/1',
      [KEY_LANGUAGE]: 'zh-CN',
    },
    [KEY_GIVEN]: Object.fromEntries(GIVEN_BLOCKS.map((block) => [block, ['line']])),
    [KEY_SCRIPT]: { [KEY_STAGES]: [{ [KEY_STAGES]: 1 }] },
    [KEY_WORLD]: { [KEY_CALENDAR]: 'real', [KEY_AREA]: [{ [KEY_PLACES]: ['one', 'two'] }] },
    [KEY_GENERATORS]: [{ [KEY_PRINCIPLE]: [PRINCIPLE_TWO] }],
    [KEY_STATE]: {
      [KEY_NOTE]: NOTE,
      [KEY_ROLE]: {
        [KEY_INHERENT]: {
          strength: { [KEY_TYPE]: 'number', [KEY_INITIAL]: 3, [KEY_RANGE]: [1, 10] },
          race: { [KEY_TYPE]: 'string', [KEY_INITIAL]: 'human' },
        },
        [KEY_RELATION]: [],
        [KEY_CARRY]: [],
        [KEY_NOW]: [],
        [KEY_TIER]: { [KEY_TYPE]: 'string', [KEY_INITIAL]: 'main', [KEY_VALUES]: ['main', 'minor'] },
      },
    },
    [KEY_OPENING]: { [KEY_START]: { [KEY_AREA]: 'town', [KEY_PLACE]: 'inn', [KEY_SCENE]: 'hall' } },
    // 约定里每个节点一行，圈号 + id 点名这一行讲谁；两行都没提别人 —— 没有上游
    [KEY_CONVENTION]: [
      CN_FIVE + KEY_BLOCK,
      MARK_ZERO + ' ' + NODE_A + ' gets the public part',
      MARK_ONE + ' ' + NODE_B + ' gets the public part',
    ],
    [KEY_NODES]: [node(NODE_A, 0), node(NODE_B, 1)],
    [KEY_TOPOLOGY]: [NODE_A, NODE_B],
    [KEY_DISPLAY]: { [KEY_SIDEBAR]: [{ [KEY_BLOCK]: 'map' }] },
    [KEY_PROFILE]: ['profile'],
  }
}

/** 夹具的可变副本（校验器的用例里改坏一处用）*/
export function fixture(): any {
  return minimalCard()
}
