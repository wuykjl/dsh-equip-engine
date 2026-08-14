// 最小回归测试（node:test，零依赖）——覆盖 5 个已修 bug，防回归
// 运行: node --test src/equip.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const { comboScore, matchScore, preselect, loadPlugins } = require('./equip.js');

// 测 1：冲突/协同按边去重（Bug 2 回归）——双向声明只计一次
test('comboScore 冲突按边计一次（双向声明不双计）', () => {
  const a = { id: 'x/a', slot: 'decision', capabilities: ['研究'], conflicts: ['x/b'], complements: [], cost: 0.4, source: 'manual', stars: null };
  const b = { id: 'x/b', slot: 'action', capabilities: ['研究'], conflicts: ['x/a'], complements: [], cost: 0.4, source: 'manual', stars: null };
  const r = comboScore([{ p: a, m: 0.5 }, { p: b, m: 0.5 }], '研究任务', 'research');
  assert.strictEqual(r.breakdown.conflict, 1.5, '双向冲突应只计 1.5，而非 3.0');
});

// 测 2：matchScore 大小写不敏感（JSON/json 互通）
test('matchScore 大小写不敏感', () => {
  const p = { id: 'x/t', slot: 'action', capabilities: ['json', 'csv'], tags: [], source: 'manual', stars: null };
  const m = matchScore(p, '处理大量 JSON 和 CSV 文件');
  assert.ok(m > 0, 'JSON 应匹配 json capability');
});

// 测 3：preselect 预筛规模上限（两阶段检索，防全量塞 prompt）
test('preselect 候选池 ≤ 30（5 槽 × 6）', () => {
  const all = loadPlugins();
  const pool = preselect(all, '帮我做一份深度研究报告，需要看实验图片');
  assert.ok(pool.length <= 30, `候选池应 ≤30，实际 ${pool.length}`);
  assert.ok(pool.length > 0, '候选池不应为空');
});

// 测 4：生成库泛词降权（generated 2 字词 0.4；manual 不降）
test('matchScore 泛词降权只针对 generated 源', () => {
  const gen = { id: 'x/g', slot: 'action', capabilities: ['研究'], tags: [], source: 'generated', stars: null };
  const man = { id: 'x/m', slot: 'action', capabilities: ['研究'], tags: [], source: 'manual', stars: null };
  const mg = matchScore(gen, '深度研究报告');
  const mm = matchScore(man, '深度研究报告');
  assert.ok(mm > mg, `manual 的精确词不应被降权（${mm} > ${mg}）`);
});

// 测 5：HTML 转义（Bug 4 回归）——渲染输出不含原始 <script>
test('equip-html 渲染 XSS 转义', () => {
  const out = path.join(process.env.DSH_EQUIP_DATA || path.join(require('os').homedir(), '.dsh-equip', 'data'), 'equip.html');
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(!html.includes('<script>alert'), '输出不应包含未转义的 script 标签');
  assert.ok(html.includes('&lt;script&gt;'), '应包含转义后的 script');
});

// 测 6：兜底宁缺毋滥（Bug 5 回归）——无匹配的槽不强制 top-1
test('topCandidates 无匹配返回空（宁缺毋滥）', () => {
  const { topCandidates } = require('./equip.js');
  // 构造一个无任何匹配的槽
  const active = [{ slot: 'memory', candidates: [{ id: 'x/only', slot: 'memory', capabilities: ['量子纠缠观测'], tags: [], source: 'manual', stars: null }] }];
  const t = topCandidates(active, '写代码处理 JSON', 2, []);
  const picks = t[0].picks;
  assert.strictEqual(picks.length, 0, '无匹配时应为空槽，而非强制 top-1');
});
