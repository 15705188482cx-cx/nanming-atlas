#!/bin/bash
# 分离启动长任务续跑器（macOS 版，等价于 Windows 的 start-detached.vbs）。
# 立即返回，不阻塞当前会话；日志见 longtask/supervisor.log 与 longtask/detached.log。
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${LT_DIR:-$DIR}"
nohup /bin/bash "$DIR/run-longtask.sh" >> "$LOG_DIR/detached.log" 2>&1 &
echo "续跑器已后台启动（PID $!）。日志: $LOG_DIR/supervisor.log"
