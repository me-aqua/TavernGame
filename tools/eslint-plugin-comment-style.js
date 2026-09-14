/**
 * 自定义 ESLint 规则：注释规范。
 *
 * 定位与 eslint.config.js 一致 —— 只报「错了就是错了」的事：
 *   1. 函数必须有简短的中文说明（\/** *\/ 块，紧贴函数上方）
 *   2. 注释里不许写「原来的实现 / 曾经 / 旧版」这类历史对比
 *
 * 为什么用 lint 而不是钩子里的独立脚本：注释要跟着代码走，
 * lint 能在编辑器里实时提示，也能用 --fix 之外的既有流程跑。
 *
 * ⚠️ 行内函数（回调）不要求注释：它们由上下文说明，逐个加注释只会变噪音。
 */
const RULE_NAME = 'comment-style'

/** 历史对比式的说法：对新读者没有信息量，只对写的人有意义 */
const HISTORY = /原来的实现|原来的写法|旧版是|旧写法|老版本|曾经|以前是|此前是|从前的|上一版是|相比原来/

/** 是否是 \/** *\/ 块注释 */
const isBlockComment = (comment) => comment.type === 'Block' && comment.value.startsWith('*')

/** 这个对象字面量是否是 Object.defineProperty(obj, key, {...}) 的第三个参数 */
function isDefinePropertyDescriptor(node) {
  const call = node.parent
  if (call?.type !== 'CallExpression') return false
  if (call.arguments[2] !== node) return false
  const callee = call.callee
  return (
    callee?.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'Object' &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === 'defineProperty'
  )
}

/**
 * 找紧贴在节点上方、中间没有空行的注释。
 *
 * ⚠️ 三个容易搞错的地方：
 *   1. 注释必须**另起一行**（gap 为 1），不能与代码同行
 *   2. 注释可能挂在父节点上：export function 的注释属于
 *      ExportNamedDeclaration，只看函数本身会误报「没有注释」
 *   3. 但父节点回退**只能用于 export**。若对任意函数都回退，
 *      上一个函数头上的注释会顺带「喂饱」下一个函数（实测漏报过）。
 */
function commentAbove(sourceCode, node, parent) {
  for (const target of parent ? [node, parent] : [node]) {
    const comments = sourceCode.getCommentsBefore(target)
    if (!comments.length) continue
    const comment = comments[comments.length - 1]
    const gap = target.loc.start.line - comment.loc.end.line
    if (gap < 1 || gap > 1) continue
    if (target !== node) {
      const siblings = target.parent?.body
      const list = Array.isArray(siblings) ? siblings : (target.parent?.properties ?? [])
      const index = list.indexOf(target)
      const previous = index > 0 ? list[index - 1] : null
      if (previous && comment.range[0] < previous.range[1]) continue
    }
    return comment
  }
  return null
}

export default {
  meta: { name: 'tavern-comment-style', version: '1.0.0' },
  rules: {
    [RULE_NAME]: {
      meta: {
        type: 'problem',
        docs: { description: '函数要有简短中文注释；注释不写历史对比' },
        messages: {
          missing: '函数缺少说明注释：在上一行写一行中文，说清它做什么',
          history: '注释里的历史对比删掉（「{{word}}」这类说法对新读者没有信息量，只描述现在的做法）',
          scriptTag: '文件头注释要放进 <script setup> 里面（标签外面像排版噪音，读的人容易以为是 HTML 注释）',
          stacked: '两个注释叠在一起了：合并成一个（旧的那份往往是改代码时留下的）',
        },
      },
      create(context) {
        const sourceCode = context.sourceCode ?? context.getSourceCode()

        /** 真正需要注释的函数：具名声明、具名函数常量、类方法（不含 constructor / getter / setter） */
        const reported = new Set()

        function checkFunction(node, { named, skip }) {
          if (!named || skip || reported.has(node)) return
          reported.add(node)
          // ⚠️ 传进来的可能是声明节点（VariableDeclarator / MethodDefinition），
          //    函数体本身在 .init / .value 上，判断形态前先取到它
          const fn = node.type === 'VariableDeclarator' ? node.init : (node.value ?? node)
          // 一行写完的小箭头（(i) => x）由名字与上文说明，逐个注释只是噪音
          const oneLiner =
            fn?.type === 'ArrowFunctionExpression' &&
            fn.loc.start.line === fn.loc.end.line &&
            fn.body.type !== 'BlockStatement'
          if (oneLiner) return
          // 函数体不超过 3 行的小函数一眼能看出来，不必再复述一遍名字
          // （用户 2026-09-14：仅保留一眼看不出来的逻辑；特别简单的不要乱加注释）
          const bodyLines = fn?.body?.loc ? fn.body.loc.end.line - fn.body.loc.start.line + 1 : 99
          if (bodyLines <= 3) return
          // 测试文件里的行内回调：用例标题已经说明了它在干什么
          // （tests/ = 单元与组件测试，e2e/ = Playwright 的用例）
          const inTest = context.filename.includes('/tests/') || context.filename.includes('/e2e/')
          const inlineCallback = fn?.parent?.type === 'CallExpression'
          if (inTest && inlineCallback) return
          const above = commentAbove(sourceCode, node, node.parent)
          // 块注释与单行注释都算：一行能说清就不必写四行
          const documented = above && (isBlockComment(above) || above.type === 'Line')
          if (!documented) {
            context.report({ node, messageId: 'missing' })
          }
        }

        return {
          FunctionDeclaration(node) {
            checkFunction(node, { named: Boolean(node.id) })
          },
          VariableDeclarator(node) {
            if (node.init?.type !== 'ArrowFunctionExpression' && node.init?.type !== 'FunctionExpression')
              return
            checkFunction(node, { named: node.id.type === 'Identifier' })
          },
          MethodDefinition(node) {
            // ⚠️ 传 MethodDefinition 而不是 node.value：注释挂在方法定义上，
            //    而 getCommentsBefore(FunctionExpression) 返回空 —— 传错会变成
            //    「有注释也报缺少注释」（实测踩过一整轮）。
            checkFunction(node, { named: node.kind === 'method' })
          },
          Property(node) {
            if (node.value?.type !== 'FunctionExpression' && node.value?.type !== 'ArrowFunctionExpression')
              return
            // 仅具名键：`return { cycle: () => {} }` 这类由上下文说明，逐个注释只是噪音
            checkFunction(node, { named: node.key.type === 'Identifier' })
          },
          // 访问器描述符不是「函数」，两种写法都要跳过：
          //   Object.defineProperty(window, 'x', { get() {} })
          //   Object.defineProperty(window, 'x', { get: () => {} })
          //
          // ⚠️ 判断必须锚定到 Object.defineProperty 这个**具体调用**。
          // 早先只看「父节点是 CallExpression」，于是 class 体（它也是某个
          // 调用的参数）里的方法被整批标记成「已报告」—— 漏报且报错行号乱跳。
          ObjectExpression(node) {
            if (!isDefinePropertyDescriptor(node)) return
            for (const prop of node.properties) {
              if (prop.type !== 'Property') continue
              reported.add(prop)
              const value = prop.value
              if (value?.type === 'FunctionExpression' || value?.type === 'ArrowFunctionExpression') {
                reported.add(value)
              }
            }
          },
          // 文件头注释的位置：.vue 必须写在 <script setup> 里面
          Program() {
            const first = sourceCode.getAllComments()[0]
            const isVue = context.filename.endsWith('.vue')
            // 按**文件行**判断：<script setup> 在第 1 行，注释在第 2 行就是对的。
            // ⚠️ 不能用 node.loc.start.line（Vue 的 Program 从 script 内容才开始，
            //    在 .vue 里是第 8 行左右），拿它当基准会把正确写法也报出来。
            if (isVue && first && !isBlockComment(first) && first.loc.start.line <= 3) {
              context.report({ loc: first.loc, messageId: 'scriptTag' })
            }
          },

          // 连续注释块：allowed 与上一个注释之间没有代码 —— 多半是改代码时留下的旧注释
          'Program:exit'() {
            const all = sourceCode.getAllComments()
            for (let i = 1; i < all.length; i += 1) {
              const prev = all[i - 1]
              const cur = all[i]

              // 判据：**两条块注释直接相邻**（中间只有空白）。
              // 来源几乎只有一种：把单行注释改写成文档注释时旧的那条忘了删，
              // 或者注释对应的声明被移走了（孤儿注释）。
              //
              // 不报的正常写法：JSDoc 后紧跟给声明的注释、// 分组标题 + 块注释、
              // // 注释的续行（值以空格开头，不是新注释）。
              if (!isBlockComment(prev) || !isBlockComment(cur)) continue
              // 文件头注释的后面跟「声明注释」是正常写法（头部说明文件，紧跟的那条说明声明）
              if (prev === all[0]) continue
              // 上一行是 JSDoc 的收尾，说明两条注释其实同属一条
              if (sourceCode.text.slice(prev.range[1]).trimStart().startsWith('*/')) continue
              const between = sourceCode.text.slice(prev.range[1], cur.range[0])
              if (!/^\s*$/.test(between)) continue
              context.report({ loc: cur.loc, messageId: 'stacked' })
            }

            // 历史对比：扫所有注释，不只函数上方
            for (const comment of all) {
              const m = comment.value.match(HISTORY)
              if (!m) continue
              context.report({
                loc: comment.loc,
                messageId: 'history',
                data: { word: m[0] },
              })
            }
          },
        }
      },
    },
  },
}
