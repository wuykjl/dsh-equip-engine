// 从 awesome-deepseek-harness README 提取插件条目（字符串解析，避免正则转义坑）
// 用法: node scripts/extract-awesome.js <README路径>
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'data', 'awesome-raw.json');
const SRC = process.argv[2];
if (!SRC) { console.error('用法: node scripts/extract-awesome.js <README.md>'); process.exit(1); }

const CATEGORY_MAP = {
  'Core': 'decision',
  'Context & Search': 'memory',
  'Input & Editing': 'action',
  'UI & Experience': 'output',
  'IDE & Clients': 'output',
  'Browser & Remote': 'perception',
  'Models & Inference': 'decision',
  'Git & Engineering': 'action',
  'Output & Deliverables': 'output',
  'Notifications & Channels': 'output',
  'Fun & Lifestyle': 'output',
  'Science & Research': 'decision',
};

const md = fs.readFileSync(SRC, 'utf8');
const lines = md.split('\n');
const out = [];
let category = 'misc';

for (const line of lines) {
  const t = line.trim();
  if (t.startsWith('## ')) { category = t.slice(3).trim(); continue; }
  if (!t.startsWith('- [') || !t.includes('](http')) continue;
  // name = 第一个 '](' 之前
  const nameEnd = t.indexOf('](');
  const name = t.slice(3, nameEnd);
  // url = '](' 后到第一个 ')'
  const urlEnd = t.indexOf(')', nameEnd);
  const url = t.slice(nameEnd + 2, urlEnd);
  if (!url.startsWith('http')) continue;
  // desc = 闭括号后，剥离前导分隔符（空格/反斜杠/横线）
  let desc = t.slice(urlEnd + 1).trim();
  while (desc.length && ('\\- '.indexOf(desc[0]) !== -1 || desc[0] === '\t')) {
    desc = desc.slice(1).trim();
  }
  if (!desc) continue;
  out.push({ id: name, name, url, desc: desc.slice(0, 200), category, slot: CATEGORY_MAP[category] || 'action' });
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
const byCat = {};
for (const p of out) byCat[p.category] = (byCat[p.category] || 0) + 1;
console.log(`提取 ${out.length} 个插件 → ${OUT}`);
console.log('分类:', JSON.stringify(byCat));
