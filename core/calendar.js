/**
 * core/calendar.js —— 历法
 *
 * ## 当前只有一种：现实日历
 *
 * 游戏从**玩家开始玩的那一刻**的真实时间开始，之后按真实公历走。
 *
 * 一开始还写了个「奇幻历法（12 月 × 30 天）」的预设，
 * 但那是为了「以后可能要用」而提前造的轮子 —— 没人会用，
 * 还多一份要维护的东西。**已经删掉。**
 * 以后真要做「自定义历法」，那时再加，不用现在预留。
 *
 * ## 为什么日期运算交给 Date
 *
 * 全部用 JavaScript 的 `Date` 做加减，不手写除法。
 * 手写估算会在这两个地方翻车：
 *   - 「1 月 31 日 + 1 个月」—— 2 月没有 31 日
 *   - 「闰年 2 月 28 日 + 1 天」—— 到底是不是 2 月 29 日
 * Date 全部自动处理，永远精确。
 *
 * ## 内部统一用 ISO 时刻
 *
 * 状态里存的是一个绝对时刻（ISO 字符串），显示成什么样由这里决定。
 * 这样以后真要换历法，同一时刻能直接换个显示方式，不用迁移存档。
 */

/** 一天的时段 */
export const SEGMENTS = ['上午', '下午', '晚上'];
export const SEGMENTS_PER_DAY = SEGMENTS.length;

/** 把小时数映射到时段索引 */
export function hourToSegment(hour) {
  if (hour < 12) return 0;    // 上午
  if (hour < 18) return 1;    // 下午
  return 2;                   // 晚上
}

const WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 日历预设：现实公历。
 *
 * 接口约定（以后要加别的历法，实现这几个方法即可）：
 *   id / label / description
 *   format(iso)          完整日期文字
 *   formatShort(iso)     简短日期文字
 *   advance(iso, n, unit) 推进时间 → { iso, elapsedMs }
 *   describeElapsed(ms)  「过去了多久」
 *   prompt()             给模型看的历法说明
 */
export const realCalendar = {
  id: 'real',
  label: '现实日历',
  description: '按真实世界的公历走，从你开始玩的那一刻算起。',

  /** 「2026 年 9 月 10 日 · 星期四 · 晚上」 */
  format(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 · ` +
      `${WEEKDAY_CN[d.getDay()]} · ${SEGMENTS[hourToSegment(d.getHours())]}`;
  },

  /** 「9 月 10 日 · 晚上」 */
  formatShort(iso) {
    const d = new Date(iso);
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${SEGMENTS[hourToSegment(d.getHours())]}`;
  },

  /**
   * 推进时间。
   * @param {string} iso 当前时刻
   * @param {number} step 数量（正整数）
   * @param {string} unit 'segment' | 'hour' | 'day' | 'week' | 'month' | 'year'
   * @returns {{ iso: string, elapsedMs: number }}
   */
  advance(iso, step, unit = 'segment') {
    const d = new Date(iso);
    const before = d.getTime();

    switch (unit) {
      case 'segment':
        // 一个时段 ≈ 4 小时。不是精确的「上午→下午」，但足够表达叙事节奏。
        d.setHours(d.getHours() + step * 4);
        break;
      case 'hour':  d.setHours(d.getHours() + step); break;
      case 'day':   d.setDate(d.getDate() + step); break;
      case 'week':  d.setDate(d.getDate() + step * 7); break;
      case 'month': d.setMonth(d.getMonth() + step); break;
      case 'year':  d.setFullYear(d.getFullYear() + step); break;
      default:
        throw new Error(`不认识的时间单位「${unit}」`);
    }

    return { iso: d.toISOString(), elapsedMs: d.getTime() - before };
  },

  /**
   * 把毫秒差说成人话。
   * 用真实的日历长度换算（一年 365 天、一月 30 天取近似），不手写累计。
   */
  describeElapsed(ms) {
    if (ms <= 0) return '';
    const totalMinutes = Math.round(ms / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);

    if (days === 0) {
      if (hours > 0) return `过去了 ${hours} 小时`;
      return totalMinutes > 0 ? `过去了 ${totalMinutes} 分钟` : '';
    }

    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    const remDays = days % 30;

    const parts = [];
    if (years) parts.push(`${years} 年`);
    if (months) parts.push(`${months} 个月`);
    if (remDays && !years) parts.push(`${remDays} 天`);
    return `过去了 ${parts.join('')}`;
  },

  /** 给模型看的历法说明 */
  prompt() {
    return [
      '## 时间设定',
      '',
      '- 这个世界使用**现实世界的公历**（12 个月，每月 28–31 天，有闰年）',
      '- 一天分三段：上午 / 下午 / 晚上',
      '- 需要提到日期、星期、季节时，**以状态里的时间为准**，不要自己编造',
      '',
    ].join('\n');
  },
};

/**
 * 全部可用历法。
 * 目前只有现实历 —— 加新历法时往这里加一项，引擎其余部分不用动。
 */
export const CALENDARS = {
  [realCalendar.id]: realCalendar,
};

/** 默认历法 */
export const DEFAULT_CALENDAR_ID = realCalendar.id;

/**
 * 按 id 取历法。找不到就回退到默认。
 */
export function getCalendar(id) {
  if (!id) return CALENDARS[DEFAULT_CALENDAR_ID];
  const found = CALENDARS[id];
  if (!found) {
    console.warn(`未知历法「${id}」，已回退到「${DEFAULT_CALENDAR_ID}」`);
    return CALENDARS[DEFAULT_CALENDAR_ID];
  }
  return found;
}

/** 列出全部历法（以后做「选历法」的界面时用得上） */
export function listCalendars() {
  return Object.values(CALENDARS).map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description || '',
  }));
}

/**
 * 当前时刻的 ISO 字符串。
 * 新游戏的起点就是**调用它的那一刻** —— 也就是玩家点「开始」的时候。
 */
export function nowIso() {
  return new Date().toISOString();
}
