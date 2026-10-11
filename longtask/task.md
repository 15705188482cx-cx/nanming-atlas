# 任务:nanming-atlas 阶段二——数据全量灌装(无人值守)

## 背景与当前状态(2026-10-11 傍晚布置)

用户已放行:"界面风格有问题但现在不弄,先把数据补齐"。阶段一 MVP 已上线
(localhost:3000:Cesium 三维地球+阵营色疆域+知识图谱,127 事件/156 人/205 关系)。

- **知识库**:WeKnora(Docker 栈,前端 :8090 / API :8080)已导入顾诚《南明史》
  全本 epub(239 万字,解析+向量化完成);检索可用,验证命令:
  `node scripts/kb/search-test.mjs "桂林之战 李定国"`
- **PG 数据层**:atlas-pg 容器(端口 5433,postgis/postgis:16-3.4),stg/pub 22 张表;
  试点(顾书第一、二章)已入库:104 人 / 43 事件 / 102 关系 / 246 条 citations。
- **管线脚本**(全链路已实测):scripts/kb/{weknora,db,insert-candidates,promote,export,search-test}.mjs
- **凭据**:scripts/kb/.env.local(ATLAS_PG_URL / WEKNORA_EMAIL / WEKNORA_PASSWORD /
  WEKNORA_KB_ID / WEKNORA_DOC_ID 等;JWT 过期 weknora.mjs 会自动重登)
- **注**:WeKnora 首次搭建时 SSRF 白名单、模型绑定已配好,勿动 `.env`(SSRF_WHITELIST_EXTRA=host.docker.internal)。

## 任务目标(用户口径:"把数据都补齐")

1. **全书抽取(主任务)**:顾诚《南明史》第三章至第二十章(第一、二章已完成)。
   逐章:切文本 → 抽取 → 入暂存 → 转正 → 导出。去重后净增目标:
   事件累计 **300–500**、人物 **250–400**、关系 **600+**。
2. **行军路线补 6–15 条**:关键战役(潼关之战、扬州、江阴、桂林、衡州、新会、
   护国岭、南昌、保宁、雾渡河、磨盘山、厦门海战、郑成功北伐、永历入缅、茅麓山等,
   按顾书考订取材),航点带时间戳,结构对齐 data/raw/campaign-routes.json 现有格式。
3. **疆域断面加密 10 → 15+**:按顾书形势增补断面(如 1645 清军下江南、1646 三帝并立、
   1648 金李反正、1652 两蹶名王、1659 长江之役、1661 永历入缅、1662 永历殉国后),
   结构对齐 data/raw/regime-snapshots.json,polity 枚举见 src/lib/types.ts,
   每断面带史源说明与"示意精度"标注。
4. **(可选,时间富余再做)公版古籍导入 WeKnora** 作校订层:经 VPN 代理
   (http://127.0.0.1:7897)从维基文库拉《明史》《国榷》《小腆纪年》南明相关卷。

## 质量红线(每条数据都必须满足)

- 100% 带引文:`work_slug='gucheng-nanmingshi'`、`locator='第N章第M节 标题'`、
  `quote`(原文摘句 ≤60 字);
- 农历日期折算公历,折算无把握 → date + date_precision 降级('month'/'year' 或
  confidence='approx'),禁止编造精确日期;
- 坐标拿不准 → geom 给约位 + coord_precision='region' + coord_note;
- 与现有数据去重:export.mjs 自带规则(日期±45天且距离≤100km 或同名)自动处理;
- 关系 rel_type 枚举:君臣/父子/兄弟/叔侄/师生/同僚/荐举/同盟/反目/敌对/舅甥/姻亲;
  关系两端人物必须已存在,缺则先补人物批次;
- SQL 一律参数绑定(scripts/kb/db.mjs 强制,禁止模板字符串拼 SQL);
- 原书文本、CHGIS、public/cesium 一律不入 git(已 gitignore)。

## 执行手册(接力会话照此操作)

0. **环境核对与拉起**:Docker CLI 需 PATH 前缀
   `/Applications/Docker.app/Contents/Resources/bin`(或用全路径)。
   - `docker ps` 确认 atlas-pg、WeKnora 五容器在跑;挂了:
     `docker start atlas-pg`;`cd .sources/WeKnora && docker compose up -d`;
   - 站点:`pnpm build && (npx next start > /tmp/nanming-start.log 2>&1 &)`,curl localhost:3000 验 200。
1. **章节切分**(照抄试点做法):epub 路径用 glob
   `南明材料/**/南明史*.epub` 定位;每节一个 text/partNNNN.html(part0000 是目录);
   python 定位章标题文件、排版(width 56 wrap)输出 /tmp/nanming-extract/chN.txt。
   样例脚本思路见本轮会话(按【partNNNN.html】标记切分)。
2. **抽取(每 1–2 章一批)**:通读该章文本,产出候选 JSON(结构样例:
   /tmp/nanming-extract/cand-ch1-2-*.json,事件/人物/关系三部分)。
   事件必带:date_start/date_precision/faction/category/geom/summary/confidence/
   people(人名数组)/citations。人物必带:name/birth/death(未知给 null + precision
   'unknown')/faction/bio/citations。关系见上枚举。
3. **入库**:
   - 合并三份为单一 JSON(events/people/relations/work_slug/extractor_label);
   - `node scripts/kb/insert-candidates.mjs <file>`(自动校验引文完整性);
   - 审校:扫一遍明显错误后,
     `docker exec atlas-pg psql -U atlas -d atlas -c "UPDATE stg.cand_events SET status='accepted' WHERE status='pending'; UPDATE stg.cand_people SET status='accepted' WHERE status='pending'; UPDATE stg.cand_relations SET status='accepted' WHERE status='pending';"`
   - `node scripts/kb/promote.mjs`(月精度日期自动规范化;关系端点缺失会拒,补人重跑即可,rejected 记录置回 accepted 的语句同上);
4. **路线/断面**:直接编辑 data/raw/campaign-routes.json 与 regime-snapshots.json,
   跑 `npm run data:build` 过门禁(门禁会校验时间跨度、环闭合、政体枚举)。
5. **每 2–3 章一次落盘**:`node scripts/kb/export.mjs` → `pnpm build` → 重启 next start
   → curl 200 → **立即更新 longtask/progress.md**(写清完成到第几章、当前计数)。
6. **完成标准**:第 20 章抽取完毕 + 路线/断面达标 + 最终导出/构建/curl 全绿
   → progress.md 第一行改 `STATUS: DONE`,并写明最终计数。

## 纪律

- 用户已明确:**本阶段禁止改 UI 风格**(界面问题用户记下了,阶段三处理);
- >100MB 下载/新依赖一律先在 progress 里报备,本阶段原则上零新增;
- 每完成一步立即更新 longtask/progress.md——接力会话全靠它续命;
- 汇报以计数说话(事件/人物/关系/路线/断面当前值 vs 目标值)。
<!-- ALL-STAGE-DONE -->
