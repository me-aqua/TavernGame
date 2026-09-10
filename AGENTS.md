# AGENTS.md —— 项目环境备忘

> 这个文件写给 **AI 编码助手**看，也方便协作的人快速了解环境。
> 目标是：读一遍就能掌握全部上下文，不必反复试探。

## 🎯 项目现状

- **TavernGame** —— 一个基于网页的文字游戏
- 目前处于**空白起点**：只有一个占位首页，玩法尚未设计
- 当前版本：**v0.1.0**（版本管理基础与发布管道跑通）

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

## 📁 目录结构

```
TavernGame/
├── index.html           入口页面（Pages 的入口）
├── assets/              静态素材
│   └── mea-avatar.jpg   占位头像（神楽めあ官方频道素材）
├── README.md            项目说明
├── CHANGELOG.md         更新日志
├── .gitignore           排除清单
├── .gitattributes       换行符规则
└── AGENTS.md            本文件
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
