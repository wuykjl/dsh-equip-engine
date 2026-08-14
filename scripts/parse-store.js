// 解析 dshplugin.store 缓存 → 全量插件数据（owner/repo + stars + 分类 + desc）
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
if (!SRC) { console.error('用法: node scripts/parse-store.js <缓存md路径>'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'data', 'plugins-store.json');

const CATEGORY_SLOT = {
  'Vision': 'perception', 'MCP': 'action', 'Tools': 'action',
  'Skills': 'decision', 'Workspace': 'decision',
  'Web UI': 'output', 'Terminal UI': 'output', 'Desktop': 'output',
  'Lists': 'output', 'Other': 'action',
};

const md = fs.readFileSync(SRC, 'utf8');
const unescapeMd = (s) => String(s || '').replace(/\\([_*`\[\]])/g, '$1');
// 按 ## 标题分块
const blocks = md.split(/^## /m).slice(1);
const out = [];
for (const block of blocks) {
  const lines = block.split('\n').map(l => l.trim()).filter(l => l.length);
  if (lines.length < 3) continue;
  const name = unescapeMd(lines[0]);
  // stars: "89k ★" 或 "0 ★"
  const starM = lines[1].match(/^([\d.]+)(k?)\s*★/);
  const stars = starM ? Math.round(parseFloat(starM[1]) * (starM[2] === 'k' ? 1000 : 1)) : null;
  const owner = unescapeMd(lines[2]);
  // desc：owner 后的行直到含 "New [" 或链接的行
  let desc = '';
  for (let i = 3; i < lines.length; i++) {
    const l = lines[i];
    if (l.includes('[') && l.includes('](')) break; // 分类链接行
    desc += (desc ? ' ' : '') + l;
  }
  desc = unescapeMd(desc);
  // 分类：New [Cat](...)
  const cats = [];
  for (let i = 3; i < lines.length; i++) {
    const m = lines[i].match(/New \[([^\]]+)\]/g);
    if (m) for (const mm of m) cats.push(mm.slice(5, -1));
  }
  const category = cats[0] || 'Other';
  out.push({
    id: `${owner}/${name}`,
    name, owner,
    stars: stars ?? null,
    desc: desc.slice(0, 200),
    category,
    slot: CATEGORY_SLOT[category] || 'action',
    verified: null,
  });
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
const byCat = {};
for (const p of out) byCat[p.category] = (byCat[p.category] || 0) + 1;
console.log(`解析 ${out.length} 个插件 → ${OUT}`);
console.log('分类:', JSON.stringify(byCat));
console.log('样例:', JSON.stringify(out[0]));
