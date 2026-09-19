/**
 * src/components/hud.ts —— 游戏 HUD 的数据投影：主角牌 / 人物牌 / 故事链 / 行动牌。
 *
 * 界面不认识「力量 / 铁匠 / 地牢」这些具体内容 —— 和世界面板一样，只按状态树的
 * **形状**推导（对象 = 几行、数字 = 数值条、短字符串 = 标签、列表 = 人名或物品）。
 * 唯一的界面约定仍是条目里的 name / count / note（见 state-view.ts）。
 *
 * 纯函数，不 import Vue：单测能直接喂一份状态树（人物/主角/故事链）或一份
 * 卡声明过的 HudData（行动牌），视图只负责把它摆成 HUD。
 */
import type { HudData, Spot } from '../game/display'
import { isRecord } from '../game/save'
import {
  entriesOf,
  isScalar,
  itemOf,
  ITEM_COUNT,
  ITEM_NAME,
  ITEM_NOTE,
  linesOf,
  noteOf,
  scalarText,
  textsOf,
} from './state-view'

/** 一条属性：键（卡里的 ASCII 名）+ 值 + 0..1 的条 */
export interface HudStat {
  key: string
  value: string
  ratio: number
}

/** 一条状态标签（心情 / 穿着 / 种族……） */
export interface HudBadge {
  key: string
  value: string
}

/** 一段关系：对方 + 一段自然语言 */
export interface HudRelation {
  name: string
  detail: string
}

/** 主角牌 */
export interface HudSelf {
  name: string
  stats: HudStat[]
  badges: HudBadge[]
  relations: HudRelation[]
  pack: string[]
  packCount: number
}

/** 一个人物牌 */
export interface HudPerson {
  name: string
  note: string
  /** 简介之外的短标签（tier / race / role……） */
  tags: string[]
  /** 状态里记的「在哪里」；没有就是空串 */
  where: string
  /** 就在当前场景（按 where 与 location 的字符串包含粗判） */
  present: boolean
}

/** 一条故事链 / 任务 */
export interface HudQuest {
  name: string
  subtitle: string
  stage: number
  total: number
  /** 当前阶段的名字（stages[stage-1]），没有阶段表就是空串 */
  stageName: string
  revealed: string[]
}

/** 行动牌的来源 */
export type ActionKind = 'place' | 'person' | 'item' | 'verb'

/** 一张行动牌：标签与它填进输入框的句子都走 i18n，参数是卡里的内容 */
export interface ActionOption {
  id: string
  kind: ActionKind
  labelKey: string
  labelArgs: Record<string, string>
  textKey: string
  textArgs: Record<string, string>
}

/** 数值条的分母：常见 1–10 属性用 10；更大的量表按最大值归一 */
function statRatio(value: number, scale: number): number {
  return Math.max(0, Math.min(1, value / scale))
}

/**
 * 主角牌：姓名、数字属性、短标签、关系、行囊。
 *
 * 数字从任意嵌套对象里收集（示例卡的 traits）；标签从同一个对象的短字符串 /
 * 字符串数组里收集（race、wearing、mood、非空 injuries……），过长的生平/性格
 * 不进 HUD（那是手札里读的）。列表按 shape 分成「关系」与「行囊」：
 * 有 name / count / 是纯字符串的当行囊，其余对象列表当关系。
 */
export function selfHud(lead: unknown): HudSelf {
  const self: HudSelf = { name: '', stats: [], badges: [], relations: [], pack: [], packCount: 0 }
  if (!isRecord(lead)) return self

  self.name = scalarText(lead[ITEM_NAME])
  const numbers: { key: string; value: number }[] = []

  for (const { key, value } of entriesOf(lead)) {
    if (key === ITEM_NAME) continue

    if (Array.isArray(value)) {
      const packLike =
        value.length === 0 ||
        value.every((item) => isScalar(item)) ||
        value.some(
          (item) =>
            isRecord(item) && (scalarText(item[ITEM_NAME]) !== '' || scalarText(item[ITEM_COUNT]) !== ''),
        )

      if (packLike) {
        for (const item of value) {
          const row = itemOf(item)
          if (row.title === '') continue
          self.pack.push(row.count === '' ? row.title : row.title + ' \u00d7' + row.count)
          const count = Number(row.count)
          self.packCount += Number.isFinite(count) && count > 0 ? count : 1
        }
      } else {
        for (const item of value) {
          const row = itemOf(item)
          if (row.title !== '') {
            self.relations.push({
              name: row.title,
              detail: row.lines
                .filter((line) => line.key !== ITEM_NOTE)
                .map((line) => line.text)
                .join(' \u00b7 '),
            })
            continue
          }
          const lines = linesOf(item)
          if (lines.length === 0) continue
          self.relations.push({
            name: lines[0].text,
            detail: lines
              .slice(1)
              .filter((line) => line.key !== ITEM_NOTE)
              .map((line) => line.text)
              .join(' \u00b7 '),
          })
        }
      }
      continue
    }

    if (!isRecord(value)) continue
    for (const line of linesOf(value)) {
      const asNumber = Number(line.text)
      if (line.text !== '' && Number.isFinite(asNumber)) {
        numbers.push({ key: `${key}.${line.key}`, value: asNumber })
        continue
      }
      // 短标签：心情 / 穿着 / 种族 / 非空伤势；长生平留给手札
      if (line.text !== '' && line.text.length <= 32 && self.badges.length < 6) {
        self.badges.push({ key: `${key}.${line.key}`, value: line.text })
      }
    }
  }

  const top = numbers.reduce((max, stat) => Math.max(max, stat.value), 0)
  const scale = top <= 10 ? 10 : top
  self.stats = numbers.slice(0, 8).map((stat) => ({
    key: stat.key,
    value: String(stat.value),
    ratio: statRatio(stat.value, scale),
  }))
  self.relations = self.relations.slice(0, 5)
  self.badges = self.badges.slice(0, 4)
  return self
}

/** 人物牌：键是人名，简介读 note，短标签来自其余标量，where 读 whoIsWhere */
export function peopleHud(roles: unknown, whoIsWhere: unknown, here: Spot): HudPerson[] {
  const places = isRecord(whoIsWhere) ? whoIsWhere : {}
  return entriesOf(roles).map(({ key, value }) => {
    const tags = linesOf(value)
      .filter((line) => line.key !== ITEM_NOTE && line.text !== '' && line.text.length <= 18)
      .map((line) => line.text)
      .slice(0, 3)
    const where = scalarText(places[key])
    return {
      name: key,
      note: noteOf(value),
      tags,
      where,
      present: [here.spot, here.scene].some((place) => place !== '' && where.includes(place)),
    }
  })
}

/**
 * 故事链：每条链的标题是键，进度取**第一个数字**（stage），
 * 阶段取第一个字符串列表（stages），线索取第二个（revealed），
 * 副标题取第一个稍长的字符串（surface / truth / conflict……）。
 */
export function questsHud(chains: unknown): HudQuest[] {
  const quests: HudQuest[] = []
  for (const { key, value } of entriesOf(chains)) {
    if (!isRecord(value)) continue
    let stage = 0
    let lists = 0
    let stages: string[] = []
    let revealed: string[] = []
    const strings: string[] = []

    for (const item of Object.values(value)) {
      const text = scalarText(item)
      if (text !== '') {
        const number = Number(text)
        if (stage === 0 && Number.isFinite(number) && String(number) === text) stage = number
        else strings.push(text)
        continue
      }
      if (Array.isArray(item) && item.length > 0 && item.every(isScalar)) {
        lists += 1
        if (lists === 1) stages = item.map(String)
        else if (lists === 2) revealed = item.map(String)
      }
    }

    const subtitle = strings.find((text) => text.length >= 6) ?? (strings.length > 0 ? strings[0] : '')
    const stageName = stages.length > 0 ? (stages[Math.max(0, stage - 1)] ?? '') : ''
    quests.push({ name: key, subtitle, stage, total: stages.length, stageName, revealed })
  }
  return quests
}

/** 一张行动牌 */
function option(
  kind: ActionKind,
  id: string,
  labelKey: string,
  labelArgs: Record<string, string>,
  textKey: string,
  textArgs: Record<string, string>,
): ActionOption {
  return { id: `${kind}:${id}`, kind, labelKey, labelArgs, textKey, textArgs }
}

/**
 * 状态推导的行动牌。
 *
 * 人物与地点优先（角色扮演是主线），再是行囊与通用动词。地点从 world.map 的
 * 字符串数组取、人物从 roles 的键取、物品从 lead.pack 取 —— 全是卡声明的形状。
 * 返回的句子由视图 t() 现译，和界面语言一致。
 */
export function actionOptions(data: HudData): ActionOption[] {
  const here = data.location
  const lead = data.lead
  const cast = data.cast
  const pack = data.pack

  const people: ActionOption[] = []
  const leadName = isRecord(lead) ? scalarText(lead[ITEM_NAME]) : ''
  for (const { key } of entriesOf(cast)) {
    if (key === leadName || key === '') continue
    people.push(
      option('person', key, 'hud.actionPerson', { name: key }, 'hud.actionPersonText', { name: key }),
    )
  }

  const places: ActionOption[] = []
  const seenPlaces = new Set<string>()
  // 收一个不重复、也不是当前所在地点的去处
  const addPlace = (place: string): void => {
    if (place === '' || place === here.spot || place === here.scene || seenPlaces.has(place)) return
    seenPlaces.add(place)
    places.push(option('place', place, 'hud.actionGo', { place }, 'hud.actionGoText', { place }))
  }
  for (const { key, value } of entriesOf(data.map)) {
    if (key !== here.area) addPlace(key)
    for (const place of textsOf(value)) addPlace(place)
  }

  const items: ActionOption[] = []
  const itemsList = Array.isArray(pack) ? pack : entriesOf(pack).map((entry) => entry.value)
  for (const item of itemsList) {
    const row = itemOf(item)
    if (row.title === '') continue
    items.push(
      option('item', row.title, 'hud.actionItem', { item: row.title }, 'hud.actionItemText', {
        item: row.title,
      }),
    )
  }

  const verbs: ActionOption[] = [
    option('verb', 'look', 'hud.actionLook', {}, 'hud.actionLookText', {}),
    option('verb', 'wait', 'hud.actionWait', {}, 'hud.actionWaitText', {}),
    option('verb', 'rest', 'hud.actionRest', {}, 'hud.actionRestText', {}),
  ]

  return [...people.slice(0, 2), ...places.slice(0, 2), ...items.slice(0, 1), ...verbs.slice(0, 2)].slice(
    0,
    6,
  )
}
