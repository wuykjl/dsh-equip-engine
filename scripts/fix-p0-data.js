// P0 数据修复：手工库关系图 + monorepo id + 去重 + 删垃圾
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MANUAL = path.join(ROOT, 'data', 'plugins.json');
const RAW = path.join(ROOT, 'data', 'awesome-raw.json');
const FILES = [
  path.join(ROOT, 'data', 'plugins-all.json'),
  path.join(ROOT, 'data', 'plugins-full.json'),
];

// 短名 → 库内实际手工 id（以 plugins-all 手工条目为准，非 awesome 撞名）
const MANUAL_IDS = {
  'dsh-deepresearch': 'dsh-external/dsh-deepresearch',
  'dsh-deep-research': 'dsh-external/dsh-deep-research',
  'dsh-plan-execute': 'dsh-external/dsh-plan-execute',
  'dsh-toolkit': 'dsh-external/dsh-toolkit',
  'dsh-TUI': 'ccch1mneyyy/dsh-TUI',
  'deepseek-harness-desktop': 'Easyhoov/deepseek-harness-desktop',
  'agent-vision-toolkit': 'Anionex/agent-vision-toolkit',
  'billion-context-dsh': 'Tyan66666/billion-context-dsh',
  'dsh-context-doctor': 'Zhenyu98/dsh-context-doctor',
  'dsh-file-mount': 'acefun29/dsh-file-mount',
  'dsh-memory-vault': 'flymysql/dsh-memory',
  'dsh-cot-summary': 'dsh-external/dsh-cot-summary',
  'dsh-learn-everything': 'cendaifeng/dsh-learn-everything',
  'dsh-science': 'biociao/dsh-science',
  'dsh-reverse-skill': 'dhicoc/dsh-reverse-skill',
  'open-design': 'nexu-io/open-design',
  'archify': 'tt-a1i/archify',
  'OpenBiliClaw': 'whiteguo233/OpenBiliClaw',
  'dsh-meme-hub': 'the-beating-light-of-the-nail/dsh-meme-hub',
};

function ownerRepoPath(url) {
  // github.com/owner/repo or github.com/owner/repo/tree/main/packages/...
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/(.+))?/);
  if (!m) return null;
  const owner = m[1], repo = m[2].replace(/\.git$/, ''), sub = m[3];
  if (sub) return `${owner}/${repo}#${sub.replace(/\/$/, '')}`;
  return `${owner}/${repo}`;
}

function fixGraph(plugins, shortPlugins) {
  const byFull = new Map();
  for (const [short, full] of Object.entries(MANUAL_IDS)) byFull.set(full, short);

  const shortById = new Map(shortPlugins.map(p => [p.id, p]));
  let fixed = 0;
  for (const p of plugins) {
    if (p.source !== 'manual') continue;
    const short = byFull.get(p.id);
    if (!short) continue;
    const src = shortById.get(short);
    if (!src) continue;
    const mapRefs = (arr) => (arr || []).map(id => MANUAL_IDS[id] || id);
    const nextConflicts = mapRefs(src.conflicts);
    const nextComplements = mapRefs(src.complements);
    if (JSON.stringify(p.conflicts) !== JSON.stringify(nextConflicts) ||
        JSON.stringify(p.complements) !== JSON.stringify(nextComplements)) {
      p.conflicts = nextConflicts;
      p.complements = nextComplements;
      fixed++;
    }
  }
  return fixed;
}

function fixMonorepoIds(plugins, raw) {
  const suiteRaw = raw.filter(r => (r.url || '').includes('whyihaveyou/dsh-suite'));
  const byName = new Map();
  for (const r of suiteRaw) {
    const q = ownerRepoPath(r.url);
    if (!q) continue;
    byName.set(r.id.toLowerCase(), q);
    byName.set(r.name.toLowerCase(), q);
  }

  let changed = 0;
  for (const p of plugins) {
    if (p.id !== 'whyihaveyou/dsh-suite') continue;
    const name = (p.display || p.name || '').toLowerCase();
    const q = byName.get(name);
    if (!q) {
      console.warn('unmatched suite row:', p.name, (p.desc || '').slice(0, 40));
      continue;
    }
    p.id = q;
    if (!p.display) p.display = p.name;
    changed++;
  }
  return changed;
}

function dedupe(plugins) {
  const seen = new Map();
  const out = [];
  let removed = 0;
  for (const p of plugins) {
    if (p.id === 'Notifications' || p.id === 'DeepSeek') {
      removed++;
      continue;
    }
    if (seen.has(p.id)) {
      // keep richer entry (more caps / has desc)
      const prev = seen.get(p.id);
      const score = (x) => (x.capabilities || []).length + ((x.desc && x.desc !== 'No description') ? 2 : 0) + (x.source === 'manual' ? 10 : 0);
      if (score(p) > score(prev.p)) {
        out[prev.idx] = p;
        seen.set(p.id, { p, idx: prev.idx });
      }
      removed++;
      continue;
    }
    seen.set(p.id, { p, idx: out.length });
    out.push(p);
  }
  return { out, removed };
}

function main() {
  const shortPlugins = JSON.parse(fs.readFileSync(MANUAL, 'utf8'));
  const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));

  for (const file of FILES) {
    let plugins = JSON.parse(fs.readFileSync(file, 'utf8'));
    const before = plugins.length;
    const g = fixGraph(plugins, shortPlugins);
    const m = fixMonorepoIds(plugins, raw);
    const { out, removed } = dedupe(plugins);
    plugins = out;
    fs.writeFileSync(file, JSON.stringify(plugins, null, 2));
    console.log(`${path.basename(file)}: ${before}→${plugins.length} | graph=${g} monorepo=${m} removed=${removed}`);
  }

  // sanity: print suite ids
  const all = JSON.parse(fs.readFileSync(FILES[0], 'utf8'));
  const suite = all.filter(p => p.id.startsWith('whyihaveyou/dsh-suite'));
  console.log('suite ids:', suite.map(p => p.id).join('\n  '));
  const manual = all.filter(p => p.source === 'manual');
  console.log('manual conflicts sample:');
  for (const p of manual.filter(x => (x.conflicts || []).length)) {
    console.log(`  ${p.id} → ${p.conflicts.join(', ')}`);
  }
}

main();
