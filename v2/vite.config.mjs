/**
 * v2 应用的最小构建配置（SPEC §7）。
 *
 * 四件事：`root` 定在 `v2/`、挂在 `/TavernGame/v2/`、产物进 `dist/v2`、Vue 单文件组件交给
 * `@vitejs/plugin-vue`。
 *
 * 🔴 `root` 必须显式写成 `v2/`：不写的话 vite 用**命令行的 cwd** 当 root，
 *    在仓库根跑 `npm run v2:build` 会把**旧站**当入口构建（实测：它吐出了旧站的 dist，
 *    还因为旧站的虚拟模块插件没加载而报 `virtual:prompt/...`）。
 *    同理，`build.outDir` 是**相对 root** 解析的，所以 `'../dist/v2'` 正好落在仓库根的 `dist/v2`。
 *
 * 第 3 关可以往里加东西（别名、代理、构建选项），但 `root` / `base` / `build.outDir` 与
 * vue 插件不许去掉 —— e2e 的 webServer 与线上路径都认它们。
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  root: import.meta.dirname,
  base: '/TavernGame/v2/',
  plugins: [vue()],
  build: {
    outDir: '../dist/v2',
    // 产物目录在 root 之外，必须显式允许清空（否则 vite 会拒绝写）
    emptyOutDir: true,
  },
})
