/**
 * 提示词测试 —— 此前 0% 覆盖。
 *
 * 提示词是这个项目的「游戏逻辑」（DESIGN.md：提示词 = 作者控制 AI 的代码），
 * 而它最容易改坏的方式是**示例与说明打架**（模型永远跟着示例走）。
 * 所以这里断言的是「示例的完整形态」，不是措辞好不好。
 */
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, OPENING_INSTRUCTION, buildSystemPrompt } from '../src/core/prompts'
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'

describe('SYSTEM_PROMPT', () => {
  it('包含唯一的工具说明与调用格式', () => {
    expect(SYSTEM_PROMPT).toContain('advance_time')
    expect(SYSTEM_PROMPT).toContain('工具调用格式')
  })

  it('示例是完整形态：工具块前面必须有叙事文字', () => {
    // 血泪教训：曾经用孤零零一个工具块当示例，
    // 模型学到的就是「工具是单独一条消息」，于是干脆不调用
    const 首个围栏 = SYSTEM_PROMPT.indexOf('```tool')
    expect(首个围栏).toBeGreaterThan(0)
    const 围栏之前的文字 = SYSTEM_PROMPT.slice(0, 首个围栏).trim()
    expect(围栏之前的文字.length).toBeGreaterThan(50)
    // 而且那文字得是叙事（提到具体场景），不是「下面是一个例子」这类元话术
    expect(围栏之前的文字).toContain('藏书阁')
  })

  it('明确写了「时间过去了就必须调用工具」', () => {
    expect(SYSTEM_PROMPT).toContain('必须调用')
    expect(SYSTEM_PROMPT).toMatch(/不是可选项/)
  })

  it('明确禁止替玩家做决定', () => {
    expect(SYSTEM_PROMPT).toContain('不要替玩家做决定')
  })

  it('要求代价具体、不要总是成功（成败交给模型判断）', () => {
    expect(SYSTEM_PROMPT).toContain('不要总是成功')
    expect(SYSTEM_PROMPT).toContain('代价要具体')
  })
})

describe('buildSystemPrompt', () => {
  it('拼进了历法说明与当前世界状态', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [])
    expect(prompt).toContain('## 时间设定')
    expect(prompt).toContain('## 当前世界状态')
    expect(prompt).toContain('【第 0 回合】')
    expect(prompt).toContain(state.timeLabel)
  })

  it('传入历史时，快照里能看到最近发生的事', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [
      { role: 'user', content: '我去码头' },
      { role: 'assistant', content: '海风很咸。' },
    ])
    expect(prompt).toContain('最近发生的事')
    expect(prompt).toContain('玩家：我去码头')
  })
})

describe('OPENING_INSTRUCTION', () => {
  it('要求直接开始故事，不问元问题', () => {
    expect(OPENING_INSTRUCTION).toContain('不要问')
    expect(OPENING_INSTRUCTION).toContain('直接开始故事')
  })
})
