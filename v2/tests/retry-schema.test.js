/**
 * `retryCount` 的结构校验（阶段 2.4 第 2 关）。
 *
 * 合同值：`0..5` 的整数；**缺省 = 0**（旧卡没有这一格也合法，不迁移、不回写）。
 * 越界 / 小数 / 字符串一律 `E_CHAIN`，与 `historyTurns` 同族。
 */
import { describe, expect, it } from 'vitest'
import { makeCard } from './support/fixtures.js'
import { loadModule } from './support/load.js'

const loadSchema = () => loadModule('core/schema.ts', () => import('../src/core/schema.ts'))

function cardWith(retryCount) {
  const base = makeCard()
  base.chain[1] = { ...base.chain[1], retryCount }
  return base
}

async function rejectionOf(card) {
  const { validateCard } = await loadSchema()
  try {
    validateCard(card)
  } catch (error) {
    return error
  }
  throw new Error('validateCard 没抛错 —— retryCount 的边界没被钉住')
}

describe('retryCount 校验：缺省与合法边界', () => {
  it('没有 retryCount 的旧卡合法（按 0 处理，不迁移）', async () => {
    const { validateCard } = await loadSchema()
    const card = makeCard()
    card.chain.forEach((node) => delete node.retryCount)
    expect(() => validateCard(card)).not.toThrow()
  })

  it('0 与 5（两端）合法', async () => {
    const { validateCard } = await loadSchema()
    expect(() => validateCard(cardWith(0))).not.toThrow()
    expect(() => validateCard(cardWith(5))).not.toThrow()
  })
})

describe('retryCount 校验：越界与类型', () => {
  it('-1 ⇒ E_CHAIN，detail 带上节点与非法值', async () => {
    const error = await rejectionOf(cardWith(-1))
    expect(error.code).toBe('E_CHAIN')
    expect(error.detail).toMatchObject({ nodeId: 'check', retryCount: -1 })
  })

  it('6 ⇒ E_CHAIN（上限合同值是 5）', async () => {
    const error = await rejectionOf(cardWith(6))
    expect(error.code).toBe('E_CHAIN')
    expect(error.detail).toMatchObject({ nodeId: 'check', retryCount: 6 })
  })

  it('1.5 ⇒ E_CHAIN（必须是整数）', async () => {
    expect((await rejectionOf(cardWith(1.5))).code).toBe('E_CHAIN')
  })

  it("'1'（字符串）⇒ E_CHAIN（不静默转数字）", async () => {
    expect((await rejectionOf(cardWith('1'))).code).toBe('E_CHAIN')
  })
})
