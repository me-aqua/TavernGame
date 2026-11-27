/**
 * 夹具自检（**今天就该绿**）—— 正控。
 *
 * 这一份不 import 任何产品代码：它只量「2.2 夹具本身是不是一份合法数据」。
 * 为什么需要它：别的判据红了的时候，要能一眼分清「功能没做 / 改了」还是「夹具有病」。
 *
 * 量的是契约里**不需要实现就能判**的那几条：编号铁律、父子存在、深度 ≤ 5、五种类型各自的字段、
 * `initial` 只挂根元素、根 initial 覆盖自己整棵子树、`object` 没有自身值、链的引用都能解析。
 */
import { describe, expect, it } from 'vitest'
import {
  chainV5,
  deepCard,
  elementOf,
  stateV5,
  TIME_VALUE,
  tooDeepCard,
  treeV5,
  v5Card,
} from './support/state-fixtures.js'

const TYPES = ['time', 'text', 'integer', 'enum', 'object']
const UNITS_OF_MODE = {
  'year-minute': ['year', 'month', 'week', 'day', 'hour', 'minute'],
  'year-date': ['year', 'month', 'week', 'day'],
  'days-minute': ['day', 'hour', 'minute'],
}
const CODE = /^\d+(\.\d+)*$/

/** 可见深度：`.0` 不计 */
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

/** 一个 code 覆盖的值路径（与契约 §2.1 同一个口径；这里只是夹具自检的一份独立实现） */
function pathsOf(state, code) {
  const kids = childrenOf(state, code)
  const self = state.find((item) => item.code === code)
  const paths = []
  if (kids.length === 0) {
    if (self && self.type !== 'object') paths.push(code)
    return paths
  }
  if (self && self.type !== 'object') paths.push(`${code}.0`)
  for (const kid of kids) paths.push(...pathsOf(state, kid))
  return paths
}

/** 根元素的 initial 表（时间根包一层 `{ 0: 值 }`，让「每条值路径都有一条」的口径统一） */
function initialTableOf(state, root) {
  return root.type === 'time' ? { [root.code]: root.initial } : (root.initial ?? {})
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
    const isRoot = !item.code.includes('.')
    // initial 只挂根元素；子元素带 initial 就是坏数据
    if (isRoot) {
      if (!('initial' in item)) problems.push(`${item.code} 是根却没有 initial`)
    } else if ('initial' in item) {
      problems.push(`${item.code} 是子元素却带 initial`)
    }
    if (item.type === 'object') {
      if (kids.length === 0) problems.push(`${item.code} 是 object 却没孩子`)
      // object 没有自身值：根 initial 里不许出现它自己的 code / 它的 .0
      if (isRoot && item.initial) {
        if (item.code in item.initial) problems.push(`${item.code} 是 object 却在 initial 里有自己的 code`)
        if (`${item.code}.0` in item.initial) problems.push(`${item.code} 是 object 却在 initial 里有 .0`)
      }
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
    }
    if (item.type === 'time') {
      const mode = item.timeMode
      const units = UNITS_OF_MODE[mode]
      if (!units) {
        problems.push(`${item.code} timeMode 不认识：${mode}`)
      } else {
        const keys = Object.keys(item.initial ?? {})
          .sort()
          .join(',')
        const expected =
          mode === 'year-minute'
            ? 'day,hour,minute,month,year'
            : mode === 'year-date'
              ? 'day,month,year'
              : 'day,hour,minute'
        if (keys !== expected) problems.push(`${item.code} 时间值字段不是 ${mode} 的格子：${keys}`)
        if (!units.includes(item.granularityUpper) || !units.includes(item.granularityLower))
          problems.push(`${item.code} 颗粒度不在本模式的单位表里`)
        if (units.indexOf(item.granularityUpper) > units.indexOf(item.granularityLower))
          problems.push(`${item.code} 颗粒度顺序反了`)
      }
    }
  }
  // 根 initial 必须恰好覆盖自己整棵子树的值路径（不缺、不多）
  for (const root of card.state.filter((item) => !item.code.includes('.'))) {
    const table = initialTableOf(card.state, root)
    const expected = pathsOf(card.state, root.code)
    for (const path of expected) {
      if (!(path in table)) problems.push(`${root.code} 的 initial 缺 ${path}`)
    }
    for (const path of Object.keys(table)) {
      if (!expected.includes(path)) problems.push(`${root.code} 的 initial 多出 ${path}`)
    }
  }
  // 类型值本身合法（enum 白名单 / integer 整数）
  for (const root of card.state.filter((item) => !item.code.includes('.'))) {
    const table = initialTableOf(card.state, root)
    for (const item of card.state) {
      if (item.type === 'object' || item.type === 'time') continue
      const [ownPath] = pathsOf(card.state, item.code)
      const value = table[ownPath]
      if (value === undefined) continue
      if (item.type === 'enum' && !item.values.includes(value))
        problems.push(`${item.code} 的值不在 values 里`)
      if (item.type === 'integer' && !Number.isInteger(value)) problems.push(`${item.code} 的值不是整数`)
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

describe('夹具自检：正控', () => {
  it('stateV5 / deepCard 结构合法（编号、父子、深度、类型字段、initial 只在根上）', () => {
    expect(violationsOf(v5Card())).toEqual([])
    expect(violationsOf(deepCard())).toEqual([])
  })

  it('五种类型都出场，且 `1.1` 是「enum 自身值 + text 孩子」那个形状', () => {
    const state = stateV5()
    expect(new Set(state.map((item) => item.type))).toEqual(new Set(TYPES))
    expect(elementOf(v5Card(), '1.1')).toMatchObject({ type: 'enum', values: ['A1', 'A2'] })
    expect(elementOf(v5Card(), '1.1')).not.toHaveProperty('initial')
    expect(elementOf(v5Card(), '1').initial).toMatchObject({ '1.1.0': 'A1', '1.1.1': 'SITE_X' })
  })

  it('深度 5 合法、深度 6 非法（上界就在这一格）', () => {
    expect(Math.max(...deepCard().state.map((item) => depthOf(item.code)))).toBe(5)
    expect(Math.max(...tooDeepCard().state.map((item) => depthOf(item.code)))).toBe(6)
    expect(violationsOf(deepCard())).toEqual([])
    expect(violationsOf(tooDeepCard())).toContain('1.1.1.1.1.1 深度 6 > 5')
  })

  it('扁平树值：有孩子的节点用 .0、object 没有键、叶子用自身 code；时间根是 5 格', () => {
    const tree = treeV5()
    expect(tree['1.1.0']).toBe('A1')
    expect(tree['1.1.1']).toBe('SITE_X')
    expect(tree['1.2']).toBe('MOOD_Y')
    expect(Object.keys(tree).filter((key) => ['1', '2', '2.4'].includes(key))).toEqual([])
    expect(tree['0']).toEqual({ ...TIME_VALUE })
    expect(Object.keys(tree['0']).sort()).toEqual(['day', 'hour', 'minute', 'month', 'year'])
    for (const prompt of v5Card().prompts) expect(typeof prompt.id).toBe('string')
    expect(chainV5().filter((item) => item.type === 'output')).toHaveLength(1)
  })
})
