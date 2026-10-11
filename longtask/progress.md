STATUS: RUNNING

## 已完成

- 阶段一 MVP 全部完成并上线(localhost:3000):Cesium 三维地球(阵营色疆域/行军线/事件点/点选转镜)+ 知识图谱(156 人 205 关系)+ 数据溯源(事件卡出处栏),用户已放行进入阶段二("先把数据补齐",UI 风格问题留阶段三)
- 知识库(WeKnora,Docker):顾诚《南明史》全本 239 万字解析+向量化完成,检索质量验证通过;bge-m3/qwen3:4b 已绑定;凭据 scripts/kb/.env.local
- PG 数据层(atlas-pg,:5433):22 张表就绪;第一、二章试点入库 104 人/43 事件/102 关系/246 citations
- 管线脚本全链路实测:切章→抽取(强制引文)→insert-candidates(暂存+校验)→promote(转正+citations)→export(去重导出 data/kb-*.json)→lib/data.ts+graph.ts 前端合并
- Cesium 1.140 集成:GlobeView 重写,prebuild 拷贝静态资源,懒加载 chunk,首载 160KB
- 【阶段二进展】全书 32 章已一次性切分到 /tmp/nanming-extract/chNN.txt(注意:此目录重启会丢,重切脚本思路在 task.md 执行手册第 1 条)
- 【阶段二批次 A】第三、四章抽取完成并入库:新增 33 事件/35 人物/42 关系
- 【阶段二批次 B】第五、六章抽取完成并入库:新增 33 事件/30 人物/40 关系(南渡三案/睢州之变/扬州十日/弘光被俘/潞王降清/剃发令/圈地投充逃人法)
- 【阶段二批次 C】第七章(江南抗清:江阴/嘉定/昆山/太湖/英霍/皖南/陕西)完成并入库:新增 19 事件/26 人物/30 关系
- 已落盘:export+data:build+pnpm build 全过;站点数据随导出更新
- 当前累计 **195 人 / 128 事件 / 213 关系 / 541 citations**,0 被拒;下一步:批次 D(第八、九章)

## 事故记录(2026-10-11 14:00)
- 续跑器第一轮(无头会话 zcode-cli PID 44359)在用户叫停后被发现仍在抢跑:已插入第三~六章数据(批次5-8,质量抽查合格,引文覆盖率100%),另违规下载 GGUF 模型已删。进程已全部终止,写入已停止。
- 【数据质量遗留】无头轮次部分日精度事件把农历日直接当公历日(偏差约25天),阶段三统一校核修正。

## 下一步

1. **第五章起逐章抽取至第三十二章**(每 1–2 章一批:读 /tmp/nanming-extract/chNN.txt→候选 JSON→insert→accept→promote);第三、四章已完成(批次 A)
2. 每 2–3 章落盘一次:export → data:build(路线/断面)→ pnpm build → next start → curl → **更新本文件**
3. 行军路线补 6–15 条(campaign-routes.json)、疆域断面加密 10→15+(regime-snapshots.json)
4. 全部完成:最终计数(事件/人物/关系/路线/断面)写入"已完成",第一行改 STATUS: DONE
5. 可选(时间富余):公版古籍经 VPN 导入 WeKnora 作校订层
