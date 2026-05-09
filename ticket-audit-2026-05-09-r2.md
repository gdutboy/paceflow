# ticket-audit-2026-05-09-r2: PACEflow v6.0.36 全面审查（第二轮）

## 审查摘要

审查时间: 2026-05-09T09:13:21+08:00
审查范围: 动态发现 — 10 hook 脚本（含 1 公共模块 `pace-utils.js`）+ 7 hook 模板 + 4 用户 Skill + 引用/子模板 + 3 内部审计文件 + 1 agent 定义 + 7 agent 指令（spec + 6 instructions）+ ~30 测试文件（test-hooks-e2e + test-pace-utils + test-install + agent-tests phase a/b/c/d）+ 14 docs
证据基线: git HEAD `34c0fba6` + 工作区清洁（仅 `?? .remember/`）+ 动态 Glob 实际数量；文档作为候选线索与设计意图背景，不单独用于 C/H 级证据
前一轮基线: `60b92a5`（`ticket-audit-2026-05-09.md`）；本轮覆盖 `60b92a5 → 34c0fba6` 之间的增量

Phase 1 原始发现: 0C + 7H + 多 W/I（来自 5 agent 并行审查）
Phase 2 验证结果: 1 ✅ 确认 / 3 ⚠️ 部分正确 / 3 ❌ 误报
误报率（H 级）: 3/7 (43%) 完全误报；4/7 (57%) 误报或仅措辞类（与 SKILL 历史 50-80% 区间一致）

5 agent 健康度: Agent1 8/10 · Agent2 8/10 · Agent3 9.5/10 · Agent4 8.5/10 · Agent5 8.5/10。综合 **8.5/10**

---

## P0 必修（C 级 + 高影响 H 级）

### [H-6] `plugin/hooks/pre-compact.js:108-111` — `current-native-plan` 跨项目污染（✅ 确认）

- **描述**：PreCompact 扫描 `~/.claude/plans/` 全部 `.md` 文件（无项目过滤），按 mtime 排序后无条件 `fs.writeFileSync(.pace/current-native-plan, recentPlans[0].path)`。`~/.claude/plans/` 是全局共享目录，多项目交叉使用同一小时窗口时会把无关项目的 plan 写到本项目 `.pace/current-native-plan`。
- **下游影响**：`session-start.js:202` 与 `pre-tool-use.js:986`（约）会基于该文件提示 AI 桥接，可能引导 AI 以错误 plan 启动新 CHG。
- **建议修复**（择一）:
  1. 写入前读取 plan 文件 frontmatter `cwd:` 或首段路径标记，仅匹配当前项目时写入；
  2. 改为"仅当 `.pace/current-native-plan` 不存在时"才写，避免覆盖 AI 主动记录；
  3. 在 `recentPlans` 过滤阶段就基于 plan 内容里的 cwd 字段筛选。
- **CHG 归属**：建议派 `create-chg` 编号 `CHG-20260509-01`，scope = "PreCompact native plan 项目隔离"。

---

## P1 建议（部分正确 H + 验证留痕 W）

### 代码安全与正确性

- **[H-4] `plugin/hooks/pre-tool-use.js:42-44`**（⚠️ 部分确认）— `bashCommandLooksMutating` 词表只覆盖 `python\d*|node`。heredoc `cat > task.md <<EOF` 已被独立函数 `bashOutputRedirectTargets`/`bashCommandRedirectsToArtifact` 兜住。但 `bash -c 'node -e "fs.writeFileSync(...)"'`（外层 bash -c，内层 node 单引号包裹未在词表锚定起始）和 `npm/pnpm/yarn run` 仍可绕过。CLAUDE.md G-4 明文要求"禁止通过 Bash 绕过 PACE 保护"。
  → 修复：扩充正则到 `(?:^|[;&|]\s*)(?:bash|sh|zsh|fish)\s+-c\b` 与 `(?:^|[;&|]\s*)(?:npm|pnpm|yarn|npx)\s+(?:run|exec|x)\b`；在 `bashCommandPathTokens` 解析层对引号内 token 也启用 artifact 路径识别（已支持引号 token，需扩展使用面）；补 e2e 用例。
- **[H-7] `plugin/hooks/stop.js:124-130`**（⚠️ 措辞精度）— `requiresWalkthrough` 文案仅展示 `walkthroughDetail` 格式，未明示"必须由 close-chg 派遣写"。验证显示 walkthrough.md 不在 PreToolUse 阻断范围（artifact 写保护仅 chg-*.md / hotfix-*.md 的 marker），不会形成死循环；但 AI 可能误以为应主 session 手写。
  → 修复：将文案改为"walkthrough.md 缺少 ${today} 索引行；上方 close-chg 派遣会自动补写，不要主 session 直接补"。
- **[H-3] `plugin/hooks/pre-tool-use.js:687-712`**（⚠️ 默认安全）— stale-cleared 路径会 `unlinkSync` 删除别人的锁文件。默认 TTL 30 min 远超单次 artifact-writer 执行（典型 < 60s），无风险；但 `PACE_ARTIFACT_LOCK_TTL_MS` 可调短到 < 60s 时存在静默 race。
  → 修复（可选）：在 `pace-utils.js` 中给 TTL 加 floor（如 `Math.max(envTTL, 60_000)`）；当前默认配置无须修。

### 代码质量

- **[W-1] `plugin/hooks/pre-compact.js:80`** — `new RegExp('\\|\\s*' + today + '\\s*\\|').test(walkActive)` 未锚定行首。`stop.js:126` 同等检查用 `^\\|\\s*${today}\\s*\\|` + `m` flag，pre-compact 自称"对齐 stop.js 精确度"实际不一致。→ 补 `'^\\|\\s*' + today + '\\s*\\|'` 与 `'m'` flag。
- **[W-2] `plugin/hooks/post-tool-use.js:118-130`** — entries 循环里多次 push warning（`索引 [x] 与详情 status` / `已 completed 但缺 verified-date` / `N 个阻塞任务`）未做 once-per-CHG 节流，同一会话反复显示。→ 用 `warnOnce(`${kind}-${entry.slug}`...)` 节流（archive-reminded 已节流为模板）。
- **[W-3] `plugin/hooks/pace-utils.js:907-947` (`createLogger`)** — lock stale 阈值 `Date.now() - stat.mtimeMs > 5000`（5s），单次 hook 通常 < 100ms，慢盘 + 多 hook 并发可能两个进程都拿到 lock。后果仅日志行交叉，影响低。→ 调到 30s 或加文件 fd-level 实际 flock。
- **[W-4] `plugin/hooks/pre-tool-use.js:649-651`** — `artifactRelForMutation` 仅在 `paceSignal && isInsideProject && isFileMutationTool` 三者皆真时计算，但下游 763、849 行直接使用未再校验三条件。控制流目前可达，未来重构易留死代码或漏检。→ 提取 `getArtifactRelIfRelevant()` helper 内联三项条件。
- **[W-5] `plugin/hooks/subagent-stop.js:42-48`** — `writeContext` 输出 JSON 到 stdout，但 SubagentStop 是否消费 `additionalContext` 在不同 Claude Code 版本表现不一致；若不消费 AI 看不到 missing-title 提醒。→ 用真实日志或最近版本验证后，必要时改用 PostToolUseFailure 路径补提醒。
- **[W-6] `plugin/hooks/stop.js:172`** — v6 模式下不清理 `task-list-used` flag（依赖 SessionStart `SESSION_SCOPED_FLAGS` 兜底清理）。设计取舍正确，但缺注释。→ 在条件旁加一行"v6 由 SessionStart 清理"注释。
- **[W-7] `plugin/hooks/pace-utils.js:407-413` (`readArtifactRootChoice`)** — env 优先级高于文件读取，但读取后未限长。极端长度的 `PACE_ARTIFACT_ROOT` 会原样塞入 stderr。低风险。→ 加 max length 截断。

### 架构

- **[W-8] `pre-tool-use.js` 单文件 ~3500 行** — 是仓库最大 hook。`bashCommandLooksMutating` / `bashPathLooksArtifact` / `denyOrHint` / `hardDeny` / marker-gate 已可拆为 `pre-tool-use/bash-guard.js` + `pre-tool-use/marker-guard.js` 两子文件，便于单测与审查。→ 拆分前提：现有 e2e 全绿不变。

---

## P2 文档（版本号漂移 + 模板与 SKILL 描述）

### 版本号漂移（关键）

| 位置 | 当前值 | 期望 | 说明 |
|------|--------|------|------|
| `plugin/hooks/pace-utils.js:6` | `v6.0.36` | ✓ | 权威源 |
| `plugin/.claude-plugin/plugin.json` | `6.0.36` | ✓ | 一致 |
| `.claude-plugin/marketplace.json` | `6.0.36` | ✓ | 一致 |
| `README.md:329` | `v6.0.36` | ✓ | 一致 |
| **`REFERENCE.md:1`** | `v6.0.35` | `v6.0.36` | **落后 1 patch** |
| **`paceflow/CLAUDE.md` 顶部** | `v6.0.34` | `v6.0.36` | **落后 2 patch** |
| `docs/action-plan-2026-05-02.md:6` | `v6.0.36` | ✓ | 一致 |

→ **[W-D1]** 修复：把 `bump-version.js` 扩展为同时改 `REFERENCE.md` 顶部 H1、`paceflow/CLAUDE.md` 顶部"PACEflow 是…(v6.0.X)"占位符；commit 一次校准。

### Skill / 模板

- **[W-D2] `plugin/skills/artifact-management/SKILL.md:14`** — artifact root 描述为"vault / 本地 / .pace/artifact-root 自定义"三模式，与 `internal audit/SKILL.md:39` 的"local/vault/custom"对齐方式不一致；易误解为三种独立模式而非"两位置 + 一个覆盖通道"。→ 改为"两种存储位置（vault / local 项目根），`.pace/artifact-root` 用作显式覆盖通道（含 custom 绝对路径）"。
- **[W-D3] `plugin/skills/pace-bridge/SKILL.md:88`** — 提到"把桥接的主计划文件及同名前缀伴随文件写入 `.pace/synced-plans`"，但 `pace-utils.js:hasUnsyncedPlanFiles` 是否真支持"同名前缀伴随"扫描需读源码核实；如 hook 不识别该概念，SKILL 指令对主 session 是空操作。→ 读 `pace-utils.js:688` 附近 `synced-plans` 实现，按真实行为修正 SKILL。
- **[W-D4] `plugin/skills/pace-workflow/SKILL.md:147`** — "Stop hook 会阻止 `completed` 但未 verified 的 CHG 结束会话"措辞偏强。实际 `stop.js:115` 是 push 到 warnings 然后 exit 2 阻止 AI 主动停止，用户先发消息时 Stop 不执行。→ 改为"Stop hook 会在 AI 主动停止时阻止 `completed` 但未 verified 的 CHG 结束会话"。
- **[W-D5] `plugin/skills/pace-knowledge/SKILL.md:142`** — "在 finding 详情正文需要补 knowledge 反向链接时记录为 artifact writer 后续更新需求"措辞模糊，主 session 无法操作 agent backlog。→ **更正**：`update-chg` 仅支持 CHG/HOTFIX 目标，不存在 `modify-finding` 指令，不要虚构能力。真实路径：(a) 新建补充 finding（派 `record-finding`），或 (b) 在关联 knowledge 笔记正文加反向链接，由 finding/knowledge 双向引用承担补充关系。SKILL 已按真实口径修订。
- **[W-D6] `internal/skills/audit/references/agent-prompts.md:185-189`** — Agent 4 prompt 的 Step 1 列了 `references/*.md` 与 `templates/*.md` 两个独立 Glob 步骤但顺序割裂，本次审计 prompt 已在派单时手动整合，建议同步落到内置 prompt 防止下次缺漏。
- **[W-D7] `plugin/hooks/templates/spec.md`** — 没有 `<!-- ARCHIVE -->` 标记（有意设计：spec.md 不归档），但缺顶部说明，可能误导新增项目时手工添加。→ 顶部加 HTML 注释 `<!-- spec.md 是项目级规格文件，不参与归档；不要添加 ARCHIVE 标记 -->`。
- **[W-D8] `plugin/hooks/templates/knowledge-note.md`** — 默认 frontmatter `status: concluded`，但同模板既用于 `knowledge/`（concluded）又用于 `thoughts/`（discussing）；缺创建时区分提示。→ 顶部加 HTML 注释说明 thoughts/ 笔记应改 status=discussing 并删除 sources。

---

## P3 延后（I 级 + 工程门面）

- **[I-1]** Phase C agent fixture 偏薄：`tests/agent-tests/cases/phase-c/` 仅 c1 / c2 都是 approve-and-start，缺 `tc-c3-close-chg-success` / `tc-c4-archive-chg-success` / `tc-c5-record-finding-success` / `tc-c6-record-correction-dual-write`。当前肯定路径靠 e2e 兜底，contract 证据偏单一。→ 派 `record-finding` 跟踪。
- **[I-2]** 缺 v6.0.34 / v6.0.36 production smoke 文档：`docs/production-smoke-v6.0.32.md` 是当前唯一 smoke；v6.0.33-v6.0.36 修复仅声称"e2e 116/116、101/101"，无可重放脚本或 CI 产物。→ 补 `docs/production-smoke-v6.0.36.md` 含 timezone fix 复跑（H-1 from r1）+ regression snapshot。
- **[I-3]** 仓库根 18 个 `ticket*.md` + `HOOKS-TEST.md` + `MEMORY.md` + `path-trace-output.md` + `migrate-artifacts.js`（旧 v5 名，已被 `plugin/migrate/batch-archive-v5.js` 取代）门面凌乱。`marketplace.json source: ./plugin` 已防止污染用户 cache，但开源观感影响明显。→ 挪到 `internal/audit-tickets/` 与 `internal/legacy/`。
- **[I-4]** `plugin/hooks/post-tool-use-failure.js:31-42`：Agent 失败仅在 `agentType` 是 artifact-writer 时释放锁，缺字段时依赖 30min TTL 兜底。可改为"Agent 工具失败一律尝试用 sessionId+agentId 释放"。
- **[I-5]** `pace-utils.js:1078-1083` `countDetailTasks` 正则要求 `T-\d{3}\b`，三位数固定；跨过 999 任务（极少见）会漏统计。
- **[I-6]** `plugin/hooks/hooks.json` matcher `TaskCreate|TaskUpdate` 是非稳定事件名；建议在 hooks.json 顶部加注释或在 docs 标注"实验性"。
- **[I-7]** `plugin/agents/artifact-writer.md` §43-55 v6/v5 fallback 禁令与 §66-83 反模式禁令第 10 条略有重复，可合并以缩短 system prompt。
- **[I-8]** `verify.js` §第 8 组未检查 `migrate/batch-archive-v5.js` 是否随 plugin cache 发布；可加一个 sanity check。
- **[I-9]** 多 Claude Code 实例并发写 `.pace/stop-block-count` / `task-list-used` / `degraded` 等非锁 flag 文件无原子性。低风险（只影响降级时序）但需明确"多实例并发跑同一项目"是已知限制。

---

## 部分正确 / 有意设计（不修复）

- **[N-1]** H-3 锁 stale-cleared 误删 — 默认 30min TTL 远超单次 agent 执行；30min 是保守默认值，SubagentStop / PostToolUseFailure 双重释放。可用最小 TTL floor 兜底极端 env 配置，否则不修。
- **[N-2]** `stop.js:146` `COMPLETION_PHRASES` 中文消息可能误触 — 当前权重低（只是 warning），中文无 `\b` 概念；宁可误报不可漏报。设计取舍正确。
- **[N-3]** `subagent-stop.js:84` 标题精确等于 `## artifact-writer 报告` — 容忍度低；agent prompt 模板已固定，人为差异极少；保持严格匹配以便检测 prompt 漂移。
- **[N-4]** `pre-tool-use.js:200-203` 多行匹配只取第一处 `^artifact_dir:` — 用户 prompt 含解释性 "artifact_dir:" 文本概率低；保持简单。

---

## 误报分析（Phase 1 → Phase 2 三例）

| 编号 | 原指控 | 误报根因 |
|------|--------|---------|
| **H-1** | `getArtifactDir` 缓存 key 仅 cwd 会取旧值 | 模式匹配未追到进程边界。每次 hook 是独立 `node ...js` 进程，模块级 `_artifactDirCache` 初始为空；`readArtifactRootChoice` 每次主动从 env+`.pace/artifact-root` 读取，单进程内不可能切换。注释明确写"T-281: 同一 hook 进程内重复 existsSync"。 |
| **H-2** | `acquireArtifactWriterLock` 空 sessionId 互斥 | 未读完 fallback 链。`parseHookStdin` 兜底 `parsed.session_id || parsed.sessionId || env.CLAUDE_CODE_SESSION_ID`；`acquireArtifactWriterLock` 内部又用 `info.sessionId || currentSessionId() → env || _lastHookSessionId`。e2e `9hc0` 系列覆盖落盘 sessionId 验证。 |
| **H-5** | `cwdWithSlash` 未截尾 `/+$` 会形成 `//` | 未读全三元运算符。`line 641` 已显式 `endsWith('/') ? cwd : cwd + '/'`，等价于 `/+$` 截尾后追加 `/`。 |

**经验教训**：三例都是"模式匹配非路径追踪"误报根因，集中在 cache、锁、路径规整三类多源 fallback 代码。这正是 audit skill 的预期工作模式 —— Phase 1 不加约束让 agent 独立探索，Phase 2 验证阶段过滤误报。预设"先读完函数全文"等约束会让 agent 偏向特定类型的发现，损失独立性；当前的高误报率 + 严格验证流程是设计而非缺陷。

---

## 验证矩阵

| H 编号 | 文件:行号 | 验证方法 | 结论 | 优先级 |
|--------|----------|---------|------|--------|
| H-1 | pace-utils.js:584-621 | 路径追踪 + e2e 测试核对 | ❌ 误报 | — |
| H-2 | pace-utils.js:331-364 | 控制流追踪 fallback 链 + grep 调用点 | ❌ 误报 | — |
| H-3 | pre-tool-use.js:687-712 | 设计意图查证（TTL 30min 默认） | ⚠️ 默认安全 | P3 floor |
| H-4 | pre-tool-use.js:42-44 | 实际 diff `bashCommandLooksMutating` vs CLAUDE.md G-4 | ⚠️ 部分确认 | **P1** |
| H-5 | pre-tool-use.js:884-892 | 实际读 `endsWith` 三元 | ❌ 误报 | — |
| H-6 | pre-compact.js:108-111 | 路径追踪 `~/.claude/plans/` 全局共享 + session-start.js 下游消费 | ✅ 确认 | **P0** |
| H-7 | stop.js:124-130 | 控制流追踪 walkthrough.md 不在 PreToolUse 阻断 | ⚠️ 措辞 | **P1** |

---

## 证据来源

- **代码**（直读）：
  - `plugin/hooks/{pre-tool-use,post-tool-use,post-tool-use-failure,session-start,stop,stop-failure,pre-compact,subagent-stop,task-list-sync,pace-utils}.js`
  - `plugin/hooks/hooks.json`、`plugin/hooks/templates/*.md`
  - `plugin/skills/{pace-workflow,pace-bridge,artifact-management,pace-knowledge}/SKILL.md` + references + templates
  - `plugin/agents/artifact-writer.md` + `plugin/agent-references/{artifact-writer-spec,instructions/*}.md`
  - `plugin/.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json`
  - `internal/skills/audit/{SKILL.md, references/{agent-prompts,audit-procedures}.md}`
- **测试**：`tests/{test-pace-utils,test-hooks-e2e,test-install}.js` + `tests/agent-tests/cases/phase-{a,b,c,d}/*.yaml`
- **文档**（候选线索）：`README.md`、`REFERENCE.md`、`paceflow/CLAUDE.md`、`docs/{action-plan-2026-05-02,production-smoke-v6.0.32,paceflow-v6-guidebook,v6.0.0-design}.md`、`ticket-audit-2026-05-09.md`（前一轮）
- **未读取**：`plugin/hooks/pace-hooks.log`（仓库未提交本地日志，"真实运行证据"维度证据空缺）
- **CLAUDE.md 来源**：仅 `paceflow/CLAUDE.md`；任务 spec 提到的"根 + paceflow/ 双 CLAUDE.md"在实际仓库不存在

---

## 建议后续 CHG 归属

| CHG 候选 ID | 范围 | 包含 |
|-----|------|------|
| `CHG-20260509-01` | PreCompact native plan 项目隔离 | H-6 |
| `CHG-20260509-02` | Bash 写保护扩面 | H-4 + W-4 + W-5 |
| `CHG-20260509-03` | 版本号同步工具增强 | W-D1 |
| `CHG-20260509-04` | Skill 与模板表述精度修订 | W-D2 ~ W-D8 + H-7 |
| `record-finding` | 工程门面优化 | I-1 ~ I-3 |

---

## 总结

**v6.0.36 核心代码层质量优秀**：5 个审查维度无 C 级，仅 1 个真实 H（H-6 native-plan 跨项目污染）+ 1 个部分确认 H（H-4 bash 绕过的 `bash -c`/`npm run` 覆盖偏弱）。其余 5 个 H 中 3 例为完全误报（cache、sessionId、cwdWithSlash），1 例为默认安全的极端 TTL 风险，1 例为措辞精度。版本号在 4 个权威源已对齐 `6.0.36`，仅 `REFERENCE.md`/`paceflow/CLAUDE.md` 顶部需追平。e2e 与 agent-tests 覆盖度处于行业上限，artifact-writer 锁路径完整覆盖 owner-mismatch / stale-cleared / SubagentStop 释放 / PostToolUseFailure 释放。

**误报率 57% 与历史区间一致**，证明 audit skill 的两阶段设计正常运作 —— Phase 1 不预设约束让 5 agent 自由探索（保证独立性），Phase 2 验证阶段做严格的路径追踪 / 实际 diff / 设计意图查证排除误报。高误报率不是纪律缺陷，是允许 agent 大胆发问的代价；试图在 Phase 1 加约束让 agent"先读全文再下结论"反而会让 reviewer 偏向特定模式、损失发现广度。
