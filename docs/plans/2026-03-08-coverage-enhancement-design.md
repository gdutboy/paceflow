# CHG-20260308-04 设计文档：PACEflow 检查覆盖增强 + 指引补全

> **日期**: 2026-03-08
> **版本**: v5.0.2
> **状态**: 已批准

## 背景

CHG-20260308-03 完成指引体系增强后，审视发现 3 个遗留缺口（findings.md 活跃区）：
1. Knowledge 注入仅 L0 摘要，compact 完全不注入
2. AI 记录 findings 习惯性跳过详情，hook 无检测
3. 旧格式（emoji/表格）可写入 impl_plan，compact 后格式规则丢失

4-agent 并行研究进一步发现 6 个新缺口（GAP-003/004/005/006/007/008/009/010/011），
经评估选定 Beta 方案：3 原始 findings + 3 个高优先新缺口（GAP-003/007/008）。

## 设计决策

| 决策点 | 选择 | 理由 |
|-------|------|------|
| Knowledge 注入深度 | 方案 A（compact 也注入 L0） | L0 摘要质量已足够，3-4 条笔记不需要 L1；L1 延后到笔记 10+ 再评估 |
| Findings 详情匹配算法 | 前 8 字子串匹配 | findings 标题灵活无固定 ID，子串匹配 ~85-95% 可靠 |
| GAP-009 DENY 防循环 | 不做独立机制 | DENY 消息已含 FORMAT_SNIPPETS + C 阶段已有用户引导，AI 通常 1-3 次自愈 |
| GAP-004/005/006 | 延后 | 触发概率低、现有机制已部分覆盖、需额外格式设计 |
| task.md CHG 标题 checkbox 化 | 不做 | 连锁重构代价远大于收益，impl_plan 索引已覆盖 CHG 级状态 |

## 修改清单

### 1. pace-utils.js — 新增 `findMissingFindingsDetails`

新增函数（~20 行），检查 findings.md 全文中 `[ ]` 索引是否有对应 `### [日期] 标题` 详情段落。
- 匹配逻辑：提取索引标题前 8 字 → 在 `###` 标题中做子串匹配
- 只检查 `[ ]`（未解决），`[x]`/`[-]` 已结案不检查
- 导出到 `module.exports`

### 2. session-start.js — compact 路径增强

**2a. Knowledge L0 注入**（~5 行）：移除 `eventType !== 'compact'` 守卫，compact 时限 3 条。

**2b. 格式规则注入**（~5 行）：compact 快照输出后追加 `FORMAT_SNIPPETS`（taskEntry/implIndex/statusHelp）。

**2c. 快照新字段输出**（~5 行）：读取 snapshot.findings/walkthrough 字段并输出。

### 3. pre-tool-use.js — 旧格式 DENY + C 阶段微调

**3a. 旧格式 DENY**（~20 行）：Edit impl_plan 时检测活跃区含 emoji（✅❌📋🔄⏳）或表格（`|...|` 且无 checkbox），DENY + 给正确格式。仅限 impl_plan，零误报。

**3b. C 阶段消息微调**（~3 行）：追加"请直接询问用户是否批准"引导。

### 4. post-tool-use.js — H14 findings 详情检查

新增 H14（~10 行）：Edit findings.md 且 `new_string` 含 `- [ ]` 时，调用 `findMissingFindingsDetails` 检查全文，缺详情 → HINT 提醒。每次编辑都检查（非一次性 flag）。

### 5. stop.js — findings 终态 + 过期 + 日期容错

**5a. 详情终态**（~10 行）：`findMissingFindingsDetails` 全文扫描，缺详情 → warning。

**5b. 过期检测**（~10 行）：`[ ]` 项 `[date::]` 超 14 天 → warning。从 SessionStart 移植对称逻辑。

**5c. 日期容错**（~5 行）：walkthrough 日期正则从 `\d{4}-\d{2}-\d{2}` 改为 `\d{4}-\d{1,2}-\d{1,2}`，比对时 padStart 标准化。

### 6. pre-compact.js — 快照扩展

新增 findings（openCount/warningCount）+ walkthrough（hasTodayEntry）到快照（~15 行）。

## 覆盖矩阵变化

| Artifact | SessionStart | PreToolUse | PostToolUse | Stop | PreCompact |
|----------|:-----------:|:----------:|:-----------:|:----:|:----------:|
| task.md | O | O | O | O | O |
| impl_plan | O | O (+旧格式) | O | O | O |
| findings | O | - | O (+H14) | O (+详情+过期) | O (+快照) |
| walkthrough | O | - | - | O (+日期容错) | O (+快照) |

## 延后项

- GAP-004: impl_plan 同时添加判定加强（需定义"有效详情"）
- GAP-005: Stop AI 声称完成关键字扩展（边际改善）
- GAP-006: CHG 分组状态检查（impl_plan 索引已覆盖）
- GAP-010: Teammate hint 优先级（低频场景）
- GAP-011: VAULT_PATH 空值警告（低频场景）
- Knowledge L1 注入（等笔记 10+ 再评估）

## 验证计划

- 语法检查：`for f in paceflow/hooks/*.js; do node -c "$f"; done`
- 单元测试：`node paceflow/tests/test-pace-utils.js`（新增 findMissingFindingsDetails 用例）
- E2E 测试：`node paceflow/tests/test-hooks-e2e.js`（新增 3-4 个测试）
- verify.js：`node paceflow/verify.js`
