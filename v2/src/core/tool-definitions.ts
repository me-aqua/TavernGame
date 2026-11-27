/**
 * 工具声明（CONTRACT §4.3）：模型看到的参数表与引擎执行器读的实参名**同一份**。
 *
 * 一个工具在这里只有一条描述：`*_SHAPE` 是「参数名 ⇒ 给模型看的 JSON Schema」，
 * `advanceTimeArgsOf` / `writeStateArgsOf` 用同一张形状表取实参 —— 所以
 * 「向模型声明 amount/unit、执行器却读 hours」这种漂移不可能再发生。
 *
 * `advance_time` 的 `unit` 枚举**按时间模式收窄**：`toolDefinitionsOf(mode)` / `advanceTimeSchemaOf(mode)`
 * 用 `unitsOfMode(mode)` 生成（唯一来源），模型不会看到这个模式不认的单位。
 * 静态 `TOOL_DEFINITIONS` 保留六个单位的全集，给没有卡可比的调用方 / 既有判据用；
 * 两者共用同一个 `advanceTimeShape` 构造器，形状只有这一份。
 *
 * 这里只住参数的**名字与形状**；值域（正整数、模式单位表内、按元素类型收值）仍住在执行器
 * （`statetree.advanceTime` / `engine.applyWrite`），不在这里重写第二份。
 */
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'
import { INTEGER_LIMIT, TIME_UNITS, unitsOfMode } from './statetree'
import type { TimeMode } from './types'

/** 工具名（`toolsForNode` 只发这两种） */
export type ToolName = 'advance_time' | 'write_state'

/** 一个工具给模型看的那一条：描述 + 参数 schema */
export interface ToolDefinition {
  description: string
  inputSchema: JSONSchema7
}

/** `advance_time` 的参数：正整数 + 允许的单位（由调用方给：全集或某个模式的单位表） */
function advanceTimeShape(units: readonly string[]) {
  return {
    amount: {
      type: 'integer',
      minimum: 1,
      description: 'How many units to advance; a positive whole number.',
    },
    unit: {
      type: 'string',
      enum: [...units],
      description: `Which unit to advance by: ${units.join(', ')}.`,
    },
  } satisfies Record<string, JSONSchema7Definition>
}

/** 静态工具表用的全集（六个单位）；按模式收窄的那一份由 `advanceTimeShape(unitsOfMode(mode))` 生成 */
const ADVANCE_TIME_SHAPE = advanceTimeShape(TIME_UNITS)

/** `write_state` 的参数：值路径 + 新值（文字或整数都收：模型两种发法都有） */
const WRITE_STATE_SHAPE = {
  path: {
    type: 'string',
    description: 'Full dotted code of the value path to write (for example "1.1" or "1.1.0").',
  },
  value: {
    description: 'The new value: a string for text/enum, an integer for a number element.',
    anyOf: [{ type: 'string' }, { type: 'integer', minimum: -INTEGER_LIMIT, maximum: INTEGER_LIMIT }],
  },
} satisfies Record<string, JSONSchema7Definition>

/** 按形状表的键取实参：声明的参数名就是执行器读到的参数名 */
function pickArgs<T extends Record<string, unknown>>(
  args: Record<string, unknown>,
  shape: T,
): { [K in keyof T]: unknown } {
  return Object.fromEntries(Object.keys(shape).map((key) => [key, args[key]])) as {
    [K in keyof T]: unknown
  }
}

/** 工具名 ⇒ 描述 + 参数 schema（provider 原样序列化给模型） */
export const TOOL_DEFINITIONS: Record<ToolName, ToolDefinition> = {
  advance_time: {
    description: 'Advance the in-game clock by a whole number of time units.',
    inputSchema: {
      type: 'object',
      properties: ADVANCE_TIME_SHAPE,
      required: Object.keys(ADVANCE_TIME_SHAPE),
    },
  },
  write_state: {
    description: 'Write one value into the state tree of the current scene.',
    inputSchema: {
      type: 'object',
      properties: WRITE_STATE_SHAPE,
      required: Object.keys(WRITE_STATE_SHAPE),
    },
  },
}

/** 这个模式给模型看的 `advance_time` 参数 schema：`unit` 枚举 = `unitsOfMode(mode)` */
export function advanceTimeSchemaOf(mode: TimeMode): JSONSchema7 {
  const shape = advanceTimeShape(unitsOfMode(mode))
  return { type: 'object', properties: shape, required: Object.keys(shape) }
}

/** 这个模式下发给模型的完整工具表：只有 `advance_time.unit` 跟着模式换，别的原样 */
export function toolDefinitionsOf(mode: TimeMode): Record<ToolName, ToolDefinition> {
  return {
    ...TOOL_DEFINITIONS,
    advance_time: { ...TOOL_DEFINITIONS.advance_time, inputSchema: advanceTimeSchemaOf(mode) },
  }
}

/** `advance_time` 的实参（键与 `ADVANCE_TIME_SHAPE` 同一份） */
export function advanceTimeArgsOf(args: Record<string, unknown>): {
  [K in keyof typeof ADVANCE_TIME_SHAPE]: unknown
} {
  return pickArgs(args, ADVANCE_TIME_SHAPE)
}

/** `write_state` 的实参（键与 `WRITE_STATE_SHAPE` 同一份） */
export function writeStateArgsOf(args: Record<string, unknown>): {
  [K in keyof typeof WRITE_STATE_SHAPE]: unknown
} {
  return pickArgs(args, WRITE_STATE_SHAPE)
}
