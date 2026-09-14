/**
 * 测试夹具：造「一局」与「引擎上下文」。
 *
 * 为什么集中在这里：纯数据 + 纯函数之后，造状态是「initialState() + 传 store」两步，
 * 每个测试文件各写一份就会出现五份几乎相同的 freshGame / testContext / fresh，
 * 改一次签名要改五处。这里给统一入口，测试文件只声明自己需要什么。
 */

import * as game from '../../src/game/state'
import { localStorageStore, SAVE_KEY, type SaveStore } from '../../src/utils/storage'
import { saveConfig } from '../../src/agent/config'
import type { AgentContext } from '../../src/agent/agent'
import type { ChatMessage } from '../../src/types/state'

/**
 * 把配置写成「一个假服务商」——凡是要真跑一遍回合的测试都要先做这件事，
 * 否则 llm 层会因为「没配置」直接抛错。
 *
 * @param maxAgentSteps 步数上限；测试里当护栏用时显式传，保持一致才可断言上限行为
 */
export function configureFakeProvider(maxAgentSteps = 5): void {
  saveConfig({
    provider: 'custom',
    apiKey: 'k',
    apiBase: 'https://example.test/v1',
    model: 'm',
    maxAgentSteps,
  })
}

/** 一个什么都不做的落盘实现（用于「不关心存储」的用例） */
export const noopStore: SaveStore = { save: () => true }

/** 一个永远写不进去的落盘实现（隐私模式 / 配额满） */
export const failingStore: SaveStore = {
  save: () => false,
}

/**
 * 造一局：纯数据，不接存储、不接 Vue。
 * 领域测试（state / tools / prompts）用它就够。
 *
 * @param seed 可选的初始改动（例如先塞点日志），在返回前应用
 */
export function createGame(seed?: (s: game.GameState) => void): game.GameState {
  const s = game.initialState()
  seed?.(s)
  return s
}

/**
 * 造一局并接上真 localStorage 的存档读写器。
 * 需要验证「落盘 / 读档」的用例用它。
 */
export function createPersistedGame(): { state: game.GameState; store: SaveStore } {
  return { state: game.initialState(), store: localStorageStore(localStorage) }
}

/**
 * 造引擎要的上下文：纯数据 + 三个动作。
 * 引擎测试（agent）用它 —— 引擎只认 AgentContext，不认存储与叙事流。
 */
export function createAgentContext(state: game.GameState = createGame()): AgentContext {
  return {
    state,
    addEvent: (kind, text) => game.addEvent(state, kind, text),
    endTurn: () => void game.endTurn(state),
    snapshot: (history: ChatMessage[]) => game.snapshot(state, history),
  }
}

/** 数一数 localStorage 里坏档备份的个数 */
export function countBackupKeys(): number {
  let n = 0
  for (let i = 0; ; i += 1) {
    const k = localStorage.key(i)
    if (k === null) break
    if (k.startsWith(SAVE_KEY + '.broken-')) n += 1
  }
  return n
}
