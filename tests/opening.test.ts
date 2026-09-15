/**
 * opening 测试 —— 卡的开局事实（默认名 + 第一轮的要求）。
 *
 * 开场正文由模型现写（决定 #31）：这里守的是「引擎只从卡里取事实，不编内容」。
 */
import { describe, expect, it } from 'vitest'
import { openingOf } from '../src/game/opening'
import { currentCard } from '../src/game/current-card'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'

describe('openingOf', () => {
  it('reads the default name and the first-round requirements from the card', () => {
    const facts = openingOf(currentCard)
    expect(facts.name).toBe(currentCard.opening.defaultName)
    expect(facts.requirements).toEqual(currentCard.opening.requirements)
    expect(facts.requirements.length).toBeGreaterThan(0)
  })

  it('follows the card it is given (another card has its own name)', () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    expect(openingOf(card).name).toBe(card.opening.defaultName)
    expect(openingOf(card).requirements).toEqual(card.opening.requirements)
  })

  it('returns a copy of the requirements (callers cannot mutate the card)', () => {
    const card = loadCard(NIGHT_WATCH_CARD)
    const facts = openingOf(card)
    facts.requirements.push('injected')
    expect(card.opening.requirements).not.toContain('injected')
  })
})
