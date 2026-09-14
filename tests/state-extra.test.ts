/**
 * state.ts 的补充测试 —— 覆盖现有 tests/state.test.ts 未触及的分支。
 *
 * 重点：
 *   - snapshot() 的各分支（有/无历史、有/无时间线、脏数据、reason）
 *   - addEvent 的两类裁剪（故事 80 / 调试 120）
 *   - advanceTime 的长时间跳（elapsed 文案被省略）、时间线超长截断、时间线不上限时的分支
 *   - import 的拒绝分支、各 getter
 *
 * 所有用户可见文案都通过 t('key') 断言：改 locale 不会让这些检查静默通过，
 * 文件本身也保持 ASCII。
 */
import { describe, expect, it, vi } from 'vitest'
import * as game from '../src/game/state'
import { localStorageStore } from '../src/utils/storage'
import { SAVE_KEY } from '../src/utils/storage'
import { realCalendar, segmentName } from '../src/utils/calendar'
import { t } from '../src/i18n'
import { SEGMENT_NAMES, SHORT_TIME_LABEL, ELAPSED_PREFIX, REASON_LABEL } from './support/locale-patterns'
import { createGame } from './support/game-fixtures'

/* ---- 以下都是测试自己编的 fixture（非产品文案） ---- */

const PLAYER_ACTION = 'I head to the docks'
const GM_REPLY = 'The sea air is salty.'
const LOG_LINE = 'a line from the log'
const LONG_TEXT = 'x'.repeat(300)
const A_YEAR_APART = 'a year apart'
const WAITED_SEVEN_DAYS = 'waited seven days'
const OLD_STORY = 'the old story'
const BROKEN_JSON = '{broken'

const logText = (i: number) => `entry ${i}`

const dayReason = (i: number) => `day ${i}`

describe('constructor and getters', () => {
  it('falls back to the initial state when no argument is passed (the ?? branch)', () => {
    const s = createGame()
    expect(game.turn(s)).toBe(0)
    expect(s.data.player.name).toBe(t('player.defaultName'))
  })

  it('scene and the short time label are readable', () => {
    const s = createGame()
    expect(s.data.player).toEqual({ name: t('player.defaultName') })
    expect(game.sceneOf(s).name).toBe(t('scene.unknownPlace'))
    // 简短时间标签直接用历法格式化：GameState 不再包一层同名 getter（避免两份真值来源）
    expect(realCalendar.formatShort(game.iso(s))).toMatch(SHORT_TIME_LABEL)
  })
})

describe('segmentName - the three segment branches', () => {
  it('before noon -> morning', () => {
    expect(segmentName(0)).toBe(SEGMENT_NAMES[0])
    expect(segmentName(11)).toBe(SEGMENT_NAMES[0])
  })

  it('noon to early evening -> afternoon', () => {
    expect(segmentName(12)).toBe(SEGMENT_NAMES[1])
    expect(segmentName(17)).toBe(SEGMENT_NAMES[1])
  })

  it('late evening -> evening', () => {
    expect(segmentName(18)).toBe(SEGMENT_NAMES[2])
    expect(segmentName(23)).toBe(SEGMENT_NAMES[2])
  })

  it('returns one of the three localized segment names', () => {
    expect(SEGMENT_NAMES).toContain(segmentName(9))
  })
})

describe('addEvent - two limits, counted separately', () => {
  it('keeps the last 80 story events', () => {
    const s = createGame()
    for (let i = 0; i < 100; i += 1) game.addEvent(s, 'narration', logText(i))

    expect(s.data.events).toHaveLength(80)
    // 保留的是最后 80 条：第 20 条在最前，第 99 条在最后
    expect(s.data.events[0].text).toBe(logText(20))
    expect(s.data.events.at(-1)?.text).toBe(logText(99))
  })

  it('keeps the last 120 debug events', () => {
    const s = createGame()
    for (let i = 0; i < 200; i += 1) game.addEvent(s, 'tool', logText(i))

    expect(s.data.events).toHaveLength(120)
    expect(s.data.events[0].text).toBe(logText(80))
    expect(s.data.events.at(-1)?.text).toBe(logText(199))
  })

  it('debug noise cannot push the story out (that is the model memory)', () => {
    const s = createGame()
    for (let i = 0; i < 30; i += 1) game.addEvent(s, 'narration', logText(i))
    // 调试开着时一个回合能产生十几条：这里灌 300 条，故事必须一条不少
    for (let i = 0; i < 300; i += 1) game.addEvent(s, 'tool', logText(i))

    const story = s.data.events.filter((event) => event.kind === 'narration')
    expect(story).toHaveLength(30)
    expect(story[0].text).toBe(logText(0))
  })
})

describe('advanceTime - timeline branches', () => {
  it('truncates the timeline from the head past MAX_TIMELINE (40)', () => {
    const s = createGame()
    for (let i = 0; i < 50; i += 1) game.advanceTime(s, 1, 'day', dayReason(i))

    expect(s.data.timeline).toHaveLength(40)
    expect(s.data.timeline.at(-1)?.reason).toBe(dayReason(49))
  })

  it('a jump beyond 180 days no longer reports the elapsed time', () => {
    const s = createGame()
    const before = game.timeLabel(s)
    const out = game.advanceTime(s, 1, 'year', A_YEAR_APART)
    const after = game.timeLabel(s)
    // LONG_JUMP_MS 阈值：超过半年就不显示 elapsed
    expect(out).not.toContain(ELAPSED_PREFIX)
    expect(out).toContain(t('tools.advanceResult', { before, after }))
    expect(out).toContain(t('tools.advanceReason', { reason: A_YEAR_APART }))
  })

  it('omits the reason line when no reason is passed', () => {
    const s = createGame()
    const out = game.advanceTime(s, 1, 'day')
    expect(out).not.toContain(REASON_LABEL)
  })

  it('with 3 or more timeline entries, only advances of 4 hours or more are worth recording', () => {
    const s = createGame()
    // 先塞满 3 条（这几条无论跨度多小都会被记，因为 timeline.length < 3）
    for (let i = 0; i < 3; i += 1) game.advanceTime(s, 1, 'day')
    const before = s.data.timeline.length
    // 1 小时 < 4 小时，且已有 >=3 条 → 不值得记
    game.advanceTime(s, 1, 'hour')
    expect(s.data.timeline).toHaveLength(before)
  })
})

describe('snapshot - branches', () => {
  it('uses history when present, tagged with the player/GM roles', () => {
    const s = createGame()
    const snap = game.snapshot(s, [
      { role: 'user', content: PLAYER_ACTION },
      { role: 'assistant', content: GM_REPLY },
    ])
    expect(snap).toContain(t('snapshot.recent'))
    expect(snap).toContain(t('snapshot.recentLine', { who: t('snapshot.player'), text: PLAYER_ACTION }))
    expect(snap).toContain(t('snapshot.recentLine', { who: t('snapshot.gm'), text: GM_REPLY }))
  })

  it('falls back to the log when there is no history', () => {
    const s = createGame()
    game.addEvent(s, 'narration', LOG_LINE)
    const snap = game.snapshot(s, [])
    expect(snap).toContain(t('snapshot.recent'))
    expect(snap).toContain(LOG_LINE)
  })

  it('collapses long text to one line and truncates it to 160 characters', () => {
    const s = createGame()
    game.addEvent(s, 'narration', LONG_TEXT)
    const snap = game.snapshot(s, [])
    // 截断到 160 字（替换空白后）
    expect(snap).toContain(LONG_TEXT.slice(0, 160))
    expect(snap).not.toContain(LONG_TEXT.slice(0, 161))
  })

  it('appends the reason in parentheses when the timeline entry has one', () => {
    const s = createGame()
    game.advanceTime(s, 1, 'week', WAITED_SEVEN_DAYS)
    const snap = game.snapshot(s, [])
    expect(snap).toContain(t('snapshot.timeline'))
    expect(snap).toContain(
      t('snapshot.timelineLine', { to: s.data.timeline[0].to, reason: WAITED_SEVEN_DAYS }),
    )
  })

  it('skips timeline entries with an empty to; no heading when every entry is empty', () => {
    const s = createGame()
    s.data.timeline = [{ from: 'a', to: '', reason: '', elapsedMs: 0, at: '' }] as never
    expect(game.snapshot(s, [])).not.toContain(t('snapshot.timeline'))
  })

  it('with no log and no history the snapshot has only turn / time / place', () => {
    const s = createGame()
    const snap = game.snapshot(s, [])
    expect(snap).not.toContain(t('snapshot.recent'))
    expect(snap).not.toContain(t('snapshot.timeline'))
  })
})

describe('import - rejection branches', () => {
  it('rejects non-objects, a missing player, and a player that is not an object', () => {
    const s = createGame()
    for (const bad of ['[]', '"a string"', 'null', '{}', '{"player": 1}', '{"player": null}']) {
      expect(() => game.importFile(s, bad, localStorageStore(localStorage)), `should reject: ${bad}`).toThrow(
        t('save.notValid'),
      )
    }
  })

  it('throws a parse error on broken JSON', () => {
    const s = createGame()
    expect(() => game.importFile(s, BROKEN_JSON, localStorageStore(localStorage))).toThrow()
  })
})

describe('save / reset', () => {
  it('save returns false on failure (private mode)', () => {
    const s = createGame()
    const store = localStorageStore(localStorage)
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(game.save(s, store)).toBe(false)
    spy.mockRestore()
  })

  it('reset writes back a fresh initial state', () => {
    const s = createGame()
    const store = localStorageStore(localStorage)
    game.addEvent(s, 'narration', OLD_STORY)
    game.advanceTime(s, 3, 'day')
    game.reset(s, store)

    expect(s.data.events).toHaveLength(0)
    expect(s.data.timeline).toHaveLength(0)
    expect(game.turn(s)).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBeTruthy()
  })
})
