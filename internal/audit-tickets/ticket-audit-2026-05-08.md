# ticket-audit-2026-05-08: PACEflow v6.0.33 全面审查

## 2026-05-08 复核修复状态（v6.0.34 工作区）

本节是对下方 v6.0.33 审计记录的当前工作区复核，不改写原始审计证据。

已修复 / 已确认不再存在：
- H-C1：父级 `/mnt/k/AI/paceflow-hooks/CLAUDE.md` 已移除 `config-guard.js` 当前架构引用，补充 `post-tool-use-failure.js`、`subagent-stop.js`，并标明 `internal/skills/audit/` 不随 marketplace 发布。
- H-C2：`config/settings-hooks-excerpt.json` 与 `hooks/hooks.json` 的 `PostToolUseFailure` matcher 均为 `Write|Edit|MultiEdit|Bash|Agent`。
- H-C3：`tests/test-hooks-e2e.js` 的 `seedArtifactWriterLock()` 不再写废弃 `pid` 字段。
- H-C4 / H-C5：`hooks/pre-tool-use.js` 复用 `pace-utils.displayDir` 与 `normalizeArtifactRootChoice`，移除重复实现主体。
- H-C6：`hooks/templates/implementation_plan.md`、format reference 与 empty-v6 fixtures 均补齐 `> **最后更新**: <YYYY-MM-DDTHH:mm:ss+08:00>`。
- W-C1：`YYY-MM-DD` 笔误当前未发现；保留的 `YYYY-MM-DD` 是模板占位。
- W-C3 / W-C4 / W-C5：已清理未使用导入、移除 `parseHookStdin.error` 的 `parsed.message` fallback，并把 git worktree `.git` 路径解析中的硬编码 `+5` 改为显式 helper。
- W-C7：`pace-bridge` 已明确 `~/.claude/plans/` 不由 hook 自动扫描，只在用户或 Claude 明确给出路径时手动桥接。

仍按设计保留：
- W-C2：Obsidian CLI 刷新目前是每会话一次 fire-and-forget，`spawn` 后立即写 `cli-refresh-done`，不会在无 CLI 环境中无限热路径重试。
- W-C6：APPROVED/VERIFIED marker 暂未抽成常量；当前没有运行时不一致证据，后续可作为纯 DRY 清理处理。
- W-C8：`hooks/pace-hooks.log` 已在 `.gitignore`，本地测试日志不进入发布产物。

验证：
- `node tests/test-pace-utils.js` → 101/101 PASS
- `node tests/test-hooks-e2e.js` → 116/116 PASS
- `node tests/test-install.js` → 24/24 PASS
- `claude plugin validate .` → PASS
- `git diff --check` → PASS（仅 CRLF working-copy 提示）

## 审查摘要

审查时间: 2026-05-08T20:40:47+08:00
审查范围: 52 文件（动态发现：10 hook + 6 用户 Skill + 4 内部 Skill + 7 Hook 模板 + 4 Skill 模板 + 8 agent-references + 3 plugin 配置 + 3 测试 + 14 文档）
证据基线: git HEAD `0fe881a` + 工作区 diff（17 files changed）+ 动态发现文件 + `hooks/pace-hooks.log`（605 行）+ `docs/production-smoke-v6.0.32.md`

Phase 1 原始发现: 0C + 16H + 22W + 18I = 56
Phase 2 验证结果: 6 确认 / 5 部分正确 / 5 误报/重复
误报率: ~50% (符合审计流程历史基线)

确认发现统计: 0C + 6H_confirmed + 8W_confirmed + 10I_filtered

## 确认发现

### P0 必修（6 项）

**[H-C1] CLAUDE.md 架构图过时（3 处错误）**
- 文件: `/mnt/k/AI/paceflow-hooks/CLAUDE.md:37,50,75`
- 问题:
  1. 第 37 行列出的 `config-guard.js` 已于 v6.0.28 移除
  2. 遗漏实际存在的 `subagent-stop.js`（SubagentStop）和 `post-tool-use-failure.js`（PostToolUseFailure）
  3. 第 50 行 `audit/` 列在 `skills/` 下，实际在 `internal/skills/`
  4. 第 75 行下游 hook 列表仍引用 `config-guard`
- 修复: 删除 config-guard.js 引用，新增 subagent-stop.js + post-tool-use-failure.js，修正 audit 路径

**[H-C2] settings-hooks-excerpt.json PostToolUseFailure matcher 缺少 Agent**
- 文件: `config/settings-hooks-excerpt.json:65`
- 对比: hooks.json:65 = `"Write|Edit|MultiEdit|Bash|Agent"`，settings-hooks-excerpt.json:65 = `"Write|Edit|MultiEdit|Bash"`
- 影响: 手动安装用户（非 plugin 模式）的 `post-tool-use-failure.js` 无法在 Agent 工具失败时触发，丢失 artifact-writer 锁释放
- 修复: 改为 `"Write|Edit|MultiEdit|Bash|Agent"`

**[H-C3] seedArtifactWriterLock 测试辅助写入废弃 pid 字段**
- 文件: `tests/test-hooks-e2e.js:149`
- 问题: `seedArtifactWriterLock()` 写入 `pid: process.pid`，但 v6.0.33 生产锁格式已移除 pid（Smoke 0-5 修复），`test-pace-utils.js:243` 明确断言 `!('pid' in readArtifactWriterLock(dir).raw)`
- 影响: E2E 测试使用与现实不符的锁格式，可能掩盖依赖旧 pid 字段的代码路径
- 修复: 从种子 JSON 中移除 `pid: process.pid`

**[H-C4] displayDir 函数在 pre-tool-use.js 重复定义**
- 文件: `hooks/pre-tool-use.js:174-176` vs `hooks/pace-utils.js:135-137`
- 问题: 两个实现逐字相同。未来修改路径格式化规则可能只改一处，导致行为不一致
- 修复: 删除 pre-tool-use.js 本地定义，统一使用 `paceUtils.displayDir`

**[H-C5] normalizeArtifactDirValue 与 normalizeArtifactRootChoice 90% 代码重复**
- 文件: `hooks/pre-tool-use.js:178-187` vs `hooks/pace-utils.js:377-386`
- 问题: 核心引号剥离逻辑完全一致，只差末尾斜杠规范化。维护时容易只改一处
- 修复: 合并为统一函数，或让 normalizeArtifactDirValue 调用 normalizeArtifactRootChoice 后追加斜杠处理

**[H-C6] implementation_plan.md Hook 模板与 Agent Spec 不一致**
- 文件: `hooks/templates/implementation_plan.md` vs `agent-references/artifact-writer-spec.md:224`
- 问题: Agent Spec §5.6.2 在 `# 实施计划` 后有 `> **最后更新**: <YYYY-MM-DDTHH:mm:ss+08:00>` 行，Hook 模板缺少此行。SessionStart 懒创建时产出与 spec 不一致的文件
- 修复: 在 Hook 模板中补充 `> **最后更新**:` 行

### P1 建议（8 项）

**[W-C1] YYY-MM-DD 系统性笔误（13 处，5 文件）**
- 涉及: `skills/artifact-management/templates/change-detail.md:7`, `correction-detail.md:5-6`, `finding-detail.md:5,8`, `hooks/templates/knowledge-note.md:6-7`, `skills/pace-knowledge/SKILL.md:35-36,82-83`, `skills/pace-workflow/SKILL.md:142`
- 修复: 全局替换 `YYY-MM-DD` → `YYYY-MM-DD`（排除 `YYYYMMDD` 格式 ID）

**[W-C2] Obsidian CLI spawn 无缓存检测（Linux/WSL 性能）**
- 文件: `hooks/post-tool-use.js:168-183`
- 问题: 每次 artifact 写入在无 obsidian CLI 的环境中触发 spawn ENOENT → catch 静默 → 不写 flag → 下次再触发。形成隐性热路径
- 修复: 增加 `.pace/cli-unavailable` 一次性检测标记

**[W-C3] pre-tool-use.js 未使用导入 ts / countDetailTasks**
- 文件: `hooks/pre-tool-use.js:9`
- 修复: 从导入解构中移除

**[W-C4] pace-utils.js parseHookStdin error 字段回退链可能混淆**
- 文件: `hooks/pace-utils.js:1187`
- 问题: `error: parsed.error || parsed.error_type || parsed.message || ''`，当无实际错误但存在通用 message 时，error 被设为消息内容
- 修复: 移除 `parsed.message` 作为 error 回退

**[W-C5] getProjectNameCandidates 硬编码偏移量 +5 无注释**
- 文件: `hooks/pace-utils.js:213-214`
- 修复: 用 `path.sep.length + '.git'.length` 替代或添加注释

**[W-C6] APPROVED/VERIFIED 标记散落多处无统一常量**
- 文件: `hooks/pace-utils.js` 多处
- 修复: 定义 `APPROVED_MARKER`/`VERIFIED_MARKER` 常量（与 ARCHIVE_MARKER 一致）

**[W-C7] pace-bridge ~/.claude/plans/ 路径无 Hook 自动检测覆盖**
- 文件: `skills/pace-bridge/SKILL.md:6,26`
- 问题: Skill 声称桥接 `~/.claude/plans/`，但 `PLAN_DIRS` 仅扫描项目内路径，无 hook 自动提示
- 修复: 在 Skill 中注明需 AI 手动检查，或在 `formatBridgeHint()` 增加检查

**[W-C8] 测试运行后日志未清理，pace-hooks.log 含 166KB E2E 噪声**
- 文件: `hooks/pace-hooks.log`
- 修复: 测试结束后清理，或用 `PACE_HOOKS_LOG` 环境变量分离

### P2 文档（3 项）

- CLAUDE.md:103 `xCount` 变量引用不存在于当前源码 —— 移除或更新
- CLAUDE.md 架构图 skills/ 下仍列 `audit/`，实际在 `internal/skills/`
- README/REFERENCE 中 version 描述需确认是否与 v6.0.33 一致

## 部分正确/有意设计

| 发现 | 判定 | 原因 |
|------|------|------|
| subagent-stop 锁释放 sid/aid 为空 | ⚠️ 有意设计 | `CLAUDE_CODE_SESSION_ID` 在生产环境始终存在，且锁 TTL 30min 兜底 |
| pre-compact 快照无 ensureProjectInfra | ⚠️ 有意设计 | SessionStart 已创建 .pace/，极端手动删除场景极罕见 |
| plugin.json/marketplace.json 缺少 skills | ⚠️ 部分正确 | 需确认 Claude Code plugin 规范是否要求显式声明 skills（目录结构或可自动发现） |
| stop.js v6 artifact 跳过 task-list-used 清理 | ⚠️ 有意设计 | artifact 项目标志生命周期由 SessionStart 重置管理，不是遗漏 |
| artifact-writer 锁 TOCTOU 竞态窗口 | ⚠️ 有意设计 | 代价分析：合并为原子操作过于复杂，当前自动重试已足够 |

## 误报分析

| 原始发现 | 误报原因 |
|---------|---------|
| Agent 1-H2 (ts/countDetailTasks 未使用) 与 Agent 5-H3 (displayDir) 重复 | 不同 agent 独立发现同一问题，Phase 3 去重合并 |
| Agent 5-H1 (CLAUDE.md 架构图) 与 Agent 4-H1 (架构图) 重复 | 同一问题被两个 agent 从不同视角发现，去重合并为 H-C1 |
| Agent 2-H2 (pre-compact 无 process.exit) | Node.js 同步 I/O 完成后自动退出 code 0，显式调用非必需 |
| Agent 1-W1 (CLAUDE.md xCount) 与其他 agent 的 CLAUDE.md 问题 | 合并到 H-C1 架构图问题 |
| Agent 2-W2 (stop.js task-list-used 跳过 artifact) | Agent 2 自己标记为 N-3 有意设计，却报告为 W，自相矛盾 → 降级为有意设计 |

## 验证矩阵

| 发现 | 验证方法 | 结论 |
|------|---------|------|
| CLAUDE.md 架构图 | 实际 diff CLAUDE.md vs hooks/ 目录 | ✅ 确认 |
| settings-hooks-excerpt vs hooks.json | 逐行对比两个文件的 PostToolUseFailure matcher | ✅ 确认 |
| seedArtifactWriterLock pid | 读 E2E 测试源码 + test-pace-utils 断言 | ✅ 确认 |
| displayDir 重复 | 逐行对比 pre-tool-use.js:174-176 vs pace-utils.js:135-137 | ✅ 确认 |
| normalizeArtifact* 重复 | 逐行对比两个函数 | ✅ 确认 |
| implementation_plan.md 模板 | diff hook 模板 vs agent spec §5.6.2 | ✅ 确认 |
| parseHookStdin error 回退 | 路径追踪：error 字段只用于日志，不用于 deny | ⚠️ 部分正确 |
| plugin.json skills | plugin.json 只声明 agents 无 skills | ⚠️ 部分正确（需规范确认） |

## 证据来源

- 核心源码: `hooks/pace-utils.js` (1244 行), `hooks/pre-tool-use.js` (1102 行), `hooks/post-tool-use.js`, `hooks/post-tool-use-failure.js`, `hooks/session-start.js`, `hooks/stop.js`, `hooks/subagent-stop.js`, `hooks/pre-compact.js`, `hooks/stop-failure.js`, `hooks/task-list-sync.js`
- 配置: `hooks/hooks.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `config/settings-hooks-excerpt.json`
- Agent: `agents/artifact-writer.md`, `agent-references/artifact-writer-spec.md`, `agent-references/instructions/*.md` (7 文件)
- Skill: `skills/pace-workflow/SKILL.md`, `skills/artifact-management/SKILL.md`, `skills/pace-knowledge/SKILL.md`, `skills/pace-bridge/SKILL.md` + 引用/模板
- 内部: `internal/skills/audit/SKILL.md` + references (agent-prompts.md, audit-procedures.md)
- 测试: `tests/test-pace-utils.js`, `tests/test-hooks-e2e.js`, `tests/test-install.js`, `tests/agent-tests/**/*.yaml` (22 文件)
- 日志: `hooks/pace-hooks.log` (605 行结构化日志)
- 文档: `CLAUDE.md` (根+项目), `README.md`, `REFERENCE.md`, `docs/production-smoke-v6.0.32.md`, `docs/paceflow-v6-guidebook.md`, `docs/action-plan-2026-05-02.md`

## 整体健康度: 7.5/10

| 维度 | 评分 |
|------|------|
| Hook 架构完整性 | 9 |
| 确定性保障（deny/block 机制） | 9 |
| 测试覆盖度 | 8 |
| 文档准确性 | 6 |
| 代码质量（DRY/重复） | 6 |
| 降级与健壮性 | 8 |
| 生产就绪度 | 7 |

**总结**: 0 个 Critical 级别问题，核心 hook 运行时逻辑坚固。6 个 H 级确认问题集中在文档过时、代码重复、配置不一致——全部可安全修复，无破坏性变更。主要技术债务是 `pre-tool-use.js` (1102 行) 和 `pace-utils.js` (1244 行) 的代码体积与模块内重复。

## 建议后续变更

| 优先级 | 建议 CHG | 内容 |
|--------|---------|------|
| P0 | CHG-20260508-01 | 修复 6 个 H 级确认问题 (CLAUDE.md + settings-hooks-excerpt + pid + displayDir + normalizeArtifact + impl_plan 模板) |
| P1 | CHG-20260508-02 | 修复 YYY-MM-DD 笔误 + Obsidian CLI 缓存 + 未使用导入 + error 回退链 |
| P2 | CHG-20260508-03 | 文档更新: xCount 引用 + audit 路径 + APPROVED_MARKER 常量 |
