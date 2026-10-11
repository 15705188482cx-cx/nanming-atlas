#!/usr/bin/env node
/**
 * data:chgis — 把本地 CHGIS 数据转成运行时政区底图(可选步骤)
 *
 * CHGIS(复旦史地所 + 哈佛 CGA)V6 为学术许可:可用、不可再分发——
 * 因此本脚本读取【本地】的 CHGIS 导出(不入库),简化后写到
 * public/chgis.local.json(同样 gitignore),由前端运行时 fetch;
 * 文件不存在时前端静默跳过,应用功能不受影响。
 *
 * 用法:
 *   1. 从 https://dataverse.harvard.edu/dataverse/chgis_v6 下载所需数据集
 *   2. shp/gpkg 转 GeoJSON(任选其一):
 *        npx mapshaper chgis.shp -o format=geojson data/chgis/chgis.geojson
 *      或 QGIS 导出
 *   3. npm run data:chgis
 *   4. pnpm build && pnpm start
 *
 * 输入约定:任一 *.geojson,要素属性含中文名与起止年(字段名不拘,
 * 依次尝试 NAME_CH/name_cn/NAME/name;BEG_YR/beg_yr/begYr;END_YR/end_yr/endYr)。
 * 环境变量:CHGIS_TOL=简化容差(度,默认 0.02);CHGIS_MAX_MB=输出上限(默认 12)。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(root, 'data/chgis');
const OUT_FILE = join(root, 'public/chgis.local.json');
const WINDOW = [1560, 1670]; // 与项目时段(1582–1664)略有富余
const TOL = Number(process.env.CHGIS_TOL || 0.02);
const MAX_BYTES = Number(process.env.CHGIS_MAX_MB || 12) * 1024 * 1024;

const pick = (props, keys) => {
  for (const k of keys) {
    if (props && props[k] !== undefined && props[k] !== null && props[k] !== '') return props[k];
  }
  return undefined;
};
const toYear = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : dflt;
};

/* ---- Douglas-Peucker(迭代栈,避免深环爆栈) ---- */
function simplifyRing(ring, tol) {
  if (ring.length <= 4) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let idx = -1, maxD = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      let d;
      if (len2 === 0) {
        d = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function simplifyGeometry(geom, tol) {
  if (!geom) return null;
  if (geom.type === 'Polygon') {
    const rings = geom.coordinates
      .map((r) => simplifyRing(r, tol))
      .filter((r) => r.length >= 4);
    return rings.length ? { type: 'Polygon', coordinates: rings } : null;
  }
  if (geom.type === 'MultiPolygon') {
    const polys = geom.coordinates
      .map((p) => p.map((r) => simplifyRing(r, tol)).filter((r) => r.length >= 4))
      .filter((p) => p.length);
    return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
  }
  return null; // 政区打底只取面
}

function closeRing(ring) {
  const [a, b] = ring[0];
  const [c, d] = ring[ring.length - 1];
  return a === c && b === d ? ring : [...ring, [a, b]];
}

function collect(dir) {
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.toLowerCase().endsWith('.geojson')) files.push(p);
    }
  };
  walk(dir);
  return files;
}

if (!existsSync(SRC_DIR)) {
  console.log(`未找到 ${SRC_DIR}。`);
  console.log('CHGIS 数据为学术许可(不可再分发),需自行下载转换后放入该目录:');
  console.log('  1. https://dataverse.harvard.edu/dataverse/chgis_v6 下载数据集');
  console.log('  2. npx mapshaper xxx.shp -o format=geojson data/chgis/xxx.geojson');
  console.log('  3. 重新运行 npm run data:chgis');
  console.log('本次跳过:前端将不渲染 CHGIS 政区层(其余功能不受影响)。');
  process.exit(0);
}

const files = collect(SRC_DIR);
if (!files.length) {
  console.log(`data/chgis/ 内没有 .geojson 文件,跳过(见脚本头部的转换说明)。`);
  process.exit(0);
}

let tol = TOL;
let out = '';
let count = 0;
for (;;) {
  const features = [];
  for (const file of files) {
    let fc;
    try {
      fc = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      console.error(`  ✗ ${file}: JSON 解析失败 ${e.message}`);
      process.exit(1);
    }
    const feats = Array.isArray(fc) ? fc : fc.features ?? [];
    for (const f of feats) {
      const name = pick(f.properties, ['NAME_CH', 'name_cn', 'NAME_CHN', 'NAME', 'name']) ?? '政区';
      const begYr = toYear(pick(f.properties, ['BEG_YR', 'beg_yr', 'begYr', 'BEG_YEA']), -221);
      const endYr = toYear(pick(f.properties, ['END_YR', 'end_yr', 'endYr', 'END_YEA']), 1911);
      if (endYr < WINDOW[0] || begYr > WINDOW[1]) continue; // 与项目时段无交集
      const geom = simplifyGeometry(f.geometry, tol);
      if (!geom) continue;
      if (geom.type === 'Polygon') geom.coordinates = geom.coordinates.map(closeRing);
      else geom.coordinates = geom.coordinates.map((p) => p.map(closeRing));
      features.push({ type: 'Feature', properties: { name, begYr, endYr }, geometry: geom });
    }
  }
  out = JSON.stringify({
    generated: new Date().toISOString(),
    note: 'CHGIS V6 时序政区(学术许可,本地转换,禁止再分发)',
    count: features.length,
    type: 'FeatureCollection',
    features,
  });
  count = features.length;
  if (Buffer.byteLength(out) <= MAX_BYTES || tol > 0.5) break;
  tol *= 2; // 超出预算则加倍容差重来
}

if (!count) {
  console.log(`时段 ${WINDOW.join('–')} 内没有可用的政区面(检查数据的起止年字段),未写出。`);
  process.exit(0);
}

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, out + '\n');
console.log(
  `✓ ${count} 个政区面(容差 ${tol}°,${(Buffer.byteLength(out) / 1048576).toFixed(1)}MB)→ ${OUT_FILE}`,
);
console.log('  该文件已在 .gitignore 中,不会入库;重启 next 前先 pnpm build。');
