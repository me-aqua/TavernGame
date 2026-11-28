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
    core/  storage.ts errors.ts prompt.ts engine.ts schema.ts statetree.ts mock.ts tool-definitions.ts (+ provider.ts deadline.ts types.ts)
       statetree 的活按种类分在 state-codes / state-values / state-array / state-data / state-issues（statetree 只留导出面）
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
  state: [{ code, name, note, type, values?, min?, max?, stepMin?, stepMax?,
            timeMode?, holidays?, initial? }],
  chain: [{ id, type: 'time' | 'normal' | 'output', name,
            reads: string[], writable: string[], readsUpstream: string[],
            historyTurns: number, retryCount: number, prompt: string }], // 顺序即执行顺序
  prompts: [{ id, title, body }]
}
```

- **状态树是扁平的、键是完整 code**（v5）：`state[]` 只是**声明**，值住在存档的 `tree` 里（§2.2）。
- `type ∈ 'time' | 'text' | 'integer' | 'enum' | 'object' | 'array'`；**作者能选 `text` / `integer` / `enum` / `time` / `array`**，`object` 是「有孩子」的内部形态（类型下拉里没有；导入的卡真有 `object` 时照实显示并按它校验）。`type` 描述的是**自身值**，所以标量节点也可以有孩子、不会因此变成 `object`。
- **编号铁律**：`state[0].code === '0'` 且 `type === 'time'`（整张卡只能有一个 `time`，它不能有孩子）；节点自己的值住在**隐式**的 `<code>.0`（**不进 `state[]`**），可见孩子从 `<code>.1` 起连续编号；顶层根从 `1` 起连续；父 code 必须存在；深度（`.0` 不计）最大 5（`1.1.1.1.1` 合法）。
- **数组节点**（阶段 3）：`type: 'array'` 的元素，**值就住在它自己的 code**（`2.4`），是一份 **item 结构体列表**；子元素是 item 的**字段定义**（schema），不是值路径。`.0` 与数组无关（数组没有「自身值」这一格，`2.4.0` 五处都不出现）。item 的键 = 字段的**完整 code**（`2.4.1`），item 之间**同构**（键集合恰好等于字段定义全集，缺键 / 多键 / 多出 `id` / `order` 都是坏值）；数组顺序 = 存储顺序。字段类型只允许 `text | integer | enum | object | array`（**`time` 不能做字段**，嵌套子孙也不行）；标量字段是叶子（不许有孩子），`object` / `array` 字段必须有孩子，数组必须有 ≥1 个字段，空数组 `[]` 合法。数组允许重复项；**没有隐藏 id**（引用类型是后续票）。
- **数组 ⇄ 结构体的类型转换**（卡编辑器；存档编辑器锁死）：只做 `array ⇄ object` 这一对，只对**数组子树之外**的容器（如根下的 `2.4`）。字段上 / 下：容器的直接子元素（`2.4.1`… 及其嵌套子孙）**一个都不动**（code / name / note / type / 顺序原样），变的只有容器自己的 `type`；`reads` / `writable` 里的字符串逐字保留（`2.4.1` 从字段引用变值路径或反过来）。`array → object`：删掉 `initial[A]`，`items.length ≥ 1` ⇒ 只取**第 1 项**并摊平（标量字段写 `A.x`；`object` 字段摊到后代 code；`array` 字段写它自己的 code），第 2 项起丢弃（编辑器先弹确认）；`items.length === 0` ⇒ 每个字段写默认值。`object → array`：把后代值路径收成**一个 item**（`object` 后代拼成嵌套对象、`array` 字段整份搬），删掉子树下的值路径后写 `initial[A] = [item]`；**后代一条值路径都没有 ⇒ `[]`**。`array → text / integer / enum / time` ⇒ `E_VALIDATION`（字段没有落点）；数组子树里的字段做 array⇄object 也 ⇒ `E_VALIDATION`（逐 item 转换是另一票）。
- **初始值只挂在根元素上**（`code` 不含 `.`）：它不是「元素自己的值」，而是**整棵子树的扁平值表**（键是完整 code，口径与存档 `tree` 完全一致）；时间根是唯一例外 —— 它的 `initial` 就是时间值本身。数组的初始值也在这张表里：键就是**数组自己的 code**（`2.4`），值是整份 item 列表（不写 `2.4.0`，也不写字段 code）。**子元素一个字节都不许存 `initial`**（有这一格就是坏卡 ⇒ `E_VALIDATION`）。摊平成新建存档的 `tree` 由 `initialTreeOf` 做（数组 / item 对象 / 嵌套数组都**深拷贝**）。
- 各类型的格子：`enum` 的 `values` 非空 / 不重复 / 都是字符串，初始值必须是其中一项；`integer` 的 `min`/`max`（缺省 ∓1e9）与 `stepMin`/`stepMax`（缺省 0 / 1e9）是值范围与**单次写入的步幅**（`|new − old|`），初始值只受上下限约束；`time` 的 `timeMode` 必填（`year-minute` / `year-date` / `days-minute`，见 §2.6）、`holidays` 在前两个模式必填且天数模式不许有；**能推进哪些单位只由 `timeMode` 决定**（§2.6 的表就是唯一来源），卡里没有、也不认任何颗粒度字段。
- 其它类型身上残留 `timeMode` / `holidays` **不管**（与「多余字段宽容」同一口径）。
- `validateCard` 对多余字段宽容（卡里残留 `presetId` 不报错，引擎一个字节都不看），但对**旧形状不迁移**：`type: 'string'`、`tree['0']` 是 `{ day, hour }`、缺 `opening`、布尔 `readsUpstream`、带校对节点的卡一律中文 `E_VALIDATION`。
- `reads` 是混合数组：`prompts[].id` = 读这块公共提示词，**元素 code** = 读这个元素（自身值 + 整棵子树），**`<code>.0`** = 只读这个元素的自身值，**数组字段 code**（`2.4.1` / `2.4.2.2.1`）= 只读**每个 item 里的这一格**；创建方保证同一字符串不同时是两者。
- **`.0` 引用**：只有「真的有自身值、而且住在 `.0`」的节点才有这一格 —— 有孩子的标量（`1.1` 是 enum 且有孩子 ⇒ `1.1.0` 合法）；叶子自己就是 `<code>`，所以 `2.1.0` 非法；`object` 没有自身值 ⇒ `2.4.0` 非法（数组同理）；时间元素没有孩子 ⇒ `0.0` 非法；父 code 不存在 ⇒ 非法。`reads` / `writable` 都按这一条判（悬空 / `2.4.0` / 字段的 `.0` ⇒ `E_VALIDATION`）。**数组字段引用是合法的权限引用**（不是值路径）。
- **值路径与权限引用是两套东西**：`pathsOf` 只给 `tree` 里真落值的格子 —— 数组只有它自己的 code（`2.4`）一条，字段定义不产出、`elementOfPath` 认不出字段；`reads` / `writable` 里的引用可以更细：`2.4` = 整个数组（读全字段 / 整表替换、可增删 item），`2.4.1` = 所有 item 里的「物品」那一格（只投影这些字段 / 整列替换、不增删 item）。**字段写只由逐字相同的字段引用授权**（容器 / 祖先字段都不授权；整表写只由容器授权）。数组字段 refs 把 `toolsForNode` 也带出 `write_state`（数组不是时间，不派生 `advance_time`）。
- 新建卡默认三节点（顺序 / id / name / reads / writable / readsUpstream / historyTurns / retryCount / prompt）：

| #   | id       | type     | name | reads | writable                               | readsUpstream | historyTurns | retryCount | prompt |
| --- | -------- | -------- | ---- | ----- | -------------------------------------- | ------------- | ------------ | ---------- | ------ |
| 1   | `time`   | `time`   | 时间 | `[]`  | `['0']`                                | `[]`          | `0`          | `0`        | `''`   |
| 2   | `check`  | `normal` | 判定 | `[]`  | `[]`（建卡时只有 `'0'`；新增不自动加） | `[]`          | `0`          | `0`        | `''`   |
| 3   | `output` | `output` | 输出 | `[]`  | `[]`                                   | `['check']`   | `3`          | `0`        | `''`   |

`id` 是结构（选择器 / 链引用 / 测试），必须 ASCII 且稳定；`name` 是展示文案，住 `locales/zh-CN.json`。

- 新建卡 `state = [{ code:'0', name:'时间', note:'', type:'time', timeMode:'year-minute', initial:{year:1024,month:1,day:1,hour:8,minute:0}, holidays:{international:false,china:false,traditional:false} }]`，`prompts = [{ id:'opening', title:'开场', body:'' }]`；每张卡都带 `opening`（新建 / 删不掉 / 排第一，标题来自 `card.openingTitle`）。
- 新增状态元素 / 提示词块不自动进入任何节点的 `reads` / `writable`，作者用眼睛打开。
- **不做旧卡兼容 / 迁移**：没有 `normalizeCard`；`type:'string'`、`{day,hour}` 时间、缺 `opening`、带 `proof`、`readsUpstream` 是布尔的老卡，`validateCard` 直接报中文 `E_VALIDATION`（链规矩坏了是 `E_CHAIN`），不补字段。
- `readsUpstream` 是节点 id 数组，只能引用链上排在它前面的节点（自己与下游 ⇒ `E_CHAIN`）；空数组 = 不读上游。
- `historyTurns`：最近 N 条叙事 + 最近 N 条行动（含本回合）；本回合行动恒为历史块最后一条（详见 §5）。
- `retryCount`：**第一次之外的额外尝试次数**，`0..5` 的整数，缺省 `0`（旧卡没有这一格 = 0，不迁移、不回写；新建卡显式写 `0`）。越界 / 小数 / 字符串 ⇒ `E_CHAIN`（§6.1）。`output` 节点上合法但无意义 —— 它没有工具可失败（§4.6）。

### 2.2 Save

```js
{
  schemaVersion: 1, id: 's-<string>', cardId: string,
  cardSnapshot: Card,                    // 新建时整张卡深拷贝，此后不随卡改动
  nodeModels?: { [nodeId]: presetId },   // 这一份存档自己的映射；缺省 = 回落卡级
  name: string, turn: number,            // 已完成回合数；新建为 0
  tree: { [path]: string | number | TimeValue | ArrayValue },  // TimeValue 的格子跟着卡的 timeMode 走（§2.6）；数组值是 item 列表
  events: Event[], updatedAt: string     // ISO 时间戳
}
```

- `tree` 是**扁平完整 code 的值表**，新建时由 `initialTreeOf(cardSnapshot)` 展开：每个根元素的初始值摊平（键就是完整 code），时间根的值按 `timeMode` 收格后深拷贝。其余是字符串或整数。
- `validateSave(save, card)` 要求 `tree` **覆盖全部值路径**（`pathsOf`）且**没有多余键**：`object` 的自身 code（`2`）与「拿父 code 顶替 `<code>.0`」都被拒；`tree['0']` 的格子按 `card.state[0].timeMode` 判（没给 `card` 时三种形状都收），旧六格 / `{day,hour}` ⇒ `E_VALIDATION`。
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

### 2.6 时间与节日（`src/core/timevalue.ts` · `src/core/holidays.ts` · `src/core/lunar-table.ts`）

时间是**带模式的公历值**：三种模式各自的格子、各自能推进的单位、各自的显示。**没有秒**。

| 模式          | 值（`tree['0']`）              | 可推进单位                                | 显示                        |
| ------------- | ------------------------------ | ----------------------------------------- | --------------------------- |
| `year-minute` | `{year,month,day,hour,minute}` | year · month · week · day · hour · minute | `2024-02-10 08:30（周六）`  |
| `year-date`   | `{year,month,day}`             | year · month · week · day                 | `2024-02-10（周六）`        |
| `days-minute` | `{day,hour,minute}`            | day · hour · minute                       | `第 5 天 08:30`（没有星期） |

- **年份**：`-551 … -1` 与 `1 … 9999`（`YEAR_MIN` / `YEAR_MAX`），**没有公元 0 年**；显示成 `YYYY`（补到 4 位）或 `公元前{N}`（不补零）。换算一律先换**天文年**（`astro = year < 0 ? year + 1 : year`）：闰年 / 当月天数 / 星期几都按天文年算，所以公元前 1 年是闰年（`-1-02-29` 合法）。公历用 Hinnant 的 civil-from-days 那一对公式（纯算术，**不接第三方历法库**）。
- `days-minute` 的 `day` 是**正整数天数计数**（安全整数、`>= 1`），没有年月；时分满 24 / 60 进一天。
- `isTimeValue(value, mode?)`：给了 `mode` ⇒ 键集合必须**恰好**是那个模式的 5 / 3 / 3 格（多一格少一格都不认）；省略 ⇒ 三种形状任一（存档没有卡可比时用）。
- 卡里时间元素的 `initial` **必须恰好是这个模式的格子**（`year-minute` 5 格 / `year-date` 3 格 / `days-minute` 3 格）：多一格（例如 `year-date` 里带着钟点）⇒ `E_VALIDATION`（`issue.timeValue`）。`initialTreeOf` 把它深拷贝进 `tree['0']`，不收格、不改写。
- `advanceTime(value, amount, unit, { mode })`：`amount` 正整数、`unit` 必须在 `unitsOfMode(mode)` 里（第四参只有 `mode`；传了旧字段也当没传）；年 / 月按公历进位、目标月没有那一天就夹到月末（`2024-01-31 +1 月 = 2024-02-29`）、`week` = 7 × amount 天；跨「没有 0 年」按天文年（公元前 1 年 +1 年 = 公元 1 年）；越界 ⇒ `E_VALIDATION`。
- **节日是派生只读列表**，由「时间值 + 三个勾选」当场算出来（`holidaysOf(value, mode, holidays)`），**不写进 `state[]` / `tree` / 事件**：

| 组                       | 条目                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `international` 现代国际 | 元旦 1/1 · 情人节 2/14 · 妇女节 3/8 · 劳动节 5/1 · 儿童节 6/1 · 万圣节 10/31 · 圣诞节 12/25  |
| `china` 现代中国         | 元旦 1/1 · 劳动节 5/1 · 国庆节 10/1（**没有**任何农历派生节日）                              |
| `traditional` 中国传统   | 春节 · 元宵 · 龙抬头 · 端午 · 七夕 · 中元 · 中秋 · 重阳 · 腊八 · 小年 · 除夕（腊月最后一天） |

- 顺序 = 组顺序 × 组内定义顺序，**按名字去重、保留第一次出现**（元旦 / 劳动节同时住在两组里）；`days-minute` 模式与 `holidays` 缺失 ⇒ `[]`。没有清明（节气不是农历节日）。
- 传统节日只用一张**有界的农历年历表**（`LUNAR_INFO`，201 项 = 1900–2100，低 4 位闰月、bit4..15 月大小、bit16 闰月大小）：换算方向是**公历 → 农历 → 查节日表**，所以腊八 / 小年 / 除夕落在次年 1 月时照样算对；**闰月不算节日**。年份不在 `1900–2100`（或早于表内第一天 `1900-01-31`）⇒ 这一组一条都不产出，**不报错**；勾选**永远可点**（不置灰）。

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
- 资产形状 = 阶段 2.1 的 v5 样例 + 阶段 3 的背包：时间（`0`，推进单位由 `timeMode` 决定）+ `1 世界`（`text` + 空自身值 + 子节点；`1.1 区域` 下拉自身值 + `1.1.1 地点` 文字；`1.2 天气` 下拉；`1.3 氛围` 文字）+ `2 玩家`（`text` + 空自身值 + 子节点；名字 / 体力 0..100 步幅 1..10 / 状态下拉 / **`2.4 背包` 数组**：`2.4.1 物品` 文字 + `2.4.2 数量` 整数 0..999，初始值 `initial['2.4'] = [{'2.4.1':'短剑','2.4.2':1},{'2.4.1':'斗篷','2.4.2':1},{'2.4.1':'银币','2.4.2':3}]`）。人物与线索不在 2.1 里。
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
export { advanceTime }   // 语义见 src/core/timevalue.ts：advanceTime(value, amount, unit, { mode })
// src/core/statetree.ts（状态树：形状 / 派生 / 同步 / 校验；时间那半原样转出）:
export const YEAR_MIN, YEAR_MAX, TIME_MODES, TIME_UNITS
export function codeDepth(code) -> number
export function childrenOf(state, code) -> StateElement[]
export function isInsideArray(state, code) -> boolean   // 字段定义（数组的子孙）⇒ true
export function pathsOf(state, ref) -> string[]   // ref = 元素 code（自身值 + 子树；数组只有它自己）或 `<code>.0`（只有自身值）；认不出 / 字段 ⇒ []
export function elementOfPath(state, path) -> StateElement | undefined
export function arrayValueFits(state, code, value) -> boolean   // 数组值：同构 item 列表（§2.1）；[] 合法
export function arrayItemOf(state, code) -> ItemObject          // 新 item 的默认值（编辑器加一项 / 加字段共用）
export function isFieldRef(state, ref) -> boolean               // 数组字段引用（`2.4.1` 这类权限引用，不是值路径）
export function refElementOf(state, ref) -> StateElement | undefined   // 值路径元素 / `.0` 的基元素 / 数组字段定义
export function refPathsOf(state, ref) -> string[]              // 字段 ⇒ [ref]；别的走 pathsOf
export function refsUnder(state, code) -> string[]              // code 连同它下面所有元素（三态用）
export function refCoveredBy(state, list, ref) -> boolean       // list 里有没有引用覆盖 ref（自己 + 整棵子树）
export function arrayDiscardedCount(card, code) -> number       // 数组 → 对象前提示用：会丢几个 item
export function valueFits(state, element, value) -> boolean     // 标量 / 时间 / 数组共用的值形状判据
export function unitsOfMode(mode) -> TimeUnit[]
export function integerRangeOf(element) -> { min, max, stepMin, stepMax }   // 数字的生效格子；校验与编辑器 `min~max` 小字共用
// src/core/tool-definitions.ts:
export function toolDefinitionsOf(mode) -> { [name]: { description, inputSchema } }   // advance_time.unit 枚举 = unitsOfMode(mode)
export function advanceTimeSchemaOf(mode) -> JSONSchema7
export function cellsOfMode(mode) -> (keyof YearMinuteValue)[]
export function defaultTimeOf(mode) -> TimeValue
export function isTimeValue(value, mode?) -> boolean
export function formatTime(value, mode) -> string
export function advanceTime(value, amount, unit, { mode }) -> TimeValue
export function initialTreeOf(card) -> Tree
export function addChild(card, code) -> Card
export function removeNode(card, code) -> Card
export function setElementType(card, code, type) -> Card
export function setInitial(card, path, value) -> Card
export function setTimeMode(card, mode) -> Card
export function cardIssues(card, { initial? }) -> CardIssue[]
export function saveTreeIssues(card, tree) -> CardIssue[]
// src/core/holidays.ts:
export function holidaysOf(value, mode, holidays) -> string[]
// src/core/schema.ts:
export function toolsForNode(card, node) -> string[]
export { elementOfPath }   // 转出 `statetree` 那一份（老的调用方从这里取）
```

- `runTurn` **不修改入参**（`save` / `card` / `presets` / `nodePresets` 只读），返回**新的** `save`；失败一律 `throw AppError`，不返回 `{ error }` 混合形状。
- 每节点最多 `1 + retryCount` 次模型尝试（默认 1 次，不做多步工具循环）：一次尝试里的工具调用要么全生效、要么全丢弃，失败按 §4.6 重试。
- 节点模型解析（`resolveNodePreset`）：`nodePresets?.[nodeId]` 有值 ⇒ 在 `presets` 里按 id 找；没有 ⇒ 用 `presets[0]`；找不到（池子空 / 映射指向已删预设）⇒ `E_VALIDATION`（消息指向设置页，不静默退回）；卡里残留的 `presetId` 一律忽略。
- 调试读数只有 `trace` / `turnStats` 事件，没有独立 debug 载荷；两者都进 `save.events`，同时经 `onEvent` 实时发出，因此重开旧存档也能回看历史每一步。

### 4.2 一回合的执行

`runTurn` 顺序做四件事，**任何一步失败都中止本回合、存档保持调用前的样子**：

1. `validateCard(card)` → `validateSave(save, card)`；`card` 与 `save.cardSnapshot` 必须**同 id**；`signal` 已中止 ⇒ `E_ABORTED`。
2. 追加一条 `action` 事件（`text = action`）。
3. 按 `chain` 顺序逐节点执行：`node` 事件（`text = node.name`，`detail = { id, type }`）→ 解析预设 → `buildPrompt`（用**此刻**的 tree）→ 按 `retryCount` 做模型尝试与工具执行（§4.6）→ `trace` 事件；`output` 节点再追加 `narration`。
4. 收尾：追加 `turnStats`、`turn += 1`、刷新 `updatedAt`；提交前再跑一次 `validateSave(nextSave, card)`，通过后返回 `{ save, events }`；`save.events` = 旧 + 新，`events` = **只有本回合新事件**（同一批对象）。

### 4.3 工具与写入（`writable` 是唯一的权限来源）

- **节点类型不决定能写什么**：`time` / `normal` 的 `writable` 里都可以有时间元素 `'0'` 与普通元素（也可以写 `<code>.0`，只拿自身值的写权限）；工具由**每个引用覆盖到的值路径**（`pathsOf`）派生：覆盖到时间 ⇒ `advance_time`，覆盖到任何非时间 / 非结构体的值 ⇒ `write_state`，两样都覆盖 ⇒ 两个工具。
- 唯一例外是 `output`：它只产故事，`writable` 必须是空的（卡校验 `E_CHAIN`），`toolsForNode` 给它 `[]`。
- `advance_time({ amount, unit })`：`amount` 是**正整数**，`unit` 必须在**当前时间模式**的单位表（`unitsOfMode(mode)`）里，否则 `E_VALIDATION`；按公历推进（年 / 月月底夹取、`week` = 7 × amount 天、越过 `-551..9999` 年或天数越界 ⇒ `E_VALIDATION`），写回该时间元素自己的值路径；工具结果用 `formatTime(next, mode)`。**provider 声明的 `unit` 枚举按模式收窄**（`toolDefinitionsOf(mode)` / `advanceTimeSchemaOf(mode)`，来源就是 `unitsOfMode`）：year-date 的模型看不到 `hour` / `minute`，days-minute 看不到 `year` / `month` / `week`；静态 `TOOL_DEFINITIONS` 保留六个单位的全集给没有卡可比的调用方，执行器照旧再判一次模式。
- `write_state({ path, value })` 只能写 `node.writable` 里**逐字授权**的路径（完整 code；有孩子的节点自身值是 `<code>.0`，数组容器是它自己的 code，数组字段是一列）：值按元素类型收：`text` 字符串、`integer` 安全整数 + 上下限 + 单次步幅、`enum` 白名单、`array` 一份合法 item 列表；写时间 ⇒ `E_CHAIN`（提示改用 `advance_time`）。模型可能把整数写成 JSON 字符串（schema 的 `value` 收 `string | integer | array | object`）⇒ `integer` 收到**数字字符串**时先收成数字（`"85"` ⇒ `85`，落进 `tree` 的是数字），再做上下限 / 单次步幅；非数字串（`"abc"` / 空串）照旧 `E_VALIDATION`。`writable` 写的是 `<code>.0` 时，只有那一格可写，孩子不在权限里。
- `applyWrite`：时间 ⇒ `E_CHAIN`；不在覆盖范围（越权 / 路径不存在 / 父 code 本身 / 结构体自身 code / 没授权的字段 / `2.4.0`）⇒ `E_CHAIN`；结构体没有自身值 ⇒ `E_VALIDATION`；值类型或范围不符 ⇒ `E_VALIDATION`；合法返回**新** tree（入参 tree 一个字都不改）。**先判权限（`E_CHAIN`）再判值（`E_VALIDATION`）**。
- **数组整表替换**：命中数组容器（值路径 = 数组 code）时，`value` 必须是合法数组（§2.1 的 item 形状，空数组合法）：旧 item 全部消失、新 item 按给定顺序落进 `tree[path]`；形状不对 ⇒ `E_VALIDATION` 且 tree 一个字不动；item 里的 integer **只判上下限、不判步幅**（整表替换没有「单次写入」的旧值可比），**不做数字字符串收编**（`"1"` 是坏值）。没有数组专用的 add / remove 工具，也没有「按下标改一项」的路径；`write` 事件里 `detail.value` = 整份新数组。
- **数组字段整列替换**：命中字段引用（`2.4.1`）时，`value` 是**按数组层嵌套**的数组：最外层长度 = 外层 item 数；路上每穿过一个 `array` 字段多一层数组，每层长度 = 那一层的当前 item 数（`[]` 也要逐层对上）；最内层每项按字段类型严格判（integer 只判上下限、不判步幅）。只改这一格 —— 其余字段 / item 顺序 / 外层 item 数一个字不动；长度 / 形状 / 类型不符 ⇒ `E_VALIDATION`、tree 不动；**不许借字段写增删外层 item**。字段写只由**逐字相同**的字段引用授权（`2.4` 不授权 `2.4.1`；`2.4.2` 也不授权 `2.4.2.1`），未授权 ⇒ `E_CHAIN`。`write` 事件的 `path` = 字段引用、`detail.value` = 这次写进去的那一列值。
- 工具调用被引擎执行时记两条事件：`tool`（`detail = { name, args }`）与 `write`（`detail = { path, value }`）；同一次调用还进该节点的 `trace.toolCalls`（带 `result`）；模型正文里的工具调用**一律不认**。
- **工具参数表只有一份**（`src/core/tool-definitions.ts`）：provider 序列化给模型的 `inputSchema` 与引擎执行器读的实参名是同一张形状表（`advance_time` = `amount`/`unit`、`write_state` = `path`/`value`），值域仍由执行器判。`advance_time.unit` 的枚举**按时间模式生成**：`toolDefinitionsOf(mode)`（= `TOOL_DEFINITIONS` + `advanceTimeSchemaOf(mode)`）用 `unitsOfMode(mode)`，引擎把卡里的 `timeMode` 传给 `callProvider`。
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

### 4.6 节点重试（`retryCount`）

一个节点最多试 `1 + (node.retryCount ?? 0)` 次，**每次尝试是原子的**：

1. `basePrompt = buildPrompt({ card, save: { ...save, tree }, node, action, outputs })` 在节点开始时拼一次（tree = 本回合此刻的 tree）。
2. 第 0 次尝试用 `basePrompt`；第 n 次尝试（n > 0）用 `basePrompt + '\n\n' + <工具执行失败>`，块里只写**上一次**那条错误，且必须是提示词最后一个块（`prompt.trimEnd()` 以 `</工具执行失败>` 结尾）。
3. 一次尝试 = 一次 provider 调用 + 依次执行回的 `toolCalls`（工作副本从**本次尝试开始前**的 tree 起）。任一调用抛错 ⇒ 这次尝试的写入与 `tool` / `write` 事件全部丢弃，`tree` 一个字不动。
4. 成功 ⇒ 只提交这次尝试的 `tree` / 事件 / `trace`；失败且还有剩余次数 ⇒ 带错误块重调；失败且已耗尽 ⇒ 抛出**最后一次**的错误，`runTurn` reject、不返回存档（无部分保存）。
5. `trace.attempts` 是每次尝试的读数：`{ index, toolCalls, error }` —— `index` 0 基、`toolCalls` 只含这次尝试里**成功执行**的调用（失败那条不在）、`error` 是 `{ tool, path, code, message }` 或 `null`。`trace.toolCalls` = 最终提交那次尝试的调用（与 `attempts.at(-1).toolCalls` 同值）；`trace.prompt` = 最后一次尝试的提示词；`durationMs` = 该节点全部尝试的模型调用耗时之和。没有工具可失败的节点（`toolsForNode` 为空，如 `output`）只调一次模型，`attempts` 长度恒为 1。
6. **`<工具执行失败>` 块**（中文逐字，标记是契约的一部分）：

   ```
   <工具执行失败>
   工具：{tool}
   路径：{path}
   错误码：{code}
   原因：{message}
   正确值形状：{guidance}
   </工具执行失败>
   ```

   `{path}`：`write_state` 用它实参里的 `path`；`advance_time` 用时间元素的值路径（通常是 `0`）；工具名不在节点工具表里 ⇒ `（无）`。`{code}` / `{message}` 是 `AppError` 的中文原文。`{guidance}` 由**目标元素的类型**派生（不复述模型原文）：`text` ⇒ `JSON 字符串`；`integer` ⇒ `JSON 整数` + 该元素生效的 `min..max` 与步幅；`enum` ⇒ `JSON 字符串` + 白名单；`array` ⇒ `一份 JSON 数组，每个元素是对象` + 每项字段的中文名 / 类型 / 范围（整表替换）；时间 ⇒ 只能 `advance_time`、列该时间模式允许的单位；路径不存在 ⇒ 列节点可写的值路径；工具名不合法 ⇒ 列该节点允许的工具。

7. mock 与真 provider 收到的是**同一份** prompt：引擎把本次尝试最终拼出的 prompt 传给 `mockReply({ prompt })`，与 `callProvider({ prompt })` 一致（§7）。

## 5. 提示词拼装（`src/core/prompt.ts`）

```js
export function buildPrompt({ card, save, node, action, outputs }) -> string
```

`outputs` = 本回合**已执行节点**的输出，按节点 id 索引（`{ [nodeId]: text }`）。拼接顺序固定，**每段自带标记，空段连标记一起省略**（`<可写状态>` 例外：非 `output` 节点没有写权限也要出现，见第 3 段）：

1. **公共提示词**：`card.prompts` 顺序里 `id ∈ node.reads` 且 `body !== ''` 的，每块 `<公共提示词·{title}>`，下一行起 `body` **逐字**。
2. **状态树**：`<世界状态树>` + 读到的每个引用**一行**：`- <code>「<name>」：<JSON>`（`.0` 引用那一行的 `<code>` 写的是值路径，名字仍是元素的 `name`）。**读元素 code** ⇒ 时间输出 `formatTime` 那一行（按模式：`2024-02-10 08:30（周六）` / `2024-02-10（周六）` / `第 5 天 08:30`）；有孩子的节点输出「自身值 + 整棵子树」的 JSON（**键是中文名**：自身值 `"自身"`、孩子用元素 `name`，**嵌套**；没有 `"0"` / `"1"` 这种 code 键；结构体没有 `"自身"`）；**数组输出一份 JSON 数组**：每个 item 是一个对象，键是字段的 `name`（中文名）、值按字段类型递归（嵌套 `object` ⇒ 嵌套对象，嵌套 `array` ⇒ 数组）；**字段引用并进容器这一行、不单独出行**：读容器 ⇒ 全字段；只读字段引用 ⇒ 每个 item 只投影**选中的字段**（`reads` 里 `A.` 开头的引用取并集；只选后代时祖先对象仍出现来装它；没选的字段一个键都不出现；item 顺序与嵌套分组保留；空数组输出 `[]`）。读父 code 时数组只在父那一行里出现一次。**时间那一行下面可以紧跟一行 `节日：…`**（`holidaysOf` 非空时；前缀 `节日：`、分隔符 `、`，只出现一次）；节日不是状态值，`tree` / 事件里都没有。**读 `<code>.0`** ⇒ 只输出这个元素自己的值，不出孩子、不出整棵树。读父 code 时子孙不再单独出行；只读 `.0` 时孩子照旧可以单独读。不输出形状表 / 类型清单；一个引用都没读 ⇒ 连标记都不出现。
3. **可写状态**：`<可写状态>` + `node.writable` 的每个引用一行：`- <code>「<name>」：<约束>`。约束同时说明**合法 JSON 值形状**：`text` ⇒ `文本；必须是 JSON 字符串`；`enum` ⇒ `下拉；必须是 JSON 字符串，只能是 <卡里 values 顺序、`、` 连接>`；`integer` ⇒ `整数 <min>..<max>，步幅 <stepMin>..<stepMax>；必须是 JSON 整数（不能是字符串或小数）`（缺省取生效值）；`time` ⇒ `只能通过 advance_time 推进，不能 write_state`；`array` 容器 ⇒ `数组；必须是 JSON 数组，每个元素是一个对象（整表替换，不是追加或局部修改）。每项的字段：<中文名> = <类型 / 范围>；…`（嵌套 `object` / `array` 字段递归列，**不出现字段 code**）；**数组字段引用** ⇒ `字段；必须是 JSON 数组，长度必须等于当前项目数，每项是 <该字段的类型 / 范围>（只改这一格，不能增删项目）`，穿过 `array` 字段的引用额外说明**值按数组层嵌套、每层长度各等于那一层的当前项目数**。容器与字段引用同时开 ⇒ **两行都在**（整表替换与整列替换是两种操作）。**约束一律从 `StateElement` 的 `type` / `values` / `min` / `max` / `stepMin` / `stepMax` 派生**（整数走 `integerRangeOf`，与校验同一份缺省），文案只有通用模板、**没有按某张卡或样例写死的字符串**。**时间绝不列成可写的 `write_state` 路径**；时间不在 `writable` 里就一个字符都不出现。`writable` 为空且节点不是 `output` ⇒ 块里没有一条写路径，正文说 `无可写状态`、不要调用写工具。**非 `output` 节点这一段永远出现**（空也要出现），末尾恒有一句「未列出的状态一律只读；只有上面列出的值路径可以写」——节点提示词里的说法不作数；**`output` 节点整段不出现**（它什么也不写，连 `无可写状态` 都不留）。
4. **历史**：`<游戏历史记录>` + 最近 `node.historyTurns` 条叙事与最近 `node.historyTurns − 1` 条历史行动，按事件原有先后穿插；本回合 `action` **恒为最后一条**。
5. **上游输出**：`node.readsUpstream` 点名的、排在它前面的节点，按**链顺序**，一段一个 `<上游输出·{nodeName}>`，下一行起正文逐字（空串跳过）。
6. **本节点提示词**：`<节点提示词>`，下一行起 `node.prompt` 逐字（空则整段省略）；它永远是最后一段。

- 历史细节：**没有独立的「玩家行动」段**；`n = 0` ⇒ 只有本回合 action（不取叙事 / 开场白）；`n = 1` ⇒ 最近 1 条叙事 + 本回合 action（不含上一个行动）；没有叙事的回合整条不进块；历史只取 `action` / `narration`，忽略 `node` / `tool` / `write` 等。
- **开场白**：`opening` 的正文是**最早的一条叙事**，与事件里的叙事共用 `n` 预算（更近的优先；新存档 + `n=1` ⇒ 开场白 + 本回合 action）；`opening` 同时作为公共提示词块出现时两处独立，不合并、不删块。
- 🔴 **状态读的是「此刻的 tree」**：链上更早节点在同一回合写下的值必须出现在后面节点的状态段；判据 `v2/tests/engine.test.js` 的「同一回合内的写入立刻可见」。
- 段间分隔符与行动行前缀（`> `）由实现定，测试不断言；但要求所有段正文逐字可见（不截断、不转义）、相对顺序可用 `indexOf` 判、本节点提示词最后。
- 关掉的块 / 元素 / 上游，对应正文与标记一个字符都不许出现；**行动只出现一次，且只在历史块里**；判据 `v2/tests/prompt-markers.test.js` 与 `v2/e2e/prompt-history.spec.js`。
- 标记字面量是**契约的一部分**：作者只能从 trace 看见提示词结构，改字面量必须同批改判据。
- 眼睛语义：`reads` 里有它就读，没有就不读；`readsUpstream` 是读哪些上游节点的输出；`writable` 是写的开关，它的权威投影是 `<可写状态>` 段（**节点提示词里的说法不作数**）。
- **重试时的提示词**：第 2 次及以后的尝试在本段拼好的提示词末尾追加一个 `<工具执行失败>` 块（格式见 §4.6），它是**最后一块**；`trace.prompt` 记的是最后一次尝试的那一份。

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
- 节点 `type` 只能是 `'time' | 'normal' | 'output'`（别的值 ⇒ `E_VALIDATION`）；节点 `id` 唯一；`historyTurns` 是 ≥0 的整数；`retryCount` 缺省合法（按 0），给了就必须是 `0..5` 的整数（`-1` / `6` / `1.5` / `'1'` ⇒ `E_CHAIN`，`detail = { nodeId, retryCount }`，`message` 点名节点 id 与区间）。
- `readsUpstream` 里的每个 id 都必须在链上，且**排在它前面**（首节点只能为空）。
- `reads` 引用必须存在（提示词 id、元素 code、合法的 `<code>.0` 自身值路径，或**数组字段引用** `2.4.1` / `2.4.2.2.1`）；`writable` 引用必须是元素 code、合法的 `<code>.0` 或数组字段引用；悬空 / 叶子 `.0` / `object` 的 `.0` / 时间 `0.0` / `2.4.0` / 字段的 `.0`（`2.4.1.0`）⇒ `E_VALIDATION`（点名那个引用）。
- **写权限只由 `writable` 决定**：`time` / `normal` 都可以写任意 code（含 `'0'` 与数组容器 code），工具按 code 覆盖到的值路径派生；`output` 的必须是 `[]`。
- **状态树那半的规矩**由 `core/state-issues.ts` 的 `cardIssues(card, { initial })` 给出（`code` / `path` / 中文 `message`，外加 `validateCard` 抛第一条时用的 `errorCode`）：编号铁律（含顶层根 1..n）、深度 ≤ 5、`object` 有孩子、`time` 的 `timeMode` / 节日格子 / 时间值、enum / integer 的格子、父 code 存在、孩子连续编号；**数组**另有四条：数组必须有 ≥1 个字段、`object` / `array` 字段必须有孩子、标量字段不许有孩子、数组字段不能是 `time`（嵌套子孙也拦）；**初始值这一族**只看根元素（子元素带 `initial` ⇒ 一条问题；根缺 `initial` / 少值路径 / 多键（含 `2.4.0` 与字段 code）/ 值不合类型与上下限或 item 形状 ⇒ 各一条，`path` 点名那一条）。`initial: false`（存档模式）⇒ 初始值这一族整块不判。保存按钮与 `validateCard` 共用这一份清单，不各判一套。
- **`prompts` 里必须有 `id === 'opening'` 的那一块**（缺 ⇒ `E_VALIDATION`，不补）。
- **`presetId` 不在这里校验**：卡可以带着空 / 已失效的 `presetId` 存着，到 `runTurn` 取预设那一步才报 `E_VALIDATION`。

`validateSave(save, card)`：`schemaVersion === 1`；`id` / `cardId` 非空；`turn` 是 ≥0 整数；`events` 是数组；`tree` 是记录、每个值只能是文字 / 安全整数 / 时间值（只住在 `0`，按卡的 `timeMode` 判；没给 `card` 时三种形状都收）**/ 数组 / item 对象**（没给 `card` 时按 JSON 形状收下）；给了 `card` 时 `cardId` 相等，`tree` **恰好覆盖** `pathsOf` 的全部值路径（不缺 `1.1.0` 这类自身值路径、不许多出 `object` 自身 code / 数组字段 code / `2.4.0` 这类键），且每个值符合它元素的类型（数组按 item 形状严格判，空数组合法）。

## 7. mock 提供方（`src/core/mock.ts`）—— 测试替身

`preset.provider === 'mock'` 时**不发任何网络请求**，回确定的响应（同一输入同一输出）；工具按 `writable` 覆盖到的值派生（§4.3），节点类型只决定它吐不吐正文：

| 节点              | 回什么                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `time` / `normal` | 覆盖到时间 ⇒ 一次 `advance_time({ amount: 1, unit: 'day' })`（`day` 在三种模式的单位表里都有）；覆盖到文字值 ⇒ 一次 `write_state({ path: <第一个文字值路径>, value: 'mock-t<turn>' })`（两样都覆盖就两个调用）；都没有 ⇒ 空响应 |
| `output`          | 文本 `[mock] turn <turn>: <action>`，**流式**：块长 `floor(len/6)` 夹到 1..8（每块 ≤8 字符），块数 ≥3；块间等 `mockChunkDelayMs`（缺省 0）                                                                                      |

- mock 走的**是同一套事件 / 流式代码路径**（`chunk` → `narration`），不是另一条捷径。
- 入参：`mockReply({ card, node, turn, action, prompt?, onChunk?, signal?, delayMs? })` —— `prompt` 是引擎本次尝试最终拼出的提示词（与 `callProvider` 收到的是同一份）；mock 的回复是确定性的、不读它，测试替身用它断言错误块。`retryCount` 对 mock 的回复没有影响：工具失败只可能因为回复里的调用不合法，而 mock 不发不合法的调用。
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
- 新建存档：默认名 `save <n>`，**追加到列表末尾、不跳转**，`tree = initialTreeOf(cardSnapshot)`（扁平完整 code，自身值在 `<code>.0`）、`cardSnapshot` 深拷贝、`nodeModels` 从卡级映射拷一份。
- 卡行：`[data-card-id="<id>"]`（点击只选中，不跳页）、`[data-card-name]`、`[data-card-edit]`（进 `#/edit/:cardId`）、`[data-card-rename]`、`[data-card-delete]`、`[data-card-count]`（存档数）。
- 行内重命名：`[data-rename-input]` 回车提交 / Esc 取消 / blur 提交，提交后立即落盘；输入框与重命名按钮的 pointerdown / click 不许冒泡到行（点输入框不变选中、不跳对话页）。
- 存档行：`[data-save-id="<id>"]`（点击进对话页）、`[data-save-name]`、`[data-save-meta]`（含卡名与回合数数字）、`[data-save-edit]`（在改名 / 删除左边，进 `#/edit-save/:saveId`）、`[data-save-rename]`、`[data-save-delete]`。
- 删除确认：`[data-confirm]`，只有 `[data-confirm-ok]` 真删、`[data-confirm-cancel]` 取消；删卡只删 `tg2.cards` 这一张（存档全留、`tg2.nodeModels[cardId]` 保留，确认文案说存档保留）；删存档只删那一份（确认文案说不能撤销）。
- 空态：无卡 `[data-empty-cards]` 可见（「还没有游戏卡」），无存档 `[data-empty-saves]` 可见。
- 坏项逐行标记：非法行带 `[data-invalid-card]` / `[data-invalid-save]` + `[data-invalid-badge]` + `[data-invalid-name]` + `[data-invalid-reason]`（中文 `error.message`），**没有任何入口**（不选中 / 不编辑 / 不改名 / 不删除 / 点了不跳页）；合法行照旧。
- 写走宽松写：只替换合法项，坏项 **JSON 值**不变；存档卡名按「现存卡名 → 快照名 → 中性回退」；快照缺名字 / 快照本身不是合法卡 ⇒ 坏项；整表坏 JSON / 顶层不是数组 ⇒ 错误页，且不渲染列表与新建按钮。
- 列表三态（首页卡行 / 存档行 / 状态行 / 提示词块共用）：默认浅底（`--panel`）+ 深字（`--ink`）、悬停只把边框变深（不铺底色）、选中 = 深底浅字（浅色主题 `--active-bg` #927049 / `--active-ink` #fff，深色主题反过来用 `--accent` / `--accent-ink`）+ 字重 600，对比度 ≥4.5；坏项虚线 danger 边框。
- 判据：`lists.spec.js` / `empty.spec.js` / `snapshot.spec.js` / `invalid-items.spec.js` / `list-styles.spec.js`。

### 8.2 编辑器

- 四区一行排开：`[data-col="left"]` · `[data-workflow-strip]` · `[data-col="middle"]` · `[data-col="right"]`；左 / 右可拖，细条固定 96px，中栏恒为余量。
- 四个面板标题共用 `.col-title` 同版式（41px = `--control-h` + 13px、`padding: 6px 8px`、1px 实线下边框），各带 `data-panel-title`；加号按钮在标题条外（绝对定位）；中栏标题：节点 / 元素 / 提示词 → `编辑·<name>`，没选 → `编辑`；中栏字段表不自带标题。
- 分隔条：`[data-splitter="left"]` 在左栏右缘（往右拖 = 左栏变宽），`[data-splitter="right"]` 在右栏左缘（往左拖 = 右栏变宽）；双击恢复默认 280 / 320；夹取左 `[200, 480]`、右 `[240, 560]`，中栏不得小于 320；拖完落盘 `tg2.settings.editorColumns`（整数 px），刷新保留。
- 选中态互斥：S0 什么都没选 · S1 选中工作流节点 · S2 选中状态元素 · S3 选中公共提示词块；两个 `ref` 互相清空，任一时刻最多一格。
- 左栏：S0 只有 `[data-state-code]` + `[data-state-name]`；S1 每行 `[data-eyes="read"]` / `[data-eyes="write"]`（**文字按钮**「读」/「写」，带 `data-on` 与三态 `data-tri="all|some|none"`，切换当前节点的 `reads` / `writable`），写眼睛只看 `node.writable`、`output` 没有写眼睛；S2 栏顶 `[data-add-state]`（裸 `+`）、每行 `[data-add-child="<code>"]`（第 5 层不渲染、时间没有、**数组字段里的标量没有**）与 `[data-delete-state]`（裸 `×`，时间没有），S2 不出现眼睛。**数组的分量与字段行都有眼睛**：`2.4`（容器）与 `2.4.1` / `2.4.2.1` / `2.4.2.2.1`（字段，含嵌套 / 穿 array 字段）都能点，点了往 `reads` / `writable` 写的是**那条权限引用**（不是值路径）。
- 状态树 `[data-state-tree]`：每行 `[data-state-item="<code>"]` + `data-depth="<可见深度>"`（`0` ⇒ 1、`1.1` ⇒ 2），行内只有 `[data-state-code]` / `[data-state-name]` / 眼睛 / 加子元素 / 删除 —— **初始值与当前值都不显示**（`[data-state-value]` 不存在）；`.0` 永远不单独出行；数组的字段行照常出行（它们是 schema）。
- 眼睛的三态按**子树覆盖**算（不是值路径交集）：一个引用覆盖**自己 + 整棵子树**（`2.4` 覆盖 `2.4.1` / `2.4.2`…；`2` 也覆盖 `2.4.1`），`<code>.0` 只覆盖那个自身值。所以父行「满」= 整段都被覆盖（容器引用在，或所有字段各自 / 被祖先覆盖）、「半」= 只覆盖一部分、「未」= 没有。点字段行：`none` ⇒ 加这条字段引用；`all` 且自己的 code 在清单里 ⇒ 删掉它 + 后代；`all` 但只是**祖先引用覆盖** ⇒ **拆开祖先**（把祖先换成「目标以外的每一层兄弟」：`['2.4']` 点 `2.4.1` ⇒ `['2.4.2']`）；`some` ⇒ 选中整格（加自己的 code、去掉后代）。点容器 / 普通行：`all` ⇒ 摘掉自己 + 后代；`some` / `none` ⇒ 加自己并去掉后代冗余（清单里只留父 code）。所有点击只改草稿，`[data-save-card]` 才落盘。
- 中栏 S1：`[data-node-name]`（input，改 `node.name`；细条 / 中栏标题跟着变，卡与存档两种模式都可改）、`[data-node-preset]`（select）、`[data-node-retry]`（number，`min=0 max=5 step=1`，文案 `editor.nodeRetry`「调用重试次数」，显示值 `node.retryCount ?? 0`；`change` 只收 `0..5` 的整数，不合法不发 patch；卡模式与存档模式都可改，保存落 `chain[].retryCount` / `save.cardSnapshot.chain[].retryCount`）、`[data-node-history]`（number）、`[data-node-prompt]`（textarea）；**DOM 顺序就是 preset → retry → history**；**这一形态没有眼睛**。
- 中栏 S2：`[data-state-type]` **同一个元素上还带 `[data-field="type"]`**（一个 select 两个钩子）：时间元素 ⇒ 它的 value 是**模式 id**（`year-minute` / `year-date` / `days-minute`，恰好三项），卡模式可改、存档模式 `disabled`；非时间元素的**作者选项**是 `text|integer|enum|time|array`（`array` 显示「数组」；导入的 `object` 元素照实显示），照旧可改。**数组 ⇄ 结构体的类型锁**（增补 §十.5）：数组元素（数组子树之外）的选项**只有 `array` 与 `object`**（不许出现 text / integer / enum / time）；对象元素保留 `object` + 作者选项（含 `array`）；数组字段只留 `array`（逐 item 转换不在本票）；**存档模式整格 `disabled`**（所有元素，结构冻结）。另有 `[data-field="name"]`、`[data-field="note"]`；各类型的格子：enum 的 `[data-field="values"]`（textarea，一行一个）、integer 的 `[data-field="min"]` / `max` / `step-min` / `step-max`、time 的三个节日勾选 `[data-holiday="international|china|traditional"]`（`days-minute` 一个都不渲染；三个都**永远可点**，不置灰）+ 传统节日旁常驻备注 `[data-holiday-note]`（`仅支持 1900–2100`）+ 时间格子 `[data-field="time-year|time-month|time-day|time-hour|time-minute"]` 按模式给 5 / 3 / 3 格（**没有 `time-second`**），每格右边紧邻单位 `[data-time-unit]`。**没有单独的 `[data-field="time-mode"]`，也没有任何 `[data-field="granularity-upper|lower"]`**（两者 count 恒为 0）。三个节日勾选在**同一水平行、左对齐**（中栏放不下时这一行自己横向滚动，**不换行**）：`[data-holiday]` 就是那个看得见的自定义方盒（`appearance: none`、14×14、颜色取自 `--ink` / `--accent` / `--line` 那一族，勾上是 `--accent` 底而不是浏览器原生蓝）；点按热区用 `::before` 扩到 24×24，视觉盒仍是 14×14。**初始值那一块住在中栏下半部分**（两行布局：上半 = 结构字段、至少占一半；下半从 ~50% 起 = `[data-initial-block]`，不贴底、不用 `margin-top: auto`；两块间 ≥16px，放不下就滚动）；**初始值块只在选中的是根元素时渲染**，每条值路径一行 `[data-initial-row="<存储路径>"]`（顺序 = `pathsOf`；数组路径那一段是下面那个数组编辑块）：行内从左到右是 `[data-initial-code]`（显示编号 = 存储路径去掉结尾 `.0`，所以容器本体 `1.1.0` 显示 `1.1`）→ `[data-initial-name="<存储路径>"]` → 值控件；行按显示编号的段数每层缩进 12px。值控件：根元素自己那一行带 `[data-field="initial"]`，后代带 `[data-initial-path="<存储路径>"]`；integer 行的输入框右边带 `[data-initial-range]` 小字 `min~max`（生效上下限）。选中的是子元素 ⇒ 整块不渲染。存档模式**不渲染**初始值整块，integer 改在上下限下方显示 `[data-current-value]`（读 `save.tree`），数组元素显示只读的 `[data-current-array="<code>"]`（见下）。
- **数组的初始值编辑块**（`ArrayValue.vue`，`[data-initial-block]` 里）：`[data-array="<数组值路径>"]` 是一个数组值（顶层 `2.4`，嵌套字段如 `2.4.3.2`）；每个 item 是 `[data-array-item]` + `data-array-index="<n>"`（**1 基**，删一项后剩下的重排为 1..n；这两个钩子只挂顶层 item 列表，嵌套数组不重复挂）；字段控件 `[data-array-field="<字段 code>"]`、字段中文名 `[data-array-field-name="<字段 code>"]`（显示 `物品` / `数量`，**不显示 code**）、`object` 字段块 `[data-array-object="<字段 code>"]`（里面按孩子 code 递归）；`[data-array-add]` 追加一项（默认值来自 `arrayItemOf`）、`[data-array-remove]` 删掉这一项（**不弹确认**）、`[data-array-empty]` 空数组时可见（`[]` 合法，不是错误态）。编辑只改内存草稿，点 `[data-save-card]` 才写盘；落盘值 = 根元素 `initial['2.4']` 的整份数组（不写 `2.4.0`）。整数字段空输入不写草稿（恢复旧值），合法整数才更新。
- **数组的当前值（存档模式）**：选中数组元素 ⇒ `[data-current-array="<code>"]`，内部复用同一套 `[data-array-item]` / `[data-array-field]` / `[data-array-field-name]` / `[data-array-object]`，控件 `disabled`、没有 `[data-array-add]` / `[data-array-remove]`；值读自 `save.tree[code]`。卡模式没有当前值块。
- 改初始值 / 换类型都走 `core/statetree.ts`（数据层在 `state-data.ts`）：编辑器只发请求，`setInitial` 写进拥有那条值路径的根元素，`setElementType` 产出整份新元素并同步初始值（`object` 删自己的值路径、标量补默认值、**换成数组 ⇒ 清掉这棵子树的键后写 `[]`**）。**数组 ⇄ 对象**（卡编辑器）：字段定义原样、引用逐字保留；数组 → 对象取**第 1 项**摊平（0 项写字段默认值），`items.length > 1` 时**先弹 `[data-confirm]`**（文案说清「其余 N-1 项将被丢弃」；取消 ⇒ 草稿不动、下拉拨回 `array`；0 / 1 项不弹）；对象 → 数组把后代值收成**一个 item**（没有后代值 ⇒ `[]`）。**从数组换成 text / integer / enum / time ⇒ `E_VALIDATION`，草稿不动，下拉拨回 `array`**；数组子树里的字段做 array⇄object 也 ⇒ `E_VALIDATION`。数组子树里的字段增删由 `state-array.ts` 搬值：加字段把默认值补进**所有现存对应 item**（外层 / 内层都写）；删字段把键从所有 item 里摘掉，同层重排时 item 的键按同一张映射表改名。
- **换时间模式（只在卡模式）**：改 `[data-field="type"]`（时间元素的这一行就是模式选择器）⇒ 先弹 `[data-confirm]`（`editor.timeModeConfirm`），**草稿此刻不动**；取消 ⇒ 模式与时间初始值都不变（下拉拨回当前模式）；确定 ⇒ `setTimeMode` 把时间初始值重置成新模式的默认值、天数模式删掉 `holidays`（切回年份模式补一份三个都是 `false` 的）；底层 `state[0].type` 永远是 `time`。
- 中栏 S3：`[data-prompt-title]` + `[data-prompt-body]`（textarea）；没选：`[data-empty-middle]`（空壳，不写句子）。
- `[data-node-preset]`：选项 = `tg2.presets` 全部；当前值 = 这个节点解析出的预设 id（映射没有就是 `presets[0].id`）；改动写 `tg2.nodeModels[cardId][nodeId]`，**不动卡**；一个预设都没有时为空、`aria-disabled="true"`（不另挂提示）。
- 工作流细条 `[data-workflow-strip]`：每节点 `[data-node-id="<id>"]`（点击选中，带 `data-selected`）；选中节点时，排在它前面的每个节点旁有 `[data-read-upstream][data-upstream-id="<id>"]`（带 `data-on`，切换 `readsUpstream`）；自己与下游没有。
- 右栏 `[data-prompt-list]`：每块 `[data-prompt-block="<id>"]`（点击选中，带 `data-selected`）、`[data-prompt-name]`、`[data-delete-prompt]`（裸 `×`）；`[data-add-prompt]`（裸 `+`，新 id 由创建方生成并当场选中）；选中节点时每块有 `[data-prompt-read][data-prompt-id="<id>"]`（带 `data-on`，切换 `reads`）；没选节点时它不出现；右栏没有输入框。
- 每张卡都有一块 `id: 'opening'`（标题「开场」）：新建卡自带、示例卡也有一份；右栏不给它 `[data-delete-prompt]`。
- **保存按钮**：编辑只改内存草稿，顶栏 `[data-save-card]` 才校验 + 落盘。校验不过 ⇒ **不写盘**、草稿保留、中文错误清单 `[data-save-errors]`（每条 `[data-save-error]` 带 `data-save-error-code`，点了选中那一格）；成功 ⇒ 写盘 + `[data-save-ok]` 提示，**提示 3 秒后自动消失**（再保存重新计时）。清单来自 `cardIssues`（状态树 + 链的规矩）。
- **确认**：删状态元素、删公共提示词都先弹 `[data-confirm]`（`[data-confirm-ok]` 才真删，`[data-confirm-cancel]` 取消 = 草稿一个字不动）；有未保存改动点 `[data-back]` 也先确认（取消 = 留在编辑器）。
- 不挂教程提示：中栏空态、没有预设时、设置页没有预设时、首页改名框上都没有 `.hint` / 教程文案。
- 只按 id 校验目标卡：`#/edit/:cardId` 用 `loadCardById()` 打开 —— 盘上别的坏卡不挡；目标自己坏了照样中文 `E_VALIDATION`；保存时只替换这一张（`saveCardsLoose()`），盘上别的卡（含坏卡）原样保留。
- 存档模式 `#/edit-save/:saveId`（同一份 `EditorPage`）：编辑目标是这一份存档的 `cardSnapshot`（深拷贝）与 `save.nodeModels`，写回只替换 `tg2.saves` 那一行、`tg2.cards` 一个字节不动；**结构锁死** —— 没有 `[data-add-state]` / `[data-add-child]` / `[data-delete-state]`（不渲染，不是禁用）、没有节点增删排序、卡名不改，其余字段（名字 / 备注 / 提示词块 / 节点名字 / 节点提示词 / 历史轮数 / 眼睛 / 模型预设）照常可改；**初始值整块不渲染**（存档模式不显示也不判初始值，当前值住在 `save.tree`）。保存时校验**新的快照容得下这一份存档的当前树**（`saveTreeIssues`：每条值路径都还在、值仍合类型与上下限，**不判初始值**）；不兼容 ⇒ 不写盘、草稿保留、错误点名路径；卡模式仍按整卡（含初始值）校验。
- 存档模式打开时 `save.nodeModels` 缺省先按卡级映射显示，玩家真改了某一格才把整片写进存档（不迁移、不补写）；模型映射不属于卡草稿，所以它**即时写**（卡模式写 `tg2.nodeModels`，存档模式只换 `save.nodeModels`、快照不动）。
- 控件 / 行高：`--control-h: 28px` 用于 button / input / select / `.icon` / `.chip` / 工作流 `.node`；`--row-h: 36px` 用于 `[data-prompt-block]` / `[data-state-item]` / 首页卡行 / 存档行 / 设置页预设字段行；行内控件仍 28 且垂直居中；多行编辑器不在这一档（行动输入 44 / 节点提示词 120 / 提示词正文 160）。
- 圆角只有 `--radius: 6px`（button 与 `.chip` 共用）；读 / 写 chip 三处（状态树、细条上游、右栏提示词）共用 `.chip`：关着也有底色（`--panel-2`）与边框，开着 = 深底浅字（浅色主题 `--active-bg` #927049 / `--active-ink` #fff、字重 600，深色主题反过来用 `--accent` / `--accent-ink`）、边框 `--accent`；悬停只换边框、不铺底色；高度 `--control-h`；文字「读 / 写」保留；按钮 / chip 里不再有 999px 或 3px 档。
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
- 开关：右上角 `[data-debug-toggle]`（带 `data-on`），`?debug=1` 只是它的初始状态，点它随时开 / 关；开着 = 深底浅字（`--active-bg` / `--active-ink`）+ 字重 600、边框 `--accent`；加载旧存档后打开开关也要显示历史回合的 trace（读数来自 `save.events`，不是内存里那一回合）。
- trace 卡片：`[data-trace][data-trace-node="<id>"][data-trace-turn="<n>"]`，内含 `[data-trace-name]` / `[data-trace-type]` / `[data-trace-prompt]`；有思考时 `[data-trace-thinking]`；有工具调用时 `[data-trace-tools]`（每条 `[data-trace-tool]`，带执行结果的那条还有 `[data-trace-tool-result]`）；有正文时 `[data-trace-output]`；脚注 `[data-trace-tokens]` / `[data-trace-tps]` / `[data-trace-ms]` / `[data-trace-preset]`；**空段不画空框**。
- 合计行：`[data-turn-stats][data-turn-stats-turn="<n>"]`，内含 `[data-turn-stats-turn]` / `[data-turn-stats-tokens]` / `[data-turn-stats-ms]` / `[data-turn-stats-tps]`；没有用量 / 速率时写「没有用量 / 没有速率」，不拿 0 冒充。
- 判据：`play.spec.js` / `prompt-history.spec.js` / `stream-abort.spec.js` / `errors.spec.js` / `reasoning.spec.js` / `snapshot.spec.js` / `node-tools.spec.js`。

### 8.4 设置

- 主题选项按钮 `button[data-theme="light"]` / `button[data-theme="dark"]`（带 `aria-pressed`）：点击切换，写 `tg2.settings.theme`，刷新保留；`document.documentElement` 上也要有 `data-theme`（**所以选按钮必须带 `button`**，否则撞 `<html>`）；开着 = 深底浅字（`--active-bg` / `--active-ink`）+ 字重 600、边框 `--active-ink` 悬停压到 `--accent`，关着 = `--panel` / `--ink`；判据 `v2/e2e/settings-options.spec.js`。
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

| 验收 / 行为                                                             | 判据                                                                                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 空态 / 删空后仍可用                                                     | `v2/e2e/empty.spec.js`                                                                                                               |
| 首次打开种「晨风镇」/ 删了不复种                                        | `v2/e2e/sample.spec.js`                                                                                                              |
| 新装默认两条预设（顺序 / name=model / Key 空）                          | `v2/e2e/settings.spec.js`                                                                                                            |
| 建卡 → 编 2 元素 + 初值 + 2 提示词 → 存档 → 3 回合 → 刷新还在           | `v2/e2e/loop.spec.js`                                                                                                                |
| 眼睛控制提示词拼装                                                      | `v2/e2e/eyes.spec.js` + `v2/tests/prompt.test.js`                                                                                    |
| 改卡后旧存档仍能跑                                                      | `v2/e2e/snapshot.spec.js`                                                                                                            |
| 四类比例 + 4K 不溢出 / 手机竖屏遮罩                                     | `v2/e2e/responsive.spec.js`                                                                                                          |
| 三栏可拖 / 细条固定 / 双击恢复 / 刷新保留                               | `v2/e2e/editor-columns.spec.js`                                                                                                      |
| 编辑器面板标题 / 无教程提示 / S0–S3                                     | `v2/e2e/editor-panels.spec.js` + `v2/e2e/panel-chrome.spec.js`                                                                       |
| 控件 / 行容器两档高度                                                   | `v2/e2e/controls.spec.js`                                                                                                            |
| 读 / 写 chip 与选中态 token                                             | `v2/e2e/active-styles.spec.js` + `v2/e2e/list-styles.spec.js`                                                                        |
| 首页列表 / 改名 / 删除确认 / 三态                                       | `v2/e2e/lists.spec.js` + `v2/e2e/list-styles.spec.js`                                                                                |
| 存档编辑器（快照 / 结构锁死 / 节点改名）                                | `v2/e2e/save-editor.spec.js` + `v2/e2e/node-name.spec.js`                                                                            |
| 非法卡 / 非法存档逐项标记、按 id 只校验目标                             | `v2/tests/invalid-items.test.js` + `v2/e2e/invalid-items.spec.js` + `v2/e2e/invalid-snapshot.spec.js` + `v2/e2e/orphan-save.spec.js` |
| 旧格式卡 / 不迁移                                                       | `v2/tests/chain.test.js` + `v2/e2e/old-data.spec.js`                                                                                 |
| 流式可停止 / 错误中文 / 思考                                            | `v2/e2e/stream-abort.spec.js` + `v2/e2e/errors.spec.js` + `v2/e2e/reasoning.spec.js`                                                 |
| 调试内联：trace / turnStats 落盘、开关翻面、加载旧存档后仍能回看        | `v2/e2e/play.spec.js` + `v2/tests/engine.test.js`                                                                                    |
| 模型不进卡 / 逐节点解析 / 缺预设即报错 / 删卡不删映射                   | `v2/tests/engine.test.js` + `v2/e2e/node-models.spec.js`                                                                             |
| 错误码五条都有中文 + 下一步                                             | `v2/tests/errors.test.js`                                                                                                            |
| 夹具自身合法性（正控：夹具坏了下面每条红都不可信）                      | `v2/tests/fixtures.selfcheck.test.js`                                                                                                |
| 库址条六屏                                                              | `v2/e2e/repo-url.spec.js`                                                                                                            |
| 状态树 v5：形状 / 编号 / 深度 / 五类型 / 时间 / 扁平值 / 增删重排       | `v2/tests/state-shape.test.js` + `state-tree.test.js` + `state-time.test.js` + `state-fixtures.selfcheck.test.js`                    |
| 初始值归根：根 initial 的形状 / 派生 / 增删换类型同步 / 校验            | `v2/tests/root-initial.test.js` + `v2/e2e/root-initial.spec.js`                                                                      |
| 公历三模式：格子 / 单位 / 年份规则 / 显示 / 推进 / 换模式 / 校验        | `v2/tests/time-modes.test.js` + `v2/e2e/time-modes.spec.js`                                                                          |
| 时间推进单位只由模式决定（无颗粒度字段）                                | `v2/tests/time-units-by-mode.test.js` + `v2/e2e/advance-time-negative.spec.js`                                                       |
| 时间编辑页：类型行 = 模式、节日勾选单行 / 自定义外观                    | `v2/e2e/time-editor.spec.js`                                                                                                         |
| 根初始值子树：编号 / 名字 / 值 / 缩进 / 容器本体 `1.1` / `min~max`      | `v2/e2e/initial-subtree.spec.js`                                                                                                     |
| 现代节日（国际 / 现代中国）+ 提示词里的 `节日：` 行                     | `v2/tests/holidays.test.js`                                                                                                          |
| 中国传统节日（1900–2100 有界表 / 闰月不算 / 表外静默）                  | `v2/tests/traditional-holidays.test.js`                                                                                              |
| 节日进提示词（勾选 ⇒ 一行；天数模式没有节日）                           | `v2/e2e/holidays.spec.js`                                                                                                            |
| 状态段的提示词投影（父 JSON / 叶子 / 时间 / 不输出形状表）              | `v2/tests/prompt-state.test.js`                                                                                                      |
| 节点重试次数：校验 / 原子尝试 / 错误块 / trace.attempts / 编辑器落盘    | `v2/tests/retry.test.js` + `v2/tests/retry-schema.test.js` + `v2/e2e/node-retry.spec.js`                                             |
| 晨风镇 v5 资产 + 初始值展开                                             | `v2/tests/sample-card-v5.test.js`                                                                                                    |
| 编辑器状态树（`.0` 不出行 / 三态 / 第 5 层 / 加孩子 / 保存与 5 类拦截） | `v2/e2e/state-tree.spec.js`                                                                                                          |
| 组件故事 / 像素基线（另两层，不属本文行为判据）                         | `npm run v2:stories` / `npm run v2:visual`                                                                                           |

### 9.5 历史决定

- 历史决定见 `.team/dev/2026-11-26/CONTRACT-9.5-决定存档.md`（仅存档，不构成本文规则）。

### 9.6 本契约不覆盖

- 组件故事 / 像素基线（`v2:stories` / `v2:visual` 是另外两层）· 导入导出 · 节点增删排序 · **字典 / 键字段 / 引用类型 / 隐藏稳定 id / item 排序拖动 / 每项不同字段**（数组本身已做：容器值住节点 code、整表替换、编辑器增删 item 与字段）· 存档编辑器的结构修改 · 重生成 / 撤销 · 连接测试 · token 费用 · 多语言 · 自定义主题色 · 显示面板。
- 线上 `/v2/` 可打开、旧站根路径仍可用：人工 + 发布流程，不属本文行为判据。
