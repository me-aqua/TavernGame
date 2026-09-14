// 提交信息规范：约定式前缀。
// 这不是洁癖 —— CHANGELOG 与语义化版本号都依赖它（见 doc/CHANGELOG.md）。
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 标题用中文，英文的 subject-case 规则不适用
    'subject-case': [0],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0], // 中文描述的行长无意义
    'footer-max-line-length': [0],
  },
}
