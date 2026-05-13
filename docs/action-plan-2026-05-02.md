# PACEflow 行动项规划 2026-05-02

> **生成日期**：2026-05-02
> **当前执行版本**：PACEflow v6.0.55（原始调研输入：PACEflow v5.1.4）
> **上游调研版本**：Claude Code v2.1.126（后续本机复核至 v2.1.139）
> **触发**：用户告知 Claude Code 升级到 2.1.126，PACEflow 已久未升级，需调研增量

---

## 0. 文档说明

本文档汇总两轮调研（v2.1.76→v2.1.90 + v2.1.91→v2.1.126）+ 本次会话两项实测（subagent 工具调用 + pre-compact.js 当前状态）的所有行动项，按优先级分级整理，包括 `updatedToolOutput` 三种用法和 subagent 分流 artifact 更新的设计方案。

文档与 findings.md 的关系：
- findings.md 第 8 行索引 + 详情段落是**调研记录**（含原始证据和官方引用）
- 本文档是**行动项视图**（基于调研得出的可执行计划）
- 任何 CHG 启动后，对应行动项移到 `task.md` + `implementation_plan.md`

### 0.1 当前执行视图（2026-05-12，v6.0.55）

本节覆盖原 v5.2 行动项优先级。下方旧章节保留为历史背景，不再作为当前执行顺序的权威来源。

当前依据：

- `docs/claude-code-2.1.76-2.1.131-paceflow-evaluation.md`
- `docs/claude-code-2.1.76-2.1.131-validation-report.md`
- Claude Code v2.1.139 changelog / hooks reference：新增 hook `args: string[]` exec form 与 `PostToolUse continueOnBlock` 配置
- GitHub issue 风险筛查（worktree、hooks、plugins、PreToolUse、SubagentStop、FileChanged/CwdChanged）
- v6 当前代码审查：`plugin/hooks/pace-utils.js`、`plugin/hooks/pre-tool-use.js`、`plugin/hooks/session-start.js`、`plugin/hooks/task-list-sync.js`

执行状态（v6.0.55）：

- P0-20260506-01 / P0-20260506-02：已完成。
- P1-20260506-01 / P1-20260506-02 / P1-20260506-03 / P1-20260506-04 / P1-20260506-05：已完成。
- P1-POC-05 已在 v6.0.16 落地；v6.0.17 修复首次测试前审计发现的选择值容错与非 git stderr 噪音；v6.0.18 将选择提示从 SessionStart 移到真正动手前的 PreToolUse 阶段；v6.0.27 吸收调研报告中低风险 P1：SubagentStop 报告协议观察、PostToolUseFailure 恢复提示、SessionStart 输出大小保护与 compact/PreCompact 继承测试；v6.0.28 修复审计确认的非设计缺口；v6.0.29 清理 `audit` 发布面并修正文档口径；v6.0.30 增加 v5→v6 半自动迁移保护；v6.0.31 增加 session_id 日志串联与项目级 artifact-writer 写锁；v6.0.32 修复 Agent 工具失败时写锁释放链路；v6.0.33 修复 production Smoke0-5 暴露的锁保护与噪声问题；v6.0.34 修复全面审计确认的路径规范化、worktree runtime、vault env fail-closed、Stop 降级计数与 agent/skill 契约缺口；v6.0.35 拆分 plugin runtime root，marketplace 只发布 `plugin/` 下的运行时资产；v6.0.36 修复 2026-05-09 审计确认项：findings 日期差、Stop walkthrough 噪声、SessionStart walkthrough 最近记录截断、PostToolUse 死分支和文档/模板一致性；v6.0.37 修复二轮审计确认项：PreCompact native plan 项目过滤、Bash 间接写 artifact 保护与 bridge/template 说明收敛；v6.0.38 完成 r2 后续代码质量收尾：PostToolUse per-CHG warning 节流、artifact-root 输入截断、logger lock stale 阈值调整与 artifact mutation helper 抽取；v6.0.39 同步 Claude Code native build 工具面变化：`Glob/Grep` 可能不可用时，skill/smoke 改用 Bash `find` / `rg` / `grep` fallback 口径；v6.0.40 修复 Smoke4 暴露的 legacy v5 迁移提示歧义，明确被阻止的工具未落盘、dry-run 后二次确认、迁移后仍需重试原始代码任务；v6.0.41 修复 Smoke6 暴露的主 session `Edit/MultiEdit` 直接修改 artifact 绕过；v6.0.42 加固 v5 迁移脚本的多 ARCHIVE/CRLF 真实 vault 兼容性；v6.0.43 修复 hook 拦截提示缺 artifact 根目录与 legacy 手动 mkdir changes/ 绕过；v6.0.44 优化 v5 迁移归档区可读性，旧 frontmatter 转为历史 YAML 代码块，避免误读为第二个活动 frontmatter，并让 `--force` 重跑复用已有 `.v5-backup` 而不覆盖备份；v6.0.45 修复 native plan 桥接 Step 5 漏写 `.pace/synced-plans` 的 dogfood 缺口，hook/skill 明确宿主项目 runtime 路径与幂等 basename 写入；v6.0.46 补齐 P2 agent fixture 与 release sanity：Phase C 扩到 close/archive/finding/correction 正向 contract，单元测试覆盖 manifest 版本一致性和 plugin runtime root 文件面；v6.0.47 将 artifact-writer 并发控制从 Agent 生命周期项目级锁改为 hook ID reservation + 写入阶段 resource lock；v6.0.48 修复 Smoke1 暴露的 subagent 无法可靠接收 `PreToolUse:Agent additionalContext` 问题，`create-chg` / `record-correction` 首次派遣改为预留编号后 deny，要求主 session 带 `reserved-id` / `reserved-file` 重派。
- v6.0.49 补齐 hook deny 与 SessionStart 的 Paceflow skill 入口提示；v6.0.50 收紧 CHG 粒度语义并新增 `reserve-artifact-id.js` helper，使主 session 可在首次 artifact-writer 派遣前确定性预留编号，减少 production smoke 中的可预见重试。
- v6.0.52 修复 v6.0.51 Smoke1-6 暴露的 P0/P1：最小 v5 fixture 迁移漏检、helper 路径/未知参数误导、close/archive 半归档恢复、approve-and-start 语义、stale-read 指引、root 选择后 helper 顺序、implementation_plan 模板占位、worktree 跨 session Stop/Agent owner 归属，以及 worktree 中误把 artifact_dir 当普通项目根写宿主文件。
- v6.0.53 收紧 worktree owner 边界：SessionStart/PreCompact owner-aware，foreign owner CHG 在活跃区注入中折叠且不计入当前 session 任务列表；Stop 对 foreign progress 状态降噪但仍阻断结构不一致；代码阶段工具调用刷新 owner heartbeat；update/close/archive 必须显式 target；close/archive Agent 只有目标离开活跃索引后才标记 owner closed。
- v6.0.54 修复 walkthrough worktree 可读性缺口：close/archive 写 `walkthrough.md` 时同步保留 task/implementation 索引行中的 `[worktree:: ...] [branch:: ...]`；PostToolUse/Stop 机械校验 walkthrough 行与索引上下文一致。
- v6.0.55 修复 v6.0.54 Smoke3/4 后续缺口：首次 root-choice SessionStart 输出当前 reserve helper 命令；helper 未知参数明确拒绝 `--artifact-dir` / `--artifact-root` / `--project-dir`；当前 session owner 的非代码项目写入也进入 C/E gate，foreign fresh owner 不阻断普通非代码写入但结构损坏仍全局阻断；SubagentStop 在 close/archive 已离开活跃索引后兜底标记 owner closed；legacy/artifact 信号的 SessionStart skill 入口提前。
- v6.0.51 完成 `pre-tool-use.js` 结构拆分：Bash guard、artifact-writer Agent lifecycle guard、marker/direct artifact mutation guard 下沉到 `plugin/hooks/pre-tool-use/*.js`，主 hook 保留路由、stdout 输出与日志顺序。
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
| P1-20260507-03 | ✅ v6.0.27 | SessionStart 输出大小保护 | 过大 hook 输出可能无法完整注入，导致启动上下文丢失且不易察觉 | `hooks/session-start.js`、`tests/test-hooks-e2e.js` | SessionStart stdout 在 50KB 前截断并提示 Read artifact 文件；日志记录 `output_bytes` 与 `truncated` |
| P1-20260507-04 | ✅ v6.0.27 | 5.1.4 生命周期能力继承测试补齐 | v6 多次重构后必须明确验证 SessionStart、compact 后注入、PreCompact 快照、StopFailure 等 v5.1.4 功能仍在 | `tests/test-hooks-e2e.js`、`tests/test-pace-utils.js` | startup 注入 v6 artifact + artifact_dir；compact 消费快照并注入 CHG 完成检查 / close-chg 提示；PreCompact 记录 activeChanges/runtime/findings/walkthrough；StopFailure 仍记录 API 中断；stdin parser 支持 subagent 字段 |
| P1-20260507-05 | ✅ v6.0.27 | `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` 兼容性回归 | Claude Code 可清理子进程 env；PaceFlow 不应只依赖 vault env 恢复本地项目 artifact 路由 | `tests/test-hooks-e2e.js` | scrub 场景下，即使 `PACE_VAULT_PATH` 不可用，项目级 `.pace/artifact-root=local` 仍可让 SessionStart 恢复本地 artifact 路由并懒创建模板 |
| P1-20260508-01 | ✅ v6.0.28 | 修复 v6.0.27 audit 确认缺口 | `close-chg` prompt 门控未强制 `complete-open-tasks:true`；verified-date 逻辑分叉；compact snapshot null、knowledge 时间戳示例、hook 数量文档存在小缺口；`ConfigChange` 对 plugin 安装链路无保护价值 | `hooks/**`、`skills/pace-knowledge/SKILL.md`、`README.md`、`REFERENCE.md`、`tests/**` | close-chg 缺 `complete-open-tasks:true` 被 deny；verified-date 使用共享 helper；`ConfigChange` / `config-guard` 从发布面移除 |
| P1-20260508-02 | ✅ v6.0.29 | 清理 `audit` 发布面与 ticket02 文档口径 | `audit` 是 PaceFlow 内部审计流程，不是用户项目 skill；README PreCompact I/O、artifact-writer spec ARCHIVE 范围、action-plan/guidebook 历史状态描述与当前实现不一致 | `hooks/pace-utils.js`、`skills/pace-knowledge/SKILL.md`、`internal/skills/audit/**`、`README.md`、`REFERENCE.md`、`agent-references/artifact-writer-spec.md`、`docs/**` | marketplace 发布 skill 减为 4；内部审计资料保留在 `internal/skills/audit`；文档与实际 hook/template 对齐 |
| P1-20260508-03 | ✅ v6.0.30 | v5→v6 半自动迁移保护 | v5 用户升级后旧 vault 只有根 artifact 文件、没有 `changes/`；若直接懒创建 v6 基础结构，会把旧 v5 活跃内容与新 v6 详情模型混在一起 | `hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`hooks/session-start.js`、`migrate/batch-archive-v5.js`、`README.md`、`tests/**` | 检测 legacy v5 artifact 时先要求 AskUserQuestion + dry-run；用户确认前不创建 `changes/`；迁移脚本默认拒绝重复迁移或覆盖 `.v5-backup` |
| P1-20260508-04 | ✅ v6.0.31 | session_id 日志串联与 artifact-writer 项目级写锁 | 多 worktree / 多 session 并发派 `artifact-writer` 时可能同时分配 CHG-ID、抢写索引或归档同一 artifact | `hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`hooks/subagent-stop.js`、`agent-references/**`、`skills/artifact-management/**`、`README.md`、`tests/**` | `logEntry` 自动带 `sid`；`artifact-writer.lock` 落在宿主项目 `.pace/`，真实 git worktree 共享锁；无锁的 artifact-writer 写 artifact 被 deny；SubagentStop 释放锁；`T-NNN` 明确为 CHG/HOTFIX 局部编号 |
| P1-20260508-05 | ✅ v6.0.32 | Agent 工具失败立即释放 artifact-writer 写锁 | v6.0.31 代码已支持 `PostToolUseFailure:Agent` 释放锁，但 `hooks.json` matcher 未覆盖 `Agent`，Agent 工具失败时锁可能残留到 TTL | `hooks/hooks.json`、`hooks/post-tool-use-failure.js`、`tests/test-hooks-e2e.js`、`README.md` | `PostToolUseFailure` matcher 为 `Write\|Edit\|MultiEdit\|Bash\|Agent`；新增 E2E 覆盖 Agent 失败释放锁；安装配置测试覆盖 matcher |
| P1-20260508-06 | ✅ v6.0.35 | 拆分 plugin runtime root | marketplace `source:"./"` 会把 docs/tests/internal/tickets 等开发资料一起安装到 plugin cache，污染用户运行时目录 | `.claude-plugin/marketplace.json`、`plugin/**`、`tests/test-hooks-e2e.js`、`tests/test-pace-utils.js`、`tests/agent-tests/**`、`README.md`、`REFERENCE.md`、`internal/skills/audit/**` | marketplace `source` 改为 `./plugin`；运行时资产移动到 `plugin/`；根目录保留开发资料；测试和审计 skill 改读 `plugin/**` |
| P1-20260509-01 | ✅ v6.0.38 | r2 代码质量收尾 | PostToolUse 状态类提醒会在同一会话反复提示；logger lock 5s stale 阈值偏短；`PACE_ARTIFACT_ROOT` 超长输入未限长；pre-tool-use artifact mutation 条件分散 | `hooks/post-tool-use.js`、`hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`tests/test-hooks-e2e.js`、`tests/test-pace-utils.js` | 同一 CHG 的 status mismatch / missing verify / blocked task 提醒按 session 去重且 SessionStart 清理；logger lock stale 阈值 30s；artifact-root 选择值截断到 4096 字符；artifact mutation 判定 helper 化 |
| P1-20260510-01 | ✅ v6.0.50 | 收紧 CHG 粒度语义并新增 reserved-id helper | Smoke1 显示主 session 已读取 skill 后仍稳定经历 artifact-root、reserved-id、approve/close 缺字段等重试；同时模型把一个连续 CHG 的 T-001/T-002 完成拆成多次 `update-status`，把 artifact 当逐步项目管理看板 | `hooks/reserve-artifact-id.js`、`hooks/pre-tool-use.js`、`hooks/stop.js`、`skills/**`、`agents/**`、`agent-references/**`、`tests/test-hooks-e2e.js`、`README.md` | 主 session 可先运行 helper 预留 `reserved-id`，首次 `create-chg`/`record-correction` 不再必须先 deny；skill/agent/hook 统一声明 CHG 是连续执行、可验证、可关闭的最小变更单元，`update-status` 只用于暂停/阻塞/跳过/跨 session/长任务可见性，默认用 `close-chg complete-open-tasks:true` 收口 |
| P1-20260512-01 | ✅ v6.0.52 | Smoke1-6 修复与 worktree owner | v6.0.51 production smoke 暴露最小 v5 未识别、helper 路径搜索旧 cache、`--artifact-dir` 静默忽略、close/archive 半归档、worktree session 互相 Stop 阻断、artifact_dir 被误当普通项目根等问题 | `hooks/pace-utils.js`、`hooks/pre-tool-use.js`、`hooks/post-tool-use.js`、`hooks/stop.js`、`hooks/reserve-artifact-id.js`、`agents/**`、`agent-references/**`、`skills/**`、`tests/**` | 最小 v5 fixture fail-closed；helper 输出 execution-context 且未知参数 fail-fast；根索引缺 ARCHIVE 时禁止先归档详情；`.pace/change-owners` 让 Stop/Agent gate owner-aware；worktree 中写宿主非 artifact 普通文件被阻止并提示当前 worktree 路径 |
| P1-20260512-02 | ✅ v6.0.53 | worktree owner 边界收尾 | v6.0.52 后继续审计发现：SessionStart 仍把 foreign running CHG 注入当前上下文并计入当前任务列表；owner TTL 过期不等于 worktree 放弃任务；代码阶段无 heartbeat；Stop 跳过 foreign-fresh 时可能放过结构不一致；Agent owner gate 从正文 fallback CHG-ID 可能误判；close/archive Agent 返回后过早标记 owner closed | `hooks/session-start.js`、`hooks/pre-compact.js`、`hooks/pre-tool-use.js`、`hooks/post-tool-use.js`、`hooks/stop.js`、`hooks/pace-utils.js`、`skills/**`、`tests/**` | SessionStart/compact owner-aware；foreign owner CHG 在 `task.md` / `implementation_plan.md` 活跃区注入中折叠，只显示为其他 worktree/session 且不计入当前任务列表；Stop 对 foreign running/closing/stale 降噪但结构不一致仍硬阻断；Pre/PostToolUse 对当前 session code/Bash 活动刷新 owner；update/close/archive 缺 target 被 deny，skill 表格同步显式 target；close/archive 仅目标离开活跃索引后 owner closed |
| P1-20260512-03 | ✅ v6.0.54 | walkthrough worktree context | v6.0.52/53 中 `create-chg` 已把 `[worktree:: ...] [branch:: ...]` 写入 `task.md` / `implementation_plan.md`，但 `close-chg` / `archive-chg` 写 `walkthrough.md` 时没有同步，导致完成记录无法直接区分 host/worktree 来源 | `hooks/pace-utils.js`、`agent-references/**`、`skills/artifact-management/**`、`tests/test-hooks-e2e.js`、`README.md` | walkthrough 仍保持 3 列表格，但完成内容列追加同一组 `[worktree:: ...] [branch:: ...]`；已有行缺上下文时 close/archive 应补齐；Stop/PostToolUse 机械检查 walkthrough 行与 task/implementation 索引上下文一致 |
| P1-20260512-04 | ✅ v6.0.55 | Smoke3/4 后续 gate 与 helper 入口 | v6.0.54 Smoke3/4 继续暴露：root-choice SessionStart 没给 helper 绝对命令、helper 未知参数文案不完整、host session owner planned CHG 后仍能写 README、artifact-writer close 后 owner 运行态停在 closing、legacy/artifact 信号下 skill 入口不够靠前 | `hooks/session-start.js`、`hooks/pre-tool-use.js`、`hooks/subagent-stop.js`、`hooks/reserve-artifact-id.js`、`hooks/pace-utils.js`、`skills/**`、`tests/**` | root-choice/legacy/artifact 信号提前提示 workflow skill 与当前 reserve helper；helper 明确拒绝 `--artifact-dir` / `--artifact-root` / `--project-dir`；当前 session owner 的非代码写入也进 C/E gate，foreign fresh 不阻断普通非代码写入但结构损坏仍阻断；SubagentStop 对已归档 close/archive 兜底标记 owner closed |
| P2-20260511-01 | ✅ v6.0.51 | 拆分 `pre-tool-use.js` guard 模块 | `pre-tool-use.js` 同时承担 Bash 写保护、artifact root/迁移、Agent 生命周期、marker gate、C/E 阶段门禁，审计成本高，后续改动容易误碰不相关逻辑 | `hooks/pre-tool-use.js`、`hooks/pre-tool-use/bash-guard.js`、`hooks/pre-tool-use/agent-lifecycle-guard.js`、`hooks/pre-tool-use/marker-guard.js`、`tests/**`、`README.md`、`REFERENCE.md` | Bash artifact/runtime-control 检测、artifact-writer prompt/lifecycle 检查、C/V marker 与直接 artifact mutation 判断已拆为 helper；主入口保持 gate 顺序、输出和日志责任不变；E2E/单元/安装/manifest 校验覆盖运行时子目录 |

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
| P2-POC-07 | v2.1.139 `hooks[].args` exec form | 对稳定性有直接价值：避免 shell 字符串中 `${CLAUDE_PLUGIN_ROOT}`、Windows 路径、空格路径和引号转义问题；当前 `plugin/hooks/hooks.json` 仍全部使用 shell `command` 字符串 | 建议优先做最小迁移 PoC：先改一个低风险 hook，确认 `args` 中 path placeholder 展开、stdin 传递、exit code/JSON stdout 语义不变；再整体迁移所有 hook 注册 |
| P2-POC-08 | v2.1.139 `PostToolUse continueOnBlock` | 对 PaceFlow 的 PostToolUse 状态提醒有潜在价值：可以把拦截/提醒原因喂回 Claude 并继续当前 turn，减少 close-chg 中间态、walkthrough 修复等场景的机械重试；但现有 PaceFlow PostToolUse 是 command hook，官方文档语境需先确认是否直接适用 | 先做隔离 PoC。若 command hook 可输出 `decision:"block"` 且 `continue:true` 继续 turn，则可把部分“需要模型立即修正但不应结束 turn”的 PostToolUse warning 升级为 continue block；若只支持 prompt/agent hook 配置，则暂不改当前架构 |
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

最近一次验证结果（v6.0.55）：

```bash
for f in plugin/hooks/*.js plugin/hooks/pre-tool-use/*.js plugin/migrate/*.js; do node --check "$f"; done  # PASS
node tests/test-hooks-e2e.js                         # 168/168 PASS
node tests/test-pace-utils.js                        # 120/120 PASS
node tests/test-install.js                           # 26/26 PASS
node tests/agent-tests/run-tests.js dummy            # PASS
claude plugin validate ./plugin                      # PASS
git diff --check                                     # PASS
```

当前本机 Claude Code：

```text
2.1.138 (Claude Code)
```

本机已复核到 `2.1.138`；2026-05-12 已补查 Claude Code `2.1.139` changelog 中的 hook `args: string[]` 与 `PostToolUse continueOnBlock`。当前本机二进制仍是 `2.1.138`，因此这两项先登记为 PoC，需在安装 `2.1.139+` 后做真实 runtime 验证。当前 smoke 暴露的问题仍来自 PaceFlow 提示/门禁边界，而不是需要改变既有 PACEflow hook/task 决策的 Claude Code 行为。

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
| P1 | Installed-plugin production smoke | ✅ v6.0.54 Smoke1-6 已复跑并记录；worktree walkthrough context 已补齐。本轮 v6.0.55 改动集中在 helper 入口、当前 owner 非代码 C/E gate、SubagentStop owner closed 兜底与 skill 入口提示 | 发新版或改 hook/agent runtime 时按 `docs/production-smoke-v6.0.55.md` 复跑：root-choice vault/local helper、current-owner README/文档 C/E gate、foreign fresh worktree 并发、close/archive owner closed |
| P1 | 真实 v5 vault 副本迁移 rehearsal | ✅ v6.0.42 已用 `ccauth` Obsidian v5 vault 副本完成 dry-run + 正式迁移 rehearsal；脚本兼容 legacy 文件内多个 ARCHIVE 历史边界与 CRLF，迁移后每个主 artifact 仅保留 1 个 v6 标准 ARCHIVE，`.v5-backup` 与 `changes/findings`、`changes/corrections` 正常生成 | 不直接迁移 live vault；后续真实迁移前仍先复制 rehearsal 或至少 dry-run + 用户二次确认 |
| P1-design | close-chg review gate 设计评估 | GitHub issue #3 提出 `REVIEWED` / invariants / red-evidence / protocol checklist。讨论结论：review gate 有潜在高收益，但触发频率与机械边界未定；若设计成“每次 close 都提示主 session 自行判断”，会退化为提示工程和繁琐流程 | 用户确认当前先不做实现。保留设计备忘，后续只有在真实项目继续暴露 review 漏洞时，再设计低摩擦 close 前 review evidence；hook 只检查 evidence 字段存在和 P0/P1 处置格式，不判断 review 内容真伪 |
| P2 | 当前 Claude Code `/plan` bridge production 测试 | ✅ 已 dogfood 真实 native `/plan` UX；v6.0.45 修复 bridge 后漏写 `.pace/synced-plans`；后续新增 `hooks/sync-plan.js` helper，bridge 成功后由 helper 幂等写入项目 runtime `synced-plans`，worktree 场景写宿主 `.pace` | 后续按 `docs/production-smoke-v6.0.48.md` Smoke 6 做最小回归：native plan approve 后必须先 bridge 为 `create-chg`，并运行 sync-plan helper 写入 `.pace/synced-plans`，避免重复提醒同一 plan |
| P2 | Agent fixture coverage 扩充 | ✅ v6.0.46 已补 `tc-c3-close-chg-success`、`tc-c4-archive-chg-success`、`tc-c5-record-finding-success`、`tc-c6-record-correction-dual-write`；全量 baseline alias 更新为 29 case | 后续真实 baseline 失败时按 case 定位 agent/spec，而不是继续扩大 fixture 面 |
| P2 | Production smoke 文档更新 | ✅ v6.0.41 已更新 `docs/production-smoke-v6.0.41.md`；v6.0.48/51 已新增 focused smoke；v6.0.55 已新增 `docs/production-smoke-v6.0.55.md`，覆盖 helper 入口、非代码 C/E、worktree foreign owner 与 owner cleanup | 后续版本按 v6.0.55 focused smoke 复跑关键链路；只有大改生命周期语义时再扩展全量手册 |
| P2 | 未跟踪 ticket / 仓库门面清理 | ✅ 已将根目录旧 `ticket*.md` 审计材料归档到 `internal/audit-tickets/`；本地 deprecated `migrate-artifacts.js` 已移出根目录并继续由 `.gitignore` 排除；根目录只保留 public docs、plugin/test 入口与少量本地开发工具 | 后续新审计材料直接放 `docs/audits/` 或 `internal/audit-tickets/`；不要再把临时 ticket 放仓库根目录；保留 marketplace `source: ./plugin` 的发布面隔离 |
| P2-hardening | Agent 失败锁释放兜底 | ✅ v6.0.47 已被 resource lock 架构替代：Agent 启动不再持项目级锁；PostToolUseFailure:Agent / SubagentStop 会清理当前 owner 的残留 resource lock 与 reservation | 后续只需观察真实日志中是否还有 owner 缺失导致 TTL 兜底；不得释放 owner-mismatch 锁 |
| P2-hardening | Claude Code v2.1.139 hook runtime modernization | v2.1.139 新增 `args: string[]` exec form，可替代当前 `command: "node '${CLAUDE_PLUGIN_ROOT}/hooks/*.js'"` shell 字符串；同时新增 `PostToolUse continueOnBlock`，可能降低 PostToolUse 提醒导致的 turn 中断/重试 | 先做小 PoC：1）把 `hooks/hooks.json` 的单个 hook 改为 `command:"node", args:["${CLAUDE_PLUGIN_ROOT}/hooks/xxx.js"]` 并跑 `claude plugin validate` + installed smoke，确认 plugin placeholder 在 args 中可展开；2）验证 command PostToolUse 是否可用 `decision:"block" + continue:true` 等价获得 continueOnBlock 体验。若只对 prompt/agent hooks 生效，则不迁移现有 command PostToolUse |
| P2 | Release sanity 覆盖迁移脚本 | ✅ v6.0.46 已在 `tests/test-pace-utils.js` 机械检查 plugin manifest 与 marketplace version 一致，且 plugin runtime root 不含 `docs/`、`tests/`、`internal/`、`ticket*` 等开发资料 | 后续 release 前跑 `node tests/test-pace-utils.js` 即可覆盖 |
| P3 | Claude 任务列表事件兼容说明 | `TaskCreate|TaskUpdate` matcher 是 Claude Code 任务列表事件兼容层，不应被视为唯一权威 | 在 docs / hooks 注释中标注实验性兼容；PACE 任务权威仍是 `changes/<id>.md ## 任务清单` |
| P3 | 非锁 runtime flag 并发限制 | `.pace/stop-block-count`、`task-list-used`、`degraded` 等运行态 flag 无原子写保护 | 记录为已知限制：多实例并发同项目时只可能影响提示/降级时序，不影响 artifact 内容正确性；除非真实日志显示问题，否则不加锁 |
| P3-refactor | `pre-tool-use.js` 拆分 | ✅ v6.0.51 已完成首轮拆分：Bash guard、marker gate、agent lifecycle prompt gate 已移入 `plugin/hooks/pre-tool-use/*.js` | 不作为当前剩余缺口；后续只有 `pace-utils.js` 或主入口继续膨胀并造成实际审计痛点时，再单独设计小步重构 |

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

#### 0.1.10e CHG 粒度与 reserved-id helper 设计（2026-05-10）

生产 Smoke1 暴露两类体验问题：

1. `reserved-id` 依赖“首次 Agent 派遣被 deny 后重派”，即使主 session 已调用 `paceflow:pace-workflow`，仍会稳定多一次失败。
2. 模型倾向把同一 CHG 内的每个 T-NNN 完成写成一次 `update-status` agent 调用，导致一个本应连续完成的变更被拆成多次 artifact 更新。

当前决策：

- CHG 不是大计划容器，而是连续执行、可验证、可关闭的最小变更单元。
- 大计划可以存在，但应拆成多个 CHG。例如一个功能横跨前端、后端、存储、迁移、文档时，不应塞进一个 CHG；应拆为数据结构/迁移、后端接口、前端调用、文档/配置等可独立完成和验证的 CHG。
- 每个 CHG 内可以有多个 T-NNN，但这些任务应服务于同一个闭环，且默认连续完成。
- Artifact 是流程恢复和审计机制，不是逐步项目管理看板。连续执行的 CHG 不需要频繁更新 task 状态；主路径是 create-chg → approve-and-start → 写代码/测试 → 运行并读取验证 → close-chg complete-open-tasks:true。
- `update-status` 降级为例外路径：暂停、阻塞、跳过、跨 session、长任务进度可见性、或多 CHG/worktree 并发时需要明确记录中间状态。
- Stop hook 判断因此更简单：一个 active CHG 要么继续执行，要么验证通过后 close。worktree 并发也更清晰：不同 worktree 通常操作不同 CHG。walkthrough 记录完成的变更单元，而不是半成品任务流。

reserved-id helper 设计：

- 新增 `plugin/hooks/reserve-artifact-id.js`，主 session 在派 `artifact-writer create-chg` 或 `record-correction` 前运行：

```bash
node "<SessionStart / PreToolUse 输出的 reserve-artifact-id.js 绝对路径>" --operation create-chg
node "<SessionStart / PreToolUse 输出的 reserve-artifact-id.js 绝对路径>" --operation record-correction
```

- helper 使用当前 Claude Code session 创建 session-scoped reservation，输出可直接放到 Agent prompt 顶部的字段：`artifact_dir`、`operation`、`reserved-id`、`reserved-file` 或 `reserved-file-prefix`。
- root 未选择时只输出 artifact-root AskUserQuestion 提示，不创建 `.pace/`、`changes/` 或 Obsidian 空项目目录。
- 检测到 legacy v5 artifact 时只输出迁移提示，不懒创建 v6 模板、不预留 ID。
- root 已选择且无 v5 阻塞时，helper 可以幂等懒创建 v6 基础模板，然后预留编号。
- 默认复用同 session 尚未消费的同 operation reservation，避免重复运行 helper 烧号；确实需要多个 CHG 时使用 `--new`。
- PreToolUse 原有 missing-reserved deny 仍保留为 fallback，避免旧模型/旧 skill 路径失去机械兜底。

---

#### 0.1.10e1 v6.0.50 production Smoke1 验证（2026-05-10）

Smoke1（CHG 粒度 + reserved-id helper）真实运行结论（sid=cae36fee-d1b6-4a07-bab2-e9b900dcb100）：

核心链路通过：
- SessionStart 正确注入 `Skill(paceflow:pace-workflow)` 提示。
- 首次直接代码修改被 artifact-root 选择拦截（符合预期）。
- 用户选择 `local` 后，主 session 正确运行 `reserve-artifact-id.js`。
- `create-chg` 首次 Agent 派遣直接 PASS（reserved-id: CHG-20260510-01），无二次 reserved-id 失败。
- C 阶段使用 `approve-and-start` 合并批准+开始。
- E 阶段未发送任何 `update-status`——连续执行生效。
- 验证 `npm test` 通过后，直接 `close-chg complete-open-tasks:true` 收口并归档。
- 所有 artifacts 终态正确：详情 `status: archived`、两个任务 `[x]`、`<!-- APPROVED -->` / `<!-- VERIFIED -->` 齐全；`task.md` / `implementation_plan.md` 活跃区为空，ARCHIVE 下有 `[x]` 索引；`walkthrough.md` 已写入。Stop hook clean pass。

发现的小问题：
1. AskUserQuestion 首次失败：模型只给了 1 个 option（需 ≥2），重试为"批准并开始 / 暂不执行"后成功。skill 可明确"至少给两个选项"。
2. artifact-writer 报告标题前缀 warning：`全部成功。编译报告。` / `全部操作完成。生成报告。` 出现在 `## artifact-writer 报告` 之前。SubagentStop 记录 `title-prefix` warning，功能无损。
3. close-chg 多步编辑中间出现短暂 PostToolUse warning（completed 但缺 verified-date、verified 但仍在活跃索引）。终态正确，可考虑后续降低瞬时状态噪声。


#### 0.1.10e2 v6.0.50 production Smoke3 验证（2026-05-11）

Smoke3（host + git worktree 并发 artifact resource lock）真实运行结论：

- Host session: `3283f6e5-96d2-4e14-abf0-c8b7737e2bfa`，cwd `/mnt/k/AI/paceflow-smoke-local`。
- Worktree session: `c46f37fc-c1b6-4425-9d8a-cb7517c04fd8`，cwd `/mnt/k/AI/paceflow-smoke-local-wt`。
- 两个 session 的 `SessionStart` 都正确路由到共享 artifact root `/mnt/k/AI/paceflow-smoke-local/`；这是预期的项目级 artifact 语义。
- Hook resource lock 没有出现抢锁/死锁/长等待；两个 CHG 详情文件分别使用 `detail:changes/chg-20260511-01.md`、`detail:changes/chg-20260511-02.md`，索引更新通过 `index:changes` 串行短锁保护。
- `CHG-20260511-01` 与 `CHG-20260511-02` 终态均为 `status: archived`，任务 `[x]`，`<!-- APPROVED -->` / `<!-- VERIFIED -->` 齐全；Stop hook 两个 session 均 PASS。

暴露的问题：

1. Worktree session 把业务文件 `branch-note.md` 写到了共享 artifact/root host 目录 `/mnt/k/AI/paceflow-smoke-local/branch-note.md`，而不是当前 worktree `/mnt/k/AI/paceflow-smoke-local-wt/branch-note.md`。这不是 artifact 分类 bug：`branch-note.md` 不属于 `task.md` / `implementation_plan.md` / `changes/**` 等 PaceFlow artifact，hook 放行非 artifact 写入符合职责边界。需要修的是 PaceFlow 文案边界：`artifact_dir` 只表示 PaceFlow artifact 根目录，不应被描述成普通项目文件的默认写入位置，也不应替主 session 定义代码、README、配置或业务文档路径规则。Smoke 验证脚本可单独检查 worktree 业务文件落点，但该检查不进入 hook 运行时门禁。
2. Host session 未在开始时调用 `paceflow:pace-workflow`，先直接 `Write README.md`，随后才尝试派 artifact-writer。由于 README.md 被视为非 artifact/非代码文件，hook 放行，导致“先创建 CHG 再执行”的用户语义没有被机械兜住。需评估是否对 PACE project 中的普通项目文件写入也增加轻量流程提醒，至少在用户显式要求“创建 CHG”时避免先写文件。
3. Host session 多次重试：首次 Agent 缺 `artifact_dir`；第二次缺 `reserved-id`；运行 `node "${CLAUDE_PLUGIN_ROOT}/hooks/reserve-artifact-id.js"` 时 Bash 子进程里 `CLAUDE_PLUGIN_ROOT` 为空，实际变成 `/hooks/reserve-artifact-id.js`；后续通过搜索 plugin cache 找到绝对路径才复用 `CHG-20260511-02`。需要让 SessionStart/skill/hook 输出可直接复制的绝对 helper 路径，或提供不依赖 `CLAUDE_PLUGIN_ROOT` 的 helper 调用方式。
4. Host session 首次 create-chg subagent 使用了无效 `status: open`，SubagentStop 只给 title-prefix warning，agent 自己失败后才重派 `status: planned`。这是模型字段执行问题，但说明 create-chg prompt/schema 仍可进一步收敛。
5. Host session 试图在未 `approve-and-start` 时直接 `close-chg`，先被 hook 拦缺 `verify-summary` / `walkthrough-summary`，补字段后又被 agent 拒绝缺 `<!-- APPROVED -->`。最终能自恢复，但体验上仍多一次失败；skill 需要更明确“用户直接执行指令可作为 approval evidence，但仍必须先派 approve-and-start，再 close-chg”。
6. `walkthrough.md` 两条新记录的 wikilink 错误：`[[new-branch-note-worktree-resource-lock-smoke]]`、`[[readme-host-resource-lock-smoke]]` 均无对应详情文件；正确应为 `[[chg-20260511-01]]`、`[[chg-20260511-02]]`。close-chg 报告声称 walkthrough wikilink 检查通过，说明当前 wikilink 校验没有覆盖 walkthrough 目标存在性，或 agent 自检报告不可信。需要 hook/测试补机械校验。
7. close-chg 多步编辑仍会在中间状态触发短暂 PostToolUse warning（completed 但未 verified、verified 但仍在活跃索引）。终态正确但日志噪声仍存在。

边界文案待修范围（2026-05-11 补充）：`plugin/skills/**/SKILL.md`、`plugin/agents/artifact-writer.md`、`plugin/hooks/session-start.js`、`plugin/hooks/pre-tool-use.js`、`plugin/hooks/reserve-artifact-id.js`、`plugin/hooks/pace-utils.js` 的用户可见提示里，凡是把 `artifact_dir` 推导成普通项目文件写入规则、默认 cwd/worktree 规则、或“不要写到某类非 artifact 目录”的内容，都应收敛为只定义 PaceFlow artifact：`task.md` / `implementation_plan.md` / `changes/**` / `walkthrough.md` / `findings.md` / `corrections.md`。`.pace/` 只保存配置/运行状态，不存 artifacts。非 artifact 文件路径不由 PaceFlow 文案定义。

文案审计补充（2026-05-11）：除路径边界外，hook/skill/agent 的用户可见文案还暴露了过多内部实现细节，应收敛为可执行指令。典型问题包括：`Claude Code 不会可靠地把 PreToolUse additionalContext 注入到 subagent 初始 prompt`、`当前 session 没有匹配的 hook reservation`、`PreToolUse:Agent 会先预留编号并 deny`、`hook resource lock` 等实现解释。主 session 需要的是确定动作：已预留编号则带字段重派；预留字段无效则重新运行 helper；写锁繁忙则等待后 Read 目标 artifact 再重试。不要把 hook 事件名、additionalContext 注入机制、fallback 机制、session/agent reservation 细节作为主要文案。`CLAUDE_PLUGIN_ROOT` 也不应作为主 session Bash 命令的唯一形式，因 production smoke 显示 Bash 子进程可能为空；hook/SessionStart/skill 应优先给出可直接运行的绝对 helper 路径或明确要求使用 hook 输出的 helper 命令。

本轮已确认的具体待修点：
- `pre-tool-use.js` 的 reserved-id deny 文案去掉 Claude Code/additionalContext 解释，只保留“已预留编号，重派并带字段”。
- `pre-tool-use.js` 的 artifact_dir deny 文案去掉 `docs/`、`cwd 可能只是代码工作目录` 等普通路径裁判语句。
- `artifact-writer.md` 与 `agent-references/artifact-writer-spec.md` 去掉 agent 自行解析 `$ARTIFACT_DIR` / fallback cwd 的口径，改为必须使用 prompt/hook 传入的 `artifact_dir`。
- `pace-utils.js` 的 `FORMAT_SNIPPETS.reserveHelper`、skills、agent-references 中的 helper 命令不再硬依赖 `${CLAUDE_PLUGIN_ROOT}`；改为 hook 输出绝对命令或 helper 路径。
- SessionStart / Stop / PostToolUse / ReserveID / skills 中的 artifact 根目录说明统一为完整 artifact 列表：`task.md` / `implementation_plan.md` / `changes/**` / `walkthrough.md` / `findings.md` / `corrections.md`。
- `walkthrough.md` wikilink 目标存在性需补机械校验，避免 agent 报告自称通过但写入 `[[slug]]` 而不是 `[[chg-*]]`。

全量文案复读结果（2026-05-11，覆盖 `plugin/.claude-plugin/plugin.json`、`plugin/hooks/**`、`plugin/agents/**`、`plugin/agent-references/**`、`plugin/skills/**`、`plugin/hooks/templates/**`、`plugin/migrate/**`）：

Claude Code 交叉审计补充（`docs/audits/audit-2026-05-11-paceflow-copy-out-of-scope.md`）：

- 高价值结论：当前文案噪声不是零散问题，而是两个结构性模式造成的：`appendArtifactDirHint()` 对过多 hook 输出无差别追加 artifact 根目录说明；deny 文案承担了“速成手册”职责，内联 schema、helper、迁移步骤、调试原因和恢复路径，导致主 session 容易把 PaceFlow artifact 规则误读成普通项目文件路径规则。
- 需纳入本轮 P1/P2 的增量：收紧 `post-tool-use-failure.js` 触发范围，避免只读 Bash 失败也注入 PaceFlow 写入恢复提示；`v5MigrationPromptMessage()` 与 `artifactRootChoiceMessage()` 瘦身，只输出阻断原因与下一步选择，不内联完整教学；`pre-tool-use.js` 对 `knowledge/`、`thoughts/` 写入的完整 frontmatter/正文模板应下沉到 `pace-knowledge` skill，hook 只做轻量提醒或机械拦截；`DENY_REDIRECT` 中“artifact 文件已迁移到 Obsidian vault”改为“当前 artifact_dir 是 Obsidian vault”；`reserve-artifact-id.js` 输出减少重复的 `.pace/` 科普和 prompt 教学。
- 需同步瘦身但保留语义的项：artifact-writer 报告标题严格性仍需要保留，但 agent prompt 不应列 14 种失败标题变体；SubagentStop/测试负责反馈即可。`.pace/locks` 等 runtime-control 保护可以保留，但用户可见文案应更短，详细 owner/resource/waitedMs 放日志即可。
- 下调或暂不作为 bug：`pace-bridge` 提到 native plan 文件名可能变化可保留为中性说明；`pace-knowledge` 的 Grep 缺失 fallback 属于工具兼容提示；agent 的 Edit-before-Read 规则是 Claude Code 工具约束，不能删除；emoji/G-9 不是功能阻断，但 G-9 章节号不应长期出现在通用 plugin 文案。

以下 P1/P2 是 2026-05-11 执行前清单；当前复核状态见后续“本轮落地结果”和“复核补充”。

P1 必修：
- helper 路径口径：`pace-utils.js` 的 `FORMAT_SNIPPETS.reserveHelper`、`artifact-management/SKILL.md`、`pace-workflow/SKILL.md`、`pace-bridge/SKILL.md`、`change-lifecycle.md`、`create-chg.md` 都把 `node "${CLAUDE_PLUGIN_ROOT}/hooks/reserve-artifact-id.js"` 当作主 session Bash 命令。Smoke3 已验证 Bash 子进程可能拿不到 `CLAUDE_PLUGIN_ROOT`，应由 hook 输出绝对 helper 路径/命令，skill 只要求“运行 hook 提供的 helper 命令”。
- artifact_dir 边界：`session-start.js`、`artifactDirRuntimeHint()`、`artifactRootChoiceMessage()`、`reserve-artifact-id.js` 输出、`artifact-management`/`pace-workflow` skill 多处只写 `task.md / changes/**`，或把 `artifact_dir` 描述成普通项目文件的写入依据。应统一写成“仅 PaceFlow artifacts：`task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` / `corrections.md` / `changes/**`”，并明确非 artifact 文件路径不由 PaceFlow 决定。
- 内部实现泄露：`reservationRequiredReason()`、`reservationExplicitMissingReason()`、`artifactResourceLockDenyReason()`、artifact-writer PASS additionalContext、`create-chg.md` 的 “PreToolUse:Agent 会先预留编号并 deny”、`reserve-artifact-id.js` 顶部注释/usage 中面向模型的 additionalContext/session reservation 解释，需要收敛为动作说明。可以保留日志里的 `resource/session/agent` 字段，但不要把实现机制作为主提示。
- agent artifact_dir 规则：`artifact-writer.md` 与 `artifact-writer-spec.md` 仍保留“优先 vault / worktree 归一 / fallback cwd”的 agent 解析口径。v6 当前应由主 session/hook 解析并显式传入 `artifact_dir`；agent 缺失或不匹配就失败/让主 session 重派，不自行 fallback。
- walkthrough 机械校验：`close-chg.md` 当前写 `[[<slug>]]`，实际 Smoke3 证明模型会用标题 slug。应改为目标详情 wikilink `[[chg-yyyymmdd-nn]]` / `[[hotfix-yyyymmdd-nn]]`，并在 hook/test 中机械校验 `walkthrough.md` 第 2 列 wikilink 与第 3 列 CHG-ID 对应详情文件存在。
- C→E→V 顺序提示：hook 已能拦截未批准 close，但 skills 仍可更明确“用户直接执行指令可作为 approval-evidence；仍必须先 `approve-and-start`，然后写代码/测试，最后 `close-chg`”。这能减少 Smoke3 里的无效重试。
- TaskSync 语义过严（Windows 实测，2026-05-11）：当项目只有 `docs/plans/*.md` Superpowers 计划文件、尚无 v6 `task.md` 时，`plugin/hooks/task-list-sync.js` 会对 `TaskCreate` / `TaskUpdate` / `TodoWrite` 直接 deny，提示先桥接 plan。这导致主 session “先建立任务清单” 连续报错，但真正需要硬拦的是后续代码/artifact 写入。Claude 内部任务列表是工作记忆，不是 PaceFlow artifact 权威；这里应改为 `additionalContext` 提醒（或只 log），让任务列表创建继续进行，同时保留 `Write/Edit/MultiEdit/Bash/Agent` 路径上的硬门禁。
- PostToolUse Superpowers 提醒范围过宽（Windows 实测，2026-05-11）：在存在 `docs/plans/*.md` 且 `task.md` 不存在时，`plugin/hooks/post-tool-use.js` 会在任意工具成功后调用 `isPaceProject(cwd)`，因此 Edit 纯审计文档 `docs/audits/*.md` 也会收到“检测到 PACE 激活信号（superpowers）但 task.md 不存在，请先创建 Artifact 文件”的提醒。这不应进入 hard/soft 流程提醒主路径；PostToolUse 只应对 artifact 写入、代码写入、或明确进入 PACE 流程的 Agent/bridge 操作提示，普通文档编辑应 log-only 或完全静默。

P2 可选优化：
- Smoke1 的 AskUserQuestion 失败可在 skill 示例里补“至少两个选项”；这不是 PaceFlow artifact 阻断 bug。
- close-chg 多步 Edit 产生的 PostToolUse 短暂 warning 是中间态噪声，终态正确；可后续做同 agent/同目标的短窗口节流。
- artifact-writer 报告标题前缀 warning 仍是 production 兼容问题，但 SubagentStop 只 warn 不 block，功能无损；不建议回到超长 prompt 追求 100% 标题一致。

确认可保留：
- `pace-bridge` 写 `.pace/synced-plans` 属于运行态，不是 artifact 存放位置越界。
- v5 migration 提示与 `batch-archive-v5.js` CLI 文案可以保留绝对脚本路径；这是用户实际要运行的迁移命令。
- Bash runtime-control deny 中提到 `.pace/locks` / `sequences` / `reservations` / `index-transactions` 是安全边界提示，允许保留，但可减少“resource lock”术语。
- `pace-knowledge` 关于 `Grep` 不可用时用 Bash `rg/grep/find` fallback 属于 Claude Code 工具兼容说明，不影响 artifact 边界。
- `superpowers-integration.md` 中的 `docs/plans/` 是 plan 文件约定，不是普通项目文件写入裁判；不属于本轮 artifact_dir 越界问题。

本轮落地结果（2026-05-11）：
- 已将 helper 口径收敛为 SessionStart/PreToolUse 输出绝对路径命令；skills/spec 不再要求主 session 依赖 `${CLAUDE_PLUGIN_ROOT}`。
- 已将 `artifact_dir` 文案收敛为只定义 PaceFlow artifacts：`task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` / `corrections.md` / `changes/**`；agent 不再自行 fallback cwd。
- 已瘦身 reserved-id、v5 migration、artifact-root choice、knowledge/thoughts、PostToolUseFailure 等 hook 用户可见文案；写锁繁忙、runtime-control 与首次选择/迁移提示仍保留必要操作信息，作为 P2 文案债继续观察。
- 已把 Superpowers plan + no task.md 的 `TaskCreate` / `TaskUpdate` / `TodoWrite` 从 deny 改成 additionalContext 提醒，Claude 任务列表继续作为工作记忆。
- 已把 `PostToolUse` 无 task.md 提醒范围收窄到代码写入或 Agent 操作，普通 `docs/audits/*.md` 编辑不再触发创建 artifact 提醒。
- 已补 AskUserQuestion 选项数量提示：需要批准确认时给 2-3 个互斥选项，不再只给单个确认选项。
- 已把 artifact-writer 多步收尾中的状态类 PostToolUse warning 降噪；最终一致性仍由 SubagentStop/Stop 兜底，非 artifact-writer 仍提示。
- 已补 `walkthrough.md` wikilink 机械校验，要求第 2 列 wikilink 指向第 3 列 CHG/HOTFIX 的详情 slug，例如 `[[chg-20260511-02]]`。
- 已补 create-chg 详情 frontmatter `status` 机械校验，拒绝 `status: open` 等非法值。
- 已完成 `pre-tool-use.js` 结构拆分：`bash-guard.js`、`agent-lifecycle-guard.js`、`marker-guard.js` 承接可纯函数化的 guard 判断；主入口保留 hook I/O、gate 顺序、日志和输出格式。

验证结果：
- `node tests/test-hooks-e2e.js`：149/149 PASS
- `node tests/test-pace-utils.js`：115/115 PASS
- `node tests/test-install.js`：26/26 PASS
- `claude plugin validate ./plugin`：PASS
- `git diff --check`：PASS

复核补充（2026-05-11，当前 HEAD 对照 `docs/audits/audit-2026-05-11-paceflow-copy-out-of-scope.md`）：
- 已关闭生产重试类问题：helper 绝对路径、TaskSync hard deny、PostToolUse 文档编辑噪声、PostToolUseFailure 只读 Bash 噪声、agent artifact_dir fallback、create-chg `status: open`、C→E→V 指引、walkthrough 错 slug 与缺 wikilink 机械校验。
- 运行时验证注意：若当前会话仍在编辑 `docs/audits/*.md` 后看到旧文案“请先创建 Artifact 文件”，先检查实际加载的 plugin cache 版本。已确认源码 v6.0.50 的 `post-tool-use.js` 通过 `isCodeFile` 守门修复该问题；旧现象来自会话仍加载 `~/.claude/plugins/cache/paceaitian-paceflow/paceflow/6.0.32/hooks/post-tool-use.js`。需升级/重装到 >= v6.0.50 并另开会话再做运行时验证。
- 刻意保留的取舍：`artifactDirRuntimeHint()` 仍会出现在阻断/恢复类输出中，因为真实生产曾出现“hook 拦截但没告诉 artifact 位置”的问题；当前文案已限定为 PaceFlow artifacts，不再裁判普通项目文件路径。若后续 smoke 仍觉得吵，再按调用点进一步收窄。
- 刻意保留的兼容说明：`pace-knowledge` 的 `Grep` fallback、`pace-bridge` 的 native plan 路径/文件名中性提示、agent 的 Edit-before-Read 规则、报告标题严格 H2 约束，均不是当前阻断 bug。
- 2026-05-11 本轮继续修复复审 2 C/D：Stop degraded 与 SessionStart 截断/compact 恢复文案改为中性动作提示；SessionStart 去掉 `G-9` 章节号、TaskCreate/TaskUpdate/TodoWrite 工具枚举、`readActive` 内部函数名；runtime-control 与 resource lock busy deny 不再贴 `.pace/locks` 等清单或 owner/lock path/waitedMs；SubagentStop 报告提醒改为中性“报告未能解析”；native plan bridge DENY/SessionStart 提示改为指向 `Skill(paceflow:pace-bridge)`；Stop 与 PreToolUse 的 C/E 提示不再内联 schema 字段表；update/close 指令删除报告前缀失败样例清单；PostToolUseFailure 扩展识别 `bash scripts/test.sh`、`./run-tests.sh`、`python -m pytest` 等自定义验证脚本。
- 复审 2 C/D 当前状态：二#1/二#2/二#3/二#5/二#6/二#8/二#9/一#8/三#1/三#5/三#6/四#3/四#5/四#6/四#8/四#10/D1 均已处理或下调为兼容说明；D2 仍作为生产 smoke 观察项，确认 TaskSync 从 hard deny 改为 hint 后主 session 是否会长期忽略 bridge hint；D3/D4 为正确性增强，无需跟进；D5 单行 helper 指令可接受。
- 仍可做的 P2 结构清理：`v5MigrationPromptMessage()` 与 `artifactRootChoiceMessage()` 仍偏“教学式 deny”，但迁移和首次选择都需要用户确认，当前保留脚本命令/AskUserQuestion 指引以保证安全；若 production UX 稳定，可再拆成短提示 + skill 详情。

结论：并发 resource lock 本身通过；本轮已修 `artifact_dir` 边界文案、helper 绝对路径、walkthrough wikilink 机械校验，并继续收敛复审 2 C/D 的运行时文案噪声。下一步可重跑 Smoke1/Smoke3 生产验证，同时观察 TaskSync hint 是否足够。

#### 0.1.10e3 v6.0.51 production Smoke1/2 语义观察（2026-05-11）

Smoke1/2（local create+close + direct artifact write protection）真实运行结论（sid=e7d244fb-93a0-4d31-b574-863526f8ab5c）：

- 核心链路通过：首次 artifact-root 选择为 `local`；主 session 运行 `reserve-artifact-id.js` 预留 `CHG-20260511-01`；`create-chg` 首次 Agent 直接 PASS；代码修改发生在 `approve-and-start` 之后；`npm test` 输出 `ok`；`close-chg complete-open-tasks:true` 将详情 `status` 推到 `archived`，写入 `<!-- APPROVED -->` / `<!-- VERIFIED -->`、`verified-date` / `archived-date`，并把 `task.md` / `implementation_plan.md` 索引移到 ARCHIVE 下方。
- Direct artifact write protection 通过：主 session 对 `task.md` 的 Bash append、Write、Edit 均被 hook 拦截，日志分别记录 `DENY_BASH_ARTIFACT`、`DENY_DIRECT_ARTIFACT_WRITE`、`DENY_DIRECT_ARTIFACT_EDIT`；`task.md` 未被污染，Stop hook clean pass。
- 语义观察：`approve-and-start` 当前只把传入的 `task-id`（本次为 `T-001`）标为 `[/]`，而同一 CHG 内的 `T-002` 仍保持 `[ ]`，最后由 `close-chg complete-open-tasks:true` 统一收口为 `[x]`。这不是功能 bug，且符合“artifact 不是实时看板；连续 CHG 默认最后统一收口”的设计。但 `task-id` 容易被主 session / 用户误读成“本次只开始 T-001”，从而诱导后续逐个 `update-status`。
- 后续可选优化：保留当前状态机，不建议把 `approve-and-start` 自动改成所有 T-NNN `[/]`；那会在暂停/跨 session 时制造更不准确的“全部进行中”。更合适的是收敛文案，把 `task-id` 明确称为“执行锚点 / first task anchor”：`approve-and-start` 批准并开始的是整个 CHG，`task-id` 只用于标记进入执行的起点任务；连续完成时仍由 `close-chg complete-open-tasks:true` 收口剩余 `[ ]` / `[/]` 任务。
- 非阻断噪声：首次 `create-chg` 的 artifact-writer 报告前出现 `All writes and edits succeeded. Now compile the report.`，SubagentStop 记录 `title-prefix` warning；功能无损，后续 update/close 报告均 PASS。

#### 0.1.10e4 v6.0.51 production Smoke3 并发观察（2026-05-11）

Smoke3（host + git worktree concurrent resource lock）真实运行结论（host sid=f3f1a8bf-a258-46c2-8e97-ff796e7f826f；worktree sid=21ffe076-512b-498e-a21d-7fb416f93b1d）：

- 最终状态通过：host 与 worktree 都解析到宿主 artifact root `/mnt/k/AI/paceflow-smoke-local/`；`task.md` / `implementation_plan.md` 活跃区清空，`CHG-20260511-01`、`CHG-20260511-02`、`CHG-20260511-03` 均在 ARCHIVE；`changes/chg-20260511-02.md` 与 `changes/chg-20260511-03.md` 均为 `status: archived`，含 `verified-date` / `archived-date` 与 `<!-- APPROVED -->` / `<!-- VERIFIED -->`；`.pace/locks`、`.pace/reservations`、`.pace/index-transactions` 无残留。
- Stop hook 跨 session 提醒不是功能 bug：host session 在 `21:00:52` Stop 时，worktree 的 `CHG-20260511-03` 已 `completed + verified` 但仍在活跃索引中，Stop hook 阻止退出是机械正确的。体验问题是它不知道另一个 session 的 close-chg 正在收尾，容易诱导 host session 重复派 close。后续可优化文案：若另一个 session 正在 close/归档，等待其完成后重试 Stop；仍存在再派 artifact-writer。
- `branch-note.md` 写到 host 目录是模型路径选择错误，不是 hook artifact 分类 bug：worktree cwd 为 `/mnt/k/AI/paceflow-smoke-local-wt`，但主 session 调用了 `Write /mnt/k/AI/paceflow-smoke-local/branch-note.md`；hook 记录 `PASS_V6_NON_CODE`，说明 `branch-note.md` 被正确视为非 PaceFlow artifact 并放行。PaceFlow 不应硬拦普通文件路径；后续只应在 smoke 文档/skill 文案中继续强调 `artifact_dir` 仅用于 PaceFlow artifacts，普通文件按用户路径和当前 cwd 判断。
- 并发归档出现的 `File has been modified since read` 不是 resource lock 失败：worktree close agent 先基于旧索引内容准备 Edit，期间 host close agent 在 `21:00:23/24` 已将 `CHG-20260511-02` 归档，Claude Code 的 Edit stale-read 前置校验在 `21:00:29` 拒绝了三个旧快照。worktree agent 重新 Read 后，在 `21:01:23/24` 成功获取 `index:changes` / `walkthrough` resource lock 并归档 `CHG-20260511-03`。后续可在 artifact-writer 指令中补充：遇到 stale-read 立即重新 Read 目标 artifact 并重试，不要解释为 hook 锁失败。
- 设计方案：并发 worktree 下，项目 artifact 仍统一写在宿主/root artifact_dir，但 CHG 责任应拆成两层。`.pace/change-owners/<chg-id>.json` 记录运行态 owner（session_id、cwd、worktree/branch、state=`active|closing|closed`、updatedAt），供 Stop/Agent gate 做机械判断；artifact 详情和索引行记录人读执行上下文（例如 `[worktree:: main] [branch:: main]` 或 `[worktree:: paceflow-smoke-local-wt] [branch:: worktree-mt]`），方便用户分辨哪个 worktree/branch 产生该 CHG。不要把 session_id/lock/closing 等运行态写进 artifact。
- Stop hook 目标语义：当前 session 只对自己 owner 的 CHG 做硬阻断；另一个 fresh session owner 的 completed+verified active CHG 不阻断当前 session，只提示/记日志；owner stale 或 owner unknown 的 CHG 进入恢复提示，可显式接手后 close。这样避免 host session 因 worktree session 的未归档 CHG 被阻止，同时不放过 orphan / 旧版本无 owner 的脏状态。
- Agent gate 目标语义：`create-chg` / `approve-and-start` / `update-status` / `close-chg` / `archive-chg` 更新 owner 运行态；同一 CHG 被另一个 fresh session close/update 时应 deny 或强提示，除非 owner stale 或 prompt 显式接手。close 成功后 owner 标记 `closed` 或删除。resource lock 仍保护具体文件写入，owner 只决定“谁负责收尾”，不是替代写锁。
- 非阻断噪声：两个 close agent 仍出现报告标题前缀 warning（`All edits successful. Generating report.` / `All edits completed. Generating report.`）。SubagentStop 已记录 `title-prefix` warning，但不阻断；可继续作为低优先级体验问题观察。

#### 0.1.10e5 v6.0.51 production Smoke4 vault route 观察（2026-05-11）

Smoke4（Obsidian vault route）真实运行结论（首次中断 sid=2c8e5027-e852-4730-a501-5914e45dcb0f；成功 sid=91a488c6-1524-4938-92b7-51ad60afe83a）：

- 最终状态通过：本地项目 `/mnt/k/AI/paceflow-smoke-vault/.pace/artifact-root` 为 `vault`；本地项目没有 `task.md` 或 `changes/`；artifact 均创建在 `/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-smoke-vault/`；`index.js` 输出为 `vault smoke ok`，`node index.js` 验证通过。
- Artifact 内容正确：`task.md` / `implementation_plan.md` 活跃区为空，`CHG-20260511-01` 已归档到 ARCHIVE；详情文件 `changes/chg-20260511-01.md` 为 `status: archived`，含 `completed-date` / `verified-date` / `archived-date`、`<!-- APPROVED -->` / `<!-- VERIFIED -->`，任务均 `[x]`；`walkthrough.md` 使用 `[[chg-20260511-01]]` wikilink。
- 首次中断会话的问题是模型误判：用户要求“验证后归档”，但模型仍按“单行修改豁免”直接 Edit，PreToolUse 正确以 `DENY_ARTIFACT_ROOT_CHOICE` 阻止并提示先选择 artifact root、再创建/批准 CHG。这是模型未遵守 SessionStart skill 提醒，不是 hook 放行缺口。
- 成功会话仍有一次无效重试：用户已在 prompt 中明确选择 `Obsidian vault project`，主 session 先运行 reserve helper，因 `.pace/artifact-root` 尚未写入而被 `DENY_ARTIFACT_ROOT_CHOICE` 阻止；随后写入 `vault` 并成功 reserve/create。后续可在 skill 中明确：若用户已显式选择 artifact root 且配置缺失，先写 `.pace/artifact-root`，再运行 reserve helper。
- `reserve-artifact-id.js` 当前会静默忽略未知参数；本次模型传了不存在的 `--artifact-dir`，未造成错误，因为 helper 仍以 `.pace/artifact-root` 为权威解析到正确 vault project。后续可考虑 P3：helper 对未知参数 fail-fast，避免模型误以为 `--artifact-dir` 生效。
- 非阻断噪声：create/close artifact-writer 报告仍有 title-prefix，SubagentStop 记录 warning 但未阻断。另一个 P3 细节是新建 `implementation_plan.md` 仍保留模板占位 `> **最后更新**: <YYYY-MM-DDTHH:mm:ss+08:00>`；功能无损，但模板语义不够干净，可考虑移除该行或在模板创建时填入真实时间。

#### 0.1.10e6 v6.0.51 production Smoke5 v5 migration guard 失败分析（2026-05-11）

Smoke5（v5 migration guard）未完成且暴露真实缺口（sid=87277331-da99-40ad-86b5-d94930d34b38）：

- 失败 1：legacy v5 未被识别。Smoke fixture 为根目录 `task.md` + `implementation_plan.md`，内容是 `# Task` / `# Implementation Plan` 与普通 checkbox 行，且没有 `changes/`。当前 `legacyV5FilesInDir()` 只匹配 `<!-- ARCHIVE -->`、中文 v6/v5 标题、`### CHG/HOTFIX-` 等 PACE 特征，不匹配这种最小 v5 fixture；实测 `getV5MigrationInfo()` 返回 `detected:false`。因此 hook 在首次 Edit 前只给 `DENY_ARTIFACT_ROOT_CHOICE`，没有给 `DENY_V5_MIGRATION`。
- 失败 2：选择 `local` 后，`reserve-artifact-id.js` 调用 `createTemplates()` 懒创建了 `changes/` 与 v6 模板文件。由于 `hasLegacyV5ArtifactsDir()` 一看到 `changes/` 存在就直接返回 false，后续 legacy 检测被永久绕过，项目进入“v5 根索引 + v6 changes 详情”的混合状态。
- 失败 3：`create-chg` 在 legacy `task.md` / `implementation_plan.md` 顶部插入 v6 wikilink 索引，但原文件缺少 `<!-- ARCHIVE -->`。`close-chg` 在未预检根索引 ARCHIVE 标记的情况下先把详情文件改到 `status: archived`、写 `verified-date` / `<!-- VERIFIED -->` / `archived-date`，随后发现索引无法归档并失败，留下“详情 archived、索引仍在活跃区”的半归档状态。
- 失败 4：恢复链路不闭合。主 session 直接改 artifact 被 hook 正确拦截；`archive-chg` 又因详情已 `status: archived` 拒绝执行 `format-violation: already archived`；`update-chg action=append` 只把“修复步骤”当作工作记录追加，不能改 frontmatter 或索引；Stop hook 当前提示“派 close-chg 修复索引”，但 close-chg 仍会遇到缺 ARCHIVE 标记，提示不够可执行。
- 当前 artifacts 状态：`index.js` 已改为 `legacy migrated smoke`；`changes/chg-20260511-01.md` 为 `status: archived`，但 `task.md` / `implementation_plan.md` 无 `<!-- ARCHIVE -->`，且 `CHG-20260511-01` 与 `legacy v5 active item` 都留在活跃区；`walkthrough.md` 未写完成记录。
- 修复方向：P0 修 legacy 检测，至少识别“无 changes 且同时存在 task.md + implementation_plan.md，并含 markdown checkbox 活跃行”的 v5/minimal fixture；同时在 `createTemplates()` / reserve helper 前 fail-closed，不允许在可能 legacy 的目录里创建 `changes/`。P1 修恢复链路：`close-chg` 先预检/修复索引 ARCHIVE 标记再把详情置 archived；`archive-chg` 或 `close-chg` 对“详情已 archived 但索引仍活跃”的状态应允许执行 index-only repair；Stop 提示应指向真实可执行的修复操作。

#### 0.1.10e7 v6.0.51 production Smoke6 native plan bridge 观察（2026-05-11）

Smoke6（native `/plan` bridge + sync-plan helper）真实运行结论（sid=5a64ea43-8e26-41e1-966e-28303936a271；project=`/mnt/k/AI/paceflowv6test`）：

- 核心链路通过：`/plan` 生成 `/home/paceaitian/.claude/plans/optimized-imagining-crab.md`，用户通过 `ExitPlanMode` 批准后，主 session 选择 `local` artifact root，运行 `reserve-artifact-id.js` 预留 `CHG-20260511-01`，`create-chg` / `approve-and-start` / 代码修改 / `node calc.test.js` / `close-chg` 全部完成。
- Bridge 同步通过：主 session 调用 `sync-plan.js --plan /home/paceaitian/.claude/plans/optimized-imagining-crab.md`；hook log 记录 `PlanSync | act=SYNCED | plan=optimized-imagining-crab.md`，`.pace/synced-plans/` 下存在同步标记，说明 v6.0.51 的 helper 替代手写 bash 脚本已生效。
- Artifacts 最终正确：`.pace/artifact-root=local`；`changes/chg-20260511-01.md` 为 `status: archived`，含 `completed-date` / `verified-date` / `archived-date` 与 `<!-- APPROVED -->` / `<!-- VERIFIED -->`；`task.md` / `implementation_plan.md` 活跃区为空，CHG 位于 ARCHIVE 下方；`walkthrough.md` 使用 `[[chg-20260511-01]]`，Stop hook 两次 PASS。
- 代码结果正确：`calc.js` 新增 `divide(a, b)`，除零抛 `Error("除数不能为零")`；`calc.test.js` 导入 `divide` 并覆盖正常除法、零被除数、除零错误消息；本地复跑 `node calc.test.js` 输出 `ok`。
- 体验观察：ExitPlanMode 之后模型先尝试直接 `Edit calc.js`，被 `DENY_ARTIFACT_ROOT_CHOICE` 拦截后才进入 PaceFlow 初始化。这是首次启用时的预期兜底，不是功能 bug；但也说明 SessionStart 在 `signal=none` 时未注入 PaceFlow helper，首个代码写入仍需要一次选择拦截。
- 修复项：主 session 在调用 `pace-bridge` 后仍搜索 `~/.claude/plugins/cache/paceaitian-paceflow` 来找 `reserve-artifact-id.js` / `sync-plan.js`，并同时看到 6.0.50 与 6.0.51。根因是 SessionStart 只有在 `paceSignal && task.md exists` 时才输出当前版本绝对 helper 路径；首次启用选择 artifact root 后不会重新注入，而 skill 只写 `node "<reserve-artifact-id.js 的绝对路径>"` 占位。应在 PreToolUse 首次选择/创建 CHG 提示、artifact-root choice deny、pace-bridge/pace-workflow skill 中提供当前运行时 helper 命令，或提供稳定 `claude plugin root` 解析 helper，禁止模型搜索 plugin cache 猜版本。
- 修复项：`reserve-artifact-id.js` 静默忽略未知参数；本次模型传入 `--artifact-dir "/mnt/k/AI/paceflowv6test"`，helper 实际没有使用该参数，只是按 `.pace/artifact-root` 解析成功。应对未知 `--*` 参数 fail-fast，或正式支持 `--artifact-dir` 并明确其优先级；否则模型会误以为该参数生效。
- P3 内容偏差：CHG 详情中写“与现有 add/multiply 保持一致的 export 风格（CommonJS）”，但实际 `calc.js` 是 ESM named export。代码和测试正确，属于 artifact 文案准确性问题，可观察，不建议单独为此加机械检查。
- 非阻断噪声：create/update/close artifact-writer 仍有报告标题前缀 warning；SubagentStop 只记录 `title-prefix`，不影响 close 与 Stop PASS。

#### 0.1.10e8 v6.0.52 Smoke1-6 修复落地（2026-05-12）

本轮按上方 Smoke1-6 记录修复 1-12 与 worktree 严重问题 #16：

- v5 migration guard：`legacyV5FilesInDir()` 识别无 `changes/`、同时存在 `task.md` + `implementation_plan.md` 且含 checkbox 活跃行的最小 v5 fixture；`createTemplates()` / reserve helper 在可能 legacy 目录中 fail-closed，不再先创建 `changes/` 造成永久绕过。
- 半归档恢复：artifact-writer 在根索引缺 `<!-- ARCHIVE -->` 时不得先把详情改为 `status: archived`；`close-chg` / `archive-chg` 指令允许先补根索引 ARCHIVE 再移动索引，`archive-chg` 对详情已 archived 但索引仍活跃进入 index-only repair。
- helper 入口：`reserve-artifact-id.js` 输出 `execution-context`，对未知 `--*` 参数 fail-fast，明确不支持 `--artifact-dir`；artifact-root 选择提示、workflow/bridge/artifact-management skill 均要求使用 hook 提供的当前 helper 完整命令，禁止搜索 plugin cache 猜版本。
- worktree owner：新增 `.pace/change-owners/<chg-id>.json` 运行态 owner。`create-chg` / `update-chg` / `close-chg` / `archive-chg` 会记录 session、cwd、worktree、branch 与 state；Stop 对其他 fresh session owner 的 CHG 不硬阻断当前 session；Agent gate 阻止 fresh foreign owner 被另一个 session 接手，stale owner 需要 `owner-takeover-confirmed:true`。
- worktree 普通文件路径：当 cwd 是 git worktree、artifact_dir 是宿主 local root，且 Write/Edit/MultiEdit 目标是宿主目录中的非 artifact 普通文件时，PreToolUse deny 并提示写当前 worktree 对应路径，避免模型把 `artifact_dir` 误当项目根。
- 语义/文案：`approve-and-start` 的 `task-id` 明确为 first task anchor；artifact-writer 遇到 `File has been modified since read` 时重新 Read 后重试；显式 vault/local 选择时先写 `.pace/artifact-root` 再运行 helper；`implementation_plan.md` 模板移除静态“最后更新”占位。
- 验证：`test-pace-utils` 119/119 PASS，`test-hooks-e2e` 155/155 PASS，`tests/agent-tests/run-tests.js dummy` PASS，hook JS `node --check` 与 `git diff --check` PASS。

#### 0.1.10e9 v6.0.53 worktree owner 边界收尾（2026-05-12）

本轮记录并修复 v6.0.52 后继续审计出的 worktree owner 边界：

- SessionStart 注入边界：主 session 启动时仍会看到 worktree running CHG，且原逻辑会把 foreign pending T-NNN 计入当前 Claude 任务列表。修复为 `task.md` / `implementation_plan.md` 活跃区折叠 foreign owner CHG，只保留 owner 摘要；active CHG 摘要带 `owner=... worktree=... branch=... state=...`，foreign running/stale/closing CHG 只进入“其他 worktree/session 活跃 CHG”提示，不计入当前 session 任务列表。
- Compact/PreCompact 继承边界：PreCompact snapshot 也写入 owner disposition/worktree/branch/state，compact 恢复时显示 owner，避免 compact 后把 foreign worktree 任务当成本 session 当前任务。
- owner TTL 边界：worktree 暂停超过 TTL 不等于放弃任务。Stop 对 foreign fresh/stale 的 running/blocked/closing-required 状态降为 log/轻提示语义，不 hard block 当前 session；结构不一致仍 hard block，因为这是全局 artifact 一致性问题。
- owner heartbeat：`approve-and-start` 后长时间写代码/测试但不更新 artifact 会让 owner stale。PreToolUse/PostToolUse 在当前 session 执行代码文件写入或 Bash 工具时刷新该 session 的 active/closing owner timestamp，降低长任务误 stale。
- target 解析边界：`update-chg` / `close-chg` / `archive-chg` 必须显式 `target: CHG-...` / `target: HOTFIX-...`。hook 不再用正文中随便出现的 CHG-ID 做 owner 判断，避免误接手错误 CHG。
- skill 同步边界：`pace-workflow` / `artifact-management` 的常用操作表格同步写明 `target`，避免主 session 按旧简写 prompt 触发 target-required deny。
- owner closed 边界：`PostToolUse:Agent` 不再仅因 close/archive Agent 工具返回就把 owner 标为 closed；只有目标 CHG/HOTFIX 已离开活跃索引后才标 closed，否则保留 `closing` owner，让 Stop 后续仍能判断责任归属。
- 保留边界：普通文件 Bash 写宿主目录仍不由 PaceFlow 全局拦截，避免 PaceFlow 变成通用路径裁判；当前只保留 Write/Edit/MultiEdit 的窄场景 worktree host 普通文件保护。
- 验证：`test-pace-utils` 120/120 PASS，`test-hooks-e2e` 161/161 PASS，`tests/agent-tests/run-tests.js dummy` PASS，hook JS `node --check` 与 `git diff --check` PASS。

#### 0.1.10e10 v6.0.54 walkthrough worktree context（2026-05-12）

本轮记录并修复 v6.0.52/53 的人读一致性缺口：

- 现象：`create-chg` 已将 helper 输出的 `[worktree:: ...] [branch:: ...]` 写入 `task.md` / `implementation_plan.md` 索引行，但 `close-chg` / `archive-chg` 写 `walkthrough.md` 时只写 `| 日期 | [[chg]] 摘要 | CHG-ID |`，多 worktree 历史完成记录无法直接看出来源。
- 设计：不改 walkthrough 三列表头，避免迁移旧表格；将同一组执行上下文追加到完成内容单元，例如 `[[chg-...]] 完成摘要 [worktree:: smoke] [branch:: feature-x]`。没有上下文的旧 CHG 可省略。
- 指令：`close-chg.md` / `archive-chg.md` 要求从目标 `task.md` 或 `implementation_plan.md` 索引行提取执行上下文；新增行必须保留，已有行缺失时补齐。仍禁止把 session id、owner state、lock 信息写入 artifact。
- 机械校验：`validateWalkthroughLinks()` 在原有 wikilink/详情存在性检查基础上，若索引行含 `[worktree:: ...] [branch:: ...]`，则要求 walkthrough 完成内容列也包含同一组字段；Stop/PostToolUse 都会提示缺失。
- 验证：新增 Stop/PostToolUse 两个 walkthrough context fixture；`test-hooks-e2e` 基线提升到 163/163。

#### 0.1.10e11 v6.0.54 Smoke3 后续观察：approve 语义与 skill activation（2026-05-12）

Smoke3 rerun（host sid=10c020d3-37c7-41b1-8d24-0304924381f0；worktree sid=54b77603-9324-4898-8350-2d46e671d31e）最终 artifact 状态正确：`CHG-20260512-03` / `CHG-20260512-04` 均已归档，`walkthrough.md` 同步保留 `[worktree:: ...] [branch:: ...]`，Stop clean pass。但本轮暴露两个需要继续跟踪的语义/入口问题：

- `approve-and-start` 复验观察：v6.0.52 已把 `task-id` 文案收敛为 first task anchor，并修复“连续 CHG 被模型拆成逐个 update-status”的体验问题；本轮 Smoke3 没有实际落盘逐任务 update-status，最终用 `close-chg complete-open-tasks:true` 收口。当前仍只把 anchor task 标成 `[/]`、其余任务保持 `[ ]`，这是设计取舍；后续仅继续观察 artifact-writer 报告是否仍用“继续执行剩余任务 T-002”这类容易误读的表述。
- Paceflow skill activation 不能当确定性保障：host 主 session JSONL 只有初始 `skill_listing`，thinking 中提到“应该调用 pace-workflow”，但没有实际 `Skill(paceflow:pace-workflow)` tool_use；后续 hook 在 `reserved-id`、`verify-summary/walkthrough-summary` 缺失时提示先调用 skill，模型仍直接重试 Agent。worktree session 则实际调用了 `Skill(paceflow:pace-workflow)`，后续消息带 `attributionSkill`。结论：skill 是降低重试和解释流程的 advisory layer，关键正确性必须下沉到 hook/agent 机械约束，不能依赖模型一定会调用 skill。
- Smoke5 同类证据：v5 migration rerun（sid=90b7b09f-b26f-47b3-9651-ed308cde02d8）也没有实际 `Skill(paceflow:pace-workflow)` tool_use。SessionStart 已识别 `signal=legacy`，但主 session 没有主动进入 Paceflow workflow；它先直接 Edit `index.js`，被 `DENY_LEGACY_ACTIVE` 拦截后才 dry-run、AskUserQuestion、正式迁移。这里的拦截后指向 dry-run 是合理兜底，不是问题。真正问题是：有明确 Paceflow/legacy 信号时仍未调用 skill，迁移完成后又直接重试 Edit，被 `DENY_V6_NO_ACTIVE` 拦截后才 create CHG；最后 `close-chg` 首次缺 `verify-summary` / `walkthrough-summary`，再次说明模型没有读取或遵循 workflow/artifact-management 的 close 规范。后续修复方向：SessionStart 对 `signal=legacy` 和已有 artifact 信号应给更明确的“先调用 Skill(paceflow:pace-workflow)”短入口提示；`close-chg` 缺 summary 仍由 PreToolUse hard deny 保底。
- 设计边界确认：hook 不能替主 session 发起 `Skill(...)` tool call，也不能把“已调用 skill”当成可靠硬状态来建核心状态机；从 JSONL transcript best-effort 检测 skill 调用会受 transcript path、刷新时机和 Claude Code 版本影响，只适合作诊断/审计信号，不适合作硬门。推荐策略是三层：SessionStart 在明确 Paceflow/legacy 信号时把“先调用 `Skill(paceflow:pace-workflow)`；涉及 CHG/artifact 字段再调用 `Skill(paceflow:artifact-management)`”放到更靠前、更短的位置；关键 Paceflow 写入/Agent 派遣前可做 one-shot skill reminder，避免重复 nag 或循环；真正正确性继续由 reserved-id、C/E gate、legacy migration gate、close summary、owner/worktree gate 等机械约束兜底。换句话说，目标不是强制模型调用 skill，而是让“不调用 skill”也不能越过流程不变量。
- 该 skill 缺失直接放大了另一个缺口：host 已创建并 owner 了 planned CHG 后，仍在 `approve-and-start` 前 Edit 了 `README.md`；hook 记录 `PASS_V6_NON_CODE`。这说明当前 C/E gate 只覆盖代码文件，非代码项目文件在“当前 session 已有 active CHG”时缺少执行阶段约束。后续修复口径：不要把 PaceFlow 变成普通路径裁判；但当当前 session 持有 actionable CHG 时，任何项目内写入（代码、README、配置、文档）都应先通过 C/E gate。foreign fresh owner 的 CHG 不应阻断当前 session 普通非代码写入，结构不一致仍应全局阻断。

#### 0.1.10e12 v6.0.54 Smoke4 vault route rerun 观察（2026-05-12）

Smoke4 rerun 覆盖“vault 选择后是否先写 `.pace/artifact-root`，不再乱传 `--artifact-dir` 或搜索旧 cache”的目标：

- 核心链路通过：本次主 session 调用了 `Skill(paceflow:pace-workflow)`，并在预留编号后调用 `Skill(paceflow:artifact-management)`；`artifact-writer` 没有因为缺 reserved-id、task-id、summary 等字段反复重试，说明 skill activation 对减少 retry 有明显价值。
- vault 路由通过：后续 helper 无参数调用返回 `artifact_dir: /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-smoke-vault/`，说明 `.pace/artifact-root=vault` 已被当前项目配置正确读取；artifact_dir 由 helper 从项目配置解析，而不是由模型自造 `--artifact-dir` 覆盖。
- helper 路径仍有入口缺口：`rootChoicePending` 的 SessionStart 只提示“首次写代码或派 artifact-writer 时 PreToolUse 会要求选择 artifact root”，没有输出 reserve helper 绝对命令；skill 又要求“优先使用 SessionStart / PreToolUse 提示中的完整命令，不要搜索 cache 猜版本”。模型因此在写入 `.pace/artifact-root=vault` 后搜索了 `6.0.54` cache 路径来找 helper。它没有猜旧 6.0.50/6.0.51，所以本次未造成错误；但这说明首次启用 + 用户已明确选择 vault/local 时，SessionStart 或 root-choice 提示仍应给出当前 runtime helper 命令。
- 仍有一次非阻断参数幻觉：模型先尝试 `reserve-artifact-id.js --operation create-chg --project-dir <cwd> --artifact-root vault`。仓库文案没有要求传这两个参数；helper 也不支持，日志记录 `ReserveID | act=DENY_UNKNOWN_OPTION | options=--project-dir,--artifact-root`；模型随后改为无额外参数调用并成功。后续可做低风险收敛：unknown-option 文案把“不要传 `--artifact-dir`”扩展为“不要传 `--artifact-dir` / `--artifact-root` / `--project-dir`；从目标项目 cwd 运行，或仅在自动化中使用 `--cwd`”，并在 skill 中同步该短句。该问题不影响本次 Smoke4 正确性。
- owner 运行态残留：artifact 最终已归档，`Stop PASS`，但 `/mnt/k/AI/paceflow-smoke-vault/.pace/change-owners/chg-20260512-01.json` 仍为 `state: closing`。原因倾向是 `PostToolUse:Agent` close/archive 收口逻辑在当前 Claude Code 运行时没有可靠触发，只有 `SubagentStop` 可见；需要后续把“目标已离开活跃索引后 mark owner closed”的动作迁到 `SubagentStop` 或增加等价兜底。该问题目前不影响 Stop，因为活跃索引为空，但会留下运行态卫生噪声。

#### 0.1.10e13 v6.0.55 Smoke3/4 后续修复计划与落地（2026-05-12）

本轮按 `0.1.10e11/e12` 的缺口完整修复，不新增 PaceFlow 对普通文件路径的全局裁判权：

- helper 入口：`rootChoicePending` 的 SessionStart 也输出当前运行时 `reserve-artifact-id.js` 绝对命令；`artifactRootChoiceMessage()` 同步提示配置写入后从目标项目 cwd 运行 helper，禁止搜索旧 plugin cache。
- helper 参数：`reserve-artifact-id.js` 未知参数 fail-fast 文案扩展为明确拒绝 `--artifact-dir` / `--artifact-root` / `--project-dir`；自动化只可用 `--cwd` 指定目标项目 cwd。`pace-workflow` / `pace-bridge` / `artifact-management` 同步该口径。
- skill activation：SessionStart 对已有 artifact 信号与 legacy v5 信号提前输出短入口：先调用 `Skill(paceflow:pace-workflow)`；涉及 artifact/CHG 字段再调用 `Skill(paceflow:artifact-management)`。这仍是 advisory，不作为硬状态机；正确性继续由 hook gate 保底。
- 非代码 C/E gate：当当前 session 持有 actionable CHG owner 时，README/配置/文档等项目内非代码写入也必须通过 C/E 阶段；foreign fresh owner 不阻断当前 session 的普通非代码写入；但索引不一致、详情缺失等结构损坏仍全局阻断。
- owner close 兜底：`SubagentStop` 从 agent transcript / last message 中解析 close/archive target；若目标已离开活跃索引，则调用 `markChangeOwnerClosed()`，修复 `PostToolUse:Agent` 在当前 Claude Code 运行时未可靠触发导致 `.pace/change-owners/*.json` 长期停在 `closing` 的卫生问题。

#### 0.1.10e14 v6.0.55 focused Smoke1/2 并发复跑问题（2026-05-12）

用户同时运行 `docs/production-smoke-v6.0.55.md` Smoke1 与 Smoke2，两个 session 都暴露同一类生产阻断：

- Smoke1（vault root-choice）在 `create-chg` 中只写成了 `changes/chg-20260512-01.md` 与 `task.md`，`implementation_plan.md` 还没补齐时，PreToolUse 检测到 `DENY_V6_INDEX_MISMATCH`。随后 artifact-writer 尝试补齐 `implementation_plan.md` 也被同一检查拦截，形成“提示派 artifact-writer 修复索引，但 artifact-writer 修复动作被 hook 拦”的自锁。最终 `index.js` 未修改，CHG 停在 planned，`.pace/locks` 无残留，说明根因不是 lock file 泄漏，而是结构 gate 顺序错误。
- Smoke2（非代码 C/E gate）先进入同样的半索引自锁；后续模型通过 `cat > /tmp/fix-*.js` + `node /tmp/fix-*.js` 直接写 artifact 绕过 hook。最终 README 被修改，但 artifact 不是正常归档完成：detail 有 `archived-date`，根索引仍留在活跃区，owner 仍为 `closing`，Stop 以降级退出。该结果不能算通过。
- 第二层自锁：当 artifact-writer 试图写入 `<!-- APPROVED -->` / `<!-- VERIFIED -->` 或执行 `close-chg` 时，项目写入 C/E gate 也会挡住 artifact-writer 自己的 artifact 状态迁移。C/E gate 应约束主 session / 普通 agent 的项目文件写入，不应拦截 artifact-writer 对 artifact 的合法生命周期写入。
- Bash guard 缺口：当前规则能拦截 `node -e "fs.writeFileSync('task.md')"` 和直接 Bash 重定向到 artifact，但没有拦截“外部临时脚本内容包含 artifact 路径与写 API，再执行该脚本”的组合。需要检测 command 文本中的 artifact 写 API，也要在执行 `node/python <script>` 时读取小脚本内容做同样检查。
- 操作语义缺口：hook 文案要求“派 artifact-writer 修复索引”，但 artifact-writer 规范没有明确 `fix-index` / `section=indexes` 操作，导致 agent 报 `format-violation` 或 `out-of-scope`。短期修复是让 artifact-writer 的现有索引写入在半索引状态下可通过；后续如频繁需要人工 repair，可单独设计标准 `repair-index` 操作。
- 引导层面复盘：Smoke2 setup 只有两个代码文件，SessionStart 不一定稳定进入 code-count PACEflow 提示；smoke 文档也没有把“先出现索引不一致”定义为失败信号，容易让模型继续硬绕。后续 smoke 文档应确保触发条件明确，并把 Bash/临时脚本/Obsidian CLI 修 artifact 列为失败。

本轮修复口径：

- PreToolUse 的结构一致性检查与 C/E 项目执行 gate 对 artifact-writer 的 artifact 写入豁免；artifact-writer 仍受 artifact resource lock、reservation、frontmatter status、ARCHIVE marker 等专用 artifact 保护约束。
- Bash guard 增加外部脚本写 artifact 检测：命令文本同时包含 artifact 路径与 `writeFileSync` / `appendFileSync` / `write_text` 等写 API，或 `node/python <script>` 指向的小脚本内容包含同类写入，都按 Bash 修改 artifact 拒绝。
- 补 e2e：半索引状态下 artifact-writer 可补齐 `implementation_plan.md`；非 artifact-writer 仍被索引不一致阻止；artifact-writer 写 C/E marker 不被 C/E gate 自锁；外部 `/tmp/*.js` 写 artifact 被 Bash guard 拦截。
- 补文案：索引不一致 deny 明确只能派 artifact-writer 修 artifact，禁止 Bash/临时脚本/Obsidian CLI/主 session 直接改 artifact；Smoke1/2 文档把 index mismatch 与绕过式 artifact 修复列为失败信号，Smoke2 setup 增加第三个代码文件稳定触发 PACEflow。

#### 0.1.10e15 v6.0.55 focused Smoke1/2/4 复跑问题（2026-05-12）

用户并发复跑 Smoke1、Smoke2、Smoke4 后，核心设计目标已达到：artifact-writer 不再被索引/C/E gate 自锁；Smoke2 未批准写 README 会被 C 阶段阻止，批准后放行；Smoke4 close 后 owner 可关闭。

新增问题是 lifecycle prompt gate 的字段识别过宽：

- Smoke2 close-chg prompt 完整包含 `operation: close-chg` 与验证摘要，但 `walkthrough-summary` 中提到“执行 approve-and-start 后 hook 放行”。hook 用全文 `approve-and-start` 关键词判断，误判成 C 阶段批准，要求 `approval-confirmed/source/evidence/task-id`。
- Smoke4 approve-and-start prompt 完整包含 `operation: update-chg` / `action: approve-and-start` 与批准字段，但 `approval-evidence` 引用用户原话“验证通过后 close-chg 归档”。hook 用全文 `close-chg` 关键词判断，误判成 close-chg，要求 `verification-confirmed/verify-summary/walkthrough-summary`。

修复口径：

- `agentLifecyclePromptDenyReason()` 只用结构化字段 `operation:` 与 `action:` 决定当前 lifecycle 操作；摘要、证据、用户原话中的 `approve-and-start` / `close-chg` 只当普通文本。
- `operation=update-chg + action=approve|approve-and-start` 才触发 C 阶段字段检查；`operation=close-chg` 才触发验证/归档字段检查；`operation=update-chg + action=update-status` 才检查是否把 verify 串进同一次派遣。
- 补 e2e：approve-and-start 的 `approval-evidence` 提到 `close-chg` 仍放行；close-chg 的 `walkthrough-summary` 提到 `approve-and-start` 仍放行。

#### 0.1.10e16 v6.0.55 focused Smoke3 worktree artifact-root 缺口（2026-05-12）

用户复跑 Smoke3 后，核心 worktree owner 目标通过：

- worktree session 创建并 `approve-and-start` 后，owner 写入宿主 runtime：`.pace/change-owners/chg-20260512-01.json` 记录 `cwd=/mnt/k/AI/paceflow-smoke-655-wt-branch`、`worktree=paceflow-smoke-655-wt-branch`、`branch=smoke-branch`。
- 主 session 写 `/mnt/k/AI/paceflow-smoke-655-wt/README.md` 正常放行，日志为 `PASS_V6_NON_CODE`。
- 主 session Stop 对 worktree owner 的活跃 CHG 记录 `SKIP_FOREIGN_CHANGE_OWNER ... owner_worktree=paceflow-smoke-655-wt-branch ... category=running`，随后 `Stop PASS`。

新增入口缺口：

- 项目最初没有 `.pace/`。worktree 模型根据当前 cwd 手写了 `/mnt/k/AI/paceflow-smoke-655-wt-branch/.pace/artifact-root=local`。
- PACEflow 对真实 git worktree 的运行态归一到宿主项目，因此权威配置应为 `/mnt/k/AI/paceflow-smoke-655-wt/.pace/artifact-root`。`reserve-artifact-id.js --cwd /mnt/k/AI/paceflow-smoke-655-wt-branch --operation create-chg` 未读到宿主配置，正确返回 `DENY_ARTIFACT_ROOT_CHOICE`，并提示把选择写入宿主 `.pace/artifact-root`。
- 模型随后按提示写入宿主 `.pace/artifact-root=local`，reserve/create/approve-and-start 回到正常轨迹。最终功能正确，但 worktree 本地残留了无效的 `.pace/artifact-root`，说明“让模型手写配置路径”在 worktree 首次启用场景下仍不稳定。
- 追加确认：这不是 skill 没加载。worktree 会话已经调用 `paceflow:pace-workflow` / `paceflow:artifact-management`，但 SessionStart 当时 `signal=none`，只输出 Git 状态，没有注入 `reserve-artifact-id.js` 或 artifact-root helper 的完整命令；skill 又只说“使用 hook 提供的 helper，勿搜索 cache”，导致模型知道需要 helper 但没有确定路径，最后违背指令去 `find ~/.claude/plugins/cache/...`。根因是 helper 入口不够确定，skill 能降低流程错误但不能保证模型不 improvisation。

修复方案记录：

- 新增 `set-artifact-root` helper，例如 `node ".../hooks/set-artifact-root.js" --choice local [--cwd <target-cwd>]`。交互选择仍保留；helper 只负责把 `local|vault|custom path` 写到正确 runtime 配置位置。
- helper 必须复用 `getProjectRuntimeDir()` / artifact root 解析逻辑：当前 cwd 是 git worktree 时，写宿主项目 `.pace/artifact-root`，不写 worktree 分支目录本地 `.pace/artifact-root`。
- helper 成功输出需明确解释 worktree 共享 runtime，避免模型误以为“写错目录”并自行补写 cwd-relative `.pace/artifact-root`。输出至少包含 `config-file`、`choice`、`current-cwd`、`execution-context`，并说明“这是 git worktree 共享的 PaceFlow runtime 配置位置；不要在当前 worktree 另写 `.pace/artifact-root`；下一步从当前 cwd 运行 reserve helper”。
- root-choice deny / SessionStart helper hint / `pace-workflow` / `artifact-management` 文案应改为优先运行 `set-artifact-root` helper，而不是指导模型 `mkdir -p .pace && echo local > .pace/artifact-root`。
- 如果当前上下文没有完整 helper 命令，skill 必须明确：不要搜索 plugin cache；以当前 skill base directory 为基准拼出同版本绝对路径 `../../hooks/set-artifact-root.js` / `../../hooks/reserve-artifact-id.js`，或先触发/等待 hook 提供 helper 命令。
- 机械兜底：当 cwd 是 git worktree 且模型尝试写 worktree 本地 `.pace/artifact-root`，如果宿主 runtime 是权威位置，应拒绝或强提示改用 `set-artifact-root` helper。该 guard 只针对 PaceFlow runtime config，不扩展为普通项目文件路径裁判。
- 后续测试：e2e 覆盖 worktree cwd 下 `set-artifact-root --choice local` 写宿主 `.pace/artifact-root`；`reserve-artifact-id.js --cwd <worktree>` 随后成功；误写 worktree 本地 `.pace/artifact-root` 被提示；production Smoke3 增加“新项目无 `.pace/` + worktree 首次选择 local”复测。

#### 0.1.10e17 HOTFIX reserve helper skill 缺口（2026-05-12）

- 实现层已支持 `reserve-artifact-id.js --operation create-chg --type hotfix` 生成 `HOTFIX-YYYYMMDD-NN` 与 `changes/hotfix-yyyymmdd-nn.md`，但主 skill 只写了通用 `--operation create-chg` 示例，未明确 HOTFIX 预留命令。
- 同一 session 默认复用尚未消费的 `create-chg` reservation；如果先预留普通 CHG 后又要创建 HOTFIX，不加 `--new` 可能复用旧 CHG reservation。skill 必须明确 HOTFIX 场景使用 `--type hotfix`，需要新编号时使用 `--type hotfix --new`。
- 修复范围：`pace-workflow`、`artifact-management`、`pace-bridge`、`change-lifecycle` 同步 HOTFIX helper 示例；e2e 覆盖先预留普通 CHG 后用 `--type hotfix --new` 生成 HOTFIX。

#### 0.1.10e18 暂停/阻塞语义与 worktree owner 边界（2026-05-13）

Smoke3 测试中用户要求 worktree session “创建并 approve-and-start 后暂停，不要 close-chg”，用于验证 foreign owner 不阻断主 session 普通工作。讨论确认：暂停不应被解释成“其他 worktree 可以接手继续做”。换 worktree 会丢失代码上下文、未提交状态、临时验证信息与模型工作记忆，不能保证质量；owner 机制的目的应是防误操作，而不是任务转派。

语义原则：

- `[/]` 表示当前 owner 正在执行；它不应长期作为“人离开但任务暂存”的默认状态。
- `[!]` 应承载阻塞/暂停语义：等待用户、外部信息、环境恢复，或用户明确要求先停。
- planned backlog 与 blocked backlog 不应阻止其他 session 的普通工作；结构损坏、当前 session 正在执行的 running、completed 未收尾仍应阻止。
- foreign owner 即使 stale，也不应默认允许另一个 worktree 接手。只有用户明确要求在当前 checkout 重新开始，或取消旧 CHG 后另建新 CHG，才允许改变执行归属。
- 暂停是例外路径，不是常规流程。默认仍是 CHG 连续执行、验证、`close-chg` 归档。

待评估修复方向：

- 当用户明确说“暂停/先停/等我后续处理”时，主 session 应派 `artifact-writer update-chg section=tasks action=update-status ... new-status=[!]`，并记录 pause/block reason；而不是只留下普通 `in-progress`。
- Stop 对当前 session 已明确 `[!]` 的 CHG 不应继续硬卡退出；SessionStart 只提示存在 blocked CHG，等待原 worktree/session 恢复或用户明确重新开启。
- owner takeover 口径需要收紧：不把 stale owner 当作默认可接手信号；接手必须有用户显式确认，并优先建议回到原 worktree/session。

#### 0.1.10e19 `spec.md` v5.1.4 语义继承与 v6 文案边界（2026-05-13）

pace-utils 拆分后 production Smoke1 通过，但 artifact root 初始化生成了 `spec.md`；复查 v5.1.4 提交 `6854a2d` 后确认，`spec.md` 在 v5.1.4 中是核心 Artifact 文件之一，语义是“项目元数据与技术栈”，由主 session 在项目事实变化时直接维护，且是唯一不含 `<!-- ARCHIVE -->`、不参与归档的项目级规格文件。

当前 v6 是半继承状态：

- `ARTIFACT_FILES` 与模板仍包含 `spec.md`，`artifact-management` 文件模型表也写了 `spec.md`。
- 但 `artifact_dir` 用户可见提示、`PACE_ARTIFACT_ROOT_CONTENT`、`artifact-writer-spec` 顶部结构、`pace-workflow` / `artifact-management` 的 artifact root 文案只列 `task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md / changes/**`，漏掉 `spec.md`。
- `artifact-writer.md` 正确排除 `spec.md`，但没有解释：`spec.md` 仍是 PaceFlow artifact root 的一部分，只是不归 artifact-writer 指令集管理。

修复口径：

- 统一 artifact root 内容文案为：`spec.md / task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md / changes/**`。
- 明确 `spec.md` 是项目级规格 artifact：项目元数据、技术栈、依赖、配置、目录结构、编码规范等项目事实。
- 明确 `spec.md` 由主 session 直接 `Edit` 维护；`Write` 覆盖仍禁止；不由 `artifact-writer` 管理，不参与 CHG/HOTFIX `close-chg` / `archive-chg`，不写 `APPROVED` / `VERIFIED` / `ARCHIVE`。
- 同步范围：`plugin/hooks/pace-utils/constants.js`、`session-start.js`、`pre-tool-use.js`、`pre-tool-use/agent-lifecycle-guard.js`、`skills/artifact-management/SKILL.md`、`skills/artifact-management/references/format-reference.md`、`skills/pace-workflow/SKILL.md`、`agent-references/artifact-writer-spec.md`、`agents/artifact-writer.md`。
- 回归测试：单元/e2e 覆盖 `spec.md` 属于 artifact root 但不进入 artifact-writer managed rel；主 session `Edit spec.md` 可通过，`Write spec.md` 覆盖仍拒绝；SessionStart / PreToolUse 文案包含 `spec.md`；Smoke1 中生成 `spec.md` 不再与 artifact_dir 提示矛盾。

#### 0.1.10e20 pace-utils refactor Smoke2 worktree 观察校正（2026-05-13）

`docs/production-smoke-pace-utils-refactor.md` 的 Smoke2（Worktree Owner Boundary）中，worktree session 写完 `branch-note.md` 后模型一度想再派 `update-status [x]`。补充确认：这是用户主动 ESC 截断的未完成意图，没有实际落盘、没有触发 artifact-writer，也没有形成 hook/agent 产品缺陷；仅作为模型倾向观察保留，不进入待修清单。

该观察属于 pace-utils 拆分后的当前 smoke，不属于 v6.0.52/6.0.54 Smoke3 历史问题。

#### 0.1.10e21 pace-utils refactor Smoke3/4 复跑结论（2026-05-13）

`docs/production-smoke-pace-utils-refactor.md` 的 Smoke3/4 均通过，未发现 split `pace-utils` 后的模块加载、helper 路径或 lifecycle operation 误判问题。

Smoke3（Vault Artifact Full Flow，sid=`8137a2bf-4d19-417a-ab47-340061d6f6f5`）：

- SessionStart 已注入当前 6.0.55 的 `set-artifact-root.js` 与 `reserve-artifact-id.js` 绝对命令；主 session 使用 `set-artifact-root --choice vault`，未搜索旧 plugin cache。
- reserve helper 预留 `CHG-20260513-01`；artifact-writer 完成 create / approve-and-start / close；`node index.js` 输出 `vault smoke ok`。
- Artifact 全部落在 Obsidian vault 项目 `/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-smoke-utils-vault/`，local 项目目录只保留 `.pace/artifact-root=vault` 与运行态。
- `task.md` / `implementation_plan.md` 活跃区无残留，ARCHIVE 下有 `[x] [[chg-20260513-01]] ... [worktree:: main] [branch:: master]`；详情 `status: archived` 且有 `<!-- APPROVED -->` / `<!-- VERIFIED -->`；`walkthrough.md` 保留同一 worktree/branch context。
- `.pace/change-owners/chg-20260513-01.json` 最终为 `state: closed`；Stop hook PASS；locks / reservations / index-transactions 无残留文件。

Smoke4（Non-Code C/E Gate，sid=`bf861b9e-a078-491a-82c2-058bbed0720b`）：

- 主 session 调用 `paceflow:pace-workflow`，使用 `set-artifact-root --choice local --cwd ...` 与 `reserve-artifact-id --cwd ...`，未搜索旧 cache。
- create 后按测试要求直接 Edit `README.md`，PreToolUse 返回 `DENY_V6_C_PHASE`：planned CHG 缺 `<!-- APPROVED -->` 且没有 `[/]` 任务，未批准非代码写入被正确阻止。
- 随后 approve-and-start 成功，第二次 Edit `README.md` 放行；`grep -n "noncode gate ok"` 返回第 3 行；close-chg 成功归档。
- `README.md` 已追加目标文本；索引均归档到 ARCHIVE；详情 `status: archived`、T-001 `[x]`、`<!-- APPROVED -->` / `<!-- VERIFIED -->` 完整；walkthrough 保留 `[worktree:: main] [branch:: master]`。
- `.pace/change-owners/chg-20260513-01.json` 最终为 `state: closed`；Stop hook PASS；locks / reservations / index-transactions 无残留文件。

残留观察：

- Smoke4 close agent 仍触发已知 `SubagentStop WARN issue=title-prefix`，报告正文第一行是“全部操作完成。生成报告。”再跟 `## artifact-writer 报告`。该问题已在 action book 既有 `artifact-writer 报告标题` 项下跟踪，不作为本轮新缺口。
- 两个 PreToolUse Agent hint 的 artifact root 文案仍未包含 `spec.md`，与 `0.1.10e19` 的 `spec.md` v5.1.4 语义继承缺口一致，后续按该项统一修。

#### 0.1.10e22 暂停/阻塞语义落地方案（2026-05-13）

`0.1.10e18` 的待评估项确认进入实现：`[/]` 只表示当前 owner 正在执行；用户明确要求“暂停/先停/等我后续处理”时，应改用 `[!]` 表示暂停/阻塞。暂停不是完成，也不是允许其他 worktree 自动接手的信号。

落地范围：

- `update-chg action=update-status new-status=[!]` 必须带 `status-reason` / `block-reason` / `pause-reason` 之一，说明用户要求暂停、外部信息等待或环境阻塞等原因。
- PreToolUse 在派 `[!]` update-status 时把 `.pace/change-owners/<chg>.json` 的 `state` 写成 `blocked`；其他 update-status 仍保持 `active`，close/archive 仍为 `closing`。
- Stop 对当前 session 已明确 `[!]` 的 CHG 只记录软提示，不再 hard block；若同一轮最后消息声称“完成”，但仍存在 `[!]` / pending，则仍按虚假完成声明阻止。
- SessionStart 与 TaskSync 不把 blocked CHG 计入当前 Claude 任务列表同步；SessionStart 单独展示“暂停/阻塞 CHG”，提示恢复前确认用户意图。
- foreign fresh owner 不再提示加 `owner-takeover-confirmed`；fresh owner 只能回原 worktree/session 完成、暂停或取消。
- foreign stale owner 接手必须同时具备 `owner-takeover-confirmed: true`、`owner-takeover-source: user-directive`、`owner-takeover-evidence: <用户原话>`，并优先建议回到原 worktree/session。
- skill / agent 指令同步：暂停用 `[!]`，跨 session 进度可见性才用 `[x]` 或 `[/]`；blocked 不参与 close-chg，恢复前需先 update-status 回 `[/]` 或按用户决策跳过/取消。


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
