// @vitest-environment jsdom
/**
 * 跨层那条链 —— **界面改的那段正文，真的走进了下一条请求**。
 *
 * 这一条原来住在 `tests/card-resource-request.test.ts`（票 56 那一族的两条引擎侧判据），
 * 那件随退休的资源库面板一起删了（票 8d-②，`47f4d91`）⇒ 判据搬到**新形态**上：
 * 入口从「第四栏那套勾选面板」换成「**第四栏点一条 → 中栏改正文 → 顶栏那颗保存**」。
 *
 * 判据不是「卡里那一段变了」—— 那只是中间站。这里走的是完整那条链：
 *   第四栏点一条 → 中栏改正文 → 保存（`importCard` 落盘）→ `parseCard` 读回来
 *   → `buildNodeMessages` 真装配 → `chat()` 拼请求体 → **假 fetch 记下来的那条请求**。
 *
 * ⚠️ 请求一侧的「在不在」用**卡正文里的标志行**（`markerOf`：那一块的第一条非空行）：
 *    卡的内容不随界面语言变，于是同一份断言在 zh-CN 与 en 下都成立。
 * ⚠️ 反面控制与判别**各自一条用例**：合成一条的话判别先红、反面控制根本跑不到，
 *    「它是不是本来就绿」从读数上看不出来。
 * ⚠️ 期望值全部从卡里现取；字符串一律 ASCII（`.githooks/checks/ascii.mjs` 连 `tests/` 一起拦）。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CardEditor from '../src/components/CardEditor.vue'
import { type CardData } from '../src/game/card'
import { i18n } from '../src/i18n'
import {
  CARD_KEY,
  EXAMPLE,
  declaredSettings,
  markerOf,
  savedCard,
  withoutSettings,
} from './support/card-resources'
import { save, type AnyWrapper } from './support/branch-tree'
import { fakeTracker, label, nodeRequest, setLocale } from './support/trace-blocks'

/** 卡里五块设定的键（顺序就是卡的声明顺序） */
const SETTING_KEYS = Object.keys(EXAMPLE.settings)

/** 这一票改的那一块（正文被换掉的那块）与它旁边那块（"别处一个字没动"拿它当对照） */
const FIRST_BLOCK = SETTING_KEYS[0]
const NEXT_BLOCK = SETTING_KEYS[1]

/**
 * 「**没写 `settings`**」的那一步 —— 本地夹具造出来的那一个（票 76 的语义：不写这个键 = 一块都不发）。
 *
 * ⚠️ 节点**写死**（不现找）：这一档是"把某个节点的键删掉"造出来的，现找会跟着卡漂。
 */
const NO_SETTINGS = EXAMPLE.graph.topology[0]

/**
 * 发请求的那一步 —— 「**写了 `settings`、但没写 style**」的那一个节点。
 *
 * 为什么钉它：它声明了 `FIRST_BLOCK`（所以那块真的进它的请求），
 * 而又排掉了 `style`（示例卡里最长的一块）⇒ 请求体小、断言好读。
 * ⚠️ 「五块都声明」的那个节点是本条判据的**反例**（改了 `style` 它照旧带着），这里不挑它。
 * 🔴 **必须排掉 `NO_SETTINGS`**：示例卡的第一个节点正好同时满足"写了声明"与"没写 style"
 *    ⇒ 不排它，这两个夹具会撞成同一个节点，两条判据就变成同一条用例的两面
 *    （票 56 那一族实测踩过一次，`card-resource-marks.ts` 里也记着同一句）。
 */
const REQUESTING_NODE = EXAMPLE.graph.topology.find(
  (id) =>
    id !== NO_SETTINGS &&
    declaredSettings(EXAMPLE, id) !== undefined &&
    !(declaredSettings(EXAMPLE, id) ?? []).includes('style'),
) as string

/**
 * 两个夹具不许撞车 —— **在模块加载期就断**。
 *
 * 撞了的话 R2 那两条会各说各话（"不写就一块都不发"与"写了就发"落在同一个节点上），
 * 而红的那一条会红在**夹具自撞**上、不是被测行为上（一条永远红的假红）。
 */
if (REQUESTING_NODE === NO_SETTINGS || REQUESTING_NODE === undefined) {
  throw new Error('the fixtures collided: pick another requesting node for this card')
}

/** 判据自己打进去的那一行（测试里的字符串字面量一律 ASCII） */
const TYPED_LINE = 'a line the model must read'
/** 打进去的第二行（正文改成"原标志行 + 这两行"：编辑一段，不是换掉它的第一行） */
const TYPED_MORE = 'and one more line'

describe('the mid column edits the card, and the card edits the next request', () => {
  /** 每个用例自己装假 fetch，跑完一律还原（否则下一条用例跑到别人的假响应上） */
  const track = fakeTracker()
  afterEach(() => track.restoreAll())

  /**
   * 挂一版真编辑器、开第四栏、点一条、把正文换成 `body`、再按顶栏那颗保存。
   *
   * ⚠️ 写完等一拍再返回：正文走的是 `input` 事件（`PromptForm` 的 `@input`），
   *    草稿要等这一拍才落到 `entries` 上；**不等的话保存时草稿还是空的**。
   */
  async function editBlock(id: string, body: string): Promise<void> {
    const w = mount(CardEditor, {
      props: { card: EXAMPLE, source: 'builtin' },
      global: { plugins: [i18n] },
    }) as AnyWrapper
    try {
      const open = w.find('[data-top] [data-card-resources-open]')
      expect(open.exists(), 'the top bar hands out no prompts-column toggle').toBe(true)
      await open.trigger('click')
      const row = w.find('[data-col="prompts"] [data-prompt-row="' + id + '"]')
      expect(row.exists(), 'the fourth column lists no row for ' + id).toBe(true)
      await row.trigger('click')
      const box = w.find('[data-prompt-form] [data-prompt-text]')
      expect(box.exists(), 'the mid column grew no body box for ' + id).toBe(true)
      await box.setValue(body)
      await save(w)
    } finally {
      w.unmount()
    }
  }

  /**
   * 真发一次请求，返回**发出去的那条 system 消息**（模型真会读到的那份文本）。
   *
   * ⚠️ 卡从 `savedCard()` 现取（界面写进存储的那一份），不是测试自己拼的对象 ——
   *    否则证明的是"测试会拼卡"。
   */
  async function systemOf(card: CardData, node: string): Promise<string> {
    const { sent } = await nodeRequest(track, card, node)
    const systems = sent.filter((message) => message.role === 'system')
    // 不加这一句的话 `find` 会在"一条都没有"与"有好几条"两种情况下各挑一个（挑到哪一个都是巧合）
    expect(systems.length, 'this request must carry exactly one system message').toBe(1)
    return systems[0].content
  }

  /** 一条标志行现在在不在那条请求里 */
  function carries(system: string, marker: string): boolean {
    return system.includes(marker)
  }

  it('R1 editing the body in the mid column really travels in the next request', async () => {
    setLocale('zh-CN')
    const marker = markerOf(EXAMPLE, FIRST_BLOCK)
    const control = markerOf(EXAMPLE, NEXT_BLOCK)
    /**
     * 旧正文**尾部**的一行（第二行非空）—— 「旧正文走了」那句拿它比。
     *
     * ⚠️ 不能拿标志行（第一行）比：新正文留着标志行（见下面），拿它比就成了"新正文里没有新正文"。
     */
    const oldTail = EXAMPLE.settings[FIRST_BLOCK as keyof CardData['settings']].find(
      (line) => line !== '' && line !== marker,
    ) as string
    // 前提：这一段本来发给它 —— 否则下面的「变了」证明不了什么
    const before = await systemOf(EXAMPLE, REQUESTING_NODE)
    expect(carries(before, marker), 'this block must already travel: the fixture is wrong').toBe(true)
    expect(carries(before, oldTail), 'this block tail must already travel: the fixture is wrong').toBe(true)
    expect(carries(before, '### ' + label('prompts.settingBlock.' + FIRST_BLOCK))).toBe(true)

    // ⚠️ **标志行留着**（新正文 = 原第一行 + 两行）：这是编辑**一段**正文，不是换掉它的第一行 ——
    //    否则「旧正文走了」那句会退化成同义反复（旧标志行本来就随第一行一起没了，删不删都成立）。
    const edited = [marker, TYPED_LINE, TYPED_MORE].join('\n')
    await editBlock(FIRST_BLOCK, edited)

    // 中间站：界面写进存储的**就是**改过的那一段（别的字段一个字节不动）
    const stored = savedCard()
    expect(declaredSettings(stored, REQUESTING_NODE)).toEqual(declaredSettings(EXAMPLE, REQUESTING_NODE))
    expect(stored.settings[FIRST_BLOCK as keyof CardData['settings']]).toEqual([
      marker,
      TYPED_LINE,
      TYPED_MORE,
    ])

    const after = await systemOf(stored, REQUESTING_NODE)
    console.log(
      '[request] block=' +
        FIRST_BLOCK +
        ' changed=' +
        String(carries(after, TYPED_MORE)) +
        ' oldGone=' +
        String(!carries(after, oldTail)),
    )
    // 判别：新正文真的到了模型手里、旧正文真的走了
    expect(carries(after, TYPED_LINE), 'the edited body did not reach the request').toBe(true)
    expect(carries(after, TYPED_MORE), 'the edited body reached the request only in part').toBe(true)
    expect(carries(after, oldTail), 'the old body is still travelling').toBe(false)
    // 反面控制：别处一个字没动 —— 换的是这一块，不是整份设定
    expect(carries(after, control), 'editing one block took another block away').toBe(true)
  })

  it('R2 a node that wrote no settings carries no block at all (absent means none)', async () => {
    setLocale('zh-CN')
    const absent = withoutSettings(EXAMPLE, NO_SETTINGS)
    expect(declaredSettings(absent, NO_SETTINGS), NO_SETTINGS + ' must declare nothing').toBeUndefined()

    const system = await systemOf(absent, NO_SETTINGS)
    console.log(
      '[absent] node=' +
        NO_SETTINGS +
        ' blocks=' +
        JSON.stringify(SETTING_KEYS.filter((key) => carries(system, markerOf(EXAMPLE, key)))),
    )
    for (const key of SETTING_KEYS) {
      expect(carries(system, markerOf(EXAMPLE, key)), key + ' must not travel').toBe(false)
      expect(carries(system, '### ' + label('prompts.settingBlock.' + key)), key + ' heading').toBe(false)
    }
    expect(carries(system, '## ' + label('prompts.setting')), 'the whole section must be gone').toBe(false)

    // 反面控制：**同一张卡**里写了声明的那一步照旧带着它声明的那几块 ——
    // 少了这一句，"整份卡都没发"与"这一档真的不发"分不开（一条恒真的空断言）。
    const declared = declaredSettings(absent, REQUESTING_NODE) ?? []
    expect(declared.length, 'the control node must declare blocks').toBeGreaterThan(0)
    const kept = await systemOf(absent, REQUESTING_NODE)
    for (const key of declared)
      expect(carries(kept, markerOf(EXAMPLE, key)), REQUESTING_NODE + ' keeps ' + key).toBe(true)
    // 落盘的接口一个字都没动（上面那条请求是从这份卡长出来的）
    expect(localStorage.getItem(CARD_KEY), 'these two cases must not write a card').toBeNull()
  })
})
