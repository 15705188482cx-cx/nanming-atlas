// ②时间线清洗 v2.1:引文+全文上下文解析驱动的农历→公历修正(幂等,可重跑)。
// 背景:顾诚侧入库时农历月日被直接当公历月日(偏差25~47天),但另有部分条目当时已正确换算,
//      两种病例偏差区间重叠,无法靠 delta 区分(v1 整批平移会二次平移"已正确"者,已废弃回滚)。
// v2.1 判定:对每条事件收集农历日期候选(引文→摘要→全文中引文定位±250字窗口内的所有"X月Y日"),
//      逐候选经 lunar-javascript 换算并与旧值比对(按置信序):
//        a) |换算-旧|<=2天            → near-solar,当时已正确,保原值;
//        b) 旧值月日==候选农历月日     → "农历直写"病例,写入换算值(月精度换当月初一);
//        c) 均不匹配                  → 人工复核,保原值不写。
//      月精度不擅自升降;date_end 本轮不动(跨度语义另行人工核对)。
// 排除:候选含"闰"但非该年库历闰月者跳过(1659明历闰正月等历差);三条1645闰六月为人工裁定。
// 幂等:data/raw/date-conversion.json 记录 {id:{old,new,basis}},重跑跳过。
// 用法:node scripts/kb/fix-dates.mjs [--dry-run]
import { query, close } from './db.mjs';
import { Lunar, Solar, LunarYear } from 'lunar-javascript';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MAP_FILE = join(ROOT, 'data/raw/date-conversion.json');
const FULLTEXT = '/tmp/nanming-fulltext.txt';
const DRY = process.argv.includes('--dry-run');

const CN = { 正: 1, 冬: 11, 腊: 12, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 廿: 20, 卅: 30 };
const RE_DATE = /(闰)?([正冬腊一二三四五六七八九十]{1,2})月([初]?[一二三四五六七八九十廿卅]{1,3})日/g;

function cnDay(s) {
  if (s.startsWith('初')) return CN[s[1]] ?? null;
  if (s.startsWith('廿')) return 20 + (s[1] ? (CN[s[1]] ?? 0) : 0);
  if (s.startsWith('卅')) return 30 + (s[1] ? (CN[s[1]] ?? 0) : 0);
  if (s === '十') return 10;
  if (s.includes('十')) {
    const [a, b] = s.split('十');
    return (a ? CN[a] : 1) * 10 + (b ? CN[b] : 0);
  }
  return CN[s] ?? null;
}
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const mmdd = (m, d) => String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');

function parseLunarAll(text) {
  RE_DATE.lastIndex = 0;
  const out = [];
  let m;
  while ((m = RE_DATE.exec(text))) {
    const p = { leap: !!m[1], month: CN[m[2]] ?? null, day: cnDay(m[3]) };
    if (p.month && p.day) out.push(p);
  }
  return out;
}

function toSolar(y, m, d, wantLeap) {
  try {
    const leapNo = LunarYear.fromYear(y).getLeapMonth();
    const isLeap = wantLeap && leapNo === m;
    const s = Lunar.fromYmd(y, isLeap ? -m : m, d).getSolar();
    const back = Solar.fromYmd(s.getYear(), s.getMonth(), s.getDay()).getLunar();
    if (back.getYear() === y && back.getMonth() === (isLeap ? -m : m) && back.getDay() === d) {
      return s.toYmd();
    }
    return null;
  } catch { return null; }
}

/** 三态判定:旧值 vs 一批农历候选。先直写匹配(决定性),再近似保值(保守),都不中则复核 */
function judge(oldDs, prec, cands, y) {
  for (const p of cands) {                                    // b) 农历直写(决定性)
    if (p.leap && LunarYear.fromYear(y).getLeapMonth() !== p.month) continue;
    if (prec === 'day') {
      if (mmdd(p.month, p.day) === oldDs.slice(5)) return { verdict: 'write', new: toSolar(y, p.month, p.day, p.leap), basis: `lunar-direct(${p.leap ? '闰' : ''}${p.month}月${p.day}日)` };
    } else if (mmdd(p.month, 1) === oldDs.slice(5)) {
      return { verdict: 'write', new: toSolar(y, p.month, 1, p.leap), basis: `lunar-direct-month(${p.leap ? '闰' : ''}${p.month}月)` };
    }
  }
  for (const p of cands) {                                    // a) near-solar(保守)
    if (p.leap && LunarYear.fromYear(y).getLeapMonth() !== p.month) continue;
    const v = prec === 'day' ? toSolar(y, p.month, p.day, p.leap)
                             : toSolar(y, p.month, 1, p.leap);
    if (!v) continue;
    if (Math.abs(days(oldDs, v)) <= 2) return { verdict: 'keep', basis: `near-solar(候选${p.leap ? '闰' : ''}${p.month}月${p.day}日→${v})` };
  }
  return { verdict: 'review' };
}

// ---- 人工裁定(28条,依据原文窗口逐条核实;农历坐标交 toSolar 机械换算) ----
// 格式: [农历年,月,日,闰?] 或 'keep'; prec 指定则同时更新精度
const MANUAL = {
  141: { d: [1645, 6, 1, 1], basis: 'manual-闰六月初一(江阴倡义)' },
  155: { d: [1645, 6, 7, 1], basis: 'manual-闰六月初七就任监国' },
  156: { d: [1645, 6, 27, 1], basis: 'manual-闰六月廿七即位' },
  55:  { d: [1645, 5, 1], prec: 'month', basis: 'manual-原文仅五月初(无日),取五月初一降月精度' },
  299: { d: [1659, 8, 10], basis: 'manual-八月初十崇明登陆攻城' },
  313: { d: [1657, 11, 15], basis: 'manual-十一月十五抵宝庆降清' },
  316: { d: [1660, 11, 20], basis: 'manual-十一月二十孙可望死于北京' },
  317: { d: [1657, 12, 15], basis: 'manual-十二月十五诏三路进军西南' },
  324: { d: [1658, 12, 2], basis: 'manual-十二月初二绕天生桥弃七星关' },
  327: { d: [1658, 12, 15], basis: 'manual-十二月十五弃昆明西狩' },
  331: { d: [1658, 12, 15], basis: 'manual-十二月十五谭诣刺谭文叛变' },
  332: { d: [1659, 2, 21], basis: 'manual-明历闰正月廿一=清历二月廿一渡怒江(磨盘山)' },
  335: { d: [1658, 8, 10], basis: 'manual-八月初十羊山飓风' },
  338: { d: [1659, 4, 28], basis: 'manual-四月廿八抵定海(明历四月=清历四月已重排)' },
  339: { d: [1659, 6, 16], basis: 'manual-六月十六克瓜洲' },
  340: { d: [1659, 6, 22], basis: 'manual-六月廿二镇江之捷' },
  342: { d: [1659, 7, 24], basis: 'manual-七月廿四南京之战' },
  343: { d: [1659, 7, 7], basis: 'manual-七月初七抵芜湖檄定上游' },
  349: { d: [1659, 2, 26], basis: 'manual-明历闰正月廿六=清历二月廿六入缅' },
  352: { d: [1659, 12, 1], basis: 'manual-十二月初一吴子圣永昌降清' },
  355: { d: [1659, 10, 9], basis: 'manual-十月初九清军抵元江围城(城破继后)' },
  366: { d: [1661, 7, 19], basis: 'manual-七月十九赴咒水之盟被围杀' },
  368: { d: [1661, 12, 2], basis: 'manual-十二月初二旧晚坡受降永历被执' },
  370: { d: [1661, 12, 18], basis: 'manual-十二月十八白文选抵昆明降清' },
  383: { d: [1661, 6, 9], basis: 'manual-六月初九张进自焚(铜山)' },
  386: { keep: true, basis: 'manual-引文即公历(1662-02-01降约),保原值' },
  389: { d: [1662, 5, 8], basis: 'manual-五月初八郑成功病逝' },
  390: { d: [1662, 11, 13], basis: 'manual-十一月十三鲁监国病逝' },
  399: { d: [1663, 1, 3], basis: 'manual-康熙二年正月初三陷大昌' },
  403: { d: [1663, 11, 29], basis: 'manual-十一月廿九西安满兵抵巫山(增派节点)' },
  404: { d: [1663, 12, 23], basis: 'manual-十二月廿三陈家坡之败' },
};

const fullText = readFileSync(FULLTEXT, 'utf8'); // 已去空白
// 搜索用归一化副本:去全部标点(入库引文与原文全半角标点不一致,直接 indexOf 大量失配)
const fullNorm = fullText.replace(/[^\u4e00-\u9fff0-9]/g, '');
const norm = s => s.replace(/[^\u4e00-\u9fff0-9]/g, '');

/** 在全文中定位引文,取回溯350/前推250字窗口的日期候选 */
function windowCands(quotes) {
  const frags = quotes.split('||').flatMap(q => norm(q).split('……')).filter(f => f.length >= 8);
  frags.sort((a, b) => b.length - a.length);
  for (const f of frags) {
    let pos = fullNorm.indexOf(f);
    if (pos < 0 && f.length > 20) pos = fullNorm.indexOf(f.slice(10, 30)); // 引文可能截断,取中段
    if (pos < 0) continue;
    return parseLunarAll(fullNorm.slice(Math.max(0, pos - 350), pos + 250));
  }
  return [];
}

const rows = (await query(
  `SELECT e.id, e.title, e.date_start::text AS ds, e.date_precision AS prec, e.summary,
          COALESCE((SELECT string_agg(c.quote, '||' ORDER BY c.id) FROM pub.citations c
                     WHERE c.entity_type='event' AND c.entity_id=e.id
                       AND c.work_slug='gucheng-nanmingshi'), '') AS quotes
     FROM pub.events e
    WHERE e.date_precision IN ('day','month')
      AND EXISTS (SELECT 1 FROM pub.citations c
                   WHERE c.entity_type='event' AND c.entity_id=e.id
                     AND c.work_slug='gucheng-nanmingshi')
    ORDER BY e.id`
)).rows;

let done = {};
try { done = JSON.parse(readFileSync(MAP_FILE, 'utf8')); } catch {}

const audit = [], updates = [], review = [];
for (const r of rows) {
  const row = { id: r.id, prec: r.prec, old: r.ds, title: r.title, quote: (r.quotes.split('||')[0] || '').slice(0, 40) };
  if (done[r.id] && !MANUAL[r.id]) { row.skip = `已处理(${done[r.id].basis})`; audit.push(row); continue; }

  if (MANUAL[r.id]) {
    const mv = MANUAL[r.id];
    if (mv.keep) { row.skip = mv.basis; audit.push(row); continue; }
    const v = toSolar(mv.d[0], mv.d[1], mv.d[2], !!mv.d[3]);
    if (!v) { row.skip = 'manual换算失败'; review.push(row); audit.push(row); continue; }
    row.new = v; row.precNew = mv.prec ?? r.prec; row.basis = mv.basis;
    updates.push(row); audit.push(row); continue;
  }

  const y = +r.ds.slice(0, 4);
  const cand1 = parseLunarAll(r.quotes.split('||').join('') + (r.summary || ''));
  let j = cand1.length ? judge(r.ds, r.prec, cand1, y) : { verdict: 'review' };
  if (j.verdict === 'review') {
    // 引文/摘要未判定 → 全文定位引文,窗口内候选仅做严格直写匹配(rule1),防宽窗口误保
    const cand2 = windowCands(r.quotes);
    if (cand2.length) {
      for (const p of cand2) {
        if (p.leap && LunarYear.fromYear(y).getLeapMonth() !== p.month) continue;
        if (r.prec === 'day' && mmdd(p.month, p.day) === r.ds.slice(5)) {
          const v = toSolar(y, p.month, p.day, p.leap);
          if (v) { j = { verdict: 'write', new: v, basis: `window-direct(${p.leap ? '闰' : ''}${p.month}月${p.day}日)` }; break; }
        } else if (r.prec === 'month' && mmdd(p.month, 1) === r.ds.slice(5)) {
          const v = toSolar(y, p.month, 1, p.leap);
          if (v) { j = { verdict: 'write', new: v, basis: `window-direct-month(${p.leap ? '闰' : ''}${p.month}月)` }; break; }
        }
      }
    }
  }
  if (j.verdict === 'write' && j.new) { row.new = j.new; row.basis = j.basis; updates.push(row); }
  else if (j.verdict === 'keep') { row.skip = j.basis; }
  else { row.skip = 'review'; review.push(row); }
  audit.push(row);
}

const keep = audit.filter(a => a.skip?.startsWith('near-solar') || a.skip === 'already-solar');
console.log(`共 ${rows.length} 条: 应写 ${updates.length} / 保原值(已正确) ${keep.length} / 复核 ${review.length}`);

if (!DRY && updates.length) {
  let n = 0;
  for (const u of updates) {
    await query(`UPDATE pub.events SET date_start = $1::date, date_precision = $2::text WHERE id = $3::int`, [u.new, u.precNew ?? u.prec, u.id]);
    done[u.id] = { old: u.old, new: u.new, prec: u.precNew ?? u.prec, basis: u.basis, title: u.title };
    n++;
  }
  writeFileSync(MAP_FILE, JSON.stringify(done, null, 1) + '\n');
  console.log(`写回 ${n} 条;映射存 ${MAP_FILE}`);
} else if (DRY) console.log('(dry-run,未写库)');

const tsv = ['id\tprec\t旧\t新\t标题\t文本摘40\t判定'];
for (const a of audit) tsv.push([a.id, a.prec, a.old, a.new ?? '', a.title, a.quote, a.skip ?? a.basis ?? ''].join('\t'));
writeFileSync('/tmp/dates-audit-v2.tsv', tsv.join('\n') + '\n');
if (review.length) {
  console.log('人工复核清单:');
  for (const r of review) console.log(`  #${r.id} [${r.prec}] ${r.old} ${r.title}`);
}
await close();
