// WeKnora 知识库客户端(抽取管线用)
// 约定:所有外部输入走参数/表单编码,不拼 URL 查询串以外的东西。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function loadEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, 'scripts/kb/.env.local'), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

export class WeKnora {
  constructor(env = loadEnv()) {
    this.host = (env.WEKNORA_HOST || 'http://127.0.0.1:8080').replace(/\/$/, '');
    this.email = env.WEKNORA_EMAIL;
    this.password = env.WEKNORA_PASSWORD;
    this.kbId = env.WEKNORA_KB_ID;
    this.token = env.WEKNORA_JWT || null;
  }

  async api(method, path, body, retry = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`${this.host}/api/v1${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && retry) { await this.login(); return this.api(method, path, body, false); }
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    return data;
  }

  async login() {
    const res = await fetch(`${this.host}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    const json = await res.json();
    const data = json.data || json;
    this.token = data.token || data.access_token;
    if (!this.token) throw new Error('login: no token in response');
    return this.token;
  }

  /** 混合检索:返回 [{content, score, knowledge_id, chunk_id...}] */
  async search(queryText, { matchCount = 8, knowledgeBaseIds } = {}) {
    const json = await this.api('POST', `/knowledge-bases/${this.kbId}/hybrid-search`, {
      query_text: queryText,
      match_count: matchCount,
      knowledge_base_ids: knowledgeBaseIds ?? [this.kbId],
    });
    const items = json?.data?.results ?? json?.data?.chunks ?? json?.data ?? [];
    return Array.isArray(items) ? items : [];
  }

  async docStatus(docId) {
    const json = await this.api('GET', `/knowledge/${docId}`);
    return json?.data ?? json;
  }
}
