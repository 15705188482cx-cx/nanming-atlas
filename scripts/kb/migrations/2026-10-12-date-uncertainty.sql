-- 日期不确定度设计(2026-10-12 用户确认)——三种格式:
--   exact: 单一公历日(现状,默认)
--   range: 区间。统计不出具体日,不猜测: date_start~date_end 为"不确定窗口"(非事件跨度)
--   multi: 多说并存。各源冲突时把全部说法记入 date_claims,不猜不总结;
--          date_start = 主采说法(有文献依据 adjudicated)或最早候选(未决)
BEGIN;

ALTER TABLE pub.events ADD COLUMN IF NOT EXISTS date_format text NOT NULL DEFAULT 'exact'
  CHECK (date_format IN ('exact','range','multi'));
COMMENT ON COLUMN pub.events.date_format IS '日期不确定度: exact=单一公历日 / range=date_start~date_end为不确定窗口(非事件跨度) / multi=多说并存(date_claims)';

ALTER TABLE pub.events ADD COLUMN IF NOT EXISTS date_claims jsonb;
COMMENT ON COLUMN pub.events.date_claims IS 'multi 用: [{"date":"1662-06-11","basis":"顾诚考订,引庭闻录/求野录等五种均记四月廿五","source":"gucheng-nanmingshi"},...]';

-- 已知多说公案回填: 永历殉国(顾诚+洪业 06-11 主采 vs 通行四月十五说 06-01)
UPDATE pub.events SET date_format='multi',
  date_claims='[{"date":"1662-06-11","basis":"顾诚考订:庭闻录/求野录/狩缅纪事等五种均记四月二十五日;洪业同记6月11日","source":"gucheng-nanmingshi+wakeman-hongye"},{"date":"1662-06-01","basis":"通行说:四月十五望日(维基百科/百度百科)"}]'::jsonb
WHERE id=369;

COMMIT;
