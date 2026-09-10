# AGENTS.md —— 项目环境备忘

> 这个文件写给 **AI 编码助手**看，也方便协作的人快速了解环境。
> 目标是：读一遍就能掌握全部上下文，不必反复试探。

## 🎯 项目现状

- **TavernGame** —— 一个用 **agent 循环**驱动的文字游戏，既能做卡也能玩卡
- 形态：**纯前端**。没有服务器、没有构建步骤、没有 npm 依赖
- 与酒馆的区别：酒馆是**轮次对话**，本项目是**回合制 agent 循环**
- 当前版本：**v0.5.1**（极简取向：全部工具砍到只剩时间引擎）
- 游戏地址：https://me-aqua.github.io/TavernGame/

### 开发路线

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 骨架 | ✅ |
| 2 | agent 循环 + 工具 + 状态 | ✅ |
| 3 | 架构转纯前端（移除服务器） | ✅ |
| 4 | **极简主义：工具砍到只剩时间引擎** | ✅ |
| 5 | 做卡系统（自定义角色与世界） | ⏳ 待做 |

## 🧠 核心设计（改动前必读）

**基调：极简。让模型专心写故事，别让它记账。**

早期版本有八种工具（属性、背包、NPC、剧情标记、掷骰……），
模型每回合要输出一堆 JSON 维护它们，注意力被从叙事上挤走了。
**现在只剩一个工具。**

### 唯一的工具：`advance_time`（时间引擎）

- 一天分三段：上午 / 下午 / 晚上，循环往复
- 存 `{ day, segment }`，由模型判断这一回合时间是否推进
- **参数**：`step`（数量）+ `unit`（`segment` 默认 / `day` / `week`）
  - 「等七天」→ `{step:1, unit:"week"}`；「睡了三天」→ `{step:3, unit:"day"}`
- **跨度没有上限** —— 「等了七天」「修养一个月」都是正常剧情
- 唯一保留的检查是**单向前进**（拒 0 和负数），**那是拦模型的错误输入，
  不是限制玩法** —— 曾经有过「最多 6 段」的上限，已按用户意见删除
- 另有防呆上限（一万天），只拦明显的手滑
- 天数较长时标签给大概说法：第 31 天 →「约 1 个月」

时间被选为唯一保留的工具，因为它是**最底层的引擎** ——
驱动节奏、事件、NPC 作息，而且只有一个状态，不需要「账本」。

### 引擎持有事实（仍然成立）

模型不能直接改数据，只能输出工具调用块（JSON），由 `core/tools.js` 执行。
`core/state.js` 里的 `advanceTime()` 会拦住非法推进。

### 叙事与成败由模型自己把握

**已删除 `roll_check`**（引擎掷骰）。成败完全由模型判断，
提示词要求它「不要总是成功，代价要具体」。

> 这是有意的取舍：优先保证「能写出好故事」，牺牲「防模型作弊」。
> 若将来要做严肃的规则系统，掷骰需要重新加回来。

### ⚠️ 不要改成各家 API 的原生 function calling。
当前用的是「文本协议 + JSON 代码块」，理由是：

1. 与供应商解耦 —— 换服务商不用改代码
2. 可调试 —— 模型想干什么，在界面上直接看得到

## 🔑 关键环境信息

| 项目 | 值 |
| --- | --- |
| 工作区 | `F:\SillyTavernX\TavernGame` |
| GitHub 账号 | `me-aqua` |
| 提交邮箱 | `74250100+me-aqua@users.noreply.github.com`（匿名邮箱，勿改） |
| 仓库地址 | https://github.com/me-aqua/TavernGame |
| 网站地址 | https://me-aqua.github.io/TavernGame/ |
| 默认分支 | `main` |
| GitHub CLI | `E:\Github\GitHubCLI\gh.exe`（已在用户 PATH 中） |
| 协作者 | `Alice-space`（Read 权限） |

## 🌐 代理（最容易踩的坑）

**本机必须通过代理访问外网**，代理地址：`http://127.0.0.1:7897`

已配好（无需重复配置）：

```bash
git config --global http.proxy    # = http://127.0.0.1:7897
git config --global https.proxy   # = http://127.0.0.1:7897
```

需要联网权限的命令：`git push/pull/fetch`、`gh ...`、`curl` 访问外网。

典型失败特征：

- `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`
- `[sandbox: file access denied under workspace-write mode]`

> ⚠️ `.NET` 的 `Invoke-RestMethod` / `Invoke-WebRequest` 即使加 `-Proxy`
> 也可能失败，**优先用 `curl.exe`**。

## 🚀 发布方式

GitHub Pages，从 `main` 分支**根目录**发布。入口是根目录的 `index.html`。

```bash
git add -A && git commit -m "..." && git push
# 约 30 秒后自动构建
gh api repos/me-aqua/TavernGame/pages/builds/latest --jq '.status'
```

## ⚠️ 必须记住的坑

### 1. 资源引用只能用相对路径

GitHub Pages 部署在 **`/TavernGame/` 子目录**下。

```html
✅ src="assets/mea-avatar.jpg"
❌ src="/assets/mea-avatar.jpg"     <!-- 会解析到域名根，404 -->
```

### 2. `.bat` 文件必须 CRLF

写文件工具默认生成 LF，会让批处理出错。`.gitattributes` 已固定 `*.bat` 为 CRLF，
但**新建 bat 后仍要检查**：无 BOM + CRLF。

### 3. Windows PowerShell 5.1 的限制

- 没有 `Start-Process -Environment`（那是 PS 7+）
- `$env:TEMP` 在沙箱里**每次调用都不同**，别用它存跨命令的状态
- `curl.exe` 连不上时错误会写进 **stderr**，`2>&1` 会污染变量；
  取状态码要 `2>$null` 再取末尾 3 字符
- `$PID` 是只读变量，别拿来当普通变量名

### 4. 验证要严谨，别制造假阳性

测试端口前**必须先确认端口是空的**，否则 200 可能来自旧进程。
这类「看起来通过、其实测错了」的结果比不测更危险。


### 5. 本地调试用 dev-server.js，不要拿线上页面调

```bash
npm run dev        # 或双击 start.bat
# http://localhost:3000/
```

它有两点比 `npx serve` 强：

- **禁用缓存**（`Cache-Control: no-store`）—— 改完刷新即生效，
  不会出现「代码改了但浏览器还在跑旧 JS」这种排查半天的假象
- 零依赖，不用等 npx 下载

> ⚠️ localStorage 按域名隔离：`localhost` 与 `me-aqua.github.io`
> 各存一份 API key，首次在本地调试要重新填一次。

线上（GitHub Pages）的缓存不受我们控制 —— 发布更新后，
用户可能需要硬刷新（Ctrl+Shift+R）才能拿到新 JS。


### 6. 排查界面问题时：先读代码对照，再动手测

踩过的坑：用户报告「点重来后故事区空白，按 F5 才有」，
结果花了很久用假 key 反复实测都没定位，最后**逐行对照事件处理**才发现 ——
`narration` 事件的处理函数里漏了 `append()`，只调了 `showThinking(false)`。

教训：
- **先梳理逻辑链、列出预测，再验证**。盲试的成本远高于读代码。
- 排查「渲染」问题时，定位手段要落在**实时 DOM**上；
  存档里有内容 ≠ 界面渲染了内容（这个 bug 正是如此）。
- 用假 key 测试只能验证**报错路径**，验证不了正常渲染路径。

### 7. 写提示词时：示例必须展示「正确的完整形态」

**这是本项目反复踩、最值得记住的一条。**

同一类错误犯了两次，都是「示例」和「文字说明」打架，
**而模型永远跟着示例走**：

| 我的示例 | 我的文字说明 | 模型实际学到的 |
| --- | --- | --- |
| `{"args": {"参数名": "值"}}` 占位符 | 「参数每一项都要填」 | **参数留空** → 所有工具调用都是 `{}` |
| 孤零零一个工具块 | 「工具块要附在叙事后面」 | **工具是单独一条消息** → 干脆不调用 |

**结论：示例是模型的行为模板，说明只是注释。**

写提示词时：
- 示例必须是**正确输出的完整形态**（叙事正文 + 末尾工具块），
  不能是简化片段或占位符
- 如果示例里出现工具块，它**前后必须有真实的叙事文字**
- 改完提示词**必须用真实 API 验证**，不能只看逻辑通不通

### 8. 修 bug 前先量清楚「到底哪里不一样」

踩过的坑：发现「刷新后故事块从 9 变成 5」，
立刻断定是「重复渲染」，改了两版（跳过 action、只恢复叙事），
结果**越改越错** —— 把玩家行动从屏幕上去掉了。

用 CDP 把 DOM 和日志**逐条打出来**才发现：
**9 块本来就是对的**（4 叙事 + 3 行动 + 2 系统），
我看到的「变少」是我自己的改动造成的，重复根本不存在。

教训：
- 「数字变了」≠「有 bug」，先查清**变化的内容具体是什么**
- 改之前先把**实际数据**（DOM 结构 / 日志条目）打出来看

## 🏷️ 版本管理约定

- 提交信息用约定式前缀：`feat` / `fix` / `docs` / `chore` / `refactor` / `style`
- 版本号遵循语义化版本，标签格式 `vX.Y.Z`
- **标签必须单独推送**：`git push origin v0.4.0`
- 每个版本同步更新 `CHANGELOG.md`

## 📁 目录结构

```
TavernGame/
├── index.html        游戏界面 —— 本体，Pages 入口就是它
├── about.html        项目介绍页（介绍定位与用法）
├── core/
│   ├── agent.js      agent 循环（灵魂）
│   ├── tools.js      工具定义、执行、解析
│   ├── state.js      世界状态、存档、导出导入
│   ├── llm.js        LLM 调用（含 CORS 失败提示）
│   ├── config.js     配置与服务商预设
│   └── prompts.js    提示词（改玩法主要改这里）
├── start.bat         Windows 本地启动脚本（调用 dev-server.js）
├── dev-server.js     本地调试服务器（禁用缓存，零依赖）
├── assets/           静态素材
├── package.json      仅用于本地开发（npm run dev）
├── README.md / CHANGELOG.md / AGENIA.md
├── AGENTS.md         本文件
└── AGENTS.local.md   个人偏好（git 忽略）
```

## 📌 实测过的事实（别重新踩）

- **CORS 实测结果**：DeepSeek 官方、硅基流动、OpenRouter、Mistral
  都返回 CORS 允许头，浏览器可直连；**Groq 不允许**。
- **agent 循环离线测试**：可以用 Node 伪造 `localStorage` + `fetch`
  来测试 `core/` 里的逻辑，不需要浏览器。测试脚本放 `.tools/`（已被忽略）。
  - 注意：伪造回复里含代码块时，**用数组拼字符串**，
    不要在模板字符串里写反引号（会截断字符串）。

## ⚠️ 素材版权提醒

`assets/mea-avatar.jpg` 来自神楽めあ官方 YouTube 频道（@KaguraMea），
仅作个人练习与非商业用途。若将来公开商业化，需替换为自有或已授权素材。

## 🤝 协作约定

个人的沟通偏好见 **`AGENTS.local.md`**（私人文件，不提交到仓库）。

项目层面的底线：

- 破坏性操作须先确认：重写历史、删仓库、强制推送
- 不要擅自扩大改动范围
