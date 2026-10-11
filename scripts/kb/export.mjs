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
const near = (a, b) => {
  if (!Number.isFinite(a.lon) || !Number.isFinite(b.lon)) return false;
  const d = new Date(`${a.date}T00:00:00Z`).getTime() - isoDay(`${b.date}T00:00:00Z`);
  if (Math.abs(d) > 45 * dayMs) return false;
  return hav({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }) <= 100;
};
const isDup = (cand, list) =>
  list.some((e) => near(cand, e) || strip(cand.title) === strip(e.title));

const VALID_FACTIONS = new Set(['ming', 'qing', 'dashun', 'daxi', 'nanming', 'zheng', 'other']);

const WORK_LABEL = {
  'gucheng-nanmingshi': '南明史',
  'wakeman-hongye': '洪业',
};

const evRows = (await query(
  `SELECT e.id, e.title, e.category, e.date_start::text ds, e.date_precision, e.date_end::text de,
          e.date_format, e.date_claims,
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
  const label = WORK_LABEL[r.work_slug] ?? r.work_slug;
  cites.set(k, [...cites.get(k), `《${label}》${r.locator}:"${(r.quote || '').slice(0, 60)}"`]);
}
const isoDate = (ds, prec) =>
  prec === 'day' ? ds : prec === 'month' ? ds.slice(0, 7) : ds.slice(0, 4);

let skipped = 0, folded = 0;
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
  // 日期不确定度三种格式: exact(默认) / range(区间窗口) / multi(多说并存)
  if (e.date_format && e.date_format !== 'exact') cand.dateFormat = e.date_format;
  if (e.de && e.date_format === 'range') cand.endDate = e.de;
  if (e.date_claims && e.date_format === 'multi') cand.dateClaims = e.date_claims;
  if (isDup(cand, existing)) {
    skipped++;
    // 被手建事件吸收的 KB 引文回写 raw,保证跨书合并的引文不丢
    const host = existing.find((h) => near(cand, h) || strip(cand.title) === strip(h.title));
    if (host) {
      const have = new Set(host.sources ?? []);
      const add = cand.sources.filter((s) => !have.has(s));
      if (add.length) { host.sources = [...(host.sources ?? []), ...add]; host.__enriched = true; }
    }
    continue;
  }
  // KB 内部跨书重复:引文并入先导出的一条,不重复上地图
  const twin = events.find((x) => near(cand, x) || strip(cand.title) === strip(x.title));
  if (twin) {
    twin.sources = [...twin.sources, ...cand.sources];
    twin.people = [...new Set([...twin.people, ...cand.people])];
    skipped++; folded++;
    continue;
  }
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
// 回写被合并引文 enrich 过的手建事件(保持 raw 与 data 同源)
if (existing.some((h) => h.__enriched)) {
  for (const h of existing) delete h.__enriched;
  writeFileSync('data/raw/nanming-events.json', JSON.stringify(existing, null, 2) + '\n');
  console.log('已回写 data/raw/nanming-events.json(并入 KB 引文)');
}
console.log(`导出: 事件 ${events.length}(去重跳过 ${skipped},跨书并入 ${folded})/ 人物 ${people.length} / 关系 ${relations.length}`);
await close();
