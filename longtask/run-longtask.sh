#!/bin/bash
# ============================================================================
# 长任务续跑器（macOS 版）
# 在会话外部反复驱动 ZCode 会话执行 longtask/task.md 中的任务；阶段 DONE 后自动
# 按 README 路线图衔接下一阶段，直到全部完成（或 longtask/STOP）。
#
#   - 普通断线：反复恢复同一会话重试，模型与上下文原样保留（--resume 沿用会话模型）；
#   - 会话持续失败/被打死（重连一直失败、上下文过大触发服务端 500、单轮长时间零活动）：
#     主会话连续 3 轮失败（不论快慢）且 progress.md 无更新时，自动导出主会话最近对话
#     （primary-history.json），新建对话（relay.txt）交接任务接力；
#   - 备用会话连败 5 轮（或累计连败超过上限）才熔断停止并弹窗。
#
# 可用环境变量覆盖默认值（见下方 CONFIG 区），便于测试或定制。
# 优雅停止：touch longtask/STOP，续跑器在下一轮开始前停止并删除该文件。
# ============================================================================
set -u

# 防系统睡眠：整个续跑器跑在 caffeinate 下（挂机过夜不被睡眠打断；LT_NO_CAFFEINATE=1 关闭）
if [ -z "${LT_NO_CAFFEINATE:-}" ] && [ -z "${LT_IN_CAFFEINATE:-}" ] && command -v caffeinate >/dev/null 2>&1; then
  export LT_IN_CAFFEINATE=1
  exec caffeinate -is /bin/bash "$0" "$@"
fi

# ---------------------------- CONFIG ---------------------------------------
# 默认工作区 = 本脚本所在 longtask/ 的父目录（工具目录拷到哪个工作区就服务哪个，
 # 可用 LT_WORKSPACE 覆盖）
WORKSPACE="${LT_WORKSPACE:-$(cd "$(dirname "$0")/.." && pwd)}"
LT_DIR="${LT_DIR:-$WORKSPACE/longtask}"                       # 任务与状态目录
DB="${LT_DB:-$HOME/.zcode/cli/db/db.sqlite}"                  # 会话库
ZCODE_APP="${LT_ZCODE_APP:-/Applications/ZCode.app/Contents/MacOS/ZCode}"
ZCODE_CJS="${LT_ZCODE_CJS:-/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs}"

ROUND_TIMEOUT="${LT_ROUND_TIMEOUT:-3600}"   # 单轮最长秒数，超时杀掉
STUCK_SECONDS="${LT_STUCK_SECONDS:-1800}"  # 单轮内会话无任何库活动超过该秒数视为卡死
INTERVAL="${LT_INTERVAL:-10}"               # 轮间休息秒数
CONSEC_RELAY_LIMIT="${LT_CONSEC_RELAY_LIMIT:-3}" # 主会话连续失败多少轮（不论快慢）切换备用
RELAY_FAIL_LIMIT="${LT_RELAY_FAIL_LIMIT:-5}"     # 备用会话连败多少轮熔断
MAX_CONSEC_FAILS="${LT_MAX_CONSEC_FAILS:-30}"    # 任意会话累计连败熔断上限（熔断=冷却后自动复工）
MAX_ROUNDS="${LT_MAX_ROUNDS:-100000}"            # 总轮数保险（实际到不了）
HISTORY_N="${LT_HISTORY_N:-60}"                  # 导出主会话最近消息条数
GATEWAY_TIMEOUT="${LT_GATEWAY_TIMEOUT:-5}"       # 网关探测超时秒数
HEADLESS="${LT_HEADLESS:-0}"                     # 1=不弹窗（测试用）

TASK_FILE="$LT_DIR/task.md"
PROGRESS_FILE="$LT_DIR/progress.md"
SESSION_FILE="$LT_DIR/session.txt"
RELAY_FILE="$LT_DIR/relay.txt"
STOP_FILE="$LT_DIR/STOP"
PAUSED_FILE="$LT_DIR/PAUSED"
BREAKER_FILE="$LT_DIR/BREAKER"
ONESHOT_FILE="$LT_DIR/oneshot-nudge.txt"
WAITING_FILE="$LT_DIR/WAITING"
CTL_FILE="$HOME/.zcode/longtask-dashboard/controls/$(printf '%s' "$WORKSPACE" | md5 -q).json"
NUDGE_FILE="$LT_DIR/nudge.txt"
TASK_NAME="$(basename "$WORKSPACE")"
RUNS_BASE="$HOME/.zcode/longtask-dashboard/runs"
RUN_ID="$(date '+%Y%m%d-%H%M%S')-$(printf '%s' "$WORKSPACE" | md5 -q | cut -c1-6)"
RUN_DIR="$RUNS_BASE/$RUN_ID"
RUN_EVENTS="$RUN_DIR/events.jsonl"
LOG_FILE="$LT_DIR/supervisor.log"
ROUND_LOG="$LT_DIR/last-round.log"
HISTORY_FILE="$LT_DIR/primary-history.json"
FILTERED_CFG="$LT_DIR/.provider_config.filtered.json"
LOCK_DIR="$LT_DIR/.lock"

LT_TOOLS="$(cd "$(dirname "$0")" && pwd)"

DEFAULT_NUDGE='[无人值守续跑] 继续执行 longtask/task.md 中的任务：先读 longtask/progress.md 了解进度，从"下一步"继续；每完成一步立即更新 progress.md（"已完成"条目写清楚做了什么、产出了哪个文件）。如果任务已全部完成，把 progress.md 第一行改为 STATUS: DONE。不要提问，直接执行。'
RELAY_PROMPT='[无人值守接力] 你是备用接力会话：原会话（主会话）连续失败已无法继续（例如上下文过大触发服务端错误）。请立即读取以下文件重建任务上下文，然后继续完成任务：
1. '"$TASK_FILE"'（任务书）
2. '"$PROGRESS_FILE"'（进度断点，以"已完成/下一步"为准）
3. '"$HISTORY_FILE"'（主会话最近对话导出）
重建后按工作区 AGENTS.md 的"长任务无人值守规则"继续执行直到完成：每完成一步立即更新 progress.md；全部完成后把 progress.md 第一行改为 STATUS: DONE。不要提问，直接执行。'
CHAIN_PROMPT='[无人值守·阶段衔接] 刚完成的阶段已把 longtask/progress.md 标为 DONE。请执行：
1. 读工作区 README 的路线图（Roadmap）和 longtask/task.md，找出下一个未完成的阶段；
2. 有 → 把 longtask/task.md 覆盖为下一阶段的任务书（阶段目标 + 通用约束），把 longtask/progress.md 重置为第一行 STATUS: RUNNING（"已完成"保留一句上阶段完成，"下一步"列出本阶段要点），然后立即开始执行；
3. 没有未完成阶段 → 不要动 progress.md（保持 DONE），在 longtask/task.md 末尾追加一行 <!-- ALL-STAGE-DONE -->。
不要提问，直接执行。'
# ---------------------------------------------------------------------------

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

notify() {
  [ "$HEADLESS" = "1" ] && return 0
  local title="$1" msg="$2"
  local esc="${msg//\\/\\\\}"; esc="${esc//\"/\\\"}"
  ( osascript -e "display dialog \"$esc\" with title \"$title\" buttons {\"好\"} default button 1 giving up after 600" >/dev/null 2>&1 \
    || osascript -e "display notification \"$esc\" with title \"$title\"" >/dev/null 2>&1 ) &
}

# 非阻塞轻提醒（通知中心，不弹对话框）
notify_quiet() {
  [ "$HEADLESS" = "1" ] && return 0
  local title="$1" msg="$2"
  local esc="${msg//\\/\\\\}"; esc="${esc//\"/\\\"}"
  osascript -e "display notification \"$esc\" with title \"$title\"" >/dev/null 2>&1 &
}

# 关键时刻自动在浏览器弹出本任务的进度页（交接/换阶段/熔断/全部完成）
open_page() {
  [ "$HEADLESS" = "1" ] && return 0
  open "$LT_DIR/status.html" >/dev/null 2>&1 &
}

# node 运行时：优先 PATH 里的 node，找不到就用应用自带运行时兜底
NODE_BIN="$(command -v node 2>/dev/null || true)"
node_run() {
  if [ -n "$NODE_BIN" ]; then
    "$NODE_BIN" "$@"
  else
    ELECTRON_RUN_AS_NODE=1 "$ZCODE_APP" "$@"
  fi
}

# CLI 封装：Electron run-as-node 跑 zcode.cjs；用过滤版 provider 配置保证
# 新建会话与主会话同网关同模型。
zc() {
  local envs=(ELECTRON_RUN_AS_NODE=1)
  if [ -f "$FILTERED_CFG" ] && [ -f "$BUILTIN_CFG" ]; then
    envs+=("ZCODE_PERSONAL_PROVIDER_CONFIG_FILE=$FILTERED_CFG"
           "ZCODE_BUILTIN_PROVIDER_CONFIG_FILE=$BUILTIN_CFG")
  fi
  env "${envs[@]}" "$ZCODE_APP" "$ZCODE_CJS" "$@"
}

sql_q() { /usr/bin/sqlite3 "$DB" "$1" 2>/dev/null; }

esc_sql() { printf "%s" "$1" | sed "s/'/''/g"; }

md5() { md5 -q "$1" 2>/dev/null || echo "none"; }

# 结构化事件流：时间线与"运行步骤"的数据源
append_event() { # $1=type $2=msg [$3=files JSON 数组字符串]
  [ -d "$RUN_DIR" ] || return 0
  node_run -e '
    const fs=require("fs");
    const [f,type,msg,round,files]=process.argv.slice(1);
    const o={tse:Date.now(),ts:new Date().toLocaleString("sv-SE"),
      type:String(type),msg:String(msg||""),round:Number(round||0)};
    if (files) { try { const a=JSON.parse(files); if (a.length) o.files=a; } catch(e) {} }
    fs.appendFileSync(f,JSON.stringify(o)+"\n");
  ' "$RUN_EVENTS" "$1" "${2:-}" "${round:-0}" "${3:-}" 2>>"$LOG_FILE" || true
}

# 运行登记：写入 meta，供总看板/监听台索引
register_run() {
  mkdir -p "$RUN_DIR"
  LT_WS="$WORKSPACE" LT_RUNMETA="$RUN_DIR/meta.json" python3 - 2>>"$LOG_FILE" <<'PYMETA'
import json, os, datetime
ws = os.environ["LT_WS"]
json.dump({"run_id": os.path.basename(os.path.dirname(os.environ["LT_RUNMETA"])),
           "ws": ws, "name": os.path.basename(ws),
           "started": datetime.datetime.now().strftime("%F %T")},
          open(os.environ["LT_RUNMETA"], "w", encoding="utf-8"), ensure_ascii=False)
PYMETA
  log "运行已登记: $RUN_ID"
}

# 会话最近一次库活动时间（消息或正文分片），用于卡死检测
db_activity() {
  sql_q "SELECT MAX(t) FROM (SELECT MAX(time_updated) AS t FROM message WHERE session_id='$(esc_sql "$1")' UNION ALL SELECT MAX(time_updated) FROM part WHERE session_id='$(esc_sql "$1")')"
}

# 本轮改动文件清单：从轮次时间窗内的 Edit/Write 工具调用提取
extract_round_files() { # $1=起始毫秒
  /usr/bin/sqlite3 -json "$DB" "SELECT p.data AS d FROM message m JOIN part p ON p.message_id=m.id WHERE m.session_id='$(esc_sql "$SID")' AND m.time_updated >= $1 AND p.data LIKE '%file_path%' ORDER BY p.time_updated ASC" 2>/dev/null | python3 -c '
import json, sys
files = []
for r in json.load(sys.stdin):
    try:
        d = json.loads(r["d"])
    except Exception:
        continue
    if d.get("type") != "tool":
        continue
    name = d.get("toolName") or (d.get("tool") or {}).get("name") or ""
    if name not in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        continue
    st = d.get("state") or {}
    inp = st.get("input") or d.get("input") or {}
    fp = inp.get("file_path") or inp.get("notebook_path") or ""
    if fp and fp not in files:
        files.append(fp)
print(json.dumps(files, ensure_ascii=False))'
}

# 卡点检测：最后一轮代理是否在等待用户回答（AskUserQuestion 无头失败）
check_waiting() {
  /usr/bin/sqlite3 -json "$DB" "SELECT p.data AS d FROM message m JOIN part p ON p.message_id=m.id WHERE m.session_id='$(esc_sql "$SID")' AND m.data LIKE '%\"role\":\"assistant\"%' ORDER BY m.sequence DESC, p.sequence DESC LIMIT 8" 2>/dev/null | python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit(1)
for r in rows:
    try:
        d = json.loads(r["d"])
    except Exception:
        continue
    if d.get("type") == "text" and d.get("text"):
        t = d["text"]
        if "No permission client configured for AskUserQuestion" in t:
            print(t)
            sys.exit(0)
        sys.exit(1)
sys.exit(1)'
}

# 让渡保险丝：最新 user 消息是否为 ZCode 前台的外来输入（排除自动消息与自己所发）
latest_foreign_msg() {
  /usr/bin/sqlite3 -json "$DB" "SELECT p.data AS d FROM message m JOIN part p ON p.message_id=m.id WHERE m.session_id='$(esc_sql "$1")' AND m.data LIKE '%\"role\":\"user\"%' ORDER BY m.sequence DESC, p.sequence DESC LIMIT 4" 2>/dev/null | python3 -c '
import json, sys, os
last = os.environ.get("LT_LAST_PROMPT", "")
try:
    rows = json.load(sys.stdin)
except Exception:
    sys.exit(0)
txt = ""
for r in rows:
    try:
        d = json.loads(r["d"])
    except Exception:
        continue
    if isinstance(d.get("content"), list):
        for c in d["content"]:
            if isinstance(c, dict) and c.get("type") == "text":
                txt += c.get("text", "")
    if isinstance(d.get("content"), str):
        txt += d["content"]
    if txt.strip():
        break
txt = txt.strip()
if not txt or txt == last.strip():
    sys.exit(0)
auto = ("<task-notification>", "<system-reminder>", "The TodoWrite tool",
        "<in-app-browser-context>", "UserPromptSubmit hook", "[无人值守")
for a in auto:
    if txt.startswith(a):
        sys.exit(0)
print(txt[:200])
'
}

# 最近一次更新于工作区的交互会话（即"当前会话"）
latest_session() {
  sql_q "SELECT id FROM session WHERE directory='$(esc_sql "$WORKSPACE")' AND task_type='interactive' ORDER BY time_updated DESC LIMIT 1"
}

session_exists() {
  [ "$(sql_q "SELECT COUNT(*) FROM session WHERE id='$(esc_sql "$1")'")" = "1" ]
}

# 会话最后一条带 providerId 的消息 → 目标网关
detect_provider() {
  local sid="$1"
  local data
  data=$(sql_q "SELECT data FROM message WHERE session_id='$(esc_sql "$sid")' AND data LIKE '%providerId%' ORDER BY sequence DESC LIMIT 1")
  [ -z "$data" ] && return 1
  printf "%s" "$data" | node_run -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      try { const j=JSON.parse(s);
        const p = j.providerId || (j.modelSelection && j.modelSelection.providerId);
        if (p) console.log(p);
      } catch (e) {}
    });'
}

gateway_ok() {
  local url
  url=$(node_run -e '
    try { const j=require(process.argv[1]);
      const r=(j.config&&j.config.providerConfigRules&&j.config.providerConfigRules.providerRules||[])[0];
      if (r&&r.config&&r.config.api&&r.config.api.baseUrl) console.log(r.config.api.baseUrl);
    } catch(e) {}' "$FILTERED_CFG" 2>/dev/null)
  [ -z "$url" ] && return 0   # 无法判断时视为可用，靠 CLI 重试兜底
  curl -s -o /dev/null --max-time "$GATEWAY_TIMEOUT" "$url"
}

check_done() { grep -qi '^STATUS:[[:space:]]*DONE' "$PROGRESS_FILE" 2>/dev/null; }

progress_hash() { [ -f "$PROGRESS_FILE" ] && md5 "$PROGRESS_FILE" || echo "none"; }

# 带超时地跑一轮：$1=提示词；返回 0 成功 / 非 0 失败
run_round() {
  local prompt="$1" pid rc=0 waited=0

  append_event "round_start" "$(printf '%s' "$prompt" | head -c 60)"

  # 仅测试用钩子：LT_FAIL_PRIMARY=N → 主会话前 N 轮注入秒败（模拟会话被打死）
  if [ -n "${LT_FAIL_PRIMARY:-}" ] && [ "$SID" = "$PRIMARY_SID" ] && [ "$round" -le "$LT_FAIL_PRIMARY" ]; then
    log "[测试钩子] 注入主会话第 $round 轮秒败"
    echo "simulated fast failure (LT_FAIL_PRIMARY)" > "$ROUND_LOG"
    sleep 1
    return 1
  fi

  LAST_SENT_PROMPT="$prompt"
  zc --resume "$SID" --cwd "$WORKSPACE" -p "$prompt" --mode yolo \
    >"$ROUND_LOG" 2>&1 &
  pid=$!
  # 卡死检测基线：会话库最近一次活动
  local last_act act last_change_ts
  last_act="$(db_activity "$SID")"
  last_change_ts=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    # 急停双通道：HALT 文件，或看板控制信箱里的 halt 指令（轮内立即生效）
    if [ -f "$LT_DIR/HALT" ]; then
      log "急停：终止 CLI 进程 $pid"
      kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      rc=130
      break
    fi
    if [ -f "$CTL_FILE" ] && python3 -c 'import json,sys;sys.exit(0 if json.load(open(sys.argv[1])).get("action")=="halt" else 1)' "$CTL_FILE" 2>/dev/null; then
      log "急停（看板信箱）：终止 CLI 进程 $pid"
      append_event "halt" "看板请求急停（轮内立即生效）"
      kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      rm -f "$CTL_FILE"
      rc=130
      break
    fi
    sleep 5
    waited=$((waited + 5))
    act="$(db_activity "$SID")"
    if [ -n "$act" ] && [ "$act" != "$last_act" ]; then
      last_act="$act"
      last_change_ts=$(date +%s)
    fi
    if [ $(( $(date +%s) - last_change_ts )) -ge "$STUCK_SECONDS" ]; then
      log "轮次卡死（>${STUCK_SECONDS}s 会话无任何库活动），终止 CLI 进程 $pid"
      kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      rc=125
      break
    fi
    if [ "$waited" -ge "$ROUND_TIMEOUT" ]; then
      log "轮次超时（>${ROUND_TIMEOUT}s），终止 CLI 进程 $pid"
      kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      rc=124
      break
    fi
  done
  if [ "$rc" -eq 0 ]; then
    wait "$pid" 2>/dev/null || rc=$?
  fi
  return "$rc"
}

switch_to_relay() {
  log "主会话 $SID 连续 ${consec_fail} 轮失败且 progress.md 无更新 → 新建对话交接任务"

  node_run "$LT_TOOLS/export-history.js" "$SID" "$HISTORY_FILE" "$HISTORY_N" >>"$LOG_FILE" 2>&1 \
    || log "警告：导出主会话历史失败（继续接力）"

  # 已有备用会话（且不是当前会话）则直接恢复；否则新建（新建轮的提示词即接力指令）
  if [ -s "$RELAY_FILE" ]; then
    local rid
    rid="$(tr -d '[:space:]' < "$RELAY_FILE")"
    if [ "$rid" != "$SID" ] && session_exists "$rid"; then
      log "恢复既有备用会话 $rid"
      SID="$rid"
      printf "%s\n" "$SID" > "$SESSION_FILE"
      log "session.txt 已同步为当前驱动会话（续跑器重启后无缝衔接）"
      open_page
      return 0
    fi
    if [ "$rid" = "$SID" ]; then
      log "relay.txt 与当前会话相同，将新建新对话"
    else
      log "relay.txt 中的会话 $rid 不存在，将新建备用会话"
    fi
  fi

  log "新建备用会话（首轮即接力指令）"
  local before_sid
  before_sid="$(latest_session)"
  local bootstrap_rc=0
  zc --cwd "$WORKSPACE" -p "$RELAY_PROMPT" --mode yolo >"$ROUND_LOG" 2>&1 &
  local bpid=$!
  local waited=0
  while kill -0 "$bpid" 2>/dev/null; do
    if [ "$waited" -ge "$ROUND_TIMEOUT" ]; then
      kill "$bpid" 2>/dev/null; sleep 2; kill -9 "$bpid" 2>/dev/null
      wait "$bpid" 2>/dev/null
      bootstrap_rc=124; break
    fi
    sleep 5; waited=$((waited + 5))
  done
  if [ "$bootstrap_rc" -eq 0 ]; then
    wait "$bpid" 2>/dev/null || bootstrap_rc=$?
  fi

  # 无论该轮成败，只要产生了新会话就固定为备用会话，避免反复新建
  local new_sid
  new_sid="$(latest_session)"
  if [ -n "$new_sid" ] && [ "$new_sid" != "$before_sid" ]; then
    printf "%s\n" "$new_sid" > "$RELAY_FILE"
    SID="$new_sid"
    printf "%s\n" "$SID" > "$SESSION_FILE"
    append_event "relay" "前台连续失败转入后台（原因：${LAST_FAIL_MSG:-连续 ${CONSEC_RELAY_LIMIT} 轮失败}）→ 新建对话 ${SID}"
    log "备用会话已建立: ${SID}（首轮退出码 ${bootstrap_rc}）；session.txt 已同步"
    notify_quiet "已由后台接手 ✔" "「${TASK_NAME}」前台连续失败，已转入后台应急运行（原因：${LAST_FAIL_MSG:-连续失败}），前台无需管理。"
    "$LT_TOOLS/make-foreground.sh" "$WORKSPACE" >/dev/null 2>&1 &
    open_page
    return 0
  fi
  log "备用会话建立失败（退出码 ${bootstrap_rc}）"
  return 1
}

# ---------------------------- 启动检查 -------------------------------------
mkdir -p "$LT_DIR"

# 防止双开
if mkdir "$LOCK_DIR" 2>/dev/null; then
  echo $$ > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"; pkill -P $$ caffeinate 2>/dev/null' EXIT
else
  local_pid="$(cat "$LOCK_DIR/pid" 2>/dev/null || echo '?')"
  if [ "$local_pid" != "?" ] && kill -0 "$local_pid" 2>/dev/null; then
    echo "续跑器已在运行（PID ${local_pid}），本次退出。日志: $LOG_FILE"
    exit 1
  fi
  echo "发现残留锁（原进程 $local_pid 已不在），接管继续。"
  rm -rf "$LOCK_DIR"; mkdir "$LOCK_DIR"; echo $$ > "$LOCK_DIR/pid"
  trap 'rm -rf "$LOCK_DIR"' EXIT
fi

touch "$LOG_FILE"
log "============================== 续跑器启动（PID $$）=============================="
log "工作区: $WORKSPACE"

# 防呆保险：没有任务书/进度断点就拒绝启动，防止误指工作区后劫持无关会话
if [ ! -f "$PROGRESS_FILE" ]; then
  log "错误: $PROGRESS_FILE 不存在——先布置任务（写 progress.md）再启动续跑器。拒绝启动。"
  notify "长任务续跑器" "启动被拒绝：longtask/progress.md 不存在。请先布置任务。"
  exit 1
fi

# 网关配置：从主会话模型生成过滤版 provider 配置（新建备用会话时用）
BUILTIN_CFG="$(ls -t "$HOME"/.zcode/v2/runtime/provider/*/*/endpoint-*/zcode-builtin.json 2>/dev/null | head -1)"

# ---------------------------- 会话检测 -------------------------------------
PRIMARY_SID=""
if [ -f "$SESSION_FILE" ]; then
  PRIMARY_SID="$(tr -d '[:space:]' < "$SESSION_FILE")"
  if ! session_exists "$PRIMARY_SID"; then
    log "警告: session.txt 中的会话 $PRIMARY_SID 不在会话库中，改用自动侦测"
    PRIMARY_SID=""
  fi
fi
if [ -z "$PRIMARY_SID" ]; then
  PRIMARY_SID="$(latest_session)"
  if [ -z "$PRIMARY_SID" ]; then
    log "错误: 未能侦测到工作区内的任何会话。请先把会话ID写入 $SESSION_FILE 再启动。"
    notify "长任务续跑器" "未能侦测到会话，已退出。请检查 $SESSION_FILE"
    exit 1
  fi
  log "自动侦测到会话: $PRIMARY_SID"
fi
SID="$PRIMARY_SID"

# 依据主会话模型生成过滤版 provider 配置
PROVIDER_ID="$(detect_provider "$PRIMARY_SID" || true)"
if [ -n "${PROVIDER_ID:-}" ]; then
  if node_run "$LT_TOOLS/make-provider-filter.js" "$PROVIDER_ID" "$FILTERED_CFG" >>"$LOG_FILE" 2>&1; then
    log "provider 过滤配置就绪（${PROVIDER_ID}），新建备用会话将使用同一网关"
  fi
else
  log "警告: 未能从主会话识别 providerId，跳过过滤配置（备用会话模型可能与主会话不同）"
fi

NUDGE="$DEFAULT_NUDGE"
[ -f "$NUDGE_FILE" ] && NUDGE="$(cat "$NUDGE_FILE")"

register_run
append_event "run_start" "续跑器启动（会话 ${SID}）"

log "轮次上限 ${MAX_ROUNDS}，单轮超时 ${ROUND_TIMEOUT}s，卡死判定 ${STUCK_SECONDS}s 无活动，接力触发：连续 ${CONSEC_RELAY_LIMIT} 轮失败且 progress 无更新（不论快慢）"

# ---------------------------- 主循环 ---------------------------------------
round=0
waiting=0
LAST_SENT_PROMPT=""
consec_fail=0
relay_fail=0
chain_still_done=0
last_progress_hash="$(progress_hash)"

while true; do
  # 刷新状态页 status.html（浏览器打开即看，30 秒自动刷新；后台执行不阻塞）
  "$LT_TOOLS/status.sh" >/dev/null 2>&1 &

  # 处理总看板发来的控制指令（暂停/继续/一次性指令），通过 ~/.zcode 中转，无需 TCC
  if [ -f "$CTL_FILE" ]; then
    ctl_action="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("action",""))' "$CTL_FILE" 2>/dev/null)"
    ctl_text="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("text","") or "")' "$CTL_FILE" 2>/dev/null)"
    case "$ctl_action" in
      pause)
        printf '%s\n' "$(date '+%F %T')" > "$PAUSED_FILE"
        touch "$STOP_FILE"
        append_event "paused" "看板请求暂停（当前轮完成后停止）"
        log "看板请求：暂停（当前轮跑完后停止；PAUSED 标记防止看门狗重启）"
        notify_quiet "长任务已暂停" "当前轮完成后不再开启新轮。可在总看板点「继续」恢复。"
        ;;
      resume)
        rm -f "$STOP_FILE" "$PAUSED_FILE" "$LT_DIR/HALT"
        append_event "resumed" "看板请求继续（清除 PAUSED/STOP/HALT）"
        log "看板请求：继续（清除 PAUSED/STOP）"
        ;;
      halt)
        touch "$LT_DIR/HALT"
        append_event "halt" "看板请求急停（立即终止当前轮）"
        log "看板请求：急停（将立即终止当前轮）"
        ;;
      nudge)
        if [ -n "$ctl_text" ]; then
          printf '%s\n' "$ctl_text" > "$ONESHOT_FILE"
          log "看板请求：下一轮使用用户指令作为提示词"
        fi
        ;;
    esac
    rm -f "$CTL_FILE"
  fi

  # 让渡保险丝：检测 ZCode 侧外来用户消息（人已在前台接管）→ 让位
  if [ "$waiting" = "0" ] && [ -n "$LAST_SENT_PROMPT" ]; then
    LT_LAST_PROMPT="$LAST_SENT_PROMPT" FOREIGN="$(latest_foreign_msg "$SID")"
    if [ -n "$FOREIGN" ]; then
      touch "$PAUSED_FILE"
      append_event "yield" "检测到前台接手（ZCode 侧新消息），续跑器让位"
      log "让渡：检测到 ZCode 侧外来消息（${FOREIGN:0:60}…），续跑器停止调度"
      notify_quiet "后台已让位" "「${TASK_NAME}」检测到你在 ZCode 接手，续跑器已停止调度。"
      open_page
      exit 0
    fi
  fi

  # 卡点等待：代理在等回答时停止调度，只消费回答/控制指令
  if [ "$waiting" = "1" ]; then
    if [ -s "$ONESHOT_FILE" ]; then
      PROMPT_ANSWER="$(cat "$ONESHOT_FILE")"
      rm -f "$ONESHOT_FILE"
      waiting=0
      rm -f "$WAITING_FILE"
      append_event "answered" "收到回答：${PROMPT_ANSWER:0:60}"
      log "收到看板回答，继续任务"
    else
      # 等待状态下同样响应 停止/急停/暂停
      if [ -f "$STOP_FILE" ]; then
        rm -f "$STOP_FILE" "$WAITING_FILE"
        "$LT_TOOLS/status.sh" >/dev/null 2>&1
        log "等待回答状态收到 STOP，续跑器停止。"
        notify "长任务续跑器" "续跑器已停止（卡点等待中被手动停止）。"
        exit 0
      fi
      if [ -f "$LT_DIR/HALT" ]; then
        rm -f "$LT_DIR/HALT" "$WAITING_FILE"
        "$LT_TOOLS/status.sh" >/dev/null 2>&1
        log "等待回答状态收到急停，续跑器停止。"
        notify "长任务已急停" "卡点等待中被急停。删除 longtask/HALT 或看板「继续」可复工。"
        exit 0
      fi
      if [ -f "$PAUSED_FILE" ]; then
        rm -f "$WAITING_FILE"
        "$LT_TOOLS/status.sh" >/dev/null 2>&1
        log "等待回答状态收到暂停，续跑器停止调度。"
        notify_quiet "长任务已暂停" "卡点等待中被暂停。看板「继续」可恢复。"
        exit 0
      fi
      "$LT_TOOLS/status.sh" >/dev/null 2>&1 &
      log "等待回答中（每 15s 检查）…"
      sleep 15
      continue
    fi
  fi

  # 优雅停止
  if [ -f "$STOP_FILE" ]; then
    rm -f "$STOP_FILE"
    "$LT_TOOLS/status.sh" >/dev/null 2>&1
    log "检测到 STOP 文件，续跑器停止。"
    notify "长任务续跑器" "续跑器已按 STOP 指令停止。"
    exit 0
  fi

  # 完成判定与自动连跑：DONE 后请求代理按 README 路线图衔接下一阶段；
  # 无未完成阶段（task.md 标记 ALL-STAGE-DONE）才最终退出
  PROMPT="$NUDGE"
  if check_done; then
    if grep -qi 'ALL-STAGE-DONE' "$TASK_FILE" 2>/dev/null; then
      log "路线图全部完成（ALL-STAGE-DONE），续跑器退出。"
      notify "全部阶段完成 ✔" "README 路线图已跑完，请验收成果。"
      open_page
      exit 0
    fi
    log "STATUS: DONE → 自动连跑：请求代理衔接下一阶段"
    notify_quiet "阶段完成，自动衔接" "正在按 README 路线图开启下一阶段。"
    PROMPT="$CHAIN_PROMPT"
  fi

  # 看板一次性指令优先（用户在界面上发的指令）
  if [ -s "$ONESHOT_FILE" ]; then
    PROMPT="$(cat "$ONESHOT_FILE")"
    rm -f "$ONESHOT_FILE"
    log "本轮使用看板发来的用户指令作为提示词"
  fi

  round=$((round + 1))
  if [ "$round" -gt "$MAX_ROUNDS" ]; then
    log "已达轮次上限 ${MAX_ROUNDS}，熔断停止。"
    touch "$BREAKER_FILE"
    notify "长任务续跑器已停止" "已达轮次上限，请回来检查 progress.md 后手动处理。"
    open_page
    exit 1
  fi

  # 网关探测：网络/网关不通时等待重试，不计入会话失败
  if ! gateway_ok; then
    log "网关不可达（provider 配置中的 baseUrl），60s 后重试（第 $round 轮未执行）"
    sleep 60
    round=$((round - 1))
    continue
  fi

  start_ts=$(date +%s)
  run_round "$PROMPT"
  rc=$?
  dur=$(( $(date +%s) - start_ts ))

  # 衔接轮成功的两种去向：开启下一阶段 / 代理确认全部完成。
  # 完成与否只认代理显式写入的 ALL-STAGE-DONE 标记；续跑器不自行下结论，
  # 代理若结束了回合却没写标记，就再追问（衔接轮会自然重复），连续 3 次才保守收尾。
  if [ "$rc" -eq 0 ] && [ "$PROMPT" = "$CHAIN_PROMPT" ]; then
    if check_done; then
      if grep -qi 'ALL-STAGE-DONE' "$TASK_FILE" 2>/dev/null; then
        append_event "all_done" "路线图全部完成"
        log "代理确认路线图全部完成（ALL-STAGE-DONE），续跑器退出。"
        notify "全部阶段完成 ✔" "README 路线图已跑完，请验收成果。"
        open_page
        exit 0
      fi
      chain_still_done=$((chain_still_done + 1))
      if [ "$chain_still_done" -ge 3 ]; then
        log "连续 ${chain_still_done} 轮衔接后仍为 DONE 且无标记，保守判定全部完成。"
        printf '\n<!-- ALL-STAGE-DONE: %s -->\n' "$(date '+%F %T')" >> "$TASK_FILE"
        notify "全部阶段完成 ✔" "README 路线图已跑完，请验收成果。"
        open_page
        exit 0
      fi
      log "衔接轮结束仍为 DONE（第 ${chain_still_done} 次）且无标记 → 继续请求代理复核路线图"
      consec_fail=0; relay_fail=0
      sleep "$INTERVAL"
      continue
    fi
    chain_still_done=0
    append_event "stage" "进入下一阶段"
    open_page
    log "第 $round 轮衔接成功（耗时 ${dur}s）→ 已进入下一阶段"
    open_page
    consec_fail=0; relay_fail=0
    last_progress_hash="$(progress_hash)"
    sleep "$INTERVAL"
    continue
  fi

  if [ "$rc" -eq 0 ]; then
    chain_still_done=0
    append_event "round_ok" "第 ${round} 轮完成（${dur}s）" "$(extract_round_files "$((start_ts * 1000))")"
    log "第 $round 轮成功（会话 ${SID}，耗时 ${dur}s）"
    WAIT_TEXT="$(check_waiting)"
    if [ -n "$WAIT_TEXT" ]; then
      waiting=1
      printf '%s' "$WAIT_TEXT" > "$WAITING_FILE"
      append_event "wait_answer" "代理卡点等待回答"
      notify_quiet "任务卡点等待回答" "「${TASK_NAME}」代理在等待你的选择/回答，看板可处理。"
      log "卡点：代理等待回答（已写入看板）"
    else
      rm -f "$WAITING_FILE"
    fi
    consec_fail=0; relay_fail=0
    last_progress_hash="$(progress_hash)"
    sleep "$INTERVAL"
    continue
  fi

  # 急停：立即退出，且保留 HALT 防看门狗复工
  if [ "$rc" -eq 130 ]; then
    append_event "halted" "急停生效，续跑器退出"
    log "急停生效，续跑器退出（HALT 保留；删除 longtask/HALT 或看板点「继续」方可复工）"
    notify "长任务已急停" "任务已按急停指令终止。看板点「继续」或删除 longtask/HALT 复工。"
    open_page
    exit 1
  fi

  # ---- 失败处理 ----
  consec_fail=$((consec_fail + 1))
  LAST_FAIL_MSG="$(tail -30 "$ROUND_LOG" 2>/dev/null | grep -aoiE 'invalid api key|context (length|too large)|too many tokens|server error|ECONNRESET|ETIMEDOUT|ECONNREFUSED|fetch failed|operation not permitted|invalid request|rate limit' | head -1)"
  if [ -z "$LAST_FAIL_MSG" ]; then
    if [ "$rc" = "124" ]; then LAST_FAIL_MSG="单轮超时(${ROUND_TIMEOUT}s)"
    else LAST_FAIL_MSG="退出码 ${rc}"; fi
  fi
  [ "$rc" = "130" ] && LAST_FAIL_MSG="急停"
  append_event "round_fail" "第 ${round} 轮失败（${LAST_FAIL_MSG}，${dur}s，连败 ${consec_fail}）"
  log "第 $round 轮失败（会话 ${SID}，退出码 ${rc}，耗时 ${dur}s，连败 ${consec_fail}）"

  # 失败分类：主会话统计连续失败（触发接力），备用会话统计连败（触发熔断）。
  # progress.md 有更新说明代理仍活着，连败重记起点；不论失败快慢都计数。
  if [ "$SID" = "$PRIMARY_SID" ]; then
    cur_hash="$(progress_hash)"
    if [ "$cur_hash" != "$last_progress_hash" ]; then
      last_progress_hash="$cur_hash"
      consec_fail=1
      log "检测到 progress.md 有更新，连败计数重记（当前会话仍在取得进展）"
    fi
  else
    relay_fail=$((relay_fail + 1))
  fi

  # 会话切换 / 熔断判定
  if [ "$SID" = "$PRIMARY_SID" ] && [ "$consec_fail" -ge "$CONSEC_RELAY_LIMIT" ]; then
    if switch_to_relay; then
      relay_fail=0
      consec_fail=0
      continue
    fi
  elif [ "$SID" != "$PRIMARY_SID" ] && [ "$relay_fail" -ge "$RELAY_FAIL_LIMIT" ]; then
    log "备用会话连败 $relay_fail 轮，熔断冷却（看门狗 10 分钟后自动复工）。"
    touch "$BREAKER_FILE"
    notify "长任务续跑器熔断" "备用会话连续失败 ${relay_fail} 轮，10 分钟后自动复工重试。"
    open_page
    exit 1
  fi

  if [ "$consec_fail" -ge "$MAX_CONSEC_FAILS" ]; then
    append_event "breaker" "累计连败 ${consec_fail} 轮熔断（10 分钟后自动复工）"
    log "累计连败 $consec_fail 轮，熔断冷却（看门狗 10 分钟后自动复工）。"
    touch "$BREAKER_FILE"
    notify "长任务续跑器熔断" "连续失败 $consec_fail 轮，10 分钟后自动复工重试（可能为登录失效等环境问题）。"
    open_page
    exit 1
  fi

  # 失败退避：10s 起步，最长 120s
  backoff=$(( INTERVAL * (consec_fail < 4 ? consec_fail : 4) ))
  [ "$backoff" -lt 10 ] && backoff=10
  [ "$backoff" -gt 120 ] && backoff=120
  sleep "$backoff"
done
