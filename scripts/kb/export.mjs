// 导出:pub.* → data/kb-*.json(前端合并用)
// 去重规则:与 data/events.json 现有条目按"日期±45天且距离≤100km"或同名(去标点)判重,命中即跳过
import { query, close } from './db.mjs';
import { readFileSync, writeFileSync } from 'node:fs';

const existing = JSON.parse(readFileSync('data/events.json', 'utf8'));
const strip = (s) => s.replace(/[《》(),,。·\s]/g, '');
const hav = (a, b) => {
  const R = 6371, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const dayMs = 86400000;
const isoDay = (s) => new Date(s).getTime();
const isDup = (cand) =>
  existing.some((e) => {
    const d = new Date(`${cand.date}T00:00:00Z`).getTime() - isoDay(`${e.date}T00:00:00Z`);
    const near = Math.abs(d) <= 45 * dayMs && Number.isFinite(cand.lon) && Number.isFinite(e.lon) &&
      hav({ lat: cand.lat, lon: cand.lon }, { lat: e.lat, lon: e.lon }) <= 100;
    return near || strip(cand.title) === strip(e.title);
  });

const VALID_FACTIONS = new Set(['ming', 'qing', 'dashun', 'daxi', 'nanming', 'zheng']);

const evRows = (await query(
  `SELECT e.id, e.title, e.category, e.date_start::text ds, e.date_precision, e.date_end::text de,
          f.code regime, ST_X(e.geom) lon, ST_Y(e.geom) lat,
          e.coord_precision, e.coord_note, e.summary, e.confidence
   FROM pub.events e LEFT JOIN pub.factions f ON f.id = e.faction_id ORDER BY e.id`,
)).rows;
const peopleOf = new Map();
for (const r of (await query(
  `SELECT ep.event_id, p.name FROM pub.event_people ep JOIN pub.people p ON p.id = ep.person_id`,
)).rows) {
  if (!peopleOf.has(r.event_id)) peopleOf.set(r.event_id, []);
  peopleOf.get(r.event_id).push(r.name);
}
const cites = new Map();
for (const r of (await query(
  `SELECT entity_type, entity_id, work_slug, locator, quote FROM pub.citations`,
)).rows) {
  const k = `${r.entity_type}:${r.entity_id}`;
  if (!cites.has(k)) cites.set(k, []);
  cites.set(k, [...cites.get(k), `《南明史》${r.locator}:"${(r.quote || '').slice(0, 60)}"`]);
}
const isoDate = (ds, prec) =>
  prec === 'day' ? ds : prec === 'month' ? ds.slice(0, 7) : ds.slice(0, 4);

let skipped = 0;
const events = [];
for (const e of evRows) {
  if (!Number.isFinite(e.lon)) continue;
  const cand = {
    id: `kb-${e.id}`, title: e.title, date: isoDate(e.ds, e.date_precision),
    datePrecision: e.date_precision === 'day' ? 'day' : e.date_precision === 'month' ? 'month' : 'year',
    lon: Number(e.lon.toFixed(3)), lat: Number(e.lat.toFixed(3)),
    location: e.coord_note || '', regime: e.regime, sides: [e.regime],
    category: e.category, type: { military: '战事', political: '政事', economy: '经济', culture: '文化', foreign: '中外' }[e.category] || '史事',
    importance: 2, summary: e.summary || '', people: peopleOf.get(e.id) || [],
    sources: cites.get(`event:${e.id}`) || [], confidence: e.confidence,
  };
  if (isDup(cand)) { skipped++; continue; }
  events.push(cand);
}

const personRows = (await query(
  `SELECT p.id, p.name, p.courtesy, p.birth_year, p.birth_precision, p.death_year, p.death_precision,
          f.code faction, p.bio, p.confidence
   FROM pub.people p LEFT JOIN pub.factions f ON f.id = p.primary_faction_id ORDER BY p.id`,
)).rows;
const life = (p) => {
  const b = p.birth_year ?? '?';
  const d = p.death_year ?? '?';
  return `${b}${p.birth_precision === 'approx' ? '?' : ''}–${d}${p.death_precision === 'approx' ? '?' : ''}`;
};
const people = personRows
  .filter((p) => VALID_FACTIONS.has(p.faction))
  .map((p) => ({
    id: `kb-p-${p.id}`, name: p.name, title: p.courtesy || undefined, life: life(p),
    faction: p.faction, summary: p.bio || '',
    sources: cites.get(`person:${p.id}`) || [],
  }));

const relations = (await query(
  `SELECT r.rel_type type, a.name a, b.name b, r.note, r.confidence
   FROM pub.relations r
   JOIN pub.people a ON a.id = r.from_id
   JOIN pub.people b ON b.id = r.to_id ORDER BY r.id`,
)).rows.map((r) => ({ type: r.type, a: r.a, b: r.b, note: r.note || '', confidence: r.confidence === 'approx' ? 'medium' : r.confidence }));

writeFileSync('data/kb-events.json', JSON.stringify(events, null, 1));
writeFileSync('data/kb-people.json', JSON.stringify(people, null, 1));
writeFileSync('data/kb-relations.json', JSON.stringify(relations, null, 1));
console.log(`导出: 事件 ${events.length}(去重跳过 ${skipped})/ 人物 ${people.length} / 关系 ${relations.length}`);
await close();
