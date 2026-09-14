/**
 * store 测试 —— 界面与游戏之间唯一的桥梁，此前 0% 覆盖。
 *
 * 只通过公开 API 驱动：store 的实例是模块级的，
 * 所以每个用例开头都「重新开始」清空（它同时清空消息流与历史）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useGame } from '../src/stores/game'
import { GameState } from '../src/core/state'
import { loadState, SAVE_KEY } from '../src/core/persistence'
import { saveConfig } from '../src/core/config'
import { installFakeLlm, type FakeLlm } from './support/fakeLlm'

let fake: FakeLlm | null = null

beforeEach(() => {
  saveConfig({
    provider: 'custom',
    apiKey: 'k',
    apiBase: 'https://example.test/v1',
    model: 'm',
    maxAgentSteps: 5,
  })
  useGame().重新开始()
})

/** 造一个已写完一回合的 store */
async function 跑一回合(文本 = '你在客栈里醒来。') {
  fake = installFakeLlm([文本])
  const g = useGame()
  await g.执行回合('睁眼')
  fake.restore()
  fake = null
  return g
}

describe('派生状态（侧栏读的就是这些）', () => {
  it('初始：时间是公历格式、回合为 0、场景有名字', () => {
    const g = useGame()
    expect(g.时间标签.value).toMatch(/^\d{4} 年 \d+ 月 \d+ 日 · 星期[日一二三四五六] · (上午|下午|晚上)$/)
    expect(g.回合数.value).toBe(0)
    expect(g.场景.value.name).toBe('未知之地')
    expect(g.时间线.value).toEqual([])
  })

  it('跑完一回合后：回合数 +1、消息流里出现行动与叙事', async () => {
    const g = await 跑一回合()
    expect(g.回合数.value).toBe(1)
    const kinds = g.消息流.value.map((l) => l.kind)
    expect(kinds).toContain('action')
    expect(kinds).toContain('narration')
    expect(g.消息流.value.find((l) => l.kind === 'action')?.text).toBe('睁眼')
    expect(g.消息流.value.find((l) => l.kind === 'narration')?.text).toContain('你在客栈里醒来。')
  })
})

describe('执行回合', () => {
  it('正在跑时拒绝重入（重入保护）', async () => {
    fake = installFakeLlm(['第一次。', '第二次。'])
    const g = useGame()
    await Promise.all([g.执行回合('一'), g.执行回合('二')])
    // 只有第一个回合的请求发出去了
    expect(fake.calls).toHaveLength(1)
    fake.restore()
    fake = null
  })

  it('正在跑标志会复位（否则之后所有回合都被挡住）', async () => {
    fake = installFakeLlm(['写完了。'])
    const g = useGame()
    expect(g.正在跑.value).toBe(false)
    await g.执行回合('动一下')
    expect(g.正在跑.value).toBe(false)
    fake.restore()
    fake = null
  })

  it('回合出错后标志位仍复位（否则界面永远卡在思考中）', async () => {
    // 说明：store 的取消是内部行为（中止当前回合），
    // 从公开 API 无法注入 signal —— 取消路径由 agent.test.ts 直接测 runTurn。
    fake = installFakeLlm(['x'])
    fake.failNextWith(new Error('网络断了'))
    const g = useGame()

    await expect(g.执行回合('试试')).rejects.toThrow('网络断了')
    expect(g.正在跑.value).toBe(false)
    fake.restore()
    fake = null
  })
})

describe('日志恢复', () => {
  it('只回放叙事与行动（system 类不重复提示）', async () => {
    const g = await 跑一回合()
    const save = JSON.parse(g.导出存档()) as { log: Array<{ kind: string; text: string; at: string }> }
    save.log = [
      { kind: 'narration', text: '存档里的叙事', at: new Date().toISOString() },
      { kind: 'system', text: '不该被回放', at: new Date().toISOString() },
      { kind: 'action', text: '存档里的行动', at: new Date().toISOString() },
    ]
    g.导入存档(JSON.stringify(save))
    expect(g.消息流.value).toHaveLength(0)

    g.restoreLog()
    expect(g.消息流.value.map((l) => l.kind)).toEqual(['narration', 'action'])
  })
})

describe('换 state 的三个入口', () => {
  it('重新开始：回合归零、消息流清空、存档被覆盖', async () => {
    const g = await 跑一回合()
    expect(g.回合数.value).toBe(1)
    g.重新开始()
    expect(g.回合数.value).toBe(0)
    expect(g.消息流.value).toHaveLength(0)
    expect(new GameState(loadState().data!).turn).toBe(0)
  })

  it('导出 → 重新开始 → 导入：回合数回来了', async () => {
    const g = await 跑一回合()
    const json = g.导出存档()
    g.重新开始()
    expect(g.回合数.value).toBe(0)
    g.导入存档(json)
    expect(g.回合数.value).toBe(1)
    expect(g.消息流.value).toHaveLength(0)
  })

  it('导入损坏的 JSON 会抛错（由界面提示）', () => {
    const g = useGame()
    expect(() => g.导入存档('{坏掉的')).toThrow()
  })
})

describe('调试模式', () => {
  it('打开时把模型原始输出加进消息流', async () => {
    const g = useGame()
    g.调试模式.value = true
    fake = installFakeLlm(['原始输出示例'])
    await g.执行回合('看看')
    fake.restore()
    fake = null
    const rawLines = g.消息流.value.filter((l) => l.raw !== undefined)
    expect(rawLines).toHaveLength(1)
    expect(rawLines[0].raw).toContain('原始输出示例')
    g.调试模式.value = false
  })

  it('关闭时不加', async () => {
    const g = useGame()
    g.调试模式.value = false
    fake = installFakeLlm(['普通输出'])
    await g.执行回合('看看')
    fake.restore()
    fake = null
    expect(g.消息流.value.filter((l) => l.raw !== undefined)).toHaveLength(0)
  })
})

describe('loadAtStartup', () => {
  it('没有存档时启动错误为 null', () => {
    localStorage.removeItem(SAVE_KEY)
    expect(useGame().启动错误).toBeNull()
  })
})
