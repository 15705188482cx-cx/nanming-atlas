// 检索试跑:S1.3 验证知识库检索质量
// 用法:node scripts/kb/search-test.mjs "桂林之战 李定国"
import { WeKnora } from './weknora.mjs';

const kb = new WeKnora();
const queries = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['桂林之战 李定国', '萨尔浒之战 明军四路', '郑成功 长江 瓜洲 镇江'];

for (const q of queries) {
  console.log(`\n═══ 查询:${q} ═══`);
  try {
    const results = await kb.search(q, { matchCount: 5 });
    results.forEach((r, i) => {
      const text = (r.content || r.text || '').replace(/\s+/g, ' ');
      console.log(`[${i + 1}] score=${(r.score ?? 0).toFixed(3)} doc=${(r.knowledge_title || r.doc_name || '?').slice(0, 24)}`);
      console.log(`    ${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`);
    });
    if (!results.length) console.log('(无结果)');
  } catch (e) {
    console.log('检索失败:', e.message);
  }
}
