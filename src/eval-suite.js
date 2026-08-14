// 金标评测：规则版 / 预筛召回 / 可选混合稳定性
// 用法:
//   node src/eval-suite.js            # 规则 + 召回（无 API）
//   node src/eval-suite.js --mix      # 含 equipMix（需 API，每任务 1 轮）
//   node src/eval-suite.js --mix --rounds 3
'use strict';
const fs = require('fs');
const path = require('path');
const {
  equip, equipMix, loadPlugins, preselect, preselectKw, SLOTS,
} = require('./equip.js');

const GOLD = path.join(__dirname, '..', 'data', 'gold.json');
const OUT = path.join(__dirname, '..', 'data', 'eval-last.json');

function parseChosen(r) {
  if (r.ids && r.ids.length) return r.ids;
  if (r.chosen) return r.chosen.map(p => p.id);
  return [];
}

function checkCase(g, ids, slotList) {
  const set = new Set(ids);
  const fail = [];
  for (const id of g.must || []) {
    if (!set.has(id)) fail.push(`missing must:${id}`);
  }
  if ((g.mustAny || []).length) {
    if (!g.mustAny.some(id => set.has(id))) fail.push(`missing mustAny:[${g.mustAny.join('|')}]`);
  }
  for (const id of g.mustNot || []) {
    if (set.has(id)) fail.push(`forbidden:${id}`);
  }
  for (const pair of g.mustNotTogether || []) {
    if (pair.every(id => set.has(id))) fail.push(`together:${pair.join('+')}`);
  }
  if (g.maxPlugins != null && ids.length > g.maxPlugins) {
    fail.push(`tooMany:${ids.length}>${g.maxPlugins}`);
  }
  const activeSlots = new Set((slotList || []).map(s => String(s).split('(')[0]));
  for (const s of g.slots || []) {
    if (!activeSlots.has(s) && !ids.some(() => false)) {
      // slot activation: pass if any chosen plugin occupies the slot
      const occupied = ids.length === 0 ? false : true;
      // better: check via chosen plugins if available — caller passes occupiedSlots
    }
  }
  return fail;
}

function checkSlots(g, chosenPlugins, slotLabels) {
  const fail = [];
  const occupied = new Set((chosenPlugins || []).map(p => p.slot));
  const active = new Set((slotLabels || []).map(s => String(s).split('(')[0]));
  for (const s of g.slots || []) {
    if (!occupied.has(s) && !active.has(s)) fail.push(`slot:${s}`);
  }
  return fail;
}

function recallAt(pool, targets) {
  if (!targets || !targets.length) return { hit: 0, total: 0, rate: 1, missing: [] };
  const ids = new Set(pool.map(p => p.id));
  const missing = targets.filter(t => !ids.has(t));
  const hit = targets.length - missing.length;
  return { hit, total: targets.length, rate: hit / targets.length, missing };
}

async function main() {
  const args = process.argv.slice(2);
  const doMix = args.includes('--mix');
  const ri = args.indexOf('--rounds');
  const rounds = ri >= 0 ? Math.max(1, parseInt(args[ri + 1], 10) || 1) : 1;

  const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
  const plugins = loadPlugins();
  const cases = [];

  let mustPass = 0, mustTotal = 0;
  let recallKwSum = 0, recallMixSum = 0, recallN = 0;

  for (const g of gold) {
    const rule = equip(g.task);
    const ids = parseChosen(rule);
    const fails = [
      ...checkCase(g, ids),
      ...checkSlots(g, rule.chosen, rule.slots),
    ];

    const poolKw = preselectKw(plugins, g.task);
    const poolMix = preselect(plugins, g.task);
    const recKw = recallAt(poolKw, g.recall);
    const recMix = recallAt(poolMix, g.recall);
    if (g.recall && g.recall.length) {
      recallKwSum += recKw.rate;
      recallMixSum += recMix.rate;
      recallN++;
    }

    const entry = {
      id: g.id,
      task: g.task,
      note: g.note,
      rule: {
        ids,
        score: rule.score,
        slots: rule.slots,
        pass: fails.length === 0,
        fails,
      },
      recall: {
        kw: recKw,
        tfidf: recMix,
        better: recMix.rate >= recKw.rate ? 'tfidf' : 'kw',
      },
    };

    mustTotal++;
    if (fails.length === 0) mustPass++;

    if (doMix) {
      const mixes = [];
      for (let i = 0; i < rounds; i++) {
        const m = await equipMix(g.task);
        const mids = parseChosen(m);
        const mfails = [
          ...checkCase(g, mids),
          ...checkSlots(g, m.chosen, m.slots),
        ];
        mixes.push({
          round: i + 1,
          ids: mids,
          score: m.score,
          pass: mfails.length === 0,
          fails: mfails,
          combo: mids.slice().sort().join('+'),
        });
      }
      const unique = new Set(mixes.map(x => x.combo));
      entry.mix = {
        rounds: mixes,
        stable: unique.size === 1,
        variants: unique.size,
        passAll: mixes.every(x => x.pass),
      };
    }

    cases.push(entry);
    const mark = entry.rule.pass ? 'PASS' : 'FAIL';
    const rec = `kw=${(recKw.rate * 100).toFixed(0)}% tfidf=${(recMix.rate * 100).toFixed(0)}%`;
    console.log(`${g.id} [${mark}] score=${rule.score} | ${ids.join(', ') || '(空)'} | recall ${rec}`);
    if (fails.length) console.log(`  fails: ${fails.join('; ')}`);
    if (entry.mix) {
      console.log(`  mix: ${entry.mix.passAll ? 'PASS' : 'FAIL'} stable=${entry.mix.stable} variants=${entry.mix.variants}`);
    }
  }

  const summary = {
    at: new Date().toISOString(),
    plugins: plugins.length,
    cases: cases.length,
    rulePass: mustPass,
    ruleTotal: mustTotal,
    ruleRate: mustTotal ? mustPass / mustTotal : 0,
    recallKwAvg: recallN ? recallKwSum / recallN : null,
    recallTfidfAvg: recallN ? recallMixSum / recallN : null,
    mixEnabled: doMix,
    rounds: doMix ? rounds : 0,
  };

  const report = { summary, cases };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log('\n=== 汇总 ===');
  console.log(`规则 must: ${mustPass}/${mustTotal} (${(summary.ruleRate * 100).toFixed(0)}%)`);
  if (recallN) {
    console.log(`召回@30 平均: kw=${(summary.recallKwAvg * 100).toFixed(0)}% tfidf=${(summary.recallTfidfAvg * 100).toFixed(0)}%`);
    if (summary.recallTfidfAvg + 0.05 < summary.recallKwAvg) {
      console.log('⚠ TF-IDF 未优于关键词——暂不接 embedding，先查 caps/任务表述');
    } else if (summary.recallTfidfAvg < 0.7) {
      console.log('⚠ 语义召回仍偏低——可考虑接 embedding');
    } else {
      console.log('✓ TF-IDF 召回足够，不上 embedding');
    }
  }
  console.log(`报告 → ${OUT}`);
  if (mustPass < mustTotal) process.exitCode = 1;
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
