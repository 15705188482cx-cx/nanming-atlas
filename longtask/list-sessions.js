#!/usr/bin/env node
/**
 * 列出最近的 ZCode 会话（用于"恢复卡住的旧会话"时查找会话ID）。
 * 用法：node list-sessions.js [条数=10] [目录过滤]
 * 实现：sqlite3 CLI 静态 SQL（命令行零外部输入），目录过滤在 JS 侧完成。
 */
const { execFileSync } = require("child_process");
const os = require("os");
const path = require("path");

const DB = path.join(os.homedir(), ".zcode/cli/db/db.sqlite");
const n = parseInt(process.argv[2] || "10", 10) || 10;
const dirFilter = process.argv[3];

// 静态 SQL：不含任何外部输入；目录过滤在 JS 侧完成
const SQL =
  "SELECT id, title, directory, task_type, " +
  "datetime(time_created/1000,'unixepoch','localtime') AS created, " +
  "datetime(time_updated/1000,'unixepoch','localtime') AS updated " +
  "FROM session WHERE task_type='interactive' " +
  "ORDER BY time_updated DESC LIMIT 500";

let rows = [];
try {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", DB, SQL], {
    maxBuffer: 64 * 1024 * 1024,
  }).toString();
  rows = raw.trim() ? JSON.parse(raw) : [];
} catch (e) {
  console.error("读取会话库失败:", (e.stderr || e.message || "").slice(0, 300));
  process.exit(1);
}

if (dirFilter) rows = rows.filter((r) => (r.directory || "").startsWith(dirFilter));
rows = rows.slice(0, n);

if (rows.length === 0) {
  console.log("(没有会话)");
  process.exit(0);
}

const wId = 38, wTitle = 46, wDir = 34, wTime = 19;
const cut = (s, w) => {
  s = String(s == null ? "" : s);
  let width = 0, out = "";
  for (const ch of s) {
    const cw = /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
    if (width + cw > w) break;
    out += ch;
    width += cw;
  }
  return out + (out.length < s.length ? "…" : "");
};
console.log(
  "ID".padEnd(wId) +
    "  " + "更新时间".padEnd(wTime) +
    "  " + "标题".padEnd(wTitle) +
    "  " + "目录"
);
console.log("-".repeat(wId + wTitle + wDir + wTime + 8));
for (const r of rows) {
  console.log(
    cut(r.id, wId).padEnd(wId) +
      "  " + cut(r.updated, wTime).padEnd(wTime) +
      "  " + cut(r.title, wTitle).padEnd(wTitle) +
      "  " + cut(r.directory, wDir)
  );
}
console.log(`\n共 ${rows.length} 条（库: ${DB}）`);
