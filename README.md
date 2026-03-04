# PACEflow — Claude Code 工作流强制执行系统

> **版本**: v4.8.0
> **运行时**: Node.js
> **平台**: Windows / macOS / Linux（需 Claude Code CLI）

## 概述

PACEflow 是一套基于 Claude Code Hooks 的工作流强制执行系统，通过 **Plan-Artifact-Check-Execute-Verify (PACE)** 协议确保 AI 编码助手遵循结构化的开发流程。

**核心能力**：
- **PreToolUse** — 写代码前必须有活跃任务，否则 deny
- **PostToolUse** — 写代码后检查归档、日期、格式等，通过 additionalContext 提醒 AI
- **SessionStart** — 会话启动时注入项目上下文，重置防循环计数器，TodoWrite 同步指令
- **Stop** — 会话结束前检查未完成任务，exit 2 阻止退出
- **PreToolUse:TodoWrite** — 拦截 TodoWrite/TaskCreate/TaskUpdate，校验与 task.md 一致性

**设计哲学**：Hooks 提供 100% 确定性保障，CLAUDE.md 提供 ~70-85% 建议性约束，两者互补。

---

## 目录结构

```
paceflow/
├── README.md                                    # 本文件
├── hooks/                                       # Hook 脚本（8 个）
│   ├── pace-utils.js                            #   公共工具函数（多信号检测、文件读取、版本号）
│   ├── pre-tool-use.js                          #   PreToolUse：三级触发 + C 阶段批准 + Write 保护
│   ├── post-tool-use.js                         #   PostToolUse：归档提醒 + findings 检查 + TodoWrite 同步
│   ├── session-start.js                         #   SessionStart：上下文注入 + 模板创建 + 跳过任务提醒
│   ├── stop.js                                  #   Stop：完成检查 + 防无限循环降级
│   ├── todowrite-sync.js                        #   PreToolUse:TodoWrite：拦截校验 task.md 一致性
│   ├── config-guard.js                          #   ConfigChange：disableAllHooks 警告 + PACE hook 删除提醒
│   ├── pre-compact.js                           #   PreCompact：Compact 前 artifact 状态快照
│   └── templates/                               #   Artifact 模板文件（5 个）
│       ├── spec.md                              #     项目规格模板
│       ├── task.md                              #     任务追踪模板
│       ├── implementation_plan.md               #     实施计划模板
│       ├── walkthrough.md                       #     工作记录模板
│       └── findings.md                          #     调研记录模板
├── skills/                                      # Skill 文件（4 个）
│   ├── pace-workflow.md                         #   PACE 协议核心流程
│   ├── artifact-management.md                   #   Artifact 文件管理规则
│   ├── change-management.md                     #   变更 ID 管理模块
│   ├── pace-knowledge.md                        #   Obsidian 知识库笔记管理
│   └── templates/                               #   Skill 模板文件（7 个）
│       ├── artifact-spec.md                     #     spec.md 模板
│       ├── artifact-task.md                     #     task.md 模板
│       ├── artifact-implementation_plan.md      #     implementation_plan.md 模板
│       ├── artifact-walkthrough.md              #     walkthrough.md 模板
│       ├── artifact-findings.md                 #     findings.md 模板
│       ├── change-record.md                     #     变更记录模板
│       └── change-implementation_plan.md        #     实施计划模板
├── config/                                      # 配置参考
│   └── settings-hooks-excerpt.json              #   settings.json hooks 段配置示例
└── rules/                                       # 规则文件
    └── CLAUDE.md                                #   全局规则（G-1 ~ G-12）
```

---

## 快速开始

### 1. 复制 Hook 脚本

将 `hooks/` 目录复制到 Claude Code 全局配置目录：

```bash
# Windows
cp -r hooks/ "$HOME/.claude/hooks/pace/"

# macOS / Linux
cp -r hooks/ ~/.claude/hooks/pace/
```

### 2. 复制 Skill 文件

将 Skill 文件复制到 Claude Code Skills 目录：

```bash
mkdir -p ~/.claude/skills/pace-workflow
mkdir -p ~/.claude/skills/artifact-management
mkdir -p ~/.claude/skills/change-management

cp skills/pace-workflow.md ~/.claude/skills/pace-workflow/SKILL.md
cp skills/artifact-management.md ~/.claude/skills/artifact-management/SKILL.md
cp skills/change-management.md ~/.claude/skills/change-management/SKILL.md

# pace-knowledge
mkdir -p ~/.claude/skills/pace-knowledge
cp skills/pace-knowledge.md ~/.claude/skills/pace-knowledge/pace-knowledge.md

# 复制 artifact-management 模板
mkdir -p ~/.claude/skills/artifact-management/templates
cp skills/templates/artifact-spec.md ~/.claude/skills/artifact-management/templates/spec.md
cp skills/templates/artifact-task.md ~/.claude/skills/artifact-management/templates/task.md
cp skills/templates/artifact-implementation_plan.md ~/.claude/skills/artifact-management/templates/implementation_plan.md
cp skills/templates/artifact-walkthrough.md ~/.claude/skills/artifact-management/templates/walkthrough.md
cp skills/templates/artifact-findings.md ~/.claude/skills/artifact-management/templates/findings.md

# 复制 change-management 模板
mkdir -p ~/.claude/skills/change-management/templates
cp skills/templates/change-record.md ~/.claude/skills/change-management/templates/change_record.md
cp skills/templates/change-implementation_plan.md ~/.claude/skills/change-management/templates/implementation_plan.md
```

### 3. 配置 settings.json

编辑 `~/.claude/settings.json`，将 `config/settings-hooks-excerpt.json` 中的 hooks 段合并进去。

**注意**：`<HOOKS_DIR>` 需替换为实际路径：
- Windows: `C:/Users/<用户名>/.claude/hooks/pace`
- macOS/Linux: `/home/<用户名>/.claude/hooks/pace`

### 4. 复制全局规则

将 `rules/CLAUDE.md` 复制为全局规则文件：

```bash
cp rules/CLAUDE.md ~/.claude/CLAUDE.md
```

> 根据个人偏好修改 G-5（沟通风格）、G-11（环境）等规则。

### 5. 重启 Claude Code

**settings.json 修改后必须重启 Claude Code 才能生效。**

---

## 核心机制

### 多信号激活检测

`isPaceProject()` 通过四种信号判断项目是否需要 PACE 流程：

| 优先级 | 信号 | 条件 | 强度 |
|--------|------|------|------|
| 0 | `disabled` | `.pace/disabled` 文件存在 | 豁免（最高优先级）|
| 1 | `artifact` | 项目已有任何 PACE artifact 文件 | 最强 |
| 2 | `superpowers` | `docs/plans/YYYY-MM-DD-*.md` 存在 | 强 |
| 3 | `manual` | `.pace-enabled` 标记文件存在 | 强 |
| 4 | `code-count` | 项目根目录 3+ 代码文件 | 弱/兜底 |

**支持的代码文件类型**（`CODE_EXTS`）：
`.ts` `.js` `.py` `.go` `.rs` `.java` `.tsx` `.jsx` `.vue` `.svelte`

### 三级触发（PreToolUse）

| 级别 | 条件 | 动作 |
|------|------|------|
| **Deny** | 强信号 + 无活跃任务 | `permissionDecision: "deny"` + 懒创建模板 |
| **Deny** | Write 新文件将达 3+ 阈值 | `permissionDecision: "deny"`（off-by-one 前瞻）|
| **Soft Warn** | 1-2 代码文件 | `additionalContext` 提醒 |

### C 阶段批准检查

- `<!-- APPROVED -->` 标记 或 `[/]`/`[!]` 任务 → 已获批准
- 全部 `[ ]` 且无 APPROVED → deny（"请先执行 C 阶段"）

### V 阶段验证检查

- `[x]` 完成项 + 无 `<!-- VERIFIED -->` → Stop block（"请执行 V 阶段验证"）
- 已验证 + 未归档 → Stop block（"请归档到 ARCHIVE 下方"）

### 防无限循环

- `.pace/stop-block-count` 文件计数
- 连续 3 次 exit 2 后降级为 exit 0
- `.pace/degraded` 标记文件通知 PostToolUse 提醒 AI
- SessionStart 重置计数器和降级标记

### Write 保护

PreToolUse 拦截对已存在的 `task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` 的 Write 操作（应使用 Edit 工具）。

### Obsidian 知识中枢（v4.4.1）

SessionStart 自动注入与当前项目关联的 `thoughts/` 和 `knowledge/` 笔记摘要。PreToolUse 在 Write 到知识库目录时注入模板提醒。

| 组件 | 机制 | 作用 |
|------|------|------|
| `pace-utils.js` `scanRelatedNotes()` | 扫描 Vault 中 frontmatter `projects` 匹配的笔记 | 返回 L0 摘要列表（最多 5 条） |
| `session-start.js` | 非 compact 事件时调用 scanRelatedNotes | 注入相关讨论和知识到上下文 |
| `pre-tool-use.js` | Write 到 `thoughts/`/`knowledge/` 时 | additionalContext 提醒遵循模板 |
| `pace-knowledge` skill | 定义 frontmatter 结构和 L0/L1/L2 分层 | AI 创建笔记时参考 |

**前置条件**：需在 `pace-utils.js` 中配置 `VAULT_PATH` 指向 Obsidian Vault 路径。

### TodoWrite 同步（4 层方案）

task.md 是任务权威来源，TodoWrite 是辅助显示。4 层缓解 compaction 后 TodoWrite 残留问题：

| 层 | 机制 | 触发时机 | 类型 |
|----|------|----------|------|
| A | SessionStart 三态注入 | 会话开始/恢复/compact | 建议性 |
| B | CLAUDE.md G-3 优先级规则 | 始终生效 | 建议性 |
| C | PostToolUse 编辑 task.md 后提醒 | 编辑 task.md | 建议性 |
| D | PreToolUse:TodoWrite 拦截校验 | AI 调用 TodoWrite/TaskCreate/TaskUpdate | 确定性（触发时）|

### findings.md 状态标记

| 标记 | 含义 | 统计 |
|------|------|------|
| `⚠️` | 未解决问题 | 计入未解决统计，PostToolUse 提醒 |
| `🔒` | 已知限制（替换 ⚠️） | 不计入统计，外部 bug 等无法修复 |
| `✅` | 已解决 | 不计入统计 |

---

## Hook I/O 协议

| Hook | 输入 | 成功输出 | 阻止方式 |
|------|------|----------|----------|
| SessionStart | - | stdout 纯文本（注入 AI 上下文）| N/A |
| PreToolUse | stdin JSON（tool_name, tool_input）| stdout JSON（additionalContext / permissionDecision）| `permissionDecision: "deny"` |
| PreToolUse:TodoWrite | stdin JSON（tool_name, tool_input）| stdout JSON（additionalContext）| N/A（仅提醒）|
| PostToolUse | stdin JSON（tool_name, tool_input）| stdout JSON（additionalContext）| N/A（仅提醒）|
| Stop | stdin JSON（stop_hook_active）| stderr + exit 2 | `exit 2`（stderr 反馈给 AI）|
| PreCompact | stdin JSON（compact 上下文）| stdout JSON（additionalContext，快照注入）| N/A |
| ConfigChange | stdin JSON（tool_input / settings）| stdout JSON（additionalContext）| N/A（仅警告）|

**关键规则**：
- `exit 0 + stderr` = 完全忽略（AI 看不到）
- `exit 0 + JSON stdout additionalContext` = AI 能看到
- `exit 2 + stderr` = 阻止操作 + stderr 反馈给 AI

---

## Artifact 文件（双区结构）

所有 Artifact 文件使用 `<!-- ARCHIVE -->` 标记分为活跃区和归档区：

| 文件 | 用途 |
|------|------|
| `spec.md` | 项目规格、技术栈、依赖 |
| `task.md` | 任务追踪（`[ ]` `[/]` `[x]` `[!]` `[-]`）|
| `implementation_plan.md` | 变更索引、技术方案 |
| `walkthrough.md` | 工作日志、每日总结 |
| `findings.md` | 调研记录、错误日志 |

**状态标记**：

| 标记 | 含义 |
|------|------|
| `[ ]` | 待开始 |
| `[/]` | 进行中 |
| `[x]` | 已完成 |
| `[!]` | 阻塞 |
| `[-]` | 已跳过 |

**关键标记**：

| 标记 | 位置 | 用途 |
|------|------|------|
| `<!-- ARCHIVE -->` | 各 artifact 文件 | 活跃区/归档区分隔 |
| `<!-- APPROVED -->` | task.md 活跃区 | C 阶段获批标记 |
| `<!-- VERIFIED -->` | task.md 活跃区 | V 阶段验证标记 |

---

## 运行时文件

Hooks 在项目根目录的 `.pace/` 子目录下维护运行时状态：

| 文件 | 用途 | 管理者 |
|------|------|--------|
| `.pace/stop-block-count` | Stop 连续阻止计数 | Stop 写入，SessionStart 重置 |
| `.pace/degraded` | 降级标记（连续 3 次 block 后）| Stop 写入，PostToolUse 读取，SessionStart 清除 |
| `.pace/todowrite-used` | 本会话是否使用过 TodoWrite | todowrite-sync 写入，Stop 检测，SessionStart 清除 |
| `.pace/disabled` | 豁免标记（禁用 PACE）| 用户手动创建 |

建议将 `.pace/` 加入 `.gitignore`。

---

## Subagent / Agent Teams 兼容性

> 以下结论基于 2026-02-16 实测（Claude Code v2.x），可能随版本更新变化。

### Subagent（Task 工具）

Subagent 在主进程内执行，**共享相同的 hooks 配置**。实测所有 hook 均对 subagent 生效：

| Hook | 行为 | 验证结果 |
|------|------|----------|
| PreToolUse (Write/Edit) | deny 阻止 subagent 写代码文件 | ✅ 生效 |
| PreToolUse (TodoWrite) | additionalContext 提醒注入 | ✅ 生效 |
| PostToolUse | 归档提醒正常触发 | ✅ 生效 |

> **注意**：GitHub #21460 声称 hooks 不对 subagent 生效，与实测矛盾（可能已修复或仅影响 plugin 级 hooks）。

### Agent Teams（实验性功能）

Agent Teams 的 teammate 是**独立的 Claude Code 进程**，各自加载 `settings.json` 中的 hooks。实测全部 5 个 hook 事件均对 teammate 生效：

| Hook | 行为 | 验证结果 |
|------|------|----------|
| SessionStart | 为 teammate 注入项目上下文 | ✅ 生效 |
| PreToolUse (Write/Edit) | deny 阻止 teammate 写代码文件 | ✅ 生效 |
| PreToolUse (TodoWrite) | additionalContext 提醒注入 | ✅ 生效 |
| PostToolUse | 归档提醒正常触发 | ✅ 生效 |
| Stop | TodoWrite 残留清理提醒 | ✅ 生效 |

### 已知限制

| 编号 | 问题 | 影响 | 状态 |
|------|------|------|------|
| 🔒 1 | todowrite-sync 无法区分团队任务与 PACE 任务 | teammate 的 TaskCreate/TaskUpdate 触发不相关 HINT（仅提醒，不阻止） | 等待官方 `agent_id` 字段支持 |
| 🔒 2 | 多 teammate 并发修改 `.pace/` 状态文件 | `stop-block-count` / `degraded` 理论竞态风险 | Agent Teams 实验性功能，单 teammate 未触发 |

**根本原因**：PreToolUse stdin JSON 不包含 `agent_id` / `agent_type` 字段，hook 无法区分请求来源（主进程 / subagent / teammate）。相关 feature request：#16126、#14859、#16424。

---

## 日志

所有 hook 共享日志文件 `~/.claude/hooks/pace/pace-hooks.log`。

**仅记录非常规事件**（v4.4.0 精简）：
- `DENY` / `DENY_WRITE_ARTIFACT` / `DENY_C_PHASE` — 拒绝操作
- `BLOCK` / `DOWNGRADE` — Stop 阻止/降级
- `ERROR` — 异常
- `CREATE_TEMPLATES` — 懒创建模板
- `SOFT_WARN` — 弱信号提醒
- `HINT` — TodoWrite 同步提示
- `SKIPPED_REMINDER` — 跨会话跳过任务提醒

常规事件（PASS/SKIP/INJECT）不记录日志。

---

## 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|----------|
| v4.4.1 | 2026-02-25 | Obsidian 知识中枢集成（scanRelatedNotes 注入 + pace-knowledge skill + PreToolUse 模板提醒 + Artifact 索引格式迁移）|
| v4.4.3 | 2026-02-25 | E 阶段前提检查（impl_plan 需 `[/]`）|
| v4.5.0 | 2026-02-25 | Compact 快照 + Stop stdin 交叉验证 + Findings 否定理由增强 |
| v4.6.0 | 2026-02-25 | ConfigChange hook + PreCompact hook（6→8 个 hook 脚本）|
| v4.7.0 | 2026-02-26 | Agent Teams 全量适配（isTeammate() + DENY 降级 + 静默放行 + 废弃 2 无效 hook）|
| v4.7.1 | 2026-02-28 | 基础设施解耦（ensureProjectInfra 独立）+ Write 新建 artifact 模板注入 |
| v4.8.0 | 2026-03-01 | Artifact 存储迁移到 Obsidian Vault（getArtifactDir 唯一解析器 + CWD 重定向 deny + 日志轮转统一）|
| v4.4.0 | 2026-02-14 | 系统审视改进（🔒 已知限制状态 + PACE_VERSION 集中化 + 日志精简 + findings 计数修复）|
| v4.3.9 | 2026-02-14 | 3-Agent 审查修复（try-catch + 版本同步 + 未使用 import 清理）|
| v4.3.8 | 2026-02-14 | ticket6 审查修复（countByStatus 统一 + [-] 扫描范围 + 死代码清理）|
| v4.3.7 | 2026-02-14 | TodoWrite 三工具名修复（TodoWrite\|TaskCreate\|TaskUpdate）|
| v4.3.6 | 2026-02-14 | PACE-TodoWrite 同步方案 A+B+C+D（4 层缓解 compaction 残留）|
| v4.3.5 | 2026-02-14 | 空项目激活方案（懒创建模板 + off-by-one 前瞻 + .pace/disabled 豁免）|
| v4.3.4 | 2026-02-14 | ticket4 审查修复（try-catch / 正则 / 阈值 / findings 降级 / .pace/ 目录）|
| v4.3.3 | 2026-02-13 | 全面审查修复（23 个问题，13/15 修复）|
| v4.3.2 | 2026-02-15 | C 阶段 APPROVED 检查 + V 阶段 VERIFIED 检查 + Write 保护 |
| v4.3.1 | 2026-02-15 | 审查修复 + DRY 重构（B1/B2 bug + D1~D3 提取公共函数）|
| v4.3.0 | 2026-02-14 | PACE + Superpowers 集成（多信号激活 + 三级触发）|
| v4.0.0 | 2026-02-13 | 三层架构补全（G-10/G-11 + hooks 覆盖扩展）|
| v3.0.0 | 2026-02-12 | Node.js 迁移 + 日志功能 |
| v2.0.0 | 2026-02-12 | Hooks V 阶段覆盖扩展 |
| v1.0.0 | 2026-02-11 | 初始 4 个 hook 脚本创建 |
