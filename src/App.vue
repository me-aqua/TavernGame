<script setup lang="ts">
/**
 * App.vue —— 应用外壳
 *
 * 这里承担原来 index.html 顶部那一段「启动逻辑」：
 *   恢复上次的叙事 → 有配置就开新游戏 / 继续，没配置就提示去设置。
 *
 * 它同时是唯一的「事件编排层」：子组件只 emit 意图，具体动作在这里做。
 */
import { computed, onMounted, ref, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import StoryPanel from './components/StoryPanel.vue'
import GameComposer from './components/GameComposer.vue'
import AppSidebar from './components/AppSidebar.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import { useGame } from './stores/game'
import { loadConfig, isConfigured, PRESETS } from './core/config'
import { downloadText, pickFile } from './composables/useDownload'

const {
  启动错误,
  时间标签, 时间线, 场景, 回合数,
  消息流, 正在跑, 调试模式,
  追加, 清空消息流, 恢复日志, 执行回合,
  重新开始, 导入存档, 导出存档, 打开存档文件,
} = useGame()

const 设置打开 = ref(false)
const 配置状态 = ref(isConfigured())
const 状态灯 = ref<'ok' | 'warn' | 'err'>('warn')
const 状态文字 = ref('检查配置…')

const 已配置 = computed(() => 配置状态.value)

/** 刷新顶栏状态灯。成功的回合要把报错时的红灯恢复回来 */
function 刷新配置状态() {
  const cfg = loadConfig()
  配置状态.value = isConfigured()
  if (!配置状态.value) {
    状态灯.value = 'warn'
    状态文字.value = '未配置'
    return
  }
  状态灯.value = 'ok'
  状态文字.value = `${PRESETS[cfg.provider]?.label || cfg.provider} · ${cfg.model}`
}

// 调试模式：在控制台执行 __DEBUG = true 即可打开（刷新后失效）
watch(调试模式, (on) => {
  追加('system', on ? '🔧 调试模式已开启 —— 之后会显示模型的原始输出' : '🔧 调试模式已关闭')
  window.__DEBUG = on
})
Object.defineProperty(window, '__DEBUG', {
  configurable: true,
  get: () => 调试模式.value,
  set: (v: boolean) => {
    调试模式.value = Boolean(v)
  },
})

// ---------- 动作 ----------

async function 提交行动(text: string) {
  if (!isConfigured()) {
    设置打开.value = true
    return
  }
  try {
    await 执行回合(text)
  } catch (err) {
    if ((err as Error).name !== 'AbortError') 状态灯.value = 'err'
  }
}

async function 开新游戏() {
  追加('system', '（正在生成开场…）')
  try {
    await 执行回合()
  } catch (err) {
    if ((err as Error).name !== 'AbortError') 状态灯.value = 'err'
  }
}

function 导出() {
  const 日期 = new Date().toISOString().slice(0, 10)
  downloadText(`taverngame-存档-${日期}.json`, 导出存档())
  追加('system', '存档已导出为文件')
}

async function 导入() {
  const file = await pickFile()
  if (!file) return
  try {
    导入存档(await file.text())
    追加('system', '存档已导入 ✓')
    恢复日志(12)
  } catch (err) {
    追加('error', `导入失败：${(err as Error).message}`)
  }
}

function 重来() {
  if (!confirm('确定要重新开始吗？当前进度会丢失（建议先导出存档）')) return
  重新开始()
  开新游戏()
}

function 设置已保存() {
  刷新配置状态()
  追加('system', '设置已保存 ✓')
  // 全新的游戏（没回合、没历史）时，保存配置后顺手把开场跑出来
  if (回合数.value === 0 && 消息流.value.length === 0 && !正在跑.value) 开新游戏()
}

// ---------- 启动 ----------

onMounted(() => {
  刷新配置状态()

  // 存档坏了要说清楚，不能装作无事发生（坏数据已另存一份备份）
   if (启动错误) {
    追加('error', `本地存档已损坏，本次从空白开始：\n${启动错误}\n\n原存档已备份到浏览器存储中（key 以 .broken- 开头），可在控制台导出。`)
     状态灯.value = 'err'
   }

  // 恢复上次的叙事日志：叙事与玩家行动都按日志顺序原样输出。
  // 刷新时界面是空的，所以不存在重复问题 —— 日志里每条都是唯一的。
  // system 类不恢复（本次加载会重新生成提示）。
  if (!启动错误) 恢复日志()

  if (isConfigured()) {
    if (回合数.value === 0) {
      开新游戏()
    } else {
      追加('system', `继续游戏（第 ${回合数.value} 回合）`)
    }
  } else {
    追加('system', '欢迎。请先点右上角「⚙ 设置」填入 API key。')
  }
})
</script>

<template>
  <AppHeader
    :light="状态灯"
    :status-text="状态文字"
    @export="导出"
    @import="导入"
    @reset="重来"
    @settings="设置打开 = true"
  />

  <div class="layout">
    <section class="main">
      <StoryPanel :lines="消息流" :thinking="正在跑" />
      <GameComposer :disabled="正在跑" :configured="已配置" @submit="提交行动" />
    </section>

    <AppSidebar
      :time-label="时间标签"
      :timeline="时间线"
      :scene="场景"
      :turn="回合数"
    />
  </div>

  <SettingsDrawer v-model:open="设置打开" @saved="设置已保存" />
</template>
