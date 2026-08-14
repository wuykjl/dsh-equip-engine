// 信号对齐：cost←stars、合并 test-status/verified、补空 desc、洗泛词 caps
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'data');
const ALL = path.join(ROOT, 'plugins-all.json');
const STORE = path.join(ROOT, 'plugins-store.json');
const VERIFIED = path.join(ROOT, 'verified.json');
const STATUS = path.join(ROOT, 'test-status.json');

const GENERIC = new Set(['界面', '工具', '插件', '管理', '集成', '研究', '安全', '记忆', '视觉', '设计', '系统', '通知', '搜索', '监控']);

function costFromStars(stars) {
  if (stars == null) return 0.3;
  const norm = Math.log10(stars + 1) / Math.log10(100000 + 1);
  return Math.round((0.15 + 0.35 * (1 - norm)) * 100) / 100;
}

function washCaps(caps) {
  const kept = (caps || []).filter(c => c && !GENERIC.has(c));
  // 若洗光则保留最长的原词，避免空 caps
  if (!kept.length && caps && caps.length) {
    return [...caps].sort((a, b) => b.length - a.length).slice(0, 2);
  }
  return kept;
}

function main() {
  const all = JSON.parse(fs.readFileSync(ALL, 'utf8'));
  const store = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  const storeById = new Map(store.map(p => [p.id, p]));
  const verified = JSON.parse(fs.readFileSync(VERIFIED, 'utf8'));
  const status = JSON.parse(fs.readFileSync(STATUS, 'utf8'));

  let costN = 0, statusN = 0, verifiedN = 0, descN = 0, capN = 0, starsN = 0;

  for (const p of all) {
    // stars 从 store 对齐
    const s = storeById.get(p.id);
    if (s && s.stars != null && p.stars !== s.stars) {
      p.stars = s.stars;
      starsN++;
    }
    // 空 desc 从 store 补
    if ((!p.desc || p.desc === 'No description') && s && s.desc && s.desc !== 'No description') {
      p.desc = s.desc;
      descN++;
    }
    // generated cost 从 stars 派生（manual 保留手工 cost）
    if (p.source === 'generated') {
      const next = costFromStars(p.stars);
      if (p.cost !== next) { p.cost = next; costN++; }
    }
    // testStatus
    if (status[p.id] != null && p.testStatus !== status[p.id]) {
      p.testStatus = status[p.id];
      statusN++;
    }
    // verified
    if (verified[p.id]) {
      if (p.verified !== true) { p.verified = true; verifiedN++; }
      if (!p.testStatus) p.testStatus = 'verified';
    }
    // 洗泛词（仅 generated）
    if (p.source === 'generated') {
      const washed = washCaps(p.capabilities);
      if (JSON.stringify(washed) !== JSON.stringify(p.capabilities)) {
        p.capabilities = washed;
        capN++;
      }
    }
    // 空 caps：从 name / id 拆词兜底
    if (!(p.capabilities || []).length) {
      const base = (p.name || p.id.split('/').pop() || '').replace(/^dsh[-_]?/i, '');
      const parts = base.split(/[-_]/).filter(w => w.length >= 2).slice(0, 4);
      if (parts.length) {
        p.capabilities = parts;
        capN++;
      }
    }
  }

  fs.writeFileSync(ALL, JSON.stringify(all, null, 2));
  console.log(`enrich: cost=${costN} stars=${starsN} status=${statusN} verified=${verifiedN} desc=${descN} caps=${capN} | total=${all.length}`);

  // 报告孤儿
  const ids = new Set(all.map(p => p.id));
  const orphanStatus = Object.keys(status).filter(id => !ids.has(id));
  const orphanVerified = Object.keys(verified).filter(id => !ids.has(id));
  if (orphanStatus.length) console.log('test-status 孤儿:', orphanStatus.join(', '));
  if (orphanVerified.length) console.log('verified 孤儿:', orphanVerified.join(', '));
}

main();
