---
name: ui-testing
description: 自动化 UI 测试——四层结构（单元 / 组件故事 / 功能冒烟 / 整页截图）、Storybook 与 Playwright 各自管什么、结构判据与像素基线怎么用，以及踩过的坑（跑到旧产物、结构检查自己假阳性、弱断言）。
whenToUse: 改界面、加组件、调布局或文案；或需要判断「这次 UI 改坏没有」时。
---

# 自动化 UI 测试

## 四层，别串层

| 层 | 工具 | 管什么 | 命令 |
| --- | --- | --- | --- |
| 单元 / 组件 | vitest + @vue/test-utils | 纯逻辑、props 契约（node/jsdom，秒级） | `npm test` |
| 组件故事 | Storybook 当工作台，Playwright 当相机与断言 | 每个组件 × 每个状态 × {浅,深} × {中,英} | `npm run stories` |
| 功能冒烟 | Playwright | 玩家点得出来的路径：设置、语言、主题、坏存档、跑一个回合、模型报错 | `npm run e2e` |
| 整页截图 | Playwright | 10 个状态 × 5 种屏幕：结构检查 + 少量像素基线 | `npm run visual` |

`npm run verify` 只包含前两层 + 冒烟；整页矩阵与故事巡检单独跑（慢、要浏览器）。
提交时 pre-commit 会提醒：**改了哪一层就跑哪一层**（整页动过 → `visual`；只动组件 → `stories -g "<组件名>"`）。

## 结构判据（客观，不需要基线）

只有四条，写在 `e2e/probe.ts`，**组件故事与整页矩阵共用同一份**（两份阈值必然走偏）：

1. 横向溢出 `scrollWidth - innerWidth ≤ 1`
2. 元素伸出视口左右边界
3. 点按目标 < 24×24（WCAG 2.5.8 的最小尺寸）
   —— ⚠️ **句子里的行内链接有例外**（`display: inline` 跳过），否则画布上的说明链接会误报
4. **正文不许被悬浮控件压住**（`.line` / `.trace` 与 aside、设置、调试、输入卡片求相交）

⚠️ 第 4 条要先**按滚动容器裁剪**再判相交：滚出容器的部分在几何上仍有坐标，
不裁剪会把「正常滚出去的正文」全报成遮挡（第一次跑就报了 7 处假阳性）。

## 像素基线（只给 8 张）

- 只对稳定、看过的整页画面建基线：`playing-zh/en × phone/laptop`、`long-story`、`debug-on`、`drawer-open`、`dark`。**组件故事不建基线**（改动频繁，会变成天天刷的噪音）。
- 基线进仓库（约 650KB），文件名带平台后缀（`-darwin`）：换平台要么重录，要么让 CI 跳过。
- 刷新要显式：`npx playwright test e2e/visual.spec.ts --update-snapshots`。
- 新内容进来自动滚到底的状态（`long-story`）要显式 `scrollTo` 再拍，否则拍到的是顶部。

## 假模型：`page.route`，不是注入脚本

`e2e/fixtures.ts` 的 `fakeLlm(page, mode)` 拦住 `**/chat/completions`：
`narration`（正常）/ `slow`（看得见「正在生成」）/ `error`（上游 500）/ `tools`（先调工具再写叙事）。
不用「注入脚本替换 window.fetch」：那条路踩过「注册顺序错了就静默不生效」，也没法按用例控制延迟。

## Storybook

- `storybook@10` + `@storybook/vue3-vite`（支持 Vite 8），addons：`a11y`、`themes`。
- **不用 `@storybook/addon-vitest`**：它要求 vitest 3/4，本项目在 vitest 5。断言与截图统一交给 Playwright（同一套判据、同一套基线机制，不引第二套快照格式）。
- 故事只声明「什么数据、什么状态」，**不写断言**；断言在 `e2e/stories.spec.ts`。
- 巡检的故事清单来自 `storybook-static/index.json`（构建产物），不在 spec 里再抄一份。
- 预览用 `e2e/static-server.ts`（二十行 Node http）：`vite preview` 会带上 `base: '/TavernGame/'` 前缀，把 Storybook 挂到错路径上。
- 深浅色用应用**同一套机制**（`<html>` 上的 `.dark`）与同一个 i18n 实例（`.storybook/preview.ts`），别造第二套主题。
- 故意什么都不渲染的故事（例如「关闭时的面板」）给它一个空背景容器，否则可见性断言会超时。

## 看图的习惯（这一步不能省）

巡检会生成两张总览页：`artifacts/screenshots/index.html`（状态 × 屏幕）与
`artifacts/stories/index.html`（组件故事）。**改完 UI 要真的看图** ——
结构检查只保证「没溢出、没被压住、点得到」，保证不了好不好看、够不够沉浸。
用户明确要求过这件事，pre-commit 的提醒就是为它设的。

## 踩过的坑

1. **跑到旧产物**：`playwright.config.ts` 里 `reuseExistingServer` 为真，之前跑剩的 preview 服务会被复用，`npm run build` 不重跑 → 浏览器里是旧代码。
   症状：改完 UI 再看图，跟没改一样；`--update-snapshots` 之后基线文件 **mtime/sha256 不变**（内容相同就不重写）。
   修法：`rm -rf e2e/visual.spec.ts-snapshots` 再录，或先杀掉 4174 端口上的服务。
2. **弱断言**：位置类断言只判「元素在左半屏/右半屏」拦不住「按钮跑到屏幕正中」（旧布局也满足）。
   要判**贴边距离**（右边缘距视口右侧 < 40px）与**相邻关系**（间距 < 20px）。
3. **一行多个孩子的 `justify-between`** 会把中间那个推到正中 —— 想「靠右一组」就先把它们包进一个 flex 容器。
4. 结构检查缩小时会连累可访问性：调试胶囊一度只有 23px 高，被第 3 条判据当场拦下。
5. 截图稳定性：只对「有存档」的状态建基线（新开局取当前时间会抖）；`timezoneId` 固定、`reducedMotion: 'reduce'`。
