# PACEflow v7.2.5 Codex 审计：emitDeny / deny 出口发布面

> 类型：Codex 审计
> 日期：2026-06-14
> 审计对象：远端 `origin/master@98c4ea29b18b0e9ad19a6d6bd176481551b33eb7`
> 增量区间：`b593063..98c4ea2`（v7.2.4 -> v7.2.5）
> 全量参照区间：`52f3461..98c4ea2`（v7.1.0 后发布面）

## 结论

v7.2.5 的核心目标（`pre-tool-use.js` deny 出口收敛到 `emitDeny(action, reason, fields)` + `DENY_REASONS` 表）在当前 runtime 层未发现 P0/P1/P2 阻断。当前发布态满足：

- `origin/master` 与本地 `HEAD` 均为 `98c4ea2`。
- 版本发布面一致：marketplace、plugin manifest、`PACE_VERSION`、README 页脚、REFERENCE 标题均为 v7.2.5。
- `permissionDecision: "deny"` 手写出口从旧版 25 处收敛到 2 处：`emitDeny` 内部与全局 catch fail-closed。
- `DENY_REASONS` 表 53 项；按旧三族语义独立复核 `escapeHatch / dirHint / teammateMode`，53/53 无错配。
- `node tests/run-all.js` 8/8 通过，`test-hooks-e2e` 增至 437/437，新增 golden 33 label 与结构 census 均通过。

本次严格审计新增 P3 级问题 3 个，均非 runtime 阻断：

1. `REFERENCE.md` §5.1 仍用旧实现名 `denyOrHint()` / `hardDeny()` / inline-deny 描述档位，已与 v7.2.5 的 `emitDeny + DENY_REASONS` 结构不一致。
2. README v7.2.5 release note 的出口计数有轻微不准：当前/旧版可复核 hardDeny call site 是 26，不是 24；旧 raw inline deny 是 22（不含全局 catch），不是 21。总数 62 只有把全局 catch 一并计入时才成立。
3. 新结构测试只校验表项存在、直接 `emitDeny` code 在表内、手写 deny 出口数量和 census 覆盖；没有自动断言每个 action 的 `escapeHatch / dirHint / teammateMode` 值。当前值人工复核正确，但后续表值漂移仍可能绿灯。

## 发布验证

版本面：

- `.claude-plugin/marketplace.json` version = `7.2.5`
- `plugin/.claude-plugin/plugin.json` version = `7.2.5`
- `plugin/hooks/pace-utils/constants.js` `PACE_VERSION = 'v7.2.5'`
- `README.md` 页脚与版本历史为 `v7.2.5`
- `REFERENCE.md` 标题为 `v7.2.5`
- 未发现 `v7.2.5` git tag；当前发布追溯依赖 release commit 与 manifest version。

自动与静态验证：

- `node tests/run-all.js`：8/8 PASS
  - `test-pace-utils`：288/288
  - `test-hooks-e2e`：437/437
  - `test-session-layers`：48/48
  - `test-migrate-v7`：16/16
  - `test-agent-tests-helpers`：11/11
  - `test-run-all`：5/5
  - `claude plugin validate ./plugin`：PASS
  - `git-diff-check`：PASS
- `find plugin tests -name '*.js' -print0 | xargs -0 -n 1 node --check`：PASS
- `node tests/agent-tests/run-tests.js dummy`：PASS
- `bash -n tests/agent-tests/run-agent-cli-suite.sh`：PASS
- `git diff --check b593063..98c4ea2`：PASS
- `git diff --check 52f3461..98c4ea2`：PASS
- `git diff --check HEAD^..HEAD`：PASS

工作区边界：

- 测试后无 tracked 文件变化。
- 当前存在未跟踪文件 `2026-06-12-115732-v700-reload-session-dogfood-backl.txt` 与上一轮本地审计文档 `docs/audits/audit-2026-06-14-codex-v7.2.4-release-surface.md`，未纳入发布态结论。

## emitDeny 复核

### 正确收敛的部分

状态：正确。

- `DENY_REASONS` 位于 `plugin/hooks/pre-tool-use.js` 模块级，表项覆盖 53 个 deny action code。
- `hardDeny()` 已变为薄包装，委托 `emitDeny(action, reason, { tool, file, ...fields })`，保留旧 hardDeny 日志字段形态。
- `emitDeny()` 处理顺序为：去 `_TEAMMATE` 后缀查表 -> `dirHint` 富化 -> `escapeHatch` 富化 -> teammate soft/hard-note/hard 输出分支 -> stdout -> log。
- 旧 `denyOrHint` 顺序是 `appendArtifactDirHint()` 后 `withEscapeHatch()`；新实现保持该顺序。
- 旧 raw inline deny 出口迁到 `escapeHatch:false / dirHint:false / teammateMode:'hard'`，未被误加退出口或 artifact dir hint。
- `DENY_DIRECT_ARTIFACT_EDIT` 两处旧 caller 预包 `appendArtifactDirHint()` 改由表值 `dirHint:true` 富化，行为等价。
- 全局 catch fail-closed 仍保留独立 raw deny，符合 release note 描述。

独立表值复核：

- soft：`DENY_AGENT_ARTIFACT_ROOT_CHOICE` / `DENY_ARTIFACT_ROOT_CHOICE` / `DENY_NATIVE_PLAN` / `DENY` -> `escapeHatch:true, dirHint:true, teammateMode:'soft'`
- hard-note：Bash/PowerShell/Monitor artifact 修改、V6 malformed/detail/no-active/C/E -> `escapeHatch:true, dirHint:true, teammateMode:'hard-note'`
- hardDeny：bad stdin/tool、runtime-control、direct write/edit、marker 等 -> `escapeHatch:true, dirHint:false, teammateMode:'hard'`，仅 `DENY_DIRECT_ARTIFACT_EDIT` 为 `dirHint:true`
- raw：agent 派发校验、owner、reservation、resource lock、redirect、status invalid、write existing/artifact 等 -> `escapeHatch:false, dirHint:false, teammateMode:'hard'`

结果：53/53 与旧语义一致。

### P3-1. REFERENCE 拒绝档位表仍写旧实现名

严重度：P3 文档/维护面。

证据：

- `REFERENCE.md:201-203` 仍写：
  - `denyOrHint(reason)`
  - `denyOrHint(reason, { hardInTeammate: true })`
  - `hardDeny() 或 inline-deny`
- v7.2.5 代码已删除 `denyOrHint` 函数，`hardDeny` 只是 `emitDeny` 包装，inline deny 只剩全局 catch。

影响：

- 不影响用户 runtime。
- 会误导维护者继续按旧三族理解新增 deny 分支，削弱本次 `DENY_REASONS` 表驱动收敛的发布面叙事。

建议：

- 把 `REFERENCE.md` §5.1 的“实现”列改成 `emitDeny` 表值：
  - `teammateMode:'soft'`
  - `teammateMode:'hard-note'`
  - `teammateMode:'hard'`
  - 并注明 catch fail-closed 是唯一保留 inline raw deny。

### P3-2. README v7.2.5 出口计数轻微不准

严重度：P3 发布说明准确性。

证据：

- 旧版 `b593063:plugin/hooks/pre-tool-use.js`：
  - `return hardDeny(` call site = 26
  - `denyOrHint(` call site（不含函数定义）= 13
  - raw inline `permissionDecision:'deny'`（不含 `denyOrHint`/`hardDeny` 函数定义与全局 catch）= 22
  - 全局 catch fail-closed = 1
- 当前版 `98c4ea2`：
  - `return hardDeny(` call site 仍为 26
  - `permissionDecision:'deny'` 总数为 2（`emitDeny` + catch）

README v7.2.5 写“`hardDeny` 24 站点不变”“13 denyOrHint + 21 raw 直迁”“原 62 个手写 deny 出口”。其中：

- “62”只有按 26 hardDeny + 13 denyOrHint + 22 raw + 1 catch 计算才成立。
- “24 hardDeny”与“21 raw”不符合当前可复核计数。

影响：

- 不影响 runtime。
- 会降低 release note 作为审计索引的可信度；尤其本次主打“逐条锚定 0 mismatch”，计数应能被机械复核。

建议：

- README 改成可机械复核的口径，例如：`26 hardDeny call site 保持薄包装；13 denyOrHint call site 迁移；22 inline raw deny 迁移；全局 catch fail-closed 独立保留`。

### P3-3. 结构测试未自动断言表值

严重度：P3 测试护栏。

证据：

- `tests/test-hooks-e2e.js` 的结构测试校验：
  - `DENY_REASONS` 表存在并能提取 key
  - 直接 `emitDeny(...)` 的 code 均在表内
  - fail-fast 文案存在
  - `permissionDecision:'deny'` 手写出口数为 2
  - `GOLDEN_COVERED_CODES + GOLDEN_DEFERRED` census 均在表内
- 但没有断言每个 action 的 `escapeHatch / dirHint / teammateMode` 是否等于期望值。

本次 Codex 用旧实现语义做了独立脚本复核，当前 53/53 正确；问题是后续若把某个 deferred action 的 `escapeHatch` 或 `dirHint` 写反，现有结构测试可能仍绿，除非该 action 正好在 33 个行为 golden label 内。

建议：

- 在结构测试中增加 `EXPECTED_DENY_META`，逐项断言 53 个 action 的三元组。
- 或至少对 `GOLDEN_DEFERRED` 的 29 个非 catch action 断言三元组，因为这些正是行为 golden 未覆盖的出口。

## 已知未修复项复核

### K1. `emitDeny` / deny 出口统一

状态：v7.2.5 已完成主体修复。

剩余只是 P3 文档/测试护栏问题：REFERENCE 旧实现名未同步、README 计数不准、结构测试不锁表值。

### K2. 真 artifact-writer contract suite 仍休眠且 fixtures 仍 v6

状态：仍未修复。

证据：

- `tests/agent-tests/README.md:8-12` 明确写本套件不在 `node tests/run-all.js` 内，`dummy` 只跑 mock 框架自测，不碰真 agent。
- 同文档写 fixtures 仍为 v6 形态，真实非 dummy 跑停在 2026-06-02。
- `tests/run-all.js` 只纳入 `tests/test-agent-tests-helpers.js`，没有纳入真实 agent contract suite。

影响：v7.2.5 的 deny 出口 refactor 有强 e2e/golden 覆盖，但“真实 LLM artifact-writer 在 v7 合同下的系统化负例/CI 回归”仍是覆盖缺口。

### K3. `LOCKS-001` 跨独立 clone 共享 vault 重复编号仍 deferred

状态：仍未修复。

证据：

- README 已知限制仍写多个独立 clone 共享同一云同步 vault project 并发 reserve 时，本地 `.pace` counter/lock 不跨 clone，可能重复分配编号。
- v7.2.5 未触碰 artifact-root-bound runtime 或跨 clone sequence 机制。

### K4. adoption / quickstart / lite profile / 证据门方向债仍未实现

状态：仍未修复。

证据：

- `optimization-2026-06-13-release-surface-review.md` 仍记录 quickstart、lite profile、竞品对照为产品方向债。
- `research-2026-06-13-does-paceflow-help.md` 仍支持按场景匹配最小严格度，而当前产品仍是 full ceremony 默认。
- `direction-2026-06-13-constraint-philosophy-evidence-gates.md` 提出的 V/R “声明 -> 证据”仍是方向记录，未进入实现。

## 审计边界

- 未执行真实 marketplace 安装/升级，只执行了本地 `claude plugin validate ./plugin`。
- 未跑真实 artifact-writer LLM agent contract suite；该缺口已列为 K2。
- 没有复现 README 中提到的外部 “opus 对抗审计” 原始过程，只复核当前发布 commit 内可机械验证的代码、测试与文档证据。
