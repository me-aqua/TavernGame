# TavernGame v2 · 技术契约（CONTRACT）

> 技术栈：Vite + Vue 3 + TypeScript；provider 由浏览器直连（Vercel AI SDK），Key 只存本机。
> 需求上游是 `v2/SPEC.md`；冲突以 SPEC 为准并报组长；已落进本文的口径以本文为准。

## 0. 四条总则

1. **新旧站隔离**：`v2/` 是独立 Vite 应用，不 import 旧站 `src/` 的组件 / store / 类型，不读写旧站 `tg.*`，也不搬旧站的卡格式 / 状态树；判据 `v2/tests/boundaries.test.js`。
2. **项目本体不含玩家数据**：仓库里没有卡 / 存档 / 预设种子；卡与存档只住浏览器 localStorage 的 `tg2.*`（示例卡资产与首次种入见 §3.1）。
3. **中文文案住在 `v2/src/locales/zh-CN.json`**：`.ts` / `.vue` / `.html` / `.css` / `.js` 只出现 key（`t('key')`），注释除外；这是提交钩子的硬约束（§9.3）。
4. **Vue 只负责界面**：存储 / 引擎 / 提示词 / 校验是 `src/core/**` 的纯 TS；不 import `vue`、不碰 DOM，引擎可在 node 里单测。

## 1. 目录与模块边界

```text
v2/
  index.html  SPA: #app + /src/main.ts（纯 ASCII）
  vite.config.mjs  root v2/, base '/TavernGame/v2/', outDir '../dist/v2', plugin vue()
  tsconfig.json  strict + include src/**/*.ts|vue + stories/**/*.ts + .storybook/**/*.ts
  scripts/check-lines.mjs  v2 文件长度闸（800 行）
  src/  main.ts  router.ts  i18n.ts  env.d.ts
    core/  storage.ts errors.ts prompt.ts engine.ts schema.ts mock.ts (+ provider.ts deadline.ts types.ts)
    components/*.vue  pages/ HomePage.vue EditorPage.vue PlayPage.vue SettingsPage.vue  locales/zh-CN.json  data/sample-card.json  styles/*.css
  tests/  vitest（node，被测 src/core/**）  e2e/  Playwright（dist/v2）  stories/ .storybook/  组件故事与巡检
```

**硬边界**

| 规则                                                                       | 说明                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------- |
| `src/core/**` 不 import `vue` / `components/` / `pages/`                   | 引擎与存储要能在 node 里单测                             |
| `src/core/**` 不碰 `document` / `window` / `globalThis.localStorage`       | 存储 backend 由调用方注入，只有 `main.ts` 给浏览器默认值 |
| `src/**` 不 import 旧站（`../../src/`、`@/`、`cards/`）、`react`、`svelte` | 新旧站隔离；`@/` 是旧站别名                              |
| `src/**` 不把示例卡 / 存档搬进项目                                         | 数据与本体分离                                           |
| 不引入 `vue-router` / `pinia`                                              | 原生 hashchange + 一份 localStorage                      |

`v2/tsconfig.json` 是硬要求：`strict` 与 `include` 不许去掉。
`v2/vite.config.mjs` 的 `root` / `base` / `build.outDir` 与 vue 插件不许去掉。

## 2. 数据模型（`schemaVersion: 1`）

### 2.1 Card

```js
{
  schemaVersion: 1,
  id: 'c-<string>', name: string,        // id 创建时生成且稳定；name 非空，重命名只改它
  state: [{ code, name, note, type: 'string', initial: string | { day: number, hour: number } }], // 单层
  chain: [{ id, type: 'time' | 'normal' | 'output', name,
            reads: string[], writable: string[], readsUpstream: string[],
            historyTurns: number, prompt: string }], // 顺序即执行顺序
  prompts: [{ id, title, body }]
}
```

- **卡里不许存模型绑定**（没有 `presetId` 字段）：模型住在 `tg2.nodeModels`（§2.5），不进卡、不进存档、不随导入导出走。
- `validateCard` 对多余字段宽容：卡里残留 `presetId` 不报错，但引擎一个字节都不看；判据 `v2/tests/engine.test.js`。
- `state[0].code` 固定 `'0'`（时间元素），它在 `tree` 里的值是 `{ day, hour }`，其余元素是字符串；`'0'` 不可删除。
- 时间初值界面是两个数字框（`[data-field="initial-day"]` ≥1 / `[data-field="initial-hour"]` 0–23），可改并即时落盘；其余元素初值是字符串。
- `reads` 是混合数组：`prompts[].id` = 读这块公共提示词，`state[].code` = 读这个元素；创建方保证同一字符串不同时是两者。
- 新建卡默认三节点（顺序 / id / name / reads / writable / readsUpstream / historyTurns / prompt）：

| #   | id       | type     | name | reads | writable                               | readsUpstream | historyTurns | prompt |
| --- | -------- | -------- | ---- | ----- | -------------------------------------- | ------------- | ------------ | ------ |
| 1   | `time`   | `time`   | 时间 | `[]`  | `['0']`                                | `[]`          | `0`          | `''`   |
| 2   | `check`  | `normal` | 判定 | `[]`  | `[]`（建卡时只有 `'0'`；新增不自动加） | `[]`          | `0`          | `''`   |
| 3   | `output` | `output` | 输出 | `[]`  | `[]`                                   | `['check']`   | `3`          | `''`   |

`id` 是结构（选择器 / 链引用 / 测试），必须 ASCII 且稳定；`name` 是展示文案，住 `locales/zh-CN.json`。

- 新建卡 `state = [{ code:'0', name:'时间', note:'', type:'string', initial:{day:1,hour:8} }]`，`prompts = [{ id:'opening', title:'开场', body:'' }]`；每张卡都带 `opening`，标题来自 `card.openingTitle`，永远排第一。
- 新增状态元素 / 提示词块不自动进入任何节点的 `reads` / `writable`，作者用眼睛打开。
- **不做旧卡兼容 / 迁移**：没有 `normalizeCard`；缺 `opening`、带 `proof`、`readsUpstream` 是布尔的老卡，`validateCard` 直接报中文 `E_VALIDATION`（链规矩坏了是 `E_CHAIN`），不补字段。
- `readsUpstream` 是节点 id 数组，只能引用链上排在它前面的节点（自己与下游 ⇒ `E_CHAIN`）；空数组 = 不读上游。
- `historyTurns`：最近 N 条叙事 + 最近 N 条行动（含本回合）；本回合行动恒为历史块最后一条（详见 §5）。

### 2.2 Save

```js
{
  schemaVersion: 1, id: 's-<string>', cardId: string,
  cardSnapshot: Card,                    // 新建时整张卡深拷贝，此后不随卡改动
  nodeModels?: { [nodeId]: presetId },   // 这一份存档自己的映射；缺省 = 回落卡级
  name: string, turn: number,            // 已完成回合数；新建为 0
  tree: { [code]: string | { day, hour } },
  events: Event[], updatedAt: string     // ISO 时间戳
}
```

- `tree` 新建时从 `cardSnapshot.state[].initial` 逐个深拷贝；`tree['0']` 恒为 `{ day, hour }`，其余键恒为字符串。
- `Event = { type, text, detail?, at }`，`type` 允许 `'action' | 'narration' | 'node' | 'request' | 'tool' | 'write' | 'toolResult' | 'error' | 'trace' | 'turnStats'`；`chunk` 不是持久事件（只走 `onEvent`）。
- `trace` 每节点一条、按链顺序：`detail = { nodeId, nodeName, nodeType, presetId, prompt, thinking, toolCalls: [{ name, args, result? }], output, usage: { inputTokens, outputTokens, totalTokens } | null, durationMs, tps: number | null, turn }`，`text = node.name`。
- `turnStats` 每回合一条、回合末尾：`detail = { turn, totalMs, usage, tps }`，`text = 'turn <n>'`；`usage` 是各节点之和，`tps` 量不出为 `null`。
- 引擎**一律读 `save.cardSnapshot`**，不读 `tg2.cards`；改卡只影响之后新建的存档。
- 新建存档把卡级 `tg2.nodeModels[cardId]` 整片拷进 `save.nodeModels`；播放优先用它，没有这一格才回落卡级映射（旧存档不迁移）；存档编辑器改它，卡映射不动。

### 2.3 Preset

```js
{ id, name, provider: 'openai-compatible' | 'mock', baseUrl, model, apiKey, reasoning, mockChunkDelayMs? } // 最后一项仅 mock，缺省 0
```

- `baseUrl` 只写根（如 `https://api.deepseek.com/v1`）；请求发 `${baseUrl}/chat/completions`，末尾斜杠归一化。
- `reasoning ∈ 'off' | 'low' | 'medium' | 'high'`；Key 不写日志、不外发、不进卡。

### 2.4 Settings

```js
{ schemaVersion: 1, theme: 'light' | 'dark', editorColumns: { left: number, right: number }, sampleSeeded?: boolean }
// editorColumns 单位 px，中栏 = 余量；sampleSeeded 是示例卡已种过的一次性标记
```

默认 `{ schemaVersion: 1, theme: 'light', editorColumns: { left: 280, right: 320 } }`。

### 2.5 NodeModels（本机映射，不是卡的一部分）

```js
// localStorage key: tg2.nodeModels
{ [cardId]: { [nodeId]: presetId } }
```

- 缺省：卡没有映射 / 映射没有节点 ⇒ 该节点用 `tg2.presets[0].id`。
- 落地：打开卡编辑器时，若这张卡还没有映射，写一条「每个节点 → `tg2.presets[0].id`」；一个预设都没有时**不写**（运行时 `E_VALIDATION`）。
- 编辑器 `[data-node-preset]` 改的是映射（写 `tg2.nodeModels`），不动卡。
- 删卡**不删** `tg2.nodeModels[cardId]`。
- 映射指向已删除的预设 ⇒ 运行时 `E_VALIDATION`，不静默退回第一个。

## 3. 存储层（`src/core/storage.ts`）

```js
export const STORAGE_KEYS = { cards: 'tg2.cards', saves: 'tg2.saves', presets: 'tg2.presets', settings: 'tg2.settings', nodeModels: 'tg2.nodeModels' }
export const DEFAULT_SETTINGS = { schemaVersion: 1, theme: 'light', editorColumns: { left: 280, right: 320 } }
export function createStorage(backend) -> Storage   // backend 由调用方注入；只有 main.ts 走浏览器 localStorage
```

`backend` 只需实现 `getItem(key) / setItem(key, value) / removeItem(key)`。

| 方法                                        | 语义                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `loadCards()`                               | 无键 ⇒ `[]`；否则逐张 `validateCard`；不合法 ⇒ `E_VALIDATION`                                                    |
| `loadCardEntries()`                         | 按盘上顺序逐条（`raw` 是解析值）⇒ `{ raw, card }` / `{ raw, error }`；一条坏的只影响它自己                       |
| `loadCardById(id)`                          | 按严格相等的字符串 id 找那一条并只校验它；找不到 / 不合法 ⇒ 中文 `E_VALIDATION`                                  |
| `saveCards(cards)`                          | 整表写入（JSON 字符串），无返回值                                                                                |
| `saveCardsLoose(entries)`                   | 原样写 `entries`（不校验 / 不归一化 / 不丢项）；坏项 **JSON 值**不变（不承诺字节逐字相同）                       |
| `loadSaves()` / `saveSaves(saves)`          | 同卡（`validateSave`）                                                                                           |
| `loadSaveEntries()`                         | 按盘上顺序逐条（`raw` 是解析值）；`validateSave` 只校验存档自身那一半 + 快照必须有字符串 name + 快照本身是合法卡 |
| `loadSaveById(id)`                          | 按严格相等的字符串 id 找那一条并只校验存档自身那一半；目标坏 / 不存在 ⇒ 中文 `E_VALIDATION`                      |
| `saveSavesLoose(entries)`                   | 同宽松写（`tg2.saves`）                                                                                          |
| `loadPresets()` / `savePresets(presets)`    | 无键 ⇒ `[]`；不校验任何字段                                                                                      |
| `loadSettings()` / `saveSettings(settings)` | 无键 ⇒ `DEFAULT_SETTINGS`；有键按默认值深合并（缺字段补默认，未知字段保留）；不是对象 ⇒ 报错                     |
| `loadNodeModels()` / `saveNodeModels(map)`  | 无键 ⇒ `{}`；有键必须是「对象套对象套字符串」，否则 `E_VALIDATION`（不静默当空）                                 |

1. **五个键之外一个字节都不许写**，尤其不写 `tg.*`（旧站）；判据 `v2/tests/storage.test.js`。
2. **存储层不种数据**：任何 `load*()` 都不在空后端写默认卡 / 存档 / 映射。
3. **坏 JSON / 坏 schemaVersion / 顶层不是数组 ⇒ 抛 `E_VALIDATION`**，不许静默当空列表；读失败不改盘。
4. `saveCards([])` 之后 `loadCards()` 必须是 `[]`（删空后机制照常）。
5. **不放松整表读**：`loadCards()` / `loadSaves()` 仍整表逐条校验、坏一条就抛；逐条读与宽松写是另外入口；逐条读只把 `AppError` 收成「这一条坏了」，其它异常原样抛。

### 3.1 内置示例卡（`晨风镇`）—— 资产，不是玩家数据

- 卡片本体住在 `v2/src/data/sample-card.json`（**资产**，随构建发布）；代码里不写死它的内容，只有 `main.ts` 引入它。
- 种下去的是克隆 + 运行时不透明 id：克隆后 `id = c-<uuid>`（与首页新建卡同一套生成器）；资产 id 不进 URL / 存档；存档 `cardSnapshot.id` 用运行时 id。
- 首次打开：`main.ts` 看 `tg2.settings.sampleSeeded`；不是 `true` ⇒ 若 `tg2.cards` 为空就写入示例卡，并把标记置 `true`（卡表非空也置 `true`、不种；一次性，不新增第六个键）。
- 删了不复种：玩家删掉示例卡后再打开，列表就是空的（标记已落盘；删卡不动标记）。
- 设置读不出来 / 卡表读不出来 / 资产本身不合法 ⇒ 不种、不写标记，启动照常。
- 判据 `v2/e2e/sample.spec.js`；其它所有 e2e 由 `boot()` 默认写标记 ⇒ 看到的是「没有示例卡」的世界。

## 4. 引擎（`src/core/engine.ts`）

### 4.1 公共 API

```js
export async function runTurn({ card, save, presets, nodePresets, action, onEvent, signal }) -> { save, events }
export function resolveNodePreset({ presets, nodePresets, nodeId }) -> Preset
export function applyWrite({ card, node, tree, path, value }) -> Tree
export function advanceTime(time, hours) -> TimeValue
// src/core/schema.ts: export function toolsForNode(node) -> string[]
```

- `runTurn` **不修改入参**（`save` / `card` / `presets` / `nodePresets` 只读），返回**新的** `save`；失败一律 `throw AppError`，不返回 `{ error }` 混合形状。
- 每节点**恰好一次** provider 调用（不做多步工具循环）。
- 节点模型解析（`resolveNodePreset`）：`nodePresets?.[nodeId]` 有值 ⇒ 在 `presets` 里按 id 找；没有 ⇒ 用 `presets[0]`；找不到（池子空 / 映射指向已删预设）⇒ `E_VALIDATION`（消息指向设置页，不静默退回）；卡里残留的 `presetId` 一律忽略。
- 调试读数只有 `trace` / `turnStats` 事件，没有独立 debug 载荷；两者都进 `save.events`，同时经 `onEvent` 实时发出，因此重开旧存档也能回看历史每一步。

### 4.2 一回合的执行

`runTurn` 顺序做四件事，**任何一步失败都中止本回合、存档保持调用前的样子**：

1. `validateCard(card)` → `validateSave(save, card)`；`card` 与 `save.cardSnapshot` 必须**同 id**；`signal` 已中止 ⇒ `E_ABORTED`。
2. 追加一条 `action` 事件（`text = action`）。
3. 按 `chain` 顺序逐节点执行：`node` 事件（`text = node.name`，`detail = { id, type }`）→ 解析预设 → `buildPrompt`（用**此刻**的 tree）→ provider 调用 → 执行工具（`tool` / `write` 事件）→ `trace` 事件；`output` 节点再追加 `narration`。
4. 收尾：追加 `turnStats`、`turn += 1`、刷新 `updatedAt`；提交前再跑一次 `validateSave(nextSave, card)`，通过后返回 `{ save, events }`；`save.events` = 旧 + 新，`events` = **只有本回合新事件**（同一批对象）。

### 4.3 工具与写入（`writable` 是唯一的权限来源）

- **节点类型不决定能写什么**：`time` / `normal` 的 `writable` 里都可以有 `'0'` 和文字元素；工具由 `writable` 里每个元素的数据类型派生：写着时间 ⇒ `advance_time`，写着文字 ⇒ `write_state`，两样都写 ⇒ 两个工具。
- 唯一例外是 `output`：它只产故事，`writable` 必须是空的（卡校验 `E_CHAIN`），`toolsForNode` 给它 `[]`。
- `advance_time({ hours })` 写 `tree['0'] = advanceTime(tree['0'], hours)`；`hours` 必须是整数，否则 `E_VALIDATION`；`advanceTime(time, hours)` 的算法：`hour += hours`；`day += Math.floor(hour / 24)`；`hour = ((hour % 24) + 24) % 24`。
- `write_state({ path, value })` 只能写 `node.writable` 里的文字 code，`value` 必须是字符串；写 `'0'` ⇒ `E_CHAIN`（提示改用 `advance_time`）。
- `applyWrite`：时间元素 `'0'` ⇒ `E_CHAIN`；不在 `node.writable` ⇒ `E_CHAIN`（`detail = { path, writable }`）；不在 `card.state` ⇒ `E_CHAIN`（`detail = { path }`）；`value` 不是字符串 ⇒ `E_VALIDATION`；合法返回**新** tree（入参 tree 一个字都不改）。
- 工具调用被引擎执行时记两条事件：`tool`（`detail = { name, args }`）与 `write`（`detail = { path, value }`）；同一次调用还进该节点的 `trace.toolCalls`（带 `result`）；模型正文里的工具调用**一律不认**。
- 节点文本：`output` 节点的文本 → `narration` 事件；所有节点的文本都进自己的 `trace.output`。

### 4.4 流式与中止

- 只有 `output` 节点边收边回调 `onEvent({ type: 'chunk', text })`，`text` 是**增量**；把该节点所有 chunk 拼起来 === 该节点最终 `narration` 事件的 `text`。
- `signal`（`AbortSignal`，可选）：中止 ⇒ 已发出的 chunk 之后不再回调，`runTurn` 以 `AppError.code = 'E_ABORTED'` reject；**本回合不写入任何持久事件、`save` 不变**。
- 中止按「用户主动停止」处理，不是错误现场（§8.3）。

### 4.5 provider 调用（`provider: 'openai-compatible'`）

- `POST ${baseUrl}/chat/completions`，头 `Authorization: Bearer ${apiKey}`、`Content-Type: application/json`；body 至少 `{ model, stream: true, messages: [{ role, content }], tools: [...] }`；`maxRetries: 0`；**不绕过 AI SDK 自建 fetch**。
- `apiKey` 为空 ⇒ **不发请求**，直接 `E_PROVIDER`（消息说明「没填 Key」+ 下一步指向设置页）。
- 4xx / 5xx / 断网 / DNS 失败 / 60 秒超时 ⇒ `E_PROVIDER`；玩家中止仍归 `E_ABORTED`；上游报文原样塞进 `detail.upstream`，界面**不许**只显示英文原文。
- 60 秒 deadline 在 import provider **之前**由 `deadline.ts` 起（玩家 signal 与 deadline 合流；到点先置 `expired` 再 abort）。
- **思考增量**：`streamText({ includeRawChunks: true })`；从 `fullStream` 的 `raw` 分片取 `choices[0].delta.reasoning_content`（或 `reasoning`），并累加 `reasoning-delta`，拼进 `ProviderReply.reasoning` → 该节点 `trace.thinking`；没有就是空串（不补、不猜）；mock 一律空串。
- `usage` 全 0 / 缺 ⇒ `null`；`tps` 量不出 ⇒ `null`（不拿 0 冒充）。

## 5. 提示词拼装（`src/core/prompt.ts`）

```js
export function buildPrompt({ card, save, node, action, outputs }) -> string
```

`outputs` = 本回合**已执行节点**的输出，按节点 id 索引（`{ [nodeId]: text }`）。拼接顺序固定，**每段自带标记，空段连标记一起省略**：

1. **公共提示词**：`card.prompts` 顺序里 `id ∈ node.reads` 且 `body !== ''` 的，每块 `<公共提示词·{title}>`，下一行起 `body` **逐字**。
2. **状态树**：`<世界状态树>` + `card.state` 顺序里 `code ∈ node.reads` 的一行一个 `<code> <name> = <值>`；时间元素渲染成 `day <n> hour <n>`。
3. **历史**：`<游戏历史记录>` + 最近 `node.historyTurns` 条叙事与最近 `node.historyTurns − 1` 条历史行动，按事件原有先后穿插；本回合 `action` **恒为最后一条**。
4. **上游输出**：`node.readsUpstream` 点名的、排在它前面的节点，按**链顺序**，一段一个 `<上游输出·{nodeName}>`，下一行起正文逐字（空串跳过）。
5. **本节点提示词**：`<节点提示词>`，下一行起 `node.prompt` 逐字（空则整段省略）；它永远是最后一段。

- 历史细节：**没有独立的「玩家行动」段**；`n = 0` ⇒ 只有本回合 action（不取叙事 / 开场白）；`n = 1` ⇒ 最近 1 条叙事 + 本回合 action（不含上一个行动）；没有叙事的回合整条不进块；历史只取 `action` / `narration`，忽略 `node` / `tool` / `write` 等。
- **开场白**：`opening` 的正文是**最早的一条叙事**，与事件里的叙事共用 `n` 预算（更近的优先；新存档 + `n=1` ⇒ 开场白 + 本回合 action）；`opening` 同时作为公共提示词块出现时两处独立，不合并、不删块。
- 🔴 **状态读的是「此刻的 tree」**：链上更早节点在同一回合写下的值必须出现在后面节点的状态段；判据 `v2/tests/engine.test.js` 的「同一回合内的写入立刻可见」。
- 段间分隔符与行动行前缀（`> `）由实现定，测试不断言；但要求所有段正文逐字可见（不截断、不转义）、相对顺序可用 `indexOf` 判、本节点提示词最后。
- 关掉的块 / 元素 / 上游，对应正文与标记一个字符都不许出现；**行动只出现一次，且只在历史块里**；判据 `v2/tests/prompt-markers.test.js` 与 `v2/e2e/prompt-history.spec.js`。
- 标记字面量是**契约的一部分**：作者只能从 trace 看见提示词结构，改字面量必须同批改判据。
- 眼睛语义：`reads` 里有它就读，没有就不读；`readsUpstream` 是读哪些上游节点的输出；`writable` 是写的开关。

## 6. 错误（`src/core/errors.ts`）

```js
export class AppError extends Error {
  constructor(code, { message = '', nextStep = '', detail, cause } = {})
  code: 'E_PROVIDER' | 'E_VALIDATION' | 'E_CHAIN' | 'E_UNKNOWN' | 'E_ABORTED'  // message / nextStep 为中文，缺省取 locales
  message: string; nextStep: string; detail?: unknown   // detail 可放上游英文原文，不进正文
}
export const CODES = ['E_PROVIDER', 'E_VALIDATION', 'E_CHAIN', 'E_UNKNOWN', 'E_ABORTED']
```

- 每个码都有**默认的**中文 `message` + `nextStep`（住 `locales/zh-CN.json`）；`new AppError('E_PROVIDER')` 不传文案也必须拿到中文；传了 `{ message, nextStep }` 就覆盖默认值。
- 所有面向玩家的错误都必须是 `AppError`（`instanceof Error` 且带 `code`）；`detail` 放上游原文，**正文不许只给英文**。

| 码             | 什么时候                                                                    | message 要说清什么           | nextStep 要指向              |
| -------------- | --------------------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| `E_PROVIDER`   | 网络 / key / 额度 / 上游 4xx-5xx / 超时                                     | 哪一步连不上（不填英文原文） | 设置页检查 Key 与 Base URL   |
| `E_VALIDATION` | 卡或存档结构不合法、坏 JSON、schemaVersion 不认、id 不存在                  | 哪个字段 / 对象坏了          | 回首页重开或重建存档         |
| `E_CHAIN`      | 链不合法（输出数、时间数、上游只能往前、输出节点的写权限）、写非 `writable` | 哪一条链规则、哪个节点 id    | 回编辑器改链                 |
| `E_UNKNOWN`    | 兜底（不许用来吞掉已知错误）                                                | 发生了什么                   | 刷新 / 看控制台              |
| `E_ABORTED`    | 用户点「停止」                                                              | 你中止了本回合               | 无（界面按停止处理，不弹错） |

**判据**：五个码的 `message` 与 `nextStep` 都必须含中文（正则 `[\u4e00-\u9fff]`），且 `nextStep` 非空。

### 6.1 链校验（`src/core/schema.ts` 的 `validateCard`）

命中就抛 `E_CHAIN`，`message` 里必须写出**节点 id** 或**规则名**：

- `chain` 至少 1 个节点；`type === 'output'` 恰好 1 个（0 个 / ≥2 个都错）；`type === 'time'` 最多 1 个。
- 节点 `type` 只能是 `'time' | 'normal' | 'output'`（别的值 ⇒ `E_VALIDATION`）；节点 `id` 唯一；`historyTurns` 是 ≥0 的整数。
- `readsUpstream` 里的每个 id 都必须在链上，且**排在它前面**（首节点只能为空）。
- `reads` 引用必须存在（提示词 id 或状态 code）；`writable` 引用必须是状态 code；悬空引用 ⇒ `E_VALIDATION`（点名那个引用）。
- **写权限只由 `writable` 决定**：`time` / `normal` 都可以写任意 code（含 `'0'`），工具按数据类型派生；`output` 的必须是 `[]`。
- **`prompts` 里必须有 `id === 'opening'` 的那一块**（缺 ⇒ `E_VALIDATION`，不补）。
- **`presetId` 不在这里校验**：卡可以带着空 / 已失效的 `presetId` 存着，到 `runTurn` 取预设那一步才报 `E_VALIDATION`。

`validateSave(save, card)`：`schemaVersion === 1`；`id` / `cardId` 非空；`turn` 是 ≥0 整数；`events` 是数组；`tree` 是记录且 `'0'` 为 `{ day, hour }`；给了 `card` 时 `cardId` 相等且 `tree` 覆盖 `card.state` 的全部 code。

## 7. mock 提供方（`src/core/mock.ts`）—— 测试替身

`preset.provider === 'mock'` 时**不发任何网络请求**，回确定的响应（同一输入同一输出）；工具按 `writable` 派生（§4.3），节点类型只决定它吐不吐正文：

| 节点              | 回什么                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `time` / `normal` | `writable` 含 `'0'` ⇒ 一次 `advance_time({ hours: 1 })`；含文字 code ⇒ 一次 `write_state({ path: <第一个文字 code>, value: 'mock-t<turn>' })`（两样都写就两个调用）；都没有 ⇒ 空响应 |
| `output`          | 文本 `[mock] turn <turn>: <action>`，**流式**：块长 `floor(len/6)` 夹到 1..8（每块 ≤8 字符），块数 ≥3；块间等 `mockChunkDelayMs`（缺省 0）                                           |

- mock 走的**是同一套事件 / 流式代码路径**（`chunk` → `narration`），不是另一条捷径。
- `usage` / `tps` 为 `null`，`reasoning` 为空串；输出整串**逐字**可断言。

## 8. 页面与路由（`src/main.ts` + `src/pages/*.vue`）

- **hash 路由**，`index.html` 只有一个 `#app` 容器；`hashchange` + 首次 `load` 都渲染 ⇒ 刷新 / 深链不白屏；`vite.config.mjs` 不需要 SPA 回退。
- 路由表在 `src/router.ts`（原生 `hashchange`，页面组件按路由对象切换），**不引入 vue-router**；页面用 `ref` / `reactive` + `core` 模块管状态，**不引入 pinia**。
- 编辑器 / 对话页 / 设置页左上角有 `[data-back]`（设置页回 `#/`）；id 不存在 / 卡存档对不上 ⇒ 错误页 `[data-page="error"]` + 中文 `[data-error]`，不白屏。
- `?debug=1` 只是对话页调试开关的**初始状态**。
- 每一屏页栏正中 `[data-repo-url]` 仓库链接：`href` 与 `data-repo-url` 同地址、文字在视口正中、不压页栏其他控件、高度 ≤24px；错误页也有；判据 `v2/e2e/repo-url.spec.js`。

| hash                     | 页面         | 钩子                     |
| ------------------------ | ------------ | ------------------------ |
| `#/`                     | 首页         | `[data-page="home"]`     |
| `#/edit/:cardId`         | 游戏卡编辑器 | `[data-page="editor"]`   |
| `#/edit-save/:saveId`    | 存档编辑器   | `[data-page="editor"]`   |
| `#/play/:cardId/:saveId` | 对话页       | `[data-page="play"]`     |
| `#/settings`             | 设置         | `[data-page="settings"]` |

### 8.1 首页

- 两栏并排：左游戏卡列表 `[data-card-list]`，右存档列表 `[data-save-list]`；卡列表右上 `[data-new-card]`（点击立刻建卡、默认名 `card <n>`、落盘，无弹窗）、存档列表右上 `[data-new-save]`（基于当前选中卡；没有选中时 disabled）。
- 新建存档：默认名 `save <n>`，**追加到列表末尾、不跳转**，`tree` 取卡初值、`cardSnapshot` 深拷贝、`nodeModels` 从卡级映射拷一份。
- 卡行：`[data-card-id="<id>"]`（点击只选中，不跳页）、`[data-card-name]`、`[data-card-edit]`（进 `#/edit/:cardId`）、`[data-card-rename]`、`[data-card-delete]`、`[data-card-count]`（存档数）。
- 行内重命名：`[data-rename-input]` 回车提交 / Esc 取消 / blur 提交，提交后立即落盘；输入框与重命名按钮的 pointerdown / click 不许冒泡到行（点输入框不变选中、不跳对话页）。
- 存档行：`[data-save-id="<id>"]`（点击进对话页）、`[data-save-name]`、`[data-save-meta]`（含卡名与回合数数字）、`[data-save-edit]`（在改名 / 删除左边，进 `#/edit-save/:saveId`）、`[data-save-rename]`、`[data-save-delete]`。
- 删除确认：`[data-confirm]`，只有 `[data-confirm-ok]` 真删、`[data-confirm-cancel]` 取消；删卡只删 `tg2.cards` 这一张（存档全留、`tg2.nodeModels[cardId]` 保留，确认文案说存档保留）；删存档只删那一份（确认文案说不能撤销）。
- 空态：无卡 `[data-empty-cards]` 可见（「还没有游戏卡」），无存档 `[data-empty-saves]` 可见。
- 坏项逐行标记：非法行带 `[data-invalid-card]` / `[data-invalid-save]` + `[data-invalid-badge]` + `[data-invalid-name]` + `[data-invalid-reason]`（中文 `error.message`），**没有任何入口**（不选中 / 不编辑 / 不改名 / 不删除 / 点了不跳页）；合法行照旧。
- 写走宽松写：只替换合法项，坏项 **JSON 值**不变；存档卡名按「现存卡名 → 快照名 → 中性回退」；快照缺名字 / 快照本身不是合法卡 ⇒ 坏项；整表坏 JSON / 顶层不是数组 ⇒ 错误页，且不渲染列表与新建按钮。
- 列表三态：默认 `--panel` 底、悬停边框更深、选中卡行 = `--accent` 底 + `--accent-ink` 字（对比度 ≥4.5）；坏项虚线 danger 边框。
- 判据：`lists.spec.js` / `empty.spec.js` / `snapshot.spec.js` / `invalid-items.spec.js` / `list-styles.spec.js`。

### 8.2 编辑器

- 四区一行排开：`[data-col="left"]` · `[data-workflow-strip]` · `[data-col="middle"]` · `[data-col="right"]`；左 / 右可拖，细条固定 96px，中栏恒为余量。
- 四个面板标题共用 `.col-title` 同版式（41px = `--control-h` + 13px、`padding: 6px 8px`、1px 实线下边框），各带 `data-panel-title`；加号按钮在标题条外（绝对定位）；中栏标题：节点 / 元素 / 提示词 → `编辑·<name>`，没选 → `编辑`；中栏字段表不自带标题。
- 分隔条：`[data-splitter="left"]` 在左栏右缘（往右拖 = 左栏变宽），`[data-splitter="right"]` 在右栏左缘（往左拖 = 右栏变宽）；双击恢复默认 280 / 320；夹取左 `[200, 480]`、右 `[240, 560]`，中栏不得小于 320；拖完落盘 `tg2.settings.editorColumns`（整数 px），刷新保留。
- 选中态互斥：S0 什么都没选 · S1 选中工作流节点 · S2 选中状态元素 · S3 选中公共提示词块；两个 `ref` 互相清空，任一时刻最多一格。
- 左栏：S0 只有 `[data-state-code]` + `[data-state-name]`；S1 每行 `[data-eyes="read"]` / `[data-eyes="write"]`（`data-on`，切换当前节点的 `reads` / `writable`），写眼睛只看 `node.writable`、`output` 没有写眼睛；S2 栏顶 `[data-add-state]`（裸 `+`）、每行 `[data-delete-state]`（裸 `×`，`'0'` 永远没有），S2 不出现眼睛。
- 状态树 `[data-state-tree]`：每行 `[data-state-item="<code>"]`，行内 `[data-state-code]` / `[data-state-name]`。
- 中栏 S1：`[data-node-name]`（input，改 `node.name`；细条 / 中栏标题跟着变，卡与存档两种模式都可改）、`[data-node-preset]`（select）、`[data-node-history]`（number）、`[data-node-prompt]`（textarea）；**这一形态没有眼睛**。
- 中栏 S2：`[data-state-type]`（只读：`0` = 时间，其余 = 文字）、`[data-field="name"]`、`[data-field="note"]`、初值；时间元素是 `[data-field="initial-day"]`（≥1）+ `[data-field="initial-hour"]`（0–23），其余是 `[data-field="initial"]`。
- 中栏 S3：`[data-prompt-title]` + `[data-prompt-body]`（textarea）；没选：`[data-empty-middle]`（空壳，不写句子）。
- `[data-node-preset]`：选项 = `tg2.presets` 全部；当前值 = 这个节点解析出的预设 id（映射没有就是 `presets[0].id`）；改动写 `tg2.nodeModels[cardId][nodeId]`，**不动卡**；一个预设都没有时为空、`aria-disabled="true"`（不另挂提示）。
- 工作流细条 `[data-workflow-strip]`：每节点 `[data-node-id="<id>"]`（点击选中，带 `data-selected`）；选中节点时，排在它前面的每个节点旁有 `[data-read-upstream][data-upstream-id="<id>"]`（带 `data-on`，切换 `readsUpstream`）；自己与下游没有。
- 右栏 `[data-prompt-list]`：每块 `[data-prompt-block="<id>"]`（点击选中，带 `data-selected`）、`[data-prompt-name]`、`[data-delete-prompt]`（裸 `×`）；`[data-add-prompt]`（裸 `+`，新 id 由创建方生成并当场选中）；选中节点时每块有 `[data-prompt-read][data-prompt-id="<id>"]`（带 `data-on`，切换 `reads`）；没选节点时它不出现；右栏没有输入框。
- 每张卡都有一块 `id: 'opening'`（标题「开场」）：新建卡自带、示例卡也有一份；右栏不给它 `[data-delete-prompt]`。
- 不挂教程提示：中栏空态、没有预设时、设置页没有预设时、首页改名框上都没有 `.hint` / 教程文案。
- 只按 id 校验目标卡：`#/edit/:cardId` 用 `loadCardById()` 打开 —— 盘上别的坏卡不挡；目标自己坏了照样中文 `E_VALIDATION`；字段改动写回时只替换这一张（`saveCardsLoose()`），盘上别的卡（含坏卡）原样保留；没有「保存」按钮，字段改动（input / change / blur）即时写 `tg2.cards`。
- 存档模式 `#/edit-save/:saveId`（同一份 `EditorPage`）：编辑目标是这一份存档的 `cardSnapshot`（深拷贝）与 `save.nodeModels`，写回只替换 `tg2.saves` 那一行、`tg2.cards` 一个字节不动；**结构锁死** —— 没有 `[data-add-state]` / `[data-delete-state]`（不渲染，不是禁用）、没有节点增删排序、卡名不改，其余字段（名字 / 备注 / 初值 / 提示词块 / 节点名字 / 节点提示词 / 历史轮数 / 眼睛 / 模型预设）照常可改。
- 存档模式打开时 `save.nodeModels` 缺省先按卡级映射显示，玩家真改了某一格才把整片写进存档（不迁移、不补写）。
- 控件 / 行高：`--control-h: 28px` 用于 button / input / select / `.icon` / `.chip` / 工作流 `.node`；`--row-h: 36px` 用于 `[data-prompt-block]` / `[data-state-item]` / 首页卡行 / 存档行 / 设置页预设字段行；行内控件仍 28 且垂直居中；多行编辑器不在这一档（行动输入 44 / 节点提示词 120 / 提示词正文 160）。
- 圆角只有 `--radius: 6px`（button 与 `.chip` 共用）；读 / 写 chip 三处（状态树、细条上游、右栏提示词）共用 `.chip`：关着也有底色与边框，开着 `--active-bg` 实心 + `--active-ink` 字、边框 `--accent`；高度 `--control-h`；文字「读 / 写」保留；按钮 / chip 里不再有 999px 或 3px 档。
- 判据：`panel-chrome.spec.js` / `editor-panels.spec.js` / `node-models.spec.js` / `node-name.spec.js` / `controls.spec.js` / `save-editor.spec.js` / `editor-columns.spec.js` / `active-styles.spec.js`。

### 8.3 对话页

- 结构：`[data-story]` → 输入区 `[data-action-input]`（textarea）+ `[data-send]`；**没有封面、没有开始按钮**（`[data-cover]` / `[data-start]` 不存在）；第一段是 `cardSnapshot.prompts` 里 `id === 'opening'` 那一块的正文，它后面才是历史回合与正在流的正文。
- 只按 id 校验目标存档：`#/play/:cardId/:saveId` 用 `loadSaveById()` 打开 —— 盘上别的坏存档不挡；目标自己坏了（或它的 `cardSnapshot` 坏了）照样中文 `E_VALIDATION`；回合结果写回时只替换这一份（`saveSavesLoose()`），盘上别的存档（含坏存档）原样保留。
- **跑的一律是 `save.cardSnapshot`**（不是 `tg2.cards` 里那张现卡）：改卡只影响之后新建的存档，旧存档按它冻结时的那张卡跑。
- 故事流：每条 `action` 一个 `[data-line="action"]`，每条 `narration` 一个 `[data-line="narration"]`；**只有 `output` 节点的文本进故事流**（`opening` 是卡上的静态正文，不是引擎事件）。
- 版式：行动与叙事左对齐、同一字号、没有气泡底；每个块之间（含 trace 卡片）`border-top: 1px dashed`。
- 顶部：`[data-turn]`（`textContent` 恰好是回合数，纯阿拉伯数字）、`[data-status]`（保存状态，完成一回合后非空）、`[data-back]`。
- 发送：`[data-send]` / 回车 ⇒ **立刻**把这一句行动当 `[data-line="action"][data-pending-action]` 挂到故事流末尾（乐观副本，排在本回合 trace 之前）；同一时刻清空输入框、禁用输入、显示 `[data-stop]`、清掉上一回合的流式正文。
- 第一段正文未到 ⇒ 行动下面一行 `[data-generating]`（文案 = `play.generating`「生成中……」）；第一段 `chunk` 一到 ⇒ `[data-generating]` 消失、换成 `[data-line="narration"]` 流式正文，行动气泡留着；调试开着时 trace 卡片照常按节点顺序出现，`[data-generating]` 只有一行。
- 回合成功 ⇒ **先校验 `result.save`、再写回 `tg2.saves`，写盘成功之后才更新内存与界面**：撤掉乐观副本（`save.events` 里已有这条 `action`，不许出现两个气泡）、隐藏 `[data-stop]`、恢复输入、更新 `[data-turn]` 与 `[data-status]`；校验不过 / 写盘失败 ⇒ 整回合按出错处理，`[data-turn]`、故事流与内存 `save` 都停在上一回合。
- 停止：点 `[data-stop]` ⇒ 中止本轮、丢弃本轮半截文本与乐观行动（故事流回到本轮开始前）、恢复输入、把刚才那句放回 `[data-action-input]`（输入框仍为空时才放）、存档不变。
- 出错：`[data-error]` 出现，`[data-error-code]` = 错误码字符串、`[data-error-next]` = 下一步中文；乐观气泡撤掉、刚才那句放回输入框（仍为空时才放）、存档不变；界面不白屏、不丢卡。
- 调试内联（**没有右侧调试面板**，`[data-debug]` / `[data-debug-node]` / `[data-debug-prompt]` / 旧表头 `[data-turn-ms]` 都不存在）：故事流按 `save.events` 顺序排成时间轴；`action` / `narration` **永远在**；`trace` 卡片**只在调试开着时**出现；`turnStats` **永远在**（紧凑一行：回合 / 总 token / 总耗时 / t/s）。
- 开关：右上角 `[data-debug-toggle]`（带 `data-on`），`?debug=1` 只是它的初始状态，点它随时开 / 关；开着 = `--active-bg` 实心 + `--active-ink` 字、边框 `--accent`；加载旧存档后打开开关也要显示历史回合的 trace（读数来自 `save.events`，不是内存里那一回合）。
- trace 卡片：`[data-trace][data-trace-node="<id>"][data-trace-turn="<n>"]`，内含 `[data-trace-name]` / `[data-trace-type]` / `[data-trace-prompt]`；有思考时 `[data-trace-thinking]`；有工具调用时 `[data-trace-tools]`（每条 `[data-trace-tool]`，带执行结果的那条还有 `[data-trace-tool-result]`）；有正文时 `[data-trace-output]`；脚注 `[data-trace-tokens]` / `[data-trace-tps]` / `[data-trace-ms]` / `[data-trace-preset]`；**空段不画空框**。
- 合计行：`[data-turn-stats][data-turn-stats-turn="<n>"]`，内含 `[data-turn-stats-turn]` / `[data-turn-stats-tokens]` / `[data-turn-stats-ms]` / `[data-turn-stats-tps]`；没有用量 / 速率时写「没有用量 / 没有速率」，不拿 0 冒充。
- 判据：`play.spec.js` / `prompt-history.spec.js` / `stream-abort.spec.js` / `errors.spec.js` / `reasoning.spec.js` / `snapshot.spec.js` / `node-tools.spec.js`。

### 8.4 设置

- `[data-theme="light"]` / `[data-theme="dark"]`：点击切换，写 `tg2.settings.theme`，刷新保留；`document.documentElement` 上要有 `data-theme` 属性。
- 预设列表 `[data-preset-list]`，每条 `[data-preset="<id>"]`：`[data-preset-name]` / `[data-preset-baseurl]` / `[data-preset-model]` / `[data-preset-key]` / `[data-preset-reasoning]` / `[data-delete-preset]`；`[data-add-preset]` 新增；改动即时落盘 `tg2.presets`。
- 默认两条**本地**预设，只在新装（`tg2.presets` 这个键不存在）时由 `main.ts` 写一次，顺序固定：

| #   | id                  | name              | model             | baseUrl                       | apiKey | reasoning |
| --- | ------------------- | ----------------- | ----------------- | ----------------------------- | ------ | --------- |
| 1   | `p-deepseek-flash`  | `deepseek-flash`  | `deepseek-flash`  | `https://api.deepseek.com/v1` | `''`   | `medium`  |
| 2   | `p-deepseek-v4-pro` | `deepseek-v4-pro` | `deepseek-v4-pro` | `https://api.deepseek.com/v1` | `''`   | `off`     |

- `name === model`；Key 必须是空串（不许预置任何 Key）；`[data-preset-key]` 是 `password` 输入框。
- 两条都可改可删、只住本机；**删光了就是 `[]`**（不是「没有键」）⇒ 不许每次打开又长回来；判据 `v2/e2e/settings.spec.js`。

### 8.5 响应式与横屏

- 桌面最小 1280×720，兼容 16:9 / 16:10 / 4:3 / 21:9，最大 4K；**任何档位不许横向溢出**。
- 手机竖屏（`(max-width: 767px) and (orientation: portrait)`）⇒ `[data-landscape-overlay]` 可见，含中文「请横屏使用」与 `[data-landscape-retry]`（点击尝试 `screen.orientation.lock('landscape')`，失败后显示 `[data-landscape-hint]` 中文提示手动旋转）。
- 横屏（如 844×390）⇒ 遮罩不可见，页面可交互（同一套布局，不是「手机档布局」）。

## 9. 测试与钩子

### 9.1 命令

| 命令                    | 作用                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| `npm run v2:test`       | vitest 跑 `v2/tests/**/*.test.js`（node 环境，被测模块是 `src/core/**/*.ts`） |
| `npm run v2:test:watch` | 同上，watch                                                                   |
| `npm run v2:typecheck`  | `vue-tsc --noEmit -p v2/tsconfig.json`                                        |
| `npm run v2:build`      | `v2:lines` 后 `vite build --config v2/vite.config.mjs`，产物进 `dist/v2`      |
| `npm run v2:e2e`        | Playwright 跑 `v2/e2e/**/*.spec.js`（构建 `dist/v2` + `vite preview`）        |
| `npm run v2:dev`        | `vite --config v2/vite.config.mjs`                                            |
| `npm run v2:lines`      | `v2/` 手写文件 800 行闸（按 LF 数；`scripts/check-lines.mjs`）                |
| `npm run v2:stories`    | 构建 Storybook 后跑组件故事巡检                                               |
| `npm run v2:visual`     | 整页像素基线（chromium，`maxDiffPixelRatio` 见配置）                          |

- 配置在 `v2/vitest.config.mjs` / `v2/playwright.config.mjs` / `v2/playwright.stories.config.mjs` / `v2/playwright.visual.config.mjs` / `v2/tsconfig.json` / `v2/vite.config.mjs`；旧站的 `vitest.config.ts` / `playwright.config.ts` / `tsconfig.app.json` 一个字节都不动。
- `v2/vite.config.mjs` 里的 `root` 必须显式写成 `v2/`；`build.outDir` 相对 `root` 解析：`root: v2/` + `outDir: '../dist/v2'` 落在仓库的 `dist/v2`。

### 9.2 测试用的数据与状态

- 单测**不许发真网络请求**（`E_PROVIDER` 那条用 `http://127.0.0.1:1` 立刻拒连）；单测文件写成 `.js`（vitest 直接跑，**不进 `vue-tsc`**），类型由 `v2:typecheck` 收口。
- e2e 用 `provider: 'mock'` 的预设（§7）；真 provider 路径用 `page.route` 拦接口，种子数据走 `addInitScript` 写 `tg2.*`，不 import 产品模块、不联外网、不往仓库塞卡文件。
- 组件行为由 e2e 的 `data-*` 钩子钉（§8）；真需要组件级单测时在 `v2/tests/` 里加 `// @vitest-environment jsdom` 的文件；夹具自检 `fixtures.selfcheck.test.js` 是正控。

### 9.3 中文文案住在 `.json`（提交钩子的硬约束）

- `.githooks/checks/ascii.mjs` 对 `\.(ts|tsx|vue|css|html|js|mjs|cjs)$` 查非 ASCII（注释除外）；`^src/locales/` 只匹配旧站根目录，照不到 `v2/src/locales/`；`.json` 不在被查扩展名里。
- **所有中文文案**（界面、错误 `message` / `nextStep`、默认名）写在 `v2/src/locales/zh-CN.json`，形如 `{ "home.empty": "还没有游戏卡" }`；代码里只出现 key（`t('home.empty')`），`.vue` 模板也用 `{{ t('key') }}`。
- `.ts` / `.vue` / `.html` / `.css` / `.js` 里不许出现中文字面量（含 `index.html` 的 `<title>`），注释除外；测试源码 `v2/tests` / `v2/e2e` / `v2/stories` 已豁免，中文断言用 `[\u4e00-\u9fff]` 判有中文、不抄文案。

### 9.4 判据清单

| 验收 / 行为                                                      | 判据                                                                                                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 空态 / 删空后仍可用                                              | `v2/e2e/empty.spec.js`                                                                                                               |
| 首次打开种「晨风镇」/ 删了不复种                                 | `v2/e2e/sample.spec.js`                                                                                                              |
| 新装默认两条预设（顺序 / name=model / Key 空）                   | `v2/e2e/settings.spec.js`                                                                                                            |
| 建卡 → 编 2 元素 + 初值 + 2 提示词 → 存档 → 3 回合 → 刷新还在    | `v2/e2e/loop.spec.js`                                                                                                                |
| 眼睛控制提示词拼装                                               | `v2/e2e/eyes.spec.js` + `v2/tests/prompt.test.js`                                                                                    |
| 改卡后旧存档仍能跑                                               | `v2/e2e/snapshot.spec.js`                                                                                                            |
| 四类比例 + 4K 不溢出 / 手机竖屏遮罩                              | `v2/e2e/responsive.spec.js`                                                                                                          |
| 三栏可拖 / 细条固定 / 双击恢复 / 刷新保留                        | `v2/e2e/editor-columns.spec.js`                                                                                                      |
| 编辑器面板标题 / 无教程提示 / S0–S3                              | `v2/e2e/editor-panels.spec.js` + `v2/e2e/panel-chrome.spec.js`                                                                       |
| 控件 / 行容器两档高度                                            | `v2/e2e/controls.spec.js`                                                                                                            |
| 读 / 写 chip 与选中态 token                                      | `v2/e2e/active-styles.spec.js` + `v2/e2e/list-styles.spec.js`                                                                        |
| 首页列表 / 改名 / 删除确认 / 三态                                | `v2/e2e/lists.spec.js` + `v2/e2e/list-styles.spec.js`                                                                                |
| 存档编辑器（快照 / 结构锁死 / 节点改名）                         | `v2/e2e/save-editor.spec.js` + `v2/e2e/node-name.spec.js`                                                                            |
| 非法卡 / 非法存档逐项标记、按 id 只校验目标                      | `v2/tests/invalid-items.test.js` + `v2/e2e/invalid-items.spec.js` + `v2/e2e/invalid-snapshot.spec.js` + `v2/e2e/orphan-save.spec.js` |
| 旧格式卡 / 不迁移                                                | `v2/tests/chain.test.js` + `v2/e2e/old-data.spec.js`                                                                                 |
| 流式可停止 / 错误中文 / 思考                                     | `v2/e2e/stream-abort.spec.js` + `v2/e2e/errors.spec.js` + `v2/e2e/reasoning.spec.js`                                                 |
| 调试内联：trace / turnStats 落盘、开关翻面、加载旧存档后仍能回看 | `v2/e2e/play.spec.js` + `v2/tests/engine.test.js`                                                                                    |
| 模型不进卡 / 逐节点解析 / 缺预设即报错 / 删卡不删映射            | `v2/tests/engine.test.js` + `v2/e2e/node-models.spec.js`                                                                             |
| 错误码五条都有中文 + 下一步                                      | `v2/tests/errors.test.js`                                                                                                            |
| 夹具自身合法性（正控：夹具坏了下面每条红都不可信）               | `v2/tests/fixtures.selfcheck.test.js`                                                                                                |
| 库址条六屏                                                       | `v2/e2e/repo-url.spec.js`                                                                                                            |
| 组件故事 / 像素基线（另两层，不属本文行为判据）                  | `npm run v2:stories` / `npm run v2:visual`                                                                                           |

### 9.5 历史决定

- 历史决定见 `.team/dev/2026-11-26/CONTRACT-9.5-决定存档.md`（仅存档，不构成本文规则）。

### 9.6 本契约不覆盖

- 组件故事 / 像素基线（`v2:stories` / `v2:visual` 是另外两层）· 导入导出 · 节点增删排序 · 状态树类型与嵌套 · 重生成 / 撤销 · 连接测试 · token 费用 · 多语言 · 自定义主题色 · 显示面板。
- 线上 `/v2/` 可打开、旧站根路径仍可用：人工 + 发布流程，不属本文行为判据。
