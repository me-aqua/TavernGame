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
  CN_FOUR,
  CN_TEN,
  KEY_AREA,
  KEY_BLOCK,
  KEY_CALENDAR,
  KEY_CAN_NAME,
  KEY_CARD,
  KEY_CARRY,
  KEY_CONVENTION,
  KEY_DECL,
  KEY_DEFAULT_NAME,
  KEY_DISPLAY,
  KEY_DUTY,
  KEY_FORMAT,
  KEY_GENERATORS,
  KEY_GRAPH,
  KEY_ID,
  KEY_INHERENT,
  KEY_INITIAL,
  KEY_LANGUAGE,
  KEY_NODES,
  KEY_NODE_NAME,
  KEY_NOTES,
  KEY_OPENING,
  KEY_OPENING_REQUIREMENTS,
  KEY_ORDER,
  KEY_OUTPUT,
  KEY_PLACE,
  KEY_PLACES,
  KEY_PLAYER,
  KEY_PRINCIPLE,
  KEY_PROFILE_INITIAL,
  KEY_PROMPT,
  KEY_RANGE,
  KEY_ROLE,
  KEY_SCRIPT,
  KEY_SETTING,
  KEY_SIDEBAR,
  KEY_STAGES,
  KEY_START,
  KEY_START_TIME,
  KEY_STATE,
  KEY_TIER,
  KEY_TOPOLOGY,
  KEY_VALUES,
  KEY_VERSION,
  KEY_WORLD,
  PUNCT_COLON,
  SETTING_BLOCKS,
  TOP_LEVEL_KEYS,
  WORD_STAGE,
} from '../src/game/card-keys'
import {
  EXAMPLE_CARD,
  NODE_A,
  NODE_B,
  NOTE,
  PRINCIPLE_TEN,
  PRINCIPLE_TWENTY,
  fixture,
  minimalCard,
} from './support/card-fixtures'

/** 夹具里各块的路径前缀 —— 断言错误信息指到哪儿时用 */
const GRAPH_PATH = KEY_DECL + '.' + KEY_GRAPH
const NODES_PATH = GRAPH_PATH + '.' + KEY_NODES
const NODE_PROMPTS_PATH = KEY_PROMPT + '.' + KEY_NODES
const ROLE_PATH = KEY_DECL + '.' + KEY_STATE + '.' + KEY_ROLE

/** 夹具里三块的成员 —— 反例都在它们身上改一处 */
const decl = (card: any) => card[KEY_DECL]
const prompts = (card: any) => card[KEY_PROMPT]
const graphOf = (card: any) => card[KEY_DECL][KEY_GRAPH]
const nodesOf = (card: any) => card[KEY_DECL][KEY_GRAPH][KEY_NODES]
const nodePromptsOf = (card: any) => card[KEY_PROMPT][KEY_NODES]
const nodePath = (id: string) => NODES_PATH + '.' + id

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
    expect(graphOf(card)[KEY_TOPOLOGY]).toHaveLength(9)
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
  it('rejects a card that is missing any of the four keys', () => {
    for (const key of TOP_LEVEL_KEYS) {
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

  it('rejects a top-level key that is not an object', () => {
    const card = fixture()
    card[KEY_DECL] = []
    expectRejected(card, KEY_DECL)
    const scalar = fixture()
    scalar[KEY_PROMPT] = 'prompt'
    expectRejected(scalar, KEY_PROMPT)
  })
})

describe('validateCard: the three blocks', () => {
  it('rejects a declaration that is missing one of its six keys', () => {
    for (const key of [KEY_GRAPH, KEY_STATE, KEY_WORLD, KEY_GENERATORS, KEY_OPENING, KEY_DISPLAY]) {
      const card = fixture()
      delete decl(card)[key]
      expectRejected(card, KEY_DECL)
    }
  })

  it('rejects an unknown key in the declaration', () => {
    const card = fixture()
    decl(card).extra = true
    expectRejected(card, KEY_DECL + '.extra')
  })

  it('rejects a prompts block that is missing one of its five keys', () => {
    for (const key of [KEY_SETTING, KEY_SCRIPT, KEY_CONVENTION, KEY_NODES, KEY_OPENING_REQUIREMENTS]) {
      const card = fixture()
      delete prompts(card)[key]
      expectRejected(card, KEY_PROMPT)
    }
  })

  it('rejects an unknown key in the prompts block', () => {
    const card = fixture()
    prompts(card).extra = true
    expectRejected(card, KEY_PROMPT + '.extra')
  })

  it('rejects notes that are missing one of their three blocks', () => {
    for (const key of [KEY_STATE, KEY_SCRIPT, KEY_OPENING]) {
      const card = fixture()
      delete card[KEY_NOTES][key]
      expectRejected(card, KEY_NOTES)
    }
  })

  it('accepts extra note sections as one line or as lines, and rejects any other shape', () => {
    const oneLine = fixture()
    oneLine[KEY_NOTES].extra = 'note'
    expect(validateCard(oneLine)).toBeDefined()
    const lines = fixture()
    lines[KEY_NOTES].extra = ['first line', 'second line']
    expect(validateCard(lines)).toBeDefined()
    const wrong = fixture()
    wrong[KEY_NOTES].extra = 7
    expectRejected(wrong, KEY_NOTES + '.extra')
    const empty = fixture()
    empty[KEY_NOTES].extra = []
    expectRejected(empty, KEY_NOTES + '.extra')
    const blank = fixture()
    blank[KEY_NOTES].extra = ''
    expectRejected(blank, KEY_NOTES + '.extra')
  })

  it('rejects an empty required note', () => {
    const empty = fixture()
    empty[KEY_NOTES][KEY_OPENING] = ''
    expectRejected(empty, KEY_NOTES + '.' + KEY_OPENING)
  })
})

describe('validateCard: card meta', () => {
  it('rejects an unknown card format', () => {
    const card = fixture()
    card[KEY_CARD][KEY_FORMAT] = 'card/1'
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

describe('validateCard: the setting blocks', () => {
  it('rejects a block count other than five', () => {
    const card = fixture()
    delete prompts(card)[KEY_SETTING][SETTING_BLOCKS[4]]
    expectRejected(card, KEY_PROMPT + '.' + KEY_SETTING)
  })

  it('rejects blocks in the wrong order', () => {
    const card = fixture()
    prompts(card)[KEY_SETTING] = {
      [SETTING_BLOCKS[1]]: ['x'],
      [SETTING_BLOCKS[0]]: ['x'],
      [SETTING_BLOCKS[2]]: ['x'],
      [SETTING_BLOCKS[3]]: ['x'],
      [SETTING_BLOCKS[4]]: ['x'],
    }
    expectRejected(card, KEY_PROMPT + '.' + KEY_SETTING)
  })

  it('rejects a block that is not a non-empty line array', () => {
    const card = fixture()
    prompts(card)[KEY_SETTING][SETTING_BLOCKS[0]] = []
    expectRejected(card, KEY_PROMPT + '.' + KEY_SETTING + '.' + SETTING_BLOCKS[0])
    const wrong = fixture()
    wrong[KEY_PROMPT][KEY_SETTING][SETTING_BLOCKS[0]] = ['ok', 7]
    expectRejected(wrong, KEY_PROMPT + '.' + KEY_SETTING + '.' + SETTING_BLOCKS[0])
  })
})

describe('validateCard: graph and node prompts', () => {
  it('rejects an empty topology', () => {
    const card = fixture()
    graphOf(card)[KEY_TOPOLOGY] = []
    expectRejected(card, GRAPH_PATH + '.' + KEY_TOPOLOGY)
  })

  it('rejects a topology entry that is not a non-empty node id', () => {
    const card = fixture()
    graphOf(card)[KEY_TOPOLOGY] = [NODE_A, '']
    expectRejected(card, GRAPH_PATH + '.' + KEY_TOPOLOGY + '[1]')
  })

  it('rejects a duplicate node id', () => {
    const card = fixture()
    graphOf(card)[KEY_TOPOLOGY] = [NODE_A, NODE_A]
    expectRejected(card, GRAPH_PATH + '.' + KEY_TOPOLOGY + '[1]')
  })

  it('rejects a node that is missing one of its three keys', () => {
    for (const key of [KEY_NODE_NAME, KEY_DUTY, KEY_OUTPUT]) {
      const card = fixture()
      delete nodesOf(card)[NODE_A][key]
      expectRejected(card, nodePath(NODE_A))
    }
  })

  it('rejects a node that still carries an order number or an id', () => {
    const order = fixture()
    nodesOf(order)[NODE_A][KEY_ORDER] = 0
    expectRejected(order, nodePath(NODE_A) + '.' + KEY_ORDER)
    const id = fixture()
    nodesOf(id)[NODE_A][KEY_ID] = NODE_A
    expectRejected(id, nodePath(NODE_A) + '.' + KEY_ID)
  })

  it('rejects a node that is not an object', () => {
    const card = fixture()
    nodesOf(card)[NODE_A] = 'node'
    expectRejected(card, nodePath(NODE_A))
  })

  it('rejects a node id that the topology does not list', () => {
    const card = fixture()
    nodesOf(card).extra = { [KEY_NODE_NAME]: 'extra', [KEY_DUTY]: 'duty', [KEY_OUTPUT]: { value: 'x' } }
    expectRejected(card, nodePath('extra'))
  })

  it('rejects a topology id that has no node', () => {
    const card = fixture()
    delete nodesOf(card)[NODE_B]
    expectRejected(card, NODES_PATH)
  })

  it('rejects duplicate node names', () => {
    const card = fixture()
    nodesOf(card)[NODE_B][KEY_NODE_NAME] = NODE_A
    expectRejected(card, nodePath(NODE_B) + '.' + KEY_NODE_NAME)
  })

  it('rejects an empty or non-object output', () => {
    const empty = fixture()
    nodesOf(empty)[NODE_A][KEY_OUTPUT] = {}
    expectRejected(empty, nodePath(NODE_A) + '.' + KEY_OUTPUT)
    const wrong = fixture()
    wrong[KEY_DECL][KEY_GRAPH][KEY_NODES][NODE_A][KEY_OUTPUT] = 'text'
    expectRejected(wrong, nodePath(NODE_A) + '.' + KEY_OUTPUT)
  })

  it('rejects an empty node name or duty', () => {
    const name = fixture()
    nodesOf(name)[NODE_A][KEY_NODE_NAME] = ''
    expectRejected(name, nodePath(NODE_A) + '.' + KEY_NODE_NAME)
    const duty = fixture()
    nodesOf(duty)[NODE_A][KEY_DUTY] = ''
    expectRejected(duty, nodePath(NODE_A) + '.' + KEY_DUTY)
  })

  it('rejects a node prompt set that does not match the topology', () => {
    const missing = fixture()
    delete nodePromptsOf(missing)[NODE_B]
    expectRejected(missing, NODE_PROMPTS_PATH)
    const extra = fixture()
    nodePromptsOf(extra).extra = ['prompt']
    expectRejected(extra, NODE_PROMPTS_PATH + '.extra')
  })

  it('rejects empty or non-text node prompts', () => {
    const empty = fixture()
    nodePromptsOf(empty)[NODE_A] = []
    expectRejected(empty, NODE_PROMPTS_PATH + '.' + NODE_A)
    const wrong = fixture()
    wrong[KEY_PROMPT][KEY_NODES][NODE_A] = [1]
    expectRejected(wrong, NODE_PROMPTS_PATH + '.' + NODE_A)
  })
})

describe('validateCard: world and schema', () => {
  it('rejects an unknown calendar', () => {
    const card = fixture()
    decl(card)[KEY_WORLD][KEY_CALENDAR] = 'lunar'
    expectRejected(card, KEY_DECL + '.' + KEY_WORLD + '.' + KEY_CALENDAR)
  })

  it('rejects an opening block that is missing a fact the engine reads', () => {
    for (const key of [KEY_START_TIME, KEY_START, KEY_CAN_NAME, KEY_DEFAULT_NAME]) {
      const card = fixture()
      delete decl(card)[KEY_OPENING][key]
      expectRejected(card, KEY_DECL + '.' + KEY_OPENING)
    }
  })

  it('rejects an opening time that is not a YYYY-MM-DDTHH:mm instant', () => {
    const empty = fixture()
    decl(empty)[KEY_OPENING][KEY_START_TIME] = ''
    expectRejected(empty, KEY_DECL + '.' + KEY_OPENING + '.' + KEY_START_TIME)
    const written = fixture()
    decl(written)[KEY_OPENING][KEY_START_TIME] = 'tomorrow evening'
    expectRejected(written, KEY_DECL + '.' + KEY_OPENING + '.' + KEY_START_TIME)
  })

  it('rejects a start position with the wrong key set', () => {
    const card = fixture()
    decl(card)[KEY_OPENING][KEY_START] = { [KEY_AREA]: 'a', [KEY_PLACE]: 'b' }
    expectRejected(card, KEY_DECL + '.' + KEY_OPENING + '.' + KEY_START)
  })

  it('rejects a non-boolean name prompt or a non-text default name', () => {
    const asked = fixture()
    decl(asked)[KEY_OPENING][KEY_CAN_NAME] = 'yes'
    expectRejected(asked, KEY_DECL + '.' + KEY_OPENING + '.' + KEY_CAN_NAME)
    const named = fixture()
    decl(named)[KEY_OPENING][KEY_DEFAULT_NAME] = 7
    expectRejected(named, KEY_DECL + '.' + KEY_OPENING + '.' + KEY_DEFAULT_NAME)
  })

  it('accepts an empty default name (the player then gets the locale fallback)', () => {
    const card = fixture()
    decl(card)[KEY_OPENING][KEY_DEFAULT_NAME] = ''
    expect(validateCard(card)).toBeDefined()
  })

  it('rejects a player block without a usable profile', () => {
    const missing = fixture()
    delete decl(missing)[KEY_STATE][KEY_PLAYER]
    expectRejected(missing, KEY_DECL + '.' + KEY_STATE + '.' + KEY_PLAYER)
    const wrong = fixture()
    decl(wrong)[KEY_STATE][KEY_PLAYER][KEY_PROFILE_INITIAL] = 'profile'
    expectRejected(wrong, KEY_DECL + '.' + KEY_STATE + '.' + KEY_PLAYER + '.' + KEY_PROFILE_INITIAL)
  })

  it('rejects a numeric field whose initial value is outside its range', () => {
    const card = fixture()
    decl(card)[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_INITIAL] = 99
    expectRejected(card, ROLE_PATH + '.' + KEY_INHERENT + '.strength.' + KEY_INITIAL)
  })

  it('rejects a numeric field without a usable range or initial value', () => {
    const missing = fixture()
    delete decl(missing)[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_RANGE]
    expectRejected(missing, '.strength.' + KEY_RANGE)
    const wrong = fixture()
    decl(wrong)[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_INITIAL] = 'three'
    expectRejected(wrong, '.strength.' + KEY_INITIAL)
    const bad = fixture()
    decl(bad)[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength[KEY_RANGE] = [1]
    expectRejected(bad, '.strength.' + KEY_RANGE)
  })

  it('rejects a tier whose initial value is not one of its values', () => {
    const card = fixture()
    decl(card)[KEY_STATE][KEY_ROLE][KEY_TIER][KEY_INITIAL] = 'boss'
    expectRejected(card, ROLE_PATH + '.' + KEY_TIER + '.' + KEY_VALUES)
  })

  it('rejects a field that should be an object but is not', () => {
    const role = fixture()
    decl(role)[KEY_STATE][KEY_ROLE] = []
    expectRejected(role, ROLE_PATH)
    const spec = fixture()
    decl(spec)[KEY_STATE][KEY_ROLE][KEY_INHERENT].strength = 'number'
    expectRejected(spec, '.strength')
  })

  it('rejects a stage entry that is not an object', () => {
    const card = fixture()
    prompts(card)[KEY_SCRIPT][KEY_STAGES] = ['one']
    expectRejected(card, KEY_PROMPT + '.' + KEY_SCRIPT + '.' + KEY_STAGES + '[0]')
  })

  it('rejects stages that do not run 1, 2, 3 ...', () => {
    const card = fixture()
    prompts(card)[KEY_SCRIPT][KEY_STAGES] = [{ [KEY_STAGES]: 1 }, { [KEY_STAGES]: 3 }]
    expectRejected(card, KEY_PROMPT + '.' + KEY_SCRIPT + '.' + KEY_STAGES + '[1].' + KEY_STAGES)
  })

  it('rejects an empty script or an empty opening requirement list', () => {
    const script = fixture()
    prompts(script)[KEY_SCRIPT] = {}
    expectRejected(script, KEY_PROMPT + '.' + KEY_SCRIPT)
    const opening = fixture()
    prompts(opening)[KEY_OPENING_REQUIREMENTS] = []
    expectRejected(opening, KEY_PROMPT + '.' + KEY_OPENING_REQUIREMENTS)
  })

  it('rejects a sidebar block that is not an object', () => {
    const card = fixture()
    decl(card)[KEY_DISPLAY][KEY_SIDEBAR] = ['map']
    expectRejected(card, KEY_DECL + '.' + KEY_DISPLAY + '.' + KEY_SIDEBAR + '[0]')
  })

  it('rejects a duplicate sidebar block', () => {
    const card = fixture()
    decl(card)[KEY_DISPLAY][KEY_SIDEBAR] = [{ [KEY_BLOCK]: 'map' }, { [KEY_BLOCK]: 'map' }]
    expectRejected(card, KEY_DECL + '.' + KEY_DISPLAY + '.' + KEY_SIDEBAR + '[1].' + KEY_BLOCK)
  })

  it('rejects a world whose area list is not an array', () => {
    const card = fixture()
    decl(card)[KEY_WORLD][KEY_AREA] = 'town'
    expectRejected(card, KEY_DECL + '.' + KEY_WORLD + '.' + KEY_AREA)
  })

  it('rejects a generator list with no first entry to read principles from', () => {
    const card = fixture()
    decl(card)[KEY_GENERATORS] = []
    expectRejected(card, KEY_DECL + '.' + KEY_GENERATORS + '[0]')
  })
})

describe('validateCard: the checks that can be falsified', () => {
  it('rejects a place count that disagrees with the first area', () => {
    const card = fixture()
    decl(card)[KEY_WORLD][KEY_AREA][0][KEY_PLACES] = ['one']
    expectRejected(card, KEY_DECL + '.' + KEY_GENERATORS + '[0].' + KEY_PRINCIPLE + '[0]')
  })

  it('rejects a principle with no chinese numeral to check against', () => {
    const card = fixture()
    decl(card)[KEY_GENERATORS][0][KEY_PRINCIPLE][0] = 'places'
    expectRejected(card, KEY_DECL + '.' + KEY_GENERATORS + '[0].' + KEY_PRINCIPLE + '[0]')
  })

  it('accepts written numbers like ten and twenty', () => {
    const ten = fixture()
    decl(ten)[KEY_GENERATORS][0][KEY_PRINCIPLE][0] = PRINCIPLE_TEN
    decl(ten)[KEY_WORLD][KEY_AREA][0][KEY_PLACES] = new Array(10).fill('place')
    expect(validateCard(ten)).toBeDefined()
    const twenty = fixture()
    decl(twenty)[KEY_GENERATORS][0][KEY_PRINCIPLE][0] = PRINCIPLE_TWENTY
    decl(twenty)[KEY_WORLD][KEY_AREA][0][KEY_PLACES] = new Array(20).fill('place')
    expect(validateCard(twenty)).toBeDefined()
  })

  it('rejects a convention block whose count is not the number of setting blocks', () => {
    const card = fixture()
    prompts(card)[KEY_CONVENTION] = [CN_TEN + KEY_BLOCK]
    expectRejected(card, KEY_PROMPT + '.' + KEY_CONVENTION)
  })

  it('rejects a convention block that never declares the block count', () => {
    const card = fixture()
    prompts(card)[KEY_CONVENTION] = ['no numeral here']
    expectRejected(card, KEY_PROMPT + '.' + KEY_CONVENTION)
  })

  it('rejects an empty convention block', () => {
    const card = fixture()
    prompts(card)[KEY_CONVENTION] = []
    expectRejected(card, KEY_PROMPT + '.' + KEY_CONVENTION)
  })

  it('rejects a segment name that is not a key of the role schema', () => {
    const card = fixture()
    card[KEY_NOTES][KEY_STATE] = NOTE.split(KEY_CARRY).join('carry')
    expectRejected(card, KEY_NOTES + '.' + KEY_STATE)
  })

  it('rejects a segment count that disagrees with the names it lists', () => {
    const card = fixture()
    card[KEY_NOTES][KEY_STATE] = NOTE.split(CN_FOUR).join(CN_TEN)
    expectRejected(card, KEY_NOTES + '.' + KEY_STATE)
  })

  it('rejects a state note without a numeral or without a list', () => {
    const noNumber = fixture()
    noNumber[KEY_NOTES][KEY_STATE] = NOTE.split(CN_FOUR).join('')
    expectRejected(noNumber, KEY_NOTES + '.' + KEY_STATE)
    const noList = fixture()
    noList[KEY_NOTES][KEY_STATE] = CN_FOUR + WORD_STAGE
    expectRejected(noList, KEY_NOTES + '.' + KEY_STATE)
    const openList = fixture()
    openList[KEY_NOTES][KEY_STATE] = CN_FOUR + WORD_STAGE + PUNCT_COLON + KEY_INHERENT
    expectRejected(openList, KEY_NOTES + '.' + KEY_STATE)
  })
})
