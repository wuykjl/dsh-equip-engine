# Changelog

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-08-15

### 修复
- **命令注册适配 dsh harness**：改用 `dsh-commands` 注册表（`ctx.commands.register`，与 `/goal` 同款）——旧 cordis `ctx.command().action()` API 在 web 界面从未生效，`/equip` 实际不可用
- **`equip.mix` → `equip-mix`**：命令名含 `.` 违反 harness 校验 `^[a-z][a-z0-9_-]*$`，注册即抛错
- **空配装 `score=undefined`**：`equip()` 空槽分支补全返回字段（score/breakdown/chosen/install）
- **单测 #5 自包含**：XSS 转义测试改为内存渲染断言（不再依赖外部生成的 equip.html）
- **getApiKey 引号清理**：credentials.yaml 中带引号的 key 值不再带入 API 调用
- 修复 patch 转义导致的路径显示 bug（`out.replace(/\\/g, '/')`）

### 变更
- **命令输出可读化**：任务/类型/评分/成本/槽位/建议组合/安装命令；空结果说明"宁缺毋滥"及 LLM 候选被过滤原因；handler 加 try/catch 返回错误文本
- 版本号 0.1.0 → 0.2.0

## [0.1.0] - 2026-08-15

### 新增
- 配装引擎核心：五槽位（感知/决策/行动/记忆/输出）× 双检索（规则精编库 + LLM 语义）→ 组合评分（匹配/协同/冲突/成本/信任）
- 2000+ 插件 manifest（19 手工精编 + 2033 LLM 生成，`owner/repo` 全限定 id）
- 金标评测框架：`data/gold.json` + `src/eval-suite.js`（后扩至 19 用例，规则 must 100%、tfidf 召回 97%）
- 反馈闭环（--accept/--reject，贝叶斯平滑）+ 黑名单（--ban/--unban）
- 安装命令导出（equip-export --dsh）+ 装备栏 HTML 可视化（equip-html）
- 数据保鲜 cron（每周同步 dshplugin.store）+ 数据质量管线（enrich/relations/regen/clean）
- capQuality 质量评分 + TF-IDF 全段滑窗 bigram 预筛
- 6 个回归单测（node --test，零依赖）
- DSH 插件形态：cordis.patch.yml + LICENSE + topic 标签，dshbase/awesome 双收录
