# 长任务续跑器（macOS 版）

本目录是 Windows 版 `longtask\` 续跑器的 macOS 移植：在会话外部自动驱动 ZCode
会话执行长任务，断线自动重试；主会话被打死时自动切换备用会话接力，直到
`longtask/progress.md` 出现 `STATUS: DONE` 后弹窗提醒。

## 文件说明

| 文件 | 作用 |
| --- | --- |
| `run-longtask.sh` | 主脚本：轮询驱动会话、失败重试、接力切换、熔断、弹窗 |
| `start-detached.sh` | 分离启动（等价于 Windows 的 `start-detached.vbs`），立即返回 |
| `watch-longtask.sh` | 看门狗：progress 为 RUNNING 且无续跑器在跑时自动拉起（配合 launchd） |
| `list-sessions.js` | 列出最近会话，用于"恢复卡住的旧会话"时查找会话ID |
| `export-history.js` | 导出某会话最近对话为 JSON（接力时重建上下文用） |
| `make-provider-filter.js` | 生成"只含目标网关"的 provider 配置（保证新建备用会话同网关同模型） |
| `task.md` | 任务书（布置任务时由会话内代理写入） |
| `progress.md` | 进度断点（第一行 `STATUS: RUNNING/DONE`，含"已完成/下一步"） |
| `session.txt` | 可选：指定要驱动的会话ID；删除则自动侦测工作区最新会话 |
| `relay.txt` | 备用会话ID（接力时自动写入） |
| `primary-history.json` | 主会话最近对话导出（接力时自动生成） |
| `nudge.txt` | 可选：自定义每轮续跑提示词 |
| `STOP` | 优雅停止开关：`touch longtask/STOP` 即停止 |
| `supervisor.log` / `last-round.log` | 运行日志 / 最近一轮 CLI 输出 |

## 运行机制（与 Windows 版的差异）

- **CLI 调用**：macOS 版 ZCode 不自带独立 `zcode` 命令，续跑器通过
  `ELECTRON_RUN_AS_NODE=1 /Applications/ZCode.app/Contents/MacOS/ZCode
  /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 调用 CLI（需要
  node ≥22 的 `node:sqlite`，系统 node 版本无所谓）。
- **会话存储**：会话与消息在 `~/.zcode/cli/db/db.sqlite`（SQLite），`--resume`
  恢复会话时沿用该会话原模型，主循环不受网关配置影响。
- **新建会话的模型选择**：无头 CLI 新建会话时默认挑个人 provider 列表第一个，
  可能命中失效的 api-key（如 MiniMax）。续跑器启动时从主会话消息里识别
  providerId，生成过滤版配置，经
  `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` + `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`
  传给 CLI，保证备用会话与主会话同网关同模型。桌面应用不受影响。
- **网关检测**：对过滤配置里的 `baseUrl`（如内网网关 `http://10.1.111.154:3011`）
  做 curl 探测；网关不通时等待重试、不计入会话失败。
- **弹窗**：macOS 用 `osascript` 弹对话框（失败则退回通知中心通知）。

## 看门狗（可选，推荐安装）

`watch-longtask.sh` 供 launchd 每 60 秒调用：当 `progress.md` 为 `STATUS: RUNNING`
且本工作区没有续跑器在跑时，自动拉起续跑器——任务"又死了"也会被自动接管。
装法（每工作区一份）：

```bash
# 参照 ~/Library/LaunchAgents/com.zcode.longtask.nanming-atlas.plist 复制改路径后
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.zcode.longtask.<名字>.plist
```

约定：续跑器熔断（备用连败 5 轮 / 累计连败 30 轮）时写 `longtask/BREAKER`，
看门狗在其后 **10 分钟冷却内不重启，到期自动复工**——熔断不是停机，只是歇一口气，
全程无需任何人工操作。彻底停用只有一种方式：`touch longtask/STOP`。
接力建立备用会话后，续跑器会把 `session.txt` 同步为当前驱动会话，
因此续跑器自身重启后也能无缝衔接新对话。

**重要（macOS 隐私限制）**：项目若在 `~/Documents` 等受保护目录，launchd 拉起的
进程默认无权访问（`Operation not permitted`）。需一次性授权：
系统设置 → 隐私与安全性 → 完全磁盘访问权限 → 添加 `/bin/bash`（Cmd+Shift+G 输入
`/bin/bash`）。授权后看门狗才能跨应用退出/重启自动接管。

随时可用 `longtask/status.sh` 查看状态（不依赖 ZCode 界面是否刷新）。

## 失败处理策略

- 单轮失败 → 退避重试（10s→120s）；网关不通 → 60s 后重试（不计数）；
- 单轮内会话 **超过 1800s 无任何库活动**（消息/分片均无更新）视为卡死，强制终止按失败计；
- 主会话 **连续 3 轮失败（不论快慢）且 progress.md 无更新** → 导出主会话最近 60 条
  对话到 `primary-history.json`，新建对话（或恢复 `relay.txt` 中的既有备用会话）交接接力；
- 备用会话连败 5 轮、或任意会话累计连败 30 轮 → 熔断（弹窗提醒），看门狗 10 分钟
  冷却后自动复工，无需人工；单轮超时 3600s 强制终止按失败计。

以上阈值（连败 3 轮触发接力、备用连败 5 轮熔断、卡死 1800s、单轮超时 3600s 等）
均可用 `LT_*` 环境变量覆盖（见 `run-longtask.sh` 头部 CONFIG 区）。

## 查找会话ID

```bash
node longtask/list-sessions.js 10            # 最近 10 条
node longtask/list-sessions.js 20 /Users/chendebiao/ZCodeProject   # 限定工作区
```

## 手动测试建议

```bash
LT_HEADLESS=1 LT_INTERVAL=3 ./longtask/run-longtask.sh   # 前台跑，不弹窗
touch longtask/STOP                                       # 优雅停止
```

## 任务仪表盘（应急后台控制中心）

- 服务：`http://127.0.0.1:8765`（launchd 常驻 `com.zcode.longtask.server`，开机自启）
- 定位：**应急方案**——只承接"上下文爆了/断联跑不下去"的后台任务；两条原则：①无人值守 ②不抢 ZCode 功能
- 左栏分两组：**后台应急任务**（原因徽章 + 暂停/继续/插话/急停/刷新至前台按钮）与**前台会话（ZCode · 只读）**——前台会话无任何控制入口
- 关键时刻（接力/换阶段/熔断/完成）自动弹系统通知 + 浏览器进度页
- 「↗ 刷新至前台」：把后台会话补登进 ZCode 任务列表索引（幂等），接力时也会自动执行
- 事件流：`~/.zcode/longtask-dashboard/runs/<运行ID>/events.jsonl`（运行步骤/时间线数据源）
