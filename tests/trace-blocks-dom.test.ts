// @vitest-environment jsdom
/**
 * 票 53 契约（二）：那两行在界面上真的长成块清单（DOM 契约，不测样式）。
 *
 * 判据来源：`.team/test/2026-09-17/contract-53.md` §4。这里全都用 `data-*` 钩子选元素
 * （文案随语言变），逐字的比较一律用 `.element.textContent`（`text()` 会 trim，不能用它）。
 *
 * ⚠️ 分块与行结构都不是测试自己编的：`nodeRequest()` / `requestBlocks()` / `replyBlocks()`
 *    全都走生产路径（装配器 + chat() + 假 fetch），测试只把它们放进一条 Row 里
 *    —— 组件断言的是真数据。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StoryPanel from '../src/components/StoryPanel.vue'
import * as prompts from '../src/agent/prompts'
import * as llm from '../src/agent/llm'
import { clearConfig } from '../src/agent/config'
import { currentCard } from '../src/game/current-card'
import { createInitialState } from '../src/game/save'
import { fakeTracker, label, linesText, nodeRequest, replyFrom, setLocale } from './support/trace-blocks'
import type { BlockGroup } from '../src/agent/prompts'
import type { Row } from '../src/stores/game'

const track = fakeTracker()

afterEach(() => {
  track.restoreAll()
  clearConfig()
})

/** 界面上的调试行（Row 的 debug 那一支）—— 契约要它多带一个分块清单 */
type DebugRow = Extract<Row, { debug: true }>

/** 一条调试行：detail 是那一行原样显示的接口文本，blocks 是分块清单（没有就是旧数据） */
function traceRow(over: Partial<DebugRow> = {}): DebugRow {
  return { id: 1, kind: 'request', text: 'trace line', debug: true, ...over }
}

/** 一条真请求做出来的行：消息与原始文本都来自装配器与 chat()（假 fetch 接住） */
async function requestRow(): Promise<{
  row: DebugRow
  groups: BlockGroup[]
  roles: string[]
}> {
  const { sent, detail } = await nodeRequest(track, currentCard, currentCard.graph.topology[0])
  const groups = prompts.requestBlocks(sent)
  return {
    row: traceRow({ detail: detail, blocks: groups }),
    groups,
    roles: sent.map((m) => m.role),
  }
}

function mountRows(rows: Row[]) {
  return mount(StoryPanel, { props: { rows, status: null } })
}

/** 标题条上的字（块名 + 字数），按文档顺序取 */
function barsOf(rows: ReturnType<typeof mountRows>) {
  return rows.findAll('[data-block-title]').map((el) => el.element.textContent as string)
}

/** 各组标签的文本（按文档顺序）—— 标签是**数据**，所以这里比的就是数据里那份（契约 §4） */
function titleTexts(rows: ReturnType<typeof mountRows>) {
  return rows.findAll('[data-message-title]').map((el) => el.element.textContent as string)
}

describe('the request line: one group per message', () => {
  it('renders every message as its own group', async () => {
    const { row, groups, roles } = await requestRow()
    const w = mountRows([row])

    expect(w.find('[data-blocks]').exists(), 'a request line with blocks has the list').toBe(true)
    const messageGroups = w.findAll('[data-message]')
    expect(messageGroups).toHaveLength(roles.length)
    expect(messageGroups.map((el) => el.attributes('data-role'))).toEqual(roles)
    expect(titleTexts(w), 'and each group is labelled with the title it came with').toEqual(
      groups.map((group) => group.title),
    )
  })

  it('draws every line of every block: body lines, blank lines and sub-headings', async () => {
    const { row, groups } = await requestRow()
    const w = mountRows([row])

    const blocks = groups.flatMap((group) => group.blocks)
    const drawn = w.findAll('[data-block]')
    expect(drawn).toHaveLength(blocks.length)
    for (const [index, block] of blocks.entries()) {
      const lines = drawn[index].findAll('[data-block-line]')
      expect(lines, 'block ' + index + ' draws every line of its body').toHaveLength(block.lines.length)
      for (const [at, line] of block.lines.entries()) {
        expect(lines[at].element.textContent, 'block ' + index + ' line ' + at).toBe(line.text)
        expect(
          lines[at].attributes('data-block-subhead') !== undefined,
          'block ' + index + ' line ' + at + ' must be marked as a sub-heading',
        ).toBe(line.kind === 'subhead')
      }
    }

    // 上面那些断言别在空数据上通过
    const all = blocks.flatMap((block) => block.lines)
    expect(all.length, 'the fixture must be a real multi-line prompt').toBeGreaterThan(20)
    expect(
      all.some((line) => line.kind === 'subhead'),
      'and it must have sub-headings to mark',
    ).toBe(true)
    expect(
      all.some((line) => line.kind === 'text' && line.text === ''),
      'a blank line lives on as its own line element',
    ).toBe(true)
  })

  it('names each block and says how big it is', async () => {
    const { row, groups } = await requestRow()
    const w = mountRows([row])

    const blocks = groups.flatMap((group) => group.blocks)
    const bars = barsOf(w)
    expect(bars).toHaveLength(blocks.length)
    for (const [index, block] of blocks.entries()) {
      expect(bars[index], 'block ' + index + ' is named').toContain(block.title)
      expect(bars[index], 'block ' + index + ' says how big it is').toContain(
        label('debug.blockSize', { count: linesText(block).length }),
      )
    }
  })

  // ⚠️ 期望改过一次（2026-09-17 用户拍板，票 55）：**所有块都默认折叠**。
  //    守的性质没变（进来时的默认开合状态），只是更强了 —— 逐块断言，不只数几个开着：
  //    「只把第一块改成折叠、别的又漏出来」这种改法也要拦得住。
  it('comes in with every block folded', async () => {
    const { row, groups } = await requestRow()
    const w = mountRows([row])

    const all = groups.flatMap((group) => group.blocks)
    expect(all.length, 'the fixture must have more than one block to fold').toBeGreaterThan(1)
    const blocks = w.findAll('[data-block]')
    expect(blocks).toHaveLength(all.length)
    for (const [index, el] of blocks.entries()) {
      expect(
        el.attributes('open'),
        'block ' + index + ' must not be open when the line comes in',
      ).toBeUndefined()
    }
    expect(
      blocks.filter((el) => el.attributes('open') !== undefined),
      'not a single block is open',
    ).toHaveLength(0)
  })

  it('keeps the raw payload one fold away', async () => {
    const { row } = await requestRow()
    const w = mountRows([row])

    expect(w.find('[data-raw]').exists()).toBe(true)
    expect(w.find('[data-raw-body]').element.textContent, 'the payload, verbatim').toBe(row.detail)
  })
})

describe('the reply line', () => {
  const SAID = 'I will move the clock'
  const TOOL_ARGUMENTS = '{"minutes":7}'
  const RESPONSE = {
    usage: { total_tokens: 33 },
    choices: [
      {
        finish_reason: 'tool_calls',
        message: {
          content: SAID,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'advance_time', arguments: TOOL_ARGUMENTS },
            },
          ],
        },
      },
    ],
  }

  it('draws what it said and what it asked for, arguments verbatim', async () => {
    const reply = await replyFrom(track, RESPONSE)
    const groups = llm.replyBlocks(reply)
    const row = traceRow({
      kind: 'model',
      text: label('store.rawReply'),
      detail: JSON.stringify(reply.raw, null, 2),
      blocks: groups,
    })
    const w = mountRows([row])

    expect(w.findAll('[data-message]'), 'a reply is one step, not several messages').toHaveLength(1)
    expect(w.findAll('[data-message]')[0].attributes('data-role')).toBe('assistant')

    const blocks = groups.flatMap((group) => group.blocks)
    const drawn = w.findAll('[data-block]')
    expect(drawn).toHaveLength(blocks.length)
    for (const [index, block] of blocks.entries()) {
      expect(barsOf(w)[index]).toContain(block.title)
      // 逐行比：小标题行在界面上画的是不带 `### ` 的标题，所以不能拿拼回来的整段比
      expect(
        drawn[index].findAll('[data-block-line]').map((el) => el.element.textContent),
        'block ' + index + ' keeps its own bytes',
      ).toEqual(block.lines.map((line) => line.text))
    }
    // 工具参数是协议原样的 JSON：界面上逐字看得到
    expect(linesText(blocks[1])).toBe(TOOL_ARGUMENTS)
  })
})

describe('old payloads and languages', () => {
  const CUT_OFF = '{"messages": [{"role": "system", "content": "cut off here'

  it('shows a payload it cannot split as plain text, and stays up', () => {
    // 老存档里的 detail 是外部数据：认不出就按原始文本显示（挂载本身就会炸，所以这里不 try）
    const w = mountRows([traceRow({ detail: CUT_OFF })])
    expect(w.element.textContent, 'the payload is still readable').toContain(CUT_OFF)
    expect(w.element.textContent, 'and it stays text, not markup').not.toContain('<img')
  })

  it('writes every label in the language the interface is in', async () => {
    const zh = await requestRow()
    const zhPanel = mountRows([zh.row])
    const zhTitles = titleTexts(zhPanel)
    expect(zhTitles[0]).toBe(label('debug.role.system'))

    // ⚠️ 换语言要**重新装配这一行**：组标签是**数据**（契约 §2），界面不按角色现场 t() ——
    //    同一份数据在两种语言下必然同字，拿它去断「两套不一样」是自相矛盾的期望
    setLocale('en')
    const en = await requestRow()
    const enBlocks = en.groups.flatMap((group) => group.blocks)
    const enPanel = mountRows([en.row])
    const enTitles = titleTexts(enPanel)

    expect(en.groups[0].title, 'the English fixture really carries the English label').toBe(
      label('debug.role.system'),
    )
    expect(enTitles[0], 'the panel draws the label that came with the data').toBe(en.groups[0].title)
    expect(enBlocks[0].title, 'and so do the block names').toBe(label('prompts.setting'))
    expect(barsOf(enPanel)[0], 'the bar shows the block name it was given').toContain(enBlocks[0].title)
    expect(barsOf(enPanel)[0], 'the size label follows the language too').toContain(
      label('debug.blockSize', { count: linesText(enBlocks[0]).length }),
    )
    expect(enTitles, 'two languages = two assemblies, so the labels do differ').not.toEqual(zhTitles)
  })
})

describe('the blocks travel with the save', () => {
  it('is still there after a save round trip', async () => {
    const { row, groups } = await requestRow()
    const data = createInitialState(currentCard)
    data.events = [
      {
        kind: 'request',
        text: label('store.rawRequest', { count: 2 }),
        detail: row.detail as string,
        blocks: groups,
        at: '',
      },
    ]
    localStorage.clear()
    localStorage.setItem('tavernGame.save', JSON.stringify(data))

    // 换一份模块图 = 从存档里重新读一局（投影与 store 都是模块级状态）
    vi.resetModules()
    const [i18nModule, store] = await Promise.all([import('../src/i18n'), import('../src/stores/game')])
    ;(i18nModule.i18n.global.locale as unknown as { value: string }).value = 'zh-CN'
    const game = store.useGame()
    game.debugMode.value = true

    // ⚠️ 谓词要写成**类型守卫**：Row 是判别联合，普通谓词不会窄化返回值，
    //    写 `entry.debug && …` 拿到的仍是 `Row | undefined`，`.blocks` 在类型上就不存在
    const saved = game.rows.value.find((entry): entry is DebugRow => entry.debug && entry.kind === 'request')
    expect(saved, 'the request line comes back from the save').toBeDefined()
    expect(saved?.blocks?.length ?? 0, 'and it still carries its blocks').toBeGreaterThan(0)
    expect(
      mountRows(game.rows.value).findAll('[data-block-line]').length,
      'so the panel can draw every line of them',
    ).toBeGreaterThan(10)
  })
})
