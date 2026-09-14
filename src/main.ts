/**
 * src/main.ts —— 应用入口
 *
 * Vite 从这里开始打包：挂载根组件、引入全局样式。
 * 原来的 index.html 是一个 714 行的单文件（HTML + CSS + JS 混在一起），
 * 现在拆成：main.ts（入口）+ App.vue（壳）+ components/（各区块）+ core/（游戏逻辑）。
 */

import { createApp } from 'vue'
import App from './App.vue'
import './styles/main.css'

createApp(App).mount('#app')
