<script setup lang="ts">
/**
 * 应用外壳：主题、hash 路由分派、手机竖屏遮罩。
 *
 * 主题在这里读一次（读坏了显示错误页，不是白屏）；路由**用原生 `hashchange`**（不引入 vue-router）——
 * 刷新/深链不白屏靠的就是「首次 load 也渲染一次」。
 *
 * 竖屏时**整页只给遮罩**：1280×720 以下的档位本来就不做（SPEC §6），
 * 与其把挤扁的界面塞给人看，不如把屏幕让给「请横屏使用」。
 *
 * 每一屏都有同一条页栏（`.page-bar`）：左边是品牌 / 返回 / 标题，右边是设置 / 状态 / 按钮，
 * 正中是一行仓库地址。启动失败与未知路由也走这条页栏 —— 出错时项目地址照常看得见。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import ErrorPanel from './components/ErrorPanel.vue'
import LandscapeOverlay from './components/LandscapeOverlay.vue'
import { asAppError, storage } from './app-context'
import { AppError } from './core/errors'
import { t } from './i18n'
import { REPO_URL } from './repo'
import { parseRoute, type Route } from './router'
import { setTheme } from './theme'
import EditorPage from './pages/EditorPage.vue'
import HomePage from './pages/HomePage.vue'
import PlayPage from './pages/PlayPage.vue'
import SettingsPage from './pages/SettingsPage.vue'

const route = ref<Route>(parseRoute(location.hash))
const portrait = ref(false)
const bootError = ref<AppError | null>(null)
let media: MediaQueryList | null = null

const PORTRAIT = '(max-width: 767px) and (orientation: portrait)'

function onHashChange(): void {
  route.value = parseRoute(location.hash)
}

function onMediaChange(event: MediaQueryListEvent): void {
  portrait.value = event.matches
}

onMounted(() => {
  try {
    setTheme(storage().loadSettings().theme)
  } catch (cause) {
    bootError.value = asAppError(cause)
  }
  media = window.matchMedia(PORTRAIT)
  portrait.value = media.matches
  media.addEventListener('change', onMediaChange)
  window.addEventListener('hashchange', onHashChange)
})

onUnmounted(() => {
  media?.removeEventListener('change', onMediaChange)
  window.removeEventListener('hashchange', onHashChange)
})

function unknownRoute(): AppError {
  return new AppError('E_VALIDATION', { message: t('error.unknownRoute'), nextStep: t('next.home') })
}
</script>

<template>
  <div class="app-root">
    <LandscapeOverlay v-if="portrait" />
    <template v-else>
      <div v-if="bootError || route.name === 'unknown'" class="page" data-page="error">
        <header class="page-bar">
          <span class="page-title">{{ t('app.title') }}</span>
          <span class="repo-center">
            <a class="repo-url" :href="REPO_URL" :data-repo-url="REPO_URL" target="_blank" rel="noopener">{{
              REPO_URL
            }}</a>
          </span>
        </header>
        <ErrorPanel :error="bootError ?? unknownRoute()" />
      </div>
      <HomePage v-else-if="route.name === 'home'" key="home" />
      <EditorPage
        v-else-if="route.name === 'editor'"
        :key="`editor:${route.cardId}`"
        :card-id="route.cardId"
      />
      <EditorPage
        v-else-if="route.name === 'saveEditor'"
        :key="`save-editor:${route.saveId}`"
        :save-id="route.saveId"
      />
      <PlayPage
        v-else-if="route.name === 'play'"
        :key="`play:${route.cardId}:${route.saveId}`"
        :card-id="route.cardId"
        :save-id="route.saveId"
      />
      <SettingsPage v-else-if="route.name === 'settings'" key="settings" />
    </template>
  </div>
</template>
