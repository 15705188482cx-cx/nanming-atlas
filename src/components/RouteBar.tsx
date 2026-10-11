'use client';

import { REGIMES } from '@/lib/types';
import { CAMPAIGNS } from '@/lib/routes';
import { useAtlas } from '@/store';

/** 行军路线条:总开关 + 单路线开关(chips 即图例) */
export default function RouteBar() {
  const showRoutes = useAtlas((s) => s.showRoutes);
  const routeFilter = useAtlas((s) => s.routeFilter);
  const toggleRoutes = useAtlas((s) => s.toggleRoutes);
  const toggleRoute = useAtlas((s) => s.toggleRoute);

  return (
    <div className="bbar rbar" aria-label="行军路线">
      <div className="chip-row bbar-row">
        <button
          className={`chip bbar-toggle ${showRoutes ? 'on' : ''}`}
          onClick={toggleRoutes}
          title="显示/隐藏行军路线层"
        >
          行军
        </button>
        {CAMPAIGNS.map((c) => {
          const on = showRoutes && routeFilter[c.id] !== false;
          return (
            <button
              key={c.id}
              className={`chip ${on ? 'on' : ''}`}
              style={on ? { borderColor: REGIMES[c.regime].color } : undefined}
              onClick={() => toggleRoute(c.id)}
              title={`${c.summary}\n—— ${c.source}`}
            >
              <i style={{ background: REGIMES[c.regime].color }} />
              {c.name}
              <em>{c.year}</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}
