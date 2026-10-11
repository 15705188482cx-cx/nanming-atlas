import type { Category, RegimeId } from '@/lib/types';

export interface AtlasState {
  /** 播放头(小数年) */
  year: number;
  playing: boolean;
  /** 每秒推进的年数 */
  speed: number;
  selectedId: string | null;
  /** 可见窗口(±年);0 = 全部 */
  windowYears: number;
  regimeFilter: Partial<Record<RegimeId, boolean>>;
  categoryFilter: Partial<Record<Category, boolean>>;
  /** 疆界快照层开关 */
  showBoundaries: boolean;
  /** 行军路线层开关 */
  showRoutes: boolean;
  /** 单条行军路线可见性(campaign id → false 隐藏) */
  routeFilter: Record<string, boolean>;
  /** 人物图谱面板开关 */
  graphOpen: boolean;
  /** 图谱聚焦人物(名字) */
  focusPerson: string | null;
  /** 三维地球视图(M5;false = 2D MapLibre) */
  view3d: boolean;
  /** 本地 CHGIS 政区层是否加载成功(供图例显示许可声明) */
  chgisLoaded: boolean;
  setYear: (y: number) => void;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;
  select: (id: string | null) => void;
  setWindow: (w: number) => void;
  toggleRegime: (r: RegimeId) => void;
  toggleCategory: (c: Category) => void;
  toggleBoundaries: () => void;
  toggleRoutes: () => void;
  toggleRoute: (id: string) => void;
  toggleGraph: () => void;
  /** 打开图谱并聚焦(传 null 仅打开) */
  openGraph: (person: string | null) => void;
  toggleView3d: () => void;
  setChgisLoaded: (v: boolean) => void;
}
