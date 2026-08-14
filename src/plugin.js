// DSH (cordis) 插件入口：提供 equip 配装服务
// 任务 → 双检索 + 组合评分 → 配装建议（含安装命令）
'use strict';
const { equip, equipMix, loadPlugins } = require('./equip.js');

module.exports = (ctx) => {
  ctx.provide('equip', {
    equip: (task) => equip(task),
    equipMix: async (task) => equipMix(task),
    plugins: () => loadPlugins().length,
  });

  ctx.inject(['commands'], (ctx) => {
    ctx.command('equip <task:text>', '插件配装：任务 → 建议组合')
      .action((_, task) => {
        const r = equip(task);
        return [
          `评分: ${r.score} (${r.taskType})`,
          ...(r.build || []),
        ].join('\n');
      });

    ctx.command('equip.mix <task:text>', '混合检索配装（LLM + 规则）')
      .action(async (_, task) => {
        const r = await equipMix(task);
        return [
          `评分: ${r.score} | LLM: ${r.llmReason || '-'}`,
          ...(r.build || []),
        ].join('\n');
      });
  });
};

module.exports.default = module.exports;
