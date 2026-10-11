'use client';

import { EVENT_BY_ID, EVENTS, PERSON_BY_NAME } from '@/lib/data';
import { fmtDate } from '@/lib/time';
import { CATEGORIES, REGIMES } from '@/lib/types';
import { useAtlas } from '@/store';

const CONF_LABEL = { high: '', medium: '', approx: '约' } as const;

export default function EventCard() {
  const selectedId = useAtlas((s) => s.selectedId);
  const select = useAtlas((s) => s.select);
  const openGraph = useAtlas((s) => s.openGraph);
  const ev = selectedId ? EVENT_BY_ID.get(selectedId) : null;
  if (!ev) return null;

  const idx = EVENTS.findIndex((e) => e.id === ev.id);
  const prev = EVENTS[(idx - 1 + EVENTS.length) % EVENTS.length];
  const next = EVENTS[(idx + 1) % EVENTS.length];
  const regime = REGIMES[ev.regime];

  return (
    <aside className="card" key={ev.id}>
      <button className="card-close" onClick={() => select(null)} aria-label="关闭">
        ✕
      </button>
      <div className="card-badges">
        <span className="badge" style={{ borderColor: regime.color, color: regime.color }}>
          {regime.label}
        </span>
        <span className="badge muted">{CATEGORIES[ev.category]}</span>
        {CONF_LABEL[ev.confidence] && <span className="badge muted">日期{CONF_LABEL[ev.confidence]}略</span>}
      </div>
      <h2>{ev.title}</h2>
      <p className="card-when">
        {fmtDate(ev)}
        {ev.endDate && ev.endDate !== ev.date ? ` — ${ev.endDate.slice(0, 7).replace('-', '年')}月` : ''}
        {' · '}
        {ev.location}
        {ev.modernLocation ? `(${ev.modernLocation})` : ''}
      </p>
      <p className="card-summary">{ev.summary}</p>
      {ev.result && <p className="card-result">{ev.result}</p>}
      {ev.people.length > 0 && (
        <div className="card-people">
          {ev.people.map((name) => {
            const p = PERSON_BY_NAME.get(name);
            return (
              <button
                key={name}
                className="person person-link"
                title={p?.summary}
                onClick={() => openGraph(name)}
              >
                {name}
                {p?.title ? `(${p.title})` : ''}
                {p?.life ? <small> {p.life}</small> : null}
              </button>
            );
          })}
        </div>
      )}
      {ev.coordNote && <p className="card-note">◎ {ev.coordNote}</p>}
      <p className="card-src">出处:{ev.sources.join(' · ')}</p>
      <nav className="card-nav">
        <button onClick={() => select(prev.id)}>‹ {prev.year} {prev.title}</button>
        <button onClick={() => select(next.id)}>{next.year} {next.title} ›</button>
      </nav>
    </aside>
  );
}
