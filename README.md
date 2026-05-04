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

### 6 个索引文件 + changes/详情 = 项目记忆

| 文件 | 用途 |
|------|------|
| `spec.md` | 项目元数据、技术栈 |
| `task.md` | CHG/HOTFIX 任务索引 |
| `implementation_plan.md` | CHG/HOTFIX 实施索引 |
| `findings.md` | finding 摘要索引 |
| `corrections.md` | correction 摘要索引 |
| `walkthrough.md` | 工作总结索引 |
| `changes/` | CHG/HOTFIX/finding/correction 详情文件 |

索引文件使用 `<!-- ARCHIVE -->` 分隔：活跃区保持精简，归档区保留历史。详情文件由 `paceflow-artifact-writer` agent 统一维护。

---

## 安装

```bash
# 在 Claude Code 中执行（2 条命令）
/plugin marketplace add paceaitian/paceflow
/plugin install paceflow@paceaitian-paceflow
```

安装后 9 个 hook + 5 个 skill + `paceflow-artifact-writer` agent 自动注册，零配置。重启 Claude Code 生效。

> **可选**：设置环境变量 `PACE_VAULT_PATH` 指向你的 Obsidian Vault，artifact 将自动存储到 `$PACE_VAULT_PATH/projects/<项目名>/`，实现跨项目知识沉淀。

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

- Artifact 自动存储到 `projects/<项目名>/`
- `knowledge/` + `thoughts/` 沉淀可复用经验
- 会话启动自动注入关联笔记摘要
- 兼容 Obsidian Tasks / Dataview 跨项目查询

### Agent Teams 兼容性

Teammate 身份自动检测（`CLAUDE_CODE_TEAM_NAME` 环境变量），阻止性 hook 降级为提示性建议，信息性 hook 保持生效，多 agent 协作不中断。

---

## 工作原理

### 9 个 Hook 覆盖完整生命周期

| Hook | 触发时机 | 做什么 |
|------|----------|--------|
| **SessionStart** | 会话开始 / Compact 后 | 注入索引活跃区 + 活跃 CHG 摘要 |
| **PreToolUse:Write/Edit** | AI 写代码前 | 无活跃 CHG / 无审批 / 状态不一致 → deny |
| **PreToolUse:TodoWrite** | AI 操作任务列表 | 校验与 `changes/<id>.md` 任务清单一致性 |
| **PostToolUse** | AI 写代码后 | schema/wikilink/归档/correction 提醒 |
| **Stop** | AI 想结束会话 | 未完成 / 未验证 / 未归档 → exit 2 阻止退出 |
| **PreCompact** | Compact 前 | 快照当前状态，防丢失 |
| **ConfigChange** | 修改配置 | 保护 PACE hook 不被误删 |
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
│   ├── paceflow-artifact-writer.md
│   └── references/
├── hooks/                            # 9 个 Hook 脚本
│   ├── hooks.json                    #   自动注册配置
│   ├── pace-utils.js                 #   公共工具库
│   ├── pre-tool-use.js               #   写代码前：任务检查 + 审批检查
│   ├── post-tool-use.js              #   写代码后：归档提醒 + 格式检查
│   ├── session-start.js              #   会话启动：上下文注入
│   ├── stop.js                       #   会话结束：完成度检查
│   ├── stop-failure.js               #   API 错误中断：事件日志
│   ├── todowrite-sync.js             #   任务列表：一致性校验
│   ├── config-guard.js               #   配置保护
│   ├── pre-compact.js                #   Compact 前快照
│   └── templates/                    #   6 个索引模板
├── skills/                           # 5 个 Skill
│   ├── pace-workflow/                #   PACE 核心流程
│   ├── pace-bridge/                  #   Superpowers 桥接
│   ├── artifact-management/          #   Artifact + 变更管理规则
│   ├── pace-knowledge/               #   Obsidian 知识库管理
│   └── paceflow-audit/               #   5-Agent 并行审查
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

- **C 阶段**：详情文件有 `<!-- APPROVED -->` 且状态可执行 → 放行。无批准 → deny
- **V 阶段**：`status: completed` 但无 `verified-date` + `<!-- VERIFIED -->` → Stop block。已验证未归档 → Stop block

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
| v6.0.2 | 2026-05-05 | 收紧 TC-A1 agent prompt 路径，避免无关索引读取、插件目录搜索和报告统计工具调用 |
| v6.0.1 | 2026-05-05 | 校准 agent fixture 资源预算，补齐 duration/tool-use 校验，收紧 artifact writer 资源纪律 |
| v6.0.0 | 2026-05-04 | 引入 `paceflow-artifact-writer` agent，v6-only `changes/` 详情模型，C/V 双表示验证 |

历史版本见 `CHANGELOG.md`。

</details>

## 友链

在此特别感谢 linuxdo，学 AI 上 [Linux.do](https://linux.do)

---

**版本**: v6.0.2 | **运行时**: Node.js | **平台**: Windows / macOS / Linux | **协议**: PACE (Plan-Artifact-Check-Execute-Verify)
