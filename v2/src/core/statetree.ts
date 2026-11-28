/**
 * 状态树（阶段 2.2 + 阶段 3 数组）的**公开面**：调用方一直从 `core/statetree` 取，内部按活的种类分家。
 *
 *   · `state-codes.ts`   —— 编号的尺：深度、父子、孩子、字段判定、按 code 找元素；
 *   · `state-values.ts`  —— 值像不像：数字上下限 / 下拉白名单 / 时间 / 数组 item 形状与默认值；
 *   · `state-array.ts`   —— 数组值的搬运：加字段、删字段重排、深拷贝；
 *   · `state-data.ts`    —— 路径派生、初始值展开、增删改类型时同步初始值表；
 *   · `state-issues.ts`  —— 整卡问题清单（保存按钮与 `validateCard` 共用）。
 *
 * 时间那半住在 `timevalue.ts`，这里原样转出（与 2.2 之前同一个入口）。
 */
export {
  YEAR_MIN,
  YEAR_MAX,
  TIME_MODES,
  TIME_UNITS,
  cellsOfMode,
  unitsOfMode,
  defaultTimeOf,
  isTimeValue,
  formatTime,
  advanceTime,
} from './timevalue'

export * from './state-codes'
export * from './state-values'
export * from './state-array'
export * from './state-data'
export * from './state-issues'
