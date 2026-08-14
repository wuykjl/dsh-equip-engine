// manifest 校验：唯一 id、关系可解析、手工互斥成对、无垃圾 id、无空 caps
'use strict';
const fs = require('fs');
const path = require('path');

const ALL = path.join(__dirname, '..', 'data', 'plugins-all.json');
const JUNK = new Set(['Notifications', 'DeepSeek']);

function main() {
  const plugins = JSON.parse(fs.readFileSync(ALL, 'utf8'));
  const ids = plugins.map(p => p.id);
  const idSet = new Set(ids);
  const errors = [];
  const warnings = [];

  // 唯一 id
  if (ids.length !== idSet.size) {
    const seen = new Map();
    for (const id of ids) seen.set(id, (seen.get(id) || 0) + 1);
    for (const [id, n] of seen) if (n > 1) errors.push(`duplicate id: ${id} ×${n}`);
  }

  // 垃圾
  for (const p of plugins) {
    if (JUNK.has(p.id) || !p.id.includes('/')) errors.push(`junk/malformed id: ${p.id}`);
    if (!(p.capabilities || []).length) warnings.push(`empty caps: ${p.id}`);
  }

  // 关系可解析 + 手工互斥成对
  const manual = plugins.filter(p => p.source === 'manual');
  for (const p of plugins) {
    for (const c of p.conflicts || []) {
      if (!idSet.has(c)) errors.push(`broken conflict: ${p.id} → ${c}`);
    }
    for (const c of p.complements || []) {
      if (!idSet.has(c)) errors.push(`broken complement: ${p.id} → ${c}`);
    }
  }
  for (const p of manual) {
    for (const c of p.conflicts || []) {
      const other = plugins.find(x => x.id === c);
      if (other && !(other.conflicts || []).includes(p.id)) {
        warnings.push(`asymmetric conflict: ${p.id} ↔ ${c}`);
      }
    }
  }

  console.log(`validate: ${plugins.length} plugins | ${errors.length} errors | ${warnings.length} warnings`);
  for (const e of errors) console.log('  ERR', e);
  for (const w of warnings.slice(0, 20)) console.log('  WARN', w);
  if (warnings.length > 20) console.log(`  ... +${warnings.length - 20} warnings`);
  if (errors.length) process.exit(1);
}

main();
