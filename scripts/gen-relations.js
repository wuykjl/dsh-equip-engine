// 批量关系图候选：同槽高 Jaccard → conflict；跨槽共独特 cap → complement
// 用法:
//   node scripts/gen-relations.js                      # 预览候选
//   node scripts/gen-relations.js --apply              # 仅写白名单边
//   node scripts/gen-relations.js --rollback-generic   # 回滚泛词自动边
'use strict';
const fs = require('fs');
const path = require('path');

const ALL = path.join(__dirname, '..', 'data', 'plugins-all.json');
const OUT = path.join(__dirname, '..', 'data', 'relation-candidates.json');
const GENERIC_CAPS = new Set([
  '界面', '工具', '插件', '管理', '集成', '研究', '安全', '记忆', '视觉', '设计',
  '系统', '通知', '搜索', '监控', '网络', '代理', '服务器', '信息检索', '开发', '技能',
  '编排', '多智能体', '任务分配', '导出', '会话', 'Git', '身份', '提交',
]);

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

function repoSuffix(id) {
  const base = id.includes('#') ? id.split('#')[0] : id;
  const parts = base.split('/');
  return (parts[1] || '').toLowerCase().replace(/^dsh[-_]?/, '');
}

function suffixSimilar(a, b) {
  const sa = repoSuffix(a), sb = repoSuffix(b);
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  // 编辑距离粗判：共享长前缀
  let i = 0;
  while (i < sa.length && i < sb.length && sa[i] === sb[i]) i++;
  return i >= Math.min(6, Math.min(sa.length, sb.length));
}

function avgFreq(caps, freq) {
  if (!caps.length) return 999;
  return caps.reduce((s, c) => s + (freq.get(c) || 0), 0) / caps.length;
}

/** 白名单：共享 cap 平均频次 ≤10，或 id 后缀高度相似（分叉插件） */
function whitelistEdge(c, freq) {
  if (suffixSimilar(c.a, c.b)) return true;
  const shared = c.caps || [];
  if (!shared.length) return false;
  // 共享词若全是泛词 → 拒绝
  if (shared.every(x => GENERIC_CAPS.has(x) || x.length <= 2)) return false;
  return avgFreq(shared, freq) <= 10;
}

function buildFreq(plugins) {
  const freq = new Map();
  for (const p of plugins) for (const c of p.capabilities || []) freq.set(c, (freq.get(c) || 0) + 1);
  return freq;
}

function rollbackGeneric(plugins, freq) {
  // 只动 generated；移除「共享边双方都是 generated 且边不合格」的对称 conflict
  const byId = new Map(plugins.map(p => [p.id, p]));
  let removed = 0;
  for (const p of plugins) {
    if (p.source === 'manual') continue;
    const keep = [];
    for (const cid of p.conflicts || []) {
      const other = byId.get(cid);
      if (!other || other.source === 'manual') { keep.push(cid); continue; }
      const shared = (p.capabilities || []).filter(c => (other.capabilities || []).includes(c));
      const fake = { a: p.id, b: cid, caps: shared };
      if (whitelistEdge(fake, freq)) keep.push(cid);
      else removed++;
    }
    p.conflicts = keep;
  }
  return removed;
}

function main() {
  const apply = process.argv.includes('--apply');
  const rollback = process.argv.includes('--rollback-generic');
  const thrIdx = process.argv.indexOf('--threshold');
  const thr = thrIdx >= 0 ? parseFloat(process.argv[thrIdx + 1]) : 0.8;

  const plugins = JSON.parse(fs.readFileSync(ALL, 'utf8'));
  const freq = buildFreq(plugins);

  if (rollback) {
    const n = rollbackGeneric(plugins, freq);
    fs.writeFileSync(ALL, JSON.stringify(plugins, null, 2));
    console.log(`rollback-generic: 移除 ${n} 条不合格 generated conflict 引用`);
    return;
  }

  const pool = plugins.filter(p => (p.capabilities || []).length >= 2);
  const conflicts = [];
  const complements = [];

  const bySlot = new Map();
  for (const p of pool) {
    if (!bySlot.has(p.slot)) bySlot.set(p.slot, []);
    bySlot.get(p.slot).push(p);
  }
  for (const [, list] of bySlot) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if ((a.conflicts || []).includes(b.id) || (b.conflicts || []).includes(a.id)) continue;
        const jacc = jaccard(a.capabilities, b.capabilities);
        if (jacc >= thr) {
          const caps = a.capabilities.filter(c => b.capabilities.includes(c));
          conflicts.push({
            a: a.id, b: b.id, slot: a.slot, jaccard: +jacc.toFixed(3), caps,
            whitelist: whitelistEdge({ a: a.id, b: b.id, caps }, freq),
            avgCapFreq: +avgFreq(caps, freq).toFixed(1),
            suffixSimilar: suffixSimilar(a.id, b.id),
          });
        }
      }
    }
  }

  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i], b = pool[j];
      if (a.slot === b.slot) continue;
      if ((a.complements || []).includes(b.id) || (b.complements || []).includes(a.id)) continue;
      const shared = a.capabilities.filter(c => b.capabilities.includes(c) && (freq.get(c) || 0) <= 20);
      if (shared.length >= 2) {
        complements.push({ a: a.id, b: b.id, slots: [a.slot, b.slot], shared });
      }
    }
  }

  conflicts.sort((x, y) => y.jaccard - x.jaccard);
  const topConflicts = conflicts.slice(0, 200);
  const topComplements = complements.slice(0, 200);
  const wlCount = topConflicts.filter(c => c.whitelist).length;

  const report = {
    generatedAt: new Date().toISOString(),
    threshold: thr,
    conflictCandidates: topConflicts,
    complementCandidates: topComplements,
    totals: { conflicts: conflicts.length, complements: complements.length, whitelist: wlCount },
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`关系候选 → ${OUT}`);
  console.log(`  conflicts: ${conflicts.length}（top ${topConflicts.length}, whitelist ${wlCount}）`);
  console.log(`  complements: ${complements.length}（只候选不自动写）`);

  if (!apply) {
    console.log('预览。--apply 仅写 whitelist 边；--rollback-generic 回滚泛词边。');
    return;
  }

  const byId = new Map(plugins.map(p => [p.id, p]));
  let applied = 0;
  for (const c of topConflicts) {
    if (c.jaccard < 0.9 || !c.whitelist) continue;
    const a = byId.get(c.a), b = byId.get(c.b);
    if (!a || !b) continue;
    if (a.source === 'manual' || b.source === 'manual') continue;
    a.conflicts = a.conflicts || [];
    b.conflicts = b.conflicts || [];
    if (!a.conflicts.includes(b.id)) { a.conflicts.push(b.id); applied++; }
    if (!b.conflicts.includes(a.id)) { b.conflicts.push(a.id); applied++; }
  }
  fs.writeFileSync(ALL, JSON.stringify(plugins, null, 2));
  console.log(`已写入 whitelist conflict 边引用 ${applied} 次`);
}

main();
