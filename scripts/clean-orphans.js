// 清理 test-status / verified 中不在 plugins-all 的孤儿 id
// 用法: node scripts/clean-orphans.js [--apply]
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data');
const ALL = path.join(ROOT, 'plugins-all.json');
const STATUS = path.join(ROOT, 'test-status.json');
const VERIFIED = path.join(ROOT, 'verified.json');

// 已知别名：信号文件 id → 库内 id（可一对多时取首选）
const ALIAS = {
  'Anionex/dsh-vision-toolkit': 'Anionex/agent-vision-toolkit',
  'omdsh-dev/dsh-toolkit': 'dsh-external/dsh-toolkit',
  'omdsh-dev/dsh-deep-research': 'dsh-external/dsh-deep-research',
};

function main() {
  const apply = process.argv.includes('--apply');
  const ids = new Set(JSON.parse(fs.readFileSync(ALL, 'utf8')).map(p => p.id));
  const status = JSON.parse(fs.readFileSync(STATUS, 'utf8'));
  const verified = JSON.parse(fs.readFileSync(VERIFIED, 'utf8'));

  const statusOut = {};
  const verifiedOut = {};
  const removedStatus = [];
  const removedVerified = [];
  const aliased = [];

  for (const [id, v] of Object.entries(status)) {
    const target = ALIAS[id] || id;
    if (ids.has(target)) {
      statusOut[target] = v;
      if (target !== id) aliased.push(`${id}→${target}`);
    } else {
      removedStatus.push(id);
    }
  }
  for (const [id, v] of Object.entries(verified)) {
    const target = ALIAS[id] || id;
    if (ids.has(target)) {
      verifiedOut[target] = v;
      if (target !== id) aliased.push(`verified ${id}→${target}`);
    } else {
      removedVerified.push(id);
    }
  }

  console.log(`status: ${Object.keys(status).length}→${Object.keys(statusOut).length} 移除 ${removedStatus.length}`);
  if (removedStatus.length) console.log('  ', removedStatus.join(', '));
  console.log(`verified: ${Object.keys(verified).length}→${Object.keys(verifiedOut).length} 移除 ${removedVerified.length}`);
  if (removedVerified.length) console.log('  ', removedVerified.join(', '));
  if (aliased.length) console.log('alias:', aliased.join('; '));

  if (!apply) {
    console.log('预览。加 --apply 写回。');
    return;
  }
  fs.writeFileSync(STATUS, JSON.stringify(statusOut, null, 2) + '\n');
  fs.writeFileSync(VERIFIED, JSON.stringify(verifiedOut, null, 2) + '\n');
  console.log('已写回 test-status.json / verified.json');
}

main();
