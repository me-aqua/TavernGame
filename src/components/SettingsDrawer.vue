<script setup lang="ts">
/**
 * 设置面板：服务商 / API key / 接口地址 / 模型 / 步数上限。
 *
 * 相比原来的实现，这里少了一处 XSS 隐患：
 * 原来「当前 key」那行是拼接字符串后塞进 innerHTML 的，
 * 现在只是模板里的 {{ }}，自动转义。
 */
import { computed, ref, watch } from 'vue'
import { PRESETS, loadConfig, saveConfig, clearConfig, maskKey } from '../core/config'
import { testConnection } from '../core/llm'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [v: boolean]; saved: [] }>()

const 服务商 = ref('deepseek')
const 密钥 = ref('')
const 地址 = ref('')
const 模型 = ref('')
const 步数 = ref(8)

const 测试结果 = ref('')
const 测试状态 = ref<'' | 'ok' | 'bad'>('')
const 测试中 = ref(false)

/** 当前服务商预设。服务商可能被配置填成不存在的值，所以这里要能返回 undefined */
const 当前预设 = computed(() => PRESETS[服务商.value])

/** 面板打开时，从 localStorage 读一次最新配置填进表单 */
watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) return
    const cfg = loadConfig()
    服务商.value = cfg.provider
    密钥.value = cfg.apiKey
    地址.value = cfg.apiBase
    模型.value = cfg.model
    步数.value = cfg.maxAgentSteps
    测试结果.value = ''
    测试状态.value = ''
    同步服务商字段()
  },
  { immediate: true },
)

/** 接口地址 / 模型如果还是**任何**一个预设的默认值，切换服务商时就自动替换 */
function 同步服务商字段() {
  const p = 当前预设.value
  if (!p) return
  const 是旧默认 = (v: string) => Object.values(PRESETS).some((x) => x.apiBase === v)
  const 是旧模型 = (v: string) => Object.values(PRESETS).some((x) => x.models?.includes(v))
  if (!地址.value.trim() || 是旧默认(地址.value.trim())) 地址.value = p.apiBase
  if (!模型.value.trim() || 是旧模型(模型.value.trim())) 模型.value = p.models?.[0] ?? ''
}

const 直连说明 = computed(() => {
  const c = 当前预设.value?.corsOk
  if (c === false) return '⚠️ 该服务商实测不允许浏览器直连（CORS），用不了'
  if (c === true) return '✅ 实测支持浏览器直连'
  return '未实测，可能需要代理'
})

function 保存() {
  saveConfig({
    provider: 服务商.value,
    apiKey: 密钥.value.trim(),
    apiBase: 地址.value.trim(),
    model: 模型.value.trim(),
    maxAgentSteps: Number(步数.value),
  })
  emit('update:open', false)
  emit('saved')
}

async function 测试连接() {
  // 先用表单里的值试，不必先保存
  saveConfig({
    provider: 服务商.value,
    apiKey: 密钥.value.trim(),
    apiBase: 地址.value.trim(),
    model: 模型.value.trim(),
  })
  测试中.value = true
  测试状态.value = ''
  测试结果.value = '测试中…'
  try {
    const r = await testConnection()
    测试状态.value = 'ok'
    测试结果.value = `✅ 连接成功（${r.ms}ms）· 回复：${r.reply}`
  } catch (err) {
    // 边界：这是「测试连接」按钮，失败本身就是结果 —— 显示给用户，不是吞掉
    测试状态.value = 'bad'
    测试结果.value = `❌ 失败\n${(err as Error).message}`
  } finally {
    测试中.value = false
    // 测试连接会把配置写进 localStorage，顶栏状态要跟着刷新
    emit('saved')
  }
}

function 清除密钥() {
  if (!confirm('清除浏览器里保存的 API key？')) return
  clearConfig()
  密钥.value = ''
  测试状态.value = ''
  测试结果.value = '已清除'
  emit('saved')
}
</script>

<template>
  <div v-if="open" class="drawer" @click.self="emit('update:open', false)">
    <div class="sheet">
      <h2>设置</h2>
      <p class="sub">
        纯前端运行 —— 你的 API key 只保存在<b>你自己的浏览器</b>里，
        不会上传到任何服务器。请求直接从浏览器发往服务商。
      </p>

      <div class="field">
        <label>服务商</label>
        <select v-model="服务商" @change="同步服务商字段">
          <option v-for="(v, k) in PRESETS" :key="k" :value="k">{{ v.label }}</option>
        </select>
        <div class="note">{{ 直连说明 }}</div>
      </div>

      <div class="field">
        <label>API Key</label>
        <input
          v-model="密钥"
          type="password"
          placeholder="sk-..."
          autocomplete="off"
          :disabled="当前预设?.noKey"
        />
        <div class="note">
          <template v-if="当前预设?.noKey">这个服务不需要 key</template>
          <template v-else>
            <a v-if="当前预设?.keyUrl" :href="当前预设.keyUrl" target="_blank" rel="noopener">
              在这里获取：{{ 当前预设.keyUrl }}
            </a>
          </template>
          <br />当前：{{ maskKey(loadConfig().apiKey) }}
        </div>
      </div>

      <div class="field">
        <label>接口地址（Base URL）</label>
        <input v-model="地址" type="text" placeholder="https://api.deepseek.com" autocomplete="off" />
      </div>

      <div class="field">
        <label>模型</label>
        <input v-model="模型" type="text" list="model-list" autocomplete="off" />
        <datalist id="model-list">
          <option v-for="m in 当前预设?.models ?? []" :key="m" :value="m"></option>
        </datalist>
      </div>

      <div class="field">
        <label>每回合最多思考步数：{{ 步数 }}</label>
        <input v-model.number="步数" type="range" min="1" max="20" style="width: 100%" />
        <div class="note">防止模型陷入循环把额度烧光。</div>
      </div>

      <div class="sheet-actions">
        <button :disabled="测试中" @click="测试连接">测试连接</button>
        <button class="primary" @click="保存">保存</button>
        <button class="ghost right" @click="清除密钥">清除密钥</button>
      </div>

      <div v-if="测试结果" class="result" :class="测试状态">{{ 测试结果 }}</div>
    </div>
  </div>
</template>

<style scoped>
.drawer {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(5, 7, 14, 0.72);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.sheet {
  width: 100%;
  max-width: 520px;
  max-height: 88vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--panel);
  padding: 24px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.5);
}
.sheet h2 {
  margin: 0 0 6px;
  font-size: 17px;
}
.sheet .sub {
  margin: 0 0 20px;
  font-size: 13px;
  color: var(--dim);
  line-height: 1.7;
}

.field {
  margin-bottom: 15px;
}
.field label {
  display: block;
  margin-bottom: 6px;
  font-size: 12.5px;
  color: var(--dim);
}
.field input,
.field select {
  width: 100%;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text);
  font-family: inherit;
  font-size: 13.5px;
  outline: none;
}
.field input:focus,
.field select:focus {
  border-color: rgba(110, 231, 183, 0.5);
}
.field .note {
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--faint);
  line-height: 1.6;
}
.field .note a {
  color: var(--accent2);
}

.sheet-actions {
  display: flex;
  gap: 9px;
  margin-top: 20px;
  flex-wrap: wrap;
}
.sheet-actions .right {
  margin-left: auto;
}

.result {
  margin-top: 14px;
  padding: 11px 13px;
  border-radius: 9px;
  font-size: 13px;
  line-height: 1.7;
}
.result.ok {
  background: rgba(110, 231, 183, 0.1);
  border: 1px solid rgba(110, 231, 183, 0.3);
  color: var(--accent);
}
.result.bad {
  background: rgba(248, 113, 113, 0.1);
  border: 1px solid rgba(248, 113, 113, 0.3);
  color: #f0a5a5;
  white-space: pre-wrap;
}
</style>
