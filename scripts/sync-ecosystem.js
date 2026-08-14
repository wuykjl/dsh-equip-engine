// 生态增量同步：解析新抓取的 store 页面 → 对比现有 manifest → 生成新增 caps → 合并
// 用法: node scripts/sync-ecosystem.js <store缓存md> [--apply]
// --apply 才写回 plugins-all.json；否则只预览增量
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getApiKey } = require('../src/llm.js');

const API = 'https://api.deepseek.com/chat/completions';
const ROOT = path.join(__dirname, '..', 'data');
const STORE = path.join(ROOT, 'plugins-store.json');
const ALL = path.join(ROOT, 'plugins-all.json');

function parseStore(md) {
  // 复用 parse-store.js 逻辑（内联避免子进程）
  const unescapeMd = (s) => String(s || '').replace(/\\([_*`\[\]])/g, '$1');
  const CATEGORY_SLOT = {
    'Vision': 'perception', 'MCP': 'action', 'Tools': 'action',
    'Skills': 'decision', 'Workspace': 'decision',
    'Web UI': 'output', 'Terminal UI': 'output', 'Desktop': 'output',
    'Lists': 'output', 'Other': 'action',
  };
  const blocks = md.split(/^## /m).slice(1);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length);
    if (lines.length < 3) continue;
    const name = unescapeMd(lines[0]);
    const starM = lines[1].match(/^([\d.]+)(k?)\s*★/);
    const stars = starM ? Math.round(parseFloat(starM[1]) * (starM[2] === 'k' ? 1000 : 1)) : null;
    const owner = unescapeMd(lines[2]);
    let desc = '';
    for (let i = 3; i < lines.length; i++) {
      const l = lines[i];
      if (l.includes('[') && l.includes('](')) break;
      desc += (desc ? ' ' : '') + l;
    }
    desc = unescapeMd(desc);
    const cats = [];
    for (let i = 3; i < lines.length; i++) {
      const m = lines[i].match(/New \[([^\]]+)\]/g);
      if (m) for (const mm of m) cats.push(mm.slice(5, -1));
    }
    const category = cats[0] || 'Other';
    out.push({ id: `${owner}/${name}`, name, owner, stars: stars ?? null, desc: desc.slice(0, 200), category, slot: CATEGORY_SLOT[category] || 'action' });
  }
  return out;
}

async function genCaps(batch) {
  const key = getApiKey();
  const list = batch.map(p => `[${p.id}] slot=${p.slot} desc=${p.desc.slice(0, 100)}`).join('\n');
  const prompt = `你是 AI 插件分类专家。为每个插件从 desc 抽取可区分的中文能力标签。
输入:
${list}
输出 JSON（不要其他文字），格式: {"plugins":[{"id":"<原样id>","caps":["中文能力词3-5个"],"tags":["中文领域标签1-2个"]}]}
硬性要求: caps 优先 3 字以上具体词；禁止单独输出 界面/工具/插件/管理/集成/研究/安全/记忆/视觉/设计；只处理输入中存在的 id。`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: 'deepseek-chat', messages: [{ role: 'user', content: prompt }], temperature: 0.1, response_format: { type: 'json_object' } }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      const valid = new Set(batch.map(p => p.id));
      let arr = [];
      try { const parsed = JSON.parse(content); arr = Array.isArray(parsed) ? parsed : parsed.plugins || []; } catch {}
      const ok = arr.filter(x => valid.has(x.id));
      if (ok.length) return ok;
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  return [];
}

async function main() {
  const src = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!src) { console.error('用法: node scripts/sync-ecosystem.js <store缓存md> [--apply]'); process.exit(1); }
  const fresh = parseStore(fs.readFileSync(src, 'utf8'));
  const all = JSON.parse(fs.readFileSync(ALL, 'utf8'));
  const known = new Set(all.map(p => p.id));
  const freshKnown = new Set(fresh.map(p => p.id));

  const added = fresh.filter(p => !known.has(p.id));
  const removed = all.filter(p => !freshKnown.has(p.id) && p.source === 'generated');
  console.log(`生态对比: store ${fresh.length} | 现有 ${all.length} | 新增 ${added.length} | 消失 ${removed.length}`);

  if (!added.length) { console.log('无增量，跳过生成'); return; }

  // 新增分 40 批生成 caps
  const generated = [];
  for (let i = 0; i < added.length; i += 40) {
    const batch = added.slice(i, i + 40);
    const r = await genCaps(batch);
    generated.push(...r);
    console.log(`生成 ${Math.min(i + 40, added.length)}/${added.length}（累计 ${generated.length}）`);
  }
  const genIds = new Set(generated.map(g => g.id));
  if (!apply) { console.log(`预览：新增 ${generated.length}（失败 ${added.length - generated.length}）。加 --apply 写回。`); return; }

  for (const g of generated) {
    const s = fresh.find(p => p.id === g.id);
    if (!s) continue;
    const stars = s.stars;
    const norm = stars == null ? 0.5 : Math.log10(stars + 1) / Math.log10(100001);
    const cost = Math.round((0.15 + 0.35 * (1 - norm)) * 100) / 100;
    all.push({
      id: g.id, name: s.name, display: s.name, slot: s.slot,
      capabilities: g.caps || [], tags: g.tags || [],
      conflicts: [], complements: [], cost,
      stars: s.stars, requirements: { os: ['win32'] },
      desc: s.desc, category: s.category, source: 'generated',
      verified: null, testStatus: null,
    });
  }
  fs.writeFileSync(ALL, JSON.stringify(all, null, 2));
  fs.writeFileSync(STORE, JSON.stringify(fresh, null, 2));
  console.log(`已写回: ${all.length} 个 → ${ALL}（本次新增 ${generated.length}，失败 ${added.length - generated.length}）`);
  try {
    require('child_process').execSync('node scripts/validate-manifests.js', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  } catch (e) {
    console.warn('校验未通过，请检查 data/plugins-all.json');
  }
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
