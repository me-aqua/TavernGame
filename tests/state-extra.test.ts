/**
 * state.ts 的补充测试 —— 覆盖现有 tests/state.test.ts 未触及的分支。
 *
 * 重点：
 *   - snapshot() 的各分支（有/无历史、有/无时间线、脏数据、reason）
 *   - addLog 的 MAX_LOG 截断
 *   - advanceTime 的长时间跳（elapsed 文案被省略）、时间线超长截断、时间线不上限时的分支
 *   - import 的拒绝分支、各 getter
 */
import { describe, expect, it, vi } from 'vitest'
import { GameState } from '../src/core/state'
import { createInitialState, SAVE_KEY } from '../src/core/persistence'

function fresh() {
  return new GameState(createInitialState())
}

describe('构造函数与各 getter', () => {
  it('不传参数时用初始状态（构造函数的 ?? 分支）', () => {
    const s = new GameState()
    expect(s.turn).toBe(0)
    expect(s.player.name).toBe('无名者')
  })

  it('player / scene / timeLabelShort / segmentName 都能读', () => {
    const s = fresh()
    expect(s.player).toEqual({ name: '无名者' })
    expect(s.scene.name).toBe('未知之地')
    expect(s.timeLabelShort).toMatch(/^\d+ 月 \d+ 日 · (上午|下午|晚上)$/)
    expect(['上午', '下午', '晚上']).toContain(s.segmentName)
  })
})

describe('segmentName —— 三个时段分支', () => {
  /** 把时刻设成当天的某个小时（用本地时间构造，getHours 才一致） */
  function atHour(hour: number) {
    const s = fresh()
    const d = new Date(s.data.time.iso)
    d.setHours(hour, 0, 0, 0)
    s.data.time.iso = d.toISOString()
    return s
  }

  it('凌晨到上午 → 上午', () => {
    expect(atHour(0).segmentName).toBe('上午')
    expect(atHour(11).segmentName).toBe('上午')
  })

  it('中午到傍晚 → 下午', () => {
    expect(atHour(12).segmentName).toBe('下午')
    expect(atHour(17).segmentName).toBe('下午')
  })

  it('晚上 → 晚上', () => {
    expect(atHour(18).segmentName).toBe('晚上')
    expect(atHour(23).segmentName).toBe('晚上')
  })
})

describe('addLog —— 上限截断', () => {
  it('超过 MAX_LOG(80) 时从头部丢弃，保留最后 80 条', () => {
    const s = fresh()
    for (let i = 0; i < 100; i += 1) s.addLog('narration', `第 ${i} 条`)

    expect(s.data.log).toHaveLength(80)
    // 保留的是最后 80 条：第 20 条在最前，第 99 条在最后
    expect(s.data.log[0].text).toBe('第 20 条')
    expect(s.data.log.at(-1)?.text).toBe('第 99 条')
  })
})

describe('advanceTime —— 时间线分支', () => {
  it('时间线超过 MAX_TIMELINE(40) 时从头部截断', () => {
    const s = fresh()
    for (let i = 0; i < 50; i += 1) s.advanceTime(1, 'day', `第 ${i} 天`)

    expect(s.data.timeline).toHaveLength(40)
    expect(s.data.timeline.at(-1)?.reason).toBe('第 49 天')
  })

  it('大跨度跳跃（>180 天）不再回传「过去了多久」', () => {
    const s = fresh()
    const out = s.advanceTime(1, 'year', '一别一年')
    // LONG_JUMP_MS 阈值：超过半年就不显示 elapsed
    expect(out).not.toContain('过去了')
    expect(out).toContain('时间推进')
    expect(out).toContain('一别一年')
  })

  it('不传 reason 时不追加「原因」那一行', () => {
    const s = fresh()
    const out = s.advanceTime(1, 'day')
    expect(out).not.toContain('原因：')
  })

  it('时间线已有 3 条以上时，只有 >=4 小时的推进才值得记（短推进不记）', () => {
    const s = fresh()
    // 先塞满 3 条（这几条无论跨度多小都会被记，因为 timeline.length < 3）
    for (let i = 0; i < 3; i += 1) s.advanceTime(1, 'day')
    const before = s.data.timeline.length
    // 1 小时 < 4 小时，且已有 >=3 条 → 不值得记
    s.advanceTime(1, 'hour')
    expect(s.data.timeline).toHaveLength(before)
  })
})

describe('snapshot —— 分支', () => {
  it('有历史时用历史，且带玩家/GM 的角色标记', () => {
    const s = fresh()
    const snap = s.snapshot([
      { role: 'user', content: '我去码头' },
      { role: 'assistant', content: '海风很咸。' },
    ])
    expect(snap).toContain('### 最近发生的事')
    expect(snap).toContain('玩家：我去码头')
    expect(snap).toContain('你(GM)：海风很咸。')
  })

  it('没有历史时回退到日志', () => {
    const s = fresh()
    s.addLog('narration', '日志里的一条')
    const snap = s.snapshot([])
    expect(snap).toContain('### 最近发生的事')
    expect(snap).toContain('日志里的一条')
  })

  it('日志里的脏条目被跳过（不是对象就 continue）', () => {
    const s = fresh()
    s.data.log = [null, '字符串', { kind: 'narration', text: '正常条目', at: '' }] as never
    expect(() => s.snapshot([])).not.toThrow()
    expect(s.snapshot([])).toContain('正常条目')
  })

  it('时间线把长文本压成一行并截到 160 字', () => {
    const s = fresh()
    const 长文本 = '啊'.repeat(300)
    s.addLog('narration', 长文本)
    const snap = s.snapshot([])
    // 截断到 160 字（替换空白后）
    expect(snap).toContain('啊'.repeat(160))
    expect(snap).not.toContain('啊'.repeat(161))
  })

  it('时间线带 reason 时用括号附上', () => {
    const s = fresh()
    s.advanceTime(1, 'week', '等了七天')
    const snap = s.snapshot([])
    expect(snap).toContain('### 时间线')
    expect(snap).toContain('（等了七天）')
  })

  it('时间线里 to 为空的记录被跳过；全是空记录时不打标题', () => {
    const s = fresh()
    s.data.timeline = [{ from: 'a', to: '', reason: '', elapsedMs: 0, at: '' }] as never
    expect(s.snapshot([])).not.toContain('### 时间线')
  })

  it('日志与历史都为空时，快照只有回合/时间/地点', () => {
    const s = fresh()
    const snap = s.snapshot([])
    expect(snap).not.toContain('### 最近发生的事')
    expect(snap).not.toContain('### 时间线')
  })
})

describe('import —— 拒绝分支', () => {
  it('不是对象、缺 player、player 不是对象都会被拒', () => {
    const s = fresh()
    for (const bad of ['[]', '"字符串"', 'null', '{}', '{"player": 1}', '{"player": null}']) {
      expect(() => s.import(bad), `应拒绝：${bad}`).toThrow('这不是有效的存档文件')
    }
  })

  it('坏 JSON 抛出解析错误', () => {
    const s = fresh()
    expect(() => s.import('{坏掉的')).toThrow()
  })
})

describe('save / reset', () => {
  it('save 失败返回 false（隐私模式）', () => {
    const s = fresh()
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(s.save()).toBe(false)
    spy.mockRestore()
  })

  it('reset 会写回一份全新的初始状态', () => {
    const s = fresh()
    s.addLog('narration', '旧故事')
    s.advanceTime(3, 'day')
    s.reset()

    expect(s.data.log).toHaveLength(0)
    expect(s.data.timeline).toHaveLength(0)
    expect(s.turn).toBe(0)
    expect(localStorage.getItem(SAVE_KEY)).toBeTruthy()
  })
})
