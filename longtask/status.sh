#!/bin/bash
# 长任务状态查看：
#   直接运行 → 终端输出状态摘要
#   副作用 1 → 刷新本任务进度页 longtask/status.html（浏览器打开即看，30 秒自动刷新）
#   副作用 2 → 把本任务登记到总看板 ~/.zcode/longtask-dashboard/dashboard.html
#              （多任务各自一张进度页，看板汇总所有任务，均可自动刷新）
# 续跑器每轮和看门狗都会调用本脚本；关键时刻（交接/换阶段/熔断/完成）会自动弹出进度页。
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="${LT_DB:-$HOME/.zcode/cli/db/db.sqlite}"
WS="$(cd "$DIR/.." && pwd)"
TASK_NAME="$(basename "$WS")"

progress_head="$(head -1 "$DIR/progress.md" 2>/dev/null)"
running=""
for pid in $(pgrep -f "run-longtask\.sh" 2>/dev/null); do
  if ps -o command= -p "$pid" 2>/dev/null | grep -q "$DIR"; then
    running="$pid"
    break
  fi
done

breaker_info=""
if [ -f "$DIR/BREAKER" ]; then
  bmt=$(stat -f %m "$DIR/BREAKER" 2>/dev/null || echo 0)
  breaker_info="$(( ($(date +%s) - bmt) / 60 )) 分钟前熔断，10 分钟冷却后自动复工"
fi

SID="$(tr -d '[:space:]' < "$DIR/session.txt" 2>/dev/null)"
sess_info=""
if [ -n "$SID" ] && [ -f "$DB" ]; then
  ACT=$(/usr/bin/sqlite3 "$DB" "SELECT MAX(t) FROM (SELECT MAX(time_updated) AS t FROM message WHERE session_id='$SID' UNION ALL SELECT MAX(time_updated) FROM part WHERE session_id='$SID')" 2>/dev/null)
  if [ -n "$ACT" ]; then
    sess_info="最后活动 $(date -r $((ACT / 1000)) '+%F %T')（$(( ($(date +%s) - ACT / 1000) / 60 )) 分钟前）"
  fi
fi

export ST_WS="$WS" ST_TASK_NAME="$TASK_NAME" ST_PROGRESS_HEAD="$progress_head" \
       ST_RUNNING="$running" ST_BREAKER="$breaker_info" ST_SID="$SID" \
       ST_SESS="$sess_info" ST_DIR="$DIR" \
       ST_PAUSED="$([ -f "$DIR/STOP" ] || [ -f "$DIR/PAUSED" ] && echo 1 || echo 0)" \
       ST_LOGTAIL="$(tail -5 "$DIR/supervisor.log" 2>/dev/null)"

python3 - <<'PYEOF' 2>/dev/null
import os, html, json, datetime, time
def rd(p, n=None):
    try:
        s = open(p, encoding='utf-8', errors='replace').read()
        return s[:n] if n else s
    except Exception:
        return '(暂无)'
e = html.escape
ws   = os.environ['ST_WS']
name = os.environ['ST_TASK_NAME']
d    = os.environ['ST_DIR']
now  = datetime.datetime.now().strftime('%F %T')

# ---- 1. 本任务进度页 status.html ----
progress = rd(os.path.join(d, 'progress.md'))
task     = rd(os.path.join(d, 'task.md'), 2000)
log      = '\n'.join(rd(os.path.join(d, 'supervisor.log')).splitlines()[-15:])
head     = os.environ.get('ST_PROGRESS_HEAD', '')
color    = '#b45309' if 'DONE' in head else ('#15803d' if 'RUNNING' in head else '#6b7280')
resumer  = ('运行中 (PID %s)' % os.environ['ST_RUNNING']) if os.environ.get('ST_RUNNING') else '未运行（看门狗 60s 内自动拉起）'
page = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="30"><title>进度 · {e(name)}</title>
<style>
body{{font-family:-apple-system,'PingFang SC',sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#1f2937;line-height:1.6}}
h1{{font-size:20px}} .badge{{display:inline-block;padding:4px 14px;border-radius:999px;color:#fff;font-weight:600;background:{color}}}
.card{{background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;margin:12px 0}}
pre{{white-space:pre-wrap;word-break:break-word;font-size:13px;background:#0b1021;color:#d6e2f0;padding:12px;border-radius:8px;overflow-x:auto}}
.k{{color:#6b7280;font-size:13px}} a{{color:#2563eb}}
</style></head><body>
<h1>「{e(name)}」任务进度 <span class="badge">{e(head or '未知')}</span></h1>
<div class="k">自动刷新：30 秒 ｜ 生成时间：{now} ｜ <a href="file:///Users/chendebiao/.zcode/longtask-dashboard/dashboard.html">← 返回总看板</a></div>
<div class="card"><b>续跑器：</b>{e(resumer)}<br>
<b>当前会话：</b>{e(os.environ.get('ST_SID','') or '（未设定）')}<br>
<b>会话活动：</b>{e(os.environ.get('ST_SESS','') or '（暂无）')}<br>
{'<b>熔断：</b>' + e(os.environ['ST_BREAKER']) + '<br>' if os.environ.get('ST_BREAKER') else ''}
<b>工作区：</b>{e(ws)}</div>
<div class="card"><b>任务书（task.md）</b><pre>{e(task)}</pre></div>
<div class="card"><b>进度断点（progress.md）</b><pre>{e(progress)}</pre></div>
<div class="card"><b>最近日志（supervisor.log 末 15 行）</b><pre>{e(log)}</pre></div>
</body></html>"""
open(os.path.join(d, 'status.html'), 'w', encoding='utf-8').write(page)

# ---- 2. 登记到总看板 ----
reg = os.path.expanduser('~/.zcode/longtask-dashboard')
os.makedirs(os.path.join(reg, 'entries'), exist_ok=True)
import hashlib
# 找到本工作区最新的运行（run_id = 时间戳-md5前6位）
runs_base = os.path.join(reg, 'runs')
suffix = hashlib.md5(ws.encode()).hexdigest()[:6]
run_id = ''
try:
    cand = sorted(d for d in os.listdir(runs_base) if d.endswith(suffix))
    if cand:
        run_id = cand[-1]
except Exception:
    pass
entry_path = os.path.join(reg, 'entries', hashlib.md5(ws.encode()).hexdigest() + '.json')
json.dump({
    'name': name, 'ws': ws, 'progress': head, 'progress_full': progress,
    'run_id': run_id,
    'running': bool(os.environ.get('ST_RUNNING')),
    'breaker': os.environ.get('ST_BREAKER', ''),
    'session': os.environ.get('ST_SID', ''),
    'sess_info': os.environ.get('ST_SESS', ''),
    'page': os.path.join(d, 'status.html'),
    'paused': os.environ.get('ST_PAUSED') == '1',
    'log_tail': os.environ.get('ST_LOGTAIL', ''),
    'updated': datetime.datetime.now().strftime('%F %T'),
    'updated_ms': int(time.time() * 1000),
}, open(entry_path, 'w', encoding='utf-8'), ensure_ascii=False)

rows = []
for f in sorted(os.listdir(os.path.join(reg, 'entries'))):
    try:
        t = json.load(open(os.path.join(reg, 'entries', f), encoding='utf-8'))
    except Exception:
        continue
    c = '#b45309' if 'DONE' in t['progress'] else ('#15803d' if 'RUNNING' in t['progress'] else '#6b7280')
    rows.append(
        f"<tr><td><a href=\"file://{e(t['page'])}\">{e(t['name'])}</a></td>"
        f"<td style=\"color:{c};font-weight:600\">{e(t['progress'] or '未知')}</td>"
        f"<td>{'⏸ 已暂停' if t.get('paused') else ('✅ 运行中' if t['running'] else '⏸ 未运行')}</td>"
        f"<td>{e(t['sess_info'] or '')}</td>"
        f"<td class=k>{e(t['ws'])}</td>"
        f"<td class=k>{e(t['updated'])}</td></tr>")
dash = f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta http-equiv="refresh" content="30"><title>长任务总看板</title>
<style>
body{{font-family:-apple-system,'PingFang SC',sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#1f2937;line-height:1.6}}
h1{{font-size:20px}} table{{border-collapse:collapse;width:100%;margin-top:12px}}
td,th{{border:1px solid #e5e7eb;padding:8px 10px;font-size:14px;text-align:left}} th{{background:#f1f5f9}}
.k{{color:#6b7280;font-size:12px}} a{{color:#2563eb}}
</style></head><body>
<h1>长任务总看板</h1>
<div class="k">自动刷新：30 秒 ｜ 生成时间：{now} ｜ 点任务名进入该任务独立进度页</div>
<table><tr><th>任务</th><th>状态</th><th>续跑器</th><th>会话活动</th><th>工作区</th><th>登记时间</th></tr>
{''.join(rows) or '<tr><td colspan=6>（还没有登记的任务）</td></tr>'}</table>
</body></html>"""
open(os.path.join(reg, 'dashboard.html'), 'w', encoding='utf-8').write(dash)
PYEOF

# ---- 终端摘要 ----
echo "== 长任务状态  $(date '+%F %T')"
echo "任务: $TASK_NAME（$WS）"
printf "progress: %s\n" "$progress_head"
if [ -n "$running" ]; then
  echo "续跑器: 运行中 (PID $running)"
else
  echo "续跑器: 未运行（progress 为 RUNNING 时看门狗 60s 内自动拉起）"
fi
[ -n "$breaker_info" ] && echo "熔断: $breaker_info"
if [ -n "$sess_info" ]; then
  echo "当前会话: ${SID}"
  echo "  $sess_info"
fi
echo "本任务进度页: $DIR/status.html"
echo "多任务总看板:   $HOME/.zcode/longtask-dashboard/dashboard.html"
echo "-- 最近日志:"
tail -3 "$DIR/supervisor.log" 2>/dev/null
