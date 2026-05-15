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

### CHG 是最小变更单元

CHG/HOTFIX 不是大计划容器，而是连续执行、可验证、可关闭的最小变更单元。大计划应拆成多个可以独立完成和验证的 CHG，例如数据结构/迁移、后端接口、前端调用、文档/配置分别记录。

每个 CHG 内可以有多个 `T-NNN`，但这些任务应服务于同一个闭环，并默认在一次执行流中完成。连续执行时不需要为每个中间任务都派 `update-status`；验证通过后优先用 `close-chg complete-open-tasks:true` 一次收口、写 VERIFIED、归档并写 walkthrough。

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
PLUGIN_DIR="$HOME/.claude/plugins/cache/paceaitian-paceflow/paceflow/<installed-version>"
ARTIFACT_DIR="/path/to/Obsidian/projects/<project-name>"

node "$PLUGIN_DIR/migrate/batch-archive-v5.js" "$ARTIFACT_DIR" --dry-run
# 阅读 dry-run 摘要并确认后再执行：
node "$PLUGIN_DIR/migrate/batch-archive-v5.js" "$ARTIFACT_DIR"
```

将 `<installed-version>` 替换为当前已安装的 PaceFlow 版本目录。

迁移脚本会把旧 v5 内容备份为 `*.v5-backup`，再把旧内容移动到 `<!-- ARCHIVE -->` 下方，并创建 v6 需要的 `changes/`、`changes/findings/`、`changes/corrections/`。旧文件顶部 frontmatter 会在归档区转换为历史 YAML 代码块，避免看起来像第二个活动 frontmatter。如果目标已存在 `changes/` 或已有 `.v5-backup`，脚本默认拒绝重复执行；确认需要重跑时才使用 `--force`，且 `--force` 会优先使用已有 `.v5-backup` 作为迁移源，不覆盖备份。

---

## 安装

当前版本的 hook 注册使用 Claude Code `2.1.139` 新增的 `hooks[].args` exec form。请使用 Claude Code `2.1.139` 或更高版本；`2.1.138` 及更早版本不支持该字段，可能只执行 `command: "node"` 而不传脚本路径，导致 hook 没有实际运行。

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
- `artifact-writer` 派遣前可用 `hooks/reserve-artifact-id.js` 预留 CHG/CORRECTION 编号；pace-bridge 收尾可用 `hooks/sync-plan.js` 标记 plan 已同步；真实写入时按详情文件或索引资源短暂加锁，多 worktree 只在共享索引写入窗口串行
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
├── .claude-plugin/marketplace.json   # Marketplace 入口；source 指向 ./plugin
├── plugin/                           # 发布运行时根目录
│   ├── .claude-plugin/plugin.json    #   Plugin 元数据
│   ├── agents/                       #   Artifact writer agent
│   │   └── artifact-writer.md
│   ├── agent-references/             #   Agent 运行规范与 instruction contracts
│   │   ├── artifact-writer-spec.md
│   │   └── instructions/
│   ├── hooks/                        #   9 个 Hook 脚本 + 公共工具
│   │   ├── hooks.json                #     自动注册配置
│   │   ├── pace-utils.js             #     公共工具库
│   │   ├── pre-tool-use.js           #     写代码前：任务检查 + 审批检查
│   │   ├── pre-tool-use/             #     PreToolUse guard helper modules
│   │   │   ├── agent-lifecycle-guard.js
│   │   │   ├── bash-guard.js
│   │   │   └── marker-guard.js
│   │   ├── post-tool-use.js          #     写代码后：归档提醒 + 格式检查
│   │   ├── post-tool-use-failure.js  #     工具失败后：恢复提示
│   │   ├── session-start.js          #     会话启动：上下文注入
│   │   ├── subagent-stop.js          #     artifact-writer 报告观察
│   │   ├── stop.js                   #     会话结束：完成度检查
│   │   ├── stop-failure.js           #     API 错误中断：事件日志
│   │   ├── task-list-sync.js         #     任务列表：一致性校验
│   │   ├── pre-compact.js            #     Compact 前快照
│   │   └── templates/                #     6 个 artifact 模板 + 1 个 knowledge 模板
│   ├── skills/                       #   4 个用户 Skill
│   │   ├── pace-workflow/            #     PACE 核心流程
│   │   ├── pace-bridge/              #     Superpowers 桥接
│   │   ├── artifact-management/      #     Artifact + 变更管理规则
│   │   └── pace-knowledge/           #     Obsidian 知识库管理
│   └── migrate/                      #   v5 → v6 半自动迁移脚本
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
| `locks/artifacts/*.lock` | artifact resource lock；按详情文件或索引资源保护真实写入窗口 |
| `sequences/*.counter` | CHG/HOTFIX/CORRECTION 编号计数器，由 hook 原子分配 |
| `reservations/*.json` | 当前 session/agent 的预留编号 |
| `index-transactions/*.json` | `task.md` + `implementation_plan.md` 成对索引写入事务 |
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

共享日志写在当前安装的插件 hooks 目录中，例如 `~/.claude/plugins/cache/paceaitian-paceflow/paceflow/<version>/hooks/pace-hooks.log`；本仓库本地测试会写 `plugin/hooks/pace-hooks.log`。

</details>

<details>
<summary><strong>版本历史</strong></summary>

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v6.0.55 | 2026-05-12 | 修复 v6.0.54 Smoke3/4 后续缺口：首次 root-choice SessionStart 输出当前 reserve helper 命令；helper 明确拒绝 `--artifact-dir` / `--artifact-root` / `--project-dir`；当前 session owner 的 README/文档/配置等非代码写入也进入 C/E gate，foreign fresh owner 不阻断普通非代码写入但结构损坏仍全局阻断；SubagentStop 兜底清理 close/archive 后的 owner `closing` 残留 |
| v6.0.54 | 2026-05-12 | 修复 worktree 完成记录可读性：close/archive 写 `walkthrough.md` 时同步保留索引行的 `[worktree:: ...] [branch:: ...]` 执行上下文；PostToolUse/Stop 机械校验 walkthrough 行与 task/implementation 索引上下文一致 |
| v6.0.53 | 2026-05-12 | 收紧 worktree owner 边界：SessionStart/PreCompact active CHG 摘要 owner-aware，foreign owner CHG 在活跃区注入中折叠且不计入当前 session 任务列表；Stop 对 foreign running/closing 降噪但仍阻断结构不一致；代码阶段工具调用刷新 owner heartbeat；update/close/archive 要求显式 target；close/archive Agent 只有目标离开活跃索引后才标记 owner closed |
| v6.0.52 | 2026-05-12 | 修复 production Smoke1-6 暴露的 v5 最小 fixture 迁移漏检、helper 旧版本路径误导、`--artifact-dir` 静默忽略、close/archive 半归档恢复、worktree 跨 session Stop 干扰和宿主普通文件误写；新增 `.pace/change-owners` 运行态 owner、索引 execution-context 与 worktree 普通文件保护 |
| v6.0.51 | 2026-05-11 | 拆分 `pre-tool-use.js` 热路径：Bash 写保护、artifact-writer Agent 生命周期门禁、C/V marker 与直接 artifact mutation 判断分别下沉到 `hooks/pre-tool-use/*-guard.js` helper；主入口保留事件路由、输出和日志，降低后续审计/修改误碰风险 |
| v6.0.50 | 2026-05-10 | 收紧 CHG 粒度语义：CHG 是连续执行、可验证、可关闭的最小变更单元，大计划应拆成多个 CHG；连续执行默认由 `close-chg complete-open-tasks:true` 收口，`update-status` 只用于暂停/阻塞/跳过/跨 session/长任务可见性。新增 `hooks/reserve-artifact-id.js` helper，主 session 可先预留 create-chg / record-correction 编号；新增 `hooks/sync-plan.js` helper，pace-bridge 收尾可幂等写入宿主 `.pace/synced-plans` |
| v6.0.49 | 2026-05-10 | 补齐 production Smoke1 暴露的 Paceflow skill 入口提示：首次启用 SessionStart 只注入轻量 `Skill(paceflow:pace-workflow)` 提醒；artifact-root 选择、reserved-id 重派、approve-and-start 缺字段、close-chg 缺验证摘要等 hook deny 均提示读取 `paceflow:pace-workflow` / `paceflow:artifact-management`；扩宽 workflow skill 触发描述，覆盖已启用 PACEflow 项目中的 1-2 文件代码修改 |
| v6.0.48 | 2026-05-10 | 修复 production Smoke1 暴露的 artifact-writer reserved-id 传递缺口：不再依赖 `PreToolUse:Agent additionalContext` 被 subagent 读取；`create-chg` / `record-correction` 首次派遣会先预留编号并 deny，要求主 session 把 `reserved-id` / `reserved-file` 或 `reserved-file-prefix` 原样写入 prompt 后重派；同时收紧首次 artifact-root 选择后的提示，避免直接重试代码写入而跳过 create/approve 流程 |
| v6.0.47 | 2026-05-10 | 重构 artifact-writer 并发锁：Agent 派遣不再持有项目级锁；create-chg / record-correction 由 hook 原子预留编号；真实 Write/Edit/MultiEdit 按资源短暂加锁，详情文件可并发写入，`task.md` + `implementation_plan.md` 作为一组索引事务串行；Bash/Write/Edit/MultiEdit 禁止手写 `.pace/locks` / `sequences` / `reservations` / `index-transactions` 控制面 |
| v6.0.46 | 2026-05-09 | 补齐 P2 release sanity：plugin manifest 与 marketplace version 纳入单元测试，plugin runtime root 机械检查不含 docs/tests/internal/ticket 等开发资料；agent baseline 扩到 29 case，Phase C 增加 close-chg、archive-chg、record-finding、record-correction 正向 contract |
| v6.0.45 | 2026-05-09 | 修复 production dogfood 暴露的 native plan 桥接收尾遗漏：pace-bridge Step 5 改为硬收尾，明确将源 plan basename 幂等写入宿主项目运行态 `.pace/synced-plans`；PreToolUse / SessionStart 的桥接提醒同步给出实际 synced-plans 路径，worktree 场景不再依赖模型猜测路径 |
| v6.0.44 | 2026-05-09 | 优化 v5→v6 归档式迁移可读性和重跑安全性：旧 v5 文件顶部 frontmatter 不再原样落在 `<!-- ARCHIVE -->` 下方，而是转换为“v5 原始 frontmatter”历史 YAML 代码块；归档区增加 v5 历史说明，旧 H1 继续降级；`--force` 遇到已有 `.v5-backup` 时使用备份作为迁移源且不覆盖备份 |
| v6.0.43 | 2026-05-09 | 修复真实 `ccauth` worktree 暴露的迁移提示断点：PreToolUse / Stop / PostToolUse / PostToolUseFailure / TaskSync / SubagentStop 的 artifact 相关拦截和提醒统一带当前 Artifact 根目录；legacy v5 下 Bash 手动 `mkdir changes/` 会被拦截，避免把旧 vault 伪装成未迁移的 v6 |
| v6.0.42 | 2026-05-09 | 加固 v5→v6 归档式迁移脚本：legacy 文件内多个 `<!-- ARCHIVE -->` 历史边界会全部降级为 v5 历史注释，迁移后仍只保留一个 v6 标准 ARCHIVE 标记；同时兼容 CRLF legacy 文件。已用真实 `ccauth` v5 vault 副本完成 dry-run 与正式迁移 rehearsal |
| v6.0.41 | 2026-05-09 | 修复 Smoke6 暴露的 artifact 直接编辑绕过：主 session / 非 artifact-writer 现在不能用 `Write` / `Edit` / `MultiEdit` 直接修改 `task.md`、`implementation_plan.md`、`walkthrough.md`、`findings.md`、`corrections.md` 或 `changes/**`；这些流程 artifact 只能由持有写锁的 `paceflow:artifact-writer` 写入。`spec.md` 仍是项目规格文件，不归 artifact-writer 管理 |
| v6.0.40 | 2026-05-09 | 修复 Smoke4 暴露的 legacy v5 迁移提示歧义：hook 现在明确说明被拒绝的工具调用没有落盘、dry-run 后必须再次询问用户确认、迁移只处理 artifact 状态且原始代码任务仍需按 v6 P-A-C 重试；Smoke 手册同步区分迁移确认前/后的预期 |
| v6.0.39 | 2026-05-09 | 同步 Claude Code native build 工具面变化：主 session 可能没有独立 `Glob` / `Grep` 工具，skill / smoke 文档改为允许只读 Bash `find` / `rg` / `grep` fallback；不改变 hook 行为 |
| v6.0.38 | 2026-05-09 | 代码质量收尾：PostToolUse 对同一 CHG 的状态类提醒改为每会话一次；SessionStart 清理对应 per-CHG flags；`PACE_ARTIFACT_ROOT` 超长输入截断；logger lock stale 阈值从 5s 提到 30s；提取 artifact mutation 判定 helper 并补回归测试 |
| v6.0.37 | 2026-05-09 | 修复二轮审计确认项：PreCompact 只桥接匹配当前项目的 Claude native plan，避免 `~/.claude/plans` 跨项目串线；Bash artifact 写保护覆盖 `bash -c` 内层脚本、`npx --write/--fix` 与 package runner 等间接写入；Stop walkthrough 提示改为由 close-chg 自动补写；同步 artifact-root、pace-bridge 与模板说明 |
| v6.0.36 | 2026-05-09 | 修复审计确认项：findings 过期提醒改用本地日历日差，避免 UTC 解析偏差；Stop 不再对仍有 pending task 的执行中 CHG 提前要求 walkthrough；SessionStart walkthrough 截断按日期保留最近记录；清理 PostToolUse 死代码并补齐 close-chg / finding / agent reference 文档一致性 |
| v6.0.35 | 2026-05-08 | 拆分 plugin runtime root：marketplace `source` 改为 `./plugin`，发布包只包含 hooks / skills / agent / agent-references / migrate 等运行时资产，仓库根目录继续保留 docs / tests / internal / tickets 作为开发资料 |
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

v5 历史快照见 `CHANGELOG.md`；v6 当前历史以本表为准。

</details>

## 友链

在此特别感谢 linuxdo，学 AI 上 [Linux.do](https://linux.do)

---

**版本**: v6.0.55 | **运行时**: Node.js | **平台**: Windows / macOS / Linux | **协议**: PACE (Plan-Artifact-Check-Execute-Verify)
