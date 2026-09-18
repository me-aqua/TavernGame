/**
 * 提交期检查脚本 `changelog.mjs` 的形状声明。
 *
 * 为什么在这里而不在 `src/env.d.ts`：`.githooks/pre-commit` 的「新增源码必须配测试」
 * 只豁免 `src/types/`（类型模块没有可测的行为）—— 放在 `env.d.ts` 会算出一个
 * 叫「env.d」的模块名，`tests/` 里提不到它，**提交当场被拦**。
 *
 * 为什么需要它：`tests/` 里 `import` 一个 `.mjs`（没开 `allowJs`、也没有声明文件）
 * 会被类型检查判成找不到模块；这些脚本是自己写的、形状由契约钉死，所以在这里声明。
 */
declare module '*/checks/changelog.mjs' {
  export function judge(input: {
    message: string
    staged: string[]
    changelogDiff: string
    mergeHead?: unknown
    branchCommits?: string[]
    branchChangelogDiff?: string
  }): { blocked: boolean; reasons: string[]; reminder: string | null }
}
