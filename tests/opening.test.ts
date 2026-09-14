/**
 * opening 测试 —— 卡的「开局」进新游戏的第一帧（阶段 6a，决定 #31 / #42）。
 *
 * 五条边界：卡说什么第一帧就是什么、换局也重新按卡建、存档压过卡、
 * 卡没给默认名时退回 i18n、坏卡到不了第一帧。
 * 期望值从示例卡的 JSON 现读，不在这里抄第二份 —— 卡改了，断言跟着卡走。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseCard } from '../src/game/card'
import {
  KEY_AREA,
  KEY_DECL,
  KEY_DEFAULT_NAME,
  KEY_OPENING,
  KEY_PLACE,
  KEY_SCENE,
  KEY_START,
  KEY_START_TIME,
} from '../src/game/card-keys'
import { currentCard } from '../src/game/current-card'
import { openingOf } from '../src/game/opening'
import { createInitialState, normalize } from '../src/game/save'
import { initialState, reset } from '../src/game/state'
import { t } from '../src/i18n'
import { EXAMPLE_CARD, fixture } from './support/card-fixtures'
import { noopStore } from './support/game-fixtures'

/** 示例卡的原始 JSON 与它的开局块 —— 「第一帧 = 卡里写的值」以它为唯一来源 */
const shipped = JSON.parse(readFileSync(EXAMPLE_CARD, 'utf8')) as Record<string, any>
const shippedOpening = shipped[KEY_DECL][KEY_OPENING]

/** 把最小卡的默认名换成给的名字（校验走 parseCard，坏卡在这里进不来） */
function cardWithDefaultName(name: string) {
  const card = fixture()
  card[KEY_DECL][KEY_OPENING][KEY_DEFAULT_NAME] = name
  return parseCard(JSON.stringify(card))
}

describe('openingOf', () => {
  it('reads the three facts of the shipped card that the engine consumes', () => {
    const opening = openingOf(parseCard(readFileSync(EXAMPLE_CARD, 'utf8')))
    expect(opening.iso).toBe(shippedOpening[KEY_START_TIME])
    expect(opening.sceneName).toBe(shippedOpening[KEY_START][KEY_SCENE])
    expect(opening.playerName).toBe(shippedOpening[KEY_DEFAULT_NAME])
    // 场景名既不是区域也不是地点：openingOf 读错了键会被上面那条断言抓住
    expect(opening.sceneName).not.toBe(shippedOpening[KEY_START][KEY_AREA])
    expect(opening.sceneName).not.toBe(shippedOpening[KEY_START][KEY_PLACE])
  })
})

describe('the first frame of a new game', () => {
  it('is the shipped card, validated at import time', () => {
    expect(currentCard).toEqual(parseCard(readFileSync(EXAMPLE_CARD, 'utf8')))
  })

  it('takes its time, scene and default name from the card', () => {
    const s = initialState()
    expect(s.data.time.iso).toBe(shippedOpening[KEY_START_TIME])
    expect(s.data.scene.name).toBe(shippedOpening[KEY_START][KEY_SCENE])
    expect(s.data.scene.description).toBe('')
    expect(s.data.player.name).toBe(shippedOpening[KEY_DEFAULT_NAME])
  })

  it('is rebuilt from the card when the game is reset', () => {
    const s = initialState()
    s.data.time.iso = '1999-01-01T00:00'
    s.data.scene.name = 'stale'
    s.data.player.name = 'stale'
    reset(s, noopStore)
    expect(s.data.time.iso).toBe(shippedOpening[KEY_START_TIME])
    expect(s.data.scene.name).toBe(shippedOpening[KEY_START][KEY_SCENE])
    expect(s.data.player.name).toBe(shippedOpening[KEY_DEFAULT_NAME])
  })
})

describe('the default name', () => {
  it('comes from the card when the card gives one', () => {
    const facts = openingOf(cardWithDefaultName('Ada'))
    expect(facts.playerName).toBe('Ada')
    expect(createInitialState(facts).player.name).toBe('Ada')
  })

  it('falls back to the locale when the card leaves it empty', () => {
    const facts = openingOf(cardWithDefaultName(''))
    expect(facts.playerName).toBe('')
    expect(createInitialState(facts).player.name).toBe(t('player.defaultName'))
  })
})

describe('a save beats the card', () => {
  it('keeps the time, scene and player name written in the save', () => {
    const fresh = createInitialState(openingOf(currentCard))
    const d = normalize(
      {
        player: { name: 'Saved Name' },
        scene: { name: 'Saved Scene', description: 'saved description' },
        time: { iso: '2030-01-02T03:04:05.000Z' },
      },
      fresh,
    )
    expect(d.time.iso).toBe('2030-01-02T03:04:05.000Z')
    expect(d.scene).toEqual({ name: 'Saved Scene', description: 'saved description' })
    expect(d.player.name).toBe('Saved Name')
  })
})

describe('a bad card', () => {
  it('never reaches the first frame (parseCard rejects it)', () => {
    const bad = fixture()
    bad[KEY_DECL][KEY_OPENING][KEY_START_TIME] = 'tomorrow evening'
    expect(() => parseCard(JSON.stringify(bad))).toThrow(KEY_START_TIME)
  })
})
