// 试点抽取候选入库:把 LLM 抽取结果(JSON 文件)写入 stg.* 暂存表
// 用法:node scripts/kb/insert-candidates.mjs <candidates.json>
// JSON 形状:{ work_slug, extractor_label, events:[{title,date_start,date_precision,...,citations:[...]}],
//            people:[...], relations:[{from_name,to_name,rel_type,...}], routes:[...] }
import { readFileSync } from 'node:fs';
import { query, close } from './db.mjs';

const file = process.argv[2];
if (!file) { console.error('用法: node insert-candidates.mjs <candidates.json>'); process.exit(1); }
const data = JSON.parse(readFileSync(file, 'utf8'));

const required = ['title', 'date_start', 'date_precision', 'citations'];
function checkEvent(e, i) {
  for (const k of required) if (e[k] === undefined) throw new Error(`events[${i}] 缺少 ${k}`);
  if (!Array.isArray(e.citations) || e.citations.length === 0) throw new Error(`events[${i}] citations 为空——每条数据必须可溯源`);
}
function checkPerson(p, i) {
  if (!p.name) throw new Error(`people[${i}] 缺少 name`);
  if (!Array.isArray(p.citations) || p.citations.length === 0) throw new Error(`people[${i}] citations 为空`);
}
function checkRelation(r, i) {
  if (!r.from_name || !r.to_name || !r.rel_type) throw new Error(`relations[${i}] 缺少 from_name/to_name/rel_type`);
  if (!Array.isArray(r.citations) || r.citations.length === 0) throw new Error(`relations[${i}] citations 为空`);
}
(data.events || []).forEach(checkEvent);
(data.people || []).forEach(checkPerson);
(data.relations || []).forEach(checkRelation);

const counts = {};
await query('BEGIN');
try {
  const b = await query(
    `INSERT INTO stg.batches (work_slug, extractor_label) VALUES ($1,$2) RETURNING id`,
    [data.work_slug, data.extractor_label],
  );
  const batchId = b.rows[0].id;
  for (const [key, table] of [['events', 'cand_events'], ['people', 'cand_people'], ['relations', 'cand_relations'], ['routes', 'cand_routes']]) {
    const items = data[key] || [];
    for (const item of items) {
      await query(`INSERT INTO stg.${table} (batch_id, payload) VALUES ($1,$2)`, [batchId, JSON.stringify(item)]);
    }
    counts[key] = items.length;
  }
  await query('COMMIT');
  console.log(`批次 #${batchId} 已入暂存:`, counts);
} catch (e) {
  await query('ROLLBACK');
  console.error('入库失败,已回滚:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
