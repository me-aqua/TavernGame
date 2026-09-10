# AGENTS.md —— 项目环境备忘

> 这个文件写给 **AI 编码助手**看，也方便协作的人快速了解环境。
> 目标是：读一遍就能掌握全部上下文，不必反复试探。

## 🎯 项目现状

- **TavernGame** —— 一个用 **agent 循环**驱动的文字游戏，既能做卡也能玩卡
- 形态：**纯前端**。没有服务器、没有构建步骤、没有 npm 依赖
- 与酒馆的区别：酒馆是**轮次对话**，本项目是**回合制 agent 循环**
- 当前版本：**v0.4.0**（agent 循环跑通 + 架构转纯前端）
- 游戏地址：https://me-aqua.github.io/TavernGame/play.html

### 开发路线

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 骨架 | ✅ |
| 2 | 最小 agent + 工具 + 状态 | ✅ |
| 3 | 架构转纯前端（移除服务器） | ✅ |
| 4 | 做卡系统（自定义角色与世界） | ⏳ 待做 |
| 5 | 更丰富的工具与存档同步 | ⏳ 待做 |

## 🧠 核心设计（改动前必读）

**引擎持有事实，模型只能申请。**

- 模型不能直接改数据，只能输出工具调用块（JSON），由 `core/tools.js` 执行
- 所有数值改动都在 `core/state.js` 里被 clamp，模型改不出非法值
- 掷骰在引擎里做（`roll_check`），模型无法预测或编造

**⚠️ 不要改成各家 API 的原生 function calling。**
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

## 🏷️ 版本管理约定

- 提交信息用约定式前缀：`feat` / `fix` / `docs` / `chore` / `refactor` / `style`
- 版本号遵循语义化版本，标签格式 `vX.Y.Z`
- **标签必须单独推送**：`git push origin v0.4.0`
- 每个版本同步更新 `CHANGELOG.md`

## 📁 目录结构

```
TavernGame/
├── index.html        项目介绍页（Pages 入口）
├── play.html         游戏界面 —— 本体，纯静态
├── core/
│   ├── agent.js      agent 循环（灵魂）
│   ├── tools.js      工具定义、执行、解析
│   ├── state.js      世界状态、存档、导出导入
│   ├── llm.js        LLM 调用（含 CORS 失败提示）
│   ├── config.js     配置与服务商预设
│   └── prompts.js    提示词（改玩法主要改这里）
├── start.bat         Windows 本地静态服务器
├── assets/           静态素材
├── package.json      仅用于本地开发（npx serve）
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
