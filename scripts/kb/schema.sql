-- nanming-atlas 数据层 DDL(PG16 + PostGIS)
-- schema: stg(抽取暂存)/ pub(规范库)
-- 约定:所有管线 SQL 一律参数绑定,严禁拼接外部输入。

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS stg;
CREATE SCHEMA IF NOT EXISTS pub;

-- ============ pub.规范库 ============

CREATE TABLE IF NOT EXISTS pub.factions (
  id        serial PRIMARY KEY,
  code      text UNIQUE NOT NULL,
  name      text NOT NULL,
  color     text,
  era_start integer,
  era_end   integer
);

CREATE TABLE IF NOT EXISTS pub.people (
  id                 serial PRIMARY KEY,
  name               text NOT NULL,
  courtesy           text,
  birth_year         integer,
  birth_precision    text NOT NULL DEFAULT 'unknown' CHECK (birth_precision IN ('year','approx','unknown')),
  death_year         integer,
  death_precision    text NOT NULL DEFAULT 'unknown' CHECK (death_precision IN ('year','approx','unknown')),
  primary_faction_id integer REFERENCES pub.factions(id),
  bio                text,
  wiki_qid           text,
  confidence         text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','approx')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_name_idx ON pub.people (name);

CREATE TABLE IF NOT EXISTS pub.person_aliases (
  id        serial PRIMARY KEY,
  person_id integer NOT NULL REFERENCES pub.people(id) ON DELETE CASCADE,
  alias     text NOT NULL,
  alias_type text CHECK (alias_type IN ('name','courtesy','hao','title','other'))
);
CREATE INDEX IF NOT EXISTS person_aliases_alias_idx ON pub.person_aliases (alias);

CREATE TABLE IF NOT EXISTS pub.relations (
  id         serial PRIMARY KEY,
  from_id    integer NOT NULL REFERENCES pub.people(id),
  to_id      integer NOT NULL REFERENCES pub.people(id),
  rel_type   text NOT NULL,
  start_year integer,
  end_year   integer,
  note       text,
  confidence text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','approx')),
  CHECK (from_id <> to_id),
  UNIQUE (from_id, to_id, rel_type)
);

CREATE TABLE IF NOT EXISTS pub.places (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  hist_name    text,
  modern_name  text,
  admin_level  text,
  geom         geometry(Point,4326),
  source_code  text CHECK (source_code IN ('tgaz','chgis','manual','wikidata')),
  external_id  text,
  confidence   text NOT NULL DEFAULT 'medium',
  UNIQUE (name, source_code)
);
CREATE INDEX IF NOT EXISTS places_geom_gix ON pub.places USING gist (geom);

CREATE TABLE IF NOT EXISTS pub.events (
  id              serial PRIMARY KEY,
  title           text NOT NULL,
  category        text CHECK (category IN ('military','political','economy','culture','foreign')),
  date_start      date,
  date_precision  text NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day','month','year','approx')),
  date_end        date,
  faction_id      integer REFERENCES pub.factions(id),
  place_id        integer REFERENCES pub.places(id),
  geom            geometry(Point,4326),
  coord_precision text CHECK (coord_precision IN ('exact','approx','region')),
  coord_note      text,
  summary         text,
  confidence      text NOT NULL DEFAULT 'medium' CHECK (confidence IN ('high','medium','approx')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_geom_gix ON pub.events USING gist (geom);
CREATE INDEX IF NOT EXISTS events_date_idx ON pub.events (date_start);

CREATE TABLE IF NOT EXISTS pub.event_people (
  event_id  integer NOT NULL REFERENCES pub.events(id) ON DELETE CASCADE,
  person_id integer NOT NULL REFERENCES pub.people(id),
  role      text,
  PRIMARY KEY (event_id, person_id)
);

CREATE TABLE IF NOT EXISTS pub.campaigns (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  year       integer,
  summary    text,
  wiki_title text
);

CREATE TABLE IF NOT EXISTS pub.campaign_columns (
  id          serial PRIMARY KEY,
  campaign_id integer NOT NULL REFERENCES pub.campaigns(id) ON DELETE CASCADE,
  name        text NOT NULL,
  faction_id  integer REFERENCES pub.factions(id)
);

CREATE TABLE IF NOT EXISTS pub.route_points (
  id             serial PRIMARY KEY,
  column_id      integer NOT NULL REFERENCES pub.campaign_columns(id) ON DELETE CASCADE,
  seq            integer NOT NULL,
  point_date     date,
  date_precision text NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day','month','approx')),
  geom           geometry(Point,4326),
  place_name     text,
  note           text,
  confidence     text NOT NULL DEFAULT 'medium',
  UNIQUE (column_id, seq)
);

CREATE TABLE IF NOT EXISTS pub.snapshots (
  id        serial PRIMARY KEY,
  label     text NOT NULL,
  year_from integer NOT NULL,
  year_to   integer NOT NULL,
  note      text,
  CHECK (year_from <= year_to)
);

CREATE TABLE IF NOT EXISTS pub.regime_polys (
  id              serial PRIMARY KEY,
  snapshot_id     integer NOT NULL REFERENCES pub.snapshots(id) ON DELETE CASCADE,
  faction_id      integer REFERENCES pub.factions(id),
  geom            geometry(MultiPolygon,4326) NOT NULL,
  precision_level text NOT NULL DEFAULT 'schematic',
  note            text
);
CREATE INDEX IF NOT EXISTS regime_polys_gix ON pub.regime_polys USING gist (geom);

-- 溯源脊柱:正式表任何一行至少一条 citation
CREATE TABLE IF NOT EXISTS pub.citations (
  id          serial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('event','person','relation','route','poly','place','faction')),
  entity_id   integer NOT NULL,
  work_slug   text NOT NULL,
  kb_doc_id   text,
  kb_chunk_id text,
  locator     text,
  quote       text,
  note        text
);
CREATE INDEX IF NOT EXISTS citations_entity_idx ON pub.citations (entity_type, entity_id);

-- CHGIS 本地表(学术许可:可用、不可再分发;严禁导出)
CREATE TABLE IF NOT EXISTS pub.chgis_prefectures (
  id       serial PRIMARY KEY,
  sys_id   text,
  name_ch  text,
  name_py  text,
  type_ch  text,
  lev_rank integer,
  beg_yr   integer,
  beg_rule text,
  end_yr   integer,
  end_rule text,
  geom     geometry(MultiPolygon,4326)
);
CREATE INDEX IF NOT EXISTS chgis_beg_end_idx ON pub.chgis_prefectures (beg_yr, end_yr);
CREATE INDEX IF NOT EXISTS chgis_geom_gix ON pub.chgis_prefectures USING gist (geom);

-- 明代驿路(CHGIS V6,CC0,可导出)
CREATE TABLE IF NOT EXISTS pub.ming_courier_routes (
  id    serial PRIMARY KEY,
  name  text,
  geom  geometry(LineString,4326),
  props jsonb
);
CREATE TABLE IF NOT EXISTS pub.ming_courier_stations (
  id   serial PRIMARY KEY,
  name text,
  geom geometry(Point,4326),
  props jsonb
);

-- ============ stg.暂存层 ============

CREATE TABLE IF NOT EXISTS stg.batches (
  id              serial PRIMARY KEY,
  work_slug       text NOT NULL,
  extractor_label text NOT NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  counts          jsonb
);

CREATE TABLE IF NOT EXISTS stg.cand_events (
  id          serial PRIMARY KEY,
  batch_id    integer NOT NULL REFERENCES stg.batches(id),
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stg.cand_people (
  id          serial PRIMARY KEY,
  batch_id    integer NOT NULL REFERENCES stg.batches(id),
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stg.cand_relations (
  id          serial PRIMARY KEY,
  batch_id    integer NOT NULL REFERENCES stg.batches(id),
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stg.cand_routes (
  id          serial PRIMARY KEY,
  batch_id    integer NOT NULL REFERENCES stg.batches(id),
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stg.cand_polys (
  id          serial PRIMARY KEY,
  batch_id    integer NOT NULL REFERENCES stg.batches(id),
  payload     jsonb NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','merged')),
  review_note text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
