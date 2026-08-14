// 配装引擎 v3 — 缓存 + 停用词 + 多标签加权 + 预算软惩罚 + TF-IDF 预筛
// 运行: node src/equip.js "任务描述" | --accept/--reject <id> | --ban/--unban <id>
'use strict';
const fs = require('fs');
const path = require('path');
const { llmRetrieve } = require('./llm.js');

const DATA = path.join(__dirname, '..', 'data', 'plugins-all.json');
const FEEDBACK = path.join(__dirname, '..', 'data', 'feedback.json');
const BLACKLIST = path.join(__dirname, '..', 'data', 'blacklist.json');
const SLOTS = ['perception', 'decision', 'action', 'memory', 'output'];

const COST_WEIGHT = 0.3, SYNERGY_BONUS = 0.5, CONFLICT_PENALTY = 1.5, TRUST_WEIGHT = 0.15;
const MAX_COST = 1.5;
const BUDGET_PENALTY = 0.8; // 超预算软惩罚 λ
const CAP_STOP_THRESHOLD = 30; // 出现次数 >N 的 generated cap 当停用词
const STOPWORD_HIT = 0.1;

const SLOT_TRIGGERS = {
  perception: ['图片', '图像', '视觉', 'ocr', '截图', '识别', '爬取', '抓取', '视频', '内容发现', '验证码', 'ui还原', 'gui', '看图', '看图片', '实验图片'],
  decision: ['研究', '分析', '规划', '计划', '推理', '学习', '编排', '科研', '实验', '报告', '决策', '综述', 'workflow'],
  action: ['工具', '执行', '编码', '代码', 'shell', '安全', '逆向', '渗透', '计算', '写代码', '编程', '漏洞', '审计'],
  memory: ['记忆', '上下文', '会话', 'token', '压缩', '摘要', '审计', '挂载', '跨会话', '省token'],
  output: ['界面', 'tui', '桌面', '显示', '呈现', '设计', '导出', '终端', '图表', '可视化', 'ppt', '皮肤', '宠物'],
};

const SLOT_WEIGHTS = {
  research: { perception: 0.8, decision: 1.5, action: 0.6, memory: 0.8, output: 0.7 },
  coding:   { perception: 0.3, decision: 0.8, action: 1.5, memory: 0.7, output: 0.5 },
  vision:   { perception: 1.5, decision: 0.5, action: 0.4, memory: 0.4, output: 0.8 },
  memory:   { perception: 0.3, decision: 0.6, action: 0.4, memory: 1.5, output: 0.4 },
  general:  { perception: 1.0, decision: 1.0, action: 1.0, memory: 1.0, output: 1.0 },
};

const TASK_TYPE_PATTERNS = [
  ['research', /(研究|报告|综述|调研|分析|深度)/],
  ['coding', /(编码|代码|写代码|编程|debug|修复|json|csv)/i],
  ['vision', /(图片|视觉|截图|ocr|看图|识别|图像)/],
  ['memory', /(记忆|会话|记忆库|上下文管理)/],
];

// —— 进程内缓存 ——
let _plugins = null, _pluginsMtime = 0;
let _feedback = null, _feedbackMtime = 0;
let _blacklist = null, _blacklistMtime = 0;
let _capFreq = null, _stopCaps = null;
let _tfidf = null; // { vocab, idf, vectors: Map(id→Float32-like obj), docs }

function fileMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

function loadPlugins(force = false) {
  const mt = fileMtime(DATA);
  if (!force && _plugins && mt === _pluginsMtime) return _plugins;
  _plugins = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  _pluginsMtime = mt;
  _capFreq = null; _stopCaps = null; _tfidf = null;
  return _plugins;
}

function loadFeedback(force = false) {
  const mt = fileMtime(FEEDBACK);
  if (!force && _feedback && mt === _feedbackMtime) return _feedback;
  try { _feedback = JSON.parse(fs.readFileSync(FEEDBACK, 'utf8')); }
  catch { _feedback = {}; }
  _feedbackMtime = mt;
  return _feedback;
}

function saveFeedback(fb) {
  fs.writeFileSync(FEEDBACK, JSON.stringify(fb, null, 2));
  _feedback = fb; _feedbackMtime = fileMtime(FEEDBACK);
}

function loadBlacklist(force = false) {
  const mt = fileMtime(BLACKLIST);
  if (!force && _blacklist && mt === _blacklistMtime) return _blacklist;
  try { _blacklist = JSON.parse(fs.readFileSync(BLACKLIST, 'utf8')); }
  catch { _blacklist = []; }
  _blacklistMtime = mt;
  return _blacklist;
}

function saveBlacklist(b) {
  fs.writeFileSync(BLACKLIST, JSON.stringify(b, null, 2));
  _blacklist = b; _blacklistMtime = fileMtime(BLACKLIST);
}

function pluginIndex(plugins) {
  const m = new Map();
  for (const p of plugins) m.set(p.id, p);
  return m;
}

function capFrequency(plugins) {
  if (_capFreq) return _capFreq;
  const freq = new Map();
  for (const p of plugins) {
    if (p.source !== 'generated') continue;
    for (const c of p.capabilities || []) freq.set(c, (freq.get(c) || 0) + 1);
  }
  _capFreq = freq;
  _stopCaps = new Set([...freq.entries()].filter(([, n]) => n > CAP_STOP_THRESHOLD).map(([c]) => c));
  return freq;
}

function stopCaps(plugins) {
  capFrequency(plugins);
  return _stopCaps;
}

// 多标签任务类型：返回 [{type, weight}]，权重归一
function detectTaskTypes(task) {
  const hits = [];
  for (const [type, re] of TASK_TYPE_PATTERNS) {
    if (re.test(task)) hits.push(type);
  }
  if (!hits.length) return [{ type: 'general', weight: 1 }];
  const w = 1 / hits.length;
  return hits.map(type => ({ type, weight: w }));
}

function detectTaskType(task) {
  // 兼容旧接口：返回主类型（权重最高的第一个）
  return detectTaskTypes(task)[0].type;
}

function blendSlotWeights(taskTypes) {
  const out = { perception: 0, decision: 0, action: 0, memory: 0, output: 0 };
  for (const { type, weight } of taskTypes) {
    const sw = SLOT_WEIGHTS[type] || SLOT_WEIGHTS.general;
    for (const s of SLOTS) out[s] += (sw[s] || 1) * weight;
  }
  return out;
}

function trustScore(p) {
  let s = 0.5;
  if (p.stars != null) s = Math.log10(p.stars + 1) / Math.log10(100000 + 1);
  if (p.testStatus === 'verified' || p.verified) s += 0.1;
  if (p.testStatus === 'failed') s -= 0.2;
  if (p.testStatus === 'needs-build') s -= 0.05;
  return Math.min(1, Math.max(0, s));
}

function feedbackScore(p, fb) {
  const f = fb[p.id];
  if (!f) return 0;
  return (f.accepts + 1) / (f.accepts + f.rejects + 2) - 0.5;
}

function matchScore(p, task, plugins) {
  const t = task.toLowerCase();
  const stops = p.source === 'generated' ? stopCaps(plugins || loadPlugins()) : null;
  let hits = 0;
  for (const c of p.capabilities || []) {
    const cl = c.toLowerCase();
    if (!t.includes(cl)) continue;
    if (p.source === 'generated') {
      if (stops && stops.has(c)) hits += STOPWORD_HIT;
      else if (/^[\u4e00-\u9fa5]{1,2}$/.test(c)) hits += 0.4;
      else hits += 1;
    } else {
      hits += 1;
    }
  }
  for (const tag of p.tags || []) if (t.includes(tag.toLowerCase())) hits += 0.3;
  return Math.min(1, hits * 0.4 + (t.includes((p.name || '').toLowerCase()) ? 0.3 : 0));
}

// —— 轻量 TF-IDF「embedding」预筛（本地，无外部模型） ——
function tokenize(text) {
  if (!text) return [];
  const s = String(text).toLowerCase();
  const zh = s.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  const en = s.match(/[a-z0-9]{2,}/g) || [];
  // 也切 2-gram 中文提升召回
  const grams = [];
  for (const w of zh) {
    if (w.length >= 3) {
      for (let i = 0; i < w.length - 1; i++) grams.push(w.slice(i, i + 2));
    }
  }
  return [...zh, ...en, ...grams];
}

function pluginText(p) {
  return [p.desc, ...(p.capabilities || []), ...(p.tags || []), p.name, p.display].filter(Boolean).join(' ');
}

function buildTfidf(plugins) {
  if (_tfidf) return _tfidf;
  const docs = plugins.map(p => ({ id: p.id, tokens: tokenize(pluginText(p)), slot: p.slot }));
  const df = new Map();
  for (const d of docs) {
    for (const t of new Set(d.tokens)) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = docs.length;
  const idf = new Map();
  for (const [t, c] of df) idf.set(t, Math.log((N + 1) / (c + 1)) + 1);
  const vectors = new Map();
  for (const d of docs) {
    const tf = new Map();
    for (const t of d.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    let norm = 0;
    for (const [t, f] of tf) {
      const w = (f / d.tokens.length) * (idf.get(t) || 0);
      if (w > 0) { vec.set(t, w); norm += w * w; }
    }
    vectors.set(d.id, { vec, norm: Math.sqrt(norm) || 1, slot: d.slot });
  }
  _tfidf = { idf, vectors };
  return _tfidf;
}

function cosineTask(task, entry, idf) {
  const tokens = tokenize(task);
  if (!tokens.length || !entry.norm) return 0;
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  let dot = 0, normQ = 0;
  for (const [t, f] of tf) {
    const w = (f / tokens.length) * (idf.get(t) || 0);
    normQ += w * w;
    if (entry.vec.has(t)) dot += w * entry.vec.get(t);
  }
  return dot / (Math.sqrt(normQ) * entry.norm || 1);
}

function activateSlots(plugins, task, weights) {
  const black = new Set(loadBlacklist());
  const active = [];
  for (const slot of SLOTS) {
    const inSlot = plugins.filter(p => p.slot === slot && !black.has(p.id));
    // 用 top-k 聚合替代全量和，避免大槽噪声膨胀
    const scores = inSlot.map(p => matchScore(p, task, plugins)).sort((a, b) => b - a);
    const agg = scores.slice(0, 5).reduce((s, v) => s + v, 0);
    const trigHits = (SLOT_TRIGGERS[slot] || []).filter(w => task.includes(w)).length;
    const score = (agg + trigHits * 0.3) * (weights[slot] || 1);
    if (score > 0) active.push({ slot, score, candidates: inSlot });
  }
  return active.sort((a, b) => b.score - a.score);
}

function topCandidates(active, task, n = 2, plugins) {
  return active.map(a => ({
    slot: a.slot,
    picks: (() => {
      const scored = a.candidates.map(p => ({ p, m: matchScore(p, task, plugins) }));
      const matched = scored.filter(x => x.m > (x.p.source === 'generated' ? 0.5 : 0));
      const pool = matched.length ? matched : scored.slice().sort((x, y) => y.m - x.m).slice(0, 1);
      return pool.sort((x, y) => y.m - x.m).slice(0, n);
    })(),
  }));
}

function comboScore(picks, task, taskTypeOrTypes, fbCache) {
  const taskTypes = Array.isArray(taskTypeOrTypes)
    ? taskTypeOrTypes
    : [{ type: taskTypeOrTypes || 'general', weight: 1 }];
  const weights = blendSlotWeights(taskTypes);
  const fb = fbCache || loadFeedback();
  const chosen = picks.map(x => x.p);
  const ids = new Set(chosen.map(p => p.id));
  const breakdown = { match: 0, synergy: 0, conflict: 0, cost: 0, trust: 0, feedback: 0, budget: 0 };
  let totalCost = 0;
  for (const { p, m } of picks) {
    const w = weights[p.slot] || 1;
    breakdown.match += m * w;
    for (const c of p.complements || []) if (ids.has(c) && p.id < c) breakdown.synergy += SYNERGY_BONUS;
    for (const c of p.conflicts || []) if (ids.has(c) && p.id < c) breakdown.conflict += CONFLICT_PENALTY;
    breakdown.cost += COST_WEIGHT * (p.cost || 0);
    totalCost += p.cost || 0;
    breakdown.trust += TRUST_WEIGHT * trustScore(p);
    breakdown.feedback += feedbackScore(p, fb);
  }
  // 超预算软惩罚
  if (totalCost > MAX_COST) {
    breakdown.budget = BUDGET_PENALTY * (totalCost - MAX_COST);
  }
  const total = breakdown.match + breakdown.synergy - breakdown.conflict - breakdown.cost
    + breakdown.trust + breakdown.feedback - breakdown.budget;
  return { total, breakdown, weights, fb, totalCost };
}

function cartesian(groups) {
  if (groups.length === 0) return [[]];
  const [head, ...rest] = groups;
  const tails = cartesian(rest);
  const out = [];
  for (const h of head) for (const t of tails) out.push([h, ...t]);
  return out;
}

function explain(chosen, task, breakdown, weights, plugins) {
  const ids = new Set(chosen.map(p => p.id));
  const fb = loadFeedback();
  const lines = [];
  for (const p of chosen) {
    const m = matchScore(p, task, plugins);
    const hitCaps = (p.capabilities || []).filter(c => task.includes(c));
    let why = hitCaps.length ? `命中:${hitCaps.join('/')}` : '兜底';
    const syn = (p.complements || []).filter(c => ids.has(c) && p.id < c);
    const con = (p.conflicts || []).filter(c => ids.has(c) && p.id < c);
    const fs_ = fb[p.id];
    if (syn.length) why += ` 协同+${(SYNERGY_BONUS * syn.length).toFixed(1)}`;
    if (con.length) why += ` 冲突-${(CONFLICT_PENALTY * con.length).toFixed(1)}`;
    if (p.stars != null) why += ` ⭐${p.stars >= 10000 ? (p.stars / 1000).toFixed(1) + 'k' : p.stars}`;
    if (fs_) why += ` 反馈${fs_.accepts}A/${fs_.rejects}R`;
    lines.push(`  [${p.slot}×${(weights[p.slot] || 1).toFixed(1)}] ${p.name} (匹配${m.toFixed(2)},成本${p.cost}) ${why}`);
  }
  return lines;
}

function equip(task) {
  const plugins = loadPlugins();
  const curated = plugins.filter(p => p.source !== 'generated');
  const taskTypes = detectTaskTypes(task);
  const weights = blendSlotWeights(taskTypes);
  const fb = loadFeedback();
  const active = activateSlots(curated, task, weights);
  if (active.length === 0) {
    return { task, taskType: taskTypes[0].type, taskTypes, slots: [], best: null, note: '未激活任何槽位', weights };
  }
  const groups = topCandidates(active, task, 3, plugins).map(g => g.picks.map(x => ({ p: x.p, m: x.m })));
  let best = null, bestScore = null;
  for (const combo of cartesian(groups)) {
    const r = comboScore(combo, task, taskTypes, fb);
    if (!bestScore || r.total > bestScore.total) { bestScore = r; best = combo; }
  }
  const chosen = best.map(x => x.p);
  const totalCost = bestScore.totalCost;
  return {
    task,
    taskType: taskTypes.map(t => t.type).join('+'),
    taskTypes,
    slots: active.map(a => `${a.slot}(${a.score.toFixed(2)})`),
    score: bestScore.total.toFixed(2),
    breakdown: bestScore.breakdown,
    weights,
    chosen,
    ids: chosen.map(p => p.id),
    install: chosen.map(installSpec),
    build: explain(chosen, task, bestScore.breakdown, weights, plugins),
    overBudget: totalCost > MAX_COST,
    totalCost: totalCost.toFixed(2),
  };
}

function feedback(op, id) {
  const plugins = loadPlugins();
  if (!plugins.find(p => p.id === id)) { console.error('未知插件:', id); process.exit(1); }
  const fb = loadFeedback(true);
  fb[id] = fb[id] || { accepts: 0, rejects: 0 };
  if (op === 'accept') fb[id].accepts += 1;
  else fb[id].rejects += 1;
  saveFeedback(fb);
  console.log(`${op} ${id} → 现在 ${fb[id].accepts}A/${fb[id].rejects}R`);
}

function blacklist(op, id) {
  const plugins = loadPlugins();
  if (!plugins.find(p => p.id === id)) { console.error('未知插件:', id); process.exit(1); }
  const bl = loadBlacklist(true);
  if (op === 'ban' && !bl.includes(id)) { bl.push(id); saveBlacklist(bl); }
  if (op === 'unban') { const i = bl.indexOf(id); if (i >= 0) { bl.splice(i, 1); saveBlacklist(bl); } }
  console.log(`黑名单(${op}) ${id} → 当前 ${bl.join(', ') || '(空)'}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--accept' || args[0] === '--reject') { feedback(args[0].slice(2), args[1]); process.exit(0); }
  if (args[0] === '--ban' || args[0] === '--unban') { blacklist(args[0].slice(2), args[1]); process.exit(0); }
  const task = args.join(' ');
  if (!task) { console.error('用法: node src/equip.js "任务" | --accept/--reject <id> | --ban/--unban <id>'); process.exit(1); }
  const r = equip(task);
  console.log(`\n任务: ${r.task}`);
  console.log(`任务类型: ${r.taskType} | 激活槽位: ${r.slots.join(', ') || '无'}`);
  const b = r.breakdown;
  const budgetPart = b.budget ? ` 预算-${b.budget.toFixed(2)}` : '';
  console.log(`组合评分: ${r.score}（匹配${b.match.toFixed(2)} 协同${b.synergy.toFixed(2)} 冲突-${b.conflict.toFixed(2)} 成本-${b.cost.toFixed(2)} 信任+${b.trust.toFixed(2)} 反馈${b.feedback.toFixed(2)}${budgetPart}）`);
  if (r.overBudget) console.log(`⚠ 超预算: 总成本 ${r.totalCost} > ${MAX_COST}（已软惩罚）`);
  console.log('配装建议:');
  console.log(r.build ? r.build.join('\n') : '  ' + r.note);
}

// 两阶段预筛：关键词 + TF-IDF 语义混合，每槽 topN
function preselect(plugins, task, perSlot = 6) {
  const black = new Set(loadBlacklist());
  const { idf, vectors } = buildTfidf(plugins);
  const scored = plugins.filter(p => !black.has(p.id)).map(p => {
    const kw = matchScore(p, task, plugins);
    const emb = cosineTask(task, vectors.get(p.id) || { vec: new Map(), norm: 1 }, idf);
    // 混合：关键词保精确，TF-IDF 补语义召回
    return { p, m: kw * 0.55 + emb * 0.45, kw, emb };
  });
  const picks = [];
  for (const slot of SLOTS) {
    const inSlot = scored.filter(x => x.p.slot === slot)
      .sort((a, b) => b.m - a.m)
      .slice(0, perSlot);
    picks.push(...inSlot.map(x => x.p));
  }
  return picks;
}

async function equipMix(task) {
  const plugins = loadPlugins();
  const byId = pluginIndex(plugins);
  const taskTypes = detectTaskTypes(task);
  const weights = blendSlotWeights(taskTypes);
  const fb = loadFeedback();

  const curated = plugins.filter(p => p.source !== 'generated');
  const active = activateSlots(curated, task, weights);
  const ruleBySlot = {};
  for (const a of topCandidates(active, task, 3, plugins)) {
    ruleBySlot[a.slot] = (ruleBySlot[a.slot] || []).concat(a.picks.map(x => x.p.id));
  }

  let llmBySlot = {}, llmReason = '', llmError = null;
  try {
    const pool = preselect(plugins, task);
    const r = await llmRetrieve(task, pool);
    llmBySlot = r.slots; llmReason = r.reason;
  } catch (e) { llmError = e.message; }

  const allSlots = new Set([...Object.keys(ruleBySlot), ...Object.keys(llmBySlot)]);
  const groups = [], src = {};
  for (const slot of allSlots) {
    const ruleIds = ruleBySlot[slot] || [], llmIds = llmBySlot[slot] || [];
    const ids = new Set([...ruleIds, ...llmIds]);
    const cands = [...ids].map(id => {
      const p = byId.get(id);
      if (!p) return null;
      const inR = ruleIds.includes(id), inL = llmIds.includes(id);
      src[id] = inR && inL ? 'both' : inR ? 'rule' : 'llm';
      const m = matchScore(p, task, plugins);
      if (!inR && inL && m < 0.5) return null;
      return { p, m };
    }).filter(Boolean).sort((a, b) => b.m - a.m).slice(0, 3);
    if (cands.length) groups.push(cands);
  }

  if (!groups.length) {
    return {
      task, taskType: taskTypes.map(t => t.type).join('+'), taskTypes, slots: [],
      score: '0.00', breakdown: { match: 0, synergy: 0, conflict: 0, cost: 0, trust: 0, feedback: 0, budget: 0 },
      chosen: [], ids: [], install: [],
      build: [], llmReason, llmError, overBudget: false, totalCost: '0.00',
    };
  }

  let best = null, bestScore = null;
  for (const combo of cartesian(groups)) {
    const r = comboScore(combo, task, taskTypes, fb);
    if (!bestScore || r.total > bestScore.total) { bestScore = r; best = combo; }
  }
  const chosen = best.map(x => x.p);
  const totalCost = bestScore.totalCost;
  const build = explain(chosen, task, bestScore.breakdown, weights, plugins)
    .map((line, i) => `${line} [${src[chosen[i].id]}]`);
  return {
    task,
    taskType: taskTypes.map(t => t.type).join('+'),
    taskTypes,
    slots: [...allSlots],
    score: bestScore.total.toFixed(2),
    breakdown: bestScore.breakdown,
    chosen, ids: chosen.map(p => p.id),
    install: chosen.map(installSpec),
    sources: Object.fromEntries(chosen.map(p => [p.id, src[p.id]])),
    build, llmReason, llmError,
    overBudget: totalCost > MAX_COST,
    totalCost: totalCost.toFixed(2),
  };
}

/** 可安装清单（不执行）：git + dsh 风格命令 */
function installSpec(p) {
  const id = p.id;
  const repo = id.includes('#') ? id.split('#')[0] : id;
  const git = `https://github.com/${repo}`;
  return {
    id,
    git,
    cmd: `dsh plugin add ${repo}`,
    slot: p.slot,
    name: p.name,
    cost: p.cost,
  };
}

/** 关键词-only 预筛（AB 对比用） */
function preselectKw(plugins, task, perSlot = 6) {
  const black = new Set(loadBlacklist());
  const scored = plugins.filter(p => !black.has(p.id)).map(p => ({
    p, m: matchScore(p, task, plugins),
  }));
  const picks = [];
  for (const slot of SLOTS) {
    const inSlot = scored.filter(x => x.p.slot === slot)
      .sort((a, b) => b.m - a.m)
      .slice(0, perSlot);
    picks.push(...inSlot.map(x => x.p));
  }
  return picks;
}

module.exports = {
  equip, equipMix, loadPlugins, matchScore, comboScore, explain, detectTaskType,
  detectTaskTypes, preselect, preselectKw, blendSlotWeights, pluginIndex, stopCaps,
  MAX_COST, SLOT_WEIGHTS, SLOTS, buildTfidf, cosineTask, installSpec,
};
