'use client';

import { useMemo } from 'react';
import { POLITIES } from '@/lib/types';
import type { PolityId } from '@/lib/types';
import { SNAPS, resolveSnapshot } from '@/lib/boundaries';
import { useAtlas } from '@/store';

/** 疆界快照条:断面切换 + 当前政权图例 + CHGIS 许可声明 */
export default function BoundaryBar() {
  const year = useAtlas((s) => s.year);
  const showBoundaries = useAtlas((s) => s.showBoundaries);
  const chgisLoaded = useAtlas((s) => s.chgisLoaded);
  const toggleBoundaries = useAtlas((s) => s.toggleBoundaries);
  const setYear = useAtlas((s) => s.setYear);

  const snap = useMemo(() => resolveSnapshot(year), [Math.floor(year)]); // eslint-disable-line react-hooks/exhaustive-deps

  const polities = useMemo(() => {
    const set = new Set<PolityId>();
    for (const f of snap.features) set.add(f.polity);
    return [...set];
  }, [snap]);

  return (
    <div className="bbar" aria-label="疆界快照">
      <div className="chip-row bbar-row">
        <button
          className={`chip bbar-toggle ${showBoundaries ? 'on' : ''}`}
          onClick={toggleBoundaries}
          title="显示/隐藏疆界层"
        >
          疆界
        </button>
        {SNAPS.map((s) => (
          <button
            key={s.id}
            className={`chip ${showBoundaries && s.id === snap.id ? 'on' : ''}`}
            onClick={() => setYear(s.year)}
            title={s.desc}
          >
            {s.label}
            <em>{s.year}</em>
          </button>
        ))}
      </div>
      {showBoundaries && (
        <div className="chip-row bbar-legend">
          {polities.map((p) => (
            <span key={p} className="blegend">
              <i style={{ background: POLITIES[p].color }} />
              {POLITIES[p].label}
            </span>
          ))}
        </div>
      )}
      {chgisLoaded && (
        <p className="bbar-cite">
          政区底图:CHGIS V6 (c) Fairbank Center, Harvard University &amp; Fudan
          University, 2016 · 仅限学术研究使用
        </p>
      )}
    </div>
  );
}
