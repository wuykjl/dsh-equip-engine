// 生成完整 manifest：现有手工条目 + awesome 提取条目（LLM 批量生成中文能力）
// 用法: node scripts/gen-manifests.js
'use strict';
const fs = require('fs');
const path = require('path');
const { llmRetrieve, getApiKey } = require('../src/llm.js');

const API = 'https://api.deepseek.com/chat/completions';
const RAW = path.join(__dirname, '..', 'data', 'awesome-raw.json');
const EXISTING = path.join(__dirname, '..', 'data', 'plugins.json');
const OUT = path.join(__dirname, '..', 'data', 'plugins-full.json');
const BATCH = 40; // 80 会超 LLM 输出上限截断（2026-08-15 实测），40 稳

async function genBatch(batch, retries = 2) {
  const key = getApiKey();
  const list = batch.map(p => `[${p.id}] slot=${p.slot} desc=${p.desc.slice(0, 120)}`).join('\n');
  const prompt = `你是 AI 插件分类专家。为每个插件从 desc 抽取可区分的中文能力标签。
输入:
${list}
输出 JSON（不要其他文字），格式: {"plugins":[{"id":"<原样id>","caps":["中文能力词3-6个"],"tags":["中文领域标签1-3个"]}]}
硬性要求:
1. caps 必须能从 desc 推断，优先 3 字以上具体词，禁止空泛词单独成条
2. 禁止单独输出: 界面/工具/插件/管理/集成/研究/安全/记忆/视觉/设计/系统/通知/搜索/监控
3. 只处理输入中存在的 id，禁止编造`;
  for (let attempt = 0; attempt <= retries; attempt++) {
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
      let arr;
      try {
        const parsed = JSON.parse(content);
        arr = Array.isArray(parsed) ? parsed : parsed.plugins || [];
      } catch { arr = []; }
      const ok = arr.filter(x => valid.has(x.id));
      if (ok.length) return ok;
    } catch (e) { if (attempt === retries) throw e; }
    await new Promise(r => setTimeout(r, 1500)); // 退避重试
  }
  return [];
}

async function main() {
  const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
  // 补漏模式：existing 从 plugins-full.json 读（若存在）
  const existingPath = process.argv.includes('--resume') && fs.existsSync(OUT) ? OUT : EXISTING;
  const existing = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
  const existingIds = new Set(existing.map(p => p.id));

  const need = raw.filter(p => !existingIds.has(p.id));
  console.log(`已有 ${existing.length} | awesome ${raw.length} | 需生成 ${need.length}`);

  const generated = [];
  for (let i = 0; i < need.length; i += BATCH) {
    const batch = need.slice(i, i + BATCH);
    const r = await genBatch(batch);
    generated.push(...r);
    console.log(`批 ${i / BATCH + 1}: 生成 ${r.length}/${batch.length}`);
  }
  const genIds = new Set(generated.map(g => g.id));

  // 合并：手工优先；生成条目补默认字段
  const full = existing.map(p => ({ ...p }));
  for (const g of generated) {
    full.push({
      id: g.id, name: g.id, slot: (raw.find(p => p.id === g.id) || {}).slot || 'action',
      capabilities: g.caps || [], tags: g.tags || [],
      conflicts: [], complements: [], cost: 0.3,
      stars: null, requirements: { os: ['win32'] },
      desc: (raw.find(p => p.id === g.id) || {}).desc || '',
    });
  }
  fs.writeFileSync(OUT, JSON.stringify(full, null, 2));
  console.log(`完成: ${full.length} 个插件 → ${OUT}（生成 ${generated.length}，未生成 ${need.length - generated.length}）`);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
