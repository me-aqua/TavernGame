/**
 * 票 77（拆 `CardEditor.vue`）：**搬出去那一族**的直接判据 —— 契约 `.team/test/2026-09-23/contract-77.md` §4 的 **S1–S4**。
 *
 * 为什么给它单独一份判据（S1 的裁决，理由在契约 §4）：搬走的那族里有两**条真逻辑**，
 * 今天只被"整份卡逐字比"**间接**照到 —— 一处动了，红的是"卡不对"，读的人得自己往回找：
 *   ① `cardDraft` 的三栏缺省语义：`tools` / `reads` **不写 = 全给** vs `settings` **不写 = 全不给**（票 76）；
 *   ② `setStepPick` 的"勾回来**插回候选表里的位置**"（不是接到末尾 —— 保存只改人动过的那几处）。
 *
 * 🔴 **`useStepDraft` 这个名字出现在这里不是巧合**：`.githooks/pre-commit` 的**检查 6** 要求
 *    每个 `src/` 模块名在 `tests/` 里出现过 ⇒ 这份判据就是新模块的过路条（必须与实现同一笔）。
 *
 * ⚠️ **模块今天还不存在 ⇒ 用 `import(变数)` 而不是顶层具名 import**：
 *    顶层 import（哪怕是字面量的动态 import）会让**打包期/收集期**就去解析那个路径 ——
 *    解析不到就**炸掉整份文件**，红的样子成了"测试坏了"；而这一条要的是"**功能没做**"的红。
 *    变数 + `@vite-ignore` ⇒ 运行时才解析 ⇒ 由下面那句断言把话说清楚。
 * ⚠️ **一律在组件外面调它**（不挂 host 组件）：契约 §2 的签名里没有生命周期钩子 ⇒
 *    若实现往里加了 `onMounted` / `useI18n`，这几条会**当场红** —— 那是**对的反馈**（签名变了）。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { parseCard, type CardData } from '../src/game/card'
import { EXAMPLE_CARD } from './support/card-fixtures'

/** 搬进新模块的那一族（票 77 的切口；检查 6 要的就是这个名字） */
const MODULE = '../src/components/useStepDraft'

/** 示例卡（期望值一律从它现取） */
const card = parseCard(readFileSync(EXAMPLE_CARD, 'utf8'))

/** 载入那一族：今天它不在 ⇒ 这一句就是"功能没做"那条红 */
async function loadFamily(): Promise<(input: unknown) => any> {
  const mod = (await import(/* @vite-ignore */ MODULE).catch(() => null)) as Record<string, unknown> | null
  expect(mod, 'the draft family has not been extracted yet: ' + MODULE).not.toBeNull()
  const builder = (mod as Record<string, unknown>).useStepDraft
  expect(typeof builder, 'the module must export useStepDraft').toBe('function')
  return builder as (input: unknown) => any
}

/** 一份本地造的卡：把那一步的某几个声明键**整个删掉**（"不写这个键"那一档的唯一造法） */
function cardWithout(id: string, keys: string[]): CardData {
  const copy = JSON.parse(JSON.stringify(card)) as Record<string, any>
  for (const key of keys) delete copy.graph.nodes[id][key]
  return parseCard(JSON.stringify(copy))
}

/** 挂一份那一族（`selected` 一开始空着，与真实接线一致） */
async function family(which: CardData = card): Promise<{ api: any; selected: { value: string } }> {
  const useStepDraft = await loadFamily()
  const selected = ref('')
  return { api: useStepDraft({ card: () => which, selected }), selected }
}

describe('R3 the draft family that moved out of CardEditor (ticket 77)', () => {
  it('S1 the three columns default differently: tools/reads absent means all, settings absent means none', async () => {
    const step = card.graph.topology[0]
    const { api, selected } = await family(cardWithout(step, ['tools', 'reads', 'settings']))
    selected.value = step
    const draft = api.stepValues.value
    expect(draft, 'no draft for the picked step: the composable did not hand out stepValues').not.toBeNull()
    expect(draft.tools, 'an absent tools key means every action of the card').toEqual(
      Object.keys(card.actions),
    )
    expect(draft.reads, 'an absent reads key means every top-level branch of the card').toEqual(
      Object.keys(card.state),
    )
    expect(draft.settings, 'an absent settings key means no block at all (ticket 76)').toEqual([])
  })

  it('S2 ticking a name back on puts it back where the roster has it, not at the end', async () => {
    // 挑一步：它的 `tools` 有两样、而且**卡序**里前那样在候选表里也靠前（`map`: add_place → set_whereabouts）
    const step = card.graph.topology.find((id) => (card.graph.nodes[id].tools ?? []).length > 1) as string
    const roster = Object.keys(card.actions)
    const declared = [...(card.graph.nodes[step].tools ?? [])]
    expect(declared.length, 'this step hands out no pair of tools to reorder').toBeGreaterThan(1)
    expect(
      roster.indexOf(declared[0]) < roster.indexOf(declared[1]),
      'the fixture relies on the card order of those two names',
    ).toBe(true)
    const { api, selected } = await family()
    selected.value = step
    api.setStepPick('tools', declared[0], false)
    expect(api.stepValues.value.tools, 'unticking must drop exactly that one').toEqual(declared.slice(1))
    api.setStepPick('tools', declared[0], true)
    expect(
      api.stepValues.value.tools,
      'ticking it back must put it where the roster has it, not at the end',
    ).toEqual(declared)
  })

  it('S3 editing makes it dirty, and typing the card value back makes it clean again', async () => {
    const step = card.graph.topology[0]
    const { api, selected } = await family()
    selected.value = step
    expect(api.dirty.value, 'an untouched step is clean').toBe(false)
    api.setStepText('name', 'renamed by the draft ticket')
    expect(api.dirty.value, 'one edit must make the family dirty').toBe(true)
    api.setStepText('name', card.graph.nodes[step].name)
    expect(api.dirty.value, 'typing the card value back is not a change').toBe(false)
  })

  it('S4 applying the drafts writes only what was really changed', async () => {
    const step = card.graph.topology[0]
    const { api, selected } = await family(cardWithout(step, ['tools']))
    selected.value = step
    api.setStepText('duty', 'rewritten by the draft ticket')
    const next = JSON.parse(JSON.stringify(cardWithout(step, ['tools']))) as CardData
    api.applyTo(next)
    expect(next.graph.nodes[step].duty, 'the edited field must reach the card').toBe(
      'rewritten by the draft ticket',
    )
    expect(
      Object.hasOwn(next.graph.nodes[step], 'tools'),
      'a key the author never wrote must not be added back just because the draft reads "all"',
    ).toBe(false)
  })
})
