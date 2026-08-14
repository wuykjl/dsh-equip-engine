// 装备隐喻 UX：任务 → 混合检索配装 → 装备栏 HTML 可视化
// 用法: node src/equip-html.js "任务描述"
'use strict';
const fs = require('fs');
const path = require('path');
const { equipMix, installSpec } = require('./equip.js');

const SLOT_META = {
  perception: { icon: '👁', name: '感知', en: 'Perception', tip: '视觉 / 内容获取' },
  decision:   { icon: '🧠', name: '决策', en: 'Decision', tip: '规划 / 研究 / 编排' },
  action:     { icon: '⚔️', name: '行动', en: 'Action', tip: '工具 / 编码 / 安全' },
  memory:     { icon: '💾', name: '记忆', en: 'Memory', tip: '上下文 / 跨会话' },
  output:     { icon: '🖥️', name: '输出', en: 'Output', tip: '界面 / 呈现 / 设计' },
};

function slotHtml(slot, chosen) {
  const meta = SLOT_META[slot] || { icon: '?', name: slot, en: slot, tip: '' };
  const items = chosen.filter(p => p.slot === slot);
  const body = items.length ? items.map(p => {
    const syn = (p.complements || []).filter(c => chosen.some(q => q.id === c));
    const con = (p.conflicts || []).filter(c => chosen.some(q => q.id === c));
    const star = p.stars != null ? `<span class="star">⭐${p.stars >= 10000 ? (p.stars / 1000).toFixed(1) + 'k' : p.stars}</span>` : '';
    const synMark = syn.length ? `<span class="tag syn">套装+${syn.length}</span>` : '';
    const conMark = con.length ? `<span class="tag con">冲突!</span>` : '';
    const inst = p.install || installSpec(p);
    const cmd = inst.cmd.replace(/"/g, '&quot;');
    return `<div class="gear ${syn.length ? 'set' : ''} ${con.length ? 'bad' : ''}">
      <div class="gear-name">${p.name} ${star}</div>
      <div class="gear-meta">成本 ${p.cost} ${synMark}${conMark}</div>
      <div class="gear-cmd"><code>${inst.cmd}</code>
        <button type="button" class="copy" data-cmd="${cmd}">复制</button></div>
    </div>`;
  }).join('') : `<div class="gear empty">— 未装备 —</div>`;
  return `<div class="slot">
    <div class="slot-head"><span class="slot-icon">${meta.icon}</span> ${meta.name}<span class="slot-en">${meta.en}</span></div>
    <div class="slot-tip">${meta.tip}</div>
    ${body}
  </div>`;
}

function render(r) {
  const b = r.breakdown;
  const bars = [
    ['匹配', b.match], ['协同', b.synergy], ['冲突', -b.conflict],
    ['成本', -b.cost], ['信任', b.trust], ['反馈', b.feedback],
  ].map(([k, v]) => `<div class="bar"><span>${k}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.abs(v) * 40)}%"></div></div><span>${v >= 0 ? '+' : ''}${v.toFixed(2)}</span></div>`).join('');
  const installBlock = (r.install || []).map(x =>
    `<li><code>${x.cmd}</code> <span class="muted">[${x.slot}] ${x.name}</span>
     <button type="button" class="copy" data-cmd="${x.cmd.replace(/"/g, '&quot;')}">复制</button></li>`
  ).join('');
  return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><title>装备配置 · ${r.task.slice(0, 20)}</title>
<style>
body{background:#0d1117;color:#c9d1d9;font-family:'Segoe UI',sans-serif;padding:24px;max-width:1100px;margin:auto}
h1{font-size:20px;color:#e6edf3}h2{font-size:14px;color:#8b949e;font-weight:normal}
.equip{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}
.slot{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px}
.slot-head{font-weight:bold;color:#e6edf3;font-size:14px}
.slot-icon{margin-right:4px}.slot-en{color:#8b949e;font-weight:normal;font-size:11px;margin-left:6px}
.slot-tip{color:#8b949e;font-size:11px;margin:4px 0 8px}
.gear{background:#21262d;border:1px solid #30363d;border-radius:6px;padding:8px;margin:6px 0;font-size:12px}
.gear.set{border-color:#3fb950;box-shadow:0 0 6px #3fb95044}.gear.bad{border-color:#f85149}
.gear.empty{color:#484f58;text-align:center;padding:14px 4px;font-size:12px}
.gear-name{color:#e6edf3;margin-bottom:4px}.gear-meta{color:#8b949e;font-size:11px}
.gear-cmd{margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.gear-cmd code,.install code{font-size:10px;background:#0d1117;padding:2px 6px;border-radius:4px;color:#79c0ff}
.copy{font-size:10px;background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:4px;padding:2px 6px;cursor:pointer}
.copy:hover{border-color:#58a6ff;color:#58a6ff}
.star{color:#d29922}.tag{display:inline-block;padding:0 5px;border-radius:3px;font-size:10px;margin-left:4px}
.tag.syn{background:#23863644;color:#3fb950}.tag.con{background:#f8514944;color:#f85149}
.verdict{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-top:16px}
.install{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:14px;margin-top:12px}
.install h3{margin:0 0 8px;font-size:14px;color:#e6edf3}
.install ul{margin:0;padding-left:18px}.install li{margin:6px 0;font-size:12px}
.muted{color:#8b949e;margin-left:6px}
.bar{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px;color:#8b949e}
.bar-track{flex:1;background:#21262d;height:6px;border-radius:3px}.bar-fill{height:6px;border-radius:3px;background:#58a6ff}
.score{font-size:24px;color:#3fb950;font-weight:bold}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;margin:2px}
.badge.rule{background:#1f6feb44;color:#58a6ff}.badge.llm{background:#a371f744;color:#bc8cff}.badge.both{background:#3fb95044;color:#3fb950}
.llm-reason{color:#8b949e;font-size:12px;margin-top:8px;font-style:italic}
.note{color:#8b949e;font-size:11px;margin-top:8px}
</style></head><body>
<h1>⚔️ 装备配置建议</h1>
<h2>任务: ${r.task}</h2>
<div class="equip">${Object.keys(SLOT_META).map(s => slotHtml(s, r.chosen || [])).join('')}</div>
<div class="verdict">
  <span class="score">${r.score}</span> <span style="color:#8b949e">组合评分</span>
  ${(r.srcInfo || []).map(s => `<span class="badge ${s.type}">${s.type} · ${s.id}</span>`).join('')}
  ${r.overBudget ? '<span class="tag con">超预算</span>' : ''}
  <div class="bars">${bars}</div>
  ${r.llmReason ? `<div class="llm-reason">LLM 判断: ${r.llmReason}</div>` : ''}
</div>
<div class="install">
  <h3>可安装清单（不自动执行）</h3>
  <ul>${installBlock || '<li class="muted">无</li>'}</ul>
  <div class="note">复制命令后自行在终端运行；本页不会修改 DSH 配置。</div>
</div>
<script>
document.querySelectorAll('.copy').forEach(btn=>{
  btn.addEventListener('click',()=>{
    const t=btn.getAttribute('data-cmd')||'';
    navigator.clipboard.writeText(t).then(()=>{btn.textContent='已复制';setTimeout(()=>btn.textContent='复制',1200)}).catch(()=>{});
  });
});
</script>
</body></html>`;
}

async function main() {
  const task = process.argv.slice(2).join(' ');
  if (!task) { console.error('用法: node src/equip-html.js "任务"'); process.exit(1); }
  const r = await equipMix(task);
  r.chosen = (r.chosen || []).map(p => ({ ...p, install: installSpec(p) }));
  r.install = r.install || r.chosen.map(p => p.install);
  r.srcInfo = (r.ids || []).map(id => ({
    id: (r.chosen.find(p => p.id === id) || {}).name || id,
    type: (r.sources && r.sources[id]) || '?',
  }));
  const out = path.join(__dirname, '..', 'data', 'equip.html');
  fs.writeFileSync(out, render(r));
  console.log(`配装页已生成: ${out}`);
  console.log(`浏览器打开: file:///${out.replace(/\\/g, '/')}`);
  console.log('安装命令:');
  for (const x of r.install) console.log(' ', x.cmd);
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
