---
name: release
description: 发布流程——分支约定、GitHub Pages 的 Actions 部署前置条件、标签与提交的顺序检查。
whenToUse: 要提交、推送、打标签、改线上时。
---

# 发布流程

## 部署前置条件（容易漏）

GitHub Pages 现在由 **Actions 构建**（`.github/workflows/deploy.yml`）：
push 到 `main` → `npm ci` → `npm run build` → 发布 `dist/`。

⚠️ **仓库 Settings → Pages → Source 必须是「GitHub Actions」。**
如果还停留在「从分支根目录发布」，根目录是**源码**（Vue + TypeScript），
浏览器跑不了 —— 合并后线上会直接 404。

## 提交顺序（每步都要验证）

1. `git add -A`，确认 `git diff --cached --name-only` 非空
2. `git commit -F <文件>`（提交信息用文件传，避免引号地狱）
3. 确认提交真的发生：`git log -1 --format=%s`
4. 才打标签：`git tag -a vX.Y.Z`
5. 核对标签指向：`git rev-list -n 1 vX.Y.Z` 应等于 HEAD
6. `git push` + `git push upstream vX.Y.Z`

**真实事故**：安全检查失败时脚本执行了 `git reset`（清空暂存区），
但只修正了检查逻辑、**忘了重新 `git add`** → 提交失败 → HEAD 没动 →
**标签打在了上一个提交上** → 远端出现指向错误提交的标签 + 内容为空的 Release。

## 版本号约定

- 约定式前缀：`feat` / `fix` / `docs` / `chore` / `refactor` / `test`
- 语义化版本，标签 `vX.Y.Z`，**标签必须单独推送**
- 改了行为／修了 bug／加了功能 → 发版；只改文档 → 直接提交，不发版
- 标签落后 HEAD 是正常的

## 远端与提交身份

远端只有 **`upstream`** = `git@github.com:me-aqua/TavernGame.git`（唯一的仓库，**不要建 fork**）：
两个协作者都在它上面开分支、发 PR。

身份是**每个人各自的**，用 `--local` 设在仓库里，不动全局配置：

```bash
git config --local user.name "me-aqua"
git config --local user.email "74250100+me-aqua@users.noreply.github.com"
```

提交前核对 `git log -1 --format='%an <%ae>'`；错了用 `git commit --amend --reset-author`。
