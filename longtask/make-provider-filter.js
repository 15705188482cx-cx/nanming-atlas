#!/usr/bin/env node
/**
 * 生成"过滤版"个人 provider 配置：只保留指定 providerId 的规则。
 * 背景：无头 CLI 新建会话时会按个人 provider 配置列表挑默认 provider，
 * 若列表里有失效的 api-key provider（如 MiniMax），新会话会打错网关。
 * 续跑器用本脚本生成只含目标网关的配置，并通过
 *   ZCODE_PERSONAL_PROVIDER_CONFIG_FILE / ZCODE_BUILTIN_PROVIDER_CONFIG_FILE
 * 传给 CLI，保证新建的接力会话与主会话使用同一网关和模型。
 *
 * 用法：node make-provider-filter.js <providerId|keep-all> <输出文件>
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

const [providerId, outPath] = process.argv.slice(2);
if (!providerId || !outPath) {
  console.error("用法: node make-provider-filter.js <providerId|keep-all> <输出文件>");
  process.exit(2);
}

const SRC = process.env.LT_PROVIDER_CONFIG || path.join(os.homedir(), ".zcode/v2/provider_config.json");

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(SRC, "utf8"));
} catch (e) {
  console.error("读取 provider 配置失败:", e.message);
  process.exit(1);
}

const rules = cfg?.config?.providerConfigRules?.providerRules || [];
if (providerId !== "keep-all") {
  const keep = rules.filter((r) => r.providerId === providerId);
  if (keep.length === 0) {
    console.error(`未找到 providerId=${providerId}，保留全部规则作为兜底`);
  } else {
    cfg.config = {
      ...cfg.config,
      providerConfigRules: { ...cfg.config.providerConfigRules, providerRules: keep },
    };
  }
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(cfg, null, 1));
const kept = cfg.config.providerConfigRules.providerRules
  .map((r) => `${r.providerName}(${r.providerId})`)
  .join(", ");
console.log(`过滤版 provider 配置已生成: ${outPath}（保留: ${kept || "无"}）`);
