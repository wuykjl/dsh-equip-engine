// 从 dshbase 目录提取插件测试状态（verified/npm/needs-build/failed 等）
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) { console.error('用法: node scripts/parse-status.js <dshbase缓存md>'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'data', 'test-status.json');

const md = fs.readFileSync(SRC, 'utf8');
const lines = md.split('\n');
const status = {};
const seen = new Set();

const STATUS_WORDS = ['Verified', 'Install failed', 'needs build', 'needs UI', 'npm', 'GitHub source', 'Load issue'];
const STATUS_MAP = {
  'Verified': 'verified', 'npm': 'npm', 'GitHub source': 'source',
  'needs build': 'needs-build', 'needs UI': 'needs-ui',
  'Install failed': 'failed', 'Load issue': 'load-issue',
};
const BAD = new Set(['com', 'www', 'github', 'dshbase', 'plugins', 'directory', 'http', 'https', 'deepseek', 'ai']);

for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  let found = null;
  for (const w of STATUS_WORDS) {
    if (l.includes(w)) { found = w; break; }
  }
  if (!found) continue;
  for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
    const t = lines[j].trim().replace(/\\+$/, '').trim();
    const m = t.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
    if (m && !BAD.has(m[1]) && !m[2].includes('dshbase')) {
      const id = `${m[1]}/${m[2]}`;
      if (!seen.has(id)) { seen.add(id); status[id] = STATUS_MAP[found] || 'unknown'; }
      break;
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(status, null, 2));
const byS = {};
for (const v of Object.values(status)) byS[v] = (byS[v] || 0) + 1;
console.log(`测试状态 ${Object.keys(status).length} 个 → ${OUT}`);
console.log('分布:', JSON.stringify(byS));
