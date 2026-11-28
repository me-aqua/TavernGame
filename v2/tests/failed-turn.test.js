/**
 * 失败回合留存 · 存档校验（契约 `契约-失败回合留存.md` §5）。
 *
 * 这一份只钉 `validateSave` 对 `save.failedTurn` 的态度：
 *   · 没有这一格 ⇒ 旧存档照旧合法（不迁移、不补键）；
 *   · 有这一格 ⇒ 必须是一个对象，`action` / `at` / `error.{code,message}` / `events` / `text` 都在；
 *   · `events` 的每一项必须是「像 SaveEvent」的对象（`type` / `text` / `at` 都是字符串）；
 *   · 坏形状一律 `E_VALIDATION` + 中文 message，**不许静默丢掉**。
 *
 * ⚠️ 这一格**不参与** `turn` / `tree` / `events` 的判法：失败回合的存档除了多这一格，别的都不变。
 * ⚠️ 空串不在本票的拒绝面（写入侧保证 action 非空；`text: ''` 是正常形态）；别把判据写得更严。
 */
import { describe, expect, it } from 'vitest'
import { makeCard, makeSave } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))
const CJK = /[\u4e00-\u9fff]/
const AT = '2026-11-28T06:30:00.000Z'

function errorOf(run) {
  try {
    run()
    return null
  } catch (cause) {
    return cause
  }
}

/** 最小合法形状：action / at / error / events / text 五个键齐全，nextStep 省略 */
function failedTurn(over = {}) {
  return {
    action: 'act failed',
    at: AT,
    error: { code: 'E_PROVIDER', message: '鉴权失败' },
    events: [],
    text: '',
    ...over,
  }
}

/** 一条 trace 事件（形状与引擎落进 save.events 的一致；校验只看外壳） */
function traceEvent(nodeId = 'check', turn = 1) {
  return {
    type: 'trace',
    text: nodeId,
    at: AT,
    detail: {
      nodeId,
      nodeName: nodeId,
      nodeType: 'normal',
      presetId: 'p-mock',
      prompt: 'PROMPT',
      thinking: '',
      toolCalls: [],
      attempts: [],
      output: '',
      usage: null,
      durationMs: 1,
      tps: null,
      turn,
    },
  }
}

/** 一条 turnStats 事件；失败回合通常没有它，但形状上允许出现（渲染判据用种子覆盖） */
function statsEvent(turn = 1) {
  return {
    type: 'turnStats',
    text: `turn ${turn}`,
    at: AT,
    detail: { turn, totalMs: 1, usage: null, tps: null },
  }
}

/** 一份带最小 failedTurn 的合法存档 */
function saveWith(over = {}) {
  return makeSave(makeCard(), { failedTurn: failedTurn(), ...over })
}

describe('失败回合 · failedTurn 的可选性（§5 #1–#2）', () => {
  it('U1 最小合法 failedTurn（无 nextStep / 空 events / 空 text）带卡、不带卡都过', async () => {
    const { validateSave } = await loadSchema()
    const card = makeCard()
    expect(() => validateSave(saveWith(), card)).not.toThrow()
    expect(() => validateSave(saveWith())).not.toThrow()

    const full = saveWith({
      failedTurn: failedTurn({
        error: { code: 'E_PROVIDER', message: '鉴权失败', nextStep: '去设置里检查 Key' },
        events: [traceEvent(), statsEvent()],
        text: 'PARTIAL_TEXT',
      }),
    })
    expect(() => validateSave(full, card), '带 nextStep / trace / turnStats 的完整形状也要过').not.toThrow()
  })

  it('U2 没有 failedTurn 的旧存档照旧能过（可选字段，不迁移）', async () => {
    const { validateSave } = await loadSchema()
    const card = makeCard()
    const old = makeSave(card)
    expect('failedTurn' in old, '夹具本身不该带这一格').toBe(false)
    expect(() => validateSave(old, card)).not.toThrow()
    expect(() => validateSave(old)).not.toThrow()
  })

  it('U3 failedTurn 不是普通对象 ⇒ E_VALIDATION（null / 数组 / 字符串 / 数字）', async () => {
    const { validateSave } = await loadSchema()
    for (const [note, value] of [
      ['null', null],
      ['数组', []],
      ['字符串', 'failed'],
      ['数字', 1],
    ]) {
      expect(errorOf(() => validateSave(saveWith({ failedTurn: value })))?.code, note).toBe('E_VALIDATION')
    }
  })
})

describe('失败回合 · 必填字段（§5 #3–#5、#9、#11）', () => {
  it('U4 缺 action / at / error / events / text 任意一个都拒', async () => {
    const { validateSave } = await loadSchema()
    for (const field of ['action', 'at', 'error', 'events', 'text']) {
      const value = failedTurn()
      delete value[field]
      expect(errorOf(() => validateSave(saveWith({ failedTurn: value })))?.code, `缺 ${field}`).toBe(
        'E_VALIDATION',
      )
    }
  })

  it('U5 字段类型不对都拒（action / at / error / events / text）', async () => {
    const { validateSave } = await loadSchema()
    for (const [field, value] of [
      ['action', 1],
      ['at', 2],
      ['error', 'E_PROVIDER'],
      ['events', {}],
      ['text', null],
    ]) {
      expect(
        errorOf(() => validateSave(saveWith({ failedTurn: failedTurn({ [field]: value }) })))?.code,
        field,
      ).toBe('E_VALIDATION')
    }
  })
})

describe('失败回合 · error 与 events 的形状（§5 #5–#10）', () => {
  it('U6 error：缺 code / 缺 message / 不是对象 / 类型错都拒；nextStep 可选但给了必须是字符串', async () => {
    const { validateSave } = await loadSchema()
    for (const [note, value] of [
      ['缺 code', { message: '鉴权失败' }],
      ['缺 message', { code: 'E_PROVIDER' }],
      ['不是对象', 'E_PROVIDER'],
      ['code 不是字符串', { code: 1, message: '鉴权失败' }],
      ['message 不是字符串', { code: 'E_PROVIDER', message: 1 }],
      ['nextStep 不是字符串', { code: 'E_PROVIDER', message: '鉴权失败', nextStep: 1 }],
    ]) {
      expect(
        errorOf(() => validateSave(saveWith({ failedTurn: failedTurn({ error: value }) })))?.code,
        note,
      ).toBe('E_VALIDATION')
    }
    expect(
      errorOf(() =>
        validateSave(
          saveWith({
            failedTurn: failedTurn({ error: { code: 'E_PROVIDER', message: '鉴权失败', nextStep: '' } }),
          }),
        ),
      ),
      'nextStep 空串是字符串，应当合法',
    ).toBe(null)
  })

  it('U7 events 元素：非对象 / 缺 type / text / at 都拒；trace + turnStats 合法', async () => {
    const { validateSave } = await loadSchema()
    for (const [note, value] of [
      ['元素不是对象', ['trace']],
      ['缺 type', [{ text: 'x', at: AT }]],
      ['缺 text', [{ type: 'trace', at: AT }]],
      ['缺 at', [{ type: 'trace', text: 'x' }]],
      ['type 不是字符串', [{ type: 1, text: 'x', at: AT }]],
      ['text 不是字符串', [{ type: 'trace', text: 1, at: AT }]],
      ['at 不是字符串', [{ type: 'trace', text: 'x', at: 1 }]],
    ]) {
      expect(
        errorOf(() => validateSave(saveWith({ failedTurn: failedTurn({ events: value }) })))?.code,
        note,
      ).toBe('E_VALIDATION')
    }
    expect(
      errorOf(() =>
        validateSave(saveWith({ failedTurn: failedTurn({ events: [traceEvent(), statsEvent()] }) })),
      ),
      'trace + turnStats 是合法事件外壳',
    ).toBe(null)
  })

  it('U8 拒绝时抛 E_VALIDATION，message 是中文（不是静默丢掉）', async () => {
    const { validateSave } = await loadSchema()
    const error = errorOf(() => validateSave(saveWith({ failedTurn: { action: 1 } })))
    expect(error?.code).toBe('E_VALIDATION')
    expect(error?.message).toMatch(CJK)
  })
})

describe('失败回合 · 不成为绕过校验的后门（§5 口径）', () => {
  it('U9 合法 failedTurn 不会让坏 tree 蒙混过关', async () => {
    const { validateSave } = await loadSchema()
    const card = makeCard()
    const save = saveWith()
    delete save.tree['1']
    const error = errorOf(() => validateSave(save, card))
    expect(error?.code).toBe('E_VALIDATION')
    expect(error?.message).toMatch(CJK)
  })
})
