// id 全限定修复：短名 → owner/repo（消除撞名歧义）
'use strict';
const fs = require('fs');
const path = require('path');

const RAW = path.join(__dirname, '..', 'data', 'awesome-raw.json');
const FULL = path.join(__dirname, '..', 'data', 'plugins-full.json');
const FEEDBACK = path.join(__dirname, '..', 'data', 'feedback.json');
const BLACKLIST = path.join(__dirname, '..', 'data', 'blacklist.json');

// 手工库 19 个的 owner/repo 映射（来自 2026-08-15 收集）
const MANUAL_URLS = {
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

function ownerRepo(url) {
  // 支持 monorepo 子路径 → owner/repo#path
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/[^/]+\/(.+))?/);
  if (!m) return null;
  const owner = m[1], repo = m[2].replace(/\.git$/, ''), sub = m[3];
  if (sub) return `${owner}/${repo}#${sub.replace(/\/$/, '')}`;
  return `${owner}/${repo}`;
}

function main() {
  const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  const full = JSON.parse(fs.readFileSync(FULL, 'utf8'));

  // 构建 短名→全限定 映射
  const map = {};
  for (const p of raw) {
    const q = ownerRepo(p.url);
    if (q) map[p.id] = q;
  }
  for (const [short, q] of Object.entries(MANUAL_URLS)) {
    if (!map[short]) map[short] = q;
  }

  // 重写 full：id 全限定 + display 保留短名
  let changed = 0, unresolved = 0;
  for (const p of full) {
    const q = map[p.id];
    if (q && q !== p.id) {
      p.display = p.name;
      p.id = q;
      p.name = p.display; // name 仍是显示名
      changed++;
    } else if (!q) {
      unresolved++;
      p.display = p.name;
    }
  }
  fs.writeFileSync(FULL, JSON.stringify(full, null, 2));

  // feedback / blacklist 旧 id 迁移
  try {
    const fb = JSON.parse(fs.readFileSync(FEEDBACK, 'utf8'));
    const fb2 = {};
    for (const [k, v] of Object.entries(fb)) {
      const q = map[k];
      fb2[q || k] = v;
    }
    fs.writeFileSync(FEEDBACK, JSON.stringify(fb2, null, 2));
  } catch {}
  try {
    const bl = JSON.parse(fs.readFileSync(BLACKLIST, 'utf8'));
    fs.writeFileSync(BLACKLIST, JSON.stringify(bl.map(k => map[k] || k), null, 2));
  } catch {}

  console.log(`id 全限定: 修改 ${changed} | 未解析 ${unresolved} | 总 ${full.length}`);
  const sample = full.slice(0, 5).map(p => `${p.display} → ${p.id}`);
  console.log('样例:', sample.join(' | '));
}

main();
