/**
 * 新夹具自检（**今天就该绿**）—— 正控。
 *
 * 这一份不 import 任何产品代码：它只量「v5 夹具本身是不是一份合法的 v5 数据」。
 * 为什么需要它：`state-shape` / `state-tree` / `state-time` / `prompt-state` 那几份现在
 * **全都是红的**（功能没做）；如果夹具本身写错了，那些红就分不清是「功能没做」还是「夹具有病」。
 *
 * 量的是 v5 契约里**不需要实现就能判**的那几条：编号铁律、父子存在、深度 ≤ 5、
 * 五种类型各自的字段、`object` 没有自身值、链的引用都能解析。
 */
import { describe, expect, it } from 'vitest'
import {
  chainV5,
  deepCard,
  elementOf,
  stateV5,
  tooDeepCard,
  treeV5,
  v5Card,
} from './support/state-fixtures.js'

const TYPES = ['time', 'text', 'integer', 'enum', 'object']
const UNITS = ['year', 'month', 'week', 'day', 'hour', 'minute', 'second']
const CODE = /^\d+(\.\d+)*$/

/** 可见深度：`.0` 不计（v5 契约 §1） */
function depthOf(code) {
  return code.split('.').filter((segment) => segment !== '0').length
}

/** 某个 code 的直接孩子 code（按相对段升序） */
function childrenOf(state, code) {
  const prefix = `${code}.`
  return state
    .filter((item) => item.code.startsWith(prefix) && !item.code.slice(prefix.length).includes('.'))
    .map((item) => item.code)
    .sort((a, b) => Number(a.split('.').at(-1)) - Number(b.split('.').at(-1)))
}

/** 一整套结构判据；返回违规清单（空数组 = 夹具合法） */
function violationsOf(card) {
  const problems = []
  const codes = card.state.map((item) => item.code)
  if (new Set(codes).size !== codes.length) problems.push('code 重复')
  for (const item of card.state) {
    if (!CODE.test(item.code)) problems.push(`${item.code} 不是合法编号`)
    if (item.code.split('.').includes('0') && item.code !== '0') problems.push(`${item.code} 出现了 .0 段`)
    if (depthOf(item.code) > 5) problems.push(`${item.code} 深度 ${depthOf(item.code)} > 5`)
    if (!TYPES.includes(item.type)) problems.push(`${item.code} 类型 ${item.type} 不认识`)
    const kids = childrenOf(card.state, item.code)
    if (item.type === 'object') {
      if (kids.length === 0) problems.push(`${item.code} 是 object 却没孩子`)
      if ('initial' in item) problems.push(`${item.code} 是 object 却带 initial`)
    } else {
      if (!('initial' in item)) problems.push(`${item.code} 没有 initial`)
    }
    if (kids.length > 0) {
      const segments = kids.map((code) => Number(code.split('.').at(-1)))
      const expected = segments.map((_, index) => index + 1)
      if (segments.join(',') !== expected.join(','))
        problems.push(`${item.code} 的孩子不是 1..n：${segments}`)
    }
    if (item.type === 'enum') {
      if (!Array.isArray(item.values) || item.values.length === 0) problems.push(`${item.code} values 为空`)
      else if (new Set(item.values).size !== item.values.length) problems.push(`${item.code} values 有重复`)
      if (!item.values.includes(item.initial)) problems.push(`${item.code} initial 不在 values 里`)
    }
    if (item.type === 'integer') {
      if (!Number.isInteger(item.initial)) problems.push(`${item.code} 初始值不是整数`)
      if (!(item.min <= item.initial && item.initial <= item.max)) problems.push(`${item.code} 初始值越界`)
    }
    if (item.type === 'time') {
      const keys = Object.keys(item.initial).sort().join(',')
      if (keys !== 'day,hour,minute,month,second,year') problems.push(`${item.code} 时间值字段不是六格`)
      if (!UNITS.includes(item.granularityUpper) || !UNITS.includes(item.granularityLower))
        problems.push(`${item.code} 颗粒度缺失`)
      if (UNITS.indexOf(item.granularityUpper) > UNITS.indexOf(item.granularityLower))
        problems.push(`${item.code} 颗粒度顺序反了`)
    }
  }
  // 父子存在：任何 `a.b` 的父 `a` 必须在表里
  for (const code of codes) {
    const at = code.lastIndexOf('.')
    if (at > 0 && !codes.includes(code.slice(0, at))) problems.push(`${code} 的父 code 不存在`)
  }
  // 链的引用都能解析（reads 指向元素或提示词；writable 只指向元素）
  const promptIds = card.prompts.map((prompt) => prompt.id)
  for (const item of card.chain) {
    for (const ref of item.reads) {
      if (!codes.includes(ref) && !promptIds.includes(ref)) problems.push(`${item.id} 读了不存在的 ${ref}`)
    }
    for (const ref of item.writable) {
      if (!codes.includes(ref)) problems.push(`${item.id} 写了不存在的 ${ref}`)
    }
  }
  return problems
}

describe('v5 夹具自检：正控', () => {
  it('stateV5 / deepCard 结构合法（编号、父子、深度、类型字段、object 无自身值）', () => {
    expect(violationsOf(v5Card())).toEqual([])
    expect(violationsOf(deepCard())).toEqual([])
  })

  it('五种类型都出场，且 `1.1` 是「enum 自身值 + text 孩子」那个形状', () => {
    const state = stateV5()
    expect(new Set(state.map((item) => item.type))).toEqual(new Set(TYPES))
    expect(elementOf(v5Card(), '1.1')).toMatchObject({ type: 'enum', initial: 'A1' })
    expect(elementOf(v5Card(), '1.1.1')).toMatchObject({ type: 'text', initial: 'SITE_X' })
  })

  it('深度 5 合法、深度 6 非法（上界就在这一格）', () => {
    expect(Math.max(...deepCard().state.map((item) => depthOf(item.code)))).toBe(5)
    expect(Math.max(...tooDeepCard().state.map((item) => depthOf(item.code)))).toBe(6)
    expect(violationsOf(deepCard())).toEqual([])
    expect(violationsOf(tooDeepCard())).toContain('1.1.1.1.1.1 深度 6 > 5')
  })

  it('扁平树值：有孩子的节点用 .0、object 没有键、叶子用自身 code', () => {
    const tree = treeV5()
    expect(tree['1.1.0']).toBe('A1')
    expect(tree['1.1.1']).toBe('SITE_X')
    expect(tree['1.2']).toBe('MOOD_Y')
    expect(Object.keys(tree).filter((key) => ['1', '2', '2.4'].includes(key))).toEqual([])
    for (const prompt of v5Card().prompts) expect(typeof prompt.id).toBe('string')
    expect(chainV5().filter((item) => item.type === 'output')).toHaveLength(1)
  })
})
