# PACEflow v6.0.15 全面审查报告

**审查时间**: 2026-05-07T00:04:56+08:00
**审查范围**: 52 文件（动态发现：10 hook + 5 skill + 5 skill引用 + 7 hook模板 + 4 skill子模板 + 3 配置/plugin + 7 agent资产 + 8 测试 + 3 文档）

## 审查摘要

| 指标 | 数值 |
|------|------|
| Phase 1 原始发现 | 4C + 16H + 22W + 15I = 57 |
| Phase 2 验证结果 | 3 确认C / 1 降级W / 0 误报 |
| C级确认 | 3 |
| H级确认 | 11 |
| H级降级/部分正确 | 5 |
| 误报率 | 0/20 (0%) — 本次审查纪律严格执行，无模式匹配误报 |

## 确认发现

### P0 必修（3C + 3H）

- **[C-1]** `hooks/stop.js:181` — `!taskActive` 与 `if (taskActive)` 矛盾条件，导致 legacy 中文完成声明交叉验证完全不可达。将 `!taskActive` 改为 `taskActive`。
- **[C-2]** `verify.js:23` — `EXPECTED_HOOKS` 数组引用已重命名的 `todowrite-sync.js`，应为 `task-list-sync.js`，导致健康检查假阳性。
- **[C-3]** `verify.js:338-346` — Agent 必需文件列表缺少 `references/instructions/close-chg.md`，该指令文件存在但不会被健康检查覆盖。
- **[H-1]** `hooks/pace-utils.js` — `extractNewlyCompletedChgs` 导出但 0 生产消费者 + 0 测试覆盖，完全死代码。
- **[H-2]** `hooks/pre-tool-use.js:84-94` — `hardDeny` 函数不含显式 `return`，依赖 3 个调用点手动 `return`。未来新增调用点若遗漏会导致 stdout 输出双份 JSON。
- **[H-3]** `hooks/pace-utils.js` — `findMissingImplDetails` 和 `findMissingFindingsDetails` 是 v5 遗留函数，v6 架构已无消费者。

### P1 建议（8H + 5W）

- **[H-4]** `hooks/stop.js:196-199` — teammate 路径缺少显式 `process.exit(0)`，依赖隐式进程退出。
- **[H-5]** `hooks/pace-utils.js:502` — `scanRelatedNotes` 未守卫空 `VAULT_PATH`，无 vault 环境会错误扫描相对路径 `thoughts/` 和 `knowledge/`。
- **[H-6]** `hooks/stop.js:63` — skip 列表含 `archived`/`cancelled`，但 `classifyChange` 永不返回这些 category（转为 `inconsistent` 子类），死代码。
- **[H-7]** `/mnt/k/AI/paceflow-hooks/CLAUDE.md` — 版本号过时（声称 v5.1.4，实际 v6.0.15），架构目录名 `paceflow-audit/` 应为 `audit/`，hook 文件名 `todowrite-sync.js` 应为 `task-list-sync.js`，模板计数 5→6。
- **[H-8]** `hooks/pace-utils.js:543` — 日志轮转存在竞态（stat→read→write 非原子），影响极低（best-effort 日志）。
- **[H-9]** 全局 CLAUDE.md agent 引用 `paceflow-artifact-writer` 与 plugin 注册名 `artifact-writer` 不一致。
- **[H-10]** 测试覆盖缺口 — `classifyChange`/`getActiveChangeEntries`（Stop/SessionStart/TaskListSync 共用核心）缺少单元测试。
- **[H-11]** Agent contract 测试缺少 Phase C 独立用例目录。
- **[W-1]** `hooks/post-tool-use.js:125` — 变量遮蔽（内层 `const paceSignal` 覆盖外层）。
- **[W-2]** `hooks/pace-utils.js:676` — `countDetailTasks` 用 `T-\d+` 宽松匹配，与 spec 的 `T-NNN` 三位数格式不一致。
- **[W-3]** 日志格式混用 — 4 个 hook 中 `logEntry()` 与内联字符串模板并存，降低 grep/awk 解析可靠性。
- **[W-4]** 模板日期占位符系统性笔误 — 6 个文件中 `YYY` 应为 `YYYY`（年份占位符）。
- **[W-5]** CORRECTION ID 格式不一致 — SKILL.md 规范 vs format-reference 示例是否含 slug 后缀未统一。

### P2 文档（4W）

- **[W-6]** `REFERENCE.md:142` — `agents/references/**` 路径与实际 `agent-references/` 不符。
- **[W-7]** `hooks/session-start.js:367-378` — 桥接提示手动实现，未复用 `formatBridgeHint()`。
- **[W-8]** `skills/artifact-management/templates/` — `change-detail.md` 与 `change-implementation_plan.md` 双份模板存在同步风险。
- **[W-9]** `hooks/pace-utils.js:629-632` — `detailPathForId` 冗余大小写分支，大写分支几乎不可达。

## 部分正确/有意设计

- **Agent 2 C-2** `pace-utils.js:523` single-quote 正则 — ⚠️ 降级为 W。标准 YAML frontmatter 中单引号转义为 `''`，不合规输入本身无效，实际风险极低。
- **Agent 2 H-1** `session-start.js:204` walkthrough 截断方向 — ⚠️ 降级为 W。表区注释确认 newest-first 约定，但详情段排序未显式文档化。
- **Agent 3 H-2** `stop-failure.js` 非PACE项目不产生日志 — ⚠️ 降级为 W。有意设计（logging-only），跨项目审计价值有限。
- **Agent 5 H C1** PreToolUse fail-closed 逃生路径 — ⚠️ 降级为 I。有意 fail-closed 设计决策，代码注释已说明。
- **Agent 1 H-4** `findMissingImplDetails` — ✅ 确认死代码但保留为 deprecated 比删除更安全（外部消费者未知）。

## 误报分析

本次审查 0 误报。5 个 agent 均严格执行"先读后判"纪律，所有 C/H 发现均经路径追踪或实际 diff 验证。

## 验证矩阵

| 发现 | 验证方法 | 结论 |
|------|---------|------|
| C-1 stop.js:181 | 路径追踪 — 控制流双条件矛盾 | ✅ 确认 |
| C-2 verify.js:23 | 实际对比 — EXPECTED_HOOKS vs hooks.json + 实际文件 | ✅ 确认 |
| C-3 verify.js:338 | 实际对比 — required数组 vs agent-references/instructions/ 目录 | ✅ 确认 |
| H-1 extractNewlyCompletedChgs | grep 全仓 0 消费者 | ✅ 确认 |
| H-2 hardDeny no return | 审查 3 调用点防御完备性 | ✅ 确认 |
| H-5 scanRelatedNotes | VAULT_PATH 空值路径追踪 | ✅ 确认 |
| H-6 stop.js dead skip | classifyChange 返回值逐项对比 | ✅ 确认 |
| H-7 根CLAUDE.md | plugin.json/实际目录 逐项对比 | ✅ 确认 |

## 整体健康度：6.5/10

扣分主因：
- stop.js 交叉验证死代码 bug（C-1）— 影响 legacy 模式完成检测
- verify.js 2 个健康检查缺陷（C-2, C-3）— 降低发布质量门控有效性
- 根 CLAUDE.md 长期未同步（H-7, 4 项）— 新贡献者系统性误导
- 核心函数测试覆盖缺口（H-10）— 回归检测依赖 E2E

## 建议后续变更

| 优先级 | 建议 CHG | 包含发现 |
|--------|---------|---------|
| P0 | 本次修复 | C-1, C-2, C-3, H-2, H-4 |
| P1 | CHG-20260507-01 | H-1, H-3, H-5, H-6, H-7 |
| P2 | CHG-20260507-02 | W-1~W-9, H-8~H-11 |
| P3 | record-finding | I 级优化建议 |
