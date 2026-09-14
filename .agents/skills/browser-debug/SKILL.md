---
name: browser-debug
description: 用 CDP 在真实 Chrome 里验证页面（读运行时 DOM）。含三个必踩的坑：连到 about:blank、--dump-dom 抓太早、import 静态提升。
whenToUse: 需要确认「页面真的能跑」而不是「HTTP 200」时；排查渲染／交互问题时。
---

# 真浏览器验证（CDP）

## 为什么不能用别的手段

- **HTTP 200 只说明文件送到了**，不说明页面能跑。
- **`--dump-dom` 不能用**：它在脚本执行前就把 HTML 打出来了，
  看到的是**未挂载的模板**（`{{ }}` 原样在），会误判成「Vue 没工作」。

## 启动

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --user-data-dir=/tmp/cdp-x \
  --remote-debugging-port=9333 about:blank
```

用 Node 自带 WebSocket 连，**不需要 puppeteer**：

1. `fetch('http://127.0.0.1:9333/json/list')` 拿 `webSocketDebuggerUrl`
2. 连上后 `Page.navigate` → `Runtime.evaluate` 读 DOM

## 三个坑（每个都会让你误判「页面是坏的」）

| 现象 | 真实原因 |
| --- | --- |
| 读到的内容跟源文件一模一样，像没渲染 | 你连的是启动时的 **`about:blank` 标签页**。必须显式 `Page.navigate` |
| 页面是 `chrome-error://chromewebdata/` | 导航失败（地址错／服务没起来）。**先 curl 确认地址可达** |
| 脚本里 `import` 先于其他语句执行 | `import` 会被**静态提升**，所以「先写文件再 import 它」在同一段里不成立 |

## 断言要落在运行时状态上

读这些，而不是读源文件：

- 组件是否挂载（`#app` 有没有子元素）
- 侧栏／状态栏的文本（`document.querySelector('.time-display').textContent`）
- 交互后的 DOM（点开设置面板，再读它的字段）
- `Runtime.exceptionThrown` 与 4xx/5xx——**必须为零**才算通过
