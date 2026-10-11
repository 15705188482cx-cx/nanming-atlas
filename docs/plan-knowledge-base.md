# 知识库与数据层设计 v2(2026-10-11 定稿,待开工)

v1(自建 src.* 知识库)作废。v2 依据用户决策:**知识库采用腾讯开源 WeKnora**;结构化数据仍用 PostgreSQL+PostGIS。

## 0. 定稿结论

| 层 | 承担者 | 职责 |
|---|---|---|
| 知识库(原文层) | **WeKnora**(腾讯开源,MIT) | 电子书/古籍导入、切分、索引、"找段落";关键词+向量混合检索 |
| 结构化数据(事实层) | **PG16 + PostGIS**(独立容器) | 暂存审、规范库(事件/人物/关系/路线/疆界面/地名)、溯源引用、导出 |
| 知识图谱功能 | PG 图查询(people/relations + 递归 CTE) | 用户规划的独立功能"知识图谱"的数据底座 |
| 前端 | 现有 Next.js 静态 JSON | 不变;由 PG 导出 + build-data.mjs 终检 |

三个概念各司其职(回应"向量检索是什么"):
- **知识库** = 存原文、切分、检索 —— WeKnora;
- **向量检索** = 知识库内部的检索手段之一(按语义找相似段落,关键词不完全匹配也能命中)—— **WeKnora 自带**(BM25+pgvector+rerank),我们不用另建;
- **知识图谱** = 人物/事件之间结构化关系的网络 —— PG 的 people/relations 表与图查询,和"向量"无关。

## 1. 架构与数据流

```
材料(南明材料/版权书 + 公版古籍文本)
   │ ① 导入:WeKnora REST(上传→异步解析→父子分块→混合索引)
   ▼
WeKnora 知识库(Docker:app / ui / docreader / postgres[ParadeDB pg17+pgvector] / redis / minio)
   │ ② 检索:hybrid-search API(关键词+语义+rerank,可带父块上下文)
   ▼
抽取管线(Node 脚本)
   │ ③ LLM 抽候选,每条必带 chunk 引用 + 原文引文
   ▼
PG16+PostGIS(Docker,独立容器):stg.* 暂存 → 门禁 → pub.* 规范库
   │ ④ 导出:对齐现有 JSON schema
   ▼
data/*.json ──build-data.mjs 全量校验──▶ Next.js 静态站(现状不变)
```

**许可红线**:WeKnora 与 PG 内的版权书原文、CHGIS 数据**只存本机,严禁入 git/网盘/再分发**;仓库只收 DDL、管线代码、导出的公开 JSON。SQL 一律参数绑定。

## 2. WeKnora 部署要点(2026-10-11 调研实测)

- 仓库 https://github.com/Tencent/WeKnora ;v0.8.2,MIT,33k star,极活跃;官方 docker compose 一键部署(Mac arm64 原生镜像,无 Rosetta)
- 步骤:`git clone → cp .env.example .env → docker compose up -d`;默认栈 app/ui/docreader/sandbox/postgres(ParadeDB pg17:pgvector+BM25)/redis/minio;neo4j 等为可选 profile 默认不启动
- 资源:4 核 8GB 起步(docreader 含 LibreOffice/Playwright 较吃内存);默认不占宿主 5432,与 PostGIS 容器并行无冲突;内存紧时关 searxng
- **全本地可行**:LLM+embedding 接本机 Ollama(`host.docker.internal:11434`,机器已装),embedding 首选 bge-m3(1024 维自动建 HNSW);**不需要任何云 API key**
- **epub 原生支持**(《南明史》epub 直灌);PDF/Word/TXT/MD 均支持;扫描版走 PaddleOCR(繁体竖排质量需先拿一卷试)
- 程序化全流程 REST(`/api/v1`,约 360 端点,swagger 在仓库):`X-API-Key` 认证;`POST /knowledge-bases` 建库 → `/knowledge/file` 上传(异步,轮询状态)→ `/hybrid-search` 检索(query_text、match_count、阈值、标签过滤、带父块);另有官方 CLI 与 MCP Server
- 切分:父子分块(小块检索、大块喂 LLM)适配史籍;入参可用 `/chunker/preview` 预览后定参

## 3. 材料清单与分工

**已有待导入**:
- 顾诚《南明史》(全2册) epub(80.7 万字纯文本)——主力
- 魏斐德《洪业:清朝开国史》 mobi(mobi 非支持格式,先转 epub/txt 再入)

**公版古籍(我经 VPN 从维基文库/ctext 拉,用户已认可方向)**:
《明史》《国榷》(南明相关卷)《小腆纪年附考》《闽海纪要》《清史稿》《读史方舆纪要》《滇考》《天启滇志》《缅略》《百夷传》;钱海岳《南明史稿》(维基文库,电子化程度待验证)。注:之前表述"用 VPN 拉"指的是**拉这些书的正文文本**(它们公版、在线可抓),不是拉什么"知识库"——知识库就是本机的 WeKnora。

**版权书(用户找正版,放 `南明材料/` 即可)**:
- 高优先:**顾诚《明末农民战争史》**(《南明史》姊妹篇,补 1628–1645 大顺/大西主线)、**司徒琳《南明史:1644—1662》**(中译本,整体对勘)、**周振鹤《中国行政区划通史·明代卷》**(疆界考订核心)
- 中优先:谢国桢《南明史略》;孙文良/李治亭《明清战争史略》;郭影秋《李定国纪年》
- 低优先(可不找):刘凤云《清代三藩》、乌云毕力格《喀喇沁万户研究》等专题书(超出 1664 或方向过窄)

## 4. PG 库表设计(v2 调整)

- **src.\* 取消**(原文层职责归 WeKnora);stg/pub 保留
- `citations` 改指 WeKnora:(entity_type, entity_id, kb_doc_id, kb_chunk_id, quote, locator);正式表任何一行至少一条 citation
- stg.*:`batches`(extractor_label 含模型+提示词版本)、`cand_events/people/relations/routes/polys`(payload jsonb + status 留痕)
- pub.*:`factions` / `people` / `person_aliases` / `relations` / `places`(地理编码枢纽,挂 TGAZ/CHGIS ID)/ `events` / `event_people` / `campaigns`+`campaign_columns`+`route_points` / `snapshots`+`regime_polys`(PostGIS 几何)
- 本地专有表(⚠️ 学术许可,严禁导出):`chgis_prefectures`(按年切明/清政区底座);`ming_courier_routes/stations`(CC0 可导出)
- 索引:GiST(geom)、日期 btree、FK 全量、枚举 CHECK

## 5. 分期

| 期 | 内容 | 量级 |
|---|---|---|
| P1 | WeKnora compose + PostGIS 容器起;两本书导入;检索质量试跑(文言/专名查询);PostGIS DDL | 半天 |
| P2 | 抽取管线(检索→抽取→stg→门禁→pub→导出)+ 批量抽取事件/人物/关系 | 1–2 天挂机,= 数据扩充主工程 |
| P3 | 公版古籍批量导入;CHGIS 入库;疆域四层方案落地 | 随疆域工作 |
| P4 | 知识图谱功能(前端+图查询) | 独立功能,另行设计 |

## 6. 待用户确认

1. 版权书按第 3 节清单找,放 `南明材料/`;
2. 公版古籍我自动拉(维基文库/ctext,公版);
3. 开工方式:在场跑 or 挂机过夜(P1+P2 适合挂机)。
