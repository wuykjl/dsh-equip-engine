// 三轮基准测试：4 任务 × (3 轮 LLM + 规则对照) → 配装稳定性 + 评分分布
// 运行: node src/bench3.js
'use strict';
const { loadPlugins, matchScore, comboScore, equip } = require('./equip.js');
const { llmRetrieve } = require('./llm.js');

const TASKS = [
  ['L1', '帮我做一份关于细胞基因编辑的深度研究报告，需要看实验图片并整理成文档'],
  ['L2', '写代码时要处理大量 JSON 和 CSV 文件，同时希望看到上下文占用情况'],
  ['L3', '在终端里做渗透测试，需要 OCR 识别截图里的验证码'],
  ['L4', '用深度研究编排器做多步研究，输出一份深度研究报告'],
];
const ROUNDS = 3;

async function llmBuild(task, plugins) {
  const { preselect, detectTaskTypes } = require('./equip.js');
  const pool = preselect(plugins, task);
  const { slots } = await llmRetrieve(task, pool);
  const picks = [];
  for (const [, ids] of Object.entries(slots)) {
    for (const id of ids) {
      const p = plugins.find(x => x.id === id);
      if (p) picks.push({ p, m: matchScore(p, task, plugins) });
    }
  }
  const score = comboScore(picks, task, detectTaskTypes(task));
  return {
    combo: picks.map(x => x.p.id).sort().join('+'),
    ids: picks.map(x => x.p.id),
    score: score.total,
  };
}

async function main() {
  const plugins = loadPlugins();
  console.log('任务 | 轮次 | 配装组合 | 评分');
  console.log('-----|------|----------|-----');
  const summary = [];
  for (const [name, task] of TASKS) {
    const rounds = [];
    for (let i = 0; i < ROUNDS; i++) {
      const r = await llmBuild(task, plugins);
      rounds.push(r);
      console.log(`${name} | 轮${i + 1} | ${r.combo || '(空)'} | ${r.score.toFixed(2)}`);
    }
    const rule = equip(task);
    const ruleCombo = (rule.build || []).map(l => l.replace(/\s+/g, ' ').trim().slice(0, 46)).join(' | ');
    console.log(`${name} | 规则 | ${ruleCombo || '(空)'} | ${rule.score}`);
    // 稳定性
    const unique = new Set(rounds.map(r => r.combo));
    const scores = rounds.map(r => r.score);
    const stable = unique.size === 1 ? '稳定' : `波动(${unique.size}种)`;
    summary.push({ name, stable, uniq: unique.size, scoreMin: Math.min(...scores).toFixed(2), scoreMax: Math.max(...scores).toFixed(2) });
  }
  console.log('\n=== 汇总 ===');
  for (const s of summary) {
    console.log(`${s.name}: ${s.stable} | 3轮评分 ${s.scoreMin}~${s.scoreMax} | 组合种类 ${s.uniq}`);
  }
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
