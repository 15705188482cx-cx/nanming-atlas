# M6 方案:数据全面扩充 + Cesium 地球(待用户确认,2026-10-11)

状态:**方案讨论阶段,未执行**。用户反馈后修订,调研已完成。

## 用户已拍板的口径

1. 数据来源依赖两个:维基百科 + 顾诚《南明史》(有冲突再议,先把数据扩上去);
2. 人物:按顾诚《南明史》全书人物**全量提取**(不止 100 多个);
3. 行军路线:**不设 10 条上限**,按两源把主要战争/行军全建(预计 15–25 条);
4. 功能:Cesium 确认使用;UI 后置,数据和功能优先;
5. 缺什么数据向用户开口,由用户想办法。

## 调研结论(2026-10-11 实测)

### A. "史图馆"(用户所说"使图馆",同音)

- B 站官方号 UID 15262818,《中国历代疆域变化》系列;明末清初有新版 85"晚明怠政"(BV1v3411Q7WQ)、新版 89"清灭南明"(BV1Nc411G7T1)。
- **分辨率是逐年(每帧一年),不是逐月**;且**底层数据从未公开**(无 GitHub/官网/下载渠道;简介仅 BGM;其授权声明只覆盖"视频作品的非商业引用与二创",不涉及矢量数据;制作方式为 Photoshop 手绘非 GIS)。
- **结论:数据源拿不到。** 截图分析不推荐做数据源(年分辨率、自绘投影无控制点、提取后再分发有版权风险),只宜作**逐年史实校订的参考画面**。
- **疆界方案维持自绘**:现有 10 断面加密到 15–24 个;几何底本用 CHGIS(下),史图馆视频/谭其骧图集(1582 断面)仅作人工校订参考。

### B. 疆界几何底本:CHGIS(已测可达)

- CHGIS V5(哈佛 Dataverse):政区时序 shapefile,带起讫年份,**CC0 许可最安全**;dataverse.harvard.edu 本机实测 HTTP 200。
- 用法:1580–1664 各府州辖区时序切片重建政区格局打底(README 已有 `data:chgis` 管线,文件不入库,合规),政权控制面仍自绘。
- 无"国界/控制线"层,战场态势仍需按《南明史》自绘。

### C. 维基数据源(关键网络发现)

- **本机网络无法直连维基系**(zh.wikipedia.org / wikidata.org / wikisource.org 均 TLS 阻断;常见代理端口 7890/1087/1080 均无服务)。抓维基需要用户提供网络通道。
- **QLever 全量 Wikidata 镜像(qlever.dev)实测可达、已跑通 SPARQL**:可批量拉"1644–1664 战役"(全球 298 条、57% 带坐标)、人物生卒(P569/P570)、QID 对齐。但中国明清易代实体标注稀疏(P17=南明 仅 10 个),**维基数据只能当"对齐/补全层",不能当主源**。
- zh.wikipedia 抓取路径已备好(categoryinfo 探量级 → categorymembers 翻页 → prop=coordinates 批量 50 标题/次),待网络可达后先跑 `Category:南明|南明君主|明清战争|…` 量级探测。
- 许可:zh.wikipedia **CC BY-SA 4.0**(派生数据可入库,需署名+同方式共享声明);Wikidata **CC0**。
- **维基文库**:《明史》在线;**钱海岳《南明史稿》(纪传体 120 卷)在维基文库**,作者 1968 年卒已公版——纪传体列传 96 卷是"人物全量提取"的宝库,电子化程度待查(需可达网络验证)。
- 顾诚《南明史》仍在版权期,无合法在线全文。**若用户提供电子文本(txt/epub/pdf,放仓库外或 gitignore 目录)**:用 LLM 五元组抽取管线(CochraneK/ming 先例,docs/data-survey.md 1.1)批量提取事件/人物/关系,**事实入库存自建表达,原文不入库**(事实不受版权保护,该项目有成熟伦理先例)。

## 修订方案 v2(按用户口径)

| 类别 | 现状 | 目标 | 来源与办法 |
|---|---|---|---|
| 事件 | 97 | **300–500** | 顾诚《南明史》编年(有文本用文本抽取,无文本凭史实自建)+ zh.wikipedia 战役/事件分类(需网络)+ QLever 交叉核对;每条保留出处/置信度 |
| 人物 | 53 | **250–400(全量口径)** | 顾诚《南明史》全书人物 + 钱海岳《南明史稿》维基文库 + zh.wikipedia 人物分类;生卒用 QLever 补;图谱加"核心人物"默认筛选防 300+ 节点不可读 |
| 关系 | 103 | **600+** | 随人物扩充;两端必须存在(门禁);每条带史注+置信度 |
| 路线 | 4 | **15–25(不设上限)** | 顾诚《南明史》+维基,主要战役行军全建;两源冲突时标注分歧;航点带时间戳兼容播放动画 |
| 疆界快照 | 10 断面 | **15–24 断面** | 自绘加密(重点 1644–1662 加密到季级);CHGIS CC0 政区打底(可选层);史图馆视频仅人工校订参考 |
| 地球 | 自研 Canvas 球 | **CesiumJS** | cesium npm(Apache 2.0),静态资源拷 public/cesium + CESIUM_BASE_URL;影像用与 2D 同源 Esri 深灰瓦片,零 ion token;dynamic import 懒加载保首载 140KB;删 301 行自研球 |

执行顺序:事件 → 人物 → 关系 → 路线 → 快照(每批过 data:build 门禁)→ Cesium 集成 → build+curl 验证 → README 更新。

## Cesium 集成方案(2026-10-11 调研完成,待用户确认)

**结论:可行,零 ion token、零新增网络依赖、首载体积零增加。**

- **版本锁定 `cesium@~1.140.0`**:1.146 要求 Node≥22,本机 Node 20.19.0,1.140 恰好要求 Node≥20.19(实测 `npm view engines`);1.142+ 的新特性(GeoJsonPrimitive 直载、PathGraphics PORTIONS)是大数据量优化,本项目 Entity 路线够用。许可 Apache-2.0。
- **体量**:引擎 ~1.8MB gzip,仅切换地球时经 `dynamic(ssr:false)` 懒加载,**首载 140KB 不变**;Workers/Assets/Widgets/ThirdParty 四目录(~79MB)构建时拷到 `public/cesium/`,**gitignore 不入库**,运行时按需加载。
- **集成管线**(参照 hyundotio/nextjs-ts-cesium-example,Next 16+React 19 实测可跑):`pnpm add cesium@1.140.0 + cpx2`;package.json 加 `prebuild/predev` 拷贝脚本;`window.CESIUM_BASE_URL='/cesium/'` 必须在 import cesium 之前设;`'use client'` 包裹 + `dynamic(..., { ssr:false })`;`widgets.css` 客户端组件内引入;StrictMode 下 effect cleanup 必须 `viewer.destroy()`。**不引 Resium**(命令式场景直接写 ~100 行 hook)。
- **底图(零 token,观感与 2D 一致)**:显式 `baseLayer` 覆盖默认,复用 2D 同源 Esri World Dark Gray Base+Reference 两层 `UrlTemplateImageryProvider`(注意 ArcGIS 瓦片顺序是 `{z}/{y}/{x}`;labels 层 alpha 0.5 对齐 2D)。**严禁照抄中文教程的 `Ion.defaultAccessToken` 写法**——内置默认 token 是限时评估令牌(2026-12-01 过期),不配底图的应用到时集体白球。全离线兜底:包内自带 NaturalEarthII 纹理(`TileMapServiceImageryProvider` + `buildModuleUrl`),底图加载失败时可用。
- **三层叠加**:`GeoJsonDataSource.load` 一次载入疆界面/行军线/事件点;面按政体就地着色(不整层重建),边界用叠加 polyline 虚线(Windows 下 outlineWidth 无效的坑);行军"已行进亮线"用 `CallbackProperty` 动态切片 positions(与 2D 同口径);事件点用 `PointGraphics` 替换 GeoJSON 默认图钉,按时间窗口明暗、点选联动事件卡;选中 `viewer.flyTo` 转镜头至事件上空。
- **交互**:保持连续渲染(不用 requestRenderMode,因时间轴动画+自动旋转需要);静置自动缓旋走 `clock.onTick + camera.rotate`,用户拖拽即停,行为与现有自研球一致。
- **验证口径**:`next build` 首载对比 + curl `/cesium/Workers/...` 200 + HTML 预渲染冒烟;WebGL 实际观感由用户浏览器验收。

## 第二轮调研补遗(2026-10-11,经 VPN 代理实测)

**电子书已到位**:`南明材料/南明史(全2册)/` 有 epub/azw3/mobi/pdf 四格式,epub 188 个正文文件、约 80.7 万字符纯文本(非扫描),可直接抽取;目录完整(第一章"明朝覆亡后的全国形势"起)。附赠魏斐德《洪业:清朝开国史》mobi(清方视角,可作交叉校订)。`南明材料/` 已加入 .gitignore,原文严禁入库。

**维基实测(辅助层定位确认)**:分类条目量级——明朝战役 54(另有子分类)、清朝战役 60(另有子分类)、南明人物 47、南明君主 10、明末民变 15、明清战争 14、大顺 4、大西 4;"抗清人物/明郑/南明历史事件"等分类名不存在(开工时换名再探)。**意外发现:zh.wikipedia GeoData 坐标覆盖率实测 0/11**(萨尔浒/扬州/江阴/桂林等战役条目均无坐标注册)→ **事件坐标管线改为:Wikidata P625(QLever 镜像已验证可达)+ CHGIS/TGAZ 历史地名定位(CC0)+ 人工考订标置信度**。维基定位=清单发现与文本交叉核对,事件/人物主力=顾诚《南明史》全文抽取。

**史图馆真相(用户问题二的答案)**:其官方"参考资料"opus 全文已取回(wayback 快照 + B站 opus/detail API 双路验证)。制作方式=**谭其骧《中国历史地图集》+ 郭沫若《中国史稿地图集》+ 周振鹤《中国行政区划通史》打底,以《明史》《明实录》《国榷》《小腆纪年》《闽海纪要》等考订,南明段参考顾诚《南明史》、钱海岳、谢国桢**;纯文献考订 + Photoshop 逐帧人工绘制,**无内部数据库、无可下载资产**;社区教程证实其底图为专有资产(仅限架空创作,禁止用于历史地图)。**他列的书单直接转为我们的考订 checklist**(南明段核心:顾诚《南明史》、《小腆纪年》、《闽海纪要》、《国榷》,滇缅方向《滇考》《天启滇志》《缅略》)。

**疆域方案定稿(四层,替代原"自绘加密"单一方案)**:
1. 底座:CHGIS V6 时序府级面(doi:10.7910/DVN/I0Q7SM,3,830 个府级多边形带起讫年份与政权规则编码,29.7MB,实测可下)——按年切片得明/清(后金)内地政区控制面;学术许可禁整体再分发,走既有 `data:chgis` 本地管线合规;
2. 军事控制面:顾诚《南明史》附图 + 谭图 + 史图馆视频逐年画面考订自绘大顺/大西/南明诸政权控制区(与史图馆同款生产方式,但我们有矢量底座);
3. 周边政权粗断面:historical-basemaps world_1600/1650(GPL-3.0,实测含 Ming/Post-Ming Warlords/Manchu/Dutch Formosa);
4. 参照图:Wikimedia Commons CC 图(Qing conquest of South Ming territories.svg 为 CC BY 3.0,Ming 1580、1616 东亚、明末民变系列等 CC BY-SA)。

**Cesium 可复用清单(用户问题一的答案)**:工程零件约 60–70% 现成——hyundotio/nextjs-ts-cesium-example 集成模板、Sandcastle 的 geojson/timeline/czml-intervals 模式、resium(React 19 兼容已确认,仍建议不用);数据零件——teachany 明/清疆域 geojson(CHGIS V6 学术许可)、TracksOfYu/geodata 河流运河层(MIT)、TIFFImageryProvider(配准古地图直接上球)、明代驿路官方版(CHGIS V6 Courier Routes,doi:10.7910/DVN/SB8ZTM,**CC0**;第三方 Mingroutes 无许可声明,不用)。**结论:不存在可整体改造的开源项目,"拿现成案例改"不成立;零件全拿,自建集中在政权级时段数据。**

## 需要用户提供/拍板的缺口清单

1. **网络通道**:**已解决(2026-10-11 实测)**——用户 VPN 的系统代理 `127.0.0.1:7897` 可连通,`curl -x http://127.0.0.1:7897` 访问 zh.wikipedia API 返回 HTTP 200;抓取脚本统一走该代理,无需改用户 VPN 规则、无需换浏览器。注意脚本需容错:代理未开时明确报"请开启 VPN"而非静默失败。
2. **顾诚《南明史》电子文本**:**已到位并验证**(见补遗),抽取管线随时可跑。
3. 方案确认:数据规模口径、疆域四层方案(见补遗)、Cesium 方案——**全部就绪,待用户最终拍板开工**(可挂机)。
4. 分工共识:数据源依赖维基+顾诚《南明史》;功能(Cesium)另行讨论;UI 后置。

## 预计耗时

- 数据扩充(大头):挂机约 4–6 小时(分批写+门禁);
- Cesium 集成:约 1–2 小时;
- 合计约一晚挂机量。适合交给 longtask 续跑器过夜跑(用户确认后布置)。

## 环境备忘

- 本机可达:dataverse.harvard.edu(CHGIS)、qlever.dev(Wikidata 镜像)、B 站 API、npm registry;
- **维基全系:经用户 VPN 本地代理可达**——`curl -x http://127.0.0.1:7897`(Clash Verge 默认端口,系统代理同端口;2026-10-11 实测 zh.wikipedia API 200);
- 本机 Node v20.19.0 → **cesium 锁 ~1.140.0**(1.146 需 Node≥22);
- 本机不可达(直连):维基全系、web.archive.org、百度百科(403);
- 无人值守轮次浏览器不可用,验证口径 = pnpm build + next start + curl(memory 已记)。
