/**
 * 旧数据迁移（阶段 3 → 阶段 4）：给数组 item 补隐藏 id，**不改任何用户可见的值**。
 *
 * 只做「缺什么补什么」：已有合法 id 原样保留；缺 id 的 item 按**本数组当前最大编号 + 1** 顺序补。
 * 嵌套数组各自独立编号。迁移是幂等的（跑两次结果一样），而且**只在内存里**做 ——
 * 盘上的旧数据要等下一次保存才带上 id。
 *
 * 入口都在 `core/storage.ts` 的读函数里（loadCardById / loadCardEntries / loadCards /
 * loadSaveById / loadSaveEntries / loadSaves），所以编辑器 / 游玩 / 首页拿到的都是迁移后的数据。
 */
import { childrenOf, isRecord } from './state-codes'
import { isItemId, itemIdsOf, withItemIds } from './state-ref-type'
import type { Card, Save, StateElement, Tree } from './types'

/** 一个结构体里的字段递归（数组字段补 id，对象 / 有孩子的字段继续下钻） */
function normalizeNode(state: StateElement[], code: string, value: unknown, prefer?: unknown): unknown {
  if (!isRecord(value)) return value
  const old = isRecord(prefer) ? prefer : {}
  const out: Record<string, unknown> = { ...value }
  for (const child of childrenOf(state, code)) {
    if (!(child.code in out)) continue
    out[child.code] =
      child.type === 'array'
        ? normalizeItems(state, child.code, out[child.code], old[child.code])
        : normalizeNode(state, child.code, out[child.code], old[child.code])
  }
  return out
}

/** 一个数组值补 id（嵌套数组递归）；`prefer` = 快照里同位置 item 的 id（存档树优先对齐快照） */
function normalizeItems(state: StateElement[], code: string, value: unknown, prefer?: unknown): unknown {
  if (!Array.isArray(value)) return value
  const preferred = Array.isArray(prefer) ? prefer : []
  const known = itemIdsOf(preferred)
  const prepared = value.map((item, index) => {
    if (!isRecord(item)) return item
    const at = isRecord(preferred[index]) ? preferred[index] : {}
    const id = isItemId(item.id) ? item.id : isItemId(at.id) ? at.id : undefined
    return id === undefined ? item : { ...item, id }
  })
  const filled = withItemIds(prepared, known)
  return filled.map((item, index) => {
    if (!isRecord(item)) return item
    const oldItem = isRecord(preferred[index]) ? preferred[index] : {}
    return normalizeNode(state, code, item, oldItem)
  })
}

/** 一张扁平值表里的所有数组值补 id（初始值表 / 存档树共用） */
function normalizeTree(state: StateElement[], tree: Tree, prefer?: Tree): Tree {
  const out: Tree = { ...tree }
  for (const element of state) {
    if (element.type !== 'array' || !(element.code in out)) continue
    out[element.code] = normalizeItems(
      state,
      element.code,
      out[element.code],
      prefer?.[element.code],
    ) as Tree[string]
  }
  return out
}

/** 卡的初始值表补 id（每个根一张表）；卡里没有 initial / 形状坏了就原样跳过，交给校验器报 */
export function migrateCard(card: Card): Card {
  const next = structuredClone(card) as Card
  if (!Array.isArray(next.state)) return next
  for (const element of next.state) {
    if (element.code.includes('.') || !isRecord(element.initial)) continue
    element.initial = normalizeTree(next.state, element.initial as Tree) as typeof element.initial
  }
  return next
}

/** 存档：快照与当前树都补 id；当前树优先沿用快照同位置 item 的 id（引用值不变） */
export function migrateSave(save: Save): Save {
  const next = structuredClone(save) as Save
  if (!isRecord(next.cardSnapshot)) return next
  next.cardSnapshot = migrateCard(next.cardSnapshot)
  if (!isRecord(next.tree)) return next
  const state = Array.isArray(next.cardSnapshot.state) ? next.cardSnapshot.state : []
  next.tree = normalizeTree(state, next.tree as Tree, snapshotTreeOf(next.cardSnapshot))
  return next
}

/** 快照的初始值摊平成树（容错版：坏卡给空表，不在这里抛） */
function snapshotTreeOf(card: Card): Tree {
  const tree: Tree = {}
  if (!Array.isArray(card.state)) return tree
  for (const root of card.state) {
    if (root.code.includes('.') || !isRecord(root.initial)) continue
    Object.assign(tree, root.initial)
  }
  return tree
}
