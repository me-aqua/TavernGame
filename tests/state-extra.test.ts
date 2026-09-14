/**
 * state.ts 的补充测试 —— 覆盖现有 tests/state.test.ts 未触及的分支。
 *
 * 重点：
 *   - snapshot() 的各分支（有/无历史、有/无时间线、脏数据、reason）
 *   - addLog 的 MAX_LOG 截断
 *   - advanceTime 的长时间跳（elapsed 文案被省略）、时间线超长截断、时间线不上限时的分支
 *   - import 的拒绝分支、各 getter
 *
 * All user-visible text is asserted through t('key'), so a locale change cannot
 * silence these checks and this file stays ASCII-only.
 */
import { describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'
import { SAVE_KEY } from '../src/utils/storage'
import { t } from '../src/i18n'

/** 时段显示名（产品文案，只能从 locale 表取） */
const MORNING = t('calendar.segment.morning')
const AFTERNOON = t('calendar.segment.afternoon')
const EVENING = t('calendar.segment.evening')
const SEGMENT_NAMES = [MORNING, AFTERNOON, EVENING]

/** timeLabelShort 的形状：`{month} 月 {day} 日 · 时段`，月日部分用 \d+ 占位 */
const SHORT_TIME_LABEL = new RegExp(
  `^${t('calendar.monthDay', { month: '\\d+', day: '\\d+' })}${t('calendar.dateSeparator')}(${SEGMENT_NAMES.join('|')})$`,
)

/** elapsed 文案的前缀（产品文案）；出现即说明推进结果回传了「过去了多久」 */
const ELAPSED_PREFIX = t('calendar.elapsed', { parts: '' }).trim()

/** 原因那一行的前缀（产品文案）；出现即说明 reason 被追加了 */
const REASON_LABEL = t('tools.advanceReason', { reason: '' }).trim()

/* ---- 以下都是测试自己编的 fixture（非产品文案） ---- */

const PLAYER_ACTION = 'I head to the docks'
const GM_REPLY = 'The sea air is salty.'
const LOG_LINE = 'a line from the log'
const LONG_TEXT = 'x'.repeat(300)
const A_YEAR_APART = 'a year apart'
const WAITED_SEVEN_DAYS = 'waited seven days'
const OLD_STORY = 'the old story'
const BROKEN_JSON = '{broken'

/** 第 i 条日志的文本 */
const logText = (i: number) => `entry ${i}`

/** 第 i 天的推进原因 */
const dayReason = (i: number) => `day ${i}`

/** 每个用例一个干净状态 */
function fresh() {
  return new GameState(createInitialState())
}

describe('constructor and getters', () => {
  it('falls back to the initial state when no argument is passed (the ?? branch)', () => {
    const s = new GameState()
    expect(s.turn).toBe(0)
    expect(s.player.name).toBe(t('player.defaultName'))
  })

  it('player / scene / timeLabelShort / segmentName are all readable', () => {
    const s = fresh()
    expect(s.player).toEqual({ name: t('player.defaultName') })
    expect(s.scene.name).toBe(t('scene.unknownPlace'))
    expect(s.timeLabelShort).toMatch(SHORT_TIME_LABEL)
    expect(SEGMENT_NAMES).toContain(s.segmentName)
  })
})

describe('segmentName - the three segment branches', () => {
  /** 把时刻设成当天的某个小时（用本地时间构造，getHours 才一致） */
  function atHour(hour: number) {
    const s = fresh()
    const d = new Date(s.data.time.iso)
    d.setHours(hour, 0, 0, 0)
    s.data.time.iso = d.toISOString()
    return s
  }

  it('before noon -> morning', () => {
    expect(atHour(0).segmentName).toBe(MORNING)
    expect(atHour(11).segmentName).toBe(MORNING)
  })

  it('noon to early evening -> afternoon', () => {
    expect(atHour(12).segmentName).toBe(AFTERNOON)
    expect(atHour(17).segmentName).toBe(AFTERNOON)
  })

  it('late evening -> evening', () => {
    expect(atHour(18).segmentName).toBe(EVENING)
    expect(atHour(23).segmentName).toBe(EVENING)
  })
})

describe('addLog - trimming at the limit', () => {
  it('drops from the head past MAX_LOG (80), keeping the last 80 entries', () => {
    const s = fresh()
    for (let i = 0; i < 100; i += 1) s.addLog('narration', logText(i))

    expect(s.data.log).toHaveLength(80)
    // 保留的是最后 80 条：第 20 条在最前，第 99 条在最后
    expect(s.data.log[0].text).toBe(logText(20))
    expect(s.data.log.at(-1)?.text).toBe(logText(99))
  })
})

describe('advanceTime - timeline branches', () => {
  it('truncates the timeline from the head past MAX_TIMELINE (40)', () => {
    const s = fresh()
    for (let i = 0; i < 50; i += 1) s.advanceTime(1, 'day', dayReason(i))

    expect(s.data.timeline).toHaveLength(40)
    expect(s.data.timeline.at(-1)?.reason).toBe(dayReason(49))
  })

  it('a jump beyond 180 days no longer reports the elapsed time', () => {
    const s = fresh()
    const before = s.timeLabel
    const out = s.advanceTime(1, 'year', A_YEAR_APART)
    const after = s.timeLabel
    // LONG_JUMP_MS 阈值：超过半年就不显示 elapsed
    expect(out).not.toContain(ELAPSED_PREFIX)
    expect(out).toContain(t('tools.advanceResult', { before, after }))
    expect(out).toContain(t('tools.advanceReason', { reason: A_YEAR_APART }))
  })

  it('omits the reason line when no reason is passed', () => {
    const s = fresh()
    const out = s.advanceTime(1, 'day')
    expect(out).not.toContain(REASON_LABEL)
  })

  it('with 3 or more timeline entries, only advances of 4 hours or more are worth recording', () => {
    const s = fresh()
    // 先塞满 3 条（这几条无论跨度多小都会被记，因为 timeline.length < 3）
    for (let i = 0; i < 3; i += 1) s.advanceTime(1, 'day')
    const before = s.data.timeline.length
    // 1 小时 < 4 小时，且已有 >=3 条 → 不值得记
    s.advanceTime(1, 'hour')
    expect(s.data.timeline).toHaveLength(before)
  })
})

describe('snapshot - branches', () => {
  it('uses history when present, tagged with the player/GM roles', () => {
    const s = fresh()
    const snap = s.snapshot([
      { role: 'user', content: PLAYER_ACTION },
      { role: 'assistant', content: GM_REPLY },
    ])
    expect(snap).toContain(t('snapshot.recent'))
    expect(snap).toContain(t('snapshot.recentLine', { who: t('snapshot.player'), text: PLAYER_ACTION }))
    expect(snap).toContain(t('snapshot.recentLine', { who: t('snapshot.gm'), text: GM_REPLY }))
  })

  it('falls back to the log when there is no history', () => {
    const s = fresh()
    s.addLog('narration', LOG_LINE)
    const snap = s.snapshot([])
    expect(snap).toContain(t('snapshot.recent'))
    expect(snap).toContain(LOG_LINE)
  })

  it('collapses long text to one line and truncates it to 160 characters', () => {
    const s = fresh()
    s.addLog('narration', LONG_TEXT)
    const snap = s.snapshot([])
    // 截断到 160 字（替换空白后）
    expect(snap).toContain(LONG_TEXT.slice(0, 160))
    expect(snap).not.toContain(LONG_TEXT.slice(0, 161))
  })

  it('appends the reason in parentheses when the timeline entry has one', () => {
    const s = fresh()
    s.advanceTime(1, 'week', WAITED_SEVEN_DAYS)
    const snap = s.snapshot([])
    expect(snap).toContain(t('snapshot.timeline'))
    expect(snap).toContain(
      t('snapshot.timelineLine', { to: s.data.timeline[0].to, reason: WAITED_SEVEN_DAYS }),
    )
  })

  it('skips timeline entries with an empty to; no heading when every entry is empty', () => {
    const s = fresh()
    s.data.timeline = [{ from: 'a', to: '', reason: '', elapsedMs: 0, at: '' }] as never
    expect(s.snapshot([])).not.toContain(t('snapshot.timeline'))
  })

  it('with no log and no history the snapshot has only turn / time / place', () => {
    const s = fresh()
    const snap = s.snapshot([])
    expect(snap).not.toContain(t('snapshot.recent'))
    expect(snap).not.toContain(t('snapshot.timeline'))
  })
})

describe('import - rejection branches', () => {
  it('rejects non-objects, a missing player, and a player that is not an object', () => {
    const s = fresh()
    for (const bad of ['[]', '"a string"', 'null', '{}', '{"player": 1}', '{"player": null}']) {
      expect(() => s.importFile(bad), `should reject: ${bad}`).toThrow(t('save.notValid'))
    }
  })

  it('throws a parse error on broken JSON', () => {
    const s = fresh()
    expect(() => s.importFile(BROKEN_JSON)).toThrow()
  })
})

describe('save / reset', () => {
  it('save returns false on failure (private mode)', () => {
    const s = new GameState({ storage: localStorage })
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(s.save()).toBe(false)
    spy.mockRestore()
  })

  it('reset writes back a fresh initial state', () => {
    const s = new GameState({ storage: localStorage })
    s.addLog('narration', OLD_STORY)
    s.advanceTime(3, 'day')
    s.reset()

    expect(s.data.log).toHaveLength(0)
    expect(s.data.timeline).toHaveLength(0)
    expect(s.turn).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBeTruthy()
  })
})
