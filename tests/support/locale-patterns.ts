/**
 * 断言用的 locale 派生模式。
 *
 * 为什么集中在这里：这些字符串来自 locale 表，散在各测试文件里会出现
 * 「同一个正则抄三份」—— 改文案要改三处，而漏改一处就变成永远通过的空断言。
 *
 * ⚠️ 它们都依赖 tests/setup.ts 把 locale 钉在 zh-CN。
 *    断言产品文案时优先走 t('key')；这里只放**拼起来是模式**的那些
 *    （正则、前缀、段落名列表）。
 */

import { t } from '../../src/i18n'

/** 一天三段的名字（按顺序） */
export const SEGMENT_NAMES = [
  t('calendar.segment.morning'),
  t('calendar.segment.afternoon'),
  t('calendar.segment.evening'),
]

/**
 * 简短时间标签的形状（「9 月 14 日 · 下午」）。
 *
 * ⚠️ 从 locale 表**派生**，不写死中文：这个模块里的模式要么跟随语言，
 *    要么就得解释清为什么不跟随。写死的后果是切到 en 时它静默失效 ——
 *    测试会红，但原因看着像「正则不匹配」而不是「语言变了」。
 */
export const SHORT_TIME_LABEL = new RegExp(
  '^' +
    t('calendar.monthDay', { month: '\\d+', day: '\\d+' }) +
    t('calendar.dateSeparator') +
    '(' +
    SEGMENT_NAMES.join('|') +
    ')$',
)

/** 时长文案的前缀（例如「过去了」） */
export const ELAPSED_PREFIX = t('calendar.elapsed', { parts: '' }).trim()

/** 推进结果里的「原因」标签前缀 */
export const REASON_LABEL = t('tools.advanceReason', { reason: '' }).trim()

/** 工具结果行的首行（不含具体时间），用来判断「这是成功推进」 */
export const ADVANCE_OK_MARKER = t('tools.advanceResult', { before: '', after: '' }).split('\n')[0].trim()
