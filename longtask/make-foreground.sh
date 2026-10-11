#!/bin/bash
# 把本工作区未进 ZCode 任务索引的会话补登到前台任务列表（tasks-index.sqlite）。
# 用途：后台应急运行产生的新会话（接力会话）默认只存在于会话库，
# ZCode 应用的项目列表读的是 tasks-index，不会自动收录——本脚本完成"转前台"。
# 用法：longtask/make-foreground.sh   （幂等，重复执行只补缺）
WS="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
DB="$HOME/.zcode/cli/db/db.sqlite"
TI="$HOME/.zcode/v2/tasks-index.sqlite"
MODEL="${LT_MODEL:-c376d1b9-371a-4172-a4b8-bdf985d33e76/GLM-5.3-Flash-Geovis}"
PROVIDER="${LT_PROVIDER:-glm}"

LT_WS="$WS" LT_DB="$DB" LT_TI="$TI" LT_MODEL="$MODEL" LT_PROVIDER="$PROVIDER" python3 - <<'PYEOF'
import json, os, sqlite3, sys, time

ws   = os.environ['LT_WS']
name = os.path.basename(ws)
db   = sqlite3.connect(f"file:{os.environ['LT_DB']}?mode=ro", uri=True, timeout=5)
ti   = sqlite3.connect(os.environ['LT_TI'], timeout=10)

# 任务整体状态：看 progress.md
status = 'completed'
prog = os.path.join(ws, 'longtask', 'progress.md')
try:
    head = open(prog, encoding='utf-8').readline().strip().upper()
    status = 'running' if 'RUNNING' in head else 'completed'
except Exception:
    pass

rows = db.execute(
    "SELECT id, title, time_created, time_updated, trace_id, title_source "
    "FROM session WHERE directory=? AND task_type='interactive' "
    "ORDER BY time_updated DESC LIMIT 20", (ws,)).fetchall()

inserted, skipped = [], 0
for sid, title, tc, tu, trace, tsrc in rows:
    if ti.execute("SELECT 1 FROM tasks WHERE task_id=?", (sid,)).fetchone():
        skipped += 1
        continue
    trace = trace or ''
    model = os.environ['LT_MODEL']
    meta = {"taskId": sid, "traceId": trace, "title": title,
            "titleOverridden": tsrc == 'custom', "workspacePath": ws,
            "createdAt": tc, "updatedAt": int(time.time()*1000), "mode": "yolo", "model": model,
            "thoughtLevel": "max", "provider": os.environ['LT_PROVIDER'],
            "status": status, "target": None}
    for attempt in range(3):
        try:
            ti.execute(
                "INSERT INTO tasks (workspace_key, workspace_path, workspace_identity,"
                " task_id, title, task_status, provider, mode, model, migration_source,"
                " forked_from_task_id, created_at, updated_at, unread_at, pinned,"
                " archived, deleted, title_overridden, meta_json, searchable_text,"
                " last_unread_at, cron_automation_id, off_peak_task_id)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (ws, ws, None, sid, title, status, os.environ['LT_PROVIDER'],
                 "yolo", model, None, '', tc, int(time.time()*1000), 0, 0, 0, 0,
                 1 if tsrc == 'custom' else 0,
                 json.dumps(meta, ensure_ascii=False), title, 0, '', ''))
            ti.commit()
            inserted.append(f"{title} ({sid[:20]}…)")
            break
        except sqlite3.OperationalError as e:
            if 'locked' in str(e) and attempt < 2:
                time.sleep(1)
            else:
                print(f"写入失败 {sid}: {e}", file=sys.stderr)

print(f"[{name}] 补登 {len(inserted)} 个会话到 ZCode 任务列表"
      f"{'：' + '；'.join(inserted) if inserted else ''}（已存在跳过 {skipped} 个）")
PYEOF
