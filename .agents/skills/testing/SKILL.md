---
name: testing
description: 测试纪律与框架用法——单元/组件/覆盖率/e2e 各自测什么、门禁在哪里、以及「新增功能必须新增测试」是怎么被强制的。
whenToUse: 写新功能、改现有行为、或需要判断「改坏没有」时。
---

# 测试框架

## 一条命令

```bash
npm run verify     # 类型检查 → 142 项测试 + 覆盖率门禁 → 构建 → 16 项 e2e
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
| 单元 | `tests/*.test.ts` | node | `src/core`、`src/stores` 的逻辑与边界 |
| 组件 | `tests/components.test.ts` | jsdom | 渲染出的契约、点击后 emit 什么（**不测样式**） |
| e2e | `e2e/smoke.mjs` | 真实 Chrome（CDP） | 构建产物真能打开、能交互、无异常无 4xx |

**测试里的网络一律用假 fetch**：`tests/support/fakeLlm.ts`
（按调用次序返回预设回复，并记录每次请求供断言）。**绝不发真实请求。**

## 覆盖率门禁

阈值写在 `vitest.config.ts`，统计范围是 `src/core` + `src/stores`：

```
statements 90 / branches 84 / functions 88 / lines 90
```

**低于阈值就失败。** 数值是实测后留余量定的，作用是「新增功能不写测试就过不去」。

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
