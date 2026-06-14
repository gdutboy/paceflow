# Codex 审计：已修复项严格复核（2026-06-14）

> 范围：核实“已经修复”的项是否真的正确修复。审计分两层：
> 1. 远端已发布：`origin/master` = `c083ea26884f3a859b5d976dc14387af148b943a`（v7.2.2）。
> 2. 本地未提交：当前工作区的日志隔离、run-all、agent-tests helper schema-version 检测等后续修复。

## 结论

- 远端 v7.2.2 的 A1-A5 修复语义正确，未发现“测试绿但原风险仍可达”的复发。
- 本地日志隔离修复语义正确，`PACE_LOG_PATH` 注入已覆盖真实 hook 子进程路径。
- 本地 `run-all` 聚合入口逻辑正确，但发布打包不完整：`tests/run-all.js` 与 `tests/test-run-all.js` 仍被 `.gitignore` 的 `tests/*` 忽略，提交前必须加例外。
- 本地 agent-tests helper 的 `frontmatter_schema_version` 检测能力正确，但它只修了 helper 能力；真实 agent contract suite 仍处于半自动/fixture v6 形态，不能声称“agent 契约套件已全面复活”。

## 验证

远端干净快照：`/tmp/paceflow-audit-origin-c083ea2`

- `git diff --check be05232..origin/master`：PASS
- `node tests/test-pace-utils.js`：280/280 PASS
- `node tests/test-hooks-e2e.js`：401/401 PASS
- `node tests/test-session-layers.js`：42/42 PASS
- `node tests/test-migrate-v7.js`：16/16 PASS
- `node tests/test-agent-tests-helpers.js`：9/9 PASS
- `node tests/agent-tests/run-tests.js dummy`：PASS
- `find . -name '*.js' -print0 | xargs -0 -n 1 node --check`：PASS
- `claude plugin validate ./plugin`：PASS

本地工作区：

- `node tests/run-all.js`：8/8 suites PASS
  - `pace-utils`：285/285 PASS
  - `hooks-e2e`：401/401 PASS，含 `LOG-ISOLATION`
  - `session-layers`：42/42 PASS
  - `migrate-v7`：16/16 PASS
  - `agent-helpers`：11/11 PASS
  - `run-all-self`：4/4 PASS
  - `claude plugin validate ./plugin`：PASS
  - `git diff --check`：PASS

## 远端已发布修复复核

### A1 确定性网关

状态：正确修复。

- `update-chg action=verify` 已在 agent 启动前要求目标 CHG 有 `APPROVED`。
- `update-chg action=review` 已在 agent 启动前要求目标 CHG 已 `VERIFIED`。
- `close-chg` 已要求目标 CHG 已 `APPROVED`。
- 缺失或未知 `action` 已 hard-deny，不再靠 agent 自觉拒绝。
- `V7G-1/2/3` 与 `9hc-review3` 已覆盖正反向路径。

残余边界：detail 读不到时仍 fail-open，不加偏序 deny。这是当前实现有意取舍，避免路径异常误伤；不是原 bug 复发。

### A2 change-owner 一致性

状态：正确修复。

- heartbeat 刷新 `active/closing/backlog/ready/blocked`，排除 `detached/closed`，符合 “活跃 session 不被 sweep 误清” 的目标。
- `sweepStaleRuntimeOwners` 用 owner 内部 `timestampMs` 判 stale，缺字段才回退文件 mtime。
- artifact-writer 写 detail 前重新检查 owner，`foreign-fresh` 与 `sibling-fresh` 会 deny。
- `V7H-1..4` 覆盖内部 timestampMs、blocked heartbeat、foreign deny、自有放行。

残余边界：跨独立 clone 共享 vault 的编号/owner 架构债仍是 deferred，不属于本批已修项。

### A3 schema/parser 对齐

状态：正确修复。

- `validateFrontmatterSchema` 已按 kind 校验 status 枚举，typo 不再退化为 base-only。
- `hasNonNullVerifiedDate` / `hasNonNullReviewedDate` 只读文首 frontmatter，重复 key last-wins，不再 whole-doc fallback。
- `V7B-8` 与 `V7G-4` 覆盖 status typo 与双解析器分叉。

### A4 helper 参数健壮性

状态：正确修复原风险。

- `flagValue` 公共 helper 已用于 `reserve-artifact-id` 的 `--operation/--type/--cwd/--session-id` 与 `sync-plan` 的 `--plan/--cwd`。
- 缺值时进入 `missingValue` 并 fail-closed，不再吞后续 flag 后继续执行。
- `9hc-helper1c/1d`、`9hc-syncplan-mv1/mv2` 已覆盖。

细节：`reserve --count` 仍使用专用解析，但 `--count --cwd` 会被判为非法 count 并非零退出，不会预留编号；这不是 H-01 复发，只是实现风格未完全统一。

### A5 发布面文档/合规

状态：正确修复。

- 版本号发布面为 v7.2.2。
- README 迁移命令已从 `$PLUGIN_DIR` 改为 `${CLAUDE_PLUGIN_ROOT}`，并给普通终端 fallback。
- “57% token” 旧精确指标已移除/改为定性。
- `CLAUDE.md` 远端已补 `test-session-layers.js` 与 `test-migrate-v7.js`。
- `migrate-v7 --hygiene` 私人 vault 文档名已移除。

## 本地未提交修复复核

### 日志隔离 / PACE_LOG_PATH

状态：语义正确，待提交。

- `defaultLogPath()` 支持 `PACE_LOG_PATH`，缺省仍回退 `plugin/hooks/pace-hooks.log`。
- runtime hook 已统一经 `paceUtils.defaultLogPath()`。
- E2E 在套件启动时注入独立 tmp 日志，`LOG-ISOLATION` 断言源码树 `plugin/hooks/pace-hooks.log` 的 mtime/size 不变。
- `LOGENV-1..5` 覆盖 env 优先、缺省回退、显式路径优先、硬编码回归扫描。

### run-all 聚合入口

状态：逻辑正确，但发布不完整。

- `tests/run-all.js` 能串起核心套件、runner 自测、plugin validate、git diff check，且失败会整体非零。
- `tests/test-run-all.js` 覆盖失败传播、全通过、SUITES 清单、filter。
- 问题：`.gitignore` 当前仍为 `tests/*`，只豁免旧测试入口；`tests/run-all.js` 与 `tests/test-run-all.js` 被忽略，`git ls-files` 为空。
- 结论：提交前必须给 `.gitignore` 加 `!tests/run-all.js` 与 `!tests/test-run-all.js`，否则 `CLAUDE.md` / `REFERENCE.md` 会指向未发布文件。

### agent-tests helper schema-version 检测

状态：helper 修复正确，但覆盖范围需诚实表述。

- `verify-output` 新增合法 validation key：`frontmatter_schema_version`。
- `checkFrontmatterSchemaVersion(file, expectedVersion)` 能区分 `"6.0"` vs `"7.0"`，并兼容不传 expectedVersion 时只查存在。
- `ATF-03/03b` 已进自动回归，`agent-helpers` 从 9/9 增至 11/11。
- 边界：`tests/agent-tests/README.md` 已明确真 agent contract suite 不在 `run-all` 内，fixtures 仍是 v6 形态；因此本修复只算“检测能力补齐”，不算“契约套件全面 v7 化”。

## 需要立即处理的发布阻断

1. `.gitignore` 缺 `tests/run-all.js` / `tests/test-run-all.js` 例外。
2. 本地修复尚未提交，远端 v7.2.2 仍不包含日志隔离、run-all、agent-tests helper schema-version 检测。

