// DSH (cordis) 插件入口：注册 /equip 与 /equip-mix 配装命令
// 注册格式与 harness 内 dsh-command-goal 一致：插件对象 { name, inject: ['commands'], apply }
'use strict';
const { equip, equipMix } = require('./equip.js');

const name = 'equip-engine';
const inject = ['commands'];

function equipText(r) {
  const lines = [];
  lines.push('任务: ' + r.task);
  lines.push('类型: ' + r.taskType + ' | 评分: ' + r.score + ' | 成本: ' + r.totalCost + (r.overBudget ? ' ⚠超预算' : ''));
  if (r.slots && r.slots.length) lines.push('激活槽位: ' + r.slots.join(', '));
  if (r.build && r.build.length) {
    lines.push('建议组合:');
    lines.push.apply(lines, r.build.map(l => '  ' + l));
    if (r.install && r.install.length) {
      lines.push('安装命令（需自行执行）:');
      lines.push.apply(lines, r.install.map(x => '  ' + x.cmd));
    }
  } else {
    lines.push('建议组合: （空）');
    lines.push('说明: 未找到匹配足够强的插件，宁缺毋滥不硬凑。');
    if (r.llmReason) lines.push('LLM 虽给出语义候选，但规则评分未达标(<0.5)或候选不在库中，被评分器过滤。');
  }
  if (r.llmReason) lines.push('LLM 判断: ' + r.llmReason);
  if (r.llmError) lines.push('LLM 通道异常: ' + r.llmError + '（已回退规则版）');
  return lines.join('\n');
}

function apply(ctx) {
  ctx.commands.register({
    name: 'equip',
    description: '插件配装：任务 → 建议组合（规则版）',
    input: { hint: '<任务描述>' },
    handler: (invocation) => {
      const task = invocation.rawInput.trim();
      if (!task) return { kind: 'error', text: '用法: /equip <任务描述>' };
      try { return { kind: 'success', text: equipText(equip(task)) }; }
      catch (e) { return { kind: 'error', text: '配装失败: ' + (e.message || e) }; }
    },
  });

  ctx.commands.register({
    name: 'equip-mix',
    description: '插件配装：混合检索（LLM + 规则）',
    input: { hint: '<任务描述>' },
    handler: async (invocation) => {
      const task = invocation.rawInput.trim();
      if (!task) return { kind: 'error', text: '用法: /equip-mix <任务描述>' };
      try { return { kind: 'success', text: equipText(await equipMix(task)) }; }
      catch (e) { return { kind: 'error', text: '配装失败: ' + (e.message || e) }; }
    },
  });
}

module.exports = { name, inject, apply };
module.exports.default = module.exports;
