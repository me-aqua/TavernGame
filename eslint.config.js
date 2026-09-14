// ESLint 扁平配置（flat config）。
//
// 定位：**抓真 bug**，不做风格争论（风格交给 Prettier）。
// 所以这里只开「错了就是错了」的规则，不写「我更喜欢哪种写法」的规则。
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import commentStyle from './tools/eslint-plugin-comment-style.js'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'storybook-static/**',
      'artifacts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],

  {
    // 开启类型感知 linting：no-floating-promises / no-misused-promises 这类
    // 「真 bug」规则需要类型信息才工作。用 projectService 让 TS 自己找项目配置。
    files: ['**/*.{ts,vue}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
      globals: { ...globals.browser },
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },

  {
    files: ['**/*.{ts,vue}'],
    plugins: { tavern: commentStyle },
    rules: {
      // 注释规范：函数要有简短中文说明，且不写历史对比（详见插件里的说明）
      'tavern/comment-style': 'error',

      // 真 bug 类
      '@typescript-eslint/no-floating-promises': 'error', // 忘了 await 的 Promise
      '@typescript-eslint/no-explicit-any': 'error', // 真正的 any 要出声（测试文件已放宽）
      'preserve-caught-error': 'error', // 重抛时要带上 cause，否则丢上下文
      // ⚠️ 关掉 no-irregular-whitespace：中文排版里全角空格 U+3000 是**故意的**缩进
      //    （例如叙事文本的段落首行缩进），不是脏字符。
      'no-irregular-whitespace': 'off',
      '@typescript-eslint/no-misused-promises': 'error', // 把 Promise 当同步用
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',

      // Vue：这些会变成运行时 bug
      'vue/multi-word-component-names': 'off', // 组件名是中文/单词，没必要强制多词
      'vue/no-mutating-props': 'error',
      'vue/require-default-prop': 'off',
      'vue/attributes-order': 'off', // 风格问题，交给 Prettier
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
    },
  },

  {
    // 测试与脚本允许更松：要打印、要 any
    files: ['tests/**/*.ts', 'e2e/**/*.{ts,mjs}', '*.config.ts', '*.config.js'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    // Node 侧脚本需要 node 全局变量
    files: ['e2e/**/*.mjs', '.githooks/**/*', 'scripts/**/*.mjs', 'tools/**/*.{js,mjs}', '*.config.js'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        WebSocket: 'readonly',
        setTimeout: 'readonly',
      },
    },
    rules: {
      // 自定义检查脚本里的正则本来就常有转义，不必苛求
      'no-useless-escape': 'off',
    },
  },
)
