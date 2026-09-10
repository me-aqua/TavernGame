# AGENTS.md —— 项目环境备忘

> 这个文件写给 **AI 编码助手**看，也方便协作的人快速了解环境。
> 目标是：读一遍就能掌握全部上下文，不必反复试探。

## 🎯 项目现状

- **TavernGame** —— 一个用 **agent 循环**驱动的文字游戏，既能做卡也能玩卡
- 定位：**软件型**项目（使用者自己 clone、自己跑、用自己的 API key），**不是**在线服务
- 与酒馆的区别：酒馆是**轮次对话**，本项目是**回合制 agent 循环**
- 当前阶段：**第 1 步（骨架）已完成** —— 本地服务器可跑，界面壳子就位，agent 尚未接入
- 最新的发布版本：**v0.2.0**（`package.json` 里是 `0.3.0-dev`，下个版本发布时会打 `v0.3.0`）

### 开发路线

| 步骤 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 骨架：Node 服务 + 界面壳子 | ✅ 完成 |
| 2 | 最小 agent：能对话、能叙述 | ⏳ 待做 |
| 3 | 世界状态 + 工具（掷骰、属性、背包） | ⏳ 待做 |
| 4 | 做卡：写角色与世界设定 | ⏳ 待做 |

### 核心设计原则

- **LLM 负责决策与叙事，引擎负责事实** —— 掷骰、改数值、存盘都由代码做，模型碰不到真实数据
- **零依赖** —— 服务器只用 Node 内置模块，不需要 `npm install`
- **单进程 + 本地文件** —— 一个命令启动，数据存 `data/`

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

已经配好的地方（无需重复配置）：

```bash
git config --global http.proxy    # = http://127.0.0.1:7897
git config --global https.proxy   # = http://127.0.0.1:7897
```

**以下命令在受限沙箱下会失败**，需要联网权限：

```bash
git push / git pull / git fetch    # 需要联网
gh ...                             # 需要联网
curl / Invoke-WebRequest 访问外网   # 需要联网
```

典型失败特征：

- `schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`
- `[sandbox: file access denied under workspace-write mode]`

> ⚠️ 注意：`.NET` 的 `Invoke-RestMethod` / `Invoke-WebRequest` 即使加了
> `-Proxy` 也可能失败，**优先用 `curl.exe`**（走 OpenSSL，绕开 SChannel）。

## 🚀 发布方式

GitHub Pages，**从 `main` 分支根目录发布**。

```bash
# 部署 = 推送
git add -A && git commit -m "..." && git push
# 约 30 秒后自动构建完成
```

入口文件必须是根目录的 `index.html`。查询构建状态：

```bash
gh api repos/me-aqua/TavernGame/pages --jq '.status'
gh api repos/me-aqua/TavernGame/pages/builds/latest --jq '.status'
```

## 🏷️ 版本管理约定

- 提交信息用约定式前缀：`feat` / `fix` / `docs` / `chore` / `refactor` / `style`
- 版本号遵循语义化版本，标签格式 `vX.Y.Z`（如 `v0.1.0`）
- **标签必须单独推送**：`git push origin v0.1.0`
- 每个版本同步更新 `CHANGELOG.md`

## ⚠️ 两个必须记住的坑

### 1. 资源引用只能用相对路径

GitHub Pages 部署在 **`/TavernGame/` 子目录**下，不是域名根目录。

```html
✅ <img src="assets/mea-avatar.jpg">    <!-- 相对路径 -->
❌ <img src="/assets/mea-avatar.jpg">   <!-- 会解析到域名根，404 -->
```

### 2. 两套运行方式的目录映射不同

| | 静态根目录 | 用途 |
| --- | --- | --- |
| GitHub Pages | 仓库根目录 | 线上介绍页 |
| 本地服务器 | `public/` | `npm start` 的开发界面 |

所以：

- 根目录 `index.html` → **给 Pages 用的介绍页**
- `public/index.html` → **本地服务器的测试页**
- `public/play.html` → **游戏界面（agent 的前端）**
- `/assets/` → 服务器做了特殊映射，指向仓库根的 `assets/`

改页面时注意别把两边搞混。

## 📁 目录结构

```
TavernGame/
├── index.html           介绍页（GitHub Pages 入口）
├── package.json         npm 脚本与项目元信息
├── config.example.json  配置模板（复制为 config.json 后填 key）
├── assets/              静态素材（两边共用）
│   └── mea-avatar.jpg   占位头像（神楽めあ官方频道素材）
├── public/              ← 本地服务器的静态根目录
│   ├── index.html       测试页
│   └── play.html        游戏界面
├── server/
│   └── index.js         零依赖 HTTP 服务器 + /api/healthz
├── data/                游戏存档（git 忽略）
├── README.md
├── CHANGELOG.md
├── AGENTS.md            本文件
└── AGENTS.local.md      个人偏好（git 忽略）
```

## ⚠️ 素材版权提醒

`assets/mea-avatar.jpg` 来自神楽めあ官方 YouTube 频道（@KaguraMea），
**目前仅作个人练习与非商业用途**，页脚已标注出处。
若项目将来公开商业化，需替换为自有或已授权素材。

## 🤝 协作约定

个人的沟通偏好见 **`AGENTS.local.md`**（私人文件，不提交到仓库）。

项目层面的底线：

- 破坏性操作须先确认：重写历史、删仓库、强制推送
- 不要擅自扩大改动范围
