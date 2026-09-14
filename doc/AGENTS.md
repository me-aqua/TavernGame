# AGENTS.md —— 项目环境备忘

> 读一遍就能掌握全部上下文，不必反复试探。

## 🎯 项目现状

- **TavernGame** —— 一个用 **agent 循环**驱动的文字游戏，既能做卡也能玩卡
- 形态：**纯前端**。没有服务器；但有构建步骤（Vite），源码是 **TypeScript**
- 技术栈：**Vue 3.5 + Vite 8 + TypeScript 5.9**（2026-09-14 从「原生 JS 单文件」迁移）
- 与酒馆的区别：酒馆是**轮次对话**，本项目是**回合制 agent 循环**
- 当前版本：**v0.6.0**（架构重构：Vue + TS，游戏行为零变更）
- 游戏地址：https://me-aqua.github.io/TavernGame/

### 开发路线

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 骨架 | ✅ |
| 2 | agent 循环 + 工具 + 状态 | ✅ |
| 3 | 架构转纯前端（移除服务器） | ✅ |
| 4 | **极简主义：工具砍到只剩时间引擎** | ✅ |
| 5 | 做卡系统（自定义角色与世界） | ⏳ 待做 |

## 📋 待办

### README 的定位与重写（用户 2026-09-11 明确要求）

**README 面向玩家，不面向开发者。** 玩家只需知道「这个游戏有时间系统」，
**具体怎么执行的他玩两下就知道了** —— 不必在 README 里讲实现。
要讲玩法细节的话，将来单独写一份**玩家指南**，不塞进 README。

**实测出的过时内容**（5 处，全在 25–49 行）：

| 行 | 现在写的 | 实际 |
| --- | --- | --- |
| 27–30 | 「早期有八种工具…现在只剩一个工具」 | 开发史/实现细节，不该出现在玩家文档里 |
| 32–35 | 「引擎持有并保护唯一结构化状态」 | 同上 |
| 39 | 「一天分三段：上午 → 下午 → 晚上，循环往复」 | 时间已是现实公历；三段只是显示近似 |
| 42 | 「拒绝一次推超过 6 段」 | **这个限制 v0.5.1 就删了**，跨度无上限 |
| 43 | 「界面上会显示『第几天 · 什么时段』」 | 现在显示公历日期（2026 年 9 月 10 日 · 星期四 · 晚上） |

**改法**：25–49 行整段重写，压到两三句话说明「有时间系统、会随行动推进」即可；
其余章节（开玩方式、服务商、存档、本地运行）与现状一致，**不用动**。

> ✅ **已完成（v0.5.4）**：README 已按上述原则重写，−56 行。

### 独立审查后仍未修的缺陷（v0.5.4 记录）

发布 v0.5.4 前请了一个独立审查员重读全部代码，它找出 2 高 / 5 中 / 12 低。
**高危与大部分中危已修**（详见 `CHANGELOG.md` 的「加固」小节），剩余这些没修：

| # | 位置 | 问题 | 备注 |
| --- | --- | --- | --- |
| 1 | `src/core/agent.ts` + `src/stores/game.ts` | **失败/取消路径的内存与存档分叉**：回合开头就 `addLog(action)`、工具直接改 `time.iso`，但 `save()` 在末尾。点「停止」或接口报错时侧栏时间已跳、行动已进内存 log，F5 又回退；之后下一次成功回合的 `save()` 会把「被取消的行动 + 已推进的时间 + 无对应剧情」一起持久化 | 修法需要回滚机制，要设计，不是一行 |
| 2 | `src/core/agent.ts` | 步数上限误报：`steps >= maxSteps && toolResults.length` —— 恰好用完步数但自然结束时，玩家仍看到「⚠ 达到步数上限」 | 需要一个「因耗尽而退出」的标志位 |
| 3 | `src/core/calendar.ts` | `describeElapsed` 在 ≥1 天时**丢掉小时**（47 小时 →「过去了 1 天」）；跨夏令时地区还会更怪（`+1 day` 跨 DST 只有 23 小时 → 说成「23 小时」） | 中国无 DST，属地区相关 |
| 4 | `src/core/calendar.ts` | `month` 单位**月末溢出**：1 月 31 日 + 1 个月 = 3 月 3 日（整个 2 月被跳过），而回传文案写「过去了 1 个月 1 天」。文件头的注释还把这条列为「Date 永远精确」的例子 | 属**语义/注释**问题：要么注释改成"向上溢出"，要么在 `advance` 里对月末做 clamp |
| 6 | ~~`index.html`~~ **已修** | `URL.revokeObjectURL` 紧跟 `a.click()` —— Chromium 正常，但部分浏览器可能在下载启动前释放 blob | 惯例是放进 `setTimeout`；**不确定**是否真会出问题 |

### ⚖️ 设计决定（**不要当 bug 改掉**）

- **时间线只渲染起点（`from`）不渲染终点** —— 这是用户明确要求的设计：
  终点已经在上方大字「时间」里，重复显示没意义，且看不出「从什么时候起发生了什么」。
  独立审查员把它报成了缺陷（它不知道这个前提），**已驳回**。

### 已验证正常（别重复怀疑）

- **XSS**：模型输出与玩家输入全部经过 `textContent` 或 `escapeHtml`，
  未发现可利用的注入点。唯一未转义的动态串是「API key 打码」那行 ——
  只有自己填含 `<` / `"` 的 key 才触发，属自伤型。
- **资源泄漏**：无 `setInterval`、无 `MutationObserver`；
  事件监听都在模块加载时一次性注册；`AbortController` 无外部订阅。
- **`src/core/prompts.ts`**：示例与文字说明一致，「叙事正文 + 末尾工具块」的完整形态给对了。

## 🧠 核心设计（改动前必读）

> 📄 **另有一份 `DESIGN.md`** —— 记录**目标架构**（主 agent 分发 + 独立子 agent、
> 卡定义调用拓扑、中间状态只留关键时刻）与全部讨论推导。
> **当前代码只是"能跑通的最小验证"，不是终态。**
> 动手改架构前先读它 —— 那里明确区分了「已决定 / 待定 / 旧架构」。

**基调：极简。让模型专心写故事，别让它记账。**

早期版本有八种工具（属性、背包、NPC、剧情标记、掷骰……），
模型每回合要输出一堆 JSON 维护它们，注意力被从叙事上挤走了。
**现在只剩一个工具。**

### 唯一的工具：`advance_time`（时间引擎）

**时间是现实世界的公历**，起点 = 玩家点「开始」的那一刻。

- 状态里存**一个绝对时刻（ISO 字符串）**，不是「第几天第几段」
- 日期运算**全部交给 JavaScript 的 `Date`**，不手写除法 ——
  这样「1月31日+1个月」「闰年2月28日+1天」这类边界永远正确
- **参数**：`step`（数量）+ `unit`（`segment` 默认 / `hour` / `day` /
  `week` / `month` / `year`）
  - 「等七天」→ `{step:1, unit:"week"}`；「修养一个月」→ `{step:1, unit:"month"}`
- **跨度没有上限**；唯一保留的检查是**单向前进**（拒 0 和负数），
  那是拦模型的错误输入，不是限制玩法
- 显示成「2026 年 9 月 10 日 · 星期四 · 晚上」

时间被选为唯一保留的工具，因为它是**最底层的引擎** ——
驱动节奏、事件、NPC 作息，而且只有一个状态，不需要「账本」。

> ⚠️ **不要再加「奇幻历法」之类的预设。**
> 曾经写过一个 12 月 × 30 天的奇幻历，理由是「以后可能要用」，
> 结果没人会用、还多一份要维护的东西，已全部删除。
> 以后真要做自定义历法，那时再加 —— 不要提前预留。
> `src/core/calendar.ts` 是独立模块，届时加一个预设对象即可，引擎不用改。

### 引擎持有事实（仍然成立）

模型不能直接改数据，只能输出工具调用块（JSON），由 `src/core/tools.ts` 执行。
`src/core/state.ts` 里的 `advanceTime()` 会拦住非法推进。

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

**GitHub Pages + Actions 自动构建。**

⚠️ **仓库设置必须改成**：Settings → Pages → Source = **GitHub Actions**
（不再是 "Deploy from a branch"）。原因：重构后仓库根目录是**源码**
（Vue + TypeScript），浏览器不能直接跑，必须先由 Vite 构建出 `dist/`。

工作流见 `.github/workflows/deploy.yml`：push 到 `main` → `npm ci` → `npm run build`
→ 发布 `dist/`。所以**对使用者来说还是只要 push**：

```bash
git add -A && git commit -m "..." && git push
gh run list --limit 3                                  # 看构建结果
gh api repos/me-aqua/TavernGame/pages --jq '.html_url'
```

> 本地预览线上效果：`npm run build && npm run preview`
> （preview 也在 `/TavernGame/` 子路径下，不是根路径）

## ⚠️ 必须记住的坑

### 1. 资源引用只能用相对路径

GitHub Pages 部署在 **`/TavernGame/` 子目录**下。

```html
✅ src="mea-avatar.jpg"          <!-- public/ 里的资源，相对同级 -->
❌ src="/assets/mea-avatar.jpg"  <!-- 会解析到域名根，404 -->
```

构建产物里的 JS/CSS **由 Vite 按 `base` 自动加前缀**，不用手写；
这条规则只对 `public/` 里手写的 HTML（就一个 `about.html`）有效。

### 2. `.bat` 文件必须 CRLF

写文件工具默认生成 LF，会让批处理出错。`.gitattributes` 已固定 `*.bat` 为 CRLF，
但**新建 bat 后仍要检查**：无 BOM + CRLF。

### 3. Windows PowerShell 5.1 的限制

- 没有 `Start-Process -Environment`（那是 PS 7+）
- `$env:TEMP` 在沙箱里**每次调用都不同**，别用它存跨命令状态；
  需要跨命令的文件（临时脚本、浏览器 profile）放**工作区内的 `.tools/`**（已被忽略）
- `curl.exe` 连不上时错误会写进 **stderr**，`2>&1` 会污染变量；
  取状态码要 `2>$null` 再取末尾 3 字符
- `$PID` 是只读变量，别拿来当普通变量名

### 4. 验证要严谨，别制造假阳性

测试端口前**必须先确认端口是空的**，否则 200 可能来自旧进程。
这类「看起来通过、其实测错了」的结果比不测更危险。


### 5. 本地调试用 Vite dev server（dev-server.js 已删除）

```bash
npm run dev        # 或双击 start.bat
# ⚠️ 地址是 http://localhost:3000/TavernGame/  不是根路径！
```

三点必须记住：

- **URL 带 base 前缀**：`vite.config.ts` 里设了 `base: '/TavernGame/'`（为 GitHub Pages
  子目录部署），所以**开发地址也是** `/TavernGame/`。访问 `http://localhost:3000/` 会 404。
- **Vite 8 默认只绑 IPv6**：实测 `lsof` 显示监听在 `[::1]:3000`，
  于是 `curl http://127.0.0.1:3000` 返回 **000**（看起来像服务没起来，其实是绑定了 IPv6）。
  已在配置里固定 `host: 'localhost'`，IPv4 / IPv6 都能访问。
- **热更新（HMR）**：改源码保存后浏览器自动更新，比手动刷新更快。

> `public/` 下的文件（`about.html`、`mea-avatar.jpg`）**不受 HMR 管理** ——
> 它们是原样拷贝的静态资源，改了要手动刷新。

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
实际看到的「变少」是当次改动自己造成的，重复根本不存在。

教训：
- 「数字变了」≠「有 bug」，先查清**变化的内容具体是什么**
- 改之前先把**实际数据**（DOM 结构 / 日志条目）打出来看

## 🏷️ 版本管理约定

- 提交信息用约定式前缀：`feat` / `fix` / `docs` / `chore` / `refactor` / `style`
- 版本号遵循语义化版本，标签格式 `vX.Y.Z`
- **标签必须单独推送**：`git push origin v0.4.0`
- 每个版本同步更新 `CHANGELOG.md`

### ⚠️ 标签落后 HEAD 是**正常现象**，不是错误

标签（tag）钉死在**某一个提交**上，而 `main` 分支会一直往前长。
发布之后又做了纯文档修正（错字、措辞、README 调整），
**不需要再切一个新版次** —— 继续提交到 `main` 就行。

判断标准：

| 情况 | 要不要发新版本 |
| --- | --- |
| 改了游戏行为 / 修了 bug / 加了功能 | **要**（这正是版本号的意义） |
| 只改文档、注释、介绍页文案 | **不要**，直接提交 `main` |

否则版本号会膨胀成 `v0.5.47` 这样，用户反而看不出哪个版本重要。
主流项目都这样：最新 `main` 通常领先最新标签几百个提交。

> 想看当前标签是不是落后：`git describe --tags` 会输出
> `v0.5.4-1-ga18904f` —— 意思是「在 v0.5.4 之后又多了 1 个提交」。

### ⚠️ 沙箱里「启动子进程」会失败，报错还像别的问题（假警报）

两类**都能用同一套办法规避**的坑（2026-09-13 实测）：

| 看起来像 | 实际是 | 报错关键词 |
| --- | --- | --- |
| `node --check` 报「语法错误」 | 它 spawn 子进程被沙箱拒了 | `spawnSync ... EPERM` |
| `git push` 报凭证/管道错 | git 的 bash 子进程建不了命名管道 | `couldn't create signal pipe, Win32 error 5` |

**教训：报错信息会把人往错误方向带**（我因此误判过一次「index.html 有语法错误」）。

**校验内联 JS 的正确姿势**：用 `new Function()` 在**同进程**编译，
不要 spawn `node --check` —— 见 `.tools/check-inline.mjs`。

**验证「页面真的能跑」的正确姿势**：不是看 HTTP 200（那只说明文件送到了），
而是**用 CDP 连上页面读 DOM**（`story块数`、`配置状态` 这些真实运行时状态）。

**而且：沙箱里关不掉「自己起的服务」。** 2026-09-13 实测三种办法全失败：

| 办法 | 结果 |
| --- | --- |
| `Get-NetTCPConnection -LocalPort 3000` 找监听进程 | 返回空（看不到别的进程的连接） |
| `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` | 返回空（看不到进程） |
| `taskkill /F /IM node.exe` | `ERROR: Access denied` |

**所以别答应用户"我帮你把服务关掉"** —— 做不到。可以：
① 用 CDP 的 `/json/close/<id>` 关浏览器**标签页**（这个能行）；
② 进程本身让用户自己关，或者留着（dev-server 只占一个端口，无害）。

### 9. 发布流程：一次翻车记录（务必照做）

真实事故：安全检查失败时脚本执行了 `git reset`（清空暂存区），
但当时只修正了检查逻辑、**忘了重新 `git add`** →
提交失败 → HEAD 没动 → **标签打在了上一个提交上** →
远端出现「指向错误提交的 v0.5.2 标签 + 一个内容为空的 Release」。

**发布必须按这个顺序，每步都要验证：**

1. `git add -A` **然后确认 `git diff --cached --name-only` 非空**
2. `git commit -F <文件>`（提交信息用文件传，避免引号地狱）
3. **验证提交真的成功**：`git log -1 --format=%s` 看标题对不对
4. 确认 `git rev-parse --short HEAD` 变了
5. 才打标签：`git tag -a vX.Y.Z`
6. **核对标签指向**：`git rev-list -n 1 vX.Y.Z` 应等于 HEAD
7. `git push` + `git push origin vX.Y.Z`（**推送可能因代理抖动失败，要重试**）
8. 最后核对本地 HEAD 与 `origin/main` 一致

**另外：Shell 的安全检查模式别写太宽。**
已经踩了两次：
- `data/` 撞上 `data/.gitkeep`（那是要提交的占位文件）
- `*tools*` 撞上 `src/core/tools.ts`（那是游戏源码）

要匹配目录就写 `.tools/*`，要匹配文件就写全名。

### 10. 浏览器 CDP 调试：启动方式与两个障碍

**要调试页面、看实时 DOM，就照这个开**（试错了很多次才定下来）：

```powershell
$prof = 'F:\SillyTavernX\TavernGame\.tools\edge-profile'   # 独立 profile，别用 $env:TEMP
Start-Process 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' -ArgumentList @(
  '--remote-debugging-port=9222', "--user-data-dir=$prof",
  '--no-first-run', '--no-default-browser-check', '--no-sandbox',
  '--window-size=1440,960', '--new-window', 'http://localhost:3000/'
)
```

⚠️ Edge 的崩溃对话框**会直接弹到用户桌面上**，所以**绝不要按进程名批量杀 msedge**
（用户的浏览器窗口会一起没）。只清理带 `remote-debugging-port=9222` 的那个实例。

**两个障碍，缺一不可：**

| 障碍 | 症状 | 解法 |
| --- | --- | --- |
| Chromium 的多进程 IPC 被沙箱拒 | `mojo platform_channel 拒绝访问 (0x5)`，或无头模式直接崩 | 用 `danger-full-access` 跑；**并把浏览器进程放进持续运行的后台任务**（命令一结束，进程树会被回收） |
| 过程浏览器看不见 | 调试成了盲调 | 必须**可见窗口**（不要 headless），用户要能实时看到画面 |

**顺带澄清**：本机**没有独立安装 Chrome**，只有 Edge —— 但 Edge 就是 Chromium 内核
（152 版 Edge = Chromium 152），所以 `chrome_elf`、`v8_context_snapshot.bin` 这些
Chromium 组件都在 Edge 目录里，CDP 协议也通用。说「Chromium 跑不起来」=「Edge 跑不起来」。

**判断"浏览器还在不在"，只看这两个，别信进程枚举：**

| 手段 | 可靠性 |
| --- | --- |
| `curl http://127.0.0.1:9222/json/list` | ✅ 有响应 = 活着，还能看到当前是哪个页面 |
| `curl http://127.0.0.1:3000/` | ✅ 200 = dev-server 活着 |
| `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'"` | ❌ **沙箱里可能返回空**，即使浏览器正常运行 —— 会让人误判「窗口关了吧」 |

**别把 9222 和 3000 搞混**（用户会困惑）：3000 是网页地址，**用户看得到**（窗口地址栏）；
9222 是调试通道，**不是网页、没有界面**，只有 agent 用得上。
另外：CDP 的 `goto` 会把用户眼前的窗口导航走 —— 调试完记得切回
`http://localhost:3000/`，否则用户会以为窗口不见了。

### 11. `git push` 被沙箱挡住时

两个独立的障碍，配置文件里都要有：

```powershell
# 1) schannel: AcquireCredentialsHandle failed → 换 TLS 后端
git config --local http.sslBackend openssl

# 2) 认证：让 gh 当凭据助手，token 不进命令行、不进日志
git config --local credential."https://github.com".helper "E:\Github\GitHubCLI\gh.exe auth git-credential"
```

- 仍需 `danger-full-access`：git 的 bash 子进程**创建不了命名管道**，否则报
  `couldn't create signal pipe, Win32 error 5`
- 凭据助手会打印一行 `store: command not found` 的警告 —— **无害**，push 用的是 `get`
- **`gh` 能连 GitHub 而 `curl` 不能**：gh（Go）读 Windows 系统代理
  （`HKCU:\...\Internet Settings` 里 `ProxyEnable=1`），curl/git 不读，得显式 `-x`。
  所以**线上页面的内容验证不要依赖 curl**。

### 12. macOS 上的 CDP 调试（2026-09-14 迁移到 Mac 后实测）

**本机是 macOS，有 Google Chrome**（不是 Windows 的 Edge）：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --user-data-dir=/tmp/cdp-x \
  --remote-debugging-port=9333 about:blank
```

用 Node 自带 WebSocket 连 CDP 即可（**不需要 puppeteer**）：

1. `fetch('http://127.0.0.1:9333/json/list')` 拿 `webSocketDebuggerUrl`
2. 连上后发 `Page.navigate`，再 `Runtime.evaluate` 读 DOM

**两个踩过的坑（都会让你误判「页面是坏的」）：**

| 现象 | 真实原因 |
| --- | --- |
| 读到的卡片数 / 故事行数跟源文件一样，像没渲染 | 你连的是启动时的 **`about:blank` 标签页**，不是目标页。必须显式 `Page.navigate` |
| 页面报 `chrome-error://chromewebdata/` | CDP 已连上，但导航失败（地址错、服务没起来）。**先 curl 确认地址可达** |

另外：`--dump-dom` 不能用来验 Vue 页面 —— 它在脚本执行前就把 HTML 打出来了，
看到的是**未挂载的模板**（`{{ }}` 原样在），会误判成「Vue 没工作」。

> 而 `--input-type=module -e` 里 `import` 行会被**静态提升**、先于其他语句执行，
> 所以「先写文件、再 import 它」的写法在同一段里不成立。要用 CDP 走这条路。

## 📁 目录结构

```
TavernGame/
├── index.html            Vite 入口（只有 #app 与一行 script，别往里写东西）
├── package.json / package-lock.json
├── vite.config.ts        base /TavernGame/、别名 @、dev host+port
├── tsconfig.json         → 引用下面两个
├── tsconfig.app.json     应用代码（strict 全开）
├── tsconfig.node.json    构建脚本（vite.config.ts）
├── vitest.config.ts      测试配置
├── env.d.ts              全局类型（window.__DEBUG 等）
├── .github/workflows/
│   └── deploy.yml        push 到 main → 构建 → 发布 Pages
├── src/
│   ├── main.ts           入口：createApp(App).mount('#app')
│   ├── App.vue           外壳 + 事件编排（存档/导入/重来/启动逻辑）
│   ├── components/       UI 组件（每个都是独立 .vue，样式 scoped）
│   │   ├── AppHeader.vue       顶栏：状态灯 + 存档按钮
│   │   ├── StoryPanel.vue      叙事流（v-for 消息数组）
│   │   ├── GameComposer.vue    输入框
│   │   ├── AppSidebar.vue      侧栏：时间/地点/回合
│   │   └── SettingsDrawer.vue  设置面板
│   ├── stores/
│   │   └── game.ts       界面与游戏之间的唯一桥梁（原 index.html 的 script）
│   ├── composables/      useDownload（下载/选文件）等
│   ├── core/             游戏逻辑（框架无关，仍是纯 TS 模块）
│   │   ├── agent.ts      agent 循环（灵魂）
│   │   ├── tools.ts      工具定义、执行、解析
│   │   ├── state.ts      世界状态、存档、导出导入
│   │   ├── calendar.ts   历法（目前只有现实公历）
│   │   ├── llm.ts        LLM 调用（含 CORS 失败提示）
│   │   ├── config.ts     配置与服务商预设
│   │   └── prompts.ts    提示词（改玩法主要改这里）
│   ├── types/state.ts    状态的数据形状（存档字段的唯一真相）
│   └── styles/main.css   全局设计系统（CSS 变量、按钮、卡片）
├── tests/                vitest 单元测试（29 项）
│   ├── setup.ts          localStorage 垫片
│   ├── calendar.test.ts  日期边界 / 时长文案
│   ├── state.test.ts     脏存档净化 / 推进把关 / 快照
│   └── tools.test.ts     工具执行 / 解析器
├── public/               ⚠️ 原样拷贝到站点根，不经过构建
│   ├── about.html        项目介绍页 → 线上 /TavernGame/about.html
│   └── mea-avatar.jpg    头像素材（about.html 里以相对路径引用）
├── doc/
│   ├── AGENTS.md         本文件
│   ├── DESIGN.md         目标架构设计备忘
│   └── CHANGELOG.md      更新日志
├── README.md             面向玩家
└── ME-AQUA.md            所有者档案（git 忽略，不公开）
```

**迁移前后的对照（v0.6.0）**：

| 原来 | 现在 |
| --- | --- |
| `core/*.js`（原生 JS） | `src/core/*.ts`（TypeScript，strict） |
| `index.html`（714 行，HTML+CSS+JS 混在一起） | `index.html`（12 行）+ `src/` 下的组件与 store |
| `about.html` / `assets/` 在根目录 | `public/`（构建时原样拷贝） |
| `dev-server.js`（自写无缓存服务器） | 删除 —— Vite dev server 自带 HMR |
| 根目录散着 4 个 .md | 文档统一进 `doc/` |
| 零测试 | `tests/` + `npm test`（29 项） |

## 📌 实测过的事实（别重新踩）

- **CORS 实测结果**：DeepSeek 官方、硅基流动、OpenRouter、Mistral
  都返回 CORS 允许头，浏览器可直连；**Groq 不允许**。
- **离线测试已经在仓库里了**（`tests/`，`npm test`）：vitest + `tests/setup.ts` 里的
  localStorage 垫片，不需要浏览器。**别再把它放到 `.tools/`（会被忽略）** —— v0.5.x
  的 82 项测试就是这样丢的，全历史零测试文件。
- **测试代码里写 markdown 围栏要小心**：模板字符串里的裸反引号会把字符串截断
  （本项目实测踩过，报错是 `Unexpected identifier 'tool'`）。
  用 `String.fromCharCode(96)` 拼出反引号，或改用数组 `join`。
- **Vue 无构建步骤也能用**（`vue.esm-browser.prod.js` + importmap），
  但**不要**因为这点动摇：项目已选 Vite 构建，因为要做类型检查和 SFC 静态样式。
  记这条只是为了：将来若要做「单文件演示版」，这条路是通的。

## ⚠️ 素材版权提醒

`public/mea-avatar.jpg` 来自神楽めあ官方 YouTube 频道（@KaguraMea），
仅作个人练习与非商业用途。若将来公开商业化，需替换为自有或已授权素材。

## 🤝 协作约定

项目层面的底线：

- 破坏性操作须先确认：重写历史、删仓库、强制推送
- 不要擅自扩大改动范围
