'use client';

import { EVENTS } from '@/lib/data';
import { CATEGORIES, REGIMES } from '@/lib/types';
import type { Category, RegimeId } from '@/lib/types';
import { useAtlas } from '@/store';

const REGIME_IDS = Object.keys(REGIMES) as RegimeId[];
const CATEGORY_IDS = Object.keys(CATEGORIES) as Category[];

const COUNTS = {
  regime: Object.fromEntries(
    REGIME_IDS.map((r) => [r, EVENTS.filter((e) => e.regime === r).length]),
  ) as Record<RegimeId, number>,
  category: Object.fromEntries(
    CATEGORY_IDS.map((c) => [c, EVENTS.filter((e) => e.category === c).length]),
  ) as Record<Category, number>,
};

export default function FilterBar() {
  const regimeFilter = useAtlas((s) => s.regimeFilter);
  const categoryFilter = useAtlas((s) => s.categoryFilter);
  const graphOpen = useAtlas((s) => s.graphOpen);
  const view3d = useAtlas((s) => s.view3d);
  const toggleRegime = useAtlas((s) => s.toggleRegime);
  const toggleCategory = useAtlas((s) => s.toggleCategory);
  const toggleGraph = useAtlas((s) => s.toggleGraph);
  const toggleView3d = useAtlas((s) => s.toggleView3d);

  return (
    <div className="chips" aria-label="筛选">
      <div className="chip-row">
        <button
          className={`chip bbar-toggle ${view3d ? 'on' : ''}`}
          onClick={toggleView3d}
          title="切换 2D 地图 / 地球视角"
        >
          地球
        </button>
        <button
          className={`chip bbar-toggle ${graphOpen ? 'on' : ''}`}
          onClick={toggleGraph}
          title="打开/关闭人物图谱"
        >
          人物图谱
        </button>
        {REGIME_IDS.map((r) => {
          const on = regimeFilter[r] !== false;
          return (
            <button
              key={r}
              className={`chip ${on ? 'on' : ''}`}
              style={on ? { borderColor: REGIMES[r].color, color: REGIMES[r].color } : undefined}
              onClick={() => toggleRegime(r)}
            >
              <i style={{ background: REGIMES[r].color }} />
              {REGIMES[r].label}
              <em>{COUNTS.regime[r]}</em>
            </button>
          );
        })}
      </div>
      <div className="chip-row">
        {CATEGORY_IDS.map((c) => {
          const on = categoryFilter[c] !== false;
          return (
            <button key={c} className={`chip ${on ? 'on' : ''}`} onClick={() => toggleCategory(c)}>
              {CATEGORIES[c]}
              <em>{COUNTS.category[c]}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}
