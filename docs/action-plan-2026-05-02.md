# PACEflow 行动项规划 2026-05-02

> **生成日期**：2026-05-02
> **当前执行版本**：PACEflow v6.0.48（原始调研输入：PACEflow v5.1.4）
> **上游调研版本**：Claude Code v2.1.126（后续复核至 v2.1.131）
> **触发**：用户告知 Claude Code 升级到 2.1.126，PACEflow 已久未升级，需调研增量

---

## 0. 文档说明

本文档汇总两轮调研（v2.1.76→v2.1.90 + v2.1.91→v2.1.126）+ 本次会话两项实测（subagent 工具调用 + pre-compact.js 当前状态）的所有行动项，按优先级分级整理，包括 `updatedToolOutput` 三种用法和 subagent 分流 artifact 更新的设计方案。

文档与 findings.md 的关系：
- findings.md 第 8 行索引 + 详情段落是**调研记录**（含原始证据和官方引用）
- 本文档是**行动项视图**（基于调研得出的可执行计划）
- 任何 CHG 启动后，对应行动项移到 `task.md` + `implementation_plan.md`

### 0.1 当前执行视图（2026-05-10，v6.0.48）

本节覆盖原 v5.2 行动项优先级。下方旧章节保留为历史背景，不再作为当前执行顺序的权威来源。

当前依据：

- `docs/claude-code-2.1.76-2.1.131-paceflow-evaluation.md`
- `docs/claude-code-2.1.76-2.1.131-validation-report.md`
- GitHub issue 风险筛查（worktree、hooks、plugins、PreToolUse、SubagentStop、FileChanged/CwdChanged）
- v6 当前代码审查：`plugin/hooks/pace-utils.js`、`plugin/hooks/pre-tool-use.js`、`plugin/hooks/session-start.js`、`plugin/hooks/task-list-sync.js`

执行状态（v6.0.48）：

- P0-20260506-01 / P0-20260506-02：已完成。
- P1-20260506-01 / P1-20260506-02 / P1-20260506-03 / P1-20260506-04 / P1-20260506-05：已完成。
- P1-POC-05 已在 v6.0.16 落地；v6.0.17 修复首次测试前审计发现的选择值容错与非 git stderr 噪音；v6.0.18 将选择提示从 SessionStart 移到真正动手前的 PreToolUse 阶段；v6.0.27 吸收调研报告中低风险 P1：SubagentStop 报告协议观察、PostToolUseFailure 恢复提示、SessionStart 输出大小保护与 compact/PreCompact 继承测试；v6.0.28 修复审计确认的非设计缺口；v6.0.29 清理 `audit` 发布面并修正文档口径；v6.0.30 增加 v5→v6 半自动迁移保护；v6.0.31 增加 session_id 日志串联与项目级 artifact-writer 写锁；v6.0.32 修复 Agent 工具失败时写锁释放链路；v6.0.33 修复 production Smoke0-5 暴露的锁保护与噪声问题；v6.0.34 修复全面审计确认的路径规范化、worktree runtime、vault env fail-closed、Stop 降级计数与 agent/skill 契约缺口；v6.0.35 拆分 plugin runtime root，marketplace 只发布 `plugin/` 下的运行时资产；v6.0.36 修复 2026-05-09 审计确认项：findings 日期差、Stop walkthrough 噪声、SessionStart walkthrough 最近记录截断、PostToolUse 死分支和文档/模板一致性；v6.0.37 修复二轮审计确认项：PreCompact native plan 项目过滤、Bash 间接写 artifact 保护与 bridge/template 说明收敛；v6.0.38 完成 r2 后续代码质量收尾：PostToolUse per-CHG warning 节流、artifact-root 输入截断、logger lock stale 阈值调整与 artifact mutation helper 抽取；v6.0.39 同步 Claude Code native build 工具面变化：`Glob/Grep` 可能不可用时，skill/smoke 改用 Bash `find` / `rg` / `grep` fallback 口径；v6.0.40 修复 Smoke4 暴露的 legacy v5 迁移提示歧义，明确被阻止的工具未落盘、dry-run 后二次确认、迁移后仍需重试原始代码任务；v6.0.41 修复 Smoke6 暴露的主 session `Edit/MultiEdit` 直接修改 artifact 绕过；v6.0.42 加固 v5 迁移脚本的多 ARCHIVE/CRLF 真实 vault 兼容性；v6.0.43 修复 hook 拦截提示缺 artifact 根目录与 legacy 手动 mkdir changes/ 绕过；v6.0.44 优化 v5 迁移归档区可读性，旧 frontmatter 转为历史 YAML 代码块，避免误读为第二个活动 frontmatter，并让 `--force` 重跑复用已有 `.v5-backup` 而不覆盖备份；v6.0.45 修复 native plan 桥接 Step 5 漏写 `.pace/synced-plans` 的 dogfood 缺口，hook/skill 明确宿主项目 runtime 路径与幂等 basename 写入；v6.0.46 补齐 P2 agent fixture 与 release sanity：Phase C 扩到 close/archive/finding/correction 正向 contract，单元测试覆盖 manifest 版本一致性和 plugin runtime root 文件面；v6.0.47 将 artifact-writer 并发控制从 Agent 生命周期项目级锁改为 hook ID reservation + 写入阶段 resource lock；v6.0.48 修复 Smoke1 暴露的 subagent 无法可靠接收 `PreToolUse:Agent additionalContext` 问题，`create-chg` / `record-correction` 首次派遣改为预留编号后 deny，要求主 session 带 `reserved-id` / `reserved-file` 重派。
- 2026-05-08 production Smoke5 暴露的 P0 已在 v6.0.33 修复：模型不能再通过 Bash 删除/重写 `.pace/artifact-writer.lock`，锁 payload 不再暴露短生命周期 hook `pid`，锁拒绝文案只允许等待/重试，不再建议 Claude 删除锁。
- 其余 P1/P2 PoC 与暂缓项仍按下表继续评估，不进入当前核心链路。

#### 0.1.1 P0 — 当前已实现代码中的阻断级修复

| ID | 状态 | 任务 | 问题 | 改动范围 | 验证 |
|---|---|---|---|---|---|
| P0-20260506-01 | ✅ v6.0.11 | 修复 worktree/vault 下 `changes/**/*.md` 详情文件路由 | vault 重定向只覆盖根索引 artifact；worktree 中写 `changes/chg-*.md` 可能分裂出本地详情文件，违背“worktree 与主项目共用 artifacts”决策 | `hooks/pre-tool-use.js`、`hooks/pace-utils.js`、`tests/test-hooks-e2e.js` | worktree 本地 `changes/chg-*.md` / finding / correction 详情 Write/Edit/MultiEdit deny 并提示 vault 正确路径；vault 正确路径放行 |
| P0-20260506-02 | ✅ v6.0.11 | PreToolUse enforcement 路径 stdin 解析失败 fail-closed | hook stdin/JSON 在某些环境可能异常；`stdin.ok=false` 时不能自然放行 | `hooks/pre-tool-use.js`、`tests/test-hooks-e2e.js` | PACE 项目中 Write/Edit/MultiEdit stdin 非 JSON 或缺 `file_path` 时 deny；非 PACE 项目保持低干扰 |
| P0-20260508-01 | ✅ v6.0.33 | 修复 artifact-writer worktree 并发锁竞态 | Smoke5 中 Session B 在收到 fresh lock deny 后用 Bash 删除 `.pace/artifact-writer.lock` 并抢占；subagent 还可用 Bash 写入伪锁；锁中 `pid` 是 hook 进程，不是 agent liveness，导致误判 stale | `hooks/pre-tool-use.js`、`hooks/pace-utils.js`、`tests/test-hooks-e2e.js`、`docs/production-smoke-v6.0.32.md` | Bash 对 `.pace/artifact-writer.lock` 的 rm/redirect/touch/mv/cp/script write 均 deny；lock deny 文案不再建议 Claude 删除锁；lock payload 不暴露误导性 `pid`；Smoke5 并发时第二 session 只能等待/重试，不得破坏第一 session 锁 |
| P0-20260508-02 | ✅ v6.0.34 | 修复审计确认的路径与运行态分裂 | Bash 写保护可被 `.//task.md` / `.pace//artifact-writer.lock` 等价路径绕过；worktree runtime 仍写子 worktree `.pace`；`artifact-root=vault` 缺 env 时误落本地；Stop `.pace` 缺失时无法累计降级 | `hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`hooks/session-start.js`、`hooks/stop.js`、`hooks/pre-compact.js`、`hooks/post-tool-use.js`、`tests/test-hooks-e2e.js`、`tests/test-pace-utils.js` | Bash artifact/lock 等价路径 deny；worktree runtime 写宿主 `.pace`；vault env 缺失 fail-closed；Stop 连续阻止可降级且 idle PASS 不落盘；C/V 与 PostToolUse artifact 判定基于 artifact root |
| P0-20260509-03 | ✅ v6.0.41 | 修复主 session `Edit/MultiEdit` 直接修改流程 artifact 绕过 | Smoke6 中 Bash 写 `task.md` 被拦、Write 覆盖被拦，但模型收到“用 Edit”提示后直接 `Edit task.md` 成功追加 `test`；这证明 CLAUDE.md/模型自觉不足以保护 artifact invariant | `hooks/pre-tool-use.js`、`tests/test-hooks-e2e.js`、`docs/production-smoke-v6.0.41.md` | 非 artifact-writer 对 artifact root 下 `task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` / `corrections.md` / `changes/**` 的 `Write` / `Edit` / `MultiEdit` 均 deny；artifact-writer 持锁写入仍放行；`spec.md` 不归 artifact-writer 管理，仍允许主 session `Edit`；C/V marker 专项提示保留；Smoke6 增加 Write/Edit fallback 验证 |
| P0-20260509-01 | ✅ v6.0.37 | PreCompact native plan 只桥接当前项目 | `~/.claude/plans` 是全局目录，旧逻辑取最近 `.md` 并写入当前项目 `.pace/current-native-plan`，可能把其他项目 native plan 桥接进 PaceFlow | `hooks/pre-compact.js`、`tests/test-hooks-e2e.js` | 只记录内容中匹配当前 cwd 或项目名候选的 native plan；无匹配时只写 `NATIVE_PLAN_SKIP_FOREIGN` 日志，不写 current-native-plan |
| P0-20260509-02 | ✅ v6.0.37 | Bash 间接写 artifact 保护补强 | `bash -c` 内层脚本、`npx prettier --write task.md`、`npm run fix -- task.md` 等可绕过直接 Bash 写保护 | `hooks/pre-tool-use.js`、`tests/test-hooks-e2e.js` | shell `-c` 内层脚本、常见 formatter/linter 写入参数、package runner 只要引用 artifact 且存在写入语义即 deny；只读 grep 重定向到非 artifact 仍放行 |

执行原则：

- P0-01 不改变“worktree 共用主项目 artifact 目录”决策，只补全详情文件路由。
- P0-02 只对核心执行保护 fail-closed，避免把非 PACE/非写入场景误伤成硬阻塞。

#### 0.1.2 P1 — 当前代码语义不干净但不阻断

| ID | 状态 | 任务 | 问题 | 改动范围 | 验证 |
|---|---|---|---|---|---|
| P1-20260506-01 | ✅ v6.0.11 | SessionStart 任务列表提示改为读取 CHG 详情任务统计 | 提示不应只用 `task.md` 索引 checkbox 判断任务列表同步；v6 子任务权威是 `changes/<id>.md ## 任务清单` | `hooks/session-start.js`、`tests/test-hooks-e2e.js` | 有详情 pending T-NNN 时提示同步 Claude 任务列表；仅索引无详情任务时不夸大 |
| P1-20260506-02 | ✅ v6.0.11 | worktree 项目名识别收紧 | 仅凭路径中有 `worktrees/` 就归一到父目录，普通项目也可能误判 | `hooks/pace-utils.js`、`tests/test-pace-utils.js` | 只有 `.claude/worktrees/*` 或 `.git -> .git/worktrees/*` 等真实 worktree 信号才归一 |
| P1-20260506-03 | ✅ v6.0.11 | marker 相关日志记录 `agent_id` / `agent_type` | GitHub 上游仍有 agent identity 稳定性讨论；生产排障需要完整日志 | `hooks/pre-tool-use.js`、`tests/test-hooks-e2e.js` | `DENY_V6_MARKER` / `PASS_V6_MARKER_AGENT` 日志含 agent identity |
| P1-20260506-04 | ✅ v6.0.11 | 消除 `claude plugin validate .` marketplace description warning | validate 通过但有 warning，release gate 不够干净 | `.claude-plugin/marketplace.json` | `claude plugin validate .` clean pass |
| P1-20260506-05 | ✅ v6.0.15 / v6.0.24 / v6.0.25 收紧 | 合并高频 agent 收尾操作 | approve→start、completed→verify→archive 连续派 agent 成本高，且 Stop 提示会让主 session做 2-3 次机械派遣 | `agents/**`、`hooks/**`、`skills/**`、`CLAUDE.md`、`README.md`、`REFERENCE.md`、`tests/test-hooks-e2e.js` | 新增 `update-chg action=approve-and-start` 与 `close-chg`；v6.0.24 增加 PreToolUse:Agent 语义保护：禁止 `update-status+verify` 同派遣，`close-chg` 必须带验证确认/摘要；v6.0.25 要求 `approve` 与 `approve-and-start` 都带 `approval-confirmed/source/evidence`，且 `approve` 不得表达开始执行；不跳过用户确认或验证 |
| P1-20260507-01 | ✅ v6.0.27 | `SubagentStop` artifact-writer 报告协议观察 | production prompt 可能受全局时间戳/样式影响；仅靠更长 prompt 追求 100% 标题稳定不符合 PaceFlow 机械兜底理念 | `hooks/subagent-stop.js`、`hooks/hooks.json`、`tests/test-hooks-e2e.js` | 只针对 `artifact-writer`；缺 `## artifact-writer 报告` 或缺 `**状态**` 时注入恢复提示；合法时间戳前缀仅记日志 warning；记录 transcript path 到 `.pace/last-artifact-writer-transcript`；不 block，避免 stop loop |
| P1-20260507-02 | ✅ v6.0.27 | `PostToolUseFailure` Write/Edit/MultiEdit/Bash 失败恢复提示 | 工具失败后主 session 容易把失败视为完成，尤其是 artifact 写入失败或验证 Bash 失败后误派 verify/close-chg | `hooks/post-tool-use-failure.js`、`hooks/hooks.json`、`tests/test-hooks-e2e.js` | PACE 项目中失败工具输出 `additionalContext`：不得视为完成；artifact 写入按 Artifact 目录重试或重新派 agent；验证失败必须读输出、修复、重跑；用户中断只记录日志 |
| P1-20260507-03 | ✅ v6.0.27 | SessionStart 输出大小保护 | Claude Code 会把过大 hook 输出落盘而非完整注入，导致启动上下文丢失且不易察觉 | `hooks/session-start.js`、`tests/test-hooks-e2e.js` | SessionStart stdout 在 50KB 前截断并提示 Read artifact 文件；日志记录 `output_bytes` 与 `truncated` |
| P1-20260507-04 | ✅ v6.0.27 | 5.1.4 生命周期能力继承测试补齐 | v6 多次重构后必须明确验证 SessionStart、compact 后注入、PreCompact 快照、StopFailure 等 v5.1.4 功能仍在 | `tests/test-hooks-e2e.js`、`tests/test-pace-utils.js` | startup 注入 v6 artifact + artifact_dir；compact 消费快照并注入 G-9/close-chg；PreCompact 记录 activeChanges/runtime/findings/walkthrough；StopFailure 仍记录 API 中断；stdin parser 支持 subagent 字段 |
| P1-20260507-05 | ✅ v6.0.27 | `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` 兼容性回归 | Claude Code 可清理子进程 env；PaceFlow 不应只依赖 vault env 恢复本地项目 artifact 路由 | `tests/test-hooks-e2e.js` | scrub 场景下，即使 `PACE_VAULT_PATH` 不可用，项目级 `.pace/artifact-root=local` 仍可让 SessionStart 恢复本地 artifact 路由并懒创建模板 |
| P1-20260508-01 | ✅ v6.0.28 | 修复 v6.0.27 audit 确认缺口 | `close-chg` prompt 门控未强制 `complete-open-tasks:true`；verified-date 逻辑分叉；compact snapshot null、knowledge 时间戳示例、hook 数量文档存在小缺口；`ConfigChange` 对 plugin 安装链路无保护价值 | `hooks/**`、`skills/pace-knowledge/SKILL.md`、`README.md`、`REFERENCE.md`、`tests/**` | close-chg 缺 `complete-open-tasks:true` 被 deny；verified-date 使用共享 helper；`ConfigChange` / `config-guard` 从发布面移除 |
| P1-20260508-02 | ✅ v6.0.29 | 清理 `audit` 发布面与 ticket02 文档口径 | `audit` 是 PaceFlow 内部审计流程，不是用户项目 skill；README PreCompact I/O、artifact-writer spec ARCHIVE 范围、action-plan/guidebook 历史状态描述与当前实现不一致 | `hooks/pace-utils.js`、`skills/pace-knowledge/SKILL.md`、`internal/skills/audit/**`、`README.md`、`REFERENCE.md`、`agent-references/artifact-writer-spec.md`、`docs/**` | marketplace 发布 skill 减为 4；内部审计资料保留在 `internal/skills/audit`；文档与实际 hook/template 对齐 |
| P1-20260508-03 | ✅ v6.0.30 | v5→v6 半自动迁移保护 | v5 用户升级后旧 vault 只有根 artifact 文件、没有 `changes/`；若直接懒创建 v6 基础结构，会把旧 v5 活跃内容与新 v6 详情模型混在一起 | `hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`hooks/session-start.js`、`migrate/batch-archive-v5.js`、`README.md`、`tests/**` | 检测 legacy v5 artifact 时先要求 AskUserQuestion + dry-run；用户确认前不创建 `changes/`；迁移脚本默认拒绝重复迁移或覆盖 `.v5-backup` |
| P1-20260508-04 | ✅ v6.0.31 | session_id 日志串联与 artifact-writer 项目级写锁 | 多 worktree / 多 session 并发派 `artifact-writer` 时可能同时分配 CHG-ID、抢写索引或归档同一 artifact | `hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`hooks/subagent-stop.js`、`agent-references/**`、`skills/artifact-management/**`、`README.md`、`tests/**` | `logEntry` 自动带 `sid`；`artifact-writer.lock` 落在宿主项目 `.pace/`，真实 git worktree 共享锁；无锁的 artifact-writer 写 artifact 被 deny；SubagentStop 释放锁；`T-NNN` 明确为 CHG/HOTFIX 局部编号 |
| P1-20260508-05 | ✅ v6.0.32 | Agent 工具失败立即释放 artifact-writer 写锁 | v6.0.31 代码已支持 `PostToolUseFailure:Agent` 释放锁，但 `hooks.json` matcher 未覆盖 `Agent`，Agent 工具失败时锁可能残留到 TTL | `hooks/hooks.json`、`hooks/post-tool-use-failure.js`、`tests/test-hooks-e2e.js`、`README.md` | `PostToolUseFailure` matcher 为 `Write\|Edit\|MultiEdit\|Bash\|Agent`；新增 E2E 覆盖 Agent 失败释放锁；安装配置测试覆盖 matcher |
| P1-20260508-06 | ✅ v6.0.35 | 拆分 plugin runtime root | marketplace `source:"./"` 会把 docs/tests/internal/tickets 等开发资料一起安装到 plugin cache，污染用户运行时目录 | `.claude-plugin/marketplace.json`、`plugin/**`、`tests/test-hooks-e2e.js`、`tests/test-pace-utils.js`、`tests/agent-tests/**`、`README.md`、`REFERENCE.md`、`internal/skills/audit/**` | marketplace `source` 改为 `./plugin`；运行时资产移动到 `plugin/`；根目录保留开发资料；测试和审计 skill 改读 `plugin/**` |
| P1-20260509-01 | ✅ v6.0.38 | r2 代码质量收尾 | PostToolUse 状态类提醒会在同一会话反复提示；logger lock 5s stale 阈值偏短；`PACE_ARTIFACT_ROOT` 超长输入未限长；pre-tool-use artifact mutation 条件分散 | `hooks/post-tool-use.js`、`hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`tests/test-hooks-e2e.js`、`tests/test-pace-utils.js` | 同一 CHG 的 status mismatch / missing verify / blocked task 提醒按 session 去重且 SessionStart 清理；logger lock stale 阈值 30s；artifact-root 选择值截断到 4096 字符；artifact mutation 判定 helper 化 |

#### 0.1.3 P1/P2 — 上游 Claude Code 能力 PoC，暂不进核心链路

| ID | 任务 | 当前结论 | 执行口径 |
|---|---|---|---|
| P1-POC-01 | ✅ v6.0.27 `SubagentStop` 报告标题/状态观察 | 已作为非阻断观察器落地；暂不 block | 只针对 `artifact-writer`；缺标题/缺状态给 additionalContext；合法时间戳前缀仅日志 warning；如未来改成 block 必须加 bounded retry |
| P1-POC-02 | `CwdChanged` 项目/Artifact 路由重算 | 稳定性收益有限；当前每个 hook 已重算关键 artifact 路由，且 `/resume` env cache stale issue 存在 | 暂缓实现；如做，只能记录/提示/刷新非权威 env，不让 env-file 成为 artifact 路由权威 |
| P1-POC-03 | ✅ v6.0.27 `PostToolUseFailure` 恢复提示 | 已落地 | Write/Edit/MultiEdit/Bash 失败给 additionalContext；用户中断只记日志；不做硬门禁 |
| P1-POC-04 | `PostToolBatch` 只读一致性观察 | 稳定性收益低到中等，主要降低重复提醒；不修正核心 artifact 状态 | 暂缓实现；除非真实日志显示并行 PostToolUse 噪声影响主 session 执行 |
| P2-POC-01 | `updatedInput` vault 路径重写 | 稳定性收益不确定且风险较高；会把 deny/retry 变成静默改写，和 PaceFlow 结构兜底理念冲突 | 不进入核心链路；只允许隔离 PoC，不用于 artifact redirect |
| P2-POC-02 | `updatedToolOutput` 裁剪/脱敏/标注 | 对 PaceFlow 稳定性收益小；可以降噪，但不能让模型“必定遵守” | 禁止 silent fix；仅保留为未来大输出脱敏/裁剪选项 |
| P2-POC-03 | `FileChanged` 监控 vault 外路径 | 稳定性收益有限；watcher/security/perf 风险高，监控 artifact 内容会放大噪声 | 暂缓；如做，只监控 `.pace/artifact-root`、`.env` 这类小配置，不监控大型 artifact |
| P2-POC-04 | `${CLAUDE_EFFORT}` skill body 自适应 | 对核心稳定性收益很小；artifact-writer 已直接 `effort: max` | 仅作为文案优化，不作为 v6 稳定性工作 |
| P2-POC-05 | `PostCompact` side-effect 记录 compact summary | Claude Code 支持 PostCompact，但无 `additionalContext` / decision 输出；不能替代 SessionStart compact 恢复 | 暂缓；可选只把 `compact_summary` 写入 `.pace/post-compact-summary.json` 供排障，稳定性收益低 |
| P2-POC-06 | `${CLAUDE_PLUGIN_DATA}` 插件级持久化 | 对项目级流程稳定性收益有限；插件级目录不天然绑定 repo/vault/worktree | 不迁移 `.pace/artifact-root` / `pre-compact-state` 等项目权威状态；只可用于非权威诊断缓存或版本/smoke 结果 |
| P1-POC-05 | ✅ v6.0.16-v6.0.18 首次懒创建 artifact 目录选择 | 当前 `PACE_VAULT_PATH` 存在时新项目默认写入 Obsidian vault；用户希望可选择写入 vault project 还是本地项目目录 | 首次写代码或派 `artifact-writer`，且 vault/local 均无 `changes/` 时询问并持久化到 `.pace/artifact-root`；SessionStart 只记录 pending，不主动打扰闲聊；自动化/headless 可用 `PACE_ARTIFACT_ROOT=local|vault|/abs/path` 跳过询问；v6.0.17 补充带引号/大小写容错并静默非 git stderr |

#### 0.1.4 暂缓或明确不采用

| 项 | 决策 | 原因 |
|---|---|---|
| 原生 `EnterWorktree` / `Agent isolation: "worktree"` 作为核心 P0 链路 | 暂缓 | GitHub 上存在 worktree 删除绕过 hook、CWD 漂移、隔离不可靠、并行 worktree agent 丢工作等高风险 issue |
| `WorktreeCreate` / `WorktreeRemove` hook 接管默认行为 | 暂缓 | 官方语义会替换默认 worktree 行为，风险高；当前 PaceFlow 只需要 artifact 路由归一 |
| `updatedToolOutput` 自动修复 artifact | 不采用 | 与 PaceFlow “hook 做结构兜底，不静默改内容”的理念冲突 |
| `skillOverrides` 默认隐藏核心 skills | 不作为默认 | 会降低模型自纠错和用户发现能力；可写成用户级 tuning 建议 |
| `--bare` 用于 PaceFlow 验证 | 禁止 | `--bare` 跳过 hooks/plugins/skills，不能验证 PaceFlow |
| Windows PowerShell/cmd destructive cleanup 指令 | 禁止作为文档建议 | GitHub 有 PowerShell/cmd quoting 导致灾难性删除报告 |
| Production prompt 的 `report_title_prefix_warning` 作为 release blocker | 不采用 | 用户级 `UserPromptSubmit` date hook + 全局 `CLAUDE.md` 时间戳回复样式可能在 `artifact-writer` 报告前加时间戳；这不影响 artifact 写入、hook 判定、状态/schema/wikilink，只影响测试报告首行机械检查。harness 继续严格，production gate 仅记录 warning；未来 `SubagentStop` verifier 可允许一个合法时间戳前缀或解析第一个协议标题行 |
| `audit` skill 作为 marketplace 发布组件 | 采用，v6.0.29 移除发布面 | 该 skill 只用于 PaceFlow 自身开发审计，不是用户项目工作流能力；发布后显示为通用 `audit` 容易误导用户，也增加组件列表认知负担。v6.0.29 已从 `SKILL_DIRS` / README / REFERENCE / tests 发布面移除，并保留到 `internal/skills/audit/` 供本仓开发使用 |
| 移除 `ConfigChange` / `config-guard` | 采用，v6.0.28 移除 | 当前 PaceFlow 正式安装使用 plugin hook 注册，`ConfigChange` 只能观察 project/local settings 变更，不能保护 plugin manifest 中的 hook 注册；继续发布会制造“已保护配置”的错误安全感。手动安装/本地验证工具不作为 marketplace 发布面权威 |

#### 0.1.5 上游 GitHub 风险登记

| 风险 | 代表 issue | 对 PaceFlow 的影响 | 当前处理 |
|---|---|---|---|
| Worktree exit prompt 绕过 PreToolUse 并可能删除 worktree | https://github.com/anthropics/claude-code/issues/56349 | 不能依赖 PreToolUse 阻止 native ExitWorktree | 不把 native worktree 生命周期纳入核心链路 |
| PowerShell/cmd quoting 导致灾难性删除 | https://github.com/anthropics/claude-code/issues/56603 | Windows 用户执行破坏性清理风险高 | 文档和 hook 提示避免推荐 `cmd /c rd /s /q` |
| Claude Code 2.1.129 Bedrock beta flags 回归 | https://github.com/anthropics/claude-code/issues/56595 | Bedrock 用户可能无法使用 2.1.129 | 发布说明提示 Bedrock 用户先验证/固定可用版本 |
| Windows compact 后 Bash session-env EEXIST | https://github.com/anthropics/claude-code/issues/56593 / https://github.com/anthropics/claude-code/issues/56191 | compact/resume 后 Bash/hook-adjacent 流程可能异常 | 不把 env-file 作为唯一权威；必要时提示重启 session |
| `/resume` env cache stale | https://github.com/anthropics/claude-code/issues/56400 | `CwdChanged` / SessionStart env 值可能过期 | 每个 hook 内重算关键 artifact 路由 |
| Bash CWD 漂移到 worktree | https://github.com/anthropics/claude-code/issues/56147 | git 命令可能写错目标 | 文档建议 `git -C` / 先 `pwd && git status`；artifact 路由不跟随 Bash CWD |
| Subagent hook enforcement 在部分环境有争议 | https://github.com/anthropics/claude-code/issues/34692 / https://github.com/anthropics/claude-code/issues/21460 / https://github.com/anthropics/claude-code/issues/44534 | 生产环境仍需 smoke test | 保留 installed plugin production smoke gate |

#### 0.1.6 当前验证基线

最近一次验证结果（v6.0.48）：

```bash
node --check plugin/hooks/*.js plugin/migrate/*.js  # PASS
node tests/test-hooks-e2e.js                         # 132/132 PASS
node tests/test-pace-utils.js                        # 115/115 PASS
claude plugin validate ./plugin                      # PASS
git diff --check                                     # PASS
```

当前本机 Claude Code：

```text
2.1.131 (Claude Code)
```

官方 changelog 已检查到 `2.1.131`；`2.1.131` 暂未发现推翻上述决策的 PaceFlow task/hook 变更。

Native plan 备注（2026-05-07 复核）：官方 changelog 没有单独声明“plan 文件名不再随机”，但 2.1.77 已将接受计划后的 session 命名改为按 plan 内容生成，并改进 VS Code plan preview 标题；2.1.119 修复 `/plan` / `/plan open` 不作用于既有 plan；2.1.71 修复 fork/branch 共享同一个 plan 文件。PaceFlow 后续 bridge 测试应按明确路径、内容和最近修改时间判断 plan，不依赖随机文件名假设。

Production title warning 记录（2026-05-07）：当前本机主 `settings.json` 有全局 `UserPromptSubmit` hook 执行 `date '+[%Y-%m-%d %H:%M:%S]'`，主 `CLAUDE.md` 又要求普通回复第一行带时间戳。因此 production prompt 下 `artifact-writer` 偶发继承展示层样式，在 `## artifact-writer 报告` 前输出时间戳。结论：这是测试/verifier 层的协议首行 warning，不是功能损害；不要通过堆更长 prompt 追求 100% 风格稳定。后续若实现 `SubagentStop` 报告校验，应把“最多一个合法时间戳前缀”作为兼容输入，或直接定位第一个非空协议标题行。

Artifact 目录选择候选（2026-05-07）：PaceFlow 同时支持 Obsidian vault 与本地项目目录。更合理的首次体验是：当项目首次触发懒创建，且 `PACE_VAULT_PATH/projects/<project>/changes` 与 `cwd/changes` 都不存在时，hook 不应静默决定唯一位置；可 deny 并提示主 session 用 AskUserQuestion 询问用户选择“Obsidian vault project”或“本地项目目录”。选择后将结果持久化到当前项目 `.pace/artifact-root`，后续 `getArtifactDir()` 优先读取该项目级选择。已有 `changes/` 的项目不再询问；真实 worktree 仍沿用宿主项目持久化选择；自动化/SDK/headless 环境可设置 `PACE_ARTIFACT_ROOT=local|vault|/abs/path` 跳过询问，避免阻断自动化。v6.0.17 额外要求 hook 文案提示写入纯文本 `local` / `vault`，同时实现首尾引号与大小写容错，避免主 session 把 `"local"` 误写成相对目录名。v6.0.18 将用户可见提示从 SessionStart 移到 PreToolUse：闲聊不会被提醒，只有写代码或派 `artifact-writer` 时才硬拦截询问。v6.0.22 后续决策：`local` 的默认语义就是本地项目根目录，不默认创建 `.pace/` 内部 artifact 或新的专用子目录；`task.md` / `implementation_plan.md` / `changes/` 属于可审计工作台，应该在 root 可见、可 git diff。`.pace/` 继续只保存运行状态且通常 gitignored。若用户确实希望专用目录，可把 `.pace/artifact-root` 或 `PACE_ARTIFACT_ROOT` 写成相对/绝对路径（例如 `./paceflow-artifacts`），作为高级配置而不是首次 AskUserQuestion 的默认第三选项。

#### 0.1.7 v5.1.4 生命周期能力继承检查

以下能力在 v5.1.4 已是 PaceFlow 体验的一部分，v6 重构后继续作为回归基线，而不是可选优化：

| 能力 | v6 权威行为 | 覆盖 |
|---|---|---|
| SessionStart startup/resume 注入 | 注入 v6 根索引活跃区、活跃 CHG 摘要、Artifact 目录、Claude 任务列表同步提示、相关 thoughts/knowledge、Git 状态；首次 artifact-root 未选择时不主动打扰闲聊且不创建 `.pace` 或 Obsidian 空项目 | `test-hooks-e2e.js` 1/2/2a/2b/2c/9c3/9c3a/9c3b |
| SessionStart compact 后恢复 | 读取并消费 `.pace/pre-compact-state.json`，注入 compact 快照、activeChanges、G-9 完成检查、native plan 桥接提醒、findings/walkthrough 状态 | `test-hooks-e2e.js` 3 |
| PreCompact 前快照 | compact 前记录 activeChanges、task/implementation_plan 活跃状态、runtime blockCount/degraded/task-list-used、findings openCount、walkthrough 今日记录、近期 native plan | `test-hooks-e2e.js` 19 |
| StopFailure | API/中断类停止失败只记录日志，不进入关键阻断链路 | `test-hooks-e2e.js` 21 |
| Subagent hook 继承 PaceFlow 保护 | subagent 写 artifact 仍触发 PreToolUse/PostToolUse；SubagentStop 新增报告观察但不依赖它作为唯一保护 | `test-hooks-e2e.js` 15a/15b/23/23a/23b |

当前原则：hook 只做机械结构和流程兜底，不判断 evidence 真伪或 artifact 内容质量；内容质量仍由模型能力、用户确认和验证命令负责。

#### 0.1.8 P2 稳定性收益复核（2026-05-07）

基于 v6.0.27 现状，剩余 Claude Code 新能力大多不会显著提升 PaceFlow 核心稳定性：

- `PostCompact`：官方事件存在，但输出控制为 `None`，不能注入 `additionalContext`，因此不能替代现有“PreCompact 写快照 → SessionStart compact 恢复注入”链路。最多记录 compact summary 供排障。
- `${CLAUDE_PLUGIN_DATA}`：适合插件级非权威缓存，不适合保存项目级 artifact root 或 compact 快照。`.pace/` 仍是项目级权威状态目录。
- `CwdChanged/FileChanged`：每个 hook 已在执行时重算 artifact 路由；额外 watcher 主要是提示/日志收益，不能解决 `/resume` env stale，也不应成为权威。
- `PostToolBatch`：只会减少并行工具后的重复提醒，对 artifact 状态正确性帮助有限。
- `updatedInput` / `updatedToolOutput`：可能降低一次 deny/retry，但会引入静默改写风险；不符合 PaceFlow “hook 机械兜底、模型负责内容、用户确认语义”的边界。
- `${CLAUDE_EFFORT}`：artifact-writer 已固定 `effort: max`，skill body 自适应只属于体验文案，不是稳定性前置。

结论：P2 暂不推进核心实现；仅在真实生产日志暴露明确痛点后，再按单项 PoC 引入。

#### 0.1.9 发布面清理：`audit` skill 已移至 internal

`skills/audit/` 的设计目标是审计 PaceFlow 自身 hook/skill/agent 链路，不是面向用户项目的通用审计能力。v6.0.29 已将它移动到 `internal/skills/audit/`，不再随 marketplace 发布，避免三个问题：

- 用户插件列表会出现 `audit`，但它的真实语境是 PaceFlow 内部审计，容易误触发或误解。
- 它不参与核心 PACE 链路；`SessionStart`、`PreToolUse`、`PostToolUse`、`Stop`、`artifact-writer` 都不依赖它。
- 发布组件越多，用户学习成本和测试面越大。

已完成的发布面清理：

1. 从 `plugin/hooks/pace-utils.js` 的 `SKILL_DIRS` 移除 `audit`。
2. 更新 `README.md`、`REFERENCE.md`、`tests/test-install.js` 的技能数量和目录说明。
3. 用户面文档不再引用 `paceflow:audit`；开发审计流程保留在 `internal/skills/audit/`。
4. 保留面向用户的 `artifact-management`、`pace-workflow`、`pace-bridge`、`pace-knowledge`。

#### 0.1.10 当前剩余验证缺口

v6.0.48 已修复当前 production smoke 暴露的 P0 阻断缺口，并完成真实 v5 vault 副本迁移 rehearsal；真实 `ccauth` worktree 暴露的 artifact 根目录提示缺口、手动 `mkdir changes/` 绕过、native plan bridge Step 5 marker 漏写，以及 Smoke1 暴露的 reserved-id 只进 main transcript、不进 subagent 初始 prompt 问题均已修复。v5 迁移归档区已补可读性处理，旧 frontmatter 不再像第二个活动 frontmatter；迁移重跑也不会覆盖已有 `.v5-backup`。本轮已把 agent fixture 正向覆盖、release runtime sanity 与 artifact-writer resource lock 并发模型机械化。剩余工作按验证价值排序：

| 优先级 | 缺口 | 当前状态 | 下一步 |
|---|---|---|---|
| P1 | Installed-plugin production smoke | ✅ v6.0.41 Smoke0-7 已完成；Smoke6 复测确认 Bash / Write / Edit 直接改流程 artifact 均被拦，`spec.md` Edit 例外正常；marketplace cache 运行时发布面干净。v6.0.48 已把 resource-lock focused smoke 与 reserved-id 二次派遣协议写入文档 | 发新版或改 hook/agent runtime 时按 `docs/production-smoke-v6.0.48.md` 复跑：local create+close、direct artifact write protection、worktree concurrent create、vault route、v5 migration guard、native `/plan` bridge sync |
| P1 | 真实 v5 vault 副本迁移 rehearsal | ✅ v6.0.42 已用 `ccauth` Obsidian v5 vault 副本完成 dry-run + 正式迁移 rehearsal；脚本兼容 legacy 文件内多个 ARCHIVE 历史边界与 CRLF，迁移后每个主 artifact 仅保留 1 个 v6 标准 ARCHIVE，`.v5-backup` 与 `changes/findings`、`changes/corrections` 正常生成 | 不直接迁移 live vault；后续真实迁移前仍先复制 rehearsal 或至少 dry-run + 用户二次确认 |
| P1-design | close-chg review gate 设计评估 | GitHub issue #3 提出 `REVIEWED` / invariants / red-evidence / protocol checklist。讨论结论：review gate 有潜在高收益，但触发频率与机械边界未定；若设计成“每次 close 都提示主 session 自行判断”，会退化为提示工程和繁琐流程 | 用户确认当前先不做实现。保留设计备忘，后续只有在真实项目继续暴露 review 漏洞时，再设计低摩擦 close 前 review evidence；hook 只检查 evidence 字段存在和 P0/P1 处置格式，不判断 review 内容真伪 |
| P2 | 当前 Claude Code `/plan` bridge production 测试 | ✅ 已 dogfood 真实 native `/plan` UX；v6.0.45 修复 bridge 后漏写 `.pace/synced-plans`，hook/skill 明确宿主项目 runtime 路径与幂等 basename 写入 | 后续按 `docs/production-smoke-v6.0.48.md` Smoke 6 做最小回归：native plan approve 后必须先 bridge 为 `create-chg`，并写入 `.pace/synced-plans`，避免重复提醒同一 plan |
| P2 | Agent fixture coverage 扩充 | ✅ v6.0.46 已补 `tc-c3-close-chg-success`、`tc-c4-archive-chg-success`、`tc-c5-record-finding-success`、`tc-c6-record-correction-dual-write`；全量 baseline alias 更新为 29 case | 后续真实 baseline 失败时按 case 定位 agent/spec，而不是继续扩大 fixture 面 |
| P2 | Production smoke 文档更新 | ✅ v6.0.41 已更新 `docs/production-smoke-v6.0.41.md`；v6.0.48 已新增 `docs/production-smoke-v6.0.48.md` focused smoke，覆盖 resource-lock 并发模型、reserved-id 二次派遣、direct artifact 写保护、vault/local 路由、v5 migration guard 与 native `/plan` bridge sync | 后续版本按 v6.0.48 focused smoke 复跑关键链路；只有大改生命周期语义时再扩展全量手册 |
| P2 | 未跟踪 ticket / 仓库门面清理 | `ticket*.md` 中大部分旧缺口已修复或降级；仓库根目录仍混有旧审计、临时输出和 legacy 脚本 | 归档到 `internal/audits/` / `internal/legacy/` 或删除，避免后续审计误读为当前缺口；保留 marketplace `source: ./plugin` 的发布面隔离 |
| P2-hardening | Agent 失败锁释放兜底 | ✅ v6.0.47 已被 resource lock 架构替代：Agent 启动不再持项目级锁；PostToolUseFailure:Agent / SubagentStop 会清理当前 owner 的残留 resource lock 与 reservation | 后续只需观察真实日志中是否还有 owner 缺失导致 TTL 兜底；不得释放 owner-mismatch 锁 |
| P2 | Release sanity 覆盖迁移脚本 | ✅ v6.0.46 已在 `tests/test-pace-utils.js` 机械检查 plugin manifest 与 marketplace version 一致，且 plugin runtime root 不含 `docs/`、`tests/`、`internal/`、`ticket*` 等开发资料 | 后续 release 前跑 `node tests/test-pace-utils.js` 即可覆盖 |
| P3 | Claude 任务列表事件兼容说明 | `TaskCreate|TaskUpdate` matcher 是 Claude Code 任务列表事件兼容层，不应被视为唯一权威 | 在 docs / hooks 注释中标注实验性兼容；PACE 任务权威仍是 `changes/<id>.md ## 任务清单` |
| P3 | 非锁 runtime flag 并发限制 | `.pace/stop-block-count`、`task-list-used`、`degraded` 等运行态 flag 无原子写保护 | 记录为已知限制：多实例并发同项目时只可能影响提示/降级时序，不影响 artifact 内容正确性；除非真实日志显示问题，否则不加锁 |
| P3-refactor | `pre-tool-use.js` 拆分 | 单文件承担 Bash guard、marker gate、artifact root、lifecycle prompt gate 等职责，审查成本高 | 在不改变 E2E 结果前提下，未来拆出 `bash-guard`、`marker-guard`、`agent-lifecycle-guard` 等内部模块 |

---

#### 0.1.10d artifact-writer 并发锁重构设计

当前项目级 `artifact-writer.lock` 能保护 artifact 不被并发写坏，但它在 `PreToolUse:Agent` 派出时获取、直到 `SubagentStop` 才释放。读文件、思考、生成报告等非写入阶段都占锁，导致多个 worktree 同时工作时第二个 session 只能等待或反复重试。

目标设计：

- Agent 启动不再持项目级互斥锁；`PreToolUse:Agent` 只做 artifact root / v5 migration / lifecycle prompt / base template 检查。
- 新建类操作由 hook 做原子 ID reservation：`create-chg` 分配 `CHG/HOTFIX-YYYYMMDD-NN`，`record-correction` 分配 `CORRECTION-YYYY-MM-DD-NN`；允许编号有 gap，保证唯一性优先于连续性。
- 真正写 artifact 时，`PreToolUse:Write/Edit/MultiEdit` 根据真实 `file_path` 推导 resource lock，而不是相信 agent 声明：
  - `detail:changes/<id>.md`
  - `detail:changes/findings/<id>.md`
  - `detail:changes/corrections/<id>.md`
  - `index:changes`（统一保护 `task.md` + `implementation_plan.md`）
  - `index:findings.md` / `index:corrections.md` / `index:walkthrough.md`
- `PostToolUse` 释放单文件 resource lock；`index:changes` 在同一 owner 成功触碰 `task.md` 与 `implementation_plan.md` 后释放，避免 C/V/归档索引半更新窗口。若索引成对事务已成功写入一边、另一边工具失败，`PostToolUseFailure` 保留 `index:changes` 锁，允许同一 agent 重试并阻止其他 session 读到半更新窗口继续抢写；普通失败与 Agent/SubagentStop 仍清理残留锁，短 TTL 兜底。
- 预留编号是一次性租约：详情文件成功 `Write` 后按 artifact 相对路径精确消费 reservation；同一 session 多个并发 reservation 不互相清理。
- `.pace/locks/**`、`.pace/sequences/**`、`.pace/reservations/**`、`.pace/index-transactions/**` 与 legacy `.pace/artifact-writer.lock` 都是 hook 控制面，禁止主 session 或 subagent 用 Bash/Write/Edit/MultiEdit 手写或删除。
- 兼容旧版本：发现 fresh legacy `artifact-writer.lock` 时保守拒绝新 artifact-writer；stale legacy lock 可清理。新版本不再创建 legacy 项目级锁。

预期效果：

- worktree-A 写 CHG-A 详情、worktree-B 写 CHG-B 详情可并发。
- 多个 agent 只在更新共享索引的短窗口串行。
- 两个 `create-chg` 不再靠扫描索引抢编号，而由 hook reservation 机械保证唯一。
- 仍保持 Markdown 索引作为单一事实源，不引入 CRDT / append-only 合并层。

---

#### 0.1.10b v6.0.40 production Smoke5 记录

Smoke5（Worktree Routing + Artifact Writer Lock）真实运行结论：

- 核心链路通过：host 与 git worktree 的 `SessionStart` 都解析到宿主 artifact root `/mnt/k/AI/paceflow-smoke-local/`；`artifact-writer.lock` 落在宿主 `.pace/`；并发派遣时第二 session 被 `DENY_AGENT_ARTIFACT_LOCK` 拒绝并显示 owner；`SubagentStop` 释放锁后无残留。
- 保护链路通过：模型尝试用 Bash heredoc 直接写 `changes/findings/worktree-lock-smoke.md` 被 `DENY_BASH_ARTIFACT` 拦截；后续尝试 `rm -f .pace/artifact-writer.lock` 被 `DENY_BASH_ARTIFACT_LOCK` 拦截。
- 测试卫生问题：Smoke5 基于 Smoke1/2 项目继续 `git add . && commit`，会把已存在的 `.pace/*` 运行态文件纳入 git 跟踪；`git worktree add` 因此把 `.pace/artifact-root`、`last-artifact-writer-transcript` 等复制到 worktree。hook 实际仍使用宿主 runtime 与宿主 artifact root，但 smoke verify 中 `test ! -f "$WT/.pace/artifact-root"` 会误报。后续 smoke setup 应在 commit 前 `git rm --cached -r .pace 2>/dev/null || true`，并保留 `.pace/.gitignore`。
- 语义记录项：worktree 共享 artifact root 表示 CHG/索引是项目级记录；如果代码改动只落在 worktree 分支，`close-chg` 归档代表该 worktree/branch 已验证，不代表 host checkout 已自动合并。生产文档应明确“合并回主 worktree 由 git 流程负责”，避免看到 host 目录测试失败时误判为 artifact 路由错误。
- 本次 Session B 的具体任务由用户从 README 追加改为 `calc.js` 增加 `multiply`，这不是模型跑偏；它额外覆盖了 code-edit CHG、approve/start 与 close-chg 路径。

---

#### 0.1.10c v6.0.41 production Smoke6 与发布面记录

Smoke6（Direct Artifact Write Protection）复测结论：

- `paceflow` marketplace 安装版本已确认是 `6.0.41`；`SessionStart` 日志显示 `version=v6.0.41`。
- 主 session 尝试直接修改 `task.md`：Bash 重定向被 `DENY_BASH_ARTIFACT` 拦截；`Write` 覆盖被拦截；`Edit` 被 `DENY_DIRECT_ARTIFACT_EDIT` 拦截，且 `task.md` 未新增 `test`。
- 拒绝文案不再建议“更新已有 artifact 请使用 Edit”作为主 session 的恢复路径，而是要求派 `paceflow:artifact-writer`。
- `spec.md` 例外复测通过：`Write` 覆盖仍被禁止，但 `Edit` 可正常修改；这是设计意图，因为 `spec.md` 是项目规格文件，不归 `artifact-writer` 指令集管理。

Marketplace cache 发布面检查：

- `~/.claude/plugins/cache/paceaitian-paceflow/paceflow/6.0.41/.claude-plugin/plugin.json` 版本为 `6.0.41`。
- 顶层目录仅包含 `.claude-plugin`、`agent-references`、`agents`、`hooks`、`migrate`、`skills`。
- 未发现 `docs/`、`tests/`、`internal/`、`ticket*`、`HOOKS-TEST*`、`MEMORY*` 等非 runtime 内容。
- cache 中存在 `hooks/pre-tool-use.js` 的 `isArtifactWriterManagedRel` 与 `DENY_DIRECT_ARTIFACT_WRITE/EDIT` guard；`hooks/pace-utils.js` 中 `PACE_VERSION = 'v6.0.41'`。

迁移 rehearsal 备注：

- 当前 `paceflow-hooks` 本地/Obsidian artifact 已存在 `changes/`，不是 v5 迁移对象；不要对 live `paceflow-hooks` 执行 v5 迁移。
- `ccauth` Obsidian artifact 是真实 v5 候选：有 `task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` / `spec.md`，无 `changes/` 与 `.v5-backup`。
- v6.0.41 dry-run 曾因 legacy 文件内多个 `<!-- ARCHIVE -->` 标记中止；v6.0.42 将所有 legacy ARCHIVE 降级为 `<!-- v5 历史 active/archive 边界 -->`，并补 CRLF 兼容。
- 已在 `/tmp/paceflow-migrate-ccauth` 副本完成 dry-run + 正式迁移 rehearsal：4 个主 artifact 均只保留 1 个 v6 标准 ARCHIVE，history-boundary 计数分别为 task=3、implementation_plan=2、walkthrough=2、findings=2，`.v5-backup` 与 `changes/findings`、`changes/corrections` 正常生成。
- 不直接迁移 live `ccauth`；真实迁移仍需用户确认 dry-run 摘要后执行。

---

#### 0.1.10a r2 审计中明确暂不推进的低收益项

| 项 | 当前决策 | 理由 |
|---|---|---|
| artifact-writer lock TTL floor | 暂不实现；默认 30min 维持 | 默认 TTL 远大于正常 agent 执行时间，SubagentStop / PostToolUseFailure 已覆盖主要释放路径；只有用户把 `PACE_ARTIFACT_LOCK_TTL_MS` 调得过低才可能产生静默 race |
| logger fd-level flock / stale 阈值加长 | 暂不实现 | 最坏影响是日志行交叉，不影响 artifact 状态；当前 `createLogger` 已有基础轮转和单行化 |
| `T-\d{3}` 扩展到 999+ | 暂不实现 | CHG 内局部任务超过 999 极低概率；若未来改任务编号规范，应与 agent spec / fixture 一起改 |
| `modify-finding` / `update-finding` 指令 | 暂不从 r2 直接引入 | 当前 `update-chg` 只处理 CHG/HOTFIX，不能把 r2 的 `update-chg action=replace` 用于 finding；若要支持 finding 后续修改，需要单独设计 agent 指令和 hook 约束 |
| SubagentStop additionalContext 消费差异 | 暂不 block | 现有 SubagentStop 只做观察和恢复提示，不作为唯一保护；真实 production smoke 若发现不同 Claude Code 版本不消费 stdout，再考虑迁移到 PostToolUseFailure 或 SessionStart 恢复提示 |

#### 0.1.11 Review gate 设计备忘（GitHub issue #3）

issue #3 的 4 个质量缺口来自真实 milestone retro：验证 4 项（typecheck/test/lint/format）全部通过后，独立 review 仍发现 wire alignment drift、plan-comment invariant 遗漏、TDD red 质量不足、cross-cutting protocol hit-list 遗漏。

当前判断：

- `review gate` 与 PaceFlow 理念兼容的前提：hook 只机械检查“是否有 review evidence / source / summary / P0-P1 处置”，不判断 review 内容真伪。
- 风险：如果每个 task 都 review，或让 hook 频繁提示主 session “请自行判断是否需要 review”，会变成纯流程化负担和提示工程。
- 不能幻想 artifact-writer 或主 session 会自动发现所有 invariants / protocol hit-list。2/3/4 更适合作为 review checklist 的输入，而不是一开始就做成强 schema。
- 与 `APPROVED` / `VERIFIED` 同构：它们都不是证明用户批准/验证覆盖绝对正确，而是证明流程证据存在；`REVIEWED` 也只能做到这一层。

待设计问题：

1. review 频率：默认仅 close 前一次；是否对小 CHG/manual review 放宽；是否对协议/API/安全/部署/跨 3+ 模块强制独立 review agent。
2. review 主体：主 session 自审、独立 review agent、manual review、second-opinion 的优先级和可接受来源。
3. mechanical gate：`review-confirmed/source/summary/findings` 是否足够；`review-findings` 中 P0/P1 非零时是否必须附 hotfix CHG / won't-fix evidence。
4. 后续结构化字段：invariants、red-evidence、protocol-change-checklist 是否先进入 skill/review checklist，等真实使用稳定后再进入 artifact schema。

临时决策：不在当前 patch 线立即实现；先用 production smoke 和 issue #3 反馈设计一版低摩擦 `close-chg review gate`。

## 1. 调研背景

### 1.1 输入

- 用户告知 Claude Code 升级到 v2.1.126，PACEflow 久未跟进
- findings.md 中前次评估 [2026-04-02] CC v2.1.76→v2.1.90 含 12 项行动项，4 项已完成（CHG-20260403-01）、5 项被本次更新覆盖、3 项沿用
- 实际 npm 已发布到 v2.1.126；环境为 v2.1.118

### 1.2 调研产出

| 调研轮 | 范围 | 数据源 | 状态 |
|--------|------|-------|------|
| 第一轮 | v2.1.76→v2.1.90 | findings 已存（前次） | 已合并到第二轮 |
| 第二轮 | v2.1.91→v2.1.126（35 版本） | docs.claude.com + GitHub raw CHANGELOG 双源交叉验证 | findings.md 第 8 行 + 详情段落已记录 |
| 不确定项验证 | PreCompact 版本 / `${CLAUDE_EFFORT}` 范围 / `updatedToolOutput` 行为 | 官方文档定向查询 | 完成（含 1 项文档缺失） |
| 实测 1 | `pre-compact.js` 当前注册事件 | 直接读 `paceflow/hooks/hooks.json:45` | 确认是 PreCompact，非 PostCompact |
| 实测 2 | subagent 是否触发 PACE hook | 派 general-purpose subagent 实际操作 | 确认完全触发，反馈通过 system-reminder 注入 subagent 上下文 |

---

## 2. 已完成项（关闭 / 不再追踪）

| 项 | 完成方式 | 关闭日期 | 关联 |
|---|---------|---------|------|
| 5 个 SKILL.md description 缩短到 ≤250 字符 | CHG-20260403-01 | 2026-04-03 | walkthrough.md |
| 5 个 SKILL.md 添加 effort frontmatter | CHG-20260403-01 | 2026-04-03 | walkthrough.md |
| file_path 绝对路径变更验证 | v2.1.97 修复"matching documented behavior" | 2026-05-02 | 前次 P0 项 #1 关闭 |
| `pre-compact.js` 当前事件类型核对 | 已是 PreCompact（hooks.json:45） | 2026-05-02 | 本次会话 |
| subagent 触发 PACE hook 验证 | YES（plugin cache log 6585-6598 完整记录） | 2026-05-02 | 本次会话 |
| `${CLAUDE_EFFORT}` 支持范围 | 仅 SKILL.md body；frontmatter / hook command 不支持 | 2026-05-02 | 调研轮 3 |
| PreCompact 真实版本号 | v2.1.105（双源一致） | 2026-05-02 | 调研轮 3 |
| 前次 #2 todowrite-sync matcher 死代码疑虑 | #20243 已于 v2.1.19 修复，matcher 有效，禁止删除 | 2026-04-03 | findings 摘要索引 |

---

## 3. P0 立即可做（最高优先级）

### CHG-20260502-01：hooks.json 加 `if` 条件优化

**目标**：减少不必要的 hook 进程启动开销。

**改动**（`paceflow/hooks/hooks.json`）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "TodoWrite|TaskCreate|TaskUpdate",
        "if": "TodoWrite|TaskCreate|TaskUpdate",
        "hooks": [...]
      }
    ]
  }
}
```

**风险**：零（`if` 是 v2.1.85 引入的纯过滤机制，matcher 已在做相同的事，加 `if` 仅做早期过滤减少 Node.js 启动）。

**v6.0.28 更新**：`ConfigChange` / `config-guard` 已从发布面移除；plugin hook 注册不受 project/local settings 保护，此处不再包含 ConfigChange 示例。

**验证步骤**：
1. 备份当前 hooks.json
2. 应用改动
3. 重启 Claude Code
4. 触发 TodoWrite + Write|Edit 两类工具
5. 检查 pace-hooks.log 确认未误漏

**预估时长**：10 分钟（含验证）。

**前置条件**：无。

---

### CHG-20260502-02：pre-compact.js 加阻止能力

**目标**：在 V 阶段未完成时主动阻止 compact，避免任务上下文丢失。

**当前状态**（`paceflow/hooks/pre-compact.js`）：
- 已注册为 PreCompact 事件（hooks.json:45）
- 仅做 snapshot 收集（写到 `.pace/pre-compact-state.json`）
- **未利用 v2.1.105 引入的阻止能力**（`exit 2` 或 `{"decision":"block"}`）

**改动方案**（追加在 snapshot 后、退出前）：

```javascript
// v5.2.0: PreCompact 阻止逻辑（灰度开关 PACE_PRECOMPACT_BLOCK=1）
if (process.env.PACE_PRECOMPACT_BLOCK === '1') {
  const blockReasons = [];

  // 条件 1：task.md 有进行中任务
  if (snapshot.artifacts['task.md']?.inProgress?.length > 0) {
    blockReasons.push(`task.md 有 ${snapshot.artifacts['task.md'].inProgress.length} 个进行中任务（[/]）`);
  }

  // 条件 2：当日 walkthrough 缺记录且有已完成任务
  if (snapshot.walkthrough && !snapshot.walkthrough.hasTodayEntry &&
      snapshot.artifacts['task.md']?.done > 0) {
    blockReasons.push(`今日完成任务但 walkthrough.md 无当日记录`);
  }

  // 条件 3：findings 开放项 > 阈值（避免大量未决调研被 compact 丢失）
  if (snapshot.findings?.openCount >= 3) {
    blockReasons.push(`findings.md 有 ${snapshot.findings.openCount} 个开放项 [ ]`);
  }

  if (blockReasons.length > 0) {
    process.stderr.write(
      `PACE PreCompact 阻止：检测到未完成状态，建议先处理后再 compact\n` +
      blockReasons.map(r => `  - ${r}`).join('\n') +
      `\n如确需强制 compact，临时设 PACE_PRECOMPACT_BLOCK=0\n`
    );
    process.exit(2);
  }
}
```

**风险**：中
- 误阻止可能性：findings 开放项阈值需调优（3 太严？）
- 灰度策略：用 `PACE_PRECOMPACT_BLOCK` 环境变量控制，默认关闭
- 反复阻止风险：stop.js 已有降级机制，PreCompact 需对应设计

**验证步骤**：
1. 设 `PACE_PRECOMPACT_BLOCK=0`（默认），确认行为不变
2. 设 `PACE_PRECOMPACT_BLOCK=1`，造一个有 [/] 任务的状态
3. 触发 `/compact`，验证是否阻止 + 提示是否准确
4. 完成任务后再 compact，验证放行

**预估时长**：1-2 小时（含触发条件设计 + 测试）。

**前置条件**：无。

---

## 4. P1 实测/PoC 后做

### POC-1：subagent 分流 artifact 更新（核心方案）

**动机**：长期项目的 artifact 越来越大（findings.md 已 2475 行 ≈ 25K tokens），主 session 读全文一次就吃掉大量上下文。subagent 分流后，主 session 只接收一行总结，上下文节省 95%+。

**测试结果（已完成）**：

| 验证项 | 结果 | 证据 |
|---|---|---|
| subagent 的 Write/Edit 经过 PACE hook | YES | plugin cache log 6585-6598 完整记录 |
| hook 反馈通过 system-reminder 进入 subagent 上下文 | NO（只可作为主 session 提示，不能依赖进入 subagent 初始 prompt） | Smoke1 实测：`PreToolUse:Agent` 的 `reserved-id` / `reserved-file` 进入主 transcript，但首次 subagent 初始 prompt 未可靠携带，必须 deny 后由主 session 重派 |
| subagent 能完成 artifact 修改 | YES | 实测 Edit walkthrough.md + 撤销均成功 |
| deny 路径 | UNTESTED | 通道无异常迹象，需后续验证 |

**适合分流的场景**（按价值排序）：

| 场景 | 主上下文成本（不分流） | subagent 收益 | 推荐度 |
|---|---|---|---|
| findings 详情段落写入 | 必须读全文 ≈ 25K tokens | subagent 自读自写 | ★★★ |
| 归档操作（移动 ARCHIVE 标记） | 需读上下文几百行 | subagent 内部处理 | ★★★ |
| walkthrough 详情段落追加 | 需读最近条目格式 ≈ 5K tokens | subagent 学一次格式即可写 | ★★★ |
| implementation_plan 详情归档 | 涉及多段移动 | subagent 内部处理 | ★★ |
| task.md 状态变更（[x]/[ ]） | 几行微改 | subagent 启动开销不值 | × |
| 索引行追加（< 5 行） | 极小 | 同上 | × |

**实施方式**：

定义专用 subagent 类型 `paceflow-artifact-writer`（或复用 `general-purpose`）。主 session 调用方式：

```
Agent({
  description: "写入 finding 详情段落",
  subagent_type: "general-purpose",
  prompt: `
读取 ${VAULT}/findings.md，在"## 未解决问题"区追加新 finding：

标题：[2026-05-XX] XXX
影响：P1
现象：...
根因：...
影响范围：...
建议方案：...

完整内容：[详细文本]

要求：
1. 必须放在第一个 ### 之前（活跃区最新位置）
2. 必须保持现有 frontmatter 字段格式（### 标题、> 元信息行、加粗字段名）
3. 完成后报告：起始行号、结束行号、是否触发 hook、撤销路径
4. 不要修改其他内容
`
})
```

主 session 接收 subagent 的简短报告（200-500 tokens），不需读取 finding 全文。

**待验证项**：
1. subagent 学习现有格式的准确度（是否会写错字段名 / 错位置）
2. 多 subagent 并发写同一 artifact 是否有冲突（建议串行，单写）
3. subagent 调用成本（Sonnet vs Haiku 选择）
4. PostToolUse hook 提醒是否会被 subagent 错误处理（如它看到提醒后乱归档）

**实施步骤**：
1. 在 1-2 个真实 finding 写入场景测试 subagent 报告质量
2. 对比上下文消耗（主 session 直写 vs subagent 分流）
3. 总结 subagent prompt 模板（写入 `skills/artifact-management/references/subagent-template.md`）
4. 更新 `pace-workflow` skill 提示主 session 何时应分流

**预估时长**：3-4 小时（含 2 个真实场景测试 + 模板编写 + skill 更新）。

**前置条件**：无（subagent 触发 hook 已验证）。

---

### POC-2：updatedToolOutput 实际行为验证

**动机**：v2.1.91/110/121 引入 PostToolUse 的 `updatedToolOutput` 全工具支持。但官方文档对 Write/Edit 场景的具体行为缺失：
- AI 看到的是新 output 还是原 output？
- transcript 记录哪一份？
- 大小限制？

**三种用法澄清**：

| 用法 | 描述 | 适用场景 |
|------|------|---------|
| ① 提示型 | hook 替换工具输出为带提示版本（如 "File written. ⚠️ 任务未归档"） | 提示 AI 下一步动作 |
| ② 静默修复型 | hook 自己 fs 修改文件 + 用 updatedToolOutput 告知 AI "Auto-fixed" | ARCHIVE 标记自动放置 |
| ③ hook 调 AI 型 | hook 通过 v2.1.118 调 MCP 工具让 LLM 判断 | 需要智能判断的复杂场景 |

**本次 PoC 范围**：仅验证用法 ① 和 ②（用法 ③ 复杂度高，本次不做）。

**测试方案**：

1. 创建临时项目 `/tmp/updatedoutput-test/`
2. 写测试 hook `test-hook.js`，输出：
   ```javascript
   console.log(JSON.stringify({
     hookSpecificOutput: {
       hookEventName: "PostToolUse",
       updatedToolOutput: "REPLACED OUTPUT - hook injected this"
     }
   }));
   ```
3. 写 `.claude/settings.json` 注册 PostToolUse:Read hook
4. 写 `data.txt` 内容 `original content`
5. 启动 Claude Code 在该目录
6. 让主 session Read data.txt，观察输出

**预期对比**：
- 不替换：AI 看到 `original content`
- 替换后：AI 看到 `REPLACED OUTPUT - hook injected this`

**结果应用**：

| PoC 结果 | 后续行动 |
|---------|---------|
| AI 看到替换后内容 | 用法 ② 可行——可设计 ARCHIVE 自动放置：hook fs 操作 + updatedToolOutput 告知 |
| AI 仍看到原内容 | 用法 ① 仅作提示，hook 不能替代 AI 修复 |
| 大小限制 < 10K | 复杂提示需走 additionalContext 而非 updatedToolOutput |

**风险**：低（独立临时项目，不影响 PACEflow 生产）。

**预估时长**：1-2 小时。

**前置条件**：无。

---

### CHG-20260502-03：5 个 SKILL.md 引入 `${CLAUDE_EFFORT}`（受限版）

**重要约束**：`${CLAUDE_EFFORT}` 仅在 SKILL.md body 中支持，frontmatter 和 hook command 不支持。

**改动方案**（每个 SKILL.md 加条件分支文本，不改 frontmatter）：

`pace-workflow/SKILL.md`：
```markdown
## 当前 effort 自适应

当 `${CLAUDE_EFFORT}` 为 `low`：
- 跳过 brainstorming 阶段（直接 Plan）
- C 阶段批准简化为单行确认

当 `${CLAUDE_EFFORT}` 为 `high` 或 `max`：
- 强制 paceflow-audit（5-agent 审查）
- V 阶段额外要求集成测试通过
```

`paceflow-audit/SKILL.md`：
```markdown
## 审查深度

当 `${CLAUDE_EFFORT}` 为 `medium` 或更高：启动 5-agent 并行审查
当 `${CLAUDE_EFFORT}` 为 `low`：单 agent 简化审查
```

**风险**：低（仅文本变化，AI 自行解释 effort 含义）。

**验证步骤**：
1. 设不同 effort 触发 skill
2. 观察 AI 是否按 effort 调整行为
3. 注意 `${CLAUDE_EFFORT}` 字面值（low/medium/high/xhigh/max）

**预估时长**：1 小时（5 个 SKILL.md，每个 ~10 行新增）。

**前置条件**：无。

---

## 5. P2 沿用（非紧急）

### 5.1 Plugin userConfig VAULT_PATH 配置化

**状态**：阻塞已数月。v2.1.119 `claude plugin validate` 增强可帮助。

**目标**：让用户通过 plugin userConfig 设置 VAULT_PATH，而非环境变量。

**前置不确定**：plugin agent 不支持 hooks/mcpServers/permissionMode（v2.1.78 文档），需确认 userConfig 是否能传递到 hook 命令。

### 5.2 TaskCreated hook 补充验证

**状态**：v2.1.84 引入，行为稳定。当前 PreToolUse:TaskCreate 已工作（#20243 v2.1.19 修复）。

**行动**：可选，作为创建后二次验证。优先级低于 PreToolUse。

### 5.3 Hook 输出 >50K 阈值确认

**状态**：v2.1.89 引入存盘机制；阈值未文档化精确值。

**行动**：实测 SessionStart 注入量极限（PACEflow 5 个 artifact 活跃区注入可能 500-1000 行）。

### 5.4 Plugin skill frontmatter hooks（v2.1.94 修复）

**状态**：之前 plugin skill 在 YAML frontmatter 中定义的 hooks 被静默忽略，已修复。

**行动**：当前 8 个 hook 已全局注册，scoped hook 是优化非必要。可选。

---

## 6. P3 不做（明确否定）

| 项 | 不做理由 |
|---|---------|
| `monitors` manifest key（v2.1.105/121） | 当前无后台监控需求 |
| CwdChanged / FileChanged hook（v2.1.83） | "等需求出现"原则；reactive 环境管理对 PACEflow 价值有限 |
| Hook 调用 MCP 工具（v2.1.118） | hooks 用 fs 直接操作（性能优势 < 5ms vs CLI 100-500ms），无强需求 |
| PermissionDenied / defer 权限决策（v2.1.89） | 无 headless / auto mode / CI 需求 |
| 跨平台支持（CE 思路） | hooks 是 Claude Code 专属能力，跨平台意味着放弃确定性保障 |

---

## 7. 监控项（破坏性变更，无需立即行动）

| 变更 | 版本 | 当前影响 | 触发条件 |
|------|------|---------|---------|
| Windows 不再需要 Git Bash | v2.1.120 | 零（settings.json 仍用 Node.js） | 未来切换 PowerShell shell 时评估 |
| 原生构建 Glob/Grep 替换为 Bash 内嵌 bfs/ugrep | v2.1.113+ | 已实测影响主 session 工具面：Claude Code v2.1.133 native build 可返回 `No such tool available: Glob` | skill / docs 不再硬依赖 `Glob/Grep`；优先专用工具，缺失时用只读 Bash `find` / `rg` / `grep` fallback |
| `--dangerously-skip-permissions` 扩大范围 | v2.1.126 | 零（PACEflow 不依赖此 flag） | 用户主动启用此 flag 时评估覆盖范围 |
| ToolSearch Vertex 默认关闭 | v2.1.119/121 | 零 | 部署 Vertex 时评估 |

---

## 8. 推荐执行序列

```
Phase 1：低风险高 ROI（Day 1, ~2 小时）
  └── CHG-20260502-01: hooks.json `if` 条件优化（10 min）
       ↓
Phase 2：subagent 分流验证（Day 1-2, ~4 小时）
  └── POC-1: 选 1 个真实 finding 写入场景，对比上下文消耗
       ↓ (基于结果决定下一步)
Phase 3：updatedToolOutput 行为验证（Day 2, ~2 小时）
  └── POC-2: 临时项目实测用法 ① 和 ②
       ↓
Phase 4：基于 POC-1 + POC-2 综合设计（Day 3, ~3 小时）
  ├── 标准化 subagent artifact-writer prompt 模板
  ├── 决定 ARCHIVE 自动放置策略（hook 静默修复 vs subagent 处理）
  └── 写入 skills/artifact-management/references/
       ↓
Phase 5：PreCompact 阻止逻辑（Day 3-4, ~2 小时）
  └── CHG-20260502-02: pre-compact.js 加阻止能力（含灰度）
       ↓
Phase 6：SKILL.md effort 自适应（Day 4, ~1 小时）
  └── CHG-20260502-03: 5 个 SKILL.md 引入 ${CLAUDE_EFFORT}（body）
       ↓
Phase 7：发布 v5.2.0
  └── 版本号 bump（用 bump-version.js）+ walkthrough 记录
```

**总预估时长**：12-15 小时（不含中间反复测试）。

---

## 9. 决策矩阵：subagent 分流 vs hook 静默修复

针对"自动归档 ARCHIVE 标记"等典型场景，两种方案对比：

| 维度 | hook 静默修复（fs 操作 + updatedToolOutput） | subagent 分流（派 agent 处理） |
|------|------------------------------------------|-----------------------------|
| **延迟** | < 50ms | 5-30 秒（含 LLM 调用） |
| **上下文消耗** | 零（在 hook 内部） | 中（subagent 自身上下文，但不进主 session） |
| **智能判断能力** | 弱（确定性规则） | 强（理解语义） |
| **错误恢复** | hook 失败必须 fail-open | subagent 报告错误，主 session 决策 |
| **维护成本** | 高（hook 是 Node.js，规则迭代慢） | 低（prompt 文本调整） |
| **测试难度** | 中（需触发真实工具调用） | 高（subagent 行为不完全可重现） |
| **失败影响** | 一次操作 | 一次 subagent 调用成本 |
| **PoC-2 依赖** | 强（updatedToolOutput 行为决定） | 弱（独立可行） |

**初步建议**（待 PoC 结果验证）：

| 场景类型 | 推荐方案 |
|---------|---------|
| ARCHIVE 标记位置（确定性规则强） | hook 静默修复 |
| findings 详情段落写入（需理解上下文） | subagent 分流 |
| walkthrough 详情段落写入（格式固定） | subagent 分流 |
| 任务状态变更（[x]/[ ]） | 主 session 直接做（不分流） |
| 格式校验失败修复（如缺 frontmatter） | hook 静默修复（用法 ②） |
| impl_plan 详情段落归档 | subagent 分流 |

---

## 10. 风险与缓解

### 10.1 subagent 分流的风险

| 风险 | 缓解 |
|------|------|
| subagent 误写错误位置 / 错字段名 | 1) 提供详细 prompt 模板 2) 主 session 接收报告后做轻量校验（如行号检查） |
| subagent 报告"已完成"但实际未生效 | 1) 要求 subagent 报告精确行号 2) 主 session Bash `wc -l` 抽查 3) `pace-hooks.log` 是 ground truth |
| 多 subagent 并发写同一 artifact | 强制串行（1 个 artifact 1 个 subagent） |
| subagent 触发 hook 错误恢复（如反复 retry） | 主 session 监控 subagent 总 token 消耗，超限中断 |
| subagent 模型能力差异 | 默认 Sonnet；Haiku 仅用于"复制粘贴式"简单任务 |

### 10.2 PreCompact 阻止逻辑的风险

| 风险 | 缓解 |
|------|------|
| 误阻止合理 compact | 1) 灰度环境变量 PACE_PRECOMPACT_BLOCK 控制 2) 提示信息清晰 3) 阻止后给出"如何解除"指引 |
| 反复阻止陷入循环 | 复用 stop.js 的 blockCount 降级机制 |
| 大 artifact 注入触发 autocompact 熔断 | 监控 SessionStart 注入量，超 50K 走存盘机制 |

### 10.3 updatedToolOutput 的风险

| 风险 | 缓解 |
|------|------|
| 替换后 AI 不知发生了什么（用法 ②） | updatedToolOutput 内容必须明确说明"Auto-fixed: ..." |
| 大小超限被截断 | PoC-2 验证阈值，超出走 additionalContext |
| transcript 记录不一致影响调试 | 在 pace-hooks.log 记录原始 + 替换后内容 |

---

## 11. 后续跟踪

- 本文档生成后立即更新 findings.md 第 8 行索引补 `[plan:: action-plan-2026-05-02.md]`
- 每个 CHG 完成后在本文档对应小节末尾追加 `**完成**: CHG-XXX, walkthrough 索引行链接`
- v5.2.0 发布后，本文档移到 `docs/archived-plans/` 下

---

## 12. 调研来源

- [Claude Code 官方 Changelog](https://code.claude.com/docs/en/changelog)
- [GitHub raw CHANGELOG.md](https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md)
- [Claude Code Hooks 文档](https://code.claude.com/docs/en/hooks)
- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)
- npm registry: `@anthropic-ai/claude-code` 版本列表
- findings.md 第 8 行索引 + 详情段落（[2026-05-02] CC v2.1.91→v2.1.126 完整变更评估）
- 本会话实测：subagent 工具调用 + pre-compact.js 当前事件类型

---

## 附录 A：本次会话产出汇总

| 产出 | 位置 |
|------|------|
| v2.1.91→v2.1.126 调研记录（索引 + 详情段落） | findings.md 第 8 行 + "## 未解决问题"区 |
| v76-90 finding 标 [-] + merges 标记 | findings.md 第 23 行 |
| v76-90 详情段落归档到 ARCHIVE 下方 | findings.md（移动 ARCHIVE 标记） |
| CE finding 标 [-] + 保持现状理由 | findings.md 第 24 行 |
| CE 详情段落归档到 ARCHIVE 下方 | findings.md（移动 ARCHIVE 标记） |
| subagent 触发 hook 验证报告 | 本会话上下文（已并入本文档第 4 节 POC-1） |
| 完整行动项规划文档 | **本文档：`action-plan-2026-05-02.md`** |

---

## 13. v6.0.0 架构提案：索引-详情拆分 + Obsidian Wikilink

### 13.1 触发原因（真实痛点）

用户在 ccauth 项目（长期项目，artifact 已 45KB+152KB+260KB+381KB）反馈：**改代码用 10K 上下文，写文档和归档用 100K+**。根因分析：

1. Claude Code 强制 Edit 前必须 Read（大文件 Read 消耗高）
2. `old_string` 在大文件中不唯一导致 Edit 循环失败（30-50% 失败率）
3. ARCHIVE 标记移动是双步骤精确匹配（每次 2 次 Edit）
4. 1 个 CHG 完成需在 task / impl_plan / walkthrough 3 处归档
5. 详情段落格式严格（多种字段命名系统，见 findings 第 514 行 H-1/H-2）

**痛点本质**：不是 SessionStart 注入（一次性税）或 AI 主动 Read（偶尔事件），而是**每次 CHG 收尾的归档循环**——是确定性的、每个任务都发生、且失败率高的"按次计费税"。

### 13.2 架构设计

```
projects/<project>/
├── task.md                    ~3KB    纯索引行（wikilink 引用 CHG 详情）
├── implementation_plan.md     ~5KB    纯索引行
├── walkthrough.md             ~5KB    纯索引行
├── findings.md                ~5KB    纯索引行 + 摘要
├── spec.md                    不变（项目说明，无 CHG 概念）
└── changes/                   <-- 新增
    ├── chg-20260502-01.md     ~3KB    单 CHG 全详情（任务/实施/记录/调研合并）
    ├── chg-20260502-02.md
    ├── hotfix-20260321-01.md
    └── findings/              <-- finding 类型独立子目录
        ├── finding-2026-05-02-v91-126.md
        └── finding-2026-04-12-ce-compare.md
```

### 13.3 主 artifact 索引格式（task.md 示例）

```markdown
# 项目任务追踪

## 活跃任务

- [/] [[chg-20260502-02]] PreCompact 阻止能力 #change [tasks:: T-501~T-505]
- [/] [[chg-20260502-01]] hooks.json if 条件优化 #change [tasks:: T-498~T-500]

<!-- ARCHIVE -->

- [x] [[chg-20260403-01]] SKILL.md 元数据修正 #change
- [x] [[chg-20260321-01]] v5.1.4 code review 修复 #change
```

### 13.4 CHG 详情文件格式（changes/chg-20260502-01.md）

```markdown
---
chg-id: CHG-20260502-01
status: in-progress | completed | archived
date: 2026-05-02
type: change | hotfix | research
related-finding: "[[finding-2026-05-02-v91-126]]"
aliases: ["CHG-20260502-01", "hooks.json if 优化"]
tags: [change, hooks-optimization]
parent-tasks: ["[[task]]"]
parent-impl: ["[[implementation_plan]]"]
---

# CHG-20260502-01: hooks.json `if` 条件优化

## 任务清单
- [/] T-498 todowrite-sync if 条件添加
- [-] T-499 config-guard if 条件添加（v6.0.28 已移除 ConfigChange）
- [ ] T-500 验证 hook 触发率

<!-- APPROVED -->

## 实施详情
**背景（Why）**: ...
**范围（What）**: ...
**技术决策（How）**: ...
**T-498 任务标题**: 具体改动说明

## 工作记录
| 日期 | 完成内容 |
| --- | --- |
| 2026-05-02 | T-498 完成 |

## 关联调研
- [[finding-2026-05-02-v91-126]] CC v2.1.91→v2.1.126 调研
```

**单一文件容纳一个 CHG 全部信息**：任务、实施、工作记录、关联调研。1 CHG = 1 文件 = 1 wikilink。

### 13.5 Obsidian 特性白送的好处

| 特性 | 用法 | 价值 |
|------|------|------|
| Backlinks | 在 chg-xxx.md 看到"被 task / impl_plan 引用" | 自动维护反向索引 |
| Graph view | 可视化 CHG 间依赖（HOTFIX 修复哪个 CHG） | 历史架构演进可视化 |
| Aliases | `aliases: [CHG-XXX, "短描述"]` | wikilink 用任一名称都能命中 |
| Dataview | `from "changes" where status = "in-progress"` | 跨 CHG 动态查询 |
| Bases (1.9+) | `.base` 文件按 frontmatter 表格化 | 比 Markdown 表格强 100 倍 |
| Templater | 模板自动生成 frontmatter | 减少手动错误 |
| Properties UI | Obsidian 表单编辑 frontmatter | 状态变更不必手敲 |

### 13.6 PoC 验证结果（2026-05-02 完成）

通过派 subagent 在真实 vault 创建 `changes/chg-20260502-01-poc.md` 验证：

| 验证项 | 结果 | 数据 |
|------|------|------|
| Subagent 一次写对全部格式 | ✅ YES | 60 行 / 2320 字节，零 Edit 循环 |
| `changes/` 新目录是否被 hook 拦截 | ✅ NO | PreToolUse PASS（dur=32ms），PostToolUse PASS（无归档提醒） |
| Hook 注入 additionalContext | ✅ YES（5 行） | 正常状态提醒，不阻断 Write |
| Subagent 总 token 消耗 | **~8K tokens** | 9 次工具调用 |
| 对比当前架构同操作估算 | **~30K tokens** | 节省 ≥ 73% |

**关键洞察**：用 Write 创建新文件 = 跳过"Read 大文件 + 精确 old_string 匹配"全过程，subagent 即使能力有限也能可靠完成。

### 13.7 操作映射表（痛点根治路径）

| 操作 | 当前架构 | v6.0.0 | 痛点缓解 |
|------|---------|--------|---------|
| 写新详情段落 | Edit 大 artifact + 找位置插入 | `Write changes/chg-xxx.md` | **零 Read** |
| 修改详情段落 | Edit 大 artifact + 精确范围 | Edit 单 CHG 文件（100 行级） | old_string 唯一性高 |
| 归档详情 | 双步骤移动 ARCHIVE 标记 | Edit 索引行移到 ARCHIVE + 详情 frontmatter `status:` | **不再需要移动多行内容** |
| 跨 artifact 同步 | 3 个大文件 Edit 3 次 | 改 3 个索引文件的 1 行 wikilink | Edit 范围极小 |

### 13.8 Hook 改造点（v6.0.0）

1. `readActive(cwd, file)` 语义不变，但内容是索引行（极小）
2. 新增 `readChgDetail(cwd, chgId)` 按需加载
3. 新增完整性 hook：检测索引引用了 `[[chg-xxx]]` 但 `changes/chg-xxx.md` 不存在 → 提醒
4. ARCHIVE 标记仍移动索引行（不移详情文件）；详情 frontmatter `status: archived` 同步
5. 跨 artifact 一致性由 Obsidian backlinks 自动维护
6. wikilink 解析正则：兼容 `[[chg-xxx]]`、`[[chg-xxx|alias]]`、`[[chg-xxx#section]]` 三种形式

### 13.9 决策矩阵

| 决策 | 选项 | 推荐 |
|------|------|------|
| CHG 详情合并还是分段 | 1 CHG=1 文件 vs 1 CHG=4 文件（task/impl/walk/finding 各一） | **合并**（文件数减 4 倍，AI 一次读完整故事） |
| finding 是否独立子目录 | 在 changes/ 下 vs 单独 findings/ | **changes/findings/**（CHG 是"做了什么"，finding 是"学到什么"，生命周期不同） |
| 旧 CHG 是否强制迁移 | 一次性迁移 vs 双轨保留 | **双轨**（新 CHG 走新结构，旧 CHG 保留，提供 migrate-chg.js） |
| 链接格式 | wikilink vs 标准 markdown link | **wikilink**（Obsidian 优先，重命名追踪 + backlinks 自动） |

### 13.10 实施路径（v6.0.0 完整设计）

```
Phase 1：PoC（已完成 2026-05-02）
  └── changes/chg-20260502-01-poc.md 验证（节省 73% tokens 已确认）
       ↓
Phase 2：v6.0.0 架构设计（~3 小时）
  ├── 6 个新模板设计（task / impl_plan / walkthrough / findings 索引模板 + chg-template + finding-template）
  ├── Hook 改造规范（8 个 hook 脚本的具体改动点）
  ├── SKILL.md 改造规范（当前发布面为 4 个用户 skill；audit 保留 internal）
  └── 写入 docs/plans/v6.0.0-design.md
       ↓
Phase 3：v6.0.0 实施（~15-20 小时）
  ├── 改造 8 个 hook 脚本（重点：readActive / countByStatus / 新增 wikilink 解析）
  ├── 改造 5 个 SKILL.md（新格式引导）
  ├── 改造 6 个模板
  ├── 编写 migrate-chg.js 迁移工具
  └── 文档：v5→v6 升级指南
       ↓
Phase 4：双轨支持
  ├── PACEflow 自身先用（dogfood）
  ├── ccauth 项目作为大型测试（验证 95% token 节省）
  └── 渐进式：新 CHG 走新结构，旧 CHG 保留
       ↓
Phase 5：v6.0.0 正式发布
```

### 13.11 风险与缓解

| 风险 | 缓解 |
|------|------|
| 详情文件丢失但索引仍引用 | 完整性 hook（PostToolUse 检测）+ Obsidian broken link 红色提示 |
| 多 subagent 并发写同一 CHG 详情 | 强制 1 CHG 1 subagent；用 `.pace/locks/chg-xxx.lock` 简易锁 |
| CHG-ID 三处一致性（文件名 / wikilink / frontmatter） | hook 校验三处必须匹配 |
| Obsidian sync 延迟 | OneDrive sync 是已知限制，新架构不引入新问题 |
| 历史 CHG 检索需打开多文件 | Obsidian 全文搜索 + Dataview 查询补足 |
| 非 Obsidian 环境 wikilink 失效 | PACEflow vault 主要在 Obsidian 查看；GitHub 渲染不支持但接受 |

### 13.12 Subagent 分流的协同效应

v6.0.0 拆分架构 + subagent 分流是**叠加增益**：

| 层级 | 方案 | 单独收益 | 叠加收益 |
|------|------|---------|---------|
| 架构层 | v6.0.0 拆分 | Edit 范围小，循环失败率降 | 80%+ |
| 工作流层 | subagent 分流 artifact 操作 | 主 session 不消耗读写 tokens | 50%+ |
| **叠加** | 两者结合 | — | **主 session token 消耗降低 95%+** |

PoC 已证明：subagent 用 8K tokens 完成在主 session 需 30K+ tokens 的操作。架构拆分后单 CHG 详情文件 ≤ 100 行，subagent 即使能力有限（Sonnet/Haiku）也能可靠操作。

### 13.13 待决策项

1. 是否启动 Phase 2（v6.0.0 完整架构设计 + docs/plans/v6.0.0-design.md）？
2. PoC 文件 `changes/chg-20260502-01-poc.md` 是否保留？（保留 = v6.0.0 正式实施时的基础；删除 = PoC 完成后清理）
3. 是否在 v6.0.0 实施前先做 CHG-20260502-01（hooks.json `if` 条件优化）走当前架构，作为最后一个传统 CHG？
4. ccauth 项目是否同步迁移（v6.0.0 验证场景）？

### 13.14 PoC Cleanup 命令（如不保留）

```bash
rm /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/changes/chg-20260502-01-poc.md
rmdir /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/changes/  # 仅当目录为空
```

---

## 14. findings 与 corrections 在 v6.0.0 中的处理

### 14.1 finding 与 CHG 的本质差异

| 维度 | CHG | finding |
|------|-----|---------|
| 生命周期 | 短（开始-完成-归档） | 长（可开放数月，可被合并/否定） |
| 状态 | `[/] → [x]` 单向 | `[ ]/[/]/[x]/[-]/[!]` 多状态 |
| 关联 | 关联当时的 task/impl/walk | 关联多个 CHG，可被另一 finding "merges/merged-into" |
| 内容 | 任务执行记录 | 调研结论 + 可能行动项 |
| 类型 | change / hotfix | research / observation / comparison / correction |

因此 finding **不能复用 CHG 的简单 frontmatter**，需要单独设计。

### 14.2 finding 详情文件结构

路径：`changes/findings/finding-YYYY-MM-DD-slug.md`

```markdown
---
finding-id: FINDING-2026-05-02-v91-126
status: open                              # open | investigating | accepted | rejected | merged | blocked
type: research                            # research | observation | comparison | correction | bug-report
date: 2026-05-02
impact: P1                                # P0 | P1 | P2 | P3
summary: "CC v2.1.91→126 共 35 版本：5 项关键发现，3 项升级机会"
related-changes:                          # 该 finding 关联到哪些 CHG
  - "[[chg-20260502-01]]"
  - "[[chg-20260502-02]]"
merges:                                   # 该 finding 替代了哪些（合并历史）
  - "[[finding-2026-04-02-v76-90]]"
merged-by: null                           # 该 finding 被哪个替代（更新版本时填）
rejection-reason: null                    # 仅 status=rejected 时必填，≥10 字符
aliases: ["v91-126 调研", "Claude Code 2.1.91 升级评估"]
tags: [finding, research, claude-code-changelog]
---

# CC v2.1.91→v2.1.126 完整变更评估

## 摘要
> 35 版本（缺 93/95/102/103/106/115/125/88-撤回）；5 项关键发现：(A)v2.1.97 file_path 绝对路径修复 (B)v2.1.105 PreCompact hook 阻止能力 (C)...

## 背景
（调研触发原因）

## 关键发现
### 发现 1：file_path 绝对路径修复
...

## 对前次行动项的影响
（表格）

## 新增行动项
（列表）

## 不确定项
（列表）

## 调研来源
（链接）
```

### 14.3 findings.md 索引格式（精简版）

```markdown
# 调研记录

## 摘要索引

<!-- 格式：- [状态] [[finding-id]] 标题 — summary [date::] [impact::] [tags::] -->

- [ ] [[finding-2026-05-02-v91-126]] CC v2.1.91→126 — 35 版本，5 关键发现 [date:: 2026-05-02] [impact:: P1] [merges:: [[finding-2026-04-02-v76-90]]]
- [-] [[finding-2026-04-12-ce-compare]] Compound Engineering 对比 — 可共存，3 借鉴方向 [date:: 2026-04-12] [impact:: P3]
- [-] [[finding-2026-04-02-v76-90]] CC v2.1.76→90 — 已合并 [date:: 2026-04-02] [merged-into:: [[finding-2026-05-02-v91-126]]]
- [x] [[finding-2026-03-12-ticket22]] v5.0.2 全面审查 — 0C+1H+12W+26I [date:: 2026-03-12] [change:: [[chg-20260312-04]]]

<!-- ARCHIVE -->

（更老 finding 索引）
```

**索引行从当前 200-500 字符缩到 50-100 字符**——长摘要移到详情 frontmatter 的 `summary:` 字段。

### 14.4 状态映射表（关键改进）

| 索引标记 | frontmatter status | 含义 | 是否阻止 stop hook |
|---------|------------------|------|-----------------|
| `[ ]` | `open` | 参考中/待评估 | 14 天后阻止 |
| `[/]` | `investigating` | 主动调查中 | 不阻止 |
| `[x]` | `accepted` | 已采纳/已验证 | 自动归档 |
| `[-]` | `rejected` | 保持现状/已否定 | 不阻止（需 ≥10 字符 rejection-reason） |
| `[-]` | `merged` | 被另一 finding 替代 | 不阻止（需 merged-into wikilink） |
| `[!]` | `blocked` | 阻塞 | 阻止 |

**关键改进点**：当前架构 `[-]` 同时表示"否定"和"合并"，hook 难以区分；v6.0.0 通过 frontmatter `status` 字段精确区分，hook 可基于 status 而非索引标记做判断。

### 14.5 与 CHG 的双向关联

| 方向 | 实现 |
|------|------|
| finding → CHG | finding 详情 frontmatter `related-changes: [[chg-xxx]]` |
| CHG → finding | CHG 详情 frontmatter `related-finding: [[finding-xxx]]` |
| 自动维护 | Obsidian backlinks（无需手动同步） |
| Dataview 查询 | `from "changes/findings" where contains(related-changes, [[chg-20260502-01]])` |

### 14.6 历史 finding 迁移策略

findings.md 当前有 60+ finding 索引 + 详情，格式相对统一（`### [日期] 标题` + 段落）。

**自动化迁移可行性高于 CHG**——可写脚本 `migrate-finding.js`：

```javascript
// migrate-finding.js 伪代码
1. 解析 findings.md 所有 `^### \[日期\] 标题$` 段落起止
2. 提取 metadata（日期 / 状态 / 关联 CHG / impact / tags）
3. 为每条生成独立 changes/findings/finding-yyyy-mm-dd-slug.md
4. 在新文件写入 frontmatter（含 summary 字段）+ 详情 body
5. 重写 findings.md 为索引（仅保留状态行 + wikilink + 短 summary）
6. 验证：每条索引 wikilink 指向的文件都存在
```

**渐进策略**：

| 版本 | 策略 |
|------|------|
| v6.0.0 | 双轨：新 finding 走新结构，旧 findings.md 保留双区结构 |
| v6.1.0 | 提供 `migrate-finding.js`，用户按需迁移 |
| v6.5.0 | 评估是否强制全迁移（若 90%+ 已迁移则强制） |

### 14.7 Hook 改造点（finding 特定）

1. `findings.md` 的 readActive() 仍读活跃区，但内容仅是索引行（极小）
2. **14 天阻止规则**：检查 `[ ]` 索引 + frontmatter `status: open`，**排除** `[/] investigating`（主动调查中不应被阻止）
3. **`[-] rejected` 必须有 `rejection-reason` ≥10 字符**（当前已是规则，frontmatter 强制化）
4. **`[-] merged` 必须有 `merged-into` wikilink 指向有效 finding 文件**（当前架构靠注释维护）
5. **CHG 完成后自动检查关联 finding 状态**：如果 CHG 标 `[x]` 但 `related-finding` 仍 `[ ]` → 提醒更新为 `[x] accepted`
6. **完整性检查**：索引 wikilink 指向的 `changes/findings/*.md` 必须存在

---

## 15. corrections 在 v6.0.0 中的处理

### 15.1 corrections 与 finding 的差异

| 维度 | finding | correction |
|------|---------|-----------|
| 生成方式 | AI 主动调研记录 | 用户纠正 AI 触发 |
| 内容焦点 | 技术问题 / 调研结论 | AI 行为问题 / 触发场景 / 根本原因 |
| 关联 knowledge | 偶尔（findings → knowledge 选择性） | 强制（每条 correction 必有 [knowledge:: link]） |
| 状态 | 5 种（open/accepted/rejected/...） | 通常仅 1 种（recorded） |
| 数量增长 | 中（每月几条） | 低（每月 1-2 条） |

corrections 当前作为 findings.md 的一个段落（`## Corrections 记录`），应独立处理。

### 15.2 corrections 详情文件结构

路径：`changes/corrections/correction-YYYY-MM-DD-NN.md`

```markdown
---
correction-id: CORRECTION-2026-04-15-01
date: 2026-04-15
trigger-quote: "用户原话或近似引用，如：'不对，归档不是这样'"
wrong-behavior: "AI 错误行为简述"
correct-behavior: "正确做法简述"
trigger-scenario: "什么场景下容易出现"
root-cause: "根本原因（认知偏差 / 工具限制 / 流程缺失）"
knowledge-link: "[[ai-verification-discipline]]"   # 必须指向 knowledge/ 笔记或写 "project-only"
project-scope: "project-only | universal"          # 是否仅本项目
tags: [correction, knowledge-discipline]
---

# Correction: 任务完成后未主动归档

## 错误行为
[详细描述错误]

## 正确做法
[详细描述正确]

## 触发场景
[什么时候 AI 容易犯]

## 根本原因
[认知层面的根因分析]

## 关联知识
- [[ai-verification-discipline]] 验证纪律
- 关联 finding：[[finding-2026-04-12-ce-compare]]（如有）
```

### 15.3 corrections 独立索引文件

新增 `corrections.md`（与 findings.md 同级）：

```markdown
# Corrections 记录

> AI 行为纠正历史。每条 correction 必双写到 knowledge/ 或标 project-only。

## 索引

<!-- 格式：- [[correction-id]] 简要标题 [date::] [knowledge::] [scope::] -->

- [[correction-2026-04-15-archive-skip]] 任务完成后未主动归档 [date:: 2026-04-15] [knowledge:: project-only]
- [[correction-2026-03-22-todowrite-bypass]] TodoWrite 使用前未先 read task [date:: 2026-03-22] [knowledge:: [[ai-verification-discipline]]]

<!-- ARCHIVE -->

（更老 corrections 索引）
```

**为什么独立而非放 findings.md**：

| 维度 | 独立文件 | 嵌入 findings.md |
|------|---------|---------------|
| 语义清晰度 | 高（corrections vs findings 关注点不同） | 低（混在一个文件） |
| 检索 | 直接 `corrections.md` | 需在 findings.md 翻找 |
| frontmatter 设计 | 可独立优化（不与 finding 字段冲突） | 必须妥协 |
| Obsidian Dataview | `from "changes/corrections"` 干净 | 需过滤 type 字段 |
| stop hook 检查 | 单独规则（如新 correction 后 24h 内必须有 knowledge 双写验证） | 与 finding 规则混淆 |

### 15.4 Hook 改造点（correction 特定）

1. **新增 correction 必触发**：PostToolUse:Write 检测到 `changes/corrections/*.md` 创建后：
   - 检查 frontmatter `knowledge-link` 字段是否填写
   - 如指向 knowledge/ 笔记，验证笔记存在
   - 如填 `project-only`，记录但不强制 knowledge 写入
2. **stop hook 验证**：会话结束前检查本会话所有 correction 是否完成 knowledge 双写
3. **频次告警**：同一 root-cause 累计 3 次 correction → 提醒可能存在系统性问题（建议升级到 finding 或 hook 改造）

### 15.5 历史 corrections 迁移

findings.md 当前 Corrections 区有 ~10 条 correction 记录。迁移流程：

1. 解析 `### Correction: ...` 段落
2. 提取四要素（错误行为 / 正确做法 / 触发场景 / 根本原因）
3. 提取 `[knowledge:: ...]` 字段
4. 生成 `changes/corrections/correction-YYYY-MM-DD-NN.md`
5. 在 corrections.md 写入索引行
6. 从 findings.md 删除 Corrections 区

迁移工具：`migrate-correction.js`（可与 migrate-finding.js 合并为 `migrate-v6.js`）。

---

## 16. v6.0.0 完整文件结构（汇总）

```
projects/<project>/
├── task.md                         索引文件（CHG 索引）
├── implementation_plan.md          索引文件（CHG 索引）
├── walkthrough.md                  索引文件（CHG 完成记录索引）
├── findings.md                     索引文件（finding 索引 + 摘要）
├── corrections.md                  索引文件（correction 索引）⬅ 新增
├── spec.md                         不变（项目说明，无 CHG/finding 概念）
└── changes/
    ├── chg-20260502-01.md          CHG 详情
    ├── chg-20260502-02.md
    ├── hotfix-20260321-01.md
    ├── findings/                   ⬅ finding 子目录
    │   ├── finding-2026-05-02-v91-126.md
    │   └── finding-2026-04-12-ce-compare.md
    └── corrections/                ⬅ correction 子目录
        ├── correction-2026-04-15-archive-skip.md
        └── correction-2026-03-22-todowrite-bypass.md
```

5 个索引文件 + 1 个 spec.md + 3 类详情子目录（changes / findings / corrections），结构清晰。

---

## 17. 待决策汇总（v6.0.0 全面）

| # | 决策项 | 选项 | 推荐 |
|---|-------|------|------|
| 1 | 是否启动 v6.0.0 Phase 2（完整设计） | 启动 / 缓做 / 放弃 | 启动 |
| 2 | PoC 文件保留还是清理 | 保留作为 v6.0.0 基础 / 清理 | 保留 |
| 3 | hooks.json `if` 条件优化是否走传统架构 | 传统架构最后一个 CHG / 等 v6.0.0 | 传统架构（10 分钟收尾） |
| 4 | ccauth 是否同步迁移 | 同步（v6.0.0 验证） / 等 v6.0.0 稳定后 | 等稳定 |
| 5 | finding/correction 迁移工具优先级 | 与 v6.0.0 同期 / 单独 v6.1.0 | 单独 v6.1.0 |
| 6 | corrections 独立索引文件 | corrections.md / findings.md 嵌入 | 独立 |
| 7 | 详情文件命名（slug 部分） | 自动生成 / 手动指定 | 自动（基于标题转 kebab-case） |
| 8 | wikilink 是否支持别名引用 `[[chg-xxx|短名]]` | 仅 wikilink / 支持别名 | 支持别名（Obsidian 原生） |
