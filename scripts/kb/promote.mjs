// 转正:把 stg 中 status='accepted' 的候选写入 pub.*,并写 citations(溯源脊柱)
// 用法:node scripts/kb/promote.mjs
// 规则:人物按 name 幂等;事件按 (title,date_start) 幂等;关系按 (from,to,rel_type) 幂等;失败整体回滚。
import { query, close } from './db.mjs';

// 阵营 code 映射(与前端 data:build 口径一致)
const FACTIONS = {
  ming: ['明', '明朝'], qing: ['清', '清朝', '后金'], daxi: ['大西'], dashun: ['大顺'],
  nanming: ['南明'], zheng: ['郑氏', '明郑'], other: ['其他'],
};

// 部分日期规范化:YYYY-MM → YYYY-MM-01,YYYY → YYYY-01-01(精度由 date_precision 表达)
function normDate(d) {
  if (!d) return null;
  if (/^\d{4}-\d{2}$/.test(d)) return `${d}-01`;
  if (/^\d{4}$/.test(d)) return `${d}-01-01`;
  return d;
}

async function factionId(code) {
  const conf = FACTIONS[code] ? [code] : ['other'];
  const c = conf[0];
  const names = FACTIONS[c];
  const r = await query(`SELECT id FROM pub.factions WHERE code=$1`, [c]);
  if (r.rows.length) return r.rows[0].id;
  const ins = await query(`INSERT INTO pub.factions (code, name) VALUES ($1,$2) RETURNING id`, [c, names[0]]);
  return ins.rows[0].id;
}

async function promotePeople() {
  const { rows } = await query(`SELECT id, payload FROM stg.cand_people WHERE status='accepted'`);
  let n = 0;
  for (const row of rows) {
    const p = row.payload;
    const fid = p.faction ? await factionId(p.faction) : null;
    const ex = await query(`SELECT id FROM pub.people WHERE name=$1`, [p.name]);
    let pid;
    if (ex.rows.length) {
      pid = ex.rows[0].id;
      await query(
        `UPDATE pub.people SET
           courtesy = COALESCE(courtesy,$2),
           birth_year = COALESCE(birth_year,$3),
           birth_precision = CASE WHEN $3::int IS NOT NULL THEN COALESCE(birth_precision,$4) ELSE birth_precision END,
           death_year = COALESCE(death_year,$5),
           death_precision = CASE WHEN $5::int IS NOT NULL THEN COALESCE(death_precision,$6) ELSE death_precision END,
           bio = COALESCE(bio,$8), primary_faction_id = COALESCE(primary_faction_id,$7), updated_at = now()
         WHERE id=$1`,
        [pid, p.courtesy ?? null, p.birth_year ?? null, p.birth_precision ?? 'unknown',
         p.death_year ?? null, p.death_precision ?? 'unknown', fid, p.bio ?? null],
      );
    } else {
      const r = await query(
        `INSERT INTO pub.people (name, courtesy, birth_year, birth_precision, death_year, death_precision, primary_faction_id, bio, wiki_qid, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [p.name, p.courtesy ?? null, p.birth_year ?? null, p.birth_precision ?? 'unknown',
         p.death_year ?? null, p.death_precision ?? 'unknown', fid, p.bio ?? null, p.wiki_qid ?? null, p.confidence ?? 'medium'],
      );
      pid = r.rows[0].id;
    }
    for (const c of p.citations ?? []) {
      await query(
        `INSERT INTO pub.citations (entity_type, entity_id, work_slug, kb_doc_id, kb_chunk_id, locator, quote, note)
         VALUES ('person',$1,$2,$3,$4,$5,$6,$7)`,
        [pid, c.work_slug, c.kb_doc_id ?? null, c.kb_chunk_id ?? null, c.locator ?? null, c.quote ?? null, c.note ?? null],
      );
    }
    await query(`UPDATE stg.cand_people SET status='merged' WHERE id=$1`, [row.id]);
    n++;
  }
  return n;
}

async function promoteEvents() {
  const { rows } = await query(`SELECT id, payload FROM stg.cand_events WHERE status='accepted'`);
  let n = 0;
  for (const row of rows) {
    const e = row.payload;
    const fid = e.faction ? await factionId(e.faction) : null;
    const ex = await query(`SELECT id FROM pub.events WHERE title=$1 AND date_start=$2`, [e.title, normDate(e.date_start)]);
    let eid;
    if (ex.rows.length) {
      eid = ex.rows[0].id;
    } else if (e.geom) {
      const r = await query(
        `INSERT INTO pub.events (title, category, date_start, date_precision, date_end, faction_id, geom, coord_precision, coord_note, summary, confidence)
         VALUES ($1,$2,$3,$4,$5,$6, ST_SetSRID(ST_GeomFromGeoJSON($7),4326), $8,$9,$10,$11) RETURNING id`,
        [e.title, e.category ?? 'political', normDate(e.date_start), e.date_precision, normDate(e.date_end), fid,
         JSON.stringify(e.geom), e.coord_precision ?? 'approx', e.coord_note ?? null, e.summary ?? null, e.confidence ?? 'medium'],
      );
      eid = r.rows[0].id;
    } else {
      const r = await query(
        `INSERT INTO pub.events (title, category, date_start, date_precision, date_end, faction_id, coord_precision, coord_note, summary, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [e.title, e.category ?? 'political', normDate(e.date_start), e.date_precision, normDate(e.date_end), fid,
         null, e.coord_note ?? null, e.summary ?? null, e.confidence ?? 'medium'],
      );
      eid = r.rows[0].id;
    }
    for (const c of e.citations ?? []) {
      await query(
        `INSERT INTO pub.citations (entity_type, entity_id, work_slug, kb_doc_id, kb_chunk_id, locator, quote, note)
         VALUES ('event',$1,$2,$3,$4,$5,$6,$7)`,
        [eid, c.work_slug, c.kb_doc_id ?? null, c.kb_chunk_id ?? null, c.locator ?? null, c.quote ?? null, c.note ?? null],
      );
    }
    for (const pname of e.people ?? []) {
      const pr = await query(`SELECT id FROM pub.people WHERE name=$1`, [pname]);
      if (pr.rows.length) {
        await query(`INSERT INTO pub.event_people (event_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [eid, pr.rows[0].id]);
      }
    }
    await query(`UPDATE stg.cand_events SET status='merged' WHERE id=$1`, [row.id]);
    n++;
  }
  return n;
}

async function promoteRelations() {
  const { rows } = await query(`SELECT id, payload FROM stg.cand_relations WHERE status='accepted'`);
  let n = 0;
  for (const row of rows) {
    const rel = row.payload;
    const a = await query(`SELECT id FROM pub.people WHERE name=$1`, [rel.from_name]);
    const b = await query(`SELECT id FROM pub.people WHERE name=$1`, [rel.to_name]);
    if (!a.rows.length || !b.rows.length) {
      await query(`UPDATE stg.cand_relations SET status='rejected', review_note='人物不存在' WHERE id=$1`, [row.id]);
      continue;
    }
    const r = await query(
      `INSERT INTO pub.relations (from_id, to_id, rel_type, start_year, end_year, note, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING RETURNING id`,
      [a.rows[0].id, b.rows[0].id, rel.rel_type, rel.start_year ?? null, rel.end_year ?? null, rel.note ?? null, rel.confidence ?? 'medium'],
    );
    if (r.rows[0]) {
      for (const c of rel.citations ?? []) {
        await query(
          `INSERT INTO pub.citations (entity_type, entity_id, work_slug, kb_doc_id, kb_chunk_id, locator, quote, note)
           VALUES ('relation',$1,$2,$3,$4,$5,$6,$7)`,
          [r.rows[0].id, c.work_slug, c.kb_doc_id ?? null, c.kb_chunk_id ?? null, c.locator ?? null, c.quote ?? null, c.note ?? null],
        );
      }
      await query(`UPDATE stg.cand_relations SET status='merged' WHERE id=$1`, [row.id]);
      n++;
    }
  }
  return n;
}

try {
  await query('BEGIN');
  const people = await promotePeople();
  const events = await promoteEvents();
  const relations = await promoteRelations();
  await query('COMMIT');
  console.log(`转正完成: 人物 ${people} / 事件 ${events} / 关系 ${relations}`);
} catch (e) {
  await query('ROLLBACK');
  console.error('转正失败,已回滚:', e.message);
  process.exitCode = 1;
} finally {
  await close();
}
