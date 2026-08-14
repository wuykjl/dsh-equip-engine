// 全量 / 增量 manifest 生成：store → caps（LLM），支持 --resume 从 plugins-all 补缺
'use strict';
const fs = require('fs');
const path = require('path');
const { getApiKey } = require('../src/llm.js');

const API = 'https://api.deepseek.com/chat/completions';
const STORE = path.join(__dirname, '..', 'data', 'plugins-store.json');
const FULL = path.join(__dirname, '..', 'data', 'plugins-full.json');
const VERIFIED = path.join(__dirname, '..', 'data', 'verified.json');
const OUT = path.join(__dirname, '..', 'data', 'plugins-all.json');
const BATCH = 40;

const GENERIC = new Set(['界面', '工具', '插件', '管理', '集成', '研究', '安全', '记忆', '视觉', '设计', '系统', '通知', '搜索', '监控']);

function costFromStars(stars) {
  if (stars == null) return 0.3;
  const norm = Math.log10(stars + 1) / Math.log10(100000 + 1);
  return Math.round((0.15 + 0.35 * (1 - norm)) * 100) / 100;
}

function sanitizeCaps(caps) {
  const out = (caps || []).filter(c => c && !GENERIC.has(c));
  return out.length ? out : (caps || []).slice(0, 2);
}

async function genBatch(batch) {
  const key = getApiKey();
  if (!key) throw new Error('未找到 DEEPSEEK_API_KEY');
  const list = batch.map(p => `[${p.id}] slot=${p.slot} desc=${(p.desc || 'No description').slice(0, 100)}`).join('\n');
  const prompt = `你是 AI 插件分类专家。为每个插件从 desc 抽取可区分的中文能力标签。
输入:
${list}
输出 JSON（不要其他文字），格式: {"plugins":[{"id":"<原样id>","caps":["中文能力词3-5个"],"tags":["中文领域标签1-2个"]}]}
硬性要求:
1. caps 必须能从 desc 推断，优先 3 字以上具体词（如"费用统计""会话导出""飞书通知"），禁止空泛词单独成条
2. 禁止单独输出这些泛词: 界面/工具/插件/管理/集成/研究/安全/记忆/视觉/设计/系统/通知/搜索/监控
3. 若 desc 过短，用插件名拆词补具体能力，仍禁止纯泛词
4. 只处理输入中存在的 id，禁止编造`;
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
    } catch (e) {
      if (attempt === 2) console.warn('batch fail:', e.message);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  return [];
}

function toEntry(g, src, verifiedMap) {
  return {
    id: g.id, name: src.name, display: src.name, slot: src.slot,
    capabilities: sanitizeCaps(g.caps), tags: g.tags || [],
    conflicts: [], complements: [],
    cost: costFromStars(src.stars),
    stars: src.stars, requirements: { os: ['win32'] },
    desc: src.desc, category: src.category,
    source: 'generated',
    verified: verifiedMap[src.id] ? true : null,
    testStatus: null,
  };
}

async function main() {
  const resume = process.argv.includes('--resume');
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const verifiedMap = (() => { try { return JSON.parse(fs.readFileSync(VERIFIED, 'utf8')); } catch { return {}; } })();

  let base;
  if (resume && fs.existsSync(OUT)) {
    base = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } else {
    base = JSON.parse(fs.readFileSync(FULL, 'utf8'));
  }
  const existingIds = new Set(base.map(p => p.id));
  const need = store.filter(p => !existingIds.has(p.id));
  console.log(`base ${base.length} | store ${store.length} | 需生成 ${need.length}（${Math.ceil(need.length / BATCH) || 0} 批）${resume ? ' [--resume]' : ''}`);

  if (!need.length) {
    fs.writeFileSync(OUT, JSON.stringify(base, null, 2));
    console.log('无缺失，已写回现有库');
    return;
  }

  const generated = [];
  for (let i = 0; i < need.length; i += BATCH) {
    const batch = need.slice(i, i + BATCH);
    const r = await genBatch(batch);
    generated.push(...r);
    console.log(`批 ${Math.floor(i / BATCH) + 1}/${Math.ceil(need.length / BATCH)}: 累计 ${generated.length}/${need.length}`);
  }

  const all = base.map(p => ({ ...p }));
  for (const g of generated) {
    const src = store.find(p => p.id === g.id);
    if (!src) continue;
    all.push(toEntry(g, src, verifiedMap));
  }
  fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  console.log(`完成: ${all.length} 个 → ${OUT}（生成 ${generated.length}，失败 ${need.length - generated.length}）`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
