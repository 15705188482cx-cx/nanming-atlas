// PG(atlas-pg)客户端:统一从这里拿连接与查询函数
// 约定:任何 SQL 必须参数化($1,$2...),严禁拼接外部输入 —— 本文件只提供 query(sql, params)。
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, 'scripts/kb/.env.local'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

let pool;
export function getPool() {
  if (!pool) {
    pool = new pg.Pool({ connectionString: loadEnv().ATLAS_PG_URL, max: 4 });
  }
  return pool;
}

/** 参数化查询(唯一入口)。sql 必须用 $n 占位符,严禁模板字符串拼值。 */
export function query(sql, params = []) {
  if (/\$\{/.test(sql)) throw new Error('拒绝模板字符串插值的 SQL');
  return getPool().query(sql, params);
}

export async function close() {
  if (pool) { await pool.end(); pool = undefined; }
}
