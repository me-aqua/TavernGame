/**
 * tools/render-card.mjs —— 把一张卡渲染成人看的 markdown。
 *
 * 只认**结构**，不认任何一张卡的内容：标题层级、表头、分隔线、列表、按行输出的
 * 提示词块，全部由 JSON 的形状决定；出现的数字（几块 / 几项 / 几行）一律现数。
 * 唯一认识的字段是卡格式自己的两个元信息键（卡的「名称」与「版本」）—— 标题要用。
 *
 * 用法：node tools/render-card.mjs [卡.json] [输出.md]
 * 默认渲染示例卡 cards/morningwind.json，输出到它旁边的《卡名》.md。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const NEWLINE = String.fromCharCode(10)

/** 一段文本占几列（CJK / 全角算两列）—— 短列表挤一行时用它判断「够不够短」 */
const columns = (text) => [...text].reduce((n, c) => n + (c.codePointAt(0) >= 0x2e80 ? 2 : 1), 0)

/** 标量：不是数组也不是对象 */
const isScalar = (value) => value === null || typeof value !== 'object'

/** 对象（数组不算） */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 「键 → 标量」的对象 —— 排成「键 | 值」两列表 */
const isFlatRecord = (value) => isRecord(value) && Object.values(value).every(isScalar)

/** 「键 → 扁平对象」的对象 —— 排成第一列是键、后面是各子字段的表 */
const isKeyedTable = (value) =>
  isRecord(value) && Object.keys(value).length > 0 && Object.values(value).every(isFlatRecord)

/** 标量写成 markdown 里的样子（字符串原样，其余用 JSON 写法） */
const inline = (value) => (typeof value === 'string' ? value : JSON.stringify(value))

/** 一个值有几项；标量没有「项」 */
const size = (value) =>
  Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 0

/** 标题行，层级越深井号越多（markdown 最多六级） */
const heading = (level, text) => '#'.repeat(Math.min(level, 6)) + ' ' + text

/** 块之间保证一个空行 —— 表格与围栏代码块前面没空行时，markdown 会把它们并进上一段 */
function pushBlock(out, lines) {
  if (out.length > 0 && out[out.length - 1] !== '') out.push('')
  out.push(...lines)
}

/** 表头 + 分隔线 + 内容行 */
function table(headers, rows, out) {
  pushBlock(out, [
    '| ' + headers.join(' | ') + ' |',
    '| ' + headers.map(() => '---').join(' | ') + ' |',
    ...rows.map((row) => '| ' + row.join(' | ') + ' |'),
  ])
}

/** 表格里的一格：竖线转义成实体、换行折成空格，结构化不了的值留白 */
const cell = (value) =>
  (value === undefined || value === null || typeof value === 'object' ? '' : String(value))
    .replaceAll('|', '&#124;')
    .replaceAll(NEWLINE, ' ')

/** 短数组能挤进一行就挤（空数组写「空」）；挤不下返回 null，交给按形状渲染 */
function inlineList(list) {
  if (list.length === 0) return '空'
  if (!list.every(isScalar)) return null
  const parts = list.map((value) => inline(value))
  if (parts.some((part) => part.length === 0 || columns(part) > 12)) return null
  return parts.join(' · ')
}

/** 一段字符串数组按原样排成代码块 —— 提示词与设定块的换行是有意义的 */
function textBlock(lines, out) {
  pushBlock(out, ['```text', ...lines, '```'])
}

/** 数组项的小标题：取它自己的第一个字符串（名 / 标题），没有就写第几项 */
function itemTitle(item, index) {
  if (isRecord(item)) {
    const named = Object.values(item).find((value) => typeof value === 'string' && value.length > 0)
    if (named) return named
  }
  return '第 ' + (index + 1) + ' 项'
}

/** 渲染一个数组的内容（标签与项数由调用方打印） */
function renderArray(list, level, out) {
  if (list.every((value) => typeof value === 'string')) {
    textBlock(list, out)
    return
  }
  if (list.every(isScalar)) {
    pushBlock(
      out,
      list.map((value) => '- ' + inline(value)),
    )
    return
  }
  if (list.every(isFlatRecord)) {
    const headers = [...new Set(list.flatMap((item) => Object.keys(item)))]
    table(
      headers,
      list.map((item) => headers.map((key) => cell(item[key]))),
      out,
    )
    return
  }
  list.forEach((item, index) => {
    pushBlock(out, [
      heading(level + 1, itemTitle(item, index) + '（' + (index + 1) + '/' + list.length + '）'),
    ])
    renderObject(item, level + 1, out)
  })
}

/** 渲染「键 → 值」的表：第一列是键，后面是各子字段（子字段取并集，缺的留白） */
function renderKeyedTable(object, out) {
  const headers = [...new Set(Object.values(object).flatMap((item) => Object.keys(item)))]
  table(
    ['键', ...headers],
    Object.entries(object).map(([key, item]) => [key, ...headers.map((header) => cell(item[header]))]),
    out,
  )
}

/** 渲染一个键的值：标量写一行、短列表挤一行、其余按形状排块 */
function renderMember(key, value, level, out) {
  if (isScalar(value)) {
    out.push('**' + key + '**：' + inline(value))
    return
  }
  if (Array.isArray(value)) {
    const oneLine = inlineList(value)
    if (oneLine !== null) {
      out.push('**' + key + '**（' + value.length + ' 项）：' + oneLine)
      return
    }
    pushBlock(out, ['**' + key + '**（' + value.length + ' 项）'])
    renderArray(value, level, out)
    return
  }
  if (isFlatRecord(value)) {
    pushBlock(out, ['**' + key + '**（' + size(value) + ' 项）'])
    table(
      ['键', '值'],
      Object.entries(value).map(([field, item]) => [field, cell(item)]),
      out,
    )
    return
  }
  if (isKeyedTable(value)) {
    pushBlock(out, ['**' + key + '**（' + size(value) + ' 项）'])
    renderKeyedTable(value, out)
    return
  }
  pushBlock(out, [heading(level + 1, key + '（' + size(value) + ' 项）')])
  renderObject(value, level + 1, out)
}

/** 渲染一个对象：逐键渲染 */
function renderObject(object, level, out) {
  for (const [key, value] of Object.entries(object)) renderMember(key, value, level, out)
}

/** 渲染整张卡：顶层每个键一节，节间一条分隔线 */
function renderCard(card, source) {
  const meta = isRecord(card['卡']) ? card['卡'] : {}
  const name = typeof meta['名称'] === 'string' ? meta['名称'] : source
  const version = isScalar(meta['版本']) ? ' v' + meta['版本'] : ''
  const out = ['# 《' + name + '》' + version, '']
  out.push('> ⚠️ 本文件由 `' + source + '` 渲染生成，**不要手改**。')
  out.push('> 改卡请改 JSON，然后重跑：`node tools/render-card.mjs`')
  pushBlock(out, ['---'])
  let index = 0
  for (const [key, value] of Object.entries(card)) {
    index += 1
    pushBlock(out, ['## ' + index + '. ' + key + (isScalar(value) ? '' : '（' + size(value) + ' 项）')])
    if (isScalar(value)) out.push(inline(value))
    else if (Array.isArray(value)) {
      const oneLine = inlineList(value)
      if (oneLine !== null) out.push(oneLine)
      else if (value.every((item) => typeof item === 'string')) textBlock(value, out)
      else renderArray(value, 2, out)
    } else if (isFlatRecord(value)) {
      table(
        ['键', '值'],
        Object.entries(value).map(([field, item]) => [field, cell(item)]),
        out,
      )
    } else if (isKeyedTable(value)) renderKeyedTable(value, out)
    else renderObject(value, 2, out)
    pushBlock(out, ['---'])
  }
  return out.join(NEWLINE) + NEWLINE
}

const source = process.argv[2] ?? 'cards/morningwind.json'
const card = JSON.parse(readFileSync(source, 'utf8'))
const target = process.argv[3] ?? join(dirname(source), String((card['卡'] ?? {})['名称'] ?? 'card') + '.md')
writeFileSync(target, renderCard(card, source))
console.info('rendered ' + source + ' -> ' + target)
