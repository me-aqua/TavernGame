---
name: checks
description: 自动化检查体系——三层门禁（两道钩子 + CI）各跑什么、工具怎么配、以及踩过的坑（报错顺序、Buffer 空值、阈值校准）。
whenToUse: 改动钩子、配置 lint/format、或提交被拦下来需要判断「这是不是误报」时。
---

# 自动化检查体系

## 三层门禁

| 层 | 时机 | 耗时 | 内容 |
| --- | --- | --- | --- |
| `pre-commit` | 每次提交 | ~2s | 密钥 → 换行/编码/BOM → 语法 → ASCII → 英文标识符 → 提示词未内联 → 调试残留 → 吞错误 → 体积 → **解析模型输出** → ESLint → **相关单测** → Prettier |
| `pre-push` | 每次推送 | ~6s | 类型检查 → 全量单测 → 覆盖率门禁 → 构建 |
| `commit-msg` | 每次提交 | <1s | 约定式提交前缀 |
| CI（`.github/workflows/ui.yml`） | PR 与 push 到 main | 分钟级 | `npm run check` → 覆盖率门禁 → 构建 → e2e 冒烟 → 组件故事 → 整页结构巡检（截图当工件上传） |

**为什么分层**：pre-commit 每次提交都跑，必须秒级 —— 所以它只留**代码与文本层**，
类型检查与全量单测交给 pre-push（仍是秒级）。浏览器那一侧单机一次几十秒
（e2e ~10s、stories ~19s、visual ~50s），搬去 CI：不占开发者的等待时间，换台机器也照样跑。

**相关单测不是门禁**（`vitest related <暂存文件>`）：只有暂存了 `src/` 或 `tests/` 才跑，
只覆盖被这些文件牵连到的用例，而且按**工作区**内容跑。没被任何测试引用的新模块由
「新增源码必须配测试」拦，全量口径由 pre-push 兜底。没用 `vitest --changed` 的原因：
它按工作区与 HEAD 的差异算，会把**没暂存的**旁人改动一并算进来（实测多跑了 4 个文件）。

**重活怎么防漏**：CI 是新的强制点，但它**只有分支保护要求它通过时才真拦得住** ——
`main` 目前没有开保护（见 release skill），也就是说现在仍可绕过 CI 直推 main。
要不要开保护是**需要用户拍板**的事（开了之后 me-aqua 自己也不能直推 main）。

**像素基线在 CI 上**：CI 跑整页巡检用 `npx playwright test e2e/visual.spec.ts --ignore-snapshots`
—— 结构判据照跑，像素基线不比。8 张基线是 macOS 录的（文件名带 `-darwin`），
Linux 的字体渲染必然不同；基线必须有人看过再重录，所以留本机维护，CI 把截图与两张
总览页当工件传上来给人看。

跳过：`SKIP_DISCIPLINE=1 git commit ...` / `SKIP_DISCIPLINE=1 git push ...`
（须在提交信息里说明理由）。

## 工具

| 工具 | 作用 | 配置 |
| --- | --- | --- |
| ESLint 10 | 抓真 bug（floating promise、未使用变量、类型感知规则） | `eslint.config.js` |
| Prettier 3 | 统一排版，**自动修好并重新暂存** | `.prettierrc.json` / `.prettierignore` |
| commitlint | 提交信息前缀 | `commitlint.config.js` |
| 自定义脚本 | `checks/` 下六个：密钥 `secrets.mjs`、语法 `syntax.mjs`、ASCII `ascii.mjs`、标识符 `identifiers.mjs`、提示词 `prompts.mjs` | `.githooks/checks/` |

一条命令：`npm run check`（typecheck + lint + format + 单测）；本地全量 `npm run verify`
（再加快照覆盖率与 e2e）；CI 跑的就是这些 + 组件故事 + 整页结构巡检。

## 坑（都实测过）

### 1. 会改文件的检查必须放在最后

Prettier 块会 `process.exit(1)` 让开发者「再 commit 一次」。
它若排在前面，**已收集到的真正原因（例如密钥）永远打不出来** —— 只会看到
「Prettier 已格式化」。现在的规则：**发现问题就立刻报告并退出**，不继续做改文件的动作。

### 2. execSync 的 stdout/stderr 是 Buffer，且**空 Buffer 也是 truthy**

`String(err.stdout || err.stderr)` 会选到空 Buffer，把真正内容吞掉
（表现为「密钥报错变成空条目」）。pre-push 一度写的是 `String(err.stdout || err.message)`，
同一个坑：任务失败时只打印一个空条目，看不到真正的报错。必须显式解码再按长度挑：

```js
const 读输出 = (err) => {
  const 解码 = (v) => (Buffer.isBuffer(v) ? v.toString('utf8') : String(v ?? ''))
  return (解码(err.stdout) || 解码(err.stderr) || 解码(err.message)).trim()
}
```

### 3. 「检查代码」的脚本要区分注释与字符串

`ascii.mjs` 要求代码骨架全 ASCII，但注释里的中文必须放过 —— 于是它扫描的是
「去掉注释、保留字符串」的骨架。两个实测过的坑：

- **块注释必须保留偏移**：直接把整个 `/* … */` 吃掉会让后面的行号整体前移，
  报出来的位置是错的。现在是把注释内容替换成等量空格/换行。
- **`.vue` 里的 HTML 注释要单独处理**：`-->` 里的 `--` 会被后续扫描当成代码，
  甚至让一个 `/* */` 错误配对，把很远的行也算进注释（实测报错行号偏了 12 行）。

**它查哪些文件**：`ts/tsx/vue/css/html/js/mjs/cjs`。放行区四类 —— `src/locales/`（文案的家）、
`public/*.html`（内容不是代码）、`e2e/` 与 `*.stories.ts`（假数据与失败信息）、
`.githooks/` · `tools/` · `.storybook/`（开发者工具与工作台的输出）。
⚠️ 这份清单跟着目录结构走：新开一个 dev-only 目录就把它加进去，否则要么突然被拦，
要么反过来 —— 把产品代码放进放行目录就绕过了检查（`pre-commit` 的 BOUNDARY 正则同理）。
实测过的教训：`.js/.mjs` 一度不在名单里，于是 pre-commit 每次把这些文件递给它、
它却静默跳过 —— **静默失效的检查和通过的检查长得一模一样**，直到有人全库跑一遍才发现。

### 4. 体积阈值要跟着格式化器校准

Prettier 会把模板属性拆行，同语义代码行数上升
（`SettingsDrawer.vue` 201 → 278）。**这不是代码变臃肿**，上限按新基线调整即可，
但要在提交信息里说明，别偷偷放宽。

### 5. 全角空格是故意的

中文排版里的 U+3000 首行缩进不是脏字符，所以 `no-irregular-whitespace` 关掉了。
但**别在自己写的注释里混入 U+3000** —— 我的配置文件就被自己这条规则抓过一次
（后来关规则才不报）。

### 6. 钩子自己也要能被 lint

`.githooks/**` 需要 node 全局变量（`process`/`console`/`Buffer`），
已在 `eslint.config.js` 里配好；`.githooks/commit-msg` 等无扩展名脚本
加入了 `.prettierignore` —— **绝不能自动格式化钩子自身**，
在提交中途改动钩子会让本次提交行为不可预测。
