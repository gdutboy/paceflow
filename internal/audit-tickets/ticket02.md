# ticket02: PACEflow v6.0.28 全面审查

## 审查摘要

审查时间: 2026-05-08T07:46:03+08:00
审查范围: 67 tracked 文件（动态发现：9 hook 脚本 + 1 公共 hook 工具 + 5 skill + 7 agent/reference instruction + 7 hook 模板 + 4 skill 模板 + tests/agent-tests + README/REFERENCE/CLAUDE/guidebook/action-plan）

Phase 1 原始发现: 0C + 0H + 5W + 2I = 7
Phase 2 验证结果: 5 确认 / 2 设计记录 / 0 误报
误报率: 0/7 (0%)

结论：v6.0.28 本次提交后的核心 hook / agent / plugin 发布链路没有发现阻断级 bug。`ConfigChange` / `config-guard` 已从 plugin hook 注册权威 `hooks/hooks.json` 中移除，公开文档已同步为 9 个 hook 脚本 / 8 类 hook 事件。剩余问题集中在文档口径与发布面清理，不影响当前 P-A-C-E-V 运行时保护。

## 确认发现

### P0 必修

无。

### P1 建议

- [W-1] `hooks/pace-utils.js:34-40` / `README.md:161-166` — `audit` skill 仍在 `SKILL_DIRS` 和用户面 README 中发布。该 skill 只服务 PaceFlow 自身审计，和用户项目 PACE 链路无直接关系；此前 action-plan 已记录建议移除。建议后续单独做发布面清理：从 `SKILL_DIRS` 移除 `audit`，README/REFERENCE/tests 同步为 4 个用户 skill，内部审计材料移到 `internal/` 或 docs。

### P2 文档

- [W-2] `README.md:181` — Hook I/O 表写 `PreCompact` 成功输出为 `stdout JSON（additionalContext）`，但 `hooks/pre-compact.js:18-115` 实际只写 `.pace/pre-compact-state.json` 并记录日志，不向 stdout 输出 JSON。建议改为“无 stdout（写快照文件）”。

- [W-3] `agent-references/artifact-writer-spec.md:326` — ARCHIVE 标记表声称 `<!-- ARCHIVE -->` 位于“6 个索引文件（task / impl_plan / walkthrough / findings / corrections.md + spec.md）”，但实际 `hooks/templates/spec.md:1-76` 没有 `<!-- ARCHIVE -->`，且 `spec.md` 不是索引文件。建议改成“5 个索引文件（task / implementation_plan / walkthrough / findings / corrections）”，并明确 `spec.md` 是无 ARCHIVE 的项目规格文件。

- [W-4] `docs/action-plan-2026-05-02.md:3-5` — 文档头仍写“当前版本：PACEflow v5.1.4 / Claude Code v2.1.126”，但当前执行视图已是 `2026-05-08, v6.0.28`。建议更新文档头，或明确“原始调研输入版本”以免和当前执行视图冲突。

- [W-5] `docs/paceflow-v6-guidebook.md:30,40,49` — guidebook 已有“部分当前缺口是历史状态”的总说明，但后文仍以“当前本地分支”“CLAUDE 仍按 v5”口吻陈述旧状态。建议将这些段落改成 historical snapshot，或移动到历史附录。

## 部分正确/有意设计

- [N-1] `ConfigChange` / `config-guard` 移除后，`CHANGELOG.md` 和历史设计文档仍有旧版本的 config-guard 记录。这些是历史 changelog / archived design，不应作为当前发布面缺陷处理。

- [N-2] `tests/test-install.js`、`verify.js`、`config/settings-hooks-excerpt.json` 存在于本地工作区但被 `.gitignore` 排除。它们是本地验证/手动安装工具，不是 marketplace 发布权威；审计时只作为 smoke 参考，不作为发布阻塞项。

## 验证矩阵

| 检查 | 方法 | 结论 |
|---|---|---|
| ConfigChange 是否仍注册 | 实际读取 `hooks/hooks.json`，枚举 events 与 command target | PASS：仅剩 SessionStart / PreToolUse / PostToolUse / PostToolUseFailure / SubagentStop / PreCompact / Stop / StopFailure |
| hook command target 是否存在 | 解析 `hooks/hooks.json` commands 并检查目标文件 | PASS：无缺失目标 |
| 版本一致性 | 对比 `.claude-plugin/plugin.json`、`marketplace.json`、`hooks/pace-utils.js` | PASS：均为 6.0.28 / v6.0.28 |
| README hook 数量 | 对比 tracked hook js 与 README 数量声明 | PASS：9 个 hook 脚本 + 8 类事件；`pace-utils.js` 是公共工具，不计入 hook 脚本 |
| close-chg prompt 门控 | E2E `9hc3a` | PASS：缺 `complete-open-tasks:true` 会 DENY |
| verified-date 共享检测 | 代码路径追踪 `pre-tool-use.js` / `post-tool-use.js` → `pace-utils.hasNonNullVerifiedDate` | PASS：已统一 |
| compact null snapshot | 路径追踪 `session-start.js:109-184` | PASS：null/non-object 会记录并清理 |
| PreCompact I/O 文档 | 对比 `README.md:181` 与 `hooks/pre-compact.js` | CONFIRMED W：README 表格过时 |
| ARCHIVE/spec.md 文档 | 对比 `artifact-writer-spec.md:326` 与 `hooks/templates/spec.md` | CONFIRMED W：spec 说明过时 |

## 验证命令

```bash
node tests/test-hooks-e2e.js      # 93/93 PASS
node tests/test-pace-utils.js     # 92/92 PASS
node --check hooks/*.js
claude plugin validate .          # PASS
```

## 建议后续变更

1. 文档小修：修 README PreCompact I/O、artifact-writer-spec ARCHIVE 表、action-plan 头部版本、guidebook historical 标注。
2. 发布面清理：决定是否在下一版移除 `audit` skill 出 marketplace，保留为内部开发审计资料。
3. 若做上述文档修复，补跑 `node tests/test-hooks-e2e.js`、`node tests/test-pace-utils.js`、`claude plugin validate .`。
