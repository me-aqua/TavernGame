/**
 * src/game/card-keys.ts —— 卡格式里出现的键名、量词与标点。
 *
 * 卡是 JSON，键名是中文；而源码必须 ASCII（.githooks/checks/ascii.mjs 连字符串里的
 * 中文都拦），所以这里把每个非 ASCII 字符都写成 \\u 转义，一行一个常量、配一句注释
 * 说明它在卡里是哪一个键。校验器只引用这里的常量 —— 卡格式改名时只改这一个文件。
 */

// ---------- 顶层 4 键（按「谁读」分块） ----------

/** 元信息（id / 名称 / 版本 / 适配 / 作者 / 格式 / 语言 / 简介） */
export const KEY_CARD = '\u5361'

/** 引擎读的块：图 / 状态 / 世界 / 生成器 / 开局 / 显示 */
export const KEY_DECL = '\u58f0\u660e'

/** 模型读的块：设定 / 剧本 / 节点约定 / 节点 / 开局要求 */
export const KEY_PROMPT = '\u63d0\u793a\u8bcd'

/** 人读的块：状态 / 剧本 / 开局；字段级的说明与禁止仍内联在原处 */
export const KEY_NOTES = '\u8bf4\u660e'

// ---------- 声明 ----------

/** 执行图：拓扑（顺序的唯一声明）+ 节点（名 / 职责 / 输出） */
export const KEY_GRAPH = '\u56fe'

/** 节点 id 的执行顺序 —— 顺序只在拓扑里说一次 */
export const KEY_TOPOLOGY = '\u62d3\u6251'

/** 图里的节点：键是 id；提示词.节点 用同一个键名 */
export const KEY_NODES = '\u8282\u70b9'

/** 角色与世界状态的 schema */
export const KEY_STATE = '\u72b6\u6001'

/** 历法、区域、点名的 NPC */
export const KEY_WORLD = '\u4e16\u754c'

/** 按需生成内容的原则 */
export const KEY_GENERATORS = '\u751f\u6210\u5668'

/** 起始时刻、初始位置、可让玩家起名、默认名 */
export const KEY_OPENING = '\u5f00\u5c40'

/** 界面怎么摆 */
export const KEY_DISPLAY = '\u663e\u793a'

// ---------- 提示词 ----------

/** 五个设定块 —— 每个节点都读得到 */
export const KEY_SETTING = '\u8bbe\u5b9a'

/** AI 知道、玩家不知道的真相 */
export const KEY_SCRIPT = '\u5267\u672c'

/** 每个节点拿到的上下文怎么拼 */
export const KEY_CONVENTION = '\u8282\u70b9\u7ea6\u5b9a'

/** 第一轮该怎么开场 —— 写要求，不写正文 */
export const KEY_OPENING_REQUIREMENTS = '\u5f00\u5c40\u8981\u6c42'

// ---------- 卡的元信息 ----------

/** 卡 ID（作者名.卡名）；图里的节点 id 是「声明.图.节点」的键，不在节点里面 */
export const KEY_ID = 'id'

/** 卡名（给人看的） */
export const KEY_NAME = '\u540d\u79f0'

/** 卡自己的版本（semver） */
export const KEY_VERSION = '\u7248\u672c'

/** 适配的引擎版本 */
export const KEY_COMPAT = '\u9002\u914d'

/** 作者名 —— 必须与卡 ID 的点号前缀一致 */
export const KEY_AUTHOR = '\u4f5c\u8005'

/** 卡格式版本；不认识的格式直接拒 */
export const KEY_FORMAT = '\u683c\u5f0f'

/** 卡的语言 */
export const KEY_LANGUAGE = '\u8bed\u8a00'

// ---------- 五个设定块（顺序固定） ----------

/** 第 1 块：地理 / 政治 / 经济这类世界事实 */
export const BLOCK_WORLD = '\u4e16\u754c\u8bbe\u5b9a'

/** 第 2 块：魔法 / 治疗 / 种族这类硬设定 */
export const BLOCK_CORE = '\u6838\u5fc3\u8981\u7d20'

/** 第 3 块：给模型的词汇表 */
export const BLOCK_COMMON = '\u5e38\u89c1\u7269'

/** 第 4 块：这张卡该怎么写 */
export const BLOCK_NARRATIVE = '\u53d9\u4e8b\u98ce\u683c'

/** 第 5 块：主控是什么样的人 */
export const BLOCK_PLAYER = '\u4e3b\u63a7\u8bbe\u5b9a'

// ---------- 图里的节点 ----------

/** 显示名（提示词里也用它称呼节点） */
export const KEY_NODE_NAME = '\u540d'

/** 一句话说清这个节点干什么 */
export const KEY_DUTY = '\u804c\u8d23'

/** 这个节点输出哪些字段 */
export const KEY_OUTPUT = '\u8f93\u51fa'

/** 序号 —— 顺序只由拓扑声明，节点里不许再有它（节点只有名 / 职责 / 输出三个键） */
export const KEY_ORDER = '\u5e8f\u53f7'

// ---------- 开局与位置 ----------

/** 起始时刻（开局就要用；卡里写成 YYYY-MM-DDTHH:mm） */
export const KEY_START_TIME = '\u8d77\u59cb\u65f6\u523b'

/** {区域, 地点, 场景} */
export const KEY_START = '\u521d\u59cb\u4f4d\u7f6e'

/** 演算边界（也是「声明.世界」用的键） */
export const KEY_AREA = '\u533a\u57df'

/** 存在性判断的单位 */
export const KEY_PLACE = '\u5730\u70b9'

/** 叙事舞台 */
export const KEY_SCENE = '\u573a\u666f'

/** 可让玩家起名 —— 这一阶段只声明，还没有消费者 */
export const KEY_CAN_NAME = '\u53ef\u8ba9\u73a9\u5bb6\u8d77\u540d'

/** 默认名 —— 卡没给（空串）时由界面按当前语言兜底 */
export const KEY_DEFAULT_NAME = '\u9ed8\u8ba4\u540d'

// ---------- 状态 schema ----------

/** 角色条目：固有 / 关系 / 携带 / 当下 */
export const KEY_ROLE = '\u89d2\u8272'

/** 第一段：跨场景不变的属性 */
export const KEY_INHERENT = '\u56fa\u6709'

/** 第二段：跟谁是什么关系 */
export const KEY_RELATION = '\u5173\u7cfb'

/** 第三段：身上的东西 */
export const KEY_CARRY = '\u643a\u5e26'

/** 第四段：镜头层（镜头一走就丢） */
export const KEY_NOW = '\u5f53\u4e0b'

/** 主要 / 次要 */
export const KEY_TIER = '\u5c42\u7ea7'

/** 枚举字段允许的取值 */
export const KEY_VALUES = '\u53d6\u503c'

/** 字段的类型标记 */
export const KEY_TYPE = '\u7c7b\u578b'

/** 字段的初始值 */
export const KEY_INITIAL = '\u521d\u503c'

/** 数值字段的取值区间 */
export const KEY_RANGE = '\u8303\u56f4'

/** 坐在电脑前的人：画像 + 画像初值，只给精神分析读 */
export const KEY_PLAYER = '\u73a9\u5bb6'

/** 玩家画像 —— 卡给的初值加上 AI 的补充 */
export const KEY_PROFILE = '\u753b\u50cf'

/** 作者对玩家的初始假设，一行一条 */
export const KEY_PROFILE_INITIAL = '\u753b\u50cf\u521d\u503c'

/** 这一块怎么读 —— 校验一致性时读的就是它 */
export const KEY_NOTE = '\u8bf4\u660e'

// ---------- 世界 / 剧本 / 显示 / 生成器 ----------

/** 引擎的日期算法照它选 */
export const KEY_CALENDAR = '\u5386\u6cd5'

/** 剧本阶段；阶段条目的「阶段」字段也是它 */
export const KEY_STAGES = '\u9636\u6bb5'

/** 侧栏区块 */
export const KEY_SIDEBAR = '\u4fa7\u680f'

/** 区块名（也用来读「五块」这类声明） */
export const KEY_BLOCK = '\u5757'

/** 生成器的一条原则 */
export const KEY_PRINCIPLE = '\u539f\u5219'

/** 作者点名的地点 —— 生成器的数字要跟它对上 */
export const KEY_PLACES = '\u5fc5\u6709\u5730\u70b9'

// ---------- 汉字数字与标点 ----------

/** 汉字数字 1 */
export const CN_ONE = '\u4e00'

/** 汉字数字 2（「两个」的写法） */
export const CN_TWO = '\u4e24'

/** 汉字数字 2 的另一种写法「二」—— 「十二」「二十」用它（「两」是口语写法） */
export const CN_TWO_PLAIN = '\u4e8c'

/** 汉字数字 3 */
export const CN_THREE = '\u4e09'

/** 汉字数字 4 */
export const CN_FOUR = '\u56db'

/** 汉字数字 5 */
export const CN_FIVE = '\u4e94'

/** 汉字数字 6 */
export const CN_SIX = '\u516d'

/** 汉字数字 7 */
export const CN_SEVEN = '\u4e03'

/** 汉字数字 8 */
export const CN_EIGHT = '\u516b'

/** 汉字数字 9 */
export const CN_NINE = '\u4e5d'

/** 汉字数字 10（「十二」「二十」也用它） */
export const CN_TEN = '\u5341'

/** 「四段」这类声明的量词 */
export const WORD_STAGE = '\u6bb5'

/** 全角冒号 —— 切出说明里列举的部分 */
export const PUNCT_COLON = '\uff1a'

/** 全角句号 —— 列举到哪里结束 */
export const PUNCT_PERIOD = '\u3002'

// ---------- 表 ----------

/** 五个设定块的固定顺序 —— 「提示词.设定」的键必须按它排 */
export const SETTING_BLOCKS = [BLOCK_WORLD, BLOCK_CORE, BLOCK_COMMON, BLOCK_NARRATIVE, BLOCK_PLAYER]

/** 顶层 4 键（都是对象）—— 多一个少一个都拒 */
export const TOP_LEVEL_KEYS: readonly string[] = [KEY_CARD, KEY_DECL, KEY_PROMPT, KEY_NOTES]
