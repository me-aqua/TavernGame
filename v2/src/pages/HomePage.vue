<script setup lang="ts">
/**
 * 首页（SPEC §5）：左边卡带、右边存档；建 / 选 / 打开 / 改名 / 删（删要确认）。
 *
 * 三条容易做坏的：
 *   · **点卡行只是「选中」**，不跳页 —— 新建存档要用这个选中态（「编辑」才进编辑器）；
 *   · **新建存档落在列表末尾**、**不跳转**，`tree` 取卡的初值、`cardSnapshot` 是整张卡的深拷贝；
 *   · **删卡连带删存档与它的模型映射**（`tg2.nodeModels[cardId]`），删存档不动卡。
 *
 * 🔴 **读盘失败时整页只留错误面板**（`loadFailed`）：卡 / 存档的字节没读进来时，
 * 内存里那份列表是空的 / 半截的 —— 这时只要能点到「新建」，写盘就会把盘上那份
 * （可能是旧格式、也可能只是坏了一份）**整表覆盖**。所以读盘一失败，列表与
 * `[data-new-card]` / `[data-new-save]` 一律不渲染，盘上一个字节都不动。
 */
import { onMounted, ref } from 'vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import ErrorPanel from '../components/ErrorPanel.vue'
import { asAppError, storage } from '../app-context'
import { cloneCard, freshCard, treeOf } from '../cards'
import type { AppError } from '../core/errors'
import type { Card, Save } from '../core/types'
import { t } from '../i18n'
import { routeHash } from '../router'

const cards = ref<Card[]>([])
const saves = ref<Save[]>([])
const error = ref<AppError | null>(null)
/** 读盘失败：列表与「新建」都不许出现（否则一次写盘就会覆盖盘上的旧数据） */
const loadFailed = ref(false)
const selectedCardId = ref<string | null>(null)
const renaming = ref<{ kind: 'card' | 'save'; id: string } | null>(null)
const renameValue = ref('')
const confirming = ref<{ kind: 'card' | 'save'; id: string } | null>(null)

function load(): void {
  try {
    cards.value = storage().loadCards()
    saves.value = storage().loadSaves()
  } catch (cause) {
    loadFailed.value = true
    error.value = asAppError(cause)
  }
}

onMounted(load)

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

function countOf(cardId: string): number {
  return saves.value.filter((save) => save.cardId === cardId).length
}

function createCard(): void {
  try {
    const card = freshCard(newId('c'), t('card.defaultName', { count: cards.value.length + 1 }))
    cards.value = [...cards.value, card]
    storage().saveCards(cards.value)
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
      name: t('save.defaultName', { count: saves.value.length + 1 }),
      turn: 0,
      tree: treeOf(card),
      events: [],
      updatedAt: new Date().toISOString(),
    }
    saves.value = [...saves.value, save]
    storage().saveSaves(saves.value)
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
      cards.value = cards.value.map((card) => (card.id === target.id ? { ...card, name } : card))
      storage().saveCards(cards.value)
    } else {
      saves.value = saves.value.map((save) => (save.id === target.id ? { ...save, name } : save))
      storage().saveSaves(saves.value)
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
      cards.value = cards.value.filter((card) => card.id !== target.id)
      saves.value = saves.value.filter((save) => save.cardId !== target.id)
      storage().saveCards(cards.value)
      storage().saveSaves(saves.value)
      const models = storage().loadNodeModels()
      delete models[target.id]
      storage().saveNodeModels(models)
      if (selectedCardId.value === target.id) selectedCardId.value = null
    } else {
      saves.value = saves.value.filter((save) => save.id !== target.id)
      storage().saveSaves(saves.value)
    }
  } catch (cause) {
    error.value = asAppError(cause)
  }
}

const confirmMessage = () =>
  confirming.value?.kind === 'card' ? t('home.deleteCardConfirm') : t('home.deleteSaveConfirm')

function cardNameOf(save: Save): string {
  return cards.value.find((card) => card.id === save.cardId)?.name ?? save.cardSnapshot.name
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
    </header>

    <ErrorPanel v-if="error" :error="error" />

    <div v-if="!loadFailed" class="page-body home-body">
      <section class="home-col">
        <div class="col-title">
          <span class="ellipsis">{{ t('home.cardsTitle') }}</span>
          <button type="button" data-new-card @click="createCard">{{ t('home.newCard') }}</button>
        </div>
        <div class="list scroll" data-card-list>
          <p v-if="cards.length === 0" class="muted empty" data-empty-cards>{{ t('home.emptyCards') }}</p>
          <div
            v-for="card in cards"
            :key="card.id"
            class="item"
            :class="{ selected: card.id === selectedCardId }"
            :data-card-id="card.id"
            @click="selectedCardId = card.id"
          >
            <template v-if="renaming && renaming.kind === 'card' && renaming.id === card.id">
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
              <span class="name ellipsis" data-card-name>{{ card.name }}</span>
              <span class="muted count" data-card-count>{{
                t('home.cardCount', { count: countOf(card.id) })
              }}</span>
              <span class="actions">
                <button
                  type="button"
                  data-card-edit
                  @click.stop="go(routeHash({ name: 'editor', cardId: card.id }))"
                >
                  {{ t('common.edit') }}
                </button>
                <button
                  type="button"
                  data-card-rename
                  @pointerdown.stop
                  @click.stop="startRename('card', card.id)"
                >
                  {{ t('common.rename') }}
                </button>
                <button
                  type="button"
                  data-card-delete
                  @click.stop="confirming = { kind: 'card', id: card.id }"
                >
                  {{ t('common.delete') }}
                </button>
              </span>
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
          <p v-if="saves.length === 0" class="muted empty" data-empty-saves>{{ t('home.emptySaves') }}</p>
          <div
            v-for="save in saves"
            :key="save.id"
            class="item"
            :data-save-id="save.id"
            @click="go(routeHash({ name: 'play', cardId: save.cardId, saveId: save.id }))"
          >
            <template v-if="renaming && renaming.kind === 'save' && renaming.id === save.id">
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
              <span class="name ellipsis" data-save-name>{{ save.name }}</span>
              <span class="muted meta ellipsis" data-save-meta>
                {{ t('home.saveMeta', { card: cardNameOf(save), turn: save.turn }) }}
              </span>
              <span class="actions">
                <button
                  type="button"
                  data-save-rename
                  @pointerdown.stop
                  @click.stop="startRename('save', save.id)"
                >
                  {{ t('common.rename') }}
                </button>
                <button
                  type="button"
                  data-save-delete
                  @click.stop="confirming = { kind: 'save', id: save.id }"
                >
                  {{ t('common.delete') }}
                </button>
              </span>
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
