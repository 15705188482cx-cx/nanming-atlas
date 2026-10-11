#!/bin/bash
# 长任务看门狗（配合 launchd 每 60s 调用一次）：
#   progress.md 为 RUNNING、本工作区没有续跑器在跑、且未被 STOP 拦住时，
#   自动拉起续跑器。熔断后进入冷却（默认 10 分钟），到期自动复工——
#   全程无需任何人工操作；唯一人工开关是 touch longtask/STOP。
DIR="$(cd "$(dirname "$0")" && pwd)"
PROGRESS="$DIR/progress.md"
STOP="$DIR/STOP"
BREAKER="$DIR/BREAKER"
COOLDOWN="${LT_WATCHDOG_COOLDOWN:-600}"

[ -f "$STOP" ] && exit 0
[ -f "$DIR/PAUSED" ] && exit 0   # 用户已暂停：不自动复工，直到看板/手动「继续」
grep -qi '^STATUS:[[:space:]]*RUNNING' "$PROGRESS" 2>/dev/null || exit 0

# 熔断冷却：BREAKER 后 COOLDOWN 秒内不重启，到期自动复工（无需人工改任何文件）
if [ -f "$BREAKER" ]; then
  bmt=$(stat -f %m "$BREAKER" 2>/dev/null || echo 0)
  now=$(date +%s)
  [ $(( now - bmt )) -lt "$COOLDOWN" ] && exit 0
fi

# 已有续跑器在跑（限定本工作区，或锁文件健在）就不动
for pid in $(pgrep -f "run-longtask\.sh" 2>/dev/null); do
  if ps -o command= -p "$pid" 2>/dev/null | grep -q "$DIR"; then
    exit 0
  fi
done
if [ -f "$DIR/.lock/pid" ] && kill -0 "$(cat "$DIR/.lock/pid" 2>/dev/null)" 2>/dev/null; then
  exit 0
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 看门狗拉起续跑器" >> "$DIR/watchdog.log"
nohup /bin/bash "$DIR/run-longtask.sh" >> "$DIR/detached.log" 2>&1 &

# 顺手刷新状态页（status.html，浏览器 30 秒自动刷新读取）
"$DIR/status.sh" >/dev/null 2>&1 &
