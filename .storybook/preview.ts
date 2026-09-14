import { setup } from '@storybook/vue3'
import { withThemeByClassName } from '@storybook/addon-themes'
import { i18n, type Locale } from '../src/i18n'
import '../src/styles/main.css'

/**
 * 所有故事共享的环境：i18n、Tailwind、深浅色、语言切换。
 *
 * ⚠️ 深浅色用的是应用的同一套机制（<html> 上的 .dark 类），
 *    所以 Storybook 里看到的颜色就是产品里的颜色 —— 不是第二套主题。
 */
setup((app) => {
  app.use(i18n)
})

/** 工具栏上的语言开关：应用的语言是 i18n 实例上的一个 ref */
export const globalTypes = {
  locale: {
    description: '界面语言（模型语言也跟着它）',
    toolbar: { icon: 'globe', items: ['zh-CN', 'en'], dynamicTitle: true },
  },
}

/** 把工具栏选的写入 i18n；顺带更新 <html lang>（和 main.ts 一样） */
function withLocale(story: unknown, context: { globals: { locale?: string } }) {
  const locale = (context.globals.locale ?? 'zh-CN') as Locale
  ;(i18n.global.locale as unknown as { value: Locale }).value = locale
  document.documentElement.lang = locale
  return { components: { story }, template: '<story />' }
}

export const decorators = [
  withLocale,
  withThemeByClassName({ themes: { light: '', dark: 'dark' }, defaultTheme: 'light' }),
]

export const parameters = {
  controls: { expanded: true },
  layout: 'fullscreen',
}
