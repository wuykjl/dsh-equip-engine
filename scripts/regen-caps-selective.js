// 选择性 caps 重生成：按 capQuality < 0.4 排队；无 desc 不猜 caps
// 用法: node scripts/regen-caps-selective.js [--limit 40] [--apply] [--mark-only]
'use strict';
const fs = require('fs');
const path = require('path');
const { getApiKey } = require('../src/llm.js');
const { loadPlugins, capQuality } = require('../src/equip.js');

const ALL = path.join(__dirname, '..', 'data', 'plugins-all.json');
const STORE = path.join(__dirname, '..', 'data', 'plugins-store.json');
const API = 'https://api.deepseek.com/chat/completions';
const BATCH = 20;
const GENERIC = new Set([
  '界面', '工具', '插件', '管理', '集成', '研究', '安全', '记忆', '视觉', '设计',
  '系统', '通知', '搜索', '监控', '文档', '阅读', '模式', '设置', '路由', '模型',
  '会话', '日志', '解释', '学习', '步骤',
]);

function hasDesc(p) {
  const d = (p.desc || '').trim();
  return d && d !== 'No description';
}

/** 无 desc：尝试用 store.category 补结构化信息；仍无依据则标记 name-guess */
function markNoDesc(plugins, storeById) {
  let catN = 0, guessN = 0;
  for (const p of plugins) {
    if (p.source !== 'generated') continue;
    if (hasDesc(p)) continue;
    const s = storeById.get(p.id);
    if (s && s.category && String(s.category).trim()) {
      // category 作弱 desc 依据，不编造详细描述
      if (!p.desc || p.desc === 'No description') {
        p.desc = `[category] ${s.category}`;
        catN++;
      }
      continue;
    }
    // 无依据：保留现有 caps 但标记 name-guess，供 capQuality 封顶
    if (p.capsSource !== 'name-guess') {
      p.capsSource = 'name-guess';
      guessN++;
    }
  }
  return { catN, guessN };
}

function selectTargets(plugins, limit) {
  const scored = [];
  for (const p of plugins) {
    if (p.source !== 'generated') continue;
    // 无有效 desc：不送 LLM（只能从仓库名瞎猜 → 噪声源）
    if (!hasDesc(p) || p.capsSource === 'name-guess') continue;
    if ((p.desc || '').startsWith('[category]')) continue; // category 伪 desc 也不够依据
    const q = capQuality(p, plugins);
    if (q >= 0.4) continue;
    scored.push({ p, q });
  }
  scored.sort((a, b) => a.q - b.q || (b.p.stars || 0) - (a.p.stars || 0));
  return scored.slice(0, limit).map(x => x.p);
}

async function genBatch(batch) {
  const key = getApiKey();
  if (!key) throw new Error('未找到 DEEPSEEK_API_KEY');
  const list = batch.map(p =>
    `[${p.id}] slot=${p.slot} name=${p.name} desc=${(p.desc || '').slice(0, 160)}`
  ).join('\n');
  const prompt = `你是 AI 插件分类专家。为每个插件从 name/desc 抽取可区分的中文能力标签。
输入:
${list}
输出 JSON: {"plugins":[{"id":"<原样id>","caps":["中文能力词3-5个"],"tags":["领域1-2个"]}]}
硬性要求:
- 每个 cap 必须能在该插件 desc 中找到依据（同义改写可接受，禁止凭空编造）
- caps 3-5 个，每个优先 ≥3 字具体词
- 禁止单独输出: 界面/工具/插件/管理/集成/研究/安全/记忆/视觉/设计/系统/通知/搜索/监控/会话/文档/阅读/模式
- 只处理输入中存在的 id`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) throw new Error(`API ${resp.status}`);
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      const valid = new Set(batch.map(p => p.id));
      let arr = [];
      try {
        const parsed = JSON.parse(content);
        arr = Array.isArray(parsed) ? parsed : parsed.plugins || [];
      } catch {}
      const ok = arr.filter(x => valid.has(x.id) && Array.isArray(x.caps) && x.caps.length);
      if (ok.length) return ok;
    } catch (e) {
      if (attempt === 2) console.warn('batch fail:', e.message);
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  return [];
}

function groundedCaps(caps, desc) {
  const cleaned = (caps || []).filter(c => c && !GENERIC.has(c) && String(c).length >= 2);
  if (!cleaned.length) return [];
  const d = (desc || '').toLowerCase();
  const grounded = cleaned.filter(c => {
    if (d.includes(String(c).toLowerCase())) return true;
    const s = String(c).toLowerCase();
    if (s.length < 2 || !/[\u4e00-\u9fa5]/.test(s)) return false;
    let hit = 0, tot = 0;
    for (let i = 0; i < s.length - 1; i++) {
      tot++;
      if (d.includes(s.slice(i, i + 2))) hit++;
    }
    return tot > 0 && hit / tot >= 0.5;
  });
  // 英文 desc + 中文 caps 时常无字面命中：有依据门控优先，否则保留清洗结果
  return grounded.length >= 2 ? grounded : cleaned;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const markOnly = process.argv.includes('--mark-only');
  const li = process.argv.indexOf('--limit');
  const limit = li >= 0 ? parseInt(process.argv[li + 1], 10) || 40 : 40;

  const plugins = JSON.parse(fs.readFileSync(ALL, 'utf8'));
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const storeById = new Map(store.map(p => [p.id, p]));

  const marked = markNoDesc(plugins, storeById);
  console.log(`无desc标记: category补=${marked.catN} name-guess=${marked.guessN}`);

  // 让 equip 缓存读到最新（写盘前先按内存算）
  const before = (() => {
    let low = 0;
    for (const p of plugins) {
      if (p.source !== 'generated') continue;
      // 临时用简化质量估计（与 equip.capQuality 同公式，避免缓存旧文件）
      if (capQuality(p, plugins) < 0.4) low++;
    }
    return low;
  })();
  console.log(`capQuality<0.4 当前约 ${before} 条`);

  if (markOnly) {
    if (apply) {
      fs.writeFileSync(ALL, JSON.stringify(plugins, null, 2));
      console.log(`已写回标记 → ${ALL}`);
    } else {
      console.log('预览标记完成。加 --apply --mark-only 写回');
    }
    return;
  }

  // 清缓存后按磁盘+内存重算目标：先写标记再选队列更准
  if (apply && (marked.catN || marked.guessN)) {
    fs.writeFileSync(ALL, JSON.stringify(plugins, null, 2));
  }

  // 强制重载
  loadPlugins(true);
  const fresh = loadPlugins(true);
  // 用磁盘最新合并：若刚写过则 fresh；否则用内存 plugins
  const pool = apply && (marked.catN || marked.guessN) ? fresh : plugins;
  const targets = selectTargets(pool, limit);
  console.log(`选择性重生成目标 ${targets.length}/${limit}（已排除无desc/name-guess）`);
  if (!targets.length) {
    if (apply && (marked.catN || marked.guessN)) console.log('仅标记已写回，无需 LLM');
    return;
  }

  const byId = new Map(pool.map(p => [p.id, p]));
  const generated = [];
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const r = await genBatch(batch);
    generated.push(...r);
    console.log(`批 ${Math.floor(i / BATCH) + 1}: +${r.length} 累计 ${generated.length}`);
  }

  if (!apply) {
    console.log(`预览 ${generated.length} 条。样例:`, JSON.stringify(generated.slice(0, 3), null, 2));
    console.log('加 --apply 写回 plugins-all.json');
    return;
  }

  let updated = 0;
  for (const g of generated) {
    const p = byId.get(g.id);
    if (!p) continue;
    const caps = groundedCaps(g.caps, p.desc);
    if (caps.length < 2) continue;
    p.capabilities = caps.slice(0, 5);
    if (g.tags && g.tags.length) p.tags = g.tags;
    delete p.capsSource; // LLM 有依据，取消 name-guess
    updated++;
  }
  fs.writeFileSync(ALL, JSON.stringify(pool, null, 2));
  console.log(`已更新 caps ${updated} 条 → ${ALL}`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
