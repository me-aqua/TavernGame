# 更新日志

本文件记录 TavernGame 的每个版本改了什么。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

<!--
写法说明（新手向）：
  每次准备发布一个新版本时，把「未发布」里的内容整理一下，
  在上面加一个新的版本小节，然后把对应的 Git 标签打上。

  分类用这几项：
    新增 Added      —— 加了新功能
    修改 Changed    —— 改了现有行为
    修复 Fixed      —— 修了 bug
    移除 Removed    —— 删掉了东西
    安全 Security   —— 安全相关
-->

## [未发布] — 目标 v0.3.0

### 新增
- **`server/index.js`** —— 零依赖的 Node HTTP 服务器
  - 静态文件服务（含正确的 MIME 类型与请求日志）
  - `/api/healthz` 状态接口，供前端探测后端能力
  - 路径穿越防护，`server/`、`config.json` 等不会对外暴露
  - `/assets/` 特殊映射到仓库根目录，避免素材复制两份
- **`public/play.html`** —— 游戏界面壳子
  - 叙事区 / 状态面板 / 输入区三块布局，适配窄屏
  - 自动探测后端状态并用指示灯显示
- **`public/index.html`** —— 本地服务器的测试页
- **`package.json`** —— `npm start` 启动脚本，声明 Node >= 18
- **`config.example.json`** —— 配置模板（API key / 模型 / 参数）
- **`data/`** —— 游戏存档目录（内容已被 git 忽略）
- `.gitignore` 新增 `config.json` 与 `data/*` 规则

### 修改
- 根目录 `index.html` 重写为**项目介绍页**（面向网页访客）
  - 说明项目定位、与酒馆的区别、如何自己运行
- `README.md` 全面重写，反映 agent 循环的新定位
- `AGENTS.md` 更新项目现状、目录结构，并记录两个部署陷阱

### 修复
- 修正根目录 `index.html` 的图片引用：绝对路径 `/assets/...`
  在 GitHub Pages 的子目录部署下会 404，改为相对路径

### 移除
- 清除 `README.md`、`package.json` 等文件的 UTF-8 BOM 残留

---

## [0.2.0] - 2026-09-10

### 新增
- `AGENIA.md`：AI 助手的自我介绍文档
  - 说明其角色定位、性格、工作方式
  - 列出能力范围与能力边界
  - 公开记录项目开发中犯过的错误及教训
- `AGENTS.md` 增补版本管理约定（语义化版本、标签推送、CHANGELOG）

### 安全
- `.gitignore` 新增 `*.local.md` 规则
  - 防止个人的 AI 指令文件被提交到公开仓库

---

## [0.1.0] - 2026-09-10

第一个里程碑：**版本管理基础与发布管道全部跑通**。

### 新增
- 项目骨架：`.gitignore`（排除清单）、`.gitattributes`（换行符规则）
- `README.md`：项目说明与 Git 常用命令速查
- `AGENTS.md`：环境备忘，记录代理配置、工具路径、部署方式
- `index.html`：网站在线入口
- 首页主视觉：使用神楽めあ官方频道素材的圆形头像
- GitHub Pages 自动部署：推送后约 30 秒自动上线

### 修改
- 2026-09-10 仓库由私有改为公开，以启用免费的 GitHub Pages

### 移除
- 2026-09-10 清空早期多写的示例代码，回到空白起点

### 说明
- 网站地址：https://me-aqua.github.io/TavernGame/
- 协作：`Alice-space` 已受邀为只读协作者

---

<!-- 版本链接（GitHub 上会自动生成对比页面） -->

[未发布]: https://github.com/me-aqua/TavernGame/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/me-aqua/TavernGame/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/me-aqua/TavernGame/releases/tag/v0.1.0
