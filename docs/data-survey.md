# 数据与生态调研(2026-10-10)

本文是仓库 README 调研结论的完整版:现有项目分析、各数据源的覆盖/格式/许可、自建方案与工作量估计。调研基于 GitHub API 检索、仓库实测(已 clone 到本地)与网络逐源验证,标注"实测"的条目均经过实际访问/下载验证。

---

## 一、现有开源项目分析

### 1.1 CochraneK/ming — 数据金矿

《明朝那些事儿》156 章全量结构化,Python 零依赖管线 + 静态站。**无 LICENSE(默认保留所有权利,只可本地参考,不可复制入库)。**

- **规模**:人物 1231、地点 563(533 带经纬度)、事件 1106(整数年份 1007)、关系 2324、年谱 165 人、帝王年表 17 帝
- **事件年份**:1283–1645,**1580–1662 窗口内有 323 件**(军事 135、政治 71、民变 16、边务 14…)
- **数据模型**(data/data.json):人物含 faction/life/chapters;地点含 lat/lng/modern_address/trace_type;事件含 year/year_source/category/participants/location(文本);关系含 rel/category(12 类:君臣从属 397、敌对冲突 321、政治攻讦 193、亲属 185、同盟友党 162、师生 63…),**关系无年份字段**
- **管线可复用**:LLM 五元组抽取(`src/extract_auto.py`,OpenAI 兼容接口)→ 人工增量层(`manual_*.json`,merge 不覆盖)→ 聚合(`src/merge.py`)→ 校验门禁(`src/validators.py`,12 组不变量)→ 构建。**处理《明史》《南明史》等新史料时,换切分器和归一表即可复用整条链路**
- **前端**:Leaflet 点图(Esri/OSM 瓦片 + 三层降级)、零依赖 Canvas 力导向图、时间轴支持年份区间筛选并写回 URL hash
- **硬伤**:1644 后仅 1 条事件(黄道周就义);无任何边界几何;LLM 抽取有幻觉(部分年份 source 标注"记忆",坐标标"草稿待核");data.json 与构建产物存在口径不一致
- **数据伦理值得照搬**:未定位地点标"待核验"不硬填坐标;原书全文刻意不入库,CI 含版权巡检

### 1.2 Jokeyou/MingGraph — 图谱组件参考(MIT)

Next.js 14 + D3 v7 + Zustand。

- **可搬走的部分**(成本低):`src/components/ForceGraph.tsx`(523 行,教科书式力导向)+ `src/lib/layout.ts`(17 帝环形钉住 + 官员聚簇布局引擎)+ `src/store/index.ts`(89 行 zustand)
- **数据不可用**:716 节点中明末窗口(1580–1662)有年份的仅 23 人;崇祯 0 条边;event 节点 0 个;46% 的边是"其他关联";id 用人名字符串
- **已知 bug(迁移时修)**:`simulation.on('end')` 三处互相覆盖(d3-dispatch 同 type 只留一个);Starfield 因 useEffect 依赖 `[]` + 条件渲染导致开关打开后不渲染;时间筛选的 filterEmperor 被解构但从未使用
- **硬编码**:1368–1644 分散在 4 个文件;皇帝表无南明四帝(弘光/隆武/绍武/永历)
- **有价值的增量**:`stories.json` 50 张故事卡(1580 后 16 张);`places.ts`/`routes.ts` 的坐标与路线 schema(MapRoute 带 path/eventId/year,已预留行进路线字段)

### 1.3 HyperDeem/MingDynasty — 架构模式参考(未标 License)

Next.js 15 + React 19。

- **疆域 GeoJSON 不可用**:6 个快照(1368/1420/1435/1450/1582/1644)每个多边形仅 8–23 个顶点,示意涂鸦级,且**作者已弃用**(public/geojson/ming/README.md 明言交互地图不再读取);实际渲染用现代省界近似 + 手绘示意多边形
- **真正可搬的是契约**:`MingTerritorySnapshotMeta`(yearFrom/yearTo/label/description)+ `resolveTerritorySnapshot` 按年匹配 + previous/current + rAF eased cross-fade(720ms)的 Hook 形态 → 可原样平移到 three-globe 的 polygonsData/Cesium Entity
- **`currentYear` 单一状态中枢 + 单向联动**(page.tsx → 时间轴/地图/谱系)是干净的可扩展脊柱
- **帝王谱系图最成熟**:`lineage.ts`(1080 行数据,含嫡长/入继/夺位六种承继模式、实/虚/篡三种边样式)+ `GenealogyGraph.tsx`(861 行 SVG,LOD 三档 + ego 模式)
- **坑**:README 三重失真(声称 MapLibre/ECharts 实际都没用);package-lock 残留 maplibre-gl 导致 `npm ci` 失败;echarts 为零引用死依赖;全仓库类型层假设"明朝止于 1644",DYNASTY_YEAR_SPAN.end=1644 硬编码,`resolveTerritorySnapshot` 钳制 1644;无任何 1644 后内容

---

## 二、疆界 / 历史地理数据

### 2.1 CHGIS(复旦史地所 + 哈佛 CGA)— 政区底座 ✅ 可用(非商用)

- **入口**:https://chgis.fas.harvard.edu/ ;下载 https://dataverse.harvard.edu/dataverse/chgis_v6
- **实测确认**:V6 含 1820/1911/1990 断面 + 县/府级政区**时序数据**(政区沿革逐条带起止年,可查明代任意年份);明末无现成"断面",从时序提取
- **许可**:官网原文 *"free for academic research, no commercial use, resale, or redistribution permitted"*;V6 README 数据集(DOI: 10.7910/DVN/6CHSR7)在 Dataverse 元数据中标记 **CC0 1.0**——两说并存,从严执行:**本项目可用,图层文件不入公开仓库**
- **引用格式**:"CHGIS, Version: 6. (c) Fairbank Center for Chinese Studies of Harvard University and the Center for Historical Geographical Studies at Fudan University, 2016."
- **地名 API**:TGAZ(旧地址 maps.cga.harvard.edu/tgaz 已 404,以站内入口为准);备选 World Historical Gazetteer(https://whgazetteer.org ,实测在线)
- **注意**:CHGIS 时序是"内地政区"视角,不含后金/大顺/大西/蒙古/南明诸政权的政权级边界——政权疆界一律自绘(见 2.4)

### 2.2 aourednik/historical-basemaps — 全球背景层 ✅(GPL-3.0)

- **实测断面清单**:世界快照按年份命名,**1580–1662 区间内命中 `world_1600.geojson`、`world_1650.geojson`**(相邻:1530、1700);本地样本已验证(.research_tmp/)
- **属性设计对前现代友好**:`NAME/SUBJECTO/PARTOF/BORDERPRECISION`(1=近似…3=法定),官方建议对前现代疆域用 opacity <100% 与模糊渲染
- **定位**:中国区域精度粗(全球尺度),只做地球视角的全球背景(朝鲜/日本/蒙古/西方殖民势力),中国主战场用 CHGIS + 自绘

### 2.3 谭其骧《中国历史地图集》— 配准参考 ⚠️ 仅扫描图

- GitHub 无矢量开源版;`imbian/chinese_historical_map`(38★)等为扫描图归档(无 License)
- 明末相关图幅齐全:明时期全图(一)(二)、奴尔干都司、鞑靼/瓦剌、哈密等卫、亦力巴里、福建·郑氏台湾(1682)
- **用法**:QGIS 地理配准后作为自绘边界的底图参考;不入库、不再分发
- 参考:"观沧海"(ageeye.cn)为矢量历史地图商业站,交互范式可借鉴,数据不可用

### 2.4 政权级疆界(明/后金清/大顺/大西/南明诸政权)— ❌ 零现成,自绘

无任何项目发布过明末政权控制区的矢量数据。方案:CHGIS 政区面打底 + 谭图配准校对 + 依《明史》《清实录》、顾诚《明末农民战争史》《南明史》的控制区描述勾绘快照。快照序列建议:1582(万历九边)→ 1616(后金立)→ 1629(己巳)→ 1644(甲申鼎革)→ 1645(弘光溃)→ 1646(隆武/绍武)→ 1652(永历,两蹶名王)→ 1659(郑成功北伐)→ 1662(永历殉国)→ 1664(茅麓山)。

### 2.5 现代底图

阿里 DataV.GeoAtlas(http://datav.aliyun.com/portal/school/atlas/area_selector)开放接口,省级 GeoJSON;注意坐标系为 GCJ-02 系,与 WGS84 历史数据混用需统一(偏移数百米)。

---

## 三、人物 / 事件数据

### 3.1 CBDB(哈佛中国历代人物传记资料库)— 关系底库 ✅

- **实测**:SQLite 单机版每月更新(HuggingFace 镜像 `cbdb/cbdb-sqlite`,2026-10 版 133MB zip;官方下载页国内被 Akamai 403,走 hf-mirror.com);在线 API https://cbdb.fas.harvard.edu/cbdbapi/person?id=<id>&o=json
- **覆盖**:**明 225,610 人、清 238,480 人——明清是全库最大部分**(唐 5.7 万、宋 8.3 万),实测查袁崇焕返回完整 BasicInfo + 亲属 + 社会关系(带关系码与史料出处,如"(乾隆)元和县志")
- **许可**:单机版发布时点前且在数据范围内的数据为 **CC BY-NC-SA 4.0**;此后新增数据为 CBDB 自定义条款(禁商用、禁演绎、禁作为公开网站/API 数据源)→ **派生数据需署名;勿做公开批量导出接口**
- **短板**:武将与农民军人物(皇太极、李自成、张献忠系统)薄于士大夫;"敌对"类军事对立关系基本没有,需自建

### 3.2 RipWheeler-max/ming-history-timeline — 事件骨架 ✅(MIT)

- 实测 `lib/data.ts`(36KB):**53 事件**(slug/title/startYear/location/type/importance/summary/background/result/impact/causes/consequences/people)+ 66 人物 + personRelations(带 relationType/description)+ 皇帝世系 + 事件因果链
- **1580 后实测 20 条**:一条鞭法 1581、援朝 1592、后金立 1616、萨尔浒 1619、魏忠贤 1624、宁远 1626、己巳 1629、袁崇焕被杀 1630、松锦 1640、孙传庭 1643、北京陷落/山海关/南明 1644……核心战役全覆盖
- 缺口:事件无经纬度(location 为文字);1645–1662 仅 1 条;`docs/DATA_SCHEMA.md` 的字段设计(日期精度、去重、因果多对多)可直接借鉴

### 3.3 其他(参考/查漏用)

- **aspxcor/Ming-Dynasty-Knowledge-Graph**(MIT,34★):1501 三元组 + 942 实体(含崇祯/李自成/吴三桂/袁崇焕/萨尔浒/宁远),关系类型 top:君臣 163、影响 105、参与 94、敌对 22。数据爬自全历史 + 百度百科,**再分发权利存疑**——只当关系词表与查漏清单
- **percent4/knowledge_graph_demo**:《明朝那些事儿》第一部三元组(1247 行 xlsx),无 License,不含崇祯朝——仅参考字段设计
- **Wikidata**(CC0):崇祯/袁崇焕/李自成等有条目,含生卒、亲属、**战役坐标(P625)**;SPARQL 可批量取带坐标的战役点。国内网络需代理
- **明清妇女著作数字档案**(麦吉尔):窄题材补充
- 中华寻根网/上图家谱平台:实测不可达或无开放数据,不适用

### 3.4 南明事件(1644–1664)自建方案

- 半自动:维基百科分类导出(`Category:南明`、`Category:明朝战争`,PetScan/Special:Export)+ Wikidata SPARQL 补坐标
- 权威依据:顾诚《南明史》(事件—地点—时间考订最密)、《明史纪事本末》补遗、《国榷》
- 估计补 40–80 条事件(弘光立/扬州/江阴/嘉定/隆武/绍兴/赣州/金声桓/李成栋反正/两蹶名王/孙可望内讧/郑成功北伐/缅甸之变/咒水之难/永历殉国/茅麓山…),并为全部事件补 `lon/lat` 与月日精度字段

---

## 四、行军路线数据 — ❌ 全开源世界为零,100% 自建

多组关键词检索(GitHub 中英文)确认:不存在任何中国古代/明清战争行进路线的 GIS 开源数据。

### 4.1 方法论范本:斯坦福 ORBIS(MIT)

- 代码 https://github.com/emeeks/orbis_stanford :节点=城市(经纬度),边=道路/河流/海路并赋时间/费用成本,支持按季节与模式(民用/军事)加权;含 75MB PostGIS 路网与路由 SQL
- 明清版换算:节点=城/关/驿(CHGIS 或现代坐标),边权=《天下水陆路程》里程→日行军速度

### 4.2 自建依据史料(按卷目,不必全文)

- **《满文老档》**:逐日记行军、驻营(萨尔浒、己巳之变尤详)——行军点定日期的一手材料
- **《明实录》**(神宗/熹宗/崇祯长编)、**《清实录》**(太祖/太宗/世祖)塘报疏奏附行军日期
- **《明史纪事本末》及补遗**(辽左兵端、锦宁战守)、**《国榷》**(补崇祯朝)
- **《明史》**卷 259(袁崇焕/孙承宗)、卢象升/孙传庭/洪承畴传、卷 309 流贼传;**《清史稿》**吴三桂/洪承畴/郑成功传
- **《天下水陆路程》《士商类要》《大明会典·驿传》**:驿路里程;朝鲜《燕行录》山海关—北京逐日记程
- 现代考订:顾诚《明末农民战争史》《南明史》、孙文良/李治亭《明清战争史略》、樊树志《晚明史》

### 4.3 MVP 路线(4 条,每条 20–80 个带日期的经纬点)

1. 萨尔浒之战(1619,四路明军分进 + 后金聚歼)
2. 己巳之变(1629,皇太极破边入塞围京师)
3. 李自成东进北京(1644,西安→宁武→大同→居庸→北京)
4. 清军入关(1644,山海关→追击李自成→定北京)

二期:宁远(1626)、松锦(1640–42)、清军历次入塞、扬州—江阴(1645)、李定国两蹶名王(1652)、郑成功北伐(1659)。**工作量估计:每条 1–2 天(考据占大头),MVP 四条约 2 周。**

---

## 五、工作量总账

| 模块 | 现成度 | 自建工作量 |
|---|---|---|
| 事件时间线 | ~80%(ming 323 件 + timeline 20 条) | 南明 40–80 条 + 全部加坐标:约 1 周 |
| 人物关系 | ~70%(ming 2324 条 + CBDB) | 明末核心 30–50 人的军事/政治边 200–400 条逐条核:1–2 周 |
| 疆界快照 | CHGIS 政区面现成 | 政权级自绘 6–10 个快照:2–3 周 |
| 行军路线 | 0% | 4 条 MVP:2 周;全量 10–14 条:2 月 |
| 前端 | 组件齐备(图谱/时间轴/cross-fade 模式) | 集成 + 南明化改造:持续 |
