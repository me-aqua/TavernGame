---
name: checks
description: 自动化检查体系——三道 git 钩子各跑什么、工具怎么配、以及踩过的坑（报错顺序、Buffer 空值、阈值校准）。
whenToUse: 改动钩子、配置 lint/format、或提交被拦下来需要判断「这是不是误报」时。
---

# 自动化检查体系

## 三层分工

| 钩子 | 时机 | 耗时 | 内容 |
| --- | --- | --- | --- |
| `pre-commit` | 每次提交 | ~5s | 密钥 → 换行/编码/BOM → 语法 → ASCII → 英文标识符 → 提示词未内联 → ESLint → 类型 + 单测（并行）→ Prettier |
| `pre-push` | 每次推送 | ~12s | 覆盖率门禁 → 构建 → e2e |
| `commit-msg` | 每次提交 | <1s | 约定式提交前缀 |

**为什么分层**：pre-commit 每次提交都跑，必须快；重活（覆盖率、构建、e2e）放 pre-push。
这样既不把坏东西推上去，也不让人等十几秒。

跳过：`SKIP_DISCIPLINE=1 git commit ...`（须在提交信息里说明理由）。

## 工具

| 工具 | 作用 | 配置 |
| --- | --- | --- |
| ESLint 10 | 抓真 bug（floating promise、未使用变量、类型感知规则） | `eslint.config.js` |
| Prettier 3 | 统一排版，**自动修好并重新暂存** | `.prettierrc.json` / `.prettierignore` |
| commitlint | 提交信息前缀 | `commitlint.config.js` |
| 自定义脚本 | `checks/` 下六个：密钥 `secrets.mjs`、语法 `syntax.mjs`、ASCII `ascii.mjs`、标识符 `identifiers.mjs`、提示词 `prompts.mjs` | `.githooks/checks/` |

一条命令：`npm run check`（typecheck + lint + format + 单测）；全量 `npm run verify`。

## 坑（都实测过）

### 1. 会改文件的检查必须放在最后

Prettier 块会 `process.exit(1)` 让开发者「再 commit 一次」。
它若排在前面，**已收集到的真正原因（例如密钥）永远打不出来** —— 只会看到
「Prettier 已格式化」。现在的规则：**发现问题就立刻报告并退出**，不继续做改文件的动作。

### 2. execSync 的 stdout/stderr 是 Buffer，且**空 Buffer 也是 truthy**

`String(err.stdout || err.stderr)` 会选到空 Buffer，把真正内容吞掉
（表现为「密钥报错变成空条目」）。必须显式解码再按长度挑：

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
