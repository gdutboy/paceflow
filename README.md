# PACEflow

> 一套 Claude Code Hook 系统，通过**确定性拦截**（而非提示词建议）强制码前先规划、获批、再执行，解决 AI 编程"一上来就写代码、改着改着迷路"的问题。

## 核心理念

AI 编程最大的问题不是代码质量，而是**过程控制**——AI 会跳过规划直接写代码，写到一半迷路，改完不验证就收工。

PACEflow 不是靠 system prompt 去"建议"AI 做这些事（AI 可以无视建议），而是在 Claude Code 的 Hook 层**物理拦截**：

> **设计哲学**：Hooks 提供 100% 确定性保障，CLAUDE.md 提供 ~70-85% 建议性约束，两者互补。

- 没有活跃 `[[chg-*]]` / `[[hotfix-*]]`？写代码的工具调用直接 **deny**，AI 被迫先创建变更
- 详情文件没有 `<!-- APPROVED -->`？还是 **deny**
- 主 session 试图手写 `<!-- APPROVED -->` / `<!-- VERIFIED -->` / `verified-date`？直接 **deny**，必须派 artifact writer agent
- CHG completed 但没 verified 或 verified 后没归档？Stop hook **exit 2 阻止退出**

### PACE 五阶段

| 阶段 | 含义 | Hook 保障 |
|------|------|-----------|
| **P**lan | 规划任务 | PreToolUse deny 未规划的代码修改 |
| **A**rtifact | 派 agent 创建/更新索引与 `changes/` 详情 | 模板自动注入 + 格式守门 |
| **C**heck | 用户审批 | PreToolUse 检查详情文件 `<!-- APPROVED -->` |
| **E**xecute | 执行 | PostToolUse 归档提醒 |
| **V**erify | 验证 | Stop 完成度检查 + `verified-date` / `<!-- VERIFIED -->` |

### 5 个索引文件 + spec.md + changes/详情 = 项目记忆

| 文件 | 用途 |
|------|------|
| `spec.md` | 项目元数据、技术栈 |
| `task.md` | CHG/HOTFIX 任务索引 |
| `implementation_plan.md` | CHG/HOTFIX 实施索引 |
| `findings.md` | finding 摘要索引 |
| `corrections.md` | correction 摘要索引 |
| `walkthrough.md` | 工作总结索引 |
| `changes/` | CHG/HOTFIX/finding/correction 详情文件 |

索引文件使用 `<!-- ARCHIVE -->` 分隔：活跃区保持精简，归档区保留历史。详情文件由 `artifact-writer` agent 统一维护。

---

## v6 相比 v5 改进了什么

v6 是 breaking change，不继续兼容 v5 的活跃运行格式。已有 v5 内容应迁移或保留在 `<!-- ARCHIVE -->` 下方作为历史，不再参与新的 P-A-C-E-V 流程。

| 维度 | v5 | v6 |
|------|----|----|
| Artifact 写入 | 主 session 直接编辑 `task.md` / `implementation_plan.md` / `findings.md` 等主文件 | `artifact-writer` agent 统一创建、更新、验证、归档 artifact；主 session 只负责业务判断和代码实现 |
| 文件结构 | CHG、任务详情、finding/correction 详情大量内嵌在主文件活跃区 | 主文件只保留轻量 wikilink 索引；完整详情写入 `changes/**` |
| 状态权威 | 主文件 checkbox 与正文段落混合承载状态 | `changes/<id>.md` frontmatter 是权威；索引 checkbox 只做展示和快速检查 |
| 审批/验证 | C/V 标记容易被主 session 手写或写错位置 | `APPROVED` / `VERIFIED` / `verified-date` 只能由 `artifact-writer` 写入，hook 会拦截主 session 直写 |
| 上下文成本 | SessionStart 注入较多历史内容，compact 后恢复依赖主文件长文本 | 只注入活跃索引和活跃 CHG 摘要，PreCompact 写快照，compact 后恢复当前状态 |
| 多项目/Obsidian | vault 路由和 worktree 共用 artifact 的边界较弱 | 首次启用可选择 Obsidian vault 或本地项目目录；worktree 自动归一到宿主项目 artifact |
| Claude 任务列表 | 主要按顶层 `task.md` checkbox 判断 | 按 `changes/<id>.md ## 任务清单` 的 `T-NNN` 子任务校验 TaskCreate/TaskUpdate/TodoWrite |
| 失败恢复 | 工具失败后主要依赖模型自觉重试 | PostToolUseFailure 明确提醒失败不能视为完成，SubagentStop 观察 artifact-writer 报告协议 |

核心收益是把“结构正确性”从提示词建议下沉到 hook 和 agent contract：hook 只做机械兜底，不判断业务内容真伪；内容质量仍由主 session、subagent 和用户确认共同负责。

### v5 用户升级

v6 不会在安装时自动改写旧 vault。首次写代码或派 `artifact-writer` 时，如果 hook 检测到旧 v5 artifact（artifact 根目录有 `task.md` 等文件但没有 `changes/`），会先阻止本次操作，并要求主 session 询问你是否迁移。

这里的 artifact 根目录不是固定等于代码仓库根目录。检测顺序是：已配置的 `.pace/artifact-root` / `PACE_ARTIFACT_ROOT` → `$PACE_VAULT_PATH/projects/<项目名>` → 本地项目目录。也就是说，如果你使用 Obsidian vault 且设置了 `PACE_VAULT_PATH`，旧 v5 文件在 vault project 目录下也会被检测到；如果项目名和 vault 目录名不一致，可以用 `PACE_PROJECT_NAME` 或 `PACE_ARTIFACT_ROOT=/abs/path/to/artifact` 明确指定。

推荐流程：

```bash
PLUGIN_DIR="$HOME/.claude/plugins/cache/paceaitian-paceflow/paceflow/6.0.34"
ARTIFACT_DIR="/path/to/Obsidian/projects/<project-name>"

node "$PLUGIN_DIR/migrate/batch-archive-v5.js" "$ARTIFACT_DIR" --dry-run
# 阅读 dry-run 摘要并确认后再执行：
node "$PLUGIN_DIR/migrate/batch-archive-v5.js" "$ARTIFACT_DIR"
```

迁移脚本会把旧 v5 内容备份为 `*.v5-backup`，再把旧内容移动到 `<!-- ARCHIVE -->` 下方，并创建 v6 需要的 `changes/`、`changes/findings/`、`changes/corrections/`。如果目标已存在 `changes/` 或已有 `.v5-backup`，脚本默认拒绝重复执行，确认需要重跑时才使用 `--force`。

---

## 安装

```bash
# 在 Claude Code 中执行（2 条命令）
/plugin marketplace add paceaitian/paceflow
/plugin install paceflow@paceaitian-paceflow
```

安装后 9 个 hook 脚本（8 类 hook 事件）+ 4 个用户 skill + `artifact-writer` agent 自动注册，零配置。重启 Claude Code 生效。

> **可选**：设置环境变量 `PACE_VAULT_PATH` 指向你的 Obsidian Vault。新项目首次写代码或派 `artifact-writer` 时，PACEflow 会要求主 session 询问 artifact 存放在 `$PACE_VAULT_PATH/projects/<项目名>/` 还是本地项目目录，并把选择持久化到 `.pace/artifact-root`；`local` 表示本地项目根目录，不是 `.pace/`。已有 `changes/` 的项目沿用现有位置。真实 Git worktree 和 `.claude/worktrees/<name>` 会自动归一到宿主项目名；也可用 `PACE_PROJECT_NAME` 显式指定项目名。自动化/headless 环境可设置 `PACE_ARTIFACT_ROOT=local|vault|/abs/path` 跳过询问。

---

## 特色功能

### Superpowers 全流程集成

无缝对接 [Superpowers](https://github.com/andyjakubowski/superpowers)，从需求探索到代码交付的全链路自动化：

```
brainstorming（需求探索 + 方案设计）
  → writing-plans（生成实施计划）
      → pace-bridge（派 artifact writer 创建 v6 CHG）
      → auto-APPROVED（设计阶段已参与决策，跳过重复审批）
        → 选择执行策略（串行 / 并行 agent / TDD）
```

用户只需参与设计决策，后续 `changes/<id>.md`、任务编号、变更 ID 和索引全部由 agent 自动生成。不使用 Superpowers 时回退 PACE 原生规划。

### Claude Code `/plan` 桥接

原生支持 Claude Code 的 `/plan` 模式——计划文件自动检测，pace-bridge skill 一键转换为 PACE v6 CHG（`changes/<id>.md` + task/impl 索引）。Compact 后计划丢失？自动恢复提醒。

### 智能上下文管理

索引文件活跃内容和活跃 CHG 摘要每次会话自动注入，按相关性智能截断：

- 已完成的变更/调研/工作记录自动省略
- walkthrough 只保留最近记录，findings 只注入未解决项
- **token 消耗降低 57%**，大幅减少 Compact 频率

### Obsidian 知识中枢

设置 `PACE_VAULT_PATH` 后解锁跨项目知识管理：

- 首次启用可选择将 Artifact 存储到 `projects/<项目名>/` 或本地项目目录，选择写入 `.pace/artifact-root`
- Git worktree 自动沿用宿主项目的 artifact 目录，避免临时 worktree 分叉出独立记录
- `artifact-writer` 派遣前会获取项目级写锁，避免多个 worktree 同时创建同一个 CHG ID 或抢写索引
- `knowledge/` + `thoughts/` 沉淀可复用经验
- 会话启动自动注入关联笔记摘要
- 兼容 Obsidian Tasks / Dataview 跨项目查询

### Agent Teams 兼容性

Teammate 身份自动检测（`CLAUDE_CODE_TEAM_NAME` 环境变量），阻止性 hook 降级为提示性建议，信息性 hook 保持生效，多 agent 协作不中断。

---

## 工作原理

### 8 类 Hook 事件覆盖完整生命周期

| Hook | 触发时机 | 做什么 |
|------|----------|--------|
| **SessionStart** | 会话开始 / Compact 后 | 注入索引活跃区 + 活跃 CHG 摘要 |
| **PreToolUse:Write/Edit/MultiEdit** | AI 写代码前 | 无活跃 CHG / 无审批 / 状态不一致 → deny |
| **PreToolUse:TaskCreate/TaskUpdate/TodoWrite** | AI 操作任务列表 | 校验与 `changes/<id>.md` 任务清单一致性 |
| **PostToolUse** | AI 写代码后 | schema/wikilink/归档/correction 提醒 |
| **PostToolUseFailure** | 写入/验证工具失败后 | 提醒不要把失败工具调用视为完成 |
| **SubagentStop** | `artifact-writer` 结束后 | 观察报告标题/状态并记录 transcript |
| **Stop** | AI 想结束会话 | 未完成 / 未验证 / 未归档 → exit 2 阻止退出 |
| **PreCompact** | Compact 前 | 快照当前状态，防丢失 |
| **StopFailure** | API 错误中断 | 记录异常中断事件 |

### 多信号自动激活

PACEflow 自动检测项目是否需要 PACE 流程，无需手动配置：

| 信号 | 条件 | 说明 |
|------|------|------|
| 已有 artifact | 项目中存在 `changes/` | 最强信号 |
| Superpowers 计划 | `docs/plans/` 下有计划文件 | 自动桥接 |
| 手动标记 | `.pace-enabled` 文件存在 | 显式启用 |
| 代码文件数 | 项目根目录 3+ 代码文件 | 兜底检测 |
| 豁免 | `.pace/disabled` 文件存在 | 最高优先级跳过 |

### 防无限循环

Stop hook 连续阻止 3 次后自动降级为放行，防止 AI 陷入死循环。SessionStart 重置计数器。

---

## 项目结构

```
paceflow/
├── .claude-plugin/plugin.json        # Plugin 元数据
├── agents/                           # Artifact writer agent
│   └── artifact-writer.md
├── agent-references/                 # Agent 运行规范与 instruction contracts
│   ├── artifact-writer-spec.md
│   └── instructions/
├── hooks/                            # 9 个 Hook 脚本 + 公共工具
│   ├── hooks.json                    #   自动注册配置
│   ├── pace-utils.js                 #   公共工具库
│   ├── pre-tool-use.js               #   写代码前：任务检查 + 审批检查
│   ├── post-tool-use.js              #   写代码后：归档提醒 + 格式检查
│   ├── post-tool-use-failure.js      #   工具失败后：恢复提示
│   ├── session-start.js              #   会话启动：上下文注入
│   ├── subagent-stop.js              #   artifact-writer 报告观察
│   ├── stop.js                       #   会话结束：完成度检查
│   ├── stop-failure.js               #   API 错误中断：事件日志
│   ├── task-list-sync.js             #   任务列表：一致性校验
│   ├── pre-compact.js                #   Compact 前快照
│   └── templates/                    #   6 个 artifact 模板 + 1 个 knowledge 模板
├── skills/                           # 4 个用户 Skill
│   ├── pace-workflow/                #   PACE 核心流程
│   ├── pace-bridge/                  #   Superpowers 桥接
│   ├── artifact-management/          #   Artifact + 变更管理规则
│   └── pace-knowledge/               #   Obsidian 知识库管理
├── internal/                          # 内部开发资料，不随 marketplace 发布
│   └── skills/audit/                 #   PaceFlow 自身审计流程
└── tests/                            # Hook + agent contract 测试
```

---

<details>
<summary><strong>技术细节（Hook I/O 协议、状态文件、兼容性）</strong></summary>

## Hook I/O 协议

| Hook | 输入 | 成功输出 | 阻止方式 |
|------|------|----------|----------|
| SessionStart | stdin JSON（eventType）| stdout 纯文本 | N/A |
| PreToolUse | stdin JSON（tool_name, tool_input）| stdout JSON（additionalContext / permissionDecision）| `permissionDecision: "deny"` |
| PostToolUse | stdin JSON（tool_name, tool_input）| stdout JSON（additionalContext）| N/A（仅提醒）|
| Stop | stdin JSON（stop_hook_active）| stderr + exit 2 | `exit 2` |
| PreCompact | stdin JSON | 无 stdout（写 `.pace/pre-compact-state.json` 快照）| N/A |
| PostToolUseFailure | stdin JSON | stdout JSON（additionalContext）| N/A |
| SubagentStop | stdin JSON | stdout JSON（additionalContext）| N/A |
| StopFailure | stdin JSON | 无 stdout | 记录日志 |

**关键规则**：
- `exit 0 + stderr` = 完全忽略（AI 看不到）
- `exit 0 + JSON stdout additionalContext` = AI 能看到
- `exit 2 + stderr` = 阻止操作 + stderr 反馈给 AI

## 运行时状态文件（`.pace/`）

| 文件 | 用途 |
|------|------|
| `stop-block-count` | Stop 连续阻止计数（≥3 降级）|
| `degraded` | 降级标记 |
| `task-list-used` | 本会话是否用过 Claude 任务列表工具 |
| `artifact-root` | artifact 存放位置选择：`local` / `vault` / 绝对路径 / 相对路径 |
| `artifact-writer.lock` | artifact-writer 写锁，防止多 worktree / 多 session 并发抢写 CHG ID 与索引 |
| `disabled` | 豁免标记（用户手动创建）|
| `synced-plans` | 已桥接的 plan 文件列表 |

## 三级触发（PreToolUse）

| 级别 | 条件 | 动作 |
|------|------|------|
| Deny | 强信号 + 无活跃任务 | deny + 懒创建模板 |
| Deny | Write 将达 3+ 代码文件阈值 | deny（前瞻检测）|
| Soft Warn | 1-2 代码文件 | additionalContext 提醒 |

## C/V 阶段检查

- **C 阶段**：详情文件有 `<!-- APPROVED -->` 且状态可执行 → 放行。无批准 → deny，并提示用户批准后用 `approve-and-start approval-confirmed:true approval-source approval-evidence task-id`
- **V 阶段**：验证结果必须由主 session 先运行并读取；通过后优先 `close-chg complete-open-tasks:true`，一次完成最后任务收口、VERIFIED、归档和 walkthrough。`update-chg action=verify` 只用于暂不归档

## Subagent / Agent Teams 兼容性

**Subagent**（Task 工具）：在主进程内执行，共享 hooks，所有 hook 均生效。

**Agent Teams**：独立进程，各自加载 hooks。`isTeammate()` 自动检测 teammate 身份：
- 阻止性 hook → 降级为 HINT
- 信息性 hook → 保持生效

**已知限制**：
- task-list-sync 无法区分团队任务与 PACE 任务（等待官方 `agent_id` 字段）
- 多 teammate 并发修改 `.pace/` 理论竞态风险（未实际触发）

## 日志

共享日志写在当前安装的插件 hooks 目录中，例如 `~/.claude/plugins/cache/paceaitian-paceflow/paceflow/<version>/hooks/pace-hooks.log`；本仓库本地测试会写 `hooks/pace-hooks.log`。

</details>

<details>
<summary><strong>版本历史</strong></summary>

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v6.0.34 | 2026-05-08 | 修复全面审计确认项：Bash artifact/lock 写保护改为解析等价路径；worktree 运行态 `.pace` 统一到宿主项目；`artifact-root=vault` 缺 `PACE_VAULT_PATH` 时 fail-closed；Stop 防循环计数在 `.pace` 缺失时仍可降级但 idle PASS 不落盘；C/V 与 PostToolUse artifact 判定统一到 artifact root；同步 `close-chg`、`pace-bridge`、correction/knowledge 文档契约 |
| v6.0.33 | 2026-05-08 | 修复 production Smoke0-5 暴露的问题：Bash 不再允许删除/改写 `.pace/artifact-writer.lock`；锁 payload 不再暴露 hook `pid`；并发锁拒绝文案改为等待/重试；idle code-count Stop 不再打扰首次闲聊；runtime config 写入不再触发无任务提醒；artifact-writer 顺序写索引时抑制瞬时不一致噪声；worktree local 模式显示修正；lifecycle prompt 字段支持 `field=value` 与中文逗号分隔 |
| v6.0.32 | 2026-05-08 | 修复 artifact-writer Agent 失败恢复链路：`PostToolUseFailure` matcher 覆盖 `Agent`，Agent 工具失败时会立即释放项目级 artifact 写锁，不必等待 TTL |
| v6.0.31 | 2026-05-08 | 增加 session_id 日志串联与 artifact-writer 项目级写锁：多 worktree / 多 session 并发派 artifact-writer 时会串行化 artifact 写入，避免 CHG-ID、索引和归档竞争；明确 `T-NNN` 是 CHG 内局部编号 |
| v6.0.30 | 2026-05-08 | 新增 v5 升级半自动迁移保护：hook 检测 legacy v5 artifact 时先要求用户确认迁移，不再让懒创建 `changes/` 混入旧 v5 根文件；迁移脚本增加 `changes/` / `.v5-backup` 防重复执行 guard |
| v6.0.29 | 2026-05-08 | 清理发布面：`audit` skill 移至 `internal/skills/audit`，不再随 marketplace 发布；修正 PreCompact I/O、ARCHIVE 标记范围、guidebook/action-plan 历史状态等文档口径 |
| v6.0.28 | 2026-05-08 | 修复 v6.0.27 审计确认项：`close-chg` 派遣强制 `complete-open-tasks:true`，统一 verified-date 检测，补 compact snapshot 边界、knowledge 时间戳示例与 hook 数量文档；移除对 plugin 安装链路无保护价值的 `ConfigChange` / `config-guard` |
| v6.0.27 | 2026-05-07 | 吸收 Claude Code 2.1.76-2.1.131 调研中的低风险 P1：新增 `SubagentStop` artifact-writer 报告协议观察、`PostToolUseFailure` 工具失败恢复提示、SessionStart 50KB 输出保护，并补齐 startup/compact/PreCompact/StopFailure 继承测试 |
| v6.0.26 | 2026-05-07 | 明确 artifact root 选择语义：`local` 是项目根目录而非 `.pace/`；PreToolUse / SessionStart / skill / agent 提示统一说明 `.pace/` 仅存配置与运行态；结构化 hook 日志新增 `ROUTE`、`artifact_dir`、`choice` 等字段并单行化多行 reason |
| v6.0.25 | 2026-05-07 | C 阶段确认语义收紧：`approve` 与 `approve-and-start` 都必须带 `approval-confirmed/source/evidence`；`approve` 只允许纯批准，若要开始执行必须用 `approve-and-start`；create-chg 后续提示改为优先合并批准+开始 |
| v6.0.24 | 2026-05-07 | 收紧 lifecycle agent prompt 语义：`approve-and-start` 缺 `approval-confirmed:true` 会被拒绝；禁止把 `update-status` 与 `verify` 串成一次派遣；`close-chg` 必须带验证确认和摘要字段，并推荐 `complete-open-tasks:true` 合并最后任务收尾 |
| v6.0.23 | 2026-05-07 | 修复 Bash artifact 写保护误判：`grep "^<!-- ARCHIVE -->$" artifact.md` 这类只读 HTML 注释匹配不再被 `>` 重定向检测误拦；真正写入 artifact 的重定向仍会被拒绝 |
| v6.0.22 | 2026-05-07 | 修复 artifact CRLF 换行导致 `Edit` 匹配失败的问题：模板写入统一 LF，`Edit/MultiEdit` 前自动归一化已有 artifact 换行，并新增 Bash 侧 artifact 写保护，禁止用 `sed -i` / 重定向等绕过 Write/Edit hook |
| v6.0.21 | 2026-05-07 | 修复 `artifact-writer` prompt 中 `artifact_dir` 子串误匹配：现在必须精确匹配 hook 解析出的 artifact 根目录，`/project/docs` 这类错误子目录会被 deny，避免 agent 写出第二套 artifact |
| v6.0.20 | 2026-05-07 | 修复 SessionStart 在首次启用或选择 local 时创建 Obsidian 空项目目录的副作用；vault 项目目录只在用户选择 vault 或 vault 已有 artifact 时创建 |
| v6.0.19 | 2026-05-07 | 修复首次选择 artifact root 后直接派 `artifact-writer` 的初始化缺口：`PreToolUse:Agent` 在放行前会创建所选 local/vault 的 `changes/` 与根索引模板，失败时 fail-closed，禁止 agent 自行创建 base `changes/` |
| v6.0.18 | 2026-05-07 | artifact 目录首次选择改为真正动手前触发：SessionStart 只记录 pending，不再向普通闲聊注入选择提示；PreToolUse 写代码/派 artifact-writer 时仍强制询问 |
| v6.0.17 | 2026-05-07 | 修复首次 artifact 目录选择的容错：`.pace/artifact-root` / `PACE_ARTIFACT_ROOT` 支持带引号和大小写差异的 `local` / `vault`；SessionStart 非 git 项目不再泄漏 git fatal stderr |
| v6.0.16 | 2026-05-07 | 新项目首次懒创建时支持选择 artifact 存放位置（Obsidian vault project 或本地项目目录），选择持久化到 `.pace/artifact-root`；worktree 沿用宿主选择，自动化可用 `PACE_ARTIFACT_ROOT` 跳过询问 |
| v6.0.15 | 2026-05-06 | 新增 `update-chg action=approve-and-start` 与 `close-chg`，合并批准+开始、验证+归档收尾链路；hook/skill/guidebook 同步推荐合并操作 |
| v6.0.14 | 2026-05-06 | `todowrite-sync.js` 更名为 `task-list-sync.js`，公开文档统一为 Claude 任务列表同步；Stop 对活跃区残留 `archived/cancelled/[-]` 增加阻断修复 |
| v6.0.13 | 2026-05-06 | Stop / SessionStart / Claude 任务列表同步改用统一 CHG 分类器，planned backlog 不再阻断 Stop 或计入当前任务列表 |
| v6.0.11 | 2026-05-06 | 修复 worktree 本地 `changes/` 详情 artifact 分裂风险；PACE 项目写入 hook 解析失败 fail-closed；显式覆盖 MultiEdit；SessionStart 任务列表提示改看详情 T-NNN；worktree 识别收紧；marker 日志补 agent 身份；plugin validate clean pass |
| v6.0.10 | 2026-05-06 | 重新验证 Claude Code 任务工具语义：交互式 `TaskCreate/TaskUpdate` + 非交互/SDK `TodoWrite` 双轨；任务同步提示改为 Claude 任务列表，并补 TaskCreate/TaskUpdate 回归测试 |
| v6.0.9 | 2026-05-06 | 修复 `artifact-writer` subagent 写入 `APPROVED` / `VERIFIED` 被 PreToolUse 误伤；主 session 直接手写仍 deny |
| v6.0.8 | 2026-05-06 | 修复 worktree artifact 路由：Git worktree 归一到宿主项目名，优先沿用 `$PACE_VAULT_PATH/projects/<project>/changes` |
| v6.0.7 | 2026-05-06 | agent 显示名改为 `artifact-writer` 并添加 `color: orange`；审计 skill 改为 `audit`；legacy v5 活跃分支统一提示迁移/桥接 |
| v6.0.6 | 2026-05-05 | 将 `artifact-writer` 默认提升为 `effort: max`；新增 production release gate（20 个结构性用例，不含 D2）；production 资源预算改为 warning，TC-D2 作为内容保真 benchmark |
| v6.0.5 | 2026-05-05 | 收紧 `create-chg` 必填字段失败路径，明确 `record-finding body` 必须原样写入，并补强 fixture unchanged 验证 |
| v6.0.4 | 2026-05-05 | 修复 Phase B baseline 缺口：base `changes/` 不再懒创建，未知 operation 固定 `out-of-scope`，`report_title_strict` 改为第一行严格校验 |
| v6.0.3 | 2026-05-05 | 将 `report_title_strict` 硬约束同步到 runner prompt、通用 spec 与 create-chg instruction |
| v6.0.2 | 2026-05-05 | 收紧 TC-A1 agent prompt 路径，避免无关索引读取、插件目录搜索和报告统计工具调用 |
| v6.0.1 | 2026-05-05 | 校准 agent fixture 资源预算，补齐 duration/tool-use 校验，收紧 artifact writer 资源纪律 |
| v6.0.0 | 2026-05-04 | 引入 `artifact-writer` agent，v6-only `changes/` 详情模型，C/V 双表示验证 |

历史版本见 `CHANGELOG.md`。

</details>

## 友链

在此特别感谢 linuxdo，学 AI 上 [Linux.do](https://linux.do)

---

**版本**: v6.0.34 | **运行时**: Node.js | **平台**: Windows / macOS / Linux | **协议**: PACE (Plan-Artifact-Check-Execute-Verify)
