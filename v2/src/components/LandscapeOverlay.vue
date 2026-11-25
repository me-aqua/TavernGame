<script setup lang="ts">
/**
 * 手机竖屏遮罩（SPEC §6）：竖屏时**整页只给这一层**，按钮尝试锁定横屏。
 *
 * 「只给这一层」不是偷懒：手机竖屏下应用布局本来就不成立（最小档 1280×720），
 * 与其把挤扁的界面塞给人看，不如把屏幕让给这一句提示 —— 顺带也保证竖屏下不横向溢出。
 *
 * 锁定失败是**正常结果**（浏览器普遍要求全屏 / 用户手势），所以给一句中文提示让人手动转，
 * 而不是把异常吞掉当没点过。
 */
import { ref } from 'vue'
import { t } from '../i18n'

const hint = ref(false)

async function tryLock(): Promise<void> {
  const orientation = screen.orientation as ScreenOrientation & { lock?: (mode: string) => Promise<void> }
  if (typeof orientation.lock !== 'function') {
    hint.value = true
    return
  }
  try {
    await orientation.lock('landscape')
  } catch (cause) {
    hint.value = true
    console.warn('[v2] orientation.lock failed', cause)
  }
}
</script>

<template>
  <div class="overlay" data-landscape-overlay>
    <div class="overlay-card">
      <div class="overlay-title">{{ t('landscape.title') }}</div>
      <button type="button" data-landscape-retry @click="tryLock">{{ t('landscape.retry') }}</button>
      <div v-if="hint" class="overlay-hint" data-landscape-hint>{{ t('landscape.hint') }}</div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: var(--bg);
  color: var(--ink);
  z-index: 30;
}

.overlay-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  width: 100%;
  max-width: 320px;
  padding: 18px 14px;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: var(--panel);
  text-align: center;
}

.overlay-title {
  font-size: var(--fs1);
  font-weight: 600;
}

.overlay-hint {
  font-size: var(--fs3);
  color: var(--ink-soft);
}
</style>
