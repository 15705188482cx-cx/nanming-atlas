

## 日期不确定度设计(2026-10-12 凌晨,用户确认)
- **三种日期格式入表**(pub.events):date_format ∈ exact/range/multi + date_claims jsonb(各源互斥说法全录,不猜不总结)
  - exact=单一公历日(现状默认);range=date_start~date_end 为"不确定窗口"(非事件跨度,城破具体日不可考时不猜);multi=多说并存(date=主采说法,claims 存全部)
- 种子数据:永历殉国=multi(主采 06-11 顾诚考订+洪业;另说 06-01 四月十五望日通行说);广宁之败=range 1622-02-10~03-11(洪业原文明示窗口)
- 穿线:export.mjs 导出 date_format/date_claims→kb-events;手建 raw 支持 dateFormat/dateClaims/endDate;types.ts AtlasEvent 增补;build-data 展开透传;build✓ 站点200
- 后续抽取规范:《小腆纪传》等批次遇日期分歧一律记 multi(claims 带出处),遇"只能确定到一段"记 range——不再用"保留原值+口头注明"的方式