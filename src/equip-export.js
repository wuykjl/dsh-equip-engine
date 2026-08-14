// 配装结果 → 可安装清单（不执行安装、不改 ~/.dsh）
// 用法:
//   node src/equip-export.js "任务"
//   node src/equip-export.js "任务" --json
//   node src/equip-export.js "任务" --dsh
//   node src/equip-export.js "任务" --mix
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { equip, equipMix, installSpec } = require('./equip.js');

function formatDsh(install) {
  return install.map(x => x.cmd).join('\n');
}

function formatHuman(r) {
  const lines = [
    `任务: ${r.task}`,
    `类型: ${r.taskType} | 评分: ${r.score} | 成本: ${r.totalCost}${r.overBudget ? ' (超预算)' : ''}`,
    '配装:',
    ...(r.build || []),
    '',
    '可安装清单（请自行执行，本工具不会安装）:',
    ...r.install.map(x => `  ${x.cmd}  # [${x.slot}] ${x.name} → ${x.git}`),
  ];
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const asDsh = args.includes('--dsh');
  const useMix = args.includes('--mix');
  const task = args.filter(a => !a.startsWith('--')).join(' ');
  if (!task) {
    console.error('用法: node src/equip-export.js "任务" [--json|--dsh] [--mix]');
    process.exit(1);
  }

  const r = useMix ? await equipMix(task) : equip(task);
  if (!r.install) {
    r.install = (r.chosen || []).map(installSpec);
  }

  if (asJson) {
    const payload = {
      task: r.task,
      taskType: r.taskType,
      score: r.score,
      totalCost: r.totalCost,
      overBudget: r.overBudget,
      ids: r.ids || (r.chosen || []).map(p => p.id),
      install: r.install,
      note: '清单仅供复制执行；equip-export 不会调用 dsh 或修改本地配置',
    };
    const out = path.join(process.env.DSH_EQUIP_DATA || path.join(os.homedir(), '.dsh-equip', 'data'), 'equip-install.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
    console.log(JSON.stringify(payload, null, 2));
    console.log(`\n已写入 ${out}`);
    return;
  }

  if (asDsh) {
    console.log(formatDsh(r.install));
    return;
  }

  console.log(formatHuman(r));
}

main().catch(e => { console.error('失败:', e.message); process.exit(1); });
