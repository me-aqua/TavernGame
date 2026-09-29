// @vitest-environment jsdom
/**
 * 搬进来的两件「能用的」：`CharacterSigil`（角色纹章）与 `SceneSigil`（场景剪影）。
 *
 * 两件都只有一个性质要守：**画出来的东西完全由那串名字的字节定**。
 *   · 同一个名字 ⇒ 换一次挂载也是逐字节同一份输出；
 *   · 不同的名字 ⇒ 输出不同（哈希真在起作用，不是摆一个固定图形）。
 *
 * 🔴 **第二半才是这条性质里唯一有牙的那一半**：把哈希压成常数时，第一半照样绿
 *    —— 常数也是"确定的"。所以下面那两条「一个名字一枚」是这一件的承重墙。
 *
 * ⚠️ 「输出」的口径：**摘掉写着名字的那两处属性**（`title` / `aria-label`）之后的那段 HTML。
 *    不摘的话，两个不同的名字必然产出两段不同的 HTML（名字本身就印在标签上），
 *    第二半会退化成一条**永远绿的假判据** —— 注入把一个常数哈希塞进去它也不会红。
 *    摘掉之后剩下的那三样（记号形状 / 色调 / 角度）才是"算出来的"。
 *    那两处属性本身另有两条用例正面守着，不会因为摘掉就没人管。
 *
 * ⚠️ 这一件不测样式（尺寸 / 颜色值那些）：样式由组件故事那一层在真浏览器里看，
 *    这里也不按文案找元素。
 * 🔴 **`tests/` 里的字符串一律 ASCII**（钩子查这一层，`npm run check` 看不见）⇒
 *    中文地名写成 `\uXXXX` 转义；每条用到它的用例都先证明自己那串真的是中文。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CharacterSigil from '../src/components/world/CharacterSigil.vue'
import SceneSigil from '../src/components/world/SceneSigil.vue'

/** 四个中文地名（塔 / 要塞 / 白桦林 / 雪山）—— 卡里的地名就是中文，种子只吃字节 */
const TOWER = '\u9ad8\u5854'
const FORTRESS = '\u8981\u585e'
const BIRCH = '\u767d\u6866\u6797'
const SNOW = '\u96ea\u5c71'
/** 第五个地名（雾谷），用来跟 `TOWER` 对撞 —— 它落在另一座地标上 */
const FOG = '\u96fe\u8c37'

/** 挂一枚纹章：除了这几样不给别的 */
function sigil(props: { name: string; you?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  return mount(CharacterSigil, { props })
}

/** 挂一张剪影 */
function scene(seed: string) {
  return mount(SceneSigil, { props: { seed } })
}

/**
 * 一枚纹章**算出来**的那一份：整段 HTML 摘掉 `title` / `aria-label`。
 *
 * 摘掉的那两处写着名字本身（它们是身份，不是图案）；留下来的记号 / 色调 / 角度
 * 才是由种子的字节派生的东西 —— 这一条的口径见文件头。
 */
function drawn(w: ReturnType<typeof sigil>): string {
  return w.html().replace(/\s(?:title|aria-label)="[^"]*"/g, '')
}

/**
 * 一张剪影**画出来**的那一份。模板上没有一处写着种子，整段都是算出来的，
 * 所以直接就是整段 HTML，不用摘。
 */
function shape(w: ReturnType<typeof scene>): string {
  return w.html()
}

/** 纹章上那一抹色调（行内 `style` 里的 `color`） */
function tintOf(w: ReturnType<typeof sigil>): string {
  return w.element.style.color
}

/** 记号转了多少度（模板里 `<g>` 上那个 `transform`） */
function turnOf(w: ReturnType<typeof sigil>): string {
  const g = w.find('svg g')
  expect(g.exists(), 'the mark group must be there to turn').toBe(true)
  return g.attributes('transform') ?? ''
}

describe('CharacterSigil: the same name draws the same mark', () => {
  it('draws it again, byte for byte, on a second mount', () => {
    expect(drawn(sigil({ name: 'Salen' }))).toBe(drawn(sigil({ name: 'Salen' })))
  })

  it('keeps the name itself on the mark: role, aria-label and title', () => {
    const w = sigil({ name: 'Salen' })
    expect(w.attributes('role')).toBe('img')
    expect(w.attributes('aria-label')).toBe('Salen')
    expect(w.attributes('title')).toBe('Salen')
  })
})

describe('CharacterSigil: one name, one mark', () => {
  it('changes the mark when one character of the name changes', () => {
    // 只差最后一个字母：拿长度或首字当种子的写法在这一条上会红
    expect(drawn(sigil({ name: 'Salem' }))).not.toBe(drawn(sigil({ name: 'Salen' })))
  })

  it('changes the mark when only the case changes', () => {
    expect(drawn(sigil({ name: 'salen' }))).not.toBe(drawn(sigil({ name: 'Salen' })))
  })

  it('gives every name in a bag its own mark', () => {
    // 这十个名字是**量过**的：两两都不同（形 3 档 / 色调 6 档 / 角度 40 档，
    // 十枚落在十种组合上）。把哈希压成常数、或改成只看长度，这一条当场红。
    const names = ['Salen', 'Salem', 'salen', 'Mira', 'Ilya', 'Zofia', 'Olek', 'Katerina', 'Bogdan', 'Sokol']
    const marks = names.map((name) => drawn(sigil({ name })))
    expect(new Set(marks).size, 'each of the ten names gets its own mark').toBe(names.length)
  })
})

describe('CharacterSigil: the lead variant and the three sizes', () => {
  it('crowns the lead and marks it as the lead', () => {
    const plain = sigil({ name: 'Salen' })
    const you = sigil({ name: 'Salen', you: true })
    expect(plain.find('.sigil-crown').exists()).toBe(false)
    expect(you.find('.sigil-crown').exists()).toBe(true)
    expect(you.classes()).toContain('sigil-you')
  })

  it('holds the lead mark still: one colour and one angle whatever the name is', () => {
    // 主角那一档的色与角度不看名字（形状还看）—— 两枚不同的名字必须共用同一个色调与角度
    const one = sigil({ name: 'Salen', you: true })
    const two = sigil({ name: 'Bogdan', you: true })
    expect(tintOf(one)).toBe(tintOf(two))
    expect(turnOf(one)).toBe(turnOf(two))
  })

  it('names the size on the mark, and defaults to the middle one', () => {
    expect(sigil({ name: 'Salen' }).classes()).toContain('md')
    expect(sigil({ name: 'Salen', size: 'sm' }).classes()).toContain('sm')
    expect(sigil({ name: 'Salen', size: 'lg' }).classes()).toContain('lg')
  })
})

describe('SceneSigil: one place, one silhouette', () => {
  it('draws it again, byte for byte, on a second mount', () => {
    expect(shape(scene(TOWER))).toBe(shape(scene(TOWER)))
  })

  it('changes the silhouette when the place name changes', () => {
    expect(shape(scene(TOWER))).not.toBe(shape(scene(FORTRESS)))
  })

  it('reaches all four silhouettes, one place name each', () => {
    // 四座地标（塔 / 拱门 / 林 / 山）都要够得着：只画得出两座也是"输出不同"，
    // 但那是坏的 —— 这一条把"有分支够不着"和"哈希坏了"分开报。
    const seeds = [TOWER, FORTRESS, BIRCH, SNOW]
    const drawn = seeds.map((seed) => shape(scene(seed)))
    expect(new Set(drawn).size, 'four seeds, four different silhouettes').toBe(seeds.length)
  })

  it('hashes a Chinese place name like any other string', () => {
    // 卡里的地名就是中文：种子只吃字节，非 ASCII 照算。
    // 先证明夹具真的是中文（不然下面那条只是"同一个字符串跟自己相等"）
    expect(
      TOWER.codePointAt(0) ?? 0,
      'the fixture must really start with a non-ASCII character',
    ).toBeGreaterThan(0x7f)
    expect(shape(scene(TOWER))).not.toBe(shape(scene(FOG)))
  })
})
