# TavernGame

> 一个用 **agent 循环**驱动的文字游戏 —— 既能做卡，也能玩卡。

## 直接开玩

**不需要安装任何东西。** 打开网址 → 填一次自己的 API key → 开始玩。

### 👉 https://me-aqua.github.io/TavernGame/

API key 保存在**你自己的浏览器**里，请求直接从浏览器发往服务商，
不经过任何中间服务器。

## 这是什么

传统 AI 角色扮演工具（比如酒馆）是**轮次对话**：

> 你说一句 → 模型回一句 → 你说下一句

TavernGame 是**回合制**：

> 你给一条指令 → 游戏把这个回合完整演完 → 给你一段故事

差别在于：你不用一步步推着它走，也不用替它记账。

**游戏里有一个时间系统。** 它会随着你的行动自然推进 ——
你在城里逛一下午、在客栈睡一觉、闭关三个月，
时间都会往前走，世界也跟着变。

## 支持的服务商

需要你自己的 API key。已实测支持浏览器直连（CORS 允许）：

| 服务商 | 说明 |
| --- | --- |
| **DeepSeek 官方** | 默认选项，最省事 |
| 硅基流动 | 国内可用，模型多 |
| OpenRouter | 模型最全 |
| Mistral | — |
| **本地 Ollama** | **零成本**，跑在你自己电脑上 |

> Groq 实测不允许浏览器直连，用不了。

## 存档

- **自动保存**：存在浏览器 localStorage，刷新不丢
- **导出 / 导入**：界面右上角有按钮，可下载成 JSON 文件

> ⚠️ localStorage 会随浏览器缓存一起被清理。
> 重要存档记得**导出成文件**。

## 本地运行（可选）

想离线玩或改代码：

```bash
git clone https://github.com/me-aqua/TavernGame.git
cd TavernGame

npm run dev        # 需要 Node.js 18+，零依赖，不用 npm install
# 打开 http://localhost:3000/
```

Windows 用户也可以直接双击 `start.bat`。

> 本地调试服务器**禁用了缓存**，改完代码刷新即生效。
>
> ⚠️ localStorage 按域名隔离：`localhost` 与线上各存一份 API key，
> 首次在本地调试要重新填一次。

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT
