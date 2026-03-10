# PACEflow

> 一套 Claude Code Hook 系统，通过**确定性拦截**（而非提示词建议）强制码前先规划、获批、再执行，解决 AI 编程"一上来就写代码、改着改着迷路"的问题。

## 核心理念

AI 编程最大的问题不是代码质量，而是**过程控制**——AI 会跳过规划直接写代码，写到一半迷路，改完不验证就收工。

PACEflow 不是靠 system prompt 去"建议"AI 做这些事（AI 可以无视建议），而是在 Claude Code 的 Hook 层**物理拦截**：

> **CLAUDE.md / Skill 是建议，遵守率 ~70-85%。Hooks 是规则，执行率 100%。**

- 没有 `task.md`？写代码的工具调用直接 **deny**，AI 被迫先创建任务
- `implementation_plan.md` 里没标 `[/]` 进行中？还是 **deny**
- 用 Write 覆盖已有的 artifact 文件？直接 **deny**，必须用 Edit
- 任务完成了但 walkthrough 没写？Stop hook 给 warning，**exit 2 阻止退出**

### PACE 四阶段

| 阶段 | 含义 | Hook 保障 |
|------|------|-----------|
| **P**lan | 规划任务 | PreToolUse deny 未规划的代码修改 |
| **A**rtifact | 创建/更新 5 个 artifact 文件 | 模板自动注入 + 格式守门 |
| **C**heck | 用户审批 | PreToolUse 检查 `<!-- APPROVED -->` 标记 |
| **E**xecute + Verify | 执行 + 验证 | PostToolUse 归档提醒 / Stop 完成度检查 |

### 5 个 Artifact 文件 = 项目记忆

| 文件 | 用途 |
|------|------|
| `spec.md` | 项目元数据、技术栈 |
| `task.md` | 任务分解与进度（`[ ]` / `[/]` / `[x]`） |
| `implementation_plan.md` | 技术方案、变更索引（CHG-ID） |
| `findings.md` | 调研记录、踩坑笔记 |
| `walkthrough.md` | 工作总结、验证记录 |

所有文件使用 `<!-- ARCHIVE -->` 分隔：活跃区保持精简，归档区保留历史。

---

## 安装

```bash
# 在 Claude Code 中执行（2 条命令）
/plugin marketplace add paceaitian/paceflow
/plugin install paceflow@paceaitian-paceflow
```

安装后 8 个 hook + 6 个 skill 自动注册，零配置。重启 Claude Code 生效。

> **可选**：设置环境变量 `PACE_VAULT_PATH` 指向你的 Obsidian Vault，artifact 将自动存储到 `$PACE_VAULT_PATH/projects/<项目名>/`，实现跨项目知识沉淀。

<details>
<summary>手动安装 / 迁移</summary>

### 手动安装

```bash
node paceflow/install.js           # 安装缺失文件
node paceflow/install.js --force   # 强制覆盖
node paceflow/install.js --dry-run # 预览模式
```

或手动复制：`hooks/` → `~/.claude/hooks/pace/`，`skills/<name>/SKILL.md` → `~/.claude/skills/<name>/SKILL.md`，然后合并 `config/settings-hooks-excerpt.json` 到 `~/.claude/settings.json`。

### 迁移（手动 → Plugin）

```bash
node paceflow/install.js --migrate
/plugin marketplace add paceaitian/paceflow
/plugin install paceflow@paceaitian-paceflow
```

</details>

---

## 特色功能

### Superpowers 全流程集成

无缝对接 [Superpowers](https://github.com/andyjakubowski/superpowers)，从需求探索到代码交付的全链路自动化：

```
brainstorming（需求探索 + 方案设计）
  → writing-plans（生成实施计划）
    → pace-bridge（自动桥接到 PACE artifacts）
      → auto-APPROVED（设计阶段已参与决策，跳过重复审批）
        → 选择执行策略（串行 / 并行 agent / TDD）
```

用户只需参与设计决策，后续 artifact 创建、任务编号、变更 ID 全部自动生成。不使用 Superpowers 时回退 PACE 原生规划。

### Claude Code `/plan` 桥接

原生支持 Claude Code 的 `/plan` 模式——计划文件自动检测，pace-bridge skill 一键转换为 PACE 标准 artifacts（task.md + implementation_plan.md）。Compact 后计划丢失？自动恢复提醒。

### 智能上下文管理

5 个 artifact 文件的活跃内容每次会话自动注入，按相关性智能截断：

- 已完成的变更/调研/工作记录自动省略
- walkthrough 只保留最近记录，findings 只注入未解决项
- **token 消耗降低 57%**，大幅减少 Compact 频率

### Obsidian 知识中枢

设置 `PACE_VAULT_PATH` 后解锁跨项目知识管理：

- Artifact 自动存储到 `projects/<项目名>/`
- `knowledge/` + `thoughts/` 沉淀可复用经验
- 会话启动自动注入关联笔记摘要
- 兼容 Obsidian Tasks / Dataview 跨项目查询

### 5-Agent 并行审查

`/paceflow-audit` 启动 5 个专项 agent 并行审查（代码质量 / 流程完整性 / 一致性 / Skill 模板 / 架构优化），自动验证筛选误报，输出去重分级报告。

### Agent Teams 兼容性

Teammate 身份自动检测（`CLAUDE_CODE_TEAM_NAME` 环境变量），阻止性 hook 降级为提示性建议，信息性 hook 保持生效，多 agent 协作不中断。

---

## 工作原理

### 8 个 Hook 覆盖完整生命周期

| Hook | 触发时机 | 做什么 |
|------|----------|--------|
| **SessionStart** | 会话开始 / Compact 后 | 注入 5 个 artifact 活跃内容 + 重置状态 |
| **PreToolUse:Write/Edit** | AI 写代码前 | 无活跃任务 → deny；无审批 → deny |
| **PreToolUse:TodoWrite** | AI 操作任务列表 | 校验与 task.md 一致性 |
| **PostToolUse** | AI 写代码后 | 归档提醒 + 格式检查 + findings 扫描 |
| **Stop** | AI 想结束会话 | 未完成任务 → exit 2 阻止退出 |
| **PreCompact** | Compact 前 | 快照当前状态，防丢失 |
| **ConfigChange** | 修改配置 | 保护 PACE hook 不被误删 |

### 多信号自动激活

PACEflow 自动检测项目是否需要 PACE 流程，无需手动配置：

| 信号 | 条件 | 说明 |
|------|------|------|
| 已有 artifact | 项目中存在 task.md 等文件 | 最强信号 |
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
├── hooks/                            # 8 个 Hook 脚本
│   ├── hooks.json                    #   自动注册配置
│   ├── pace-utils.js                 #   公共工具库
│   ├── pre-tool-use.js               #   写代码前：任务检查 + 审批检查
│   ├── post-tool-use.js              #   写代码后：归档提醒 + 格式检查
│   ├── session-start.js              #   会话启动：上下文注入
│   ├── stop.js                       #   会话结束：完成度检查
│   ├── todowrite-sync.js             #   任务列表：一致性校验
│   ├── config-guard.js               #   配置保护
│   ├── pre-compact.js                #   Compact 前快照
│   └── templates/                    #   5 个 Artifact 模板
├── skills/                           # 6 个 Skill
│   ├── pace-workflow/                #   PACE 核心流程
│   ├── pace-bridge/                  #   Superpowers 桥接
│   ├── artifact-management/          #   Artifact 管理规则
│   ├── change-management/            #   变更 ID 管理
│   ├── pace-knowledge/               #   Obsidian 知识库管理
│   └── paceflow-audit/               #   5-Agent 并行审查
└── tests/                            # 测试（73 单元 + 61 E2E + 20 安装）
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
| PreCompact | stdin JSON | stdout JSON（additionalContext）| N/A |
| ConfigChange | stdin JSON | stdout JSON（additionalContext）| N/A |

**关键规则**：
- `exit 0 + stderr` = 完全忽略（AI 看不到）
- `exit 0 + JSON stdout additionalContext` = AI 能看到
- `exit 2 + stderr` = 阻止操作 + stderr 反馈给 AI

## 运行时状态文件（`.pace/`）

| 文件 | 用途 |
|------|------|
| `stop-block-count` | Stop 连续阻止计数（≥3 降级）|
| `degraded` | 降级标记 |
| `todowrite-used` | 本会话是否用过 TodoWrite |
| `disabled` | 豁免标记（用户手动创建）|
| `synced-plans` | 已桥接的 plan 文件列表 |

## 三级触发（PreToolUse）

| 级别 | 条件 | 动作 |
|------|------|------|
| Deny | 强信号 + 无活跃任务 | deny + 懒创建模板 |
| Deny | Write 将达 3+ 代码文件阈值 | deny（前瞻检测）|
| Soft Warn | 1-2 代码文件 | additionalContext 提醒 |

## C/V 阶段检查

- **C 阶段**：`<!-- APPROVED -->` 或 `[/]`/`[!]` 任务 → 已获批。全部 `[ ]` 且无标记 → deny
- **V 阶段**：`[x]` 完成项无 `<!-- VERIFIED -->` → Stop block。已验证未归档 → Stop block

## Subagent / Agent Teams 兼容性

**Subagent**（Task 工具）：在主进程内执行，共享 hooks，所有 hook 均生效。

**Agent Teams**：独立进程，各自加载 hooks。`isTeammate()` 自动检测 teammate 身份：
- 阻止性 hook → 降级为 HINT
- 信息性 hook → 保持生效

**已知限制**：
- todowrite-sync 无法区分团队任务与 PACE 任务（等待官方 `agent_id` 字段）
- 多 teammate 并发修改 `.pace/` 理论竞态风险（未实际触发）

## 日志

共享日志 `~/.claude/hooks/pace/pace-hooks.log`，仅记录非常规事件（DENY / BLOCK / ERROR / DOWNGRADE）。

</details>

<details>
<summary><strong>版本历史</strong></summary>

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v5.0.0 | 2026-03-07 | Plugin 化迁移（.claude-plugin + hooks.json 自动注册 + skills 目录重构） |
| v4.8.0 | 2026-03-01 | Artifact 存储迁移到 Obsidian Vault |
| v4.7.0 | 2026-02-26 | Agent Teams 全量适配（isTeammate() + 降级策略） |
| v4.6.0 | 2026-02-25 | ConfigChange + PreCompact hook（6→8 个脚本）|
| v4.5.0 | 2026-02-25 | Compact 快照 + Stop stdin 交叉验证 |
| v4.4.1 | 2026-02-25 | Obsidian 知识中枢集成 |
| v4.3.0 | 2026-02-14 | PACE + Superpowers 集成（多信号激活 + 三级触发）|
| v4.0.0 | 2026-02-13 | 三层架构补全 |
| v3.0.0 | 2026-02-12 | Node.js 迁移 |
| v1.0.0 | 2026-02-11 | 初始创建 |

</details>

---

**版本**: v5.0.2 | **运行时**: Node.js | **平台**: Windows / macOS / Linux | **协议**: PACE (Plan-Artifact-Check-Execute-Verify)
