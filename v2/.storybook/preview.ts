import type { Preview } from '@storybook/vue3'
import '../src/styles/main.css'
import { setTheme } from '../src/theme'

/**
 * 所有 v2 故事共享的环境：真实样式表 + 浅/深两档主题。
 *
 * 主题走**产品自己的那一条路**（`setTheme` 改 `<html data-theme>`），
 * 所以故事里看到的颜色就是玩家看到的颜色 —— 不是第二套主题。
 */
const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: { expanded: true },
  },
  initialGlobals: { theme: 'light' },
  globalTypes: {
    theme: {
      description: 'light / dark',
      toolbar: { icon: 'circlehollow', items: ['light', 'dark'], dynamicTitle: true },
    },
  },
  decorators: [
    (story, context) => {
      setTheme(context.globals.theme === 'dark' ? 'dark' : 'light')
      return { components: { story }, template: '<story />' }
    },
  ],
}

export default preview
