# PACEflow v7.2.4 Codex 审计：发布面严格复核

> 类型：Codex 审计
> 日期：2026-06-14
> 审计对象：远端 `origin/master@b59306344ec1cd1799fea7d5341233459c7265cd`
> 增量区间：`1deccc4..b593063`（v7.2.3 -> v7.2.4）
> 全量参照区间：`52f3461..b593063`（v7.1.0 后发布面）

## 结论

v7.2.4 发布态未发现 P0/P1 阻断。版本号发布面一致，v7.2.3 的 EOF 空行 release hygiene 问题已被删除，SessionStart 注入调优与 bash/PowerShell guard over-block 修复均有自动化覆盖并通过完整 `run-all`。

本次新增/确认的严格审计结论：

1. P3：`run-all` 的 `git-diff-check` 只覆盖工作树和 `@{upstream}..HEAD`。当前 v7.2.4 已 push，`@{upstream}..HEAD` 为空，因此它不能在发布后复核整段 release diff 的 whitespace；本次由 Codex 手动跑 `1deccc4..HEAD` / `52f3461..HEAD` / `HEAD^..HEAD` 均通过。
2. P2/P3 已接受风险：paceflow 仓库自身的 `tests/*.js` 被视为 maintainer-trusted validation script，guard 跳过源码写 artifact 扫描。用户项目因 `plugin.json name==='paceflow'` gate 不受影响，但 paceflow repo 内新增/被篡改的测试脚本仍是信任边界。
3. 既有未修复项仍在：`emitDeny` 统一、真 artifact-writer contract suite 复活、`LOCKS-001` 跨独立 clone 共享 vault 编号、quickstart/lite profile/证据门方向债。

## 发布验证

版本与发布面：

- `.claude-plugin/marketplace.json` version = `7.2.4`
- `plugin/.claude-plugin/plugin.json` version = `7.2.4`
- `plugin/hooks/pace-utils/constants.js` `PACE_VERSION = 'v7.2.4'`
- `README.md` 页脚与版本历史为 `v7.2.4`
- `REFERENCE.md` 标题为 `v7.2.4`
- `CHANGELOG.md` 明确冻结为 v5 历史，v6+ 版本历史以 README 为准；因此未改 CHANGELOG 不构成发布遗漏
- 未发现 `v7.2.4` git tag；本项目当前发布可追溯主要依赖 release commit 与 manifest version

自动验证：

- `node tests/run-all.js`：8/8 PASS
  - `test-pace-utils`：288/288
  - `test-hooks-e2e`：402/402
  - `test-session-layers`：48/48
  - `test-migrate-v7`：16/16
  - `test-agent-tests-helpers`：11/11
  - `test-run-all`：5/5
  - `claude plugin validate ./plugin`：PASS
  - `git-diff-check`：PASS
- `find plugin tests -name '*.js' -print0 | xargs -0 -n 1 node --check`：PASS
- `git diff --check 1deccc4..HEAD`：PASS
- `git diff --check 52f3461..HEAD`：PASS
- `git diff --check HEAD^..HEAD`：PASS
- `node tests/agent-tests/run-tests.js dummy`：PASS
- `bash -n tests/agent-tests/run-agent-cli-suite.sh`：PASS

工作区边界：

- 测试后无 tracked 文件变化。
- 工作区仅有一个既存未跟踪文件 `2026-06-12-115732-v700-reload-session-dogfood-backl.txt`，未纳入发布结论。

## v7.2.4 改动复核

### SessionStart 注入调优

状态：正确修复。

- `walkthrough.md` 表格截断从最近 10 条降为最近 5 条。
- `corrections.md` 截断从最近 6 条提升为最近 30 条，保留“避免重犯”高价值记录。
- 两者仍只影响 `group==='artifact'` 的 L3 可截层，不扩大 core head。
- `SL-34` 覆盖 walkthrough 最近 5 条，并同时覆盖 startup/compact。
- `SL-CORR-1` 覆盖 corrections `<=30` 全显示、`>30` 保留最新 30 + 指针，并同时覆盖 startup/compact。
- e2e `2e/2e3` 同步更新，证明实际 SessionStart hook 输出符合预期。

### bash/PowerShell guard over-block HOTFIX

状态：主目标正确修复，保留已声明的 maintainer-trusted 边界。

- `isPaceflowValidationScriptTarget()` 从硬编码 `test-pace-utils.js` / `test-hooks-e2e.js` 放宽为 paceflow repo 内 `tests/*.js`。
- Bash 与 PowerShell 两侧对称放宽。
- 反向测试覆盖：
  - `node -e writeFileSync('task.md')` 仍被拦截。
  - 非 paceflow 仓库的 `tests/evil.js` 写 artifact 仍被源码扫描并拦截。
  - PowerShell `node tests/test-session-layers.js` 同样放行。

残余边界：paceflow 仓库自身任何 `tests/*.js` 都被信任，源码扫描直接跳过。这和 README v7.2.4 changelog 写的 “P2 maintainer-trusted 盲区 won't-fix” 一致，不是用户项目 runtime 防护削弱，但仍是维护仓库的信任边界。

### release hygiene

状态：v7.2.3 的具体 EOF 空行已正确修复；run-all 覆盖仍有 post-push 边界。

- `docs/audits/audit-2026-06-14-codex-fixed-items-verification.md` 末尾多余空行已删除。
- 当前三个区间 `git diff --check` 全部通过。
- `tests/run-all.js` 新增 `gitWhitespaceCheck()`，会检查：
  - 工作树未提交 diff：`git diff --check`
  - 未 push 区间：`git diff --check @{upstream}..HEAD`
- 但当前发布后 `git rev-list --count @{upstream}..HEAD = 0`，所以 `run-all` 在 post-push/远端干净检出场景不会检查 `previous-release..HEAD`。

建议：给 release 流程加显式 base，例如 `PACE_RELEASE_BASE=1deccc4 node tests/run-all.js` 或单独 suite 执行 `git diff --check "$PACE_RELEASE_BASE..HEAD"`；否则仍需要审计者手动跑发布区间。

## 已知未修复项

### K1. `emitDeny` / deny 出口统一仍未做

严重度：P2/P3 结构债。

- README v7.2.4 明确写 “1.8 emitDeny 仍延后”。
- `REFERENCE.md` 仍把 PreToolUse 输出分为 `denyOrHint()` / `hardDeny()` / inline-deny。
- `plugin/hooks/pre-tool-use.js` 仍有大量手写 `permissionDecision: "deny"` 与 `process.stdout.write(JSON.stringify(output))`。

影响：当前关键路径测试覆盖仍绿；风险是后续新增 deny 分支继续发生 escape hatch、dir hint、teammate 富化或日志字段漂移。

### K2. 真 artifact-writer contract suite 仍休眠且 fixtures 仍 v6

严重度：P2 覆盖缺口。

- `tests/agent-tests/README.md` 明确说明该套件不在 `node tests/run-all.js` 内。
- `node run-tests.js dummy` 只跑 mock 框架自测，不碰真 agent。
- fixtures 仍是 v6 形态；最近真实非 dummy 跑停在 2026-06-02。

影响：v7.2.4 的 helper 检测能力已在自动测试内，但“真 artifact-writer agent 在 v7 合同下的系统化负例/CI 回归”仍没有恢复。

### K3. `LOCKS-001` 跨独立 clone 共享 vault 重复编号仍 deferred

严重度：P2，低概率高影响架构边界。

- README 已知限制仍写明：多个独立 clone 共享同一云同步 vault project 并发开 CHG 时，本地 `.pace` counter/lock 不跨 clone，可能重复分配编号。
- v7.2.4 未触碰 artifact-root-bound runtime 或跨 clone sequence 机制。

### K4. 产品采用面与方向债仍未实现

严重度：P3，产品/文档方向，不是 runtime bug。

- `optimization-2026-06-13-release-surface-review.md` 建议的 quickstart、lite profile、竞品对标仍未进入发布面。
- `research-2026-06-13-does-paceflow-help.md` 支持按场景匹配最小严格度，但当前产品仍是 full ceremony 默认。
- `direction-2026-06-13-constraint-philosophy-evidence-gates.md` 提出的 V/R “声明 -> 证据”仍只是方向记录，当前 V/R 仍主要验 marker/字段声明。

## 审计边界

- 本审计没有执行真实 marketplace 安装/升级，只执行了本地 `claude plugin validate ./plugin`。
- 未跑真实 artifact-writer LLM agent contract suite；该缺口已列为 K2。
- 未审计外部云同步 vault 在多机并发下的真实冲突，只复核代码与文档中 `LOCKS-001` 的当前状态。
