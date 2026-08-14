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

// 测 3：preselect 预筛规模上限（两阶段检索，防全量塞 prompt；上限 PRESELECT_POOL_CAP=48）
test('preselect 候选池 ≤ 48（总池 cap）', () => {
  const all = loadPlugins();
  const pool = preselect(all, '帮我做一份深度研究报告，需要看实验图片');
  assert.ok(pool.length <= 48, `候选池应 ≤48，实际 ${pool.length}`);
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

// 测 5：HTML 转义（Bug 4 回归）——自包含：动态渲染到内存字符串断言
test('equip-html 渲染 XSS 转义', () => {
  const { render } = require('./equip-html.js');
  const r = {
    task: '<script>alert(1)</script>任务',
    score: '1.00', breakdown: { match: 1, synergy: 0, conflict: 0, cost: 0, trust: 0, feedback: 0, budget: 0 },
    chosen: [{ id: 'x/a', name: '<img src=x onerror=alert(2)>', slot: 'action', cost: 0.3, complements: [], conflicts: [], stars: null, install: { cmd: 'dsh plugin add x/a; <script>' } }],
    install: [{ cmd: 'dsh plugin add x/a; <script>', slot: 'action', name: 'bad' }],
    srcInfo: [], overBudget: false, llmReason: '<b>注入</b>',
  };
  const html = render(r);
  assert.ok(!html.includes('<script>alert'), '输出不应包含未转义的 script 标签');
  assert.ok(html.includes('&lt;script&gt;'), '应包含转义后的 script');
  assert.ok(!html.includes('<img src=x onerror'), 'name 应被转义');
  assert.ok(html.includes('&lt;b&gt;'), 'llmReason 应被转义');
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
