---
name: environment
description: TavernGame 的运行环境事实——工作区、工具链、代理、以及本机必须记住的坑（dev URL 前缀、Vite 绑 IPv6、路径大小写、Node 原生 localStorage）。
whenToUse: 需要跑命令、连服务、配环境，或遇到「连不上 / 找不到 / 报错像别的问题」时。
---

# 环境事实

| 项 | 值 |
| --- | --- |
| 工作区 | `/Users/lzh/Developer/TavernGame`（macOS） |
| 运行时 | Node v26，npm |
| 构建 | Vite 8 + vue-tsc + vitest（`npm run verify` 跑齐） |
| 仓库 | https://github.com/me-aqua/TavernGame |
| 线上 | https://me-aqua.github.io/TavernGame/ |
| 提交身份 | `me-aqua` / `74250100+me-aqua@users.noreply.github.com`（匿名，勿改） |
| 代理 | `http://127.0.0.1:7897`（curl/git 不读系统代理，要显式 `-x`） |

> ⚠️ 上游文档里遗留的 Windows 路径（`F:\SillyTavernX\...`、`gh.exe`、Edge）**已过时**，
> 本机是 macOS + Google Chrome。不要再照那套排查。

## 本机踩过的坑

### dev URL 带 base 前缀

`vite.config.ts` 里 `base: '/TavernGame/'`（为 GitHub Pages 子目录部署），
所以**开发地址也是**：

```
http://localhost:3000/TavernGame/    ✅
http://localhost:3000/               ❌ 404
```

### Vite 8 默认只绑 IPv6

实测 `lsof -nP -iTCP:3000 -sTCP:LISTEN` 显示监听在 `[::1]:3000`，
于是 `curl http://127.0.0.1:3000` 返回 **000**（看起来像服务没起来）。
已在配置里固定 `host: 'localhost'`。**判断服务活没活，用 `curl localhost`。**

### Node 22+ 自带坏掉的原生 localStorage

`localStorage` 存在但取值是 `undefined`（不给 `--localstorage-file` 时），
直接用会抛 `Cannot read properties of undefined (reading 'setItem')`。
测试里要用 `Object.defineProperty` **覆盖**它，只赋值不生效。

### TypeScript 只能停在 6.x（不能升 7）

实测（2026-09-14，每个版本都真跑过 `vue-tsc`）：

| TS | 结果 |
| --- | --- |
| 7.0.2（npm 上的 latest） | ❌ `vue-tsc` 报 `ERR_PACKAGE_PATH_NOT_EXPORTED: './lib/tsc'` —— 它还在 require TS 的内部路径，而 TS 7 已不导出；TS 7 还移除了 `baseUrl` |
| 6.0.3 | ✅ 通过（已采用） |
| 5.9.3 | ✅ 通过 |

结论：**TS 的版本上限由 vue-tsc 决定，不能只看它自己的 latest。**
升级前先跑 `npm run verify` —— 不兼容会当场暴露。

### 换行 / 编码：三平台同时开发

**规则只有三条**（都由 `.gitattributes` 声明、`.githooks/pre-commit` 强制）：

| 位置 | 要求 | 为什么 |
| --- | --- | --- |
| 仓库（索引） | 一律 **LF** | clone 到任何平台都一致 |
| 工作区：普通文本 | **LF** | Windows 编辑器默认写 CRLF，所以要拦 |
| 工作区：`.bat` / `.cmd` | **CRLF** | cmd.exe 用 LF 换行可能执行出错 |
| 所有文本 | 无 **BOM**、UTF-8 | BOM 会让脚本多出三个字节；GBK 会导致乱码 |

⚠️ **容易搞错的一点**（我实测踩过）：`eol=crlf` 只作用于**检出的工作区**，
**索引里永远是 LF**。所以 `git show HEAD:start.bat` 看到 LF 是正常的，
不要试图把 CRLF 提交进仓库。用 `git ls-files --eol` 看真相：

```
i/lf w/crlf attr/text eol=crlf   start.bat   ← 正常
i/lf w/lf   attr/text eol=crlf   start.bat   ← 坏了（钩子会拦）
```

⚠️ **别用 `git diff` 判断"文件有没有变"**：`git add` 会按 `.gitattributes`
做规范化，一个只改了换行符的文件归一化后与 HEAD 完全相同，
于是**它不会出现在 `git diff --cached` 里** —— 钩子也就看不到它。

Windows 开发者建议设 `git config --global core.autocrlf true`
（Git for Windows 默认就是），交给 git 管转换。

### 路径大小写

仓库在 macOS 上（默认大小写不敏感），但 GitHub Actions 在 Linux 上跑（**敏感**）。
引资源时大小写必须与磁盘一致，否则本地过、线上 404。

## 常用命令

```bash
npm run dev        # 开发服务器（URL 见上）
npm run verify     # 类型检查 + 测试与覆盖率门禁 + 构建 + e2e
npm run build      # 产物到 dist/（已 git 忽略）
npm run preview    # 预览构建产物（同样在 /TavernGame/ 下）
```
