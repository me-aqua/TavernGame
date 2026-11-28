/**
 * 状态元素编号的底层工具：深度、父子关系、孩子清单、按 code 找元素。
 *
 * 为什么单开一份：`statetree` 的路径派生、同步与校验三块都要这几把尺，数组规则（`state-values` /
 * `state-array`）也要 —— 都从 `statetree.ts` 取会绕成循环 import。这里只认 code，不认识值。
 */
import { t } from '../i18n'
import { AppError } from './errors'
import type { StateElement } from './types'

/** 可见深度上限（`.0` 不计）：`1.1.1.1.1` 合法，第 6 段不合法 */
export const MAX_DEPTH = 5

/** 数字元素的绝对值上限（值、初始值、上下限与步幅都用这一条） */
export const INTEGER_LIMIT = 1e9

/** 元素编号：点分数字 */
export const CODE = /^\d+(\.\d+)*$/

/** 一个普通对象（不是数组、不是 null）—— 卡与值树里到处要判这个形状 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 可见深度：`.0` 段不计；`0` 自己是第 1 层 */
export function codeDepth(code: string): number {
  return Math.max(1, code.split('.').filter((segment) => segment !== '0').length)
}

/** 父 code；顶层（没有点）返回 `undefined` */
export function parentOfCode(code: string): string | undefined {
  const at = code.lastIndexOf('.')
  return at > 0 ? code.slice(0, at) : undefined
}

/** 根元素的 code（`1.1.1` ⇒ `1`）—— 初始值只挂在它身上 */
export function rootCodeOf(code: string): string {
  return code.split('.')[0]
}

/** 按 code 找元素；找不到就是卡坏了（调用方拿到的 code 都来自卡或校验过的树） */
export function elementAt(state: StateElement[], code: string): StateElement {
  const element = state.find((item) => item.code === code)
  if (!element) {
    throw new AppError('E_VALIDATION', {
      message: t('issue.elementMissing', { code }),
      nextStep: t('next.editor'),
      detail: { code },
    })
  }
  return element
}

/** 直接孩子（按最后一段升序）；只认 `code.` 前缀且后面再没有点的那种 */
export function childrenOf(state: StateElement[], code: string): StateElement[] {
  const prefix = `${code}.`
  return state
    .filter((item) => item.code.startsWith(prefix) && !item.code.slice(prefix.length).includes('.'))
    .sort((a, b) => Number(a.code.slice(prefix.length)) - Number(b.code.slice(prefix.length)))
}

/** 一个 code 连同它的整棵子树 */
export function subtreeCodes(state: StateElement[], code: string): string[] {
  const prefix = `${code}.`
  return state.filter((item) => item.code === code || item.code.startsWith(prefix)).map((item) => item.code)
}

/**
 * 这个 code 是不是**数组字段**（某个祖先元素是数组）：
 * 数组的子元素是 item 的字段定义（schema），不是值路径。
 */
export function isInsideArray(state: StateElement[], code: string): boolean {
  for (let parent = parentOfCode(code); parent !== undefined; parent = parentOfCode(parent)) {
    const element = state.find((item) => item.code === parent)
    if (element?.type === 'array') return true
  }
  return false
}
