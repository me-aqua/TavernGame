import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { promptsPlugin } from './vite-plugins/prompts.ts'

/**
 * ⚠️ base 必须是 '/TavernGame/'。
 *
 * GitHub Pages 把站点部署在 https://me-aqua.github.io/TavernGame/ 这个**子目录**下。
 * 如果 base 保持默认的 '/'，构建产物里的资源引用会指向域名根（/assets/xxx.js），
 * 线上就会 404 —— 这是本项目历史上踩过的同一个坑
 * （AGENTS.md「资源引用只能用相对路径」）。
 */
export default defineConfig({
  base: '/TavernGame/',
  // promptsPlugin：把 prompts/*.md 转成 base64 虚拟模块（构建期转换，无中间文件）
  plugins: [vue(), tailwindcss(), promptsPlugin()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    // ⚠️ host 必须写成 'localhost'：Vite 8 默认只绑 IPv6 的 [::1]，
    //    于是 http://127.0.0.1:3000 会连不上（curl 返回 000）。
    //    写 'localhost' 后 IPv4 / IPv6 都能访问。
    host: 'localhost',
    port: 3000,
    strictPort: true,
  },
})
