# PACEflow v7.2.3 Codex 审计：发布面与已知未修复错误

> 类型：Codex 审计
> 日期：2026-06-14
> 审计对象：远端 `origin/master@1deccc44b577eb00f10ad6f2b89a2c3270a17ef6`
> 审计区间：`52f3461..HEAD`，重点复核 `18b21bd..HEAD`（v7.2.1/v7.2.2/v7.2.3）
> 干净验证 worktree：`/tmp/paceflow-audit-v723-EQp272`

## 结论

v7.2.3 发布态没有发现 P0/P1 阻断。v7.2.0 Codex 审计的 5 个发布问题、v7.2.2 复核里的本地待提交阻断，以及 v7.2.3 声称补进远端的工程卫生项，均已进入 `origin/master` 并有自动化覆盖。

仍未修复的已知项主要是结构/覆盖/产品方向债，不是新引入的 runtime 阻断：

1. `emitDeny` / deny 出口统一仍延期到 v7.2.4。
2. 真 artifact-writer agent contract suite 仍是半自动、fixtures 仍为 v6 形态。
3. `LOCKS-001`：多个独立 clone 共享同一 vault project 并发 reserve 仍可能重复编号。
4. 对外 adoption 面仍缺 quickstart / lite profile / 竞品坐标，这一点被 research/direction 文档支持，但尚未进入实现。

本次新增确认 1 个 P3 发布卫生问题：`git diff --check 52f3461..HEAD` / `18b21bd..HEAD` / `HEAD^..HEAD` 均因 `docs/audits/audit-2026-06-14-codex-fixed-items-verification.md` 末尾多空行失败。`node tests/run-all.js` 的 `git-diff-check` 只跑无区间的 `git diff --check`，在干净 worktree 中无法发现已提交 release diff 的 whitespace 问题。

## 发布面验证

远端与版本面：

- `origin/master` = `1deccc4`，本地 `master...origin/master` 同步。
- `.claude-plugin/marketplace.json` version = `7.2.3`。
- `plugin/.claude-plugin/plugin.json` version = `7.2.3`。
- `plugin/hooks/pace-utils/constants.js` `PACE_VERSION = 'v7.2.3'`。
- plugin manifest 中 agent / command 引用完整；`plugin/hooks/hooks.json` 9 类事件引用完整。
- `LICENSE` 与 `plugin/LICENSE` 均在远端 tracked 文件内。
- `tests/run-all.js` 与 `tests/test-run-all.js` 已被 `.gitignore` 例外放行并 tracked。

自动验证：

- `node tests/run-all.js`：8/8 PASS
  - `test-pace-utils`：287/287
  - `test-hooks-e2e`：402/402
  - `test-session-layers`：47/47
  - `test-migrate-v7`：16/16
  - `test-agent-tests-helpers`：11/11
  - `test-run-all`：4/4
  - `claude plugin validate ./plugin`：PASS
  - 无区间 `git diff --check`：PASS
- `find . -name '*.js' -print0 | xargs -0 -n 1 node --check`：PASS
- `bash -n tests/agent-tests/run-agent-cli-suite.sh`：PASS
- `node tests/agent-tests/run-tests.js dummy`：PASS

区间发布检查：

- `git diff --check 52f3461..HEAD`：FAIL，`docs/audits/audit-2026-06-14-codex-fixed-items-verification.md:126: new blank line at EOF.`
- `git diff --check 18b21bd..HEAD`：同上。
- `git diff --check HEAD^..HEAD`：同上，说明问题由 v7.2.3 单提交引入。

## 已修复项复核

### v7.2.0 Codex 审计 5 项

状态：正确修复。

- P1 `migrate-v7 --dryrun` 误拼静默真迁移：`V7E-1d` 覆盖未知参数 fail-fast，`V7E-1e` 覆盖取值型 flag 缺值 fail-fast。
- P2 schema 前向兼容 guard 未覆盖 artifact-writer Agent：`pre-tool-use.js` 在 artifact-writer lifecycle/base 校验前检测 newer schema；`V7F-7` 覆盖 8.0 数据下派 agent 会 deny 升级提示，不走 7.0 lifecycle 裁判。
- P2/P3 `set-project-root --cwd/--mode` 缺值吞 flag：`9hc-helper4e` 覆盖 fail-closed 不写 `.pace`。
- P3 v7 文档残留 v6 / task-impl 口径：当前 README/REFERENCE 主路径未再命中 `v6 CHG`、`task/impl`、`schema-version "6.0"` 等旧发布检查口径；剩余 `implementation_plan.md` 命中属于迁移/历史/保护路径。
- P3 MIT license 缺正文：根目录和 plugin 发布根均已补 LICENSE。

### v7.2.2 A1-A5

状态：正确修复。

- A1 确定性网关：`V7G-1/2/3`、`9hc-review3` 覆盖 verify/review/close 偏序与 unknown operation hard-deny。
- A2 change-owner 一致性：`V7H-1..4` 覆盖内部 timestampMs、blocked heartbeat、foreign/sibling-fresh 写盘 deny 与自有放行。
- A3 schema/parser 对齐：`V7B-8` 覆盖 status 枚举，`V7G-4` 覆盖 `hasNonNull*Date` 与 frontmatter parser 对齐。
- A4 helper 健壮性：`cli-args.js` 提供 `flagValue()`；reserve/sync-plan 的取值型参数走 missingValue fail-closed；v7.2.3 又补上 `reserve --count`。
- A5 发布面文档/合规：README 迁移命令已用 `${CLAUDE_PLUGIN_ROOT}` 并给普通 shell fallback；旧 `57%` 精确指标移除；CLAUDE.md 收敛到 `node tests/run-all.js`。

### v7.2.3 工程卫生项

状态：大体正确，除区间 whitespace P3。

- `tests/run-all.js` 发布完整，能串起核心套件、plugin validate、无区间 `git diff --check`，失败传播由 `tests/test-run-all.js` 覆盖。
- `PACE_LOG_PATH` 日志隔离已进真实 hook 路径，`LOG-ISOLATION` 断言源码树 `plugin/hooks/pace-hooks.log` 不被 e2e 写入。
- agent-tests helper 增加 `frontmatter_schema_version` 检测，`ATF-03/03b` 自动回归覆盖。
- SessionStart budget head 增加 cap 与 `headOverflow` 信号；`SL-HO-1/2`、`SL-CAP-1/2`、`SL-SAT` 覆盖 head 超限、cap 与满载 20 活跃 CHG。
- 项目检测双实现已下沉为 `plugin/hooks/pace-utils/detection.js`，path-utils 与门面共享；`DETECT-1/2` 覆盖三方等价锁。
- `reserve --count` 已改用 `flagValue()`，`RES-count-peek` 覆盖后跟 flag 时 fail-closed。

## 仍未修复的已知错误/风险

### K1. deny 出口统一仍未做（v7.2.4 planned）

严重度：P2/P3 结构债。

证据：

- README v7.2.3 changelog 明确写 `1.8 emitDeny 延后 v7.2.4`。
- `REFERENCE.md` 仍把 PreToolUse 输出分为 `denyOrHint()` / `hardDeny()` / `inline-deny` 三档。
- `plugin/hooks/pre-tool-use.js` 仍有大量 inline `process.stdout.write(JSON.stringify(output))` 和手写 deny shape；例如 artifact-writer newer-schema、artifact-dir、lifecycle、owner 写盘复核、status invalid、reservation missing、resource lock 等路径。

风险：

- 当前测试覆盖了关键 hard-deny / teammate / escape-hatch 代表路径，未发现新可达 runtime bug。
- 但后续新增 deny 分支仍容易漏掉 escape hatch、artifact dir hint、teammate 富化或统一日志字段；这正是 `optimization-2026-06-13-release-surface-review.md` 原本指出的 drift 风险。

### K2. 真 artifact-writer contract suite 仍休眠且 fixtures 仍 v6

严重度：P2 覆盖缺口。

证据：

- `tests/agent-tests/README.md` 明确写：该套件不在 `node tests/run-all.js` 内，dummy 只跑 mock 框架自测，不碰真 agent。
- 同文档说明 fixtures 仍是 v6 形态，真实非 dummy 跑停在 2026-06-02。

风险：

- v7.2.3 修的是 helper 检测能力，不等于真 agent 契约套件全面复活。
- 当前真实 dogfood 与 e2e 能覆盖主路径，但系统化负例/CI agent contract 回归仍缺。

### K3. `LOCKS-001` 跨独立 clone 共享 vault 重复编号仍 deferred

严重度：P2 低概率高影响架构边界。

证据：

- README 已知限制写明：多个独立 clone 共享同一云同步 vault project 并发开 CHG 时，sequence counter/lock 绑本地 project-runtime、不跨 clone，可能分配重复 CHG/HOTFIX/CORRECTION 编号。
- optimization 文档 §9.12 也记录该项需要 artifact-root-bound 运行态，架构决策 deferred。

风险：

- 单人单活跃 clone 使用下概率极低。
- 多机/多 clone 同时 reserve 同一 vault project 时仍可能产生重复 ID；这不是 v7.2.3 修复范围。

### K4. adoption 面方向债仍未实现

严重度：产品/文档 P3，不是 runtime bug。

证据：

- research/direction 文档支持 `lite|full` 与按 blast-radius 校准。
- optimization 文档指出 README 缺 quickstart、缺渐进档、缺竞品坐标。
- 当前 README 仍没有 Quick Start / 第一个 CHG / lite profile / Spec Kit / OpenSpec / plan mode 对照入口。

风险：

- 不影响现有严格模式用户的运行正确性。
- 会继续限制第二用户上手和价值判断；这与外部证据文档的结论一致。

## 本次新增发现

### P3. v7.2.3 提交包含 EOF 空行，区间 `git diff --check` 失败

证据：

- `git diff --check HEAD^..HEAD` 输出：`docs/audits/audit-2026-06-14-codex-fixed-items-verification.md:126: new blank line at EOF.`
- `tail -c` 显示该文档以两个换行结尾。
- `node tests/run-all.js` 未捕获该问题，因为它的 `git-diff-check` 套件只运行无区间 `git diff --check`；干净 worktree 下无未提交 diff，因此通过。

影响：

- 不影响 plugin runtime。
- 影响 release hygiene，并会让“从某基线到当前 HEAD 的发布区间 diff check”失败。

建议：

- 删除该文档末尾多余空行。
- 可选：给 release 流程增加显式区间检查，例如 `git diff --check <previous-release>..HEAD`，不要只依赖无区间 `git diff --check`。

## 审计边界

- 本审计验证的是远端 `origin/master` 干净 worktree 与仓库发布面；当前主工作区存在未跟踪本地文件，未纳入发布结论。
- 未执行真实 marketplace 安装/升级到用户环境，只执行本地 `claude plugin validate ./plugin`。
- 未跑真实 artifact-writer LLM agent contract suite；该缺口已作为 K2 单列。
