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

## [未发布]

### 计划中
- 设计并实现文字游戏的核心玩法
- 替换当前的占位首页

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

[未发布]: https://github.com/me-aqua/TavernGame/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/me-aqua/TavernGame/releases/tag/v0.1.0
