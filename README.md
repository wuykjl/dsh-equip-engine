# dsh-equip-engine

任务驱动的 **DSH 插件配装引擎**：给任务配整套插件，而不是给你一个列表。

> 装插件最痛苦的不是安装，是"这个任务到底该装哪些"。生态里 2000+ 插件、互相冲突、成本不一——配装引擎按任务自动推荐组合，并给出可直接复制的安装命令。

## 快速开始

```bash
# 1. 安装（bundle 插件）
dsh plugin --profile web add github:wuykjl/dsh-equip-engine

# 2. 重启 dsh web
dsh web

# 3. 在聊天框输入（slash 命令）
/equip 写代码时要处理大量 JSON 和 CSV 文件

# LLM 混合检索版（更准，需配置 API key）
/equip.mix 帮我做一份关于细胞基因编辑的深度研究报告，需要看实验图片
```

## CLI 用法

```bash
# 规则版（本地快速）
node src/equip.js "任务描述"

# 导出安装命令
node src/equip-export.js "任务" --dsh
# → dsh plugin add Anionex/agent-vision-toolkit
# → dsh plugin add tt-a1i/archify
# → ...

# 装备栏可视化（HTML）
node src/equip-html.js "任务"
```

## 特性

- **五槽位配装**：感知 / 决策 / 行动 / 记忆 / 输出——按 agent 循环阶段划分（比按能力分类稳定）
- **组合评分**（核心）：协同加成（套装效应）、冲突惩罚（互斥插件不共存）、成本、信任（stars + 实测状态 + 个人反馈）
- **双检索**：规则精编库精确匹配 + LLM 语义理解（两阶段预筛：2000+ → 30 候选 → LLM 精排，快且省 token）
- **金标评测**：10 任务 100% 通过，召回 94%
- **数据保鲜**：每周自动同步生态（cron），新增插件自动收录
- **2000+ 插件 manifest**：`owner/repo` 全限定 id，无撞名歧义

## 与其他生态工具的区别

| | 目录/商店（dshplugin.store 等） | 本引擎 |
|---|---|---|
| 回答的问题 | "有什么插件" | **"这个任务该装哪些"** |
| 决策方式 | 人浏览/搜索/复制命令 | 机器配装 + 人审核 |
| 组合级判断 | 无 | 有（冲突/协同/预算） |
| 可解释性 | 无 | 有（每个选择给理由） |

## 架构

```
任务 → 规则检索(精编库) ∪ LLM检索(预筛→精排) → 组合评分器 → 配装建议
         (精确匹配)          (语义理解)          (五维评分)
```

## 评测

- 金标集：10 个任务（`data/gold.json`），规则 must 通过率 **100%**
- 召回@30：关键词 94% / TF-IDF 94%（数据驱动判定：不上 embedding）
- 运行 `node src/eval-suite.js` 复现

## 生态链接

- GitHub: https://github.com/wuykjl/dsh-equip-engine
- dshbase 收录: https://github.com/ylwl1997/dshbase/issues/12
- awesome-deepseek-harness: https://github.com/0xsline/awesome-deepseek-harness/pull/130

## 开发与维护

开发历程、数据管线命令、已知限制见 [docs/DEVLOG.md](docs/DEVLOG.md)。MIT License。
