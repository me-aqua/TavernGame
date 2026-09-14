/**
 * Application entry point.
 *
 * Vite starts bundling here: install i18n, mount the root component,
 * pull in global styles.
 *
 * ⚠️ `src/locales/*.json` is the only place Chinese is allowed in code;
 * everything else is ASCII (enforced by .githooks/checks/ascii.mjs).
 */
import { createApp } from 'vue'
import App from './App.vue'
import { i18n } from './i18n'
import './styles/main.css'

createApp(App).use(i18n).mount('#app')
