import type { AtlasEvent } from './types';

/** 时间轴与播放的固定区间 */
export const Y0 = 1580;
export const Y1 = 1666;
export const Y_MAX = 1666;

export function clampYear(y: number): number {
  return Math.min(Y_MAX, Math.max(Y0, y));
}

/** ISO 片段 → 十进制年(用于时间轴定位) */
export function decimalYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return y + ((m ?? 1) - 1) / 12 + ((d ?? 1) - 1) / 365;
}

/** 置信度前缀:approx 标“约” */
export function fmtDate(ev: AtlasEvent): string {
  const [y, m, d] = ev.date.split('-');
  const base =
    ev.datePrecision === 'year'
      ? `${y}年`
      : ev.datePrecision === 'month'
        ? `${y}年${Number(m)}月`
        : `${y}年${Number(m)}月${Number(d)}日`;
  return (ev.confidence === 'approx' ? '约 ' : '') + base;
}

/** 年份 → 年号纪年(叙事粗标注,不处理同朝并立) */
export function reignLabel(y: number): string {
  const yy = Math.floor(y);
  if (yy <= 1620) return `万历 ${yy - 1572}`;
  if (yy <= 1627) return `天启 ${yy - 1620}`;
  if (yy <= 1644) return `崇祯 ${yy - 1627}`;
  if (yy === 1645) return '弘光元年';
  if (yy === 1646) return '隆武二年';
  if (yy <= 1661) return `永历 ${yy - 1646}`;
  return `康熙 ${yy - 1661}`;
}

/** 事件相对当前游标的“时距”(有跨度的取区间),用于明暗 */
export function eventDistance(ev: AtlasEvent, year: number): number {
  if (ev.year > year) return ev.year - year;
  if (year > ev.endYear) return year - ev.endYear;
  return 0;
}
