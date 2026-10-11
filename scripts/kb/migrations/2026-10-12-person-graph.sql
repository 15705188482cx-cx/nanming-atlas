-- 人物库/关系库增强迁移(2026-10-12)——纯增量,不动现有数据
-- 借鉴:sanguo-guanxitu(persons.csv: courtesy/aliases/faction/era;relations.csv: relation_type大类+detail细类+source_text)
--       CBDB(关系型人物主档+亲属/社会关系分表);明朝图谱(MySQL事实源→Neo4j查询层)
-- 注:pub.person_aliases 已在 schema.sql 定义(词表 name/courtesy/hao/title/other),此处只增强
BEGIN;

-- 1) 别名表增强:加出处与置信度(词表沿用 schema.sql 英文约定: courtesy=字 hao=号 other=别称/绰号 title=称号 name=本名异写)
ALTER TABLE pub.person_aliases ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE pub.person_aliases ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'medium'
  CHECK (confidence IN ('high','medium','approx'));
ALTER TABLE pub.person_aliases ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE pub.person_aliases DROP CONSTRAINT IF EXISTS person_aliases_person_id_alias_key;
ALTER TABLE pub.person_aliases ADD CONSTRAINT person_aliases_person_id_alias_key UNIQUE (person_id, alias);
ALTER TABLE pub.person_aliases ALTER COLUMN alias_type SET NOT NULL;

-- 2) 人物合并治理(重复人物: loser 保留可追溯指针,展示/检索时归并)
ALTER TABLE pub.people ADD COLUMN IF NOT EXISTS merged_into integer REFERENCES pub.people(id);
COMMENT ON COLUMN pub.people.merged_into IS '重复人物治理:非空=并入该主档(展示与图谱只出主档)';
CREATE TABLE IF NOT EXISTS pub.person_merges (
  id         serial PRIMARY KEY,
  loser_id   integer NOT NULL REFERENCES pub.people(id),
  winner_id  integer NOT NULL REFERENCES pub.people(id),
  reason     text NOT NULL,
  evidence   text,                       -- 判并依据(生卒/字号/事迹重合的出处)
  merged_by  text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (loser_id <> winner_id)
);

-- 3) 规范化检索键(简繁/异体字归一,字号直达用)
ALTER TABLE pub.people ADD COLUMN IF NOT EXISTS name_norm text;
CREATE INDEX IF NOT EXISTS idx_people_name_norm ON pub.people(name_norm) WHERE name_norm IS NOT NULL;

-- 4) 关系大类(图谱分组/着色/筛选用;细类仍是 rel_type)
ALTER TABLE pub.relations ADD COLUMN IF NOT EXISTS rel_group text
  CHECK (rel_group IS NULL OR rel_group IN ('亲属','君臣','政治','军事','社会'));
COMMENT ON COLUMN pub.relations.rel_group IS '关系大类(借鉴三国项目两级制);按 rel_type 机械映射';
COMMENT ON COLUMN pub.relations.rel_type IS '受控词表v1(方向约定): 君臣/父子/兄弟/叔侄/舅甥/师生/夫妻/姻亲:from=尊方;敌对/同盟/同僚/反目/荐举:from=主动方';

-- 回填 rel_group(幂等)
UPDATE pub.relations SET rel_group='亲属' WHERE rel_type IN ('父子','兄弟','叔侄','舅甥','夫妻','姻亲') AND rel_group IS NULL;
UPDATE pub.relations SET rel_group='君臣' WHERE rel_type IN ('君臣') AND rel_group IS NULL;
UPDATE pub.relations SET rel_group='政治' WHERE rel_type IN ('同盟','反目','荐举') AND rel_group IS NULL;
UPDATE pub.relations SET rel_group='军事' WHERE rel_type IN ('敌对') AND rel_group IS NULL;
UPDATE pub.relations SET rel_group='社会' WHERE rel_type IN ('同僚','师生') AND rel_group IS NULL;

-- 5) 图谱同步台账(方向A: export 产 CSV → Neo4j 全量重建)
CREATE TABLE IF NOT EXISTS pub.graph_sync (
  id             serial PRIMARY KEY,
  exported_at    timestamptz NOT NULL DEFAULT now(),
  persons_count  integer,
  relations_count integer,
  note           text
);

COMMIT;
