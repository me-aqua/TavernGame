/**
 * v2 入口：建存储、挂 App、设标题。
 *
 * 主题与设置的读取在 `App.vue` 里（读坏了也要能看见错误页，而不是白屏）；
 * 这里只负责把「浏览器 localStorage」这一份实例交给应用（core 层不碰全局）。
 */
import { createApp } from 'vue'
import App from './App.vue'
import { provideStorage } from './app-context'
import { createStorage } from './core/storage'
import { t } from './i18n'
import './styles/main.css'

provideStorage(createStorage(localStorage))
document.title = t('app.title')

createApp(App).mount('#app')
