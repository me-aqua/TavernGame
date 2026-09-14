/**
 * tools/render-card.mjs —— 把一张卡渲染成人看的 markdown。
 *
 * 只认**结构**，不认任何一张卡的内容：标题层级、表头、分隔线、列表、按行输出的
 * 提示词块，全部由 JSON 的形状决定；出现的数字（几块 / 几项 / 几行）一律现数。
 * 认识的字段只有卡格式自己的几处：标题用的「名称」与「版本」，以及「节点约定」后面
 * 那份逐节点的上游清单 —— 上游 = 拓扑前缀（决定 #26），从「声明.图.拓扑」现推。
 *
 * 用法：node tools/render-card.mjs [卡.json] [输出.md]
 * 默认渲染示例卡 cards/morningwind.json，输出到它旁边的《卡名》.md。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const NEWLINE = String.fromCharCode(10)

/** card/2 里认识的几处结构 —— 只有它们决定排版，别处一律按形状走 */
const KEY_DECL = '声明'
const KEY_GRAPH = '图'
const KEY_TOPOLOGY = '拓扑'
const KEY_CONVENTION = '节点约定'

/** 圈号 ⓪ 的码点；①–⑳ 的码点是连着的 */
const CIRCLED_ZERO = 0x24ea
const CIRCLED_ONE = 0x2460

/** 圈号最多到 ⑳ —— 再多的节点没有圈号可用，那一行就退回节点 id */
const CIRCLED_COUNT = 20

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

/** 第 index 个节点的圈号（⓪ = 拓扑[0]、① = 拓扑[1]…）；超出 ⑳ 退回节点 id */
function markOf(index, id) {
  if (index === 0) return String.fromCodePoint(CIRCLED_ZERO)
  if (index <= CIRCLED_COUNT) return String.fromCodePoint(CIRCLED_ONE + index - 1)
  return id
}

/** 按显示列数补全文本（补的是全角空格）—— 让逐节点上游那一列对齐 */
function pad(text, width) {
  const room = width - columns(text)
  return text + '\u3000'.repeat(Math.floor(room / 2)) + ' '.repeat(room % 2)
}

/** 拓扑推出来的逐节点上游：第一个只拿公共部分，其余拿「公共部分 + 排在它前面的全部节点」 */
function upstreamLines(topology) {
  const marks = topology.map((id, index) => markOf(index, id))
  const width = Math.max(...topology.map((id) => columns(id)))
  return topology.map((id, index) => {
    const head = '· ' + marks[index] + ' ' + pad(id, width) + ' '
    if (index === 0) return head + '只拿到公共部分（它是第一个）'
    return head + '公共部分 + ' + marks.slice(0, index).join('')
  })
}

/** 卡里的拓扑（声明.图.拓扑）；没有这个结构就推不出逐节点上游（渲染器也接受别的 JSON） */
function topologyOf(card) {
  const declared = card[KEY_DECL]
  const graph = isRecord(declared) ? declared[KEY_GRAPH] : undefined
  const topology = isRecord(graph) ? graph[KEY_TOPOLOGY] : undefined
  return Array.isArray(topology) ? topology : []
}

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

/** 节点约定后面补一份逐节点的上游清单 —— 上游由拓扑推，卡里不逐节点写 */
function renderUpstreams(topology, out) {
  if (topology.length === 0) return
  pushBlock(out, ['**每个节点的上游**（' + topology.length + ' 项）'])
  textBlock(upstreamLines(topology), out)
}

/** 渲染一个数组的内容（标签与项数由调用方打印） */
function renderArray(list, level, out, topology) {
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
    renderObject(item, level + 1, out, topology)
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

/** 渲染一个键的值；「节点约定」后面再补一份由拓扑推出来的逐节点上游 */
function renderMember(key, value, level, out, topology) {
  renderValue(key, value, level, out, topology)
  if (key === KEY_CONVENTION) renderUpstreams(topology, out)
}

/** 渲染一个值：标量写一行、短列表挤一行、其余按形状排块 */
function renderValue(key, value, level, out, topology) {
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
    renderArray(value, level, out, topology)
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
  renderObject(value, level + 1, out, topology)
}

/** 渲染一个对象：逐键渲染 */
function renderObject(object, level, out, topology) {
  for (const [key, value] of Object.entries(object)) renderMember(key, value, level, out, topology)
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
  const topology = topologyOf(card)
  let index = 0
  for (const [key, value] of Object.entries(card)) {
    index += 1
    pushBlock(out, ['## ' + index + '. ' + key + (isScalar(value) ? '' : '（' + size(value) + ' 项）')])
    if (isScalar(value)) out.push(inline(value))
    else if (Array.isArray(value)) {
      const oneLine = inlineList(value)
      if (oneLine !== null) out.push(oneLine)
      else if (value.every((item) => typeof item === 'string')) textBlock(value, out)
      else renderArray(value, 2, out, topology)
    } else if (isFlatRecord(value)) {
      table(
        ['键', '值'],
        Object.entries(value).map(([field, item]) => [field, cell(item)]),
        out,
      )
    } else if (isKeyedTable(value)) renderKeyedTable(value, out)
    else renderObject(value, 2, out, topology)
    pushBlock(out, ['---'])
  }
  return out.join(NEWLINE) + NEWLINE
}

const source = process.argv[2] ?? 'cards/morningwind.json'
const card = JSON.parse(readFileSync(source, 'utf8'))
const target = process.argv[3] ?? join(dirname(source), String((card['卡'] ?? {})['名称'] ?? 'card') + '.md')
writeFileSync(target, renderCard(card, source))
console.info('rendered ' + source + ' -> ' + target)
