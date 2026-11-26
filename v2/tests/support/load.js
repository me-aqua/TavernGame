/**
 * 按契约路径加载被测模块。
 *
 * 为什么不是普通 import：**功能还没写的时候，这些测试必须是红的**（第 2 关的验收口径），
 * 而顶层的静态 import 会在收集阶段就把整个文件打死 —— 一条用例都数不出来，红得看不出形状。
 * 这里把 import 放进用例体里：每个用例各自红一条，失败信息直接点名缺哪个文件、对应契约哪一节。
 *
 * ⚠️ 加载器**不许吞错**：只有「模块不存在」这条被翻译成人话，其余错误原样抛。
 */

/** 模块路径 → 契约里的位置（失败信息要能直接指过去） */
const WHERE = {
  'core/storage.ts': 'CONTRACT §3',
  'core/errors.ts': 'CONTRACT §6',
  'core/prompt.ts': 'CONTRACT §5',
  'core/engine.ts': 'CONTRACT §4',
  'core/schema.ts': 'CONTRACT §6.1',
  'core/mock.ts': 'CONTRACT §7',
  'core/statetree.ts': '阶段 2.1 契约 v5 §1–§6（CONTRACT §2.1 尚未补）',
}

/**
 * 加载一个产品模块；`loader` 必须是**静态** `import()`（Vite 要能静态分析）。
 * 缺文件 ⇒ 抛一条指名道姓的错误，测试据此变红。
 */
export async function loadModule(name, loader) {
  try {
    return await loader()
  } catch (cause) {
    const where = WHERE[name] ?? ''
    throw new Error(
      `missing module: v2/src/${name}${where ? ` (${where})` : ''} —— 第 3 关还没实现它，这条判据按契约是红的`,
      { cause },
    )
  }
}
