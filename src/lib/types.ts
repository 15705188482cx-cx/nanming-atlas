export type RegimeId = 'ming' | 'qing' | 'dashun' | 'daxi' | 'nanming' | 'zheng' | 'other';
export type Category = 'military' | 'political' | 'economy' | 'culture' | 'foreign';

/** 疆界面的政体 = 事件阵营 ∪ 周边政权(蒙古/朝鲜/日本/欧洲势力) */
export type PolityId = RegimeId | 'mongol' | 'japan' | 'korea' | 'dutch' | 'spanish';

export interface AtlasEvent {
  id: string;
  title: string;
  /** ISO 片段:YYYY / YYYY-MM / YYYY-MM-DD */
  date: string;
  datePrecision: 'year' | 'month' | 'day';
  endDate?: string;
  /** 日期不确定度:exact=单一日(缺省) / range=date~endDate为不确定窗口 / multi=多说并存(dateClaims) */
  dateFormat?: 'exact' | 'range' | 'multi';
  /** multi 用:各源互斥说法全录,不做取舍;date 字段为主采(有文献依据)或最早候选 */
  dateClaims?: { date: string; basis: string; source?: string }[];
  /** 构建脚本补充:起止年份(数值) */
  year: number;
  endYear: number;
  lon: number;
  lat: number;
  location: string;
  modernLocation?: string;
  /** 主导方(着色用);sides 为参与各方 */
  regime: RegimeId;
  sides: RegimeId[];
  category: Category;
  type: string;
  importance: 1 | 2 | 3;
  summary: string;
  result?: string;
  people: string[];
  sources: string[];
  /** high/medium:日期置信度;approx:日期为约略 */
  confidence: 'high' | 'medium' | 'approx';
  coordNote?: string;
}

export interface AtlasPerson {
  id: string;
  name: string;
  title?: string;
  life: string;
  faction: RegimeId;
  summary: string;
}

export const REGIMES: Record<RegimeId, { label: string; color: string }> = {
  ming: { label: '明', color: '#6a9fdc' },
  qing: { label: '后金 / 清', color: '#e05d4f' },
  dashun: { label: '大顺', color: '#e8a54b' },
  daxi: { label: '大西', color: '#a78bce' },
  nanming: { label: '南明', color: '#f2c94c' },
  zheng: { label: '郑氏', color: '#52b788' },
  other: { label: '其他', color: '#94a3b8' },
};

/** 疆界快照用政体配色(含周边政权;事件层只用到 RegimeId 子集) */
export const POLITIES: Record<PolityId, { label: string; color: string }> = {
  ...REGIMES,
  mongol: { label: '蒙古诸部', color: '#b08968' },
  japan: { label: '日本', color: '#d96c8f' },
  korea: { label: '朝鲜', color: '#74b3a4' },
  dutch: { label: '荷兰东印度公司', color: '#8fd3f4' },
  spanish: { label: '西班牙(马尼拉)', color: '#c9a7eb' },
};

export const CATEGORIES: Record<Category, string> = {
  military: '军事',
  political: '政治',
  economy: '经济',
  culture: '文化',
  foreign: '中外',
};
