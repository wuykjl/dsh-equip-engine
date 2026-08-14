// LLM 配装入口：两阶段预筛 + LLM 精排 + 组合评分
// 运行: node src/equip-llm.js "任务描述"
'use strict';
const {
  loadPlugins, matchScore, comboScore, explain, detectTaskTypes, preselect, blendSlotWeights,
} = require('./equip.js');
const { llmRetrieve } = require('./llm.js');

async function main() {
  const task = process.argv.slice(2).join(' ');
  if (!task) { console.error('用法: node src/equip-llm.js "任务描述"'); process.exit(1); }

  const plugins = loadPlugins();
  const taskTypes = detectTaskTypes(task);
  const weights = blendSlotWeights(taskTypes);
  const pool = preselect(plugins, task);
  const t0 = Date.now();
  const { slots, reason } = await llmRetrieve(task, pool);
  const ms = Date.now() - t0;

  const picks = [];
  for (const [, ids] of Object.entries(slots)) {
    for (const id of ids) {
      const p = plugins.find(x => x.id === id);
      if (p) picks.push({ p, m: matchScore(p, task, plugins) });
    }
  }
  const score = comboScore(picks, task, taskTypes);

  console.log(`\n任务: ${task}`);
  console.log(`任务类型: ${taskTypes.map(t => t.type).join('+')} | 预筛 ${pool.length} → LLM`);
  console.log(`LLM 判断: ${reason || '-'}`);
  console.log(`检索耗时: ${ms}ms | 组合评分: ${score.total.toFixed(2)}`);
  console.log('配装建议:');
  console.log(explain(picks.map(x => x.p), task, score.breakdown, weights, plugins).join('\n') || '  无候选');
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
