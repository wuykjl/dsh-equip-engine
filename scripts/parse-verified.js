// 从 dshbase 目录页缓存提取 verified 插件列表
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) { console.error('用法: node scripts/parse-verified.js <dshbase缓存md>'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'data', 'verified.json');

const md = fs.readFileSync(SRC, 'utf8');
// 卡片格式: [name ⭐状态 ...\n owner/repo\n desc...]
// 找含 Verified 的卡片标题行，向后找 owner/repo
const lines = md.split('\n');
const verified = {};
const seen = new Set();
const BAD = new Set(['com', 'www', 'github', 'dshbase', 'plugins', 'directory', 'http', 'https', 'deepseek', 'ai']);
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (l.includes('Verified')) {
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const t = lines[j].trim().replace(/\\+$/, '').trim();
      const m = t.match(/^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/);
      if (m && !BAD.has(m[1]) && !m[2].includes('dshbase')) {
        const id = `${m[1]}/${m[2]}`;
        if (!seen.has(id)) { seen.add(id); verified[id] = true; }
        break;
      }
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify(verified, null, 2));
console.log(`verified 插件: ${Object.keys(verified).length} 个 → ${OUT}`);
console.log('样例:', Object.keys(verified).slice(0, 8).join(', '));
