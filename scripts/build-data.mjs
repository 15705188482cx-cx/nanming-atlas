#!/usr/bin/env node
/**
 * data:build — 校验并产出 data/*.json
 *
 * 门禁不变量(失败即 exit 1,可挂 CI):
 *  1. JSON 可解析、顶层为数组
 *  2. id 唯一且格式合法(ev-YYYY-slug / p-*)
 *  3. 必填字段齐全;枚举值合法
 *  4. date 与 datePrecision 格式自洽;year === date 前缀
 *  5. 坐标在项目时空范围内(东北亚—中南半岛)
 *  6. importance ∈ {1,2,3}
 *  7. 事件引用的人物必须存在于人物索引
 *  8. 输出按时间排序、数组化 endYear,并打印统计
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW_EVENTS = join(root, 'data/raw/nanming-events.json');
const RAW_PEOPLE = join(root, 'data/raw/nanming-people.json');
const OUT_EVENTS = join(root, 'data/events.json');
const OUT_PEOPLE = join(root, 'data/people.json');

const REGIMES = new Set(['ming', 'qing', 'dashun', 'daxi', 'nanming', 'zheng']);
const CATEGORIES = new Set(['military', 'political', 'economy', 'culture', 'foreign']);
const CONFIDENCE = new Set(['high', 'medium', 'approx']);
const PRECISION_RE = {
  day: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
  month: /^\d{4}-(0[1-9]|1[0-2])$/,
  year: /^\d{4}$/,
};

const errors = [];
const warn = (msg) => console.error(`  ⚠ ${msg}`);
const fail = (msg) => errors.push(msg);

let rawEvents, rawPeople;
try {
  rawEvents = JSON.parse(readFileSync(RAW_EVENTS, 'utf8'));
  rawPeople = JSON.parse(readFileSync(RAW_PEOPLE, 'utf8'));
} catch (e) {
  console.error(`✗ JSON 解析失败: ${e.message}`);
  process.exit(1);
}

// ---- 人物 ----
const peopleNames = new Set();
{
  const seen = new Set();
  rawPeople.forEach((p, i) => {
    const where = `people[${i}] ${p.name ?? '(无名)'}`;
    if (!p.id || !p.name) fail(`${where}: 缺 id/name`);
    if (seen.has(p.id)) fail(`${where}: id 重复`);
    seen.add(p.id);
    if (!REGIMES.has(p.faction)) fail(`${where}: faction 非法 ${p.faction}`);
    peopleNames.add(p.name);
  });
}

// ---- 事件 ----
const seenIds = new Set();
const events = rawEvents.map((ev, i) => {
  const where = `events[${i}] ${ev.id ?? '(无id)'}`;
  const has = (k) => ev[k] !== undefined && ev[k] !== null && ev[k] !== '';

  if (!has('id') || !/^ev-\d{4}-[a-z0-9-]+$/.test(ev.id)) fail(`${where}: id 缺失或格式非法`);
  if (seenIds.has(ev.id)) fail(`${where}: id 重复`);
  seenIds.add(ev.id);
  for (const k of ['title', 'date', 'datePrecision', 'lon', 'lat', 'location', 'regime', 'category', 'importance', 'summary', 'confidence']) {
    if (!has(k)) fail(`${where}: 缺必填字段 ${k}`);
  }
  if (ev.datePrecision && !PRECISION_RE[ev.datePrecision]) fail(`${where}: datePrecision 非法`);
  if (ev.date && ev.datePrecision && !PRECISION_RE[ev.datePrecision].test(ev.date)) {
    fail(`${where}: date "${ev.date}" 与精度 ${ev.datePrecision} 不符`);
  }
  const year = parseInt(ev.date, 10);
  if (Number.isNaN(year) || year < 1580 || year > 1683) fail(`${where}: 年份 ${year} 超出 1580–1683`);
  if (ev.endDate && ev.endPrecision && !PRECISION_RE[ev.endPrecision].test(ev.endDate)) {
    fail(`${where}: endDate 与精度不符`);
  }
  if (typeof ev.lon === 'number' && typeof ev.lat === 'number') {
    if (ev.lon < 73 || ev.lon > 136 || ev.lat < 17 || ev.lat > 54) {
      fail(`${where}: 坐标 (${ev.lon},${ev.lat}) 超出范围`);
    }
  } else fail(`${where}: 坐标必须是数字`);
  if (![1, 2, 3].includes(ev.importance)) fail(`${where}: importance 非法 ${ev.importance}`);
  if (!REGIMES.has(ev.regime)) fail(`${where}: regime 非法 ${ev.regime}`);
  if (!Array.isArray(ev.sides) || ev.sides.length === 0) fail(`${where}: sides 不能为空`);
  else ev.sides.forEach((s) => !REGIMES.has(s) && fail(`${where}: side 非法 ${s}`));
  if (!CATEGORIES.has(ev.category)) fail(`${where}: category 非法 ${ev.category}`);
  if (!CONFIDENCE.has(ev.confidence)) fail(`${where}: confidence 非法 ${ev.confidence}`);
  (ev.people ?? []).forEach((name) => {
    if (!peopleNames.has(name)) fail(`${where}: 人物 "${name}" 不在人物索引中`);
  });

  return { ...ev, year, endYear: ev.endDate ? parseInt(ev.endDate, 10) : year };
});

// 重复日期+近似地点提示(不阻断)
const byKey = new Map();
for (const ev of events) {
  const k = `${ev.date}|${ev.location}`;
  if (byKey.has(k)) warn(`疑似重复: ${byKey.get(k)} 与 ${ev.id}`);
  byKey.set(k, ev.id);
}

// ---- 疆界快照(自绘政权面,M2) ----
// 门禁:id/年份区间无缝铺满 [1580,1666]/政体枚举/环闭合/坐标范围。
// CHGIS 等学术许可数据不在此列(见 build-chgis.mjs,本地加载不入库)。
const RAW_SNAPS = join(root, 'data/raw/regime-snapshots.json');
const OUT_SNAPS = join(root, 'data/regime-snapshots.json');
const POLITIES = new Set([
  'ming', 'qing', 'dashun', 'daxi', 'nanming', 'zheng',
  'mongol', 'japan', 'korea', 'dutch', 'spanish',
]);

let rawSnaps = [];
try {
  rawSnaps = JSON.parse(readFileSync(RAW_SNAPS, 'utf8'));
  if (!Array.isArray(rawSnaps) || rawSnaps.length === 0) fail('snapshots: 顶层数组为空');
} catch (e) {
  fail(`snapshots: JSON 解析失败: ${e.message}`);
}

const T0 = 1580;
const T1 = 1666;
{
  const seenSnaps = new Set();
  let prevTo = T0 - 1;
  const sorted = [...rawSnaps].sort((a, b) => (a.yearFrom ?? 0) - (b.yearFrom ?? 0));
  sorted.forEach((s, i) => {
    const where = `snapshots[${i}] ${s.id ?? '(无id)'}`;
    if (!s.id || !/^snap-\d{4}-[a-z0-9-]+$/.test(s.id)) fail(`${where}: id 缺失或格式非法`);
    if (seenSnaps.has(s.id)) fail(`${where}: id 重复`);
    seenSnaps.add(s.id);
    for (const k of ['year', 'yearFrom', 'yearTo', 'label', 'desc', 'source']) {
      if (s[k] === undefined || s[k] === null || s[k] === '') fail(`${where}: 缺必填字段 ${k}`);
    }
    const y = Number(s.year), yf = Number(s.yearFrom), yt = Number(s.yearTo);
    if (![y, yf, yt].every(Number.isInteger)) fail(`${where}: year/yearFrom/yearTo 必须为整数`);
    if (Number.isInteger(yf) && Number.isInteger(yt) && !(yf <= y && y <= yt)) {
      fail(`${where}: year 不在 [yearFrom, yearTo] 区间内`);
    }
    if (Number.isInteger(yf)) {
      if (yf !== prevTo + 1) fail(`${where}: yearFrom ${yf} 与上一断面 yearTo ${prevTo} 不衔接(区间必须无缝铺满 ${T0}–${T1})`);
      prevTo = yt;
    }
    if (!Array.isArray(s.features) || s.features.length === 0) {
      fail(`${where}: features 为空`);
      return;
    }
    s.features.forEach((f, j) => {
      const fw = `${where}.features[${j}] ${f.name ?? f.polity ?? ''}`;
      if (!POLITIES.has(f.polity)) fail(`${fw}: polity 非法 ${f.polity}`);
      if (!f.name) fail(`${fw}: 缺 name`);
      if (!Array.isArray(f.rings) || f.rings.length === 0) {
        fail(`${fw}: rings 为空`);
        return;
      }
      f.rings.forEach((ring, r) => {
        const rw = `${fw}.rings[${r}]`;
        if (!Array.isArray(ring) || ring.length < 4) {
          fail(`${rw}: 环至少需要 4 个点`);
          return;
        }
        const [a, b] = ring[0];
        const [c, d] = ring[ring.length - 1];
        if (a !== c || b !== d) fail(`${rw}: 环未闭合`);
        ring.forEach(([lon, lat]) => {
          // 快照面覆盖东北亚全域(日本列岛/外兴安岭),比事件点 bbox 宽
          if (typeof lon !== 'number' || typeof lat !== 'number') fail(`${rw}: 坐标必须是数字`);
          else if (lon < 70 || lon > 150 || lat < 15 || lat > 56) fail(`${rw}: 坐标 (${lon},${lat}) 超出范围`);
        });
      });
    });
  });
  if (Number.isInteger(prevTo) && rawSnaps.length > 0 && prevTo !== T1) {
    fail(`snapshots: 断面只铺到 ${prevTo},未覆盖到 ${T1}`);
  }
  rawSnaps = sorted;
}

// ---- 行军路线(M3,自有数据) ----
// 门禁:id/必填字段/航点 ≥2/日期格式与单调递增/坐标范围。
const RAW_ROUTES = join(root, 'data/raw/campaign-routes.json');
const OUT_ROUTES = join(root, 'data/campaign-routes.json');

let rawRoutes = [];
try {
  rawRoutes = JSON.parse(readFileSync(RAW_ROUTES, 'utf8'));
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0) fail('routes: 顶层数组为空');
} catch (e) {
  fail(`routes: JSON 解析失败: ${e.message}`);
}

/** "YYYY"|"YYYY-MM"|"YYYY-MM-DD" → 十进制年(与前端 lib/routes.ts 同口径) */
const decimalDate = (s) => {
  const [y, m, d] = String(s).split('-').map(Number);
  const mi = m || 6;
  const di = d || 15;
  return y + (mi - 1) / 12 + (di - 1) / 365;
};

const seenRoutes = new Set();
[...rawRoutes]
  .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
  .forEach((r, i) => {
    const where = `routes[${i}] ${r.id ?? '(无id)'}`;
    if (!r.id || !/^route-\d{4}-[a-z0-9-]+$/.test(r.id)) fail(`${where}: id 缺失或格式非法`);
    if (seenRoutes.has(r.id)) fail(`${where}: id 重复`);
    seenRoutes.add(r.id);
    for (const k of ['name', 'year', 'regime', 'summary', 'source']) {
      if (r[k] === undefined || r[k] === null || r[k] === '') fail(`${where}: 缺必填字段 ${k}`);
    }
    const y = Number(r.year);
    if (!Number.isInteger(y) || y < 1580 || y > 1683) fail(`${where}: year ${r.year} 超出 1580–1683`);
    if (!REGIMES.has(r.regime)) fail(`${where}: regime 非法 ${r.regime}`);
    if (!Array.isArray(r.paths) || r.paths.length === 0) {
      fail(`${where}: paths 为空`);
      return;
    }
    r.paths.forEach((p, j) => {
      const pw = `${where}.paths[${j}] ${p.name ?? ''}`;
      if (!p.name) fail(`${pw}: 缺 name`);
      if (p.regime !== undefined && !REGIMES.has(p.regime)) fail(`${pw}: regime 非法 ${p.regime}`);
      if (!Array.isArray(p.points) || p.points.length < 2) {
        fail(`${pw}: 航点至少 2 个`);
        return;
      }
      let prevT = -Infinity;
      p.points.forEach((pt, k) => {
        const tw = `${pw}.points[${k}]`;
        if (typeof pt.lon !== 'number' || typeof pt.lat !== 'number') fail(`${tw}: 坐标必须是数字`);
        else if (pt.lon < 73 || pt.lon > 136 || pt.lat < 17 || pt.lat > 54) {
          fail(`${tw}: 坐标 (${pt.lon},${pt.lat}) 超出范围`);
        }
        const date = String(pt.date ?? '');
        if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) fail(`${tw}: date "${date}" 格式非法`);
        else {
          const t = decimalDate(date);
          if (t < prevT) fail(`${tw}: 日期 ${date} 早于前一航点(路线必须时间单调)`);
          prevT = t;
        }
      });
    });
  });
rawRoutes.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));

// ---- 人物关系(M4,自有标注) ----
// 门禁:关系类型枚举/两端人物存在/禁自环/同对同人去重(允许同名不同型)。
const RAW_RELS = join(root, 'data/raw/person-relations.json');
const OUT_RELS = join(root, 'data/relations.json');
const REL_TYPES = new Set([
  '君臣', '父子', '兄弟', '叔侄', '师生', '同僚', '荐举', '同盟', '反目', '敌对',
]);

let rawRels = [];
try {
  rawRels = JSON.parse(readFileSync(RAW_RELS, 'utf8'));
  if (!Array.isArray(rawRels) || rawRels.length === 0) fail('relations: 顶层数组为空');
} catch (e) {
  fail(`relations: JSON 解析失败: ${e.message}`);
}

const seenRels = new Set();
rawRels.forEach((rel, i) => {
  const where = `relations[${i}] ${rel.type ?? ''}:${rel.a ?? ''}-${rel.b ?? ''}`;
  for (const k of ['type', 'a', 'b', 'note', 'confidence']) {
    if (rel[k] === undefined || rel[k] === null || rel[k] === '') fail(`${where}: 缺必填字段 ${k}`);
  }
  if (rel.type && !REL_TYPES.has(rel.type)) fail(`${where}: type 非法 ${rel.type}`);
  if (rel.confidence && !CONFIDENCE.has(rel.confidence)) fail(`${where}: confidence 非法 ${rel.confidence}`);
  for (const end of ['a', 'b']) {
    if (rel[end] && !peopleNames.has(rel[end])) fail(`${where}: 人物 "${rel[end]}" 不在人物索引中`);
  }
  if (rel.a && rel.a === rel.b) fail(`${where}: 禁止自环`);
  const key = `${rel.type}|${rel.a}|${rel.b}`;
  if (seenRels.has(key)) fail(`${where}: 与前序条目重复`);
  seenRels.add(key);
});

if (errors.length) {
  console.error(`\n✗ 校验失败,共 ${errors.length} 处:`);
  errors.forEach((e) => console.error(`  ✗ ${e}`));
  process.exit(1);
}

events.sort((a, b) => a.date.localeCompare(b.date) || b.importance - a.importance || a.id.localeCompare(b.id));
rawPeople.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'));

mkdirSync(dirname(OUT_EVENTS), { recursive: true });
writeFileSync(OUT_EVENTS, JSON.stringify(events, null, 2) + '\n');
writeFileSync(OUT_PEOPLE, JSON.stringify(rawPeople, null, 2) + '\n');
writeFileSync(OUT_SNAPS, JSON.stringify(rawSnaps, null, 2) + '\n');
writeFileSync(OUT_ROUTES, JSON.stringify(rawRoutes, null, 2) + '\n');
writeFileSync(OUT_RELS, JSON.stringify(rawRels, null, 2) + '\n');

// ---- 统计 ----
const stat = (keyFn, label) => {
  const m = new Map();
  for (const ev of events) {
    for (const k of keyFn(ev)) m.set(k, (m.get(k) ?? 0) + 1);
  }
  console.log(`  ${label}: ${[...m.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
};

console.log(`\n✓ 校验通过: ${events.length} 事件 / ${rawPeople.length} 人物 / ${rawSnaps.length} 疆界快照 / ${rawRoutes.length} 行军路线 / ${rawRels.length} 人物关系`);
console.log(`  时间跨度: ${events[0].date} → ${events[events.length - 1].date}`);
stat((e) => [e.regime], '阵营');
stat((e) => [e.category], '类别');
stat((e) => [e.confidence], '置信');
stat((e) => [String(e.year).slice(0, 3) + '0s'], '年代');
console.log(`\n已写出: ${OUT_EVENTS}\n已写出: ${OUT_PEOPLE}`);
