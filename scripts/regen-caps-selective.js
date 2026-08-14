// 选择性 caps 重生成：仅泛词-only / 空 desc / 启发式入库条目
// 用法: node scripts/regen-caps-selective.js [--limit 40] [--apply]
'use strict';
const fs = require('fs');
const path = require('path');
const { getApiKey } = require('../src/llm.js');

const ALL = path.join(__dirname, '..', 'data', 'plugins-all.json');
const API = 'https://api.deepseek.com/chat/completions';
const BATCH = 20;
const GENERIC = new Set([
  '界面', '工具', '插件', '管理', '集成', '研究', '安全', '记忆', '视觉', '设计',
  '系统', '通知', '搜索', '监控', '文档', '阅读', '模式', '设置', '路由', '模型',
  '会话', '日志', '解释', '学习', '步骤',
]);

function isWeakCaps(caps) {
  if (!caps || !caps.length) return true;
  return caps.every(c => GENERIC.has(c) || /^[\u4e00-\u9fa5]{1,2}$/.test(c) || /^[a-z0-9]{1,4}$/i.test(c));
}

function selectTargets(plugins, limit) {
  const heurIds = new Set([
    'icetomoyo/dsh_workflow', 'DDDFXYqiming/Agent_Extensions', 'WindLX/paper_plane_x',
    'bernardleex526/oh_my_deepseek_harness', 'silencieuxzero/Better_Deepseek_Harkness',
    'Gcsimple/Emoji_Desktop_Pet', 'Alyosha28/deep_option', 'wuxiaoji/Dsh_Desktop',
    'ReLuckyLucy/dsh_Rhine_Lab_themo', 'WindLX/paper_plane_x_dsh', 'huantian1223/dsh_desktop',
    'Stone623/ai_skills', 'CaseyTso/analyze_image_tool', 'honghudavy-star/DSH_plugins_4U',
    'Seom-ingit/vision_kit',
  ]);
  const scored = [];
  for (const p of plugins) {
    if (p.source !== 'generated') continue;
    const noDesc = !p.desc || p.desc === 'No description';
    const weak = isWeakCaps(p.capabilities);
    const heur = heurIds.has(p.id);
    if (!weak && !heur && !noDesc) continue;
    // 优先：启发式 > 无desc+弱caps > 仅弱caps
    let pri = 3;
    if (heur) pri = 0;
    else if (noDesc && weak) pri = 1;
    else if (weak && p.desc && p.desc.length > 30) pri = 2;
    else continue;
    scored.push({ p, pri });
  }
  scored.sort((a, b) => a.pri - b.pri || (b.p.stars || 0) - (a.p.stars || 0));
  return scored.slice(0, limit).map(x => x.p);
}

async function genBatch(batch) {
  const key = getApiKey();
  if (!key) throw new Error('未找到 DEEPSEEK_API_KEY');
  const list = batch.map(p => `[${p.id}] slot=${p.slot} name=${p.name} desc=${(p.desc || 'No description').slice(0, 120)}`).join('\n');
  const prompt = `你是 AI 插件分类专家。为每个插件从 name/desc 抽取可区分的中文能力标签。
输入:
${list}
输出 JSON: {"plugins":[{"id":"<原样id>","caps":["中文能力词3-5个"],"tags":["领域1-2个"]}]}
硬性要求: caps 优先 3 字以上具体词；禁止单独输出 界面/工具/插件/管理/集成/研究/安全/记忆/视觉/设计/系统/通知/搜索/监控/会话；只处理输入中存在的 id。`;
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

async function main() {
  const apply = process.argv.includes('--apply');
  const li = process.argv.indexOf('--limit');
  const limit = li >= 0 ? parseInt(process.argv[li + 1], 10) || 40 : 40;

  const plugins = JSON.parse(fs.readFileSync(ALL, 'utf8'));
  const targets = selectTargets(plugins, limit);
  console.log(`选择性重生成目标 ${targets.length}/${limit}`);
  if (!targets.length) return;

  const byId = new Map(plugins.map(p => [p.id, p]));
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
    const caps = (g.caps || []).filter(c => c && !GENERIC.has(c));
    if (!caps.length) continue;
    p.capabilities = caps;
    if (g.tags && g.tags.length) p.tags = g.tags;
    updated++;
  }
  fs.writeFileSync(ALL, JSON.stringify(plugins, null, 2));
  console.log(`已更新 caps ${updated} 条 → ${ALL}`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
