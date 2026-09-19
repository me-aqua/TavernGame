import type { Meta, StoryObj } from '@storybook/vue3-vite'

/**
 * 四盏灯并排看一眼：卡通过 display.atmosphere 选一盏，界面只提供灯。
 *
 * 这一页是给人看图的工作台，不是产品界面：每种气氛在浅色 / 深色下各拍一张，
 * 方便对比光池、气氛点与配色有没有「像同一个世界的四个地方」。
 */
const meta = {
  title: '主题/舞台气氛',
  parameters: { controls: { disable: true } },
  // 四种气氛并排的工作台：只展示光池与配色，不带任何交互
  render: () => ({
    template: `
      <div class="grid gap-3 p-4 sm:grid-cols-2">
        <section v-for="stage in stages" :key="stage.id" :data-atmosphere="stage.id"
          class="story-bg relative h-[240px] overflow-hidden rounded-lg border border-line/70 p-5">
          <p class="cover-kicker">{{ stage.kicker }}</p>
          <p class="scene-name mt-3 text-[20px]">{{ stage.title }}</p>
          <p class="prose-story mt-2 text-[13px] leading-relaxed text-muted">{{ stage.line }}</p>
          <span class="seal absolute right-4 bottom-4" aria-hidden="true">{{ stage.seal }}</span>
        </section>
      </div>
    `,
    // 画廊数据：每个气氛一句示例文字，只为看色，不是任何一张卡的内容
    setup: () => ({
      stages: [
        {
          id: 'lamplight',
          kicker: 'lamplight',
          title: '灯下 · 晨风镇',
          line: '暖黄的光从屋里涌出来，混着麦酒、木炭和湿羊毛的味道。',
          seal: '晨',
        },
        {
          id: 'void',
          kicker: 'void',
          title: '深空 · 长夜号',
          line: '舱壁外是十二万人的梦，和一条四百年没有回头的航迹。',
          seal: '夜',
        },
        {
          id: 'beacon',
          kicker: 'beacon',
          title: '雾夜 · 灯塔',
          line: '海在下面呼吸，灯在头顶转。这一班还没有人来接。',
          seal: '灯',
        },
        {
          id: 'ink',
          kicker: 'ink',
          title: '中性 · 默认',
          line: '没有指定气氛的卡，就用这盏不偏色的灯。',
          seal: '墨',
        },
      ],
    }),
  }),
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** 四种气氛的对照图；深色下再拍一组 */
export const Gallery: Story = {}
