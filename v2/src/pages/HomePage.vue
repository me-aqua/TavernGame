<script setup lang="ts">
/**
 * 首页（SPEC §5）：左边游戏卡、右边存档；建 / 选 / 打开 / 改名 / 删（删要确认）。
 *
 * 三条容易做坏的：
 *   · **点卡行只是「选中」**，不跳页 —— 新建存档要用这个选中态（「编辑」才进编辑器）；
 *   · **新建存档落在列表末尾**、**不跳转**，`tree` 取卡的初值、`cardSnapshot` 是整张卡的深拷贝；
 *   · **删卡连带删存档与它的模型映射**（`tg2.nodeModels[cardId]`），删存档不动卡。
 *
 * 🔴 **列表是逐条读的**（`loadCardEntries()` / `loadSaveEntries()`）：盘上一条坏卡 / 坏存档
 * 不再把整页挡在错误页后面 —— 坏项照原顺序渲染成一行（`data-invalid-*` + 中文原因），
 * 只是没有任何入口（不能选中、不能编辑 / 改名 / 删除 / 进对话）。合法项完全照旧。
 *
 * 🔴 **写盘一律走宽松写**（`saveCardsLoose()` / `saveSavesLoose()`），且只替换 entries 里对应的
 * 那一条：坏项的 `raw` 原样带回盘上（**JSON 值不变**；解析 / 重新序列化会改空白与数字写法，
 * 不承诺字节逐字相同）—— 这一票不修、不删、不迁移坏项。
 *
 * 🔴 **整表读失败时整页只留错误面板**（`loadFailed`）：坏 JSON / 顶层不是数组时，
 * 内存里那份列表是空的 / 半截的 —— 这时只要能点到「新建」，写盘就会把盘上那份整表覆盖。
 * 所以读盘一失败，列表与 `[data-new-card]` / `[data-new-save]` 一律不渲染。
 */
import { computed, onMounted, ref } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ErrorPanel from '../components/ErrorPanel.vue'
import { asAppError, storage } from '../app-context'
import { cloneCard, freshCard, treeOf } from '../cards'
import type { AppError } from '../core/errors'
import type { CardEntry, SaveEntry } from '../core/storage'
import type { Save } from '../core/types'
import { t } from '../i18n'
import { REPO_URL } from '../repo'
import { routeHash } from '../router'

const cardEntries = ref<CardEntry[]>([])
const saveEntries = ref<SaveEntry[]>([])
/** 合法项：界面上能选中 / 打开 / 改名的那些（坏项只渲染，不参与操作） */
const cards = computed(() => cardEntries.value.flatMap((entry) => (entry.card ? [entry.card] : [])))
const saves = computed(() => saveEntries.value.flatMap((entry) => (entry.save ? [entry.save] : [])))
const error = ref<AppError | null>(null)
/** 读盘失败：列表与「新建」都不许出现（否则一次写盘就会覆盖盘上的旧数据） */
const loadFailed = ref(false)
const selectedCardId = ref<string | null>(null)
const renaming = ref<{ kind: 'card' | 'save'; id: string } | null>(null)
const renameValue = ref('')
const confirming = ref<{ kind: 'card' | 'save'; id: string } | null>(null)

/** 元素上的 `id` / `name`：坏项不过校验，所以只按形状取（拿不到就不显示） */
function rawId(raw: unknown): string | undefined {
  const id = (raw as { id?: unknown } | null)?.id
  return typeof id === 'string' ? id : undefined
}

function rawName(raw: unknown): string {
  const name = (raw as { name?: unknown } | null)?.name
  return typeof name === 'string' ? name : (rawId(raw) ?? '')
}

function load(): void {
  try {
    cardEntries.value = storage().loadCardEntries()
    saveEntries.value = storage().loadSaveEntries()
  } catch (cause) {
    loadFailed.value = true
    error.value = asAppError(cause)
  }
}

onMounted(load)

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

/** 写回整表：只序列化 `raw`，坏项那一条原样带回盘上 */
function writeCards(): void {
  storage().saveCardsLoose(cardEntries.value.map((entry) => entry.raw))
}

function writeSaves(): void {
  storage().saveSavesLoose(saveEntries.value.map((entry) => entry.raw))
}

function isSelected(entry: CardEntry): boolean {
  return entry.card !== undefined && entry.card.id === selectedCardId.value
}

function countOf(cardId: string): number {
  return saves.value.filter((save) => save.cardId === cardId).length
}

// 坏卡 / 坏存档行没有任何入口：点上去既不选中、也不跳页
function selectCard(entry: CardEntry): void {
  if (entry.card) selectedCardId.value = entry.card.id
}

function openSave(entry: SaveEntry): void {
  if (entry.save) go(routeHash({ name: 'play', cardId: entry.save.cardId, saveId: entry.save.id }))
}

function createCard(): void {
  try {
    const card = freshCard(newId('c'), t('card.defaultName', { count: cardEntries.value.length + 1 }))
    cardEntries.value = [...cardEntries.value, { raw: card, card }]
    writeCards()
    selectedCardId.value = card.id
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function createSave(): void {
  const card = cards.value.find((item) => item.id === selectedCardId.value)
  if (!card) return
  try {
    const save: Save = {
      schemaVersion: 1,
      id: newId('s'),
      cardId: card.id,
      cardSnapshot: cloneCard(card),
      name: t('save.defaultName', { count: saveEntries.value.length + 1 }),
      turn: 0,
      tree: treeOf(card),
      events: [],
      updatedAt: new Date().toISOString(),
    }
    saveEntries.value = [...saveEntries.value, { raw: save, save }]
    writeSaves()
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function startRename(kind: 'card' | 'save', id: string): void {
  const target =
    kind === 'card' ? cards.value.find((item) => item.id === id) : saves.value.find((item) => item.id === id)
  renaming.value = { kind, id }
  renameValue.value = target?.name ?? ''
}

function commitRename(): void {
  const target = renaming.value
  if (!target) return
  renaming.value = null
  try {
    const name = renameValue.value
    if (target.kind === 'card') {
      cardEntries.value = cardEntries.value.map((entry) => {
        if (entry.card?.id !== target.id) return entry
        const next = { ...entry.card, name }
        return { raw: next, card: next }
      })
      writeCards()
    } else {
      saveEntries.value = saveEntries.value.map((entry) => {
        if (entry.save?.id !== target.id) return entry
        const next = { ...entry.save, name }
        return { raw: next, save: next }
      })
      writeSaves()
    }
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

function confirmDelete(): void {
  const target = confirming.value
  confirming.value = null
  if (!target) return
  try {
    if (target.kind === 'card') {
      cardEntries.value = cardEntries.value.filter((entry) => entry.card?.id !== target.id)
      saveEntries.value = saveEntries.value.filter((entry) => entry.save?.cardId !== target.id)
      writeCards()
      writeSaves()
      const models = storage().loadNodeModels()
      delete models[target.id]
      storage().saveNodeModels(models)
      if (selectedCardId.value === target.id) selectedCardId.value = null
    } else {
      saveEntries.value = saveEntries.value.filter((entry) => entry.save?.id !== target.id)
      writeSaves()
    }
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

const confirmMessage = () =>
  confirming.value?.kind === 'card' ? t('home.deleteCardConfirm') : t('home.deleteSaveConfirm')

/** 存档行上显示哪个卡名：现存卡 ?? 存档快照 ?? 中性回退（快照缺名字时不许当场崩） */
function cardNameOf(save: Save): string {
  const card = cards.value.find((item) => item.id === save.cardId)
  const snapshotName = (save.cardSnapshot as { name?: unknown } | undefined)?.name
  const name = card?.name ?? snapshotName
  return typeof name === 'string' && name !== '' ? name : t('home.unknownCard')
}

function go(hash: string): void {
  location.hash = hash
}
</script>

<template>
  <div class="page" data-page="home">
    <header class="page-bar">
      <span class="page-title">{{ t('app.title') }}</span>
      <span class="spacer"></span>
      <button type="button" @click="go(routeHash({ name: 'settings' }))">{{ t('settings.title') }}</button>
      <span class="repo-center">
        <a class="repo-url" :href="REPO_URL" :data-repo-url="REPO_URL" target="_blank" rel="noopener">{{
          REPO_URL
        }}</a>
      </span>
    </header>

    <ErrorPanel v-if="error" :error="error" />

    <div v-if="!loadFailed" class="page-body home-body">
      <section class="home-col">
        <div class="col-title">
          <span class="ellipsis">{{ t('home.cardsTitle') }}</span>
          <button type="button" data-new-card @click="createCard">{{ t('home.newCard') }}</button>
        </div>
        <div class="list scroll" data-card-list>
          <p v-if="cardEntries.length === 0" class="muted empty" data-empty-cards>
            {{ t('home.emptyCards') }}
          </p>
          <div
            v-for="(entry, index) in cardEntries"
            :key="`card-${index}`"
            class="item"
            :class="{ selected: isSelected(entry), invalid: entry.error !== undefined }"
            :data-card-id="rawId(entry.raw)"
            :data-invalid-card="entry.error ? '' : undefined"
            @click="selectCard(entry)"
          >
            <template v-if="entry.card">
              <template v-if="renaming && renaming.kind === 'card' && renaming.id === entry.card.id">
                <input
                  v-model="renameValue"
                  class="rename"
                  data-rename-input
                  @pointerdown.stop
                  @click.stop
                  @keyup.enter="commitRename"
                  @keyup.esc="renaming = null"
                  @blur="commitRename"
                />
              </template>
              <template v-else>
                <span class="name ellipsis" data-card-name>{{ entry.card.name }}</span>
                <span class="muted count" data-card-count>{{
                  t('home.cardCount', { count: countOf(entry.card.id) })
                }}</span>
                <span class="actions">
                  <button
                    type="button"
                    data-card-edit
                    @click.stop="go(routeHash({ name: 'editor', cardId: entry.card.id }))"
                  >
                    {{ t('common.edit') }}
                  </button>
                  <button
                    type="button"
                    data-card-rename
                    @pointerdown.stop
                    @click.stop="startRename('card', entry.card.id)"
                  >
                    {{ t('common.rename') }}
                  </button>
                  <button
                    type="button"
                    data-card-delete
                    @click.stop="confirming = { kind: 'card', id: entry.card.id }"
                  >
                    {{ t('common.delete') }}
                  </button>
                </span>
              </template>
            </template>
            <template v-else>
              <span class="badge" data-invalid-badge>{{ t('home.invalidBadge') }}</span>
              <span class="name ellipsis" data-invalid-name>{{ rawName(entry.raw) }}</span>
              <span class="muted meta ellipsis" data-invalid-reason>{{ entry.error?.message }}</span>
            </template>
          </div>
        </div>
      </section>

      <section class="home-col">
        <div class="col-title">
          <span class="ellipsis">{{ t('home.savesTitle') }}</span>
          <button type="button" data-new-save :disabled="!selectedCardId" @click="createSave">
            {{ t('home.newSave') }}
          </button>
        </div>
        <div class="list scroll" data-save-list>
          <p v-if="saveEntries.length === 0" class="muted empty" data-empty-saves>
            {{ t('home.emptySaves') }}
          </p>
          <div
            v-for="(entry, index) in saveEntries"
            :key="`save-${index}`"
            class="item"
            :class="{ invalid: entry.error !== undefined }"
            :data-save-id="rawId(entry.raw)"
            :data-invalid-save="entry.error ? '' : undefined"
            @click="openSave(entry)"
          >
            <template v-if="entry.save">
              <template v-if="renaming && renaming.kind === 'save' && renaming.id === entry.save.id">
                <input
                  v-model="renameValue"
                  class="rename"
                  data-rename-input
                  @pointerdown.stop
                  @click.stop
                  @keyup.enter="commitRename"
                  @keyup.esc="renaming = null"
                  @blur="commitRename"
                />
              </template>
              <template v-else>
                <span class="name ellipsis" data-save-name>{{ entry.save.name }}</span>
                <span class="muted meta ellipsis" data-save-meta>
                  {{ t('home.saveMeta', { card: cardNameOf(entry.save), turn: entry.save.turn }) }}
                </span>
                <span class="actions">
                  <button
                    type="button"
                    data-save-rename
                    @pointerdown.stop
                    @click.stop="startRename('save', entry.save.id)"
                  >
                    {{ t('common.rename') }}
                  </button>
                  <button
                    type="button"
                    data-save-delete
                    @click.stop="confirming = { kind: 'save', id: entry.save.id }"
                  >
                    {{ t('common.delete') }}
                  </button>
                </span>
              </template>
            </template>
            <template v-else>
              <span class="badge" data-invalid-badge>{{ t('home.invalidBadge') }}</span>
              <span class="name ellipsis" data-invalid-name>{{ rawName(entry.raw) }}</span>
              <span class="muted meta ellipsis" data-invalid-reason>{{ entry.error?.message }}</span>
            </template>
          </div>
        </div>
      </section>
    </div>

    <ConfirmDialog
      v-if="confirming"
      :message="confirmMessage()"
      @confirm="confirmDelete"
      @cancel="confirming = null"
    />
  </div>
</template>

<style scoped>
.spacer {
  flex: 1 1 auto;
}

.home-body {
  gap: 10px;
  padding: 10px;
}

.home-col {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}

.list {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.empty {
  margin: 6px 4px 0;
}

.item {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
  min-width: 0;
  height: var(--row-h);
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel-2);
  cursor: pointer;
}

.item.selected {
  border-color: var(--accent);
}

.item:hover {
  border-color: var(--line-strong);
}

/* 坏项：虚线危险边框 + 手型取消（它没有任何入口），原因那一行与徽标同色 */
.item.invalid {
  height: auto;
  min-height: var(--row-h);
  border-style: dashed;
  border-color: var(--danger);
  cursor: default;
}

.badge {
  flex: 0 0 auto;
  font-size: var(--fs3);
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--danger);
  color: var(--danger);
}

.item.invalid .meta {
  color: var(--danger);
}

.name {
  flex: 1 1 120px;
  font-size: var(--fs2);
}

.count,
.meta {
  flex: 0 1 auto;
  max-width: 60%;
}

.actions {
  display: flex;
  gap: 4px;
  flex: 0 0 auto;
}

.rename {
  flex: 1 1 120px;
  min-width: 0;
}
</style>
