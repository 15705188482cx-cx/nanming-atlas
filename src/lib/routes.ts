import rawRoutes from '../../data/campaign-routes.json';
import type { LineString, Point, Position } from 'geojson';
import type { RegimeId } from './types';

export interface RoutePoint {
  lon: number;
  lat: number;
  /** "YYYY" | "YYYY-MM" | "YYYY-MM-DD";农历节点允许月份精度 */
  date: string;
  note?: string;
}

export interface RoutePath {
  name: string;
  regime: RegimeId;
  points: RoutePoint[];
}

export interface CampaignRoute {
  id: string;
  name: string;
  year: number;
  regime: RegimeId;
  summary: string;
  source: string;
  paths: RoutePath[];
}

export const CAMPAIGNS = rawRoutes as unknown as CampaignRoute[];
export const CAMPAIGN_BY_ID = new Map(CAMPAIGNS.map((c) => [c.id, c]));

/** "YYYY"|"YYYY-MM"|"YYYY-MM-DD" → 十进制年(与 build 门禁同口径) */
export function decimalDate(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  const mi = m || 6;
  const di = d || 15;
  return y + (mi - 1) / 12 + (di - 1) / 365;
}

/** 航点时间戳(预解析,一次性) */
const PATH_TIMES: WeakMap<RoutePath, number[]> = new WeakMap();
export function pathTimes(p: RoutePath): number[] {
  let t = PATH_TIMES.get(p);
  if (!t) {
    t = p.points.map((pt) => decimalDate(pt.date));
    PATH_TIMES.set(p, t);
  }
  return t;
}

/**
 * 按当前播放头切出"已行进"折线(最后一段线性内插)。
 * year 早于起点 → null(未出发);晚于终点 → 全程。
 */
export function pathSliced(p: RoutePath, year: number): LineString | null {
  const t = pathTimes(p);
  if (year <= t[0]) return null;
  const pts: Position[] = [[p.points[0].lon, p.points[0].lat]];
  let head: Position | null = null;
  for (let i = 1; i < p.points.length; i++) {
    const [lon, lat] = [p.points[i].lon, p.points[i].lat];
    if (year >= t[i]) {
      pts.push([lon, lat]);
      head = [lon, lat];
    } else {
      const k = (year - t[i - 1]) / (t[i] - t[i - 1]);
      head = [
        p.points[i - 1].lon + (lon - p.points[i - 1].lon) * k,
        p.points[i - 1].lat + (lat - p.points[i - 1].lat) * k,
      ];
      pts.push(head);
      return { type: 'LineString', coordinates: pts };
    }
  }
  return { type: 'LineString', coordinates: pts };
}

/** 行军头部(当前推进到的位置);未出发/已抵达分别处理 */
export function pathHead(p: RoutePath, year: number): Point | null {
  const t = pathTimes(p);
  if (year <= t[0] || year >= t[t.length - 1]) return null;
  const sliced = pathSliced(p, year);
  if (!sliced) return null;
  const pos = sliced.coordinates[sliced.coordinates.length - 1];
  return { type: 'Point', coordinates: pos };
}
