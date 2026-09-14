---
name: comments
description: 注释规范——文件头与函数上方的简短中文注释、格式、以及「不写历史对比」这条被 lint 强制的原因。
whenToUse: 写新文件、加新函数、或重构时顺手改注释的时候。
---

# 注释规范

一句话：**代码、变量、函数名全英文；注释全中文，且只描述现在。**

## 每个函数

紧贴上方一行，说清它「做什么」（不是「怎么做」——怎么做看代码）：

```ts
/** 把毫秒差说成人话（1 年按 365 天折算） */
export function describeElapsed(ms: number): string {
```

- 一行说清楚就用单行 `/** ... */`；要说边界与坑就用多行块注释。
- 「一行写完的小箭头」（`(i) => x`）不用注释：名字与上下文已经说明它是什么。
- 参数/返回值的含义不显然时，用 `@param` / `@returns` 补一句。

## 每个文件

`<script setup>` **里面**、第一个 import 之前，写这个文件管什么：

```vue
<script setup lang="ts">
/**
 * 顶栏：品牌 + 连接状态 + 主题切换 + 存档操作 + 设置入口。
 */
import { useI18n } from 'vue-i18n'
```

⚠️ 不要写在 `<script setup>` **外面**（看起来像 HTML 注释），也不要夹在 import 中间。

## 行内注释

只加在「代码本身看不出为什么」的地方：边界条件、已知取舍、踩过的坑。

```ts
// ⚠️ 必须用 Object.hasOwn：写成 TOOLS[name] 时 constructor 会从原型链上取到真值
```

## 禁止：历史对比

**不要写「原来的实现 / 旧版是 / 曾经 / 相比以前 / 已删除」。**
那种句子只对当时在场的人有意义，对读代码的人是噪音，而且会腐烂 ——
过两轮重构就没人知道「原来」指哪一版。

要表达「为什么不能改成另一种写法」，就写**约束本身**：

| 别写 | 写 |
| --- | --- |
| 原来用 innerHTML，现在改成模板插值，少了 XSS 隐患 | 全部走模板插值，由 Vue 自动转义，没有 innerHTML 拼接 |
| 之前这里忘了 triggerRef，界面不更新 | 整体替换也走容器属性：漏一处手动触发就是「界面不更新」这种查不出来的 bug |

## 怎么被强制的

`tavern/comment-style` 规则（`tools/eslint-plugin-comment-style.js`，在 `eslint.config.js` 注册）：

1. 具名函数 / 类方法必须有紧贴上方的注释（单行或多行都行）
2. 注释里不许出现历史对比的句式
3. `.vue` 的文件头注释必须在 `<script setup>` 里面

豁免：一行写完的箭头函数；测试文件里的行内回调（用例标题已经说明了意图）。

## 踩过的坑（都留了验证）

- **注释挂在父节点上**：`export function f()` 的注释属于 ExportNamedDeclaration，
  只看函数本身会误报「没有注释」；但对**非 export** 的函数也回退到父节点，
  又会让上一个函数的注释顺带「喂饱」下一个函数（漏报）。回退只对 export 开。
- **`getCommentsBefore(FunctionExpression)` 返回空**：类方法的注释挂在 MethodDefinition 上，
  传 `node.value` 进去会变成「有注释也报缺少注释」。
- **「父节点是 CallExpression」不等于 defineProperty**：class 体也是某个调用的参数，
  于是类方法被整批标记成「已报告」——漏报，且报错行号乱跳。
  判断必须锚定到 `Object.defineProperty` 这个具体调用。
- **调试打印不要用 `require`**：插件是 ESM，`require is not defined` 会让整条规则抛错，
  此时报错行号全部失真。曾按失真的行号追了很久，其实规则本身没问题。
