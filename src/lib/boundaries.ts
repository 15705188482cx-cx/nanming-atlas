import rawSnaps from '../../data/regime-snapshots.json';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type { PolityId } from './types';

/** 自绘政权面快照(示意精度,见 data/raw/regime-snapshots.json 各 source 字段) */
export interface RegimeSnapshot {
  id: string;
  /** 锚定年(时间轴上该断面代表的历史时刻) */
  year: number;
  /** 生效区间,各断面无缝铺满 1580–1666(build 门禁保证) */
  yearFrom: number;
  yearTo: number;
  label: string;
  desc: string;
  source: string;
  features: {
    polity: PolityId;
    name: string;
    rings: [number, number][][];
  }[];
}

export const SNAPS = rawSnaps as unknown as RegimeSnapshot[];

/** 年份 → 生效断面(区间无缝,总有解;越界钳到两端) */
export function resolveSnapshot(year: number): RegimeSnapshot {
  const y = Math.floor(year);
  for (const s of SNAPS) {
    if (y >= s.yearFrom && y <= s.yearTo) return s;
  }
  return y < SNAPS[0].yearFrom ? SNAPS[0] : SNAPS[SNAPS.length - 1];
}

/**
 * 全部快照打包成单个 GeoJSON:面要素带 snapId,图层按 snapId 过滤——
 * 一个 source 驱动 A/B 双层 cross-fade,避免切换断面时重建 source。
 */
export function snapsToFeatureCollection(): FeatureCollection<Polygon> {
  const features: Feature<Polygon, { snapId: string; polity: string; name: string }>[] = [];
  for (const s of SNAPS) {
    for (const f of s.features) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: f.rings },
        properties: { snapId: s.id, polity: f.polity, name: f.name },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
