/**
 * 整页巡检的**一次性准备**：把截图目录清空重建。
 *
 * ## 为什么必须放在 `globalSetup`、不能写在 spec 的模块顶层
 *
 * 真机理（票 69 · S3 复核后的订正 —— **不是"几个 worker 互相删"**）：
 * 配置是 `workers: 1` + `fullyParallel: false` ⇒ **本来就没有并发**。
 * 但 —— **一条用例失败 ⇒ Playwright 重启 worker ⇒ spec 模块重新加载 ⇒ 顶层那句 `rmSync` 再跑一次**。
 * 于是"重启之前已经攒下的图"被删掉，目录里只剩**最后一次重启之后**写的那一段。
 *
 * 实测对得上：那次 visual 的失败编号是 #60…#65 ⇒ 最后一次重启发生在 **#65** 之后
 * ⇒ 目录里只剩 **#66–85 = 20 张**，而它们**分属 4 个状态** —— 与观察逐项一致。
 *
 * ⇒ **规矩**（按真机理才写得对）：**这一趟里只要有用例失败，顶层清理就会再跑一次**。
 * **"`workers: 1` 就没事"是错的。**
 *
 * `globalSetup` 在**所有 worker 起之前跑且只跑一次** ⇒ 与"失败重启"彻底解耦。
 *
 * ## 它什么时候跑（配置级钩子对所有 playwright 命令都生效）
 *
 * ⚠️ `artifacts/screenshots/` 是**整页巡检自己的产物**，别的层（`npm run e2e` / `npm run stories`）
 * 不该顺手把它清掉 —— 那是**给人看的资产**（`index.html` 总览页）。
 * ⇒ 这个 setup **只在"这一趟跑的是整页巡检"时清理**（见 `isVisualRun`）。
 *
 * ## 还没解决的那一条（记 follow-up，本票不做）
 *
 * 总览页 `index.html` / `report.json` 由 `test.afterAll` 按**本进程内存里那份 shots** 写 ——
 * 只要有失败重启，它就只列**最后一个进程**那一段。这一条**不是清目录能修的**，
 * 得把汇总改成分片落盘再合并。**在那之前：visual 这一趟里出现失败 ⇒ 总览页必然不完整。**
 */
import { mkdirSync, rmSync } from 'node:fs'

/** 截图目录（与 `e2e/visual.spec.ts` 的 `OUT` 同一个路径） */
const OUT = 'artifacts/screenshots'

/**
 * 这一趟跑的是不是整页巡检（`npm run visual` ⇒ `playwright test e2e/visual.spec.ts`）。
 *
 * 依据：`process.argv` 里有 `visual.spec.ts`。⚠️ 用 `includes` 而不是精确相等 ——
 * 调用形态可能是路径、也可能是 `-g` 加的过滤词，只要这一趟**碰了那个文件**就该清。
 */
function isVisualRun(): boolean {
  return process.argv.some((arg) => arg.includes('visual.spec.ts'))
}

/** 清空并重建截图目录（只在这一趟是整页巡检时做） */
export default function globalSetup(): void {
  if (!isVisualRun()) return
  rmSync(OUT, { recursive: true, force: true })
  mkdirSync(OUT, { recursive: true })
}
