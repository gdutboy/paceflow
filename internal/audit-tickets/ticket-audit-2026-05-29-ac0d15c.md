---
title: PaceFlow 全仓库严格审计 audit-2026-05-29-ac0d15c
audit-date: 2026-05-29T23:10:00+08:00
git-head: ac0d15ca82b509fcb67df0d05dacac26be77e503
git-head-short: ac0d15c
prior-audit: docs/audits/audit-2026-05-16-50c022a.md
status: completed
method: 10 维度并行发现 + C/H 对抗式验证（C 级三视角多数票）+ 覆盖度复核 + 主 session 亲自核实
scale: 16 agent / 1,715,010 subagent tokens / 547 tool uses / ~32 min
---

# audit-2026-05-29-ac0d15c: PaceFlow 全仓库严格审计

## 审查摘要

- **审查时间**: 2026-05-29T23:10:00+08:00
- **证据基线**: git HEAD `ac0d15c` + 工作区 clean；动态 Glob 发现文件，文档仅作候选线索与设计意图背景
- **版本基线**: v6.0.59（`plugin.json` / `marketplace.json` / `constants.js` 三处一致，已核实）
- **审查方式**: 在 `internal/skills/audit` 五维度纪律基础上细化为 **10 维度并行**（因 `pre-tool-use.js` 1602 行、并发锁/路径解析为高危区，需独立 agent 深读）；每维度 C/H 发现产出后立即进入对抗式验证（验证员默认立场=误报）；C 级用三视角多数票（路径可达性 / 设计意图 / 真实证据）；最后覆盖度 critic 核对未审文件 + 横切风险；主 session 亲自 Grep/Read 核实所有进入报告的横切声明

### 计数

| 阶段 | 数据 |
|------|------|
| Phase 1 原始发现 | 3C + 5H + 14W + 31 I/N = 53 条候选 |
| Phase 2 C/H 对抗验证（8 条进入验证池） | 3 ✅ 确认 / 0 ⚠️ 部分 / 0 ❌ 误报 |
| 误报率（C/H 级） | **0%**（历史 50-80%；对抗验证 + 端到端实测复现起效） |
| 覆盖度新增横切 | 2W + 4I（单维度不可见，主 session 已核实） |
| 各维度健康分 | 7–9，中位 8 |
| 确认 P0 必修 | 3（均为 H） |
| P1 建议 | 3 横切 + 4 W |
| P2 文档 | 4 |
| P3 延后（I 级） | 5+ |

### 关键观察

1. **唯一 C 级原始发现经三视角投票降级为 H**：bash-guard 误拦发现的三票为 confirmed(H) / partial(W) / confirmed(C)，2:1 确认成立但终级取 H。第二票（partial）的价值在于指出"裸文件名兜底是有意的反绕过设计，原修复方向会破坏 9hgd1/9hgd3 安全测试"——避免了一次错误修复。
2. **本轮最大系统性盲区**：因 [H-1] bash-guard 误拦，PACE 会话内无法跑 `node tests/test-hooks-e2e.js` / `test-pace-utils.js` 当绿灯，10 个维度结论几乎全为静态分析，缺运行验证。
3. **两个"注册面 vs 实现面"错配只有覆盖度复核能发现**：`post-tool-use.js` Agent 分支死代码（hooks.json 未注册 Agent 的 PostToolUse）、`acquireArtifactWriterLock` 无生产调用——任何单文件审查都看不到，需跨 hooks.json + 多 hook 对照。

---

## P0 必修（确认的可靠性问题）

### [H-1] bash-guard 误拦官方验证命令 —— dogfooding 阻断（✅ 确认）

- **位置**: `plugin/hooks/pre-tool-use/bash-guard.js:416-441`（`bashCommandEmbedsArtifactWriteScript`）+ `398-410`（`bashCommandReferencesArtifact`）
- **描述**: `bashCommandEmbedsArtifactWriteScript` 会读取被执行脚本的**源码**做扫描（脚本 < 256KB 时），命中 line 435 `commandTextContainsWriteApi(script) && bashCommandReferencesArtifact(script,...)`。后者 line 408 的兜底正则 `/(^|[\s"'`+"`"+`=])(?:\.\/)?(?:task\.md|implementation_plan\.md|...)(?=...)/` 对脚本源码里**裸出现的 `task.md`/`changes/` 字面量**做纯字符串匹配，与真实写入目标是否解析到 artifact 目录无关。
- **触发路径**: `pre-tool-use.js:180 withStdinParsed → :232 isPaceProject 为真 → :704 isBashTool 分支 → :717-721 mutatesArtifact（:719 命中 embed-script）→ :722-732 deny`（DENY_BASH_ARTIFACT）
- **实测证据**:
  - PACE-active 会话内 `node tests/test-hooks-e2e.js` 被实时硬 deny（测试源码 `tests/test-hooks-e2e.js:188` 含 `fs.writeFileSync(path.join(dir,'task.md'))`）
  - 探针 `bashCommandReferencesArtifact("fs.writeFileSync(path.join(dir,'task.md'),data)", '/zzz-cwd', '/zzz-art')` = `true`——即使 cwd/artDir 是完全无关路径
  - 现场二次实证：在 artifact 目录外运行普通脚本（源码含 `'task.md'` 字面量）也被真实 hook deny，`dangerouslyDisableSandbox` 不绕过
- **影响**: 阻断 `paceflow/CLAUDE.md`「常用验证」明列的核心命令 `node tests/test-hooks-e2e.js` / `node tests/test-pace-utils.js`，且误阻断任意源码含写 API + 裸 artifact 名的普通脚本。是本轮 10 维度全部无法跑 e2e 当绿灯的根因。
- **降级理由（C→H）**: 这是 over-blocking（拒绝合法操作）而非安全绕过（仍不允许任何非法 artifact 写入，无数据损坏）；teammate 模式下 denyOrHint 降级为 additionalContext 提醒。但硬阻断核心验证命令 + 误阻断普通脚本属高频功能性阻断，定 H。
- **修复**（⚠️ 勿简单放宽正则——会破坏 `tests/test-hooks-e2e.js` 中 9hgd1/9hgd3 反绕过安全测试）:
  1. 脚本体扫描分支（bash-guard.js:425-438）只在引用经 `resolveToolFilePath` + `artifactRelativePathForFile` 解析**落入真实 artifact 路径**时才算命中（保留 :400/:404-406 路径解析判定，去掉 :408-409 字面量兜底在脚本体递归扫描中的应用）
  2. 或为 `tests/`、`node_modules/` 等明显非 artifact 写脚本目录排除，并为文档化的官方验证命令提供 allowlist
  - **补回归测试**: 构造含 `'task.md'` 字面量的普通脚本，断言 `node` 执行它返回 `PASS_BASH`
- **CHG 归属建议**: 与 H-2 / X-1 / X-2 合并为一个 hook 守卫一致性 CHG

### [H-2] bash-guard 遗漏 change-owners，可 Bash 绕过 owner 边界（✅ 确认）

- **位置**: `plugin/hooks/pre-tool-use/bash-guard.js:261-263, 294-309`
- **描述**: bash-guard 的运行态控制正则只覆盖 `locks|sequences|reservations|index-transactions`，**漏了 `change-owners`**；powershell-guard（`:177/194/200/204`）已覆盖——两个 guard 保护面**不对等**。根因：bash-guard.js:262/306 的 fallback 正则用 `(?:locks|...)(?:\/|$)` 兜底裸目录，但 `change-owners` 不在该 alternation 里，而 `locks.js:758-773` 的 `isArtifactRuntimeControlPath` 用 `/^change-owners\//` 要求带子路径，裸目录彻底无兜底。
- **触发路径**: `pre-tool-use.js:704 isBashTool → :705 bashCommandMutatesArtifactRuntimeControl=false → :717 通用 mutatesArtifact 对 .pace/change-owners 亦 false → :733 PASS_BASH 放行`；删除目录后 `readChangeOwner(locks.js:489)` 抛错 → `changeOwnerStatus(:601)` 返回 `unknown` → `pre-tool-use.js:594-645` 的 foreign-owner deny 仅对 foreign-fresh/foreign-stale 触发，`unknown` 直接跳过
- **实测证据**: `'rm -rf .pace/change-owners'` ⇒ `false`、`'mv .pace/change-owners /tmp/x'` ⇒ `false`、带尾斜杠 ⇒ `false`；对照 `'rm -rf .pace/locks'` ⇒ `true`、`'rm .pace/change-owners/foo.json'`（子路径）⇒ `true`
- **影响**: 用 Bash 执行 `rm -rf .pace/change-owners`（或 `mv` 整目录）即可清空 change-owner 记录，绕过跨 session/worktree owner 边界——本 session 可对他人正在负责的 CHG 执行 update-chg/close-chg/archive-chg。deny 文案恰恰禁止此行为，PowerShell 已堵 Bash 未堵。
- **修复**: bash-guard.js:262 fallback 正则改为 `/(?:^|\/)\.pace\/(?:locks|sequences|reservations|index-transactions|change-owners)(?:\/|$)/`；:306 行级正则同步加 `change-owners`；:294-303 为 `${runtime}/change-owners` 与 `${relRuntime}/change-owners` 各加一条 `bashTextReferencesPathOrChild`，与 powershell-guard.js:177/194/200/204 完全对齐。补 e2e 用例覆盖裸目录及尾斜杠的 `rm`/`mv`（均应 deny）。

### [H-3] 序列号锁的 reentrant 短路破坏 ID 唯一性（✅ 确认）

- **位置**: `plugin/hooks/pace-utils/locks.js:675-697`（依赖 `acquireJsonLock` :218-251）
- **描述**: `nextSequenceNumber` 复用了带 reentrant 语义的 `acquireJsonLock`，owner 只带 `sessionId`（:679-684），`lockOwnerInfo` 在无 agentId 时 `ownerKey='session:<sid>'`（:167）。两个同 session 进程并发时第二个进程命中 `lockMatchesOwner` 的 reentrant 短路（:239-241）**立即进入临界区不等待**，二者读到同一 counter → 计算出相同 nn → 生成重复编号；`finally` 的无条件 `unlinkSync`（:695）还会让第一个进程提前丢锁。
- **触发路径**: `reserve-artifact-id.js` 是独立进程（:180 main），`parseArgs` 从不设 agentId（:11-37）→ 两个并发 `node reserve-artifact-id.js --operation create-chg` 各自 `ownerKey='session:<sid>'` → P1 `openSync('wx')` 拿锁 → P2 EEXIST → 读到 P1 锁、非 stale、ownerKey 相同 → 命中 reentrant 短路进临界区 → 若 P2 counter 读发生在 P1 counter 写之前 → 重复 `chg-YYYYMMDD-01`
- **降级理由（保持 H）**: reentrant 短路本身是有意设计（pre-tool-use.js:1089 对 artifact 资源锁合法复用），缺陷在 nextSequenceNumber 错误复用带 reentrant 语义的锁；触发条件较窄（同 session 真并发 + 微秒级读写交错），现有顺序测试 `test-pace-utils.js:483-505` 通过。但确属 ID 唯一性这一关键不变量破坏。
- **修复**: `acquireJsonLock` 增 `{reentrant:false}` 选项（或新增 `acquireExclusiveJsonLock`），`nextSequenceNumber` 用排他模式——EEXIST 时不走 `lockMatchesOwner` 短路，统一进 wait/重试或返回 sequence-locked；`finally` 的 `unlink` 仅在"本次为非 reentrant 真获取"时执行。补 fork 双进程同 session 并发 create-chg 回归测试，断言无重复编号。
- **CHG 归属建议**: 单独一个并发锁 CHG（语义改动需独立测试）

---

## P1 建议（确认的横切风险 + 高价值 W）

### 横切风险（覆盖度复核发现，主 session 已亲自核实）

| 编号 | 位置 | 问题 | 核实方式 |
|------|------|------|----------|
| **X-1** | `post-tool-use.js:93-127` vs `hooks.json:67-78` | PostToolUse matcher 仅 `Write\|Edit\|MultiEdit`，**不含 Agent** → `isAgentTool && isArtifactWriterAgentType` 分支的 owner-close + 资源锁释放是**生产死代码**；真正生效的 owner-close 是 `subagent-stop.js:137`（matcher "" 全捕获）。两处重复 close 逻辑，维护者改 post-tool-use 侧会误以为生效。 | Grep + Read hooks.json |
| **X-2** | `locks.js:82` / `post-tool-use-failure.js:51` / `subagent-stop.js:182` | `acquireArtifactWriterLock` **无任何生产调用**（仅 locks.js 定义 + pace-utils re-export + test-pace-utils 测试），但 `releaseArtifactWriterLock` 在两个 hook 被调用——"释放一把从未在生产获取的锁"，release 永远 no-op。生产真正并发控制是 `acquireArtifactResourceLock`(pre-tool-use.js:1057) + `reserveArtifactId`。应删除该死锁原语或在某 hook 真正 acquire。 | Grep 全仓确认 |
| **X-3** | `pre-tool-use.js:1599-1601` | 顶层 catch 只 `log ERROR`，不输出 `permissionDecision`、不 `process.exit` 非零 → 任一子守卫抛异常 = 写操作**静默 fail-open**。安全门定位下值得产品决策（其余 hook fail-open 无害，但 PreToolUse fail-open = 安全门失效）。建议补"子守卫抛异常"单测确认行为符合预期。 | Read 文件尾确认 |

### 高价值 W（静态分析）

| 编号 | 位置 | 问题 |
|------|------|------|
| W-4 | `session-start.js:143-145, 168-209` | compact 事件无条件把 `stop-block-count` 重置为 0，pre-compact 捕获的 blockCount 永不回写，降级进度 compact 后丢失 |
| W-5 | `update-chg.md:87-99` | 无任何 operation 能把 CHG 推入 `cancelled` 状态（schema 的 cancelled 分支 instruction 层不可达）；全任务 `[-]` 跳过被联动成 `completed` 而非 `cancelled`，可能写出语义错误状态 |
| W-6 | `pace-knowledge/SKILL.md:150-156` | 已发布用户 skill 引用**未发布**的 `internal/skills/audit` 流程作为联动触发条件，对 marketplace 用户不可达 |
| W-7 | `bump-version.js:118-124` | 第 5 个替换目标（REFERENCE.md 版本行）是永久 no-op，已与 REFERENCE.md 实际格式脱节 |

### 其余 W（静态分析，未端到端验证）

- `bash-guard.js:87-94` `commandTextLooksMutating` node/python 行 `[\s\S]*` 跨整行贪婪匹配，放大误报面
- `pre-tool-use.js:1130-1147` artifact-writer 资源锁已获取后走重定向 deny 分支时未释放，依赖 5min TTL 兜底
- `locks.js:43-48, 207-212` stale 判定用墙钟差，时钟回拨会让活跃锁被永久判旧或永不判旧
- `locks.js:138-156, 254-266` 释放锁时 stale 旁路允许非 owner 删除他人锁，时钟误判下可误放行
- `pace-utils.js:23-194, 745-786` 四个子模块导出符号未经门面 re-export，门面 API 表面与子模块全量导出存在差集
- `session-start.js:707-736` findings 过期提醒与 Stop 的过期检查使用不同数据源（findings.md 索引 vs changes/findings/*.md frontmatter），可能给出不一致判定
- `post-tool-use.js:93-121` change-owner 关闭依赖 agentId 一致性；Agent Pre/Post 两侧 agentId 都非空且不同会让 lockMatchesOwner 提前返回 false 而拒绝关闭
- `update-chg.md:88-90` update-status 全任务 `[-]` 跳过时被联动成 completed 而非 cancelled

---

## P2 文档（顺手修）

- `README.md:230-238`「多信号自动激活」表遗漏 `legacy` 与 `artifact-root(manual)` 两个激活信号
- `REFERENCE.md:103-116`「Hook 覆盖」表只列 9 个注册 hook，未区分 helper 脚本（reserve-artifact-id / sync-plan / set-artifact-root / set-project-root）
- `format-reference.md:78` corrections 索引示例缺 `[date::]` 字段，与 hook 模板格式注释及 record-correction 索引行格式不完全一致
- 4 个 Bash helper（reserve-artifact-id / set-project-root / set-artifact-root / sync-plan）的退出码契约（`exitCode=2` 业务错误 vs hook 的 `exit 0` 容错；helper 用顶层 `require` 无 try，hook 用 `try/catch exit 0`）无发布面文档说明，维护者易混淆

---

## P3 延后（I 级，建议派 record-finding 归档）

- `pre-tool-use.js:1130-1147` 重定向 deny 分支未释放资源锁（依赖 5min TTL）
- `pace-utils.js:473-478` `_artifactDirCache` / `_codeCountCache` 用 cwd 引用相等做键且 `_clearArtifactDirCache` 运行时从不被调用
- `locks.js:50-54, 302-306` `formatArtifactWriterLock` 计算 age 用 `Date.now()` 而非传入的 now（仅显示偏差）
- `constants.js:67` `SESSION_SCOPED_FLAGS` 中 `'todowrite-used'` 只被读取从不被写入（死引用）
- `agent-lifecycle-guard.js:316-425` update-chg 缺 action 时 lifecycle 检查直接放行（无 action 专属 deny）
- `marker-guard.js:37-40` 用精确字符串 includes 匹配 APPROVED/VERIFIED，不识别大小写/多空格变体（与消费端一致，非真实绕过）
- `artifact-writer.md:21-31, 70` 契约严格禁止标题前时间戳，但 SubagentStop hook 实际容忍（仅 WARN_PREFIX 不阻断）
- `create-chg.md:79, 187` 任务 ID 契约 T-NNN 与 hook `countDetailTasks` 的 `T-\d{3}` 正则在四位以上序号下不匹配（边界提示）

---

## 验证矩阵

| 发现 | 视角 1 路径可达性 | 视角 2 设计意图 | 视角 3 真实证据 | 终判 |
|------|:---:|:---:|:---:|:---:|
| H-1 bash-guard 误拦验证命令 | confirmed(H) | partial(W) | confirmed(C) | **H**（2:1 多数票，实测复现） |
| H-2 change-owners 遗漏 | confirmed（实测复现绕过 + 逐行对比 powershell-guard） | | | **H** |
| H-3 序列锁 reentrant | confirmed（逐行核对触发链，对照现有测试） | | | **H** |
| X-1 PostToolUse Agent 死代码 | 主 session Grep + Read hooks.json 核实 | | | **确认 W** |
| X-2 writer 锁 acquire 缺失 | 主 session Grep 全仓核实 | | | **确认 W** |
| X-3 PreToolUse fail-open | 主 session Read 文件尾核实 | | | **确认 I（产品决策）** |

> C/H 验证池 8 条全部得到证据级处理，0 误报。对抗式验证（验证员默认立场=误报）+ 端到端实测复现是本轮 0% 误报率的关键。

---

## 审计盲区（未覆盖/未验证范围）

1. **最大系统性盲区——缺运行验证**: 因 [H-1] bash-guard 误拦，PACE 会话内无法跑 `node tests/test-hooks-e2e.js` / `test-pace-utils.js`，10 维度结论几乎全为静态分析。**建议在干净/豁免环境跑全套测试作为绿灯证据。**
2. **未被任何维度审查的文件**:
   - `plugin/hooks/templates/knowledge-note.md`——与 pace-knowledge skill 的 L0-L2 frontmatter 契约一致性无人核对
   - `plugin/hooks/templates/spec.md`——`project-summary` frontmatter 与 session-start 注入逻辑的耦合无人核对
   - `tests/test-utils.js`、`tests/agent-tests/helpers/*.js`（subagent-runner / verify-output / fixture-setup / fixture-teardown / claude-output-to-report / run-tests）——agent-tests 框架代码本身的断言/隔离正确性未审，仅审了用例覆盖度
3. **审查不足维度**: pre-tool-use-core（1602 行单文件，仅 6 findings，owner/checkout/approval/impl-plan 多级门禁组合路径覆盖不足）、post-aux-hooks（明确无法运行 e2e）、lifecycle-hooks（未与 post-tool-use 的 Agent 分支做对照，靠覆盖度复核补上 X-1）

---

## 建议后续动作

- **CHG-A（hook 守卫一致性 + 死代码清理）**: 打包 H-1 / H-2 / X-1 / X-2，关联度高（都属 hook 守卫保护面 / 注册面 vs 实现面错配）
- **CHG-B（序列锁并发安全）**: 单独 H-3，需独立的 fork 双进程并发回归测试
- **P2 文档**: 可在 CHG-A 收尾时顺手同步
- **P3**: 派 `artifact-writer record-finding` 归档到 `changes/findings/`

---

## 证据来源

- 源码: `plugin/hooks/pre-tool-use/bash-guard.js`、`powershell-guard.js`、`plugin/hooks/pre-tool-use.js`、`plugin/hooks/pace-utils/locks.js`、`plugin/hooks/post-tool-use.js`、`subagent-stop.js`、`post-tool-use-failure.js`、`plugin/hooks/session-start.js`、`plugin/hooks/hooks.json`
- 测试: `tests/test-hooks-e2e.js`（含 9hgd/9hgd1/9hgd3 反绕过用例 + line 188 task.md 字面量）、`tests/test-pace-utils.js`（:285-352 writer 锁测试、:483-505 顺序序列号测试）
- 配置: `plugin/.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`、`plugin/hooks/pace-utils/constants.js`（版本三处一致）
- 实测: 验证 agent 在隔离 tmp cwd 调用真实 guard 模块构造判定 + 本会话内真实 PreToolUse hook 实时拦截观测（探针文件已清理）
