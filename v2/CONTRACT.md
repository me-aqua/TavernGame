# TavernGame v2 · 阶段 1 技术契约（CONTRACT）

> 版本：2026-11-26 · 第 2 关（契约与测试）交付物 · **技术栈修订：Vue 3 + TypeScript**
> 上游：`v2/SPEC.md`（需求，唯一事实来源）· `.team/leader/2026-11-25/新版开发计划.md`（阶段 1 范围）
> 本文回答的是「**实现只要做到这些，测试就能判它成没成**」：模块边界、公共 API、语义、DOM 钩子。
> **与 SPEC 冲突时以 SPEC 为准**，并把冲突报给组长 —— 本文不擅自改需求。

## 0. 四条总则

1. **新旧站完全隔离**：`v2/` 是独立 Vite 应用，**不许 import 旧站 `src/`** 的任何组件 / store / 类型，
   不读写旧站 localStorage 键 `tg.*`。判据：`v2/tests/boundaries.test.js`。
2. **项目本体不含数据**：仓库里没有任何卡 / 存档 / 预设种子文件；首次打开是空列表。
   卡与存档只住在浏览器 localStorage 的 `tg2.*` 四个键里。
3. **中文文案住在 `.json` 里**（见 §9.3，这不是风格偏好，是提交钩子的硬约束）。
4. **Vue 只负责界面**：存储 / 引擎 / 提示词 / 校验是**纯 TS 模块**（`src/core/**`），
   不许 import `vue`、不许碰 DOM —— 引擎要在 node 里单测，不能为了测它去起浏览器。

技术栈：**Vite + Vue 3 + TypeScript**（与旧站同一家族，复用仓库里已装的
`vue` / `@vitejs/plugin-vue` / vitest / Playwright / Storybook 工具链）。
provider 走浏览器直连（Vercel AI SDK），Key 只在本地。
「同一家族」不等于「照搬」：`v2/` 从 0 搭，**不 import 旧站的 `src/`**，也不搬它的卡格式与状态树。

---

## 1. 目录与模块边界

```
v2/
  index.html                 SPA 外壳（纯 ASCII；只有 #app 与 /src/main.ts）
  vite.config.mjs            root 定在 v2/，base '/TavernGame/v2/'，build.outDir '../dist/v2'，plugins:[vue()]
  tsconfig.json              ★ 必需：vue-tsc 与 eslint 的类型感知都认它（见 §1.1）
  src/
    main.ts                  入口：createApp → 挂主题 → 挂 hash 路由
    router.ts                hash 路由（原生 hashchange；**不引入 vue-router**）
    i18n.ts                  t('key')：从 locales/zh-CN.json 取文案
    core/                    ★ 六个模块名固定（纯 TS，node 里可 import，测试直接指向它们）
      storage.ts             存储层（localStorage 读写 + schemaVersion 校验）
      errors.ts              错误码与 AppError（中文提示 + 下一步）
      prompt.ts              提示词拼装（顺序与眼睛语义都在这里）
      engine.ts              引擎：runTurn / applyWrite / advanceTime
      schema.ts              卡 / 存档结构校验（validateCard / validateSave）
      mock.ts                mock 提供方（测试替身，见 §7）
    components/*.vue         界面零件（`data-*` 钩子挂在这里）
    pages/
      HomePage.vue  EditorPage.vue  PlayPage.vue  SettingsPage.vue
    locales/zh-CN.json       全部中文文案（见 §9.3）
    env.d.ts                 `declare module '*.vue'`（vue-tsc 要）
  styles/*.css
  tests/                     vitest（node 环境，被测的是 `src/core/**/*.ts`）
  e2e/                       Playwright（真实浏览器 + 构建产物）
```

**硬边界**

| 规则                                                                         | 理由                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `src/core/**` 不许 import `vue`，也不许 import `components/` / `pages/`      | 引擎与存储要能在 node 里单测（没有 DOM、没有组件宿主）                               |
| `src/core/**` 不许碰 `document` / `window` / `globalThis.localStorage`       | 存储层的 backend 由调用方注入（默认 `globalThis.localStorage`，只在 `main.ts` 里给） |
| `src/**` 不许 import 旧站（`../../src/`、`@/`、`cards/`）、`react`、`svelte` | 新旧站隔离；`@/` 是旧站的别名                                                        |
| `src/**` 不许把示例卡 / 存档搬进项目                                         | 数据与本体分离（SPEC §3）                                                            |
| 不引入 `vue-router` / `pinia`                                                | 阶段 1 只要 4 条 hash 路由与一份 localStorage；多一个依赖多一套规矩                  |

### 1.1 为什么 `v2/tsconfig.json` 是硬要求

仓库的 `eslint.config.js` 对 `**/*.{ts,vue}` 开了 `projectService: true`（类型感知规则），
而它会按文件位置找最近的 tsconfig。`v2/` 不在旧站 `tsconfig.app.json` 的 `include` 里
（那是 `src/**` + `tests/**`，根目录锚定），所以：

- 没有 `v2/tsconfig.json` ⇒ `npm run lint` 在 v2 的 `.ts` / `.vue` 上直接报「找不到项目」；
- 有它 ⇒ lint、`vue-tsc`、编辑器补全三处认同一份配置。

最小内容：`strict: true`、`moduleResolution: 'bundler'`、`noEmit: true`、
`include: ['src/**/*.ts', 'src/**/*.vue']`、`types: ['vite/client']`。
（第 2 关已经放了一份最小版；实现岗可以往里加 paths，但 `strict` 与 `include` 两行不许去掉。）

---

## 2. 数据模型（`schemaVersion: 1`）

### 2.1 Card

```js
{
  schemaVersion: 1,
  id: 'c-<string>',            // 创建时生成，稳定不变
  name: string,                // 非空；重命名只改它
  state: [                     // 单层；阶段 1 只有 type:'string'
    { code: string, name: string, note: string, type: 'string', initial: string | { day: number, hour: number } }
  ],
  chain: [                     // 顺序即执行顺序
    { id: string, type: 'time' | 'normal' | 'output' | 'proof', name: string,
      reads: string[], writable: string[], readsUpstream: boolean,
      historyTurns: number, prompt: string }
  ],
  prompts: [ { id: string, title: string, body: string } ]
}
```

- 🔴 **卡里不许存模型绑定**（也没有 `presetId` 字段）：模型是**玩家本机的设置**，
  住在 `tg2.nodeModels`（§2.5），不进卡、不进存档快照、不跟着导入导出走。
  与 `SPEC.md` §2 的差异见 §9.5 第 11 条（那是 SPEC 里的旧写法，本契约按组长口径执行）。
- 校验对「多出来的字段」**宽容**：旧卡里若残留 `presetId`，`validateCard` 不报错，
  但引擎**一个字节都不看它**（判据：`v2/tests/engine.test.js` 的「残留 presetId 不起作用」）。
- `state[0].code` 固定为 `'0'`，是**时间元素**：它的 `initial` 是对象 `{ day: 1, hour: 8 }`（唯一例外），
  其余元素 `initial` 是字符串。阶段 1 时间初值**只读**（界面不提供编辑），`'0'` 不可删除。
- `reads` 是**混合数组**：`prompts[].id` 表示读这块公共提示词；`state[].code` 表示读这个元素。
  同一个字符串不会同时是两者（id 由创建方保证不撞码）。
- 新建卡的默认四节点（顺序固定；**id 与 name 都固定成下面这四个**，测试与文档靠它点名）：

  | #   | id       | type     | 默认 name | reads | writable                   | readsUpstream | historyTurns | prompt |
  | --- | -------- | -------- | --------- | ----- | -------------------------- | ------------- | ------------ | ------ |
  | 1   | `time`   | `time`   | `time`    | `[]`  | `['0']`                    | `false`       | `0`          | `''`   |
  | 2   | `check`  | `normal` | `check`   | `[]`  | 建卡时全部非 `'0'` 的 code | `false`       | `0`          | `''`   |
  | 3   | `output` | `output` | `output`  | `[]`  | `[]`                       | `true`        | `3`          | `''`   |
  | 4   | `proof`  | `proof`  | `proof`   | `[]`  | `[]`                       | `true`        | `0`          | `''`   |

- 新建卡的 `state = [{ code:'0', name:'time', note:'', type:'string', initial:{day:1,hour:8} }]`，`prompts = []`。
  之后**新增的状态元素 / 提示词块不自动进入任何节点的 `reads` / `writable`** —— 作者用眼睛打开。
- `historyTurns` 数的是**已完成**的回合；本回合的玩家行动**恒为历史块的最后一条**（§5）。

### 2.2 Save

```js
{
  schemaVersion: 1,
  id: 's-<string>',
  cardId: string,
  cardSnapshot: Card,          // 新建存档那一刻整张卡的深拷贝（此后不随卡改动）
  name: string,
  turn: number,                // 已完成的回合数；新建为 0
  tree: { [code]: string | { day, hour } },
  events: Event[],
  updatedAt: string            // ISO 时间戳
}
```

- `tree` 新建时由 `cardSnapshot.state[].initial` 逐个拷贝（深拷贝，不许引用同一对象）。
- `tree['0']` 恒为 `{ day: number, hour: number }`，其余键恒为字符串。
- `Event = { type, text, detail?, at }`，`type ∈ 'action' | 'narration' | 'node' | 'request' | 'tool' | 'write' | 'toolResult' | 'error'`。
  **`chunk` 不是持久事件**（流式增量只走 `onEvent`，不落盘）。
- 改卡不影响旧存档：引擎**一律读 `save.cardSnapshot`**，不读 `tg2.cards`。判据：`v2/e2e/snapshot.spec.js`。

### 2.3 Preset

```js
{ id, name, provider: 'openai-compatible' | 'mock', baseUrl, model, apiKey, reasoning,
  mockChunkDelayMs?: number }   // 仅 provider:'mock' 用，缺省 0
```

- `baseUrl` 只写根（如 `https://api.deepseek.com/v1`）；请求发往 `${baseUrl}/chat/completions`，末尾斜杠要归一化。
- `reasoning ∈ 'off' | 'low' | 'medium' | 'high'`。Key 不写日志、不外发。

### 2.4 Settings

```js
{
  schemaVersion: 1,
  theme: 'light' | 'dark',
  editorColumns: { left: number, right: number }   // px；中栏 = 余量
}
```

默认 `{ schemaVersion: 1, theme: 'light', editorColumns: { left: 280, right: 320 } }`。

### 2.5 NodeModels（**本机映射，不是卡的一部分**）

```js
// localStorage key: tg2.nodeModels
{ [cardId]: { [nodeId]: presetId } }
```

- **为什么在卡外面**：模型（用哪个预设、Key、Base URL）是**玩家本机的设置**，不是卡的作者数据；
  卡与存档要能原样带走而不夹带别人的 Key / 模型选择。
- **缺省**：某个卡没有这条映射（或映射里没有这个节点）⇒ 该节点用 `tg2.presets[0].id`。
- **落地时机**：打开编辑器 / 新建卡时，若这张卡还没有映射，就写一条
  「每个节点 → `tg2.presets[0].id`」的映射（**首次打开即落盘**，之后玩家改动才覆盖它）。
  一个预设都没有时**不写**（写空串只会制造假数据），运行回合时才报 `E_VALIDATION`。
- **编辑器里改**：中栏的 `[data-node-preset]` 改的是这张映射（写盘 `tg2.nodeModels`），**不动卡**。
- **删卡**：连带删掉 `tg2.nodeModels[cardId]`（§8.1）。
- 映射里指向一个**已经不存在的预设**（设置页删了它）⇒ 运行时 `E_VALIDATION`（不静默退回第一个）：
  消息说「这个节点的模型预设没了」，下一步指向设置页。

---

## 3. 存储层（`src/core/storage.ts`）

```js
export const STORAGE_KEYS = {
  cards: 'tg2.cards',
  saves: 'tg2.saves',
  presets: 'tg2.presets',
  settings: 'tg2.settings',
  nodeModels: 'tg2.nodeModels', // 本机映射：模型绑定不进卡（§2.5）
}
export const DEFAULT_SETTINGS = { schemaVersion: 1, theme: 'light', editorColumns: { left: 280, right: 320 } }
export function createStorage(backend = globalThis.localStorage) -> Storage
```

`backend` 只需实现 `getItem(key) / setItem(key, value) / removeItem(key)`（与 `localStorage` 同形）。

| 方法                                        | 语义                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `loadCards()`                               | 无键 ⇒ `[]`；否则解析数组并逐张 `validateCard`（结构；不校验模型），不合法 ⇒ 抛 `E_VALIDATION` |
| `saveCards(cards)`                          | 整表写入（JSON 字符串），返回 `undefined`                                                      |
| `loadSaves()` / `saveSaves(saves)`          | 同上（`validateSave`）                                                                         |
| `loadPresets()` / `savePresets(presets)`    | 无键 ⇒ `[]`；不校验 provider 之外的字段                                                        |
| `loadSettings()` / `saveSettings(settings)` | 无键 ⇒ `DEFAULT_SETTINGS`；有键时按默认值**深合并**（缺字段补默认，未知字段保留）              |
| `loadNodeModels()` / `saveNodeModels(map)`  | 无键 ⇒ `{}`；有键时必须解析成「对象套对象套字符串」，否则 `E_VALIDATION`（不许静默当空）       |

硬性规定：

1. **五个键之外一个字节都不许写**，尤其不许写 `tg.*`（旧站）。判据：`v2/tests/storage.test.js`。
2. **不种数据**：任何 `load*()` 都不得在空后端上写回默认卡 / 示例存档 / 示例映射
   （映射的「首次打开铺默认」是**编辑器**的动作，不是 `load*()` 的副作用，§2.5）。
3. **坏 JSON / 坏 schemaVersion ⇒ 抛错，不许静默当空列表**。错误 `code = 'E_VALIDATION'`，中文 message 含原因。
4. `saveCards([])` 之后 `loadCards()` 必须是 `[]`（删空后机制照常）。

---

## 4. 引擎（`src/core/engine.ts`）

### 4.1 公共 API

```js
export async function runTurn({ card, save, presets, nodePresets, action, onEvent, signal }) -> { save, events, debug }
export function resolveNodePreset({ presets, nodePresets, nodeId }) -> Preset   // 纯函数：单个节点的模型解析
export function applyWrite({ card, node, tree, path, value }) -> tree           // 纯函数，返回新 tree
export function advanceTime(tree, hours) -> tree                               // 纯函数
```

- `runTurn` **不修改入参**（`save` / `card` / `presets` / `nodePresets` 只读），返回**新的** `save` 对象。
- 失败一律 `throw AppError`（见 §6），不许返回 `{ error }` 之类的混合形状。
- **模型怎么来**（§2.5）：`presets` 是本机的预设池（`tg2.presets` 整张表），
  `nodePresets` 是这张卡那一片映射（`tg2.nodeModels[cardId]`，可以缺省 / 是 `{}`）。
  每个节点的解析规则（`resolveNodePreset`，四个节点各解析一次）：
  1. `nodePresets?.[nodeId]` 有值 ⇒ 在 `presets` 里按 id 找；
  2. 没有 ⇒ 用 `presets[0]`；
  3. 找不到（池子空、或映射指向一个已被删掉的预设）⇒ `E_VALIDATION`
     （消息说「这个节点的模型预设没了 / 还没有模型预设」，下一步指向设置页）。
     **卡里没有、也不许有模型绑定**：卡上残留的 `presetId` 一律忽略。
- `debug`（第 2 关新增的返回字段，`?debug=1` 要用）：
  `{ prompts: { [nodeId]: string }, responses: { [nodeId]: string }, tools: [{ nodeId, name, args }],
 usage: object|null, presets: { [nodeId]: presetId } }`
  —— `debug.presets` 是**解析结果**（哪一步用了哪个预设），排障就靠它。

### 4.2 一回合的执行

`runTurn` 顺序做四件事，**任何一步失败都中止本回合、存档保持调用前的样子**：

1. `validateCard(card)` → `validateSave(save, card)`；`card` 与 `save.cardSnapshot` 必须**同 id**。
   （调用方通常直接传 `save.cardSnapshot` 当 `card`，但两者不一致时以参数为准并校验同 id。）
2. 追加一条 `action` 事件（`text = action`）。
3. 按 `chain` 顺序逐节点执行（§4.3）。每节点**恰好一次** provider 调用（阶段 1 不做多步工具循环）。
   每节点开头追加一条 `node` 事件：`{ type:'node', text: <node.name>, detail: { id, type } }`。
4. 回合收尾：`turn += 1`、`updatedAt` 刷新、返回 `{ save, events, debug }`。
   `save.events` = 旧事件 + 本回合新事件；返回的 `events` = **只有本回合新事件**（同一批对象）。

### 4.3 节点类型语义

| type     | 允许的工具调用                 | 时间 / 状态的落点                                      | 进故事流吗               |
| -------- | ------------------------------ | ------------------------------------------------------ | ------------------------ |
| `time`   | `advance_time({ hours })`      | `tree['0'] = advanceTime(tree['0'], hours)`            | 否                       |
| `normal` | `write_state({ path, value })` | 只能写 `node.writable` 里的 code；`value` 必须是字符串 | 否                       |
| `output` | 无                             | 无                                                     | **是**（只有它进故事流） |
| `proof`  | 无                             | 只读                                                   | 否                       |

- `advanceTime(tree, hours)`：`hour += hours`；`day += Math.floor(hour / 24)`；`hour = ((hour % 24) + 24) % 24`。
  `hours` 必须是整数，否则 `E_VALIDATION`。
- `applyWrite`：`path` 不在 `node.writable` ⇒ `E_CHAIN`（`detail = { path, writable }`）；
  `path` 不在 `card.state` ⇒ `E_CHAIN`（`detail = { path }`）；`value` 不是字符串 ⇒ `E_VALIDATION`。
  合法则返回**新** tree（浅拷贝改一个键，入参 tree 一个字都不改）。
- 工具调用被引擎执行时各记两条事件：`tool`（`detail = { name, args }`）与 `write`（`detail = { path, value }`）。
  模型回文本里的工具调用（非原生 `tool_calls`）**一律不认**。
- 节点文本：`output` 节点的文本 → `narration` 事件（`text` 为整段）；其余节点的文本只进 `debug.responses`。

### 4.4 流式与中止

- `output` 节点边收边回调 `onEvent({ type: 'chunk', text })`，`text` 是**增量**；把该节点所有 chunk 拼起来
  === 该节点最终 `narration` 事件的 `text`。
- 其余节点不流式（可以有 chunk，但测试只认 output）。
- `signal`（`AbortSignal`，可选）：中止 ⇒ 已发出的 chunk 之后不再回调，`runTurn` 以 `Error.code = 'E_ABORTED'` reject；
  **本回合不写入任何持久事件、`save` 不变**（调用方拿回的就是原存档）。
- 中止不是「错误现场」：界面按「用户主动停止」处理（§9.2）。

### 4.5 provider 调用（`provider: 'openai-compatible'`）

- `POST ${baseUrl}/chat/completions`，头 `Authorization: Bearer ${apiKey}`、`Content-Type: application/json`；
  body 至少 `{ model, stream: true, messages: [{ role, content }, ...], tools: [...] }`。
- `apiKey` 为空 ⇒ **不发请求**，直接 `E_PROVIDER`（消息说明「没填 Key」+ 下一步指向设置页）。
- 4xx/5xx、断网、DNS 失败、超时（阶段 1 不设主动超时，但 fetch 自身失败要归到 `E_PROVIDER`）⇒ `E_PROVIDER`。
- 上游报文原样塞进 `detail.upstream`；界面**不许**只显示英文原文。

---

## 5. 提示词拼装（`src/core/prompt.js`）

```js
export function buildPrompt({ card, save, node, action, upstream }) -> string
```

`upstream` = 上一个已执行节点的输出文本（没有就空字符串；`node.readsUpstream === false` 时忽略）。
拼接顺序**固定**（SPEC §4；🔴 **没有独立的「玩家行动」段** —— 2026-11-25 老板口径）：

1. **公共提示词**：`card.prompts` 顺序里 `id ∈ node.reads` 的，`body` **逐字**；
2. **状态树**：`card.state` 顺序里 `code ∈ node.reads` 的，一行一个「`<code> <name> = <值>`」；
   时间元素的值渲染成 `day <n> hour <n>`（例如 `0 time = day 1 hour 8`）；
3. **历史（含本回合行动）**：**一个块**。先按时间从旧到新排开最近 `node.historyTurns` 个
   **已完成**回合（每个回合的 `action` 一行、`narration` 一行），
   **然后把本回合的 `action` 接在这个块的末尾**（它是「刚刚发生的事」，不是独立一段）；
4. **上游输出**：`node.readsUpstream && upstream !== ''` 时，`upstream` **逐字**；
5. **本节点提示词**：`node.prompt` **逐字**（空则省略）。

🔴 **状态读的是「此刻的 tree」**（第 1 轮评审 P2）：链上更早的节点在同一回合里写下的值
（时间推进、判定写入）**必须**出现在后面节点的状态段里 —— 引擎每跑一个节点就把**当时的 tree**
交给 `buildPrompt`，不是回合开始前那份。判据：`v2/tests/engine.test.js` 的「同一回合内的写入立刻可见」。

段与段之间用换行分隔，**具体分隔符与段标题由实现定**（测试不断言标题）；但要求：

- 上面 1–5 里出现的**任何一段正文都要在结果里逐字可见**（不能截断、不能转义）；
- 段与段的**相对顺序**必须如上（测试用 `indexOf` 判）；**本节点提示词是最后一段**；
- 眼睛关掉的块 / 元素 / 上游，**对应正文一个字符都不许出现**；
- 历史只取 `action` + `narration`（不含 `node`/`tool`/`write` 之类事件）；
- 🔴 **行动只出现一次，且只在历史块里**（本回合行动恒为这一块的最后一条）：
  - `historyTurns` 数的是**已完成**的回合：`3` ⇒ 前 3 个完整回合 + 本回合行动；
  - `0` ⇒ 块里**只有本回合行动**（模型照样知道玩家要做什么 —— 这是本契约钉的口径，
    见 §9.5 第 12 条对「N 是否含本回合」这句歧义的处置）；
  - 判据：`historyTurns: 0` 且**节点提示词与上游都为空**时，整条提示词里行动只出现一次、且它就在最后。

眼睛语义一句话：**`reads` 里有它就读，没有就不读**；`readsUpstream` 是上游输出的开关；`writable` 是写的开关。

---

## 6. 错误（`src/core/errors.js`）

```js
export class AppError extends Error {
  constructor(code, { message = '', nextStep = '', detail, cause } = {})
  code      // 'E_PROVIDER' | 'E_VALIDATION' | 'E_CHAIN' | 'E_UNKNOWN' | 'E_ABORTED'
  message   // 中文，面向作者/玩家的一句话
  nextStep  // 中文，告诉人下一步点什么
  detail    // 可选，给调试面板（可能是英文原文）
}
export const CODES = ['E_PROVIDER', 'E_VALIDATION', 'E_CHAIN', 'E_UNKNOWN', 'E_ABORTED']
```

- 每个码都有**默认的**中文 `message` + `nextStep`（住 `locales/zh-CN.json`）：
  `new AppError('E_PROVIDER')` 不传文案也必须拿到中文提示（不是空串、不是英文）。
  传了 `{ message, nextStep }` 就覆盖默认值。
- 所有面向玩家的错误都必须是这个类的实例（`instanceof Error` 且带 `code`），
  `detail` 里放上游原文，**正文不许只给英文**。

| 码             | 什么时候                                                        | message 要说清什么           | nextStep 要指向              |
| -------------- | --------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| `E_PROVIDER`   | 网络 / key / 额度 / 上游 4xx-5xx                                | 哪一步连不上（不填英文原文） | 设置页检查 Key 与 Base URL   |
| `E_VALIDATION` | 卡或存档结构不合法、坏 JSON、schemaVersion 不认、id 不存在      | 哪个字段/对象坏了            | 回首页重开或重建存档         |
| `E_CHAIN`      | 链不合法（输出数、校对数、时间数、首节点上游）、写非 `writable` | 哪一条链规则、哪个节点 id    | 回编辑器改链                 |
| `E_UNKNOWN`    | 兜底（不许用来吞掉已知错误）                                    | 发生了什么                   | 刷新/看控制台                |
| `E_ABORTED`    | 用户点「停止」                                                  | 你中止了本回合               | 无（界面按停止处理，不弹错） |

**判据**：五个码的 `message` 与 `nextStep` 都必须含中文（正则 `[\u4e00-\u9fff]`），且 `nextStep` 非空。

### 6.1 链校验（`schema.js` 的 `validateCard`）

按 SPEC §2 的链约束，命中就抛 `E_CHAIN`，`message` 里必须写出**节点 id** 或**规则名**：

- `chain` 里 `type === 'output'` 恰好 1 个（0 个 / ≥2 个都错）；
- `type === 'proof'` 最多 1 个；`type === 'time'` 最多 1 个；`chain.length ≥ 1`；
- 首节点 `readsUpstream` 必须 `false`；
- 节点 `id` 唯一；`historyTurns` 是 ≥0 的整数；
- `reads` / `writable` 里的引用必须存在（提示词 id 或状态 code），否则 `E_VALIDATION`（指名悬空引用）。
- **`presetId` 不在这里校验**：阶段 1 允许卡带着空 / 已失效的 `presetId` 存着（预设可以后配），
  它到 `runTurn` 取预设那一步才报 `E_VALIDATION`（见 §4.1）。

`validateSave(save, card)`：`schemaVersion === 1`、`id`/`cardId` 非空、`turn` 是 ≥0 整数、
`tree` 覆盖 `card.state` 的全部 code 且 `'0'` 是 `{day,hour}`、`events` 是数组。

---

## 7. mock 提供方（`src/core/mock.js`）—— 测试替身

`preset.provider === 'mock'` 时**不发任何网络请求**，按节点类型回确定的响应（同一输入同一输出）：

| 节点     | 回什么                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `time`   | 一次原生工具调用 `advance_time({ hours: 1 })`，文本空                                                                                       |
| `normal` | 若 `node.writable` 非空：一次原生工具调用 `write_state({ path: <writable[0]>, value: 'mock-t<turn>' })`；否则空响应                         |
| `output` | 文本 `[mock] turn <turn>: <action>`，**流式**：按 ≤8 字符切块，每块之间等 `mockChunkDelayMs`（缺省 0），块数 ≥3（文本短时也一样切成 ≥3 块） |
| `proof`  | 文本 `[mock] proof turn <turn> ok`，无工具                                                                                                  |

- mock 走的**是同一套事件/流式代码路径**（`chunk` → `narration`），不是另一条捷径。
- `[mock] turn 2: act two` 这种整串是**逐字**可断言的（`turn` 用阿拉伯数字）。
- 为什么要有它：阶段 1 的验收要在没有 Key、没有网络的机器上跑出「3 回合流式 + 中止 + 眼睛」，
  真 key 那一条（SPEC §9.8）只能人工验收，留一格给组长。

---

## 8. 页面与路由（`src/main.ts` + `src/pages/*.vue`）

- **hash 路由**，`index.html` 只有一个 `#app` 容器；`hashchange` + 首次 `load` 都渲染 ⇒ 刷新 / 深链不白屏。
  `vite.config.mjs` 不需要 SPA 回退（hash 不发给服务器）。
- 路由表在 `src/router.ts`（原生 `hashchange`，四个页面组件用 `<component :is>` 切），**不引入 vue-router**。
  页面组件用 `ref` / `reactive` + `core` 模块管状态，**不引入 pinia**。

| hash                     | 页面       | 钩子                     |
| ------------------------ | ---------- | ------------------------ |
| `#/`                     | 首页       | `[data-page="home"]`     |
| `#/edit/:cardId`         | 卡带编辑器 | `[data-page="editor"]`   |
| `#/play/:cardId/:saveId` | 对话页     | `[data-page="play"]`     |
| `#/settings`             | 设置       | `[data-page="settings"]` |

- 每条页面左上角有返回按钮 `[data-back]`；设置页返回到来源页（或 `#/`）。
- id 不存在 / 卡存档对不上 ⇒ 错误页 `[data-error]`（§9.4），**不白屏**。
- `?debug=1`：`location.search` 含 `debug=1` 时对话页显示调试面板。

### 8.1 首页

- 两栏并排：左卡带列表 `[data-card-list]`，右存档列表 `[data-save-list]`。
- 卡带列表右上 `[data-new-card]`（点击立刻建卡并落盘，默认名 `card <n>`，不需要弹窗）；
  存档列表右上 `[data-new-save]`（基于当前选中卡；没有选中卡时禁用）。
  新建存档：默认名 `save <n>`，**追加到列表末尾**、**不跳转**，
  `tree` 取卡的当前初值、`cardSnapshot` = 当时的整张卡深拷贝。
- 卡行：`[data-card-id="<id>"]`（**点击 = 选中这张卡**，不跳页 —— 新建存档要靠它）、
  `[data-card-name]`、`[data-card-edit]`（行内「编辑」，进 `#/edit/:cardId`）、
  `[data-card-rename]`、`[data-card-delete]`、`[data-card-count]`（该卡的存档数）。
- 行内重命名：点击 `[data-card-rename]` 后该行出现输入框 `[data-rename-input]`，
  回车提交、Esc 取消；提交后的名字立即落盘。
- 存档行：`[data-save-id="<id>"]`（点击 = 进入对话页）、`[data-save-name]`、
  `[data-save-meta]`（文本里必须含卡名与回合数数字）、`[data-save-rename]`、`[data-save-delete]`。
- 删除必须确认：`[data-card-delete]` / `[data-save-delete]` 点击后出现确认层
  `[data-confirm]`，其中 `[data-confirm-ok]` 才真删、`[data-confirm-cancel]` 取消。
  **删卡连带删掉它的全部存档**（存档的 `cardId` 指向它）**和它的模型映射 `tg2.nodeModels[cardId]`**；
  删存档不动卡。判据：`v2/e2e/empty.spec.js` / `v2/e2e/snapshot.spec.js`。
- 空态：没有卡时 `[data-empty-cards]` 可见（中文文案「还没有卡带」），没有存档时 `[data-empty-saves]` 可见。

### 8.2 编辑器

四区一行排开：`[data-col="left"]` · `[data-workflow-strip]` · `[data-col="middle"]` · `[data-col="right"]`。

- **栏宽**：`[data-splitter="left"]` **在左栏的右缘**（往**右**拖 = 左栏变宽）；
  `[data-splitter="right"]` **在右栏的左缘**（往**左**拖 = 右栏变宽）——两个分隔条位置相反，方向也相反。
  两者都由中栏吸收。`[data-workflow-strip]` 宽度**固定**（不参与拖拽）。双击分隔条恢复默认（左 280 / 右 320）。
  夹取：左 `[200, 480]`、右 `[240, 560]`，且中栏不得小于 320。
  落盘到 `tg2.settings.editorColumns`（**整数像素**，拖拽结束就写），刷新后保留。
  自由度只有两个（左、右）—— 三栏宽度都随拖动变化，中栏恒为余量。
- 状态树 `[data-state-tree]`：每行 `[data-state-item="<code>"]`，行内 `[data-state-code]`（显示编码）、
  `[data-state-name]`、`[data-delete-state]`（`'0'` 不许有）；`[data-add-state]` 新增元素。
  行内眼睛 `[data-eyes="read"]` / `[data-eyes="write"]`，带 `data-on="true"|"false"`，
  **只在选中了工作流节点时显示**，点击切换「当前选中节点」读/写这个元素。
- 中栏三形态（互斥，按选中对象切换）：
  - 选中节点：`[data-node-prompt]`（textarea）、`[data-node-preset]`（select）、
    `[data-node-history]`（number）、`[data-node-upstream]`（带 `data-on`；**首节点禁用**：
    `data-on="false"` + `aria-disabled="true"`，点了也不翻面）。
  - 选中元素：`[data-field="name"]`、`[data-field="note"]`、`[data-field="initial"]`（时间元素时该框只读）。
  - 没选：中栏显示空态 `[data-empty-middle]`。
- `[data-node-preset]`：选项 = `tg2.presets` 全部；**当前值 = 这个节点解析出的预设 id**
  （映射里没有就是 `presets[0].id`，§2.5）；改动写 `tg2.nodeModels[cardId][nodeId]`，**不动卡**。
  一个预设都没有时它是空的、`aria-disabled="true"`（并给出「先去设置页加一个预设」的中文提示）。
  判据：`v2/e2e/node-models.spec.js`。
- 工作流细条 `[data-workflow-strip]`：四个 `[data-node-id="<id>"]`，点击选中（带 `data-selected="true"`）。
- 右栏 `[data-prompt-list]`：每块 `[data-prompt-block="<id>"]`，块内 `[data-prompt-title]`、
  `[data-prompt-body]`（textarea）、`[data-prompt-eyes]`（同眼睛语义，`data-on`）、`[data-delete-prompt]`；
  `[data-add-prompt]` 新增块（新 id 由创建方生成）。
- **没有「保存」按钮**：字段改动（input / change / blur）即时写 `tg2.cards`。
  切走页面再回来、刷新后都还在。（判据：`v2/e2e/loop.spec.js`。）

### 8.3 对话页

- 结构：`[data-cover]`（卡名 + 存档名 + `[data-start]` 开始/继续）→ `[data-story]` → 输入区
  `[data-action-input]`（textarea）+ `[data-send]`。
  存档 `turn === 0` 时 `[data-start]` 文案是「开始」，否则「继续」；点它收起封面、露出故事流与输入区。
- **跑的一律是 `save.cardSnapshot`**（不是 `tg2.cards` 里那张现卡）：改卡 —— 含改提示词、改眼睛、
  改初值 —— **只影响之后新建的存档**。旧存档按它冻结时的那张卡跑（SPEC §2 / §9.4）。
  ⇒ 「关掉眼睛看 prompt 变化」的验收流程是：改眼睛 → **新建存档** → 跑一回合 → 看 `?debug=1`。
- 故事流：每条 `action` 一个 `[data-line="action"]`，每条 `narration` 一个 `[data-line="narration"]`。
  **只有 `output` 节点的文本进故事流**。
- 顶部：`[data-turn]`（`textContent` **恰好是回合数**，纯阿拉伯数字）、`[data-status]`（保存状态，完成一回合后非空）、
  `[data-back]`。
- 发送：`[data-send]` → 禁用输入框、显示 `[data-stop]`、流式写入本回合 narration 元素；
  完成后隐藏 `[data-stop]`、恢复输入、更新 `[data-turn]` 与 `[data-status]`，并把结果写回 `tg2.saves`。
- 停止：点 `[data-stop]` ⇒ 中止本轮、**丢弃本轮半截文本**（故事流回到本轮开始前）、
  输入框恢复、`[data-action-input]` 保留刚才写的行动、存档不变。
- 出错：`[data-error]` 出现，其中 `[data-error-code]` = 错误码字符串、`[data-error-next]` = 下一步中文；
  界面不白屏、不丢卡（判据：`v2/e2e/errors.spec.js`）。
- `?debug=1`：`[data-debug]` 面板含 `[data-debug-prompt]`（本回合每个节点拼出的提示词，
  每个节点用 `[node:<id>]` 这样的标题分隔）、`[data-debug-response]`、`[data-debug-tools]`、
  `[data-debug-usage]`、`[data-debug-presets]`（每个节点**实际用了哪个预设** —— 模型是本地映射，
  这一格是排障时唯一看得见它的地方，§2.5）。

### 8.4 设置

- `[data-theme="light"]` / `[data-theme="dark"]`：点击切换，写 `tg2.settings.theme`，刷新保留；
  `document.documentElement` 上要有 `data-theme` 属性（CSS 用）。
- 预设列表 `[data-preset-list]`，每条 `[data-preset="<id>"]`：`[data-preset-name]`、`[data-preset-baseurl]`、
  `[data-preset-model]`、`[data-preset-key]`、`[data-preset-reasoning]`、`[data-delete-preset]`；
  `[data-add-preset]` 新增。改动即时落盘 `tg2.presets`。
- 默认两条 DeepSeek 预设（V4 Pro / Flash）——**只在新装（`tg2.presets` 无键）时**由设置页写一次；
  用户删光了就是空的，**不许每次打开又长回来**。

### 8.5 响应式与横屏

- 桌面最小 1280×720，兼容 16:9 / 16:10 / 4:3 / 21:9，最大 4K；**任何档位不许横向溢出**。
- 手机竖屏（`(max-width: 767px) and (orientation: portrait)`）⇒ `[data-landscape-overlay]` 可见，
  含中文提示「请横屏使用」与按钮 `[data-landscape-retry]`（点击尝试 `screen.orientation.lock('landscape')`，
  失败后显示 `[data-landscape-hint]` 中文提示手动旋转）。
- 横屏（如 844×390）⇒ 遮罩不可见，页面可交互（不是「手机档布局」，就是同一套布局）。

---

## 9. 测试与钩子

### 9.1 命令

| 命令                    | 作用                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `npm run v2:test`       | vitest 跑 `v2/tests/**/*.test.js`（node 环境，被测模块是 `src/core/**/*.ts`） |
| `npm run v2:test:watch` | 同上，watch                                                                   |
| `npm run v2:typecheck`  | `vue-tsc --noEmit -p v2/tsconfig.json`（TS 的收口；红了就别提交）             |
| `npm run v2:e2e`        | Playwright 跑 `v2/e2e/**/*.spec.js`（构建 `dist/v2` + `vite preview`）        |

配置在 `v2/vitest.config.mjs` / `v2/playwright.config.mjs` / `v2/tsconfig.json` / `v2/vite.config.mjs`；
旧站的 `vitest.config.ts` / `playwright.config.ts` / `tsconfig.app.json` 一个字节都不动
（它们的 `include` 是根目录锚定的，照不到 `v2/`）。

SPEC §7 点名的另外两条根脚本也一并加好了（都是纯构建配置，没有产品逻辑）：
`npm run v2:dev` / `npm run v2:build`。`v2:stories` 等 stories 那一票再补。

🔴 **`v2/vite.config.mjs` 里的 `root` 不是可选项**：不写它，vite 用命令行 cwd 当 root，
在仓库根跑 `npm run v2:build` 会把**旧站**当入口构建（实测发生过：吐出旧站的
`dist/v2/index.html` + 旧站 assets，还因为旧站的虚拟模块插件没加载而报 `virtual:prompt/...`）。
`build.outDir` 是**相对 root** 解析的，所以 `root: v2/` + `outDir: '../dist/v2'` 才落在仓库的 `dist/v2`。

### 9.2 测试用的数据与状态

- 单测**不许发真网络请求**（`E_PROVIDER` 那条用 `http://127.0.0.1:1` 立刻拒连即可）；
- 单测文件写成 `.js`（vitest 直接跑，**不进 `vue-tsc`**）：判据量的是行为，不是类型；
  类型那一侧由 `v2:typecheck` 收口，两件事不混在一份文件里。
- e2e 用 `provider: 'mock'` 的预设（§7）；需要「真 provider 路径」的用例用 `page.route` 拦接口，不联外网；
- e2e 的种子数据走 `addInitScript` 写 `tg2.*`，不 import 产品模块、不往仓库塞卡文件。
- 组件级单测（jsdom + `@vue/test-utils`）**本关不建**：组件行为由 e2e 的 `data-*` 钩子钉（§8），
  真需要时在 `v2/tests/` 里加 `// @vitest-environment jsdom` 的文件（`jsdom` 仓库里已有）。

### 9.3 中文文案住在 `.json`（提交钩子的硬约束）

`.githooks/checks/ascii.mjs` 对 `\.(ts|tsx|vue|css|html|js|mjs|cjs)$` 查非 ASCII（注释除外），
豁免表里的 `^src/locales/` 是**旧站根目录**，照不到 `v2/src/locales/`。`.json` 不在被查扩展名里。
⇒ 落地口径：

1. **所有中文文案**（界面、错误 `message` / `nextStep`、默认名）写在 `v2/src/locales/zh-CN.json`，
   形如 `{ "home.empty": "还没有卡带", ... }`；代码里只出现 key（`t('home.empty')`）。
   （这与钩子自己的提示「文案一律走 `t('some.key')`，然后加进 locale 文件」一致。）
   `.vue` 模板里的中文也走 `{{ t('key') }}`，不许直接写字面量。
2. **`.ts` / `.vue` / `.html` / `.css` / `.js` 里不许出现中文字面量**（含 `index.html` 的 `<title>`），注释除外。
3. 测试源码（`v2/tests` / `v2/e2e`）**现在已经豁免**（`.githooks/checks/ascii.mjs` 的 `TEST_TOOL`
   加了 `^v2/tests/` / `^v2/e2e/` / `^v2/stories/`，与旧站 `e2e/` 同一口径）—— 中文断言可以照写。
   本契约的测试仍然把中文写成 `[\u4e00-\u9fff]` 正则：**行为判据不需要抄文案**，抄了反而会跟着改文案变红。
   `.json` 完全不在检查范围内（这就是文案表的落点）。

### 9.4 判据清单（谁钉哪条 SPEC §9）

| 验收                                                   | 判据                                                     |
| ------------------------------------------------------ | -------------------------------------------------------- |
| §9.1 空态 / 删空后仍可用                               | `v2/e2e/empty.spec.js`                                   |
| §9.2 建卡→编 2 元素+初值+2 提示词→存档→3 回合→刷新还在 | `v2/e2e/loop.spec.js`                                    |
| §9.3 眼睛控制提示词拼装                                | `v2/e2e/eyes.spec.js` + `v2/tests/prompt.test.js`        |
| §9.4 改卡后旧存档仍能跑                                | `v2/e2e/snapshot.spec.js`                                |
| §9.5 四类比例 + 4K 不溢出 / 手机竖屏遮罩               | `v2/e2e/responsive.spec.js`                              |
| §9.6 三栏可拖 / 细条固定 / 双击恢复 / 刷新保留         | `v2/e2e/editor-columns.spec.js`                          |
| §9.7 组件故事 + 像素基线                               | **不在本契约**（stories 那一层由后续一票补，见 §10）     |
| §9.8 流式可停止 / 错误中文                             | `v2/e2e/stream-abort.spec.js` + `v2/e2e/errors.spec.js`  |
| §9.9 线上 `/v2/` 可打开、旧站仍可用                    | 人工 + 发布流程（不在本契约）                            |
| 链校验（输出/校对/时间/首节点上游）                    | `v2/tests/chain.test.js`                                 |
| 错误码五条都有中文 + 下一步                            | `v2/tests/errors.test.js`                                |
| 存储五键 / 无种子 / 删空 / 坏 JSON / 坏映射            | `v2/tests/storage.test.js`                               |
| 模块边界（无旧站 / core 不碰 DOM 与 Vue）              | `v2/tests/boundaries.test.js`                            |
| 引擎语义（顺序、写入、流式、中止、快照）               | `v2/tests/engine.test.js`                                |
| 模型不进卡 / 逐节点解析 / 缺预设即报错 / 删卡清映射    | `v2/tests/engine.test.js` + `v2/e2e/node-models.spec.js` |
| 夹具自身合法性（正控：夹具坏了下面每条红都不可信）     | `v2/tests/fixtures.selfcheck.test.js`                    |

### 9.5 第 2 关替实现钉下的、SPEC 没写死的决定（组长可否决）

1. 一节点**一次** provider 调用（不做多步工具循环）——阶段 1 够用，多步留给阶段 3。
2. `applyWrite` 越权写 ⇒ **`E_CHAIN`**（不是 `E_VALIDATION`）：它违反的是链里的 `writable` 声明。
3. 新增错误码 **`E_ABORTED`**（SPEC §4 只列了四个）：停止是正常路径，不能与 `E_PROVIDER` 混。
4. 时间元素初值 `{day:1,hour:8}` 且**只读**（阶段 1 不提供编辑）。
5. 栏宽只存 `{left, right}`（中栏 = 余量），默认 280 / 320。
6. 编辑器**无保存按钮**，改动即时落盘。
7. mock 提供方的输出文本格式（§7）——只给测试用，玩家看不到。
8. `runTurn` 多返回一个 `debug` 字段（`?debug=1` 需要它，SPEC 只写了 `{save, events}`）。
9. **不引入 vue-router / pinia**（原生 hashchange）；`v2/tsconfig.json` 是必需文件（§1.1）。
10. 单测文件是 `.js`、不进类型检查；组件故事与组件级单测留到 stories 那一票。
11. 🔴 **模型绑定不进卡**（组长 2026-11-25 决定，**覆盖 SPEC §2**）：SPEC 里 `chain[]` 带 `presetId`、
    `runTurn({ preset })` 取一个预设；本契约改为 `chain[]` **没有** `presetId`，模型住在本地映射
    `tg2.nodeModels = { [cardId]: { [nodeId]: presetId } }`（§2.5），引擎收 `presets` + `nodePresets`。
    理由：Key / Base URL / 模型是玩家本机的东西，不该跟着卡和存档走；卡要能原样带走。
    ⇒ **SPEC.md §2 / §4 那段需要组长同步改**（我不改他的文件）。
12. 🔴 **提示词里没有独立的「玩家行动」段**（老板 2026-11-25 决定，**覆盖 SPEC §4 的六段顺序**）：
    行动作为历史块的**最后一条**进来（§5）。
    ✅ **组长 2026-11-25 裁定：采用 (A)**（`historyTurns` 数**已完成**回合，本回合行动**恒**接在块尾；
    `historyTurns=0` 也看得见行动）。下面这段歧义记录留着当现场：
    老板原话是「history = last N turns **including this action**」。两种读法：
    - **(A) 已裁定采用**：`N` 数的是**已完成**回合，本回合行动**恒**接在块尾
      （`0` ⇒ 块里只余本回合行动）。依据：老板同一句里还说「action **appended as the last entry** of
      the history block」——先有块、再把行动接上去；且这样 `N=0` 不会把玩家行动悄悄弄丢。
    - (B) `N` 含本回合（`3` = 前 2 完整回合 + 本回合；`0` ⇒ 行动也一起没了）——**不采用**。

### 9.6 本关不做（别在阶段 1 拿它们当判据）

组件故事 / 像素基线（stories 层另开一票）· 导入导出 · 节点增删排序 · 状态树类型与嵌套 ·
重生成/撤销 · 连接测试 · token 费用 · 多语言 · 自定义主题色 · 显示面板（SPEC §8）。
