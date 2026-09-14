---
name: testing
description: 测试纪律与框架用法——单元/组件/覆盖率/e2e 各自测什么、门禁在哪里、以及「新增功能必须新增测试」是怎么被强制的。
whenToUse: 写新功能、改现有行为、或需要判断「改坏没有」时。
---

# 测试框架

## 一条命令

```bash
npm run verify     # 类型检查 → 223 项测试 + 覆盖率门禁 → 构建 → 25 项 e2e
```

分开跑：

| 命令 | 作用 |
| --- | --- |
| `npm test` | 单元 + 组件测试（vitest） |
| `npm run test:coverage` | 带覆盖率与门禁 |
| `npm run e2e` | 构建 + 真实 Chrome 跑构建产物 |

## 各层测什么（别串层）

| 层 | 位置 | 环境 | 测什么 |
| --- | --- | --- | --- |
| 单元 | `tests/*.test.ts` | node | `src/game`、`src/agent`、`src/utils`、`src/stores` 的逻辑与边界 |
| 组件 | `tests/components.test.ts` | jsdom | 渲染出的契约、点击后 emit 什么（**不测样式**） |
| e2e | `e2e/smoke.mjs` | 真实 Chrome（CDP） | 构建产物真能打开、能交互、无异常无 4xx |

## 共享夹具（tests/support/）

**重复的夹具必须集中，不要在测试文件里各写一份** —— 领域层改成纯数据 + 纯函数之后，
「造一局」是「`initialState()` + 传 store」两步，各写一份就会出现五份几乎相同的
`freshGame` / `testContext`，改一次签名要改五处。

| 文件 | 提供 |
| --- | --- |
| `game-fixtures.ts` | `createGame()`（纯数据一局）、`createPersistedGame()`（带真存储）、`createAgentContext()`（引擎要的纯数据 + 三动作）、`noopStore` / `failingStore`、`countBackupKeys()` |
| `locale-patterns.ts` | 断言用的 locale 派生**模式**：`SEGMENT_NAMES`、`SHORT_TIME_LABEL`、`ELAPSED_PREFIX`、`REASON_LABEL`、`ADVANCE_OK_MARKER` |
| `fakeLlm.ts` | 假 fetch（按序返回预设回复并记录请求） |

判据：**同一个夹具在第二个文件里再写一遍时**才提取。fake 回复常量（`WAIT_REPLY` 之类）
属于各用例的上下文，各文件自己的那份不算重复 —— 硬合并只会让测试读不懂。

**测试里的网络一律用假 fetch**：`tests/support/fakeLlm.ts`
（按调用次序返回预设回复，并记录每次请求供断言）。**绝不发真实请求。**

## 覆盖率门禁

阈值写在 `vitest.config.ts`，统计范围是 `src/game` + `src/agent` + `src/utils` + `src/stores`：

```
statements 99 / branches 94 / functions 100 / lines 99
```

**低于阈值就失败。** 数值是实测后留余量定的（实测 99.78 / 96.68 / 100 / 99.75），
作用是「新增功能不写测试就过不去」。

## 「新增功能必须新增测试」是怎么强制的

`.githooks/pre-commit` 有一条检查：**每个 `src` 模块都要在 `tests/` 里被提到**，
提不到就拒绝提交。所以新增一个模块时，要么给它建同名测试文件，要么在现有测试里引用它。

## 写测试时容易踩的坑（都实测过）

1. **断言写错会伪装成代码 bug**：先怀疑断言。例：工具抛错走的是
   `state.advanceTime` 的兜底分支，不是 `runTool` 的 ❌ 分支。
2. **别测错路径还不自知**：写「兜底补写」的测试时，如果第二步回复不带工具块，
   循环会正常结束 —— 那条用例其实测的是正常路径。**要确认测试真的走到了目标分支**
   （数请求次数、断言对模型说了什么）。
3. **模块级状态会跨用例**：store 的实例是模块级的，每个用例开头 `重新开始()`。
4. **markdown 围栏在测试源码里要小心**：模板字符串里的裸反引号会截断字符串。
   用 `String.fromCharCode(96)` 拼出反引号。
5. **localStorage 垫片必须在 `vitest.config.ts` 的 `setupFiles` 注册** ——
   漏注册就会静默假通过（见 verification skill）。
6. **语言是测试环境的一部分**：`tests/setup.ts` 把 locale 钉在 `zh-CN`，
   断言产品文案要走 `t('key', {参数})` 而不是抄一份中文字面量 ——
   抄字面量既会在换文案时假红，又会被 ASCII 检查拦下（`tests/` 也在检查范围内）。
   数据 fixture（模型回复、玩家行动）用 ASCII 命名常量。
7. **选元素用 `data-*` 钩子**（`data-settings` / `data-language` / `data-export`…）：
   界面文案随语言变，按文字找元素等于把测试钉在一种语言上。
