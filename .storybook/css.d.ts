/**
 * CSS 侧效应导入的声明。
 *
 * preview.ts 要 import 应用的 main.css（Tailwind 的入口），
 * 而 tsconfig.node.json 里没有「*.css 是什么」的类型信息 —— 补这一行就够。
 */
declare module '*.css'
