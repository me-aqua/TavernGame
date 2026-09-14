<script setup lang="ts">
/**
 * 顶栏：品牌 + 连接状态灯 + 存档操作 + 设置入口。
 *
 * 注意：这里**没有任何 innerHTML**。原来顶栏状态是用
 * \`el.statusText.textContent = ...\` 手工改 DOM，
 * 现在只是一个 prop —— 状态变了模板自己更新。
 */
defineProps<{
  /** 状态灯 */
  light: 'ok' | 'warn' | 'err'
  /** 状态栏文字，例如「DeepSeek 官方 · deepseek-chat」 */
  statusText: string
}>()

defineEmits<{
  export: []
  import: []
  reset: []
  settings: []
}>()
</script>

<template>
  <header>
    <span class="logo">TAVERNGAME</span>
    <span class="status">
      <span class="light" :class="light"></span>
      <span>{{ statusText }}</span>
    </span>
    <span class="spacer"></span>
    <button class="ghost" title="导出存档文件" @click="$emit('export')">导出存档</button>
    <button class="ghost" title="从文件导入存档" @click="$emit('import')">导入</button>
    <button class="ghost" title="重新开始" @click="$emit('reset')">重来</button>
    <button @click="$emit('settings')">⚙ 设置</button>
  </header>
</template>

<style scoped>
header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
  flex-shrink: 0;
}

.logo { font-weight: 700; letter-spacing: 0.08em; font-size: 13.5px; color: var(--accent); }

.status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dim); }

.light { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); transition: background 0.3s; }
.light.ok   { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
.light.warn { background: var(--warn);   box-shadow: 0 0 8px var(--warn); }
.light.err  { background: var(--danger); box-shadow: 0 0 8px var(--danger); }

.spacer { margin-left: auto; }
</style>
