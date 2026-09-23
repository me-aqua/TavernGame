/**
 * 票 53 契约（一）：模型输入 / 模型原始回复的**分块**（纯逻辑，不带 DOM）。
 *
 * 判据来源：`.team/test/2026-09-17/contract-53.md`。这一份盯三件事：
 *   1. 块的边界 = 装配器自己写出来的 `## ` 段、块内的行结构 = 它写出来的 `### ` 小标题
 *      （界面不许按文本特征切）；
 *   2. **把块拼回来必须与发出去的那条消息逐字节相等** —— 「只声明一次」的机器证明；
 *   3. 回复那侧：模型说的话 / 它申请的每个工具调用（工具名 + 参数原文）/ 其它。
 *
 * ⚠️ 功能还没做时 `requestBlocks` / `replyBlocks` 还不存在：`vue-tsc` 会红在「没有这个导出」上
 *    （那是契约的第一句），而 vitest 的失败**落在每条用例里** —— 这里用 `import * as` 取模块，
 *    所以整份文件不会在收集阶段就炸掉（那种红一条用例也跑不到）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as prompts from '../src/agent/prompts'
import * as llm from '../src/agent/llm'
import { clearConfig, saveConfig } from '../src/agent/config'
import { runCardGraph } from '../src/agent/card-graph'
import { currentCard } from '../src/game/current-card'
import { createInitialState } from '../src/game/save'
import { loadCard, NIGHT_WATCH_CARD } from './support/card-fixtures'
import {
  EARLIER_STORY,
  PLAYER_WORDS,
  TEST_PROVIDER,
  UPSTREAM_OUTPUT,
  blockNamed,
  fakeTracker,
  label,
  linesText,
  nodeRequest,
  reassemble,
  replyFrom,
  sentMessages,
  setLocale,
  subheads,
} from './support/trace-blocks'
import type { BlockGroup, PromptBlock } from '../src/agent/prompts'
import type { ChatMessage } from '../src/types/state'

const track = fakeTracker()

afterEach(() => {
  track.restoreAll()
  clearConfig()
})

// ---------- 夹具：卡里的节点按「声明了什么」挑，不写死节点名 ----------

const card = currentCard
const nodes = card.graph.nodes
/** 声明了「读哪几块设定」的节点（不是全部）：设定那一段要按卡声明筛 */
const DECLARING = card.graph.topology.find((id) => nodes[id].settings !== undefined) as string
/**
 * 读得到**全部五块**设定的那一步：写正文的那一个（卡的结构校验保证恰好一个节点写 `role`）。
 *
 * ⚠️ 票 76 之前它靠「不写 `settings`」读全五块，之后靠**显式声明满五块** —— 这一条两版都成立。
 *    这里不许去挑「没写这个键」的节点：那正是票 76 要消灭的那一档（三张卡补齐之后挑不出来）。
 */
const EVERY_BLOCK = card.graph.topology.find((id) => nodes[id].role !== undefined) as string

const REDO_HINT = 'the judge found a problem and asked to run the outline again'
const TOOL_SAID = 'calling the clock now'
const TOOL_ARGUMENTS = '{"minutes":7}'

/** 一段卡内容里最长的一行 —— 拿它当「这块内容有没有跟着发出去」的样本 */
function longestLine(lines: string[]): string {
  return lines.slice().sort((a, b) => b.length - a.length)[0]
}

/** 按块名取那一块的原文（拼法用测试自己的那一份，不用实现里的 blockText） */
function sectionText(groups: BlockGroup[], title: string): string {
  return linesText(blockNamed(groups, title))
}

describe('requestBlocks - one group per message, one block per prompt section', () => {
  it('splits what went on the wire into the sections the assembler wrote', async () => {
    const { sent } = await nodeRequest(track, card, EVERY_BLOCK)
    const groups = prompts.requestBlocks(sent)

    expect(groups.map((group) => group.role)).toEqual(sent.map((message) => message.role))
    expect(groups.map((group) => group.title)).toEqual([label('debug.role.system'), label('debug.role.user')])
    expect(groups[0].blocks.map((block) => block.title)).toEqual([
      label('prompts.setting'),
      label('prompts.script'),
      label('prompts.convention'),
    ])
    expect(groups[1].blocks.map((block) => block.title)).toEqual([
      label('prompts.now'),
      label('prompts.player'),
      label('prompts.upstream'),
      nodes[EVERY_BLOCK].name,
    ])
    expect(groups.flatMap((group) => group.blocks).map((block) => block.level)).toEqual([2, 2, 2, 2, 2, 2, 2])

    // 抽查四处正文：设定里的子块、玩家原话、上游产出、本节点提示词
    expect(sectionText(groups, label('prompts.setting'))).toContain(
      '### ' + label('prompts.settingBlock.world'),
    )
    expect(sectionText(groups, label('prompts.player')), 'the player words, verbatim').toBe(PLAYER_WORDS)
    expect(sectionText(groups, label('prompts.upstream'))).toContain(UPSTREAM_OUTPUT)
    expect(sectionText(groups, nodes[EVERY_BLOCK].name)).toContain(nodes[EVERY_BLOCK].prompt[0])
    for (const block of groups.flatMap((group) => group.blocks)) {
      expect(linesText(block).length, 'no empty block').toBeGreaterThan(0)
    }
  })

  it('hands out the line structure it wrote: `### ` lines become sub-headings', async () => {
    const { sent } = await nodeRequest(track, card, EVERY_BLOCK)
    const groups = prompts.requestBlocks(sent)

    // 设定块里的小标题 = 卡声明的那几块，顺序 = 卡里的顺序（决定 #52）
    expect(subheads(blockNamed(groups, label('prompts.setting')))).toEqual(
      Object.keys(card.settings).map((key) => label('prompts.settingBlock.' + key)),
    )
    // 「最近发生的事」「上游产出：X」也是 `### ` 行 —— 用户要一眼看出哪几段是哪一段
    const now = blockNamed(groups, label('prompts.now'))
    expect(subheads(now)).toEqual([label('prompts.recent')])
    // 那一行下面真的跟着这一局的历史（装配器**有条件**才写它，所以夹具里得真有故事事件）
    expect(linesText(now), 'the history line really travelled into that section').toContain(
      label('prompts.recentLine', { who: label('prompts.gm'), text: EARLIER_STORY }),
    )
    expect(subheads(blockNamed(groups, label('prompts.upstream')))).toEqual([
      label('prompts.upstreamNode', { node: 'OUTLINE' }),
    ])

    // 正文行不是小标题（否则「显著」等于把整块都变成标题）
    const player = blockNamed(groups, label('prompts.player'))
    expect(player.lines.map((line) => line.kind)).toEqual(['text'])
    expect(player.lines[0].text, 'a body line keeps its own bytes').toBe(PLAYER_WORDS)
  })

  it('hands the same block back as plain text (the panel sizes it with that)', async () => {
    const { sent } = await nodeRequest(track, card, EVERY_BLOCK)
    const [block] = prompts.requestBlocks(sent)[0].blocks

    // 证明只认测试自己的拼法（见共享夹具的 reassemble）；这里要求实现交出的那一份与它逐字一致 ——
    // 界面拿它算字数，就不必自己知道 `### ` 该补在哪儿
    expect(prompts.blockText(block), 'blockText must agree with the assembler').toBe(linesText(block))
  })

  it('follows the card declaration when it picks the setting sub-blocks', async () => {
    const declared = nodes[DECLARING].settings as string[]
    const entries = Object.entries(card.settings)
    expect(
      declared.length,
      'this card must declare less than it has, or the case proves nothing',
    ).toBeLessThan(entries.length)

    const scoped = prompts.requestBlocks((await nodeRequest(track, card, DECLARING)).sent)
    const scopedSetting = blockNamed(scoped, label('prompts.setting'))
    expect(subheads(scopedSetting)).toEqual(
      entries.filter(([key]) => declared.includes(key)).map(([key]) => label('prompts.settingBlock.' + key)),
    )
    for (const [key, lines] of entries.filter(([name]) => !declared.includes(name))) {
      expect(subheads(scopedSetting), key + ' is not declared by that node').not.toContain(
        label('prompts.settingBlock.' + key),
      )
      expect(linesText(scopedSetting), key + ' content must not travel either').not.toContain(
        longestLine(lines),
      )
    }

    // 反面控制：**读得到全部五块**的那一步，五块的小标题一个不少（少了它，"谁都没拿到"也能过上面那几行）
    const plain = prompts.requestBlocks((await nodeRequest(track, card, EVERY_BLOCK)).sent)
    expect(subheads(blockNamed(plain, label('prompts.setting')))).toEqual(
      entries.map(([key]) => label('prompts.settingBlock.' + key)),
    )
  })

  it('names the redo hint message and keeps its text verbatim', async () => {
    const { sent } = await nodeRequest(track, card, EVERY_BLOCK, { hint: REDO_HINT })
    expect(sent.map((message) => message.role)).toEqual(['system', 'system', 'user'])
    const groups = prompts.requestBlocks(sent)

    expect(groups[0].title).toBe(label('debug.role.system'))
    expect(groups[1].title, 'the second system message is the redo hint').toBe(label('debug.role.redoHint'))
    expect(groups[2].title).toBe(label('debug.role.user'))
    expect(groups[1].blocks.map((block) => block.level)).toEqual([0])
    expect(linesText(groups[1].blocks[0]), 'the hint text, verbatim').toBe(REDO_HINT)
    expect(groups[1].blocks[0].title, 'every block has a name').toBe(label('debug.role.redoHint'))
    for (const [index, message] of sent.entries()) {
      expect(reassemble(groups[index].blocks), 'message ' + index).toBe(message.content)
    }
  })

  it('keeps every message of a tool round trip in its own group', async () => {
    const toolCard = loadCard(NIGHT_WATCH_CARD)
    saveConfig(TEST_PROVIDER)
    const handle = track.install([
      { content: TOOL_SAID, toolCalls: [{ name: 'advance_time', arguments: TOOL_ARGUMENTS }] },
      'the time node wrote this line',
      'the story node wrote this line',
    ])
    await runCardGraph({
      card: toolCard,
      data: createInitialState(toolCard),
      memoryUpTo: 0,
      playerWords: PLAYER_WORDS,
    })

    const second = sentMessages(handle, 1)
    expect(
      second.map((message) => message.role),
      'a tool round trip really happened',
    ).toEqual(['system', 'user', 'assistant', 'tool'])
    const groups = prompts.requestBlocks(second)
    expect(groups.map((group) => group.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(groups.map((group) => group.title)).toEqual([
      label('debug.role.system'),
      label('debug.role.user'),
      label('debug.role.assistant'),
      label('debug.role.tool'),
    ])
    expect(
      groups.map((group) => group.title),
      'only the hint message is the hint',
    ).not.toContain(label('debug.role.redoHint'))
    expect(linesText(groups[2].blocks[0]), 'what the model said that step').toBe(TOOL_SAID)
    expect(linesText(groups[3].blocks[0]), 'the tool result, verbatim').toBe(second[3].content)
    for (const [index, message] of second.entries()) {
      expect(reassemble(groups[index].blocks), 'message ' + index).toBe(message.content)
    }
  })

  it('follows the interface language on both sides', async () => {
    const { sent: zhSent } = await nodeRequest(track, card, EVERY_BLOCK)
    const zhGroups = prompts.requestBlocks(zhSent)
    const zhGroupTitle = label('debug.role.system')
    const zhBlockTitle = zhGroups[0].blocks[0].title
    expect(zhBlockTitle).toBe(label('prompts.setting'))

    // 界面切到英文再装配一次：引擎写的那部分提示词也跟着换语言
    setLocale('en')
    const { sent: enSent } = await nodeRequest(track, card, EVERY_BLOCK)
    const enGroups = prompts.requestBlocks(enSent)
    expect(enGroups[0].title).toBe(label('debug.role.system'))
    expect(enGroups[0].title, 'the group label follows the interface language').not.toBe(zhGroupTitle)
    expect(enGroups[0].blocks[0].title).toBe(label('prompts.setting'))
    expect(enGroups[0].blocks[0].title, 'the section names follow it too').not.toBe(zhBlockTitle)
    expect(subheads(enGroups[0].blocks[0])[0], 'and so do the line headings').toBe(
      label('prompts.settingBlock.world'),
    )
    for (const [index, message] of enSent.entries()) {
      expect(reassemble(enGroups[index].blocks), 'message ' + index).toBe(message.content)
    }
  })
})

describe('the boundaries are declared once - the blocks add up to the sent text', () => {
  it('reassembles byte-for-byte into every message that was sent', async () => {
    const { sent } = await nodeRequest(track, card, EVERY_BLOCK)
    const groups = prompts.requestBlocks(sent)

    expect(groups.length, 'one group per message').toBe(sent.length)
    for (const [index, message] of sent.entries()) {
      expect(reassemble(groups[index].blocks), 'message ' + index + ' (' + message.role + ')').toBe(
        message.content,
      )
    }
    // 空证明的保险：拼的必须是一份真提示词（一两个空块也能「拼回来相等」）
    const blocks = groups.flatMap((group) => group.blocks)
    expect(blocks.length).toBeGreaterThan(4)
    expect(Math.max(...blocks.map((block) => linesText(block).length))).toBeGreaterThan(1000)
    expect(
      blocks.flatMap((block) => block.lines).length,
      'and it must really be a multi-line prompt',
    ).toBeGreaterThan(50)
  })

  it('keeps every byte when the text itself looks like a heading', () => {
    const tricky = [
      '## Alpha',
      'line one',
      '',
      'line three',
      '',
      '## a line the model wrote',
      'still inside the same message',
      '',
      '### inner heading',
      'plain line',
    ].join('\n')

    const blocks: PromptBlock[] = prompts
      .requestBlocks([{ role: 'user', content: tricky }])
      .flatMap((group) => group.blocks)
    expect(reassemble(blocks), 'the split may be finer, the bytes may not be lost').toBe(tricky)
    expect(blocks[0].title).toBe('Alpha')
    expect(linesText(blocks[0]), 'blank lines inside a body stay put').toContain('line one\n\nline three')
    // `### ` 行按小标题交出（模型写的 markdown 也一样），而原文一个字不丢
    expect(blocks.some((block) => subheads(block).includes('inner heading'))).toBe(true)
  })
})

describe('a heading with no body under it - the shape family S3 found red', () => {
  // 这一族形状都是**消息正文自己**长出来的 `## ` 行：卡里的行、玩家原话、上游产出都是逐字进段的，
  // 所以分块必须把它们原样吞下去。一旦把「标题底下没有正文」也当成段边界，拼回来就会多一个换行，
  // 界面上还会多出一个**有标题、0 字**的块 —— 用户看到那行只会以为那块内容丢了。
  //
  // ⚠️ 这里钉的是「**不产生**这样的块」（数据层），不是「产生了但界面不画」：契约 §4 里界面只负责
  //    把 `blocks` 一层层画出来，多一条"看着是空就跳过"的规则会让界面与数据对不上号；而且 0 字的块
  //    本身就意味着那段字节没有任何块携带 ⇒ 拼回来必然对不上（两条断言是同一件事的两面）。
  const SHAPES = [
    ['the whole message is one heading line', '## tail'],
    ['the heading is the last line of the message', 'kept line\n\n## tail'],
    ['the heading is the last line, with its newline', 'kept line\n\n## tail\n'],
    ['only a blank line follows the heading', 'kept line\n\n## tail\n\n'],
    ['two heading lines with no body in between', 'kept line\n\n## alpha\n\n## beta\nkept after'],
  ] as const

  /** 拼回来必须与每一条发出去的消息逐字节相等（契约 §6 第一行：划分可以更细，字节不许丢） */
  function expectBytesKept(groups: BlockGroup[], messages: ChatMessage[], why: string): void {
    expect(groups.length, why + ': one group per message').toBe(messages.length)
    for (const [index, message] of messages.entries()) {
      expect(reassemble(groups[index].blocks), why + ': message ' + index + ' (' + message.role + ')').toBe(
        message.content,
      )
    }
  }

  /** 不许交出 0 字的块（见上面那段：钉的是"不产生"）；失败信息点名那几个块的标题 */
  function expectNoGhostBlock(groups: BlockGroup[], why: string): void {
    const titles = groups
      .flatMap((group) => group.blocks)
      .filter((block) => linesText(block) === '')
      .map((block) => block.title)
    expect(titles, why + ': a block with a title and 0 chars').toEqual([])
  }

  it('keeps every byte when the heading has no body under it', () => {
    for (const [why, content] of SHAPES) {
      const messages: ChatMessage[] = [{ role: 'user', content }]
      expectBytesKept(prompts.requestBlocks(messages), messages, why)
    }
  })

  it('invents no 0-char block when the heading has no body under it', () => {
    for (const [why, content] of SHAPES) {
      expectNoGhostBlock(prompts.requestBlocks([{ role: 'user', content }]), why)
    }
  })

  it('keeps its promise on a real request whose player words end with a heading', async () => {
    const { sent } = await nodeRequest(track, card, EVERY_BLOCK, {
      playerWords: PLAYER_WORDS + '\n\n## note',
    })
    // 没有这一句，夹具一改就会变成一条什么都没测到的空用例
    expect(sent[1].content, 'the shape must really have travelled into the user message').toContain(
      '\n\n## note',
    )
    const groups = prompts.requestBlocks(sent)
    expectBytesKept(groups, sent, 'player words')
    expectNoGhostBlock(groups, 'player words')
  })

  it('keeps its promise on a real request whose upstream output ends with a heading', async () => {
    const { sent } = await nodeRequest(track, card, EVERY_BLOCK, {
      upstream: [{ node: 'OUTLINE', output: UPSTREAM_OUTPUT + '\n\n## tail' }],
    })
    expect(sent[1].content, 'the shape must really have travelled into the user message').toContain(
      '\n\n## tail',
    )
    const groups = prompts.requestBlocks(sent)
    expectBytesKept(groups, sent, 'upstream output')
    expectNoGhostBlock(groups, 'upstream output')
  })
})

describe('replyBlocks - what it said, what it asked for, and the rest', () => {
  const SAID = 'I will move the clock'
  const FULL_RESPONSE = {
    id: 'chatcmpl-test',
    model: 'test-model',
    usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33 },
    choices: [
      {
        index: 0,
        finish_reason: 'tool_calls',
        message: {
          content: SAID,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'advance_time', arguments: TOOL_ARGUMENTS } },
          ],
        },
      },
    ],
  }

  it('splits a reply into its words, each tool call, and the rest', async () => {
    const reply = await replyFrom(track, FULL_RESPONSE)
    const groups = llm.replyBlocks(reply)

    expect(groups).toHaveLength(1)
    expect(groups[0].role, 'a reply is the assistant step').toBe('assistant')
    expect(groups[0].title).toBe(label('debug.role.assistant'))

    const blocks = groups[0].blocks
    expect(blocks.map((block) => block.title)).toEqual([
      label('debug.block.reply'),
      'advance_time',
      label('debug.block.other'),
    ])
    expect(blocks.map((block) => block.level)).toEqual([0, 0, 0])
    expect(linesText(blocks[0]), 'what the model said, verbatim').toBe(SAID)
    expect(linesText(blocks[1]), 'the arguments, verbatim (protocol JSON)').toBe(TOOL_ARGUMENTS)

    const rest = linesText(blocks[2])
    expect(rest, 'the finish reason is in the rest').toContain('finish_reason')
    expect(rest, 'the usage is in the rest').toContain('total_tokens')
    expect(rest).toContain('33')
    expect(rest, 'what the blocks above already show is not repeated').not.toContain(SAID)
    expect(rest).not.toContain(TOOL_ARGUMENTS)
    expect(rest).not.toContain('advance_time')
    for (const block of blocks) expect(linesText(block).length, 'no empty block').toBeGreaterThan(0)
  })

  it('has no tool block when the model asked for no tools', async () => {
    const reply = await replyFrom(track, { choices: [{ message: { content: SAID } }] })
    const blocks = llm.replyBlocks(reply)[0].blocks

    expect(blocks.map((block) => block.title)).toEqual([label('debug.block.reply')])
    expect(linesText(blocks[0])).toBe(SAID)
    expect(
      blocks.every((block) => linesText(block) !== ''),
      'no empty block either',
    ).toBe(true)
  })

  it('has no words block when the model only called tools', async () => {
    const reply = await replyFrom(track, {
      choices: [
        {
          message: {
            content: '',
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
    })
    const blocks = llm.replyBlocks(reply)[0].blocks

    expect(blocks.map((block) => block.title)).toEqual(['advance_time'])
    expect(linesText(blocks[0])).toBe(TOOL_ARGUMENTS)
  })
})
