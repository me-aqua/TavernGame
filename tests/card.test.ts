/**
 * card 测试 —— 卡的形状与自洽性校验。
 *
 * 三条验收标准：仓库里的示例卡必须过、自造的最小卡必须过、每改坏一处都必须被拒
 * 而且错误信息要指到那一处的路径。反例都只在夹具上动一个地方，于是「被拒」这件事
 * 能归因到那一处 —— 不然测试自己就说不清是哪儿坏了。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard, validateCard } from '../src/game/card'
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
  KEY_CARRY,
  KEY_NOW,
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
  TOP_LEVEL_KEYS,
  WORD_STAGE,
} from '../src/game/card-keys'

/** 仓库里的示例卡 —— 校验器的第一验收标准就是它必须过 */
const EXAMPLE_CARD = 'cards/morningwind.json'

/** 夹具里两个节点的 id */
const NODE_A = 'first'
const NODE_B = 'second'

/** 夹具里生成器原则的后半截（「个地点一个不少」）；测试代码也得是 ASCII，所以转义写 */
const PLACES_TAIL = '\u4e2a\u5730\u70b9\u4e00\u4e2a\u4e0d\u5c11'
/** 夹具里生成器的第一条原则：两个地点（数字必须跟必有地点数对得上） */
const PRINCIPLE_TWO = CN_TWO + PLACES_TAIL
/** 同一个原则的「十个地点」版本 —— 用来走汉字数字的另一条解析路径 */
const PRINCIPLE_TEN = CN_TEN + PLACES_TAIL
/** 同一个原则的「二十个地点」版本 */
const PRINCIPLE_TWENTY = CN_TWO + CN_TEN + PLACES_TAIL

/** 夹具里状态.说明：四段：固有 / 关系 / 携带 / 当下。 */
const NOTE =
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

/** 一份处处自洽的最小卡 —— 每个反例都只改它的一处 */
function minimalCard(): Record<string, unknown> {
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
    [KEY_CONVENTION]: [CN_FIVE + KEY_BLOCK, NODE_A + ' then ' + NODE_B],
    [KEY_NODES]: [node(NODE_A, 0), node(NODE_B, 1)],
    [KEY_TOPOLOGY]: [NODE_A, NODE_B],
    [KEY_DISPLAY]: { [KEY_SIDEBAR]: [{ [KEY_BLOCK]: 'map' }] },
    [KEY_PROFILE]: ['profile'],
  }
}

/** 夹具的可变副本（测试里改坏一处用）*/
function fixture(): any {
  return minimalCard()
}

/** 跑一次校验，把抛出的错误读成文本（通过了就返回空串）*/
function errorOf(card: unknown): string {
  try {
    validateCard(card)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** 改坏一处 → 必须被拒，而且错误信息要指到那一处的路径 */
function expectRejected(card: unknown, path: string): void {
  expect(errorOf(card)).toContain(path)
}

describe('validateCard: the cards that must pass', () => {
  it('accepts the example card', () => {
    const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))
    expect(card[KEY_TOPOLOGY]).toHaveLength(9)
  })

  it('accepts a minimal card built by hand', () => {
    expect(validateCard(minimalCard())).toEqual(minimalCard())
  })

  it('rejects text that is not JSON at all', () => {
    expect(() => parseCard('{ broken')).toThrow('not valid JSON')
  })

  it('rejects anything that is not an object', () => {
    for (const bad of [null, 42, 'card', []]) expectRejected(bad, 'must be a JSON object')
  })
})

describe('validateCard: top level', () => {
  it('rejects a card that is missing any of the twelve keys', () => {
    for (const [key] of TOP_LEVEL_KEYS) {
      const card = fixture()
      delete card[key]
      expectRejected(card, key)
    }
  })

  it('rejects an unknown top-level key', () => {
    const card = fixture()
    card.extra = true
    expectRejected(card, 'unknown top-level key')
  })

  it('rejects a top-level key of the wrong kind', () => {
    const objects = fixture()
    objects[KEY_NODES] = {}
    expectRejected(objects, KEY_NODES)
    const arrays = fixture()
    arrays[KEY_CARD] = []
    expectRejected(arrays, KEY_CARD)
  })
})

describe('validateCard: card meta', () => {
  it('rejects an unknown card format', () => {
    const card = fixture()
    card[KEY_CARD][KEY_FORMAT] = 'card/2'
    expectRejected(card, KEY_CARD + '.' + KEY_FORMAT)
  })

  it('rejects an id whose namespace is not the author', () => {
    const card = fixture()
    card[KEY_CARD][KEY_ID] = 'someone-else.demo'
    expectRejected(card, KEY_CARD + '.' + KEY_ID)
  })

  it('rejects a malformed id', () => {
    const card = fixture()
    card[KEY_CARD][KEY_ID] = 'Tester.Demo'
    expectRejected(card, KEY_CARD + '.' + KEY_ID)
  })

  it('rejects a version that is not semver', () => {
    const card = fixture()
    card[KEY_CARD][KEY_VERSION] = 'v1'
    expectRejected(card, KEY_CARD + '.' + KEY_VERSION)
  })

  it('rejects an empty meta field', () => {
    const card = fixture()
    card[KEY_CARD][KEY_LANGUAGE] = ''
    expectRejected(card, KEY_CARD + '.' + KEY_LANGUAGE)
  })
})

describe('validateCard: the given blocks', () => {
  it('rejects a block count other than five', () => {
    const card = fixture()
    delete card[KEY_GIVEN][GIVEN_BLOCKS[4]]
    expectRejected(card, KEY_GIVEN)
  })

  it('rejects blocks in the wrong order', () => {
    const card = fixture()
    card[KEY_GIVEN] = {
      [GIVEN_BLOCKS[1]]: ['x'],
      [GIVEN_BLOCKS[0]]: ['x'],
      [GIVEN_BLOCKS[2]]: ['x'],
      [GIVEN_BLOCKS[3]]: ['x'],
      [GIVEN_BLOCKS[4]]: ['x'],
    }
    expectRejected(card, KEY_GIVEN)
  })

  it('rejects a block that is not a non-empty line array', () => {
    const card = fixture()
    card[KEY_GIVEN][GIVEN_BLOCKS[0]] = []
    expectRejected(card, KEY_GIVEN + '.' + GIVEN_BLOCKS[0])
    const wrong = fixture()
    wrong[KEY_GIVEN][GIVEN_BLOCKS[0]] = ['ok', 7]
    expectRejected(wrong, KEY_GIVEN + '.' + GIVEN_BLOCKS[0])
  })
})

describe('validateCard: nodes and topology', () => {
  it('rejects an empty node list', () => {
    const card = fixture()
    card[KEY_NODES] = []
    expectRejected(card, KEY_NODES)
  })

  it('rejects a node that is missing one of the six keys', () => {
    for (const key of [KEY_NODE_NAME, KEY_ORDER, KEY_DUTY, KEY_PROMPT, KEY_OUTPUT, KEY_ID]) {
      const card = fixture()
      delete card[KEY_NODES][0][key]
      expectRejected(card, KEY_NODES + '[0]')
    }
  })

  it('rejects a node order number that is not the node index', () => {
    const card = fixture()
    card[KEY_NODES][1][KEY_ORDER] = 0
    expectRejected(card, KEY_NODES + '[1].' + KEY_ORDER)
  })

  it('rejects duplicate node ids and names', () => {
    const ids = fixture()
    ids[KEY_NODES][1][KEY_ID] = NODE_A
    expectRejected(ids, KEY_NODES + '[1].' + KEY_ID)
    const names = fixture()
    names[KEY_NODES][1][KEY_NODE_NAME] = NODE_A
    expectRejected(names, KEY_NODES + '[1].' + KEY_NODE_NAME)
  })

  it('rejects empty or non-text prompt lines', () => {
    const empty = fixture()
    empty[KEY_NODES][0][KEY_PROMPT] = []
    expectRejected(empty, KEY_NODES + '[0].' + KEY_PROMPT)
    const wrong = fixture()
    wrong[KEY_NODES][0][KEY_PROMPT] = [1]
    expectRejected(wrong, KEY_NODES + '[0].' + KEY_PROMPT)
  })

  it('rejects a topology shorter than the node list', () => {
    const card = fixture()
    card[KEY_TOPOLOGY] = [NODE_A]
    expectRejected(card, KEY_TOPOLOGY)
  })

  it('rejects a topology that names the wrong node in that position', () => {
    const card = fixture()
    card[KEY_TOPOLOGY] = [NODE_B, NODE_A]
    expectRejected(card, KEY_TOPOLOGY + '[0]')
  })
})

describe('validateCard: world and schema', () => {
  it('rejects an unknown calendar', () => {
    const card = fixture()
    card[KEY_WORLD][KEY_CALENDAR] = 'lunar'
    expectRejected(card, KEY_WORLD + '.' + KEY_CALENDAR)
  })

  it('rejects a start position with the wrong key set', () => {
    const card = fixture()
    card[KEY_OPENING][KEY_START] = { [KEY_AREA]: 'a', [KEY_PLACE]: 'b' }
    expectRejected(card, KEY_OPENING + '.' + KEY_START)
  })

  it('rejects a numeric field whose initial value is outside its range', () => {
    const card = fixture()
    card[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_INITIAL] = 99
    expectRejected(card, KEY_STATE + '.' + KEY_ROLE + '.' + KEY_INHERENT + '.strength.' + KEY_INITIAL)
  })

  it('rejects a numeric field without a usable range or initial value', () => {
    const missing = fixture()
    delete missing[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_RANGE]
    expectRejected(missing, '.strength.' + KEY_RANGE)
    const wrong = fixture()
    wrong[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_INITIAL] = 'three'
    expectRejected(wrong, '.strength.' + KEY_INITIAL)
    const bad = fixture()
    bad[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_RANGE] = [1]
    expectRejected(bad, '.strength.' + KEY_RANGE)
  })

  it('rejects a tier whose initial value is not one of its values', () => {
    const card = fixture()
    card[KEY_STATE][KEY_ROLE][KEY_TIER][KEY_INITIAL] = 'boss'
    expectRejected(card, KEY_STATE + '.' + KEY_ROLE + '.' + KEY_TIER + '.' + KEY_VALUES)
  })

  it('rejects a field that should be an object but is not', () => {
    const role = fixture()
    role[KEY_STATE][KEY_ROLE] = []
    expectRejected(role, KEY_STATE + '.' + KEY_ROLE)
    const spec = fixture()
    spec[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength = 'number'
    expectRejected(spec, '.strength')
  })

  it('rejects a stage entry that is not an object', () => {
    const card = fixture()
    card[KEY_SCRIPT][KEY_STAGES] = ['one']
    expectRejected(card, KEY_SCRIPT + '.' + KEY_STAGES + '[0]')
  })

  it('rejects a sidebar block that is not an object', () => {
    const card = fixture()
    card[KEY_DISPLAY][KEY_SIDEBAR] = ['map']
    expectRejected(card, KEY_DISPLAY + '.' + KEY_SIDEBAR + '[0]')
  })

  it('rejects a world whose area list is not an array', () => {
    const card = fixture()
    card[KEY_WORLD][KEY_AREA] = 'town'
    expectRejected(card, KEY_WORLD + '.' + KEY_AREA)
  })

  it('rejects a generator list with no first entry to read principles from', () => {
    const card = fixture()
    card[KEY_GENERATORS] = []
    expectRejected(card, KEY_GENERATORS + '[0]')
  })

  it('rejects stages that do not run 1, 2, 3 ...', () => {
    const card = fixture()
    card[KEY_SCRIPT][KEY_STAGES] = [{ [KEY_STAGES]: 1 }, { [KEY_STAGES]: 3 }]
    expectRejected(card, KEY_SCRIPT + '.' + KEY_STAGES + '[1].' + KEY_STAGES)
  })

  it('rejects a duplicate sidebar block', () => {
    const card = fixture()
    card[KEY_DISPLAY][KEY_SIDEBAR] = [{ [KEY_BLOCK]: 'map' }, { [KEY_BLOCK]: 'map' }]
    expectRejected(card, KEY_DISPLAY + '.' + KEY_SIDEBAR + '[1].' + KEY_BLOCK)
  })
})

describe('validateCard: the checks that can be falsified', () => {
  it('rejects a place count that disagrees with the first area', () => {
    const card = fixture()
    card[KEY_WORLD][KEY_AREA][0][KEY_PLACES] = ['one']
    expectRejected(card, KEY_GENERATORS + '[0].' + KEY_PRINCIPLE + '[0]')
  })

  it('rejects a principle with no chinese numeral to check against', () => {
    const card = fixture()
    card[KEY_GENERATORS][0][KEY_PRINCIPLE][0] = 'places'
    expectRejected(card, KEY_GENERATORS + '[0].' + KEY_PRINCIPLE + '[0]')
  })

  it('accepts written numbers like ten and twenty', () => {
    const ten = fixture()
    ten[KEY_GENERATORS][0][KEY_PRINCIPLE][0] = PRINCIPLE_TEN
    ten[KEY_WORLD][KEY_AREA][0][KEY_PLACES] = new Array(10).fill('place')
    expect(validateCard(ten)).toBeDefined()
    const twenty = fixture()
    twenty[KEY_GENERATORS][0][KEY_PRINCIPLE][0] = PRINCIPLE_TWENTY
    twenty[KEY_WORLD][KEY_AREA][0][KEY_PLACES] = new Array(20).fill('place')
    expect(validateCard(twenty)).toBeDefined()
  })

  it('rejects a convention block that does not mention every node', () => {
    const card = fixture()
    card[KEY_CONVENTION] = [CN_FIVE + KEY_BLOCK, NODE_A]
    expectRejected(card, KEY_CONVENTION)
  })

  it('rejects a convention block that mentions the nodes out of order', () => {
    const card = fixture()
    card[KEY_CONVENTION] = [CN_FIVE + KEY_BLOCK, NODE_B + ' then ' + NODE_A]
    expectRejected(card, KEY_CONVENTION)
  })

  it('rejects a convention block whose count is not the number of given blocks', () => {
    const card = fixture()
    card[KEY_CONVENTION] = [CN_TEN + KEY_BLOCK, NODE_A + ' then ' + NODE_B]
    expectRejected(card, KEY_CONVENTION)
  })

  it('rejects a convention block that never declares the block count', () => {
    const card = fixture()
    card[KEY_CONVENTION] = [NODE_A + ' then ' + NODE_B]
    expectRejected(card, KEY_CONVENTION)
  })

  it('rejects a segment name that is not a key of the role schema', () => {
    const card = fixture()
    card[KEY_STATE][KEY_NOTE] = NOTE.split(KEY_CARRY).join('carry')
    expectRejected(card, KEY_STATE + '.' + KEY_NOTE)
  })

  it('rejects a segment count that disagrees with the names it lists', () => {
    const card = fixture()
    card[KEY_STATE][KEY_NOTE] = NOTE.split(CN_FOUR).join(CN_TEN)
    expectRejected(card, KEY_STATE + '.' + KEY_NOTE)
  })

  it('rejects a state note without a numeral or without a list', () => {
    const noNumber = fixture()
    noNumber[KEY_STATE][KEY_NOTE] = NOTE.split(CN_FOUR).join('')
    expectRejected(noNumber, KEY_STATE + '.' + KEY_NOTE)
    const noList = fixture()
    noList[KEY_STATE][KEY_NOTE] = CN_FOUR + WORD_STAGE
    expectRejected(noList, KEY_STATE + '.' + KEY_NOTE)
    const openList = fixture()
    openList[KEY_STATE][KEY_NOTE] = CN_FOUR + WORD_STAGE + PUNCT_COLON + KEY_INHERENT
    expectRejected(openList, KEY_STATE + '.' + KEY_NOTE)
  })
})
