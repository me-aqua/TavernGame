/**
 * 提示词测试。
 *
 * 提示词是这个项目的「游戏逻辑」（doc/DESIGN.md：提示词 = 作者控制 AI 的代码），
 * 而它最容易改坏的方式是**示例与说明打架**（模型永远跟着示例走）。
 * 所以这里断言的是「示例的完整形态」与「装配不会漏参数」，不是措辞好不好。
 *
 * 提示词内容在 prompts/*.md；这个文件直接读文件来断言内容本身。
 */
import { describe, expect, it } from 'vitest'
import {
  renderPrompt,
  toolsPrompt,
  buildSystemPrompt,
  toolResultsPrompt,
  OPENING_INSTRUCTION,
  FORCED_NARRATION_INSTRUCTION,
} from '../src/core/prompts'
// 测试直接读源文件：断言的是**内容本身**（编码是否同步由 npm run prompts:check 负责）
import { readFileSync } from 'node:fs'
const 系统模板 = readFileSync('prompts/system.md', 'utf8')
const 工具模板 = readFileSync('prompts/tools.md', 'utf8')
import { GameState } from '../src/core/state'
import { createInitialState } from '../src/core/persistence'

describe('提示词文件（prompts/）', () => {
  it('不含 BOM、不含非法 UTF-8、不含 CRLF', () => {
    for (const [名, 内容] of [
      ['system.md', 系统模板],
      ['tools.md', 工具模板],
    ] as const) {
      expect(内容.charCodeAt(0), `${名} 带 BOM`).not.toBe(0xfeff)
      expect(内容.includes('\uFFFD'), `${名} 有非法字节`).toBe(false)
      expect(内容.includes('\r'), `${名} 含 CRLF`).toBe(false)
    }
  })

  it('system.md 的三个占位符都在', () => {
    for (const 键 of ['TOOLS', 'CALENDAR', 'SNAPSHOT']) {
      expect(系统模板).toContain(`{{${键}}}`)
    }
  })

  it('示例是完整形态：工具块前面必须有叙事文字', () => {
    // 血泪教训：曾经用孤零零一个工具块当示例，
    // 模型学到的就是「工具是单独一条消息」，于是干脆不调用
    const 首个围栏 = 工具模板.indexOf('```tool')
    expect(首个围栏).toBeGreaterThan(0)
    const 围栏之前的文字 = 工具模板.slice(0, 首个围栏)
    expect(围栏之前的文字).toContain('藏书阁') // 是叙事，不是元话术
  })

  it('明确写了「时间过去了就必须调用工具」', () => {
    expect(工具模板).toContain('必须调用')
    expect(工具模板).toMatch(/不是可选项/)
  })
})

describe('renderPrompt', () => {
  it('替换占位符', () => {
    expect(renderPrompt('你好 {{名字}}！', { 名字: '世界' })).toBe('你好 世界！')
  })

  it('同一个占位符出现多次也会全替换', () => {
    expect(renderPrompt('{{X}} 和 {{X}}', { X: 'a' })).toBe('a 和 a')
  })

  it('⚠️ 有占位符没填就抛错（绝不把 {{X}} 发给模型）', () => {
    expect(() => renderPrompt('你好 {{漏掉的}}', { 别的不相关: 'x' })).toThrow(/未填的占位符/)
  })
})

describe('装配结果', () => {
  it('⚠️ 折叠了连续空行（发给模型的东西要干净）', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [])
    expect(prompt).not.toMatch(/\n{3,}/)
    expect(toolsPrompt()).not.toMatch(/\n{3,}/)
    expect(toolResultsPrompt('结果')).not.toMatch(/\n{3,}/)
  })

  it('toolsPrompt 填好了占位符，且包含唯一的工具名', () => {
    const 结果 = toolsPrompt()
    expect(结果).toContain('advance_time')
    expect(结果).toContain('上午 → 下午 → 晚上')
    expect(结果).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })

  it('buildSystemPrompt 拼进工具、历法、世界状态', () => {
    const state = new GameState(createInitialState())
    const prompt = buildSystemPrompt(state, [])
    expect(prompt).toContain('## 你可以调用的工具')
    expect(prompt).toContain('## 时间设定')
    expect(prompt).toContain('## 当前世界状态')
    expect(prompt).toContain('【第 0 回合】')
    expect(prompt).toContain(state.timeLabel)
    expect(prompt).not.toMatch(/\{\{[A-Z_]+\}\}/)
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

  it('toolResultsPrompt 把结果嵌进外套文案', () => {
    const 结果 = toolResultsPrompt('🕐 时间推进：上午 → 下午')
    expect(结果).toContain('🕐 时间推进：上午 → 下午')
    expect(结果).toContain('真实数据')
    expect(结果).not.toMatch(/\{\{[A-Z_]+\}\}/)
  })
})

describe('独立提示词', () => {
  it('开场指令要求直接开始故事，不问元问题', () => {
    expect(OPENING_INSTRUCTION).toContain('不要问')
    expect(OPENING_INSTRUCTION).toContain('直接开始故事')
  })

  it('补写指令明确禁止继续调工具', () => {
    expect(FORCED_NARRATION_INSTRUCTION).toContain('只写叙事')
    expect(FORCED_NARRATION_INSTRUCTION).toContain('不要再调用任何工具')
  })

  it('不含任何占位符（它们没有可填的参数）', () => {
    for (const 内容 of [OPENING_INSTRUCTION, FORCED_NARRATION_INSTRUCTION]) {
      expect(内容).not.toMatch(/\{\{[A-Z_]+\}\}/)
    }
  })
})
