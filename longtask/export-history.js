#!/usr/bin/env node
/**
 * 导出某个会话最近 N 条对话到 JSON 文件（供备用接力会话重建上下文）。
 * 用法：node export-history.js <sessionId> <输出文件> [条数=60]
 * 实现：sqlite3 CLI 静态 SQL 全量拉取（命令行零外部输入），会话过滤与裁剪在 JS 侧完成。
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const [sessionId, outFile, nArg] = process.argv.slice(2);
if (!sessionId || !outFile) {
  console.error("用法: node export-history.js <sessionId> <输出文件> [条数=60]");
  process.exit(2);
}
if (!/^sess_[A-Za-z0-9-]+$/.test(sessionId)) {
  console.error("非法会话 ID:", sessionId);
  process.exit(2);
}
const n = parseInt(nArg || "60", 10) || 60;

const DB = path.join(os.homedir(), ".zcode/cli/db/db.sqlite");
// 静态 SQL：不含任何外部输入；按会话过滤与裁剪在 JS 侧完成
const SQL =
  "SELECT m.id AS mid, m.session_id AS sid, m.data AS mdata, p.data AS pdata " +
  "FROM message m LEFT JOIN part p ON p.message_id = m.id " +
  "ORDER BY m.sequence ASC, p.sequence ASC";

let rows = [];
try {
  const raw = execFileSync("/usr/bin/sqlite3", ["-json", DB, SQL], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();
  rows = raw.trim() ? JSON.parse(raw) : [];
} catch (e) {
  console.error("读取会话库失败:", (e.stderr || e.message || "").slice(0, 300));
  process.exit(1);
}

// 按会话过滤（JS 侧），并按消息聚合分片
const byMsg = new Map();
const roleByMsg = new Map();
const order = [];
for (const r of rows) {
  if (r.sid !== sessionId) continue;
  if (!byMsg.has(r.mid)) {
    byMsg.set(r.mid, []);
    order.push(r.mid);
    try {
      roleByMsg.set(r.mid, JSON.parse(r.mdata).role || "unknown");
    } catch (e) {
      roleByMsg.set(r.mid, "unknown");
    }
  }
  byMsg.get(r.mid).push(r.pdata);
}

function slimPart(pdata) {
  let d;
  try {
    d = JSON.parse(pdata);
  } catch (e) {
    return { type: "unknown" };
  }
  const t = d.type || "unknown";
  if (t === "text" && d.text) return { type: "text", text: d.text.slice(0, 6000) };
  if (t === "thinking" && d.thinking) return { type: "thinking", think: d.thinking.slice(0, 400) };
  if (t === "tool") {
    const name = typeof d.tool === "string" ? d.tool : ((d.tool && d.tool.name) || d.toolName || "tool");
    const input = (d.state && d.state.input) || d.input || {};
    const file = input.file_path || input.notebook_path || "";
    return { type: "tool", tool: name, ...(file ? { file } : {}) };
  }
  return { type: t };
}

const messages = [];
for (const mid of order.slice(-n)) {
  const parts = (byMsg.get(mid) || []).map(slimPart);
  const texts = parts.filter((p) => p.type === "text").map((p) => p.text);
  const tools = parts.filter((p) => p.type === "tool").map((p) => p.tool);
  messages.push({
    mid,
    role: roleByMsg.get(mid) || "unknown",
    ...(texts.length ? { text: texts.join("\n").slice(0, 12000) } : {}),
    ...(tools.length ? { tools } : {}),
  });
}

const out = {
  note: "主会话最近对话导出（由长任务续跑器生成，供接力会话重建上下文）。tools 为该条使用的工具。",
  sessionId,
  exportedAt: new Date().toISOString(),
  count: messages.length,
  messages,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`已导出 ${messages.length} 条消息 → ${outFile}`);
