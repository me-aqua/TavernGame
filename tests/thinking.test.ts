/**
 * 默认模型 `deepseek-flash` + 默认不思考 —— 这一票的契约测试。
 *
 * 六条用例分三类（正常 2 / 边界 2 / 异常 2），断言与固定夹具在
 * `tests/support/thinking-cases.ts`，这里只负责把**真实实现**接上去按 vitest 跑。
 *
 * ⚠️ 六条里有**四条是守卫**（2 / 3 / 5 / 6）：它们断言的是「**不该有**」或名单形态，功能没做时
 *    **也会绿** —— 只看「全红/全绿」会误判。**判别只有 1 / 4 两条**（**实测**：把发思考键那行
 *    改成永不生效，只红这两条；记账与配方见 `.team/test/contract.md` §5.0）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PRESETS, saveConfig, clearConfig } from '../src/agent/config'
import { chat } from '../src/agent/llm'
import { createCases } from './support/thinking-cases'

const cases = createCases({
  chat,
  saveConfig,
  providers: PRESETS,
})

afterEach(() => {
  clearConfig()
})

describe('default model + thinking switch', () => {
  for (const contractCase of cases) {
    describe(`${contractCase.category} | case ${contractCase.id}`, () => {
      it(contractCase.title, async () => {
        await contractCase.run()
      })

      it(`guards: ${contractCase.guards}`, () => {
        // 没有产品断言：只保证 guards 不会腐烂成空串
        expect(contractCase.guards.length).toBeGreaterThan(8)
      })
    })
  }
})
