# PACEflow v4.7.0 功能与状态全景参考手册

> **最后更新**：2026-02-27 | **版本**：v4.7.0

---

## 目录

1. [概述](#1-概述)
2. [PACE 工作流阶段](#2-pace-工作流阶段)
3. [Hook 系统](#3-hook-系统)
4. [Skill 系统](#4-skill-系统)
5. [状态系统](#5-状态系统)
6. [Artifact 文件结构](#6-artifact-文件结构)
7. [特殊标记系统](#7-特殊标记系统)
8. [ID 命名规范](#8-id-命名规范)
9. [运行时状态文件](#9-运行时状态文件)
10. [配置系统](#10-配置系统)
11. [工具脚本](#11-工具脚本)
12. [Agent Teams 兼容性](#12-agent-teams-兼容性)

---

## 1. 概述

PACEflow 是一套基于 Claude Code Hooks 的工作流强制执行系统，通过 **Plan-Artifact-Check-Execute-Verify (PACE)** 协议确保 AI 编码助手遵循结构化开发流程。

### 核心设计原则

- **Hooks 提供 100% 确定性保障**：文件创建、归档提醒、完成检查、退出阻止——不依赖 AI 自觉
- **CLAUDE.md 提供 ~70-85% 建议性约束**：编码风格、沟通规范、判断性决策——靠 AI 遵守
- **两者互补**：Hooks 覆盖"必须做到"的底线，CLAUDE.md 覆盖"最好做到"的建议

### 架构总览

```
paceflow/
├── hooks/                    # 7 个 Hook 脚本 + 公共模块 + 5 个模板
│   ├── pace-utils.js         # 公共工具库（常量+函数+版本号）
│   ├── session-start.js      # SessionStart — 上下文注入
│   ├── pre-tool-use.js       # PreToolUse:Write|Edit — 三级触发+批准检查
│   ├── post-tool-use.js      # PostToolUse:Write|Edit — 归档提醒+状态检查
│   ├── stop.js               # Stop — 未完成检查+防循环
│   ├── todowrite-sync.js     # PreToolUse:TodoWrite — task.md 一致性
│   ├── config-guard.js       # ConfigChange — 配置保护
│   ├── pre-compact.js        # PreCompact — Compact 快照
│   └── templates/            # 5 个 Artifact 模板
├── skills/                   # 4 个 Skill 定义
│   ├── pace-workflow.md      # PACE P-A-C-E-V 流程
│   ├── artifact-management.md # Artifact 文件管理规则
│   ├── change-management.md  # 变更 ID 生成与管理
│   └── pace-knowledge.md     # Obsidian 知识库笔记管理
├── config/
│   └── settings-hooks-excerpt.json  # settings.json hooks 配置示例
├── rules/
│   └── CLAUDE.md             # 全局规则模板（G-1 ~ G-12）
└── tests/                    # 测试脚本
```

---

## 2. PACE 工作流阶段

### 激活条件

**多信号优先级**（`isPaceProject()` 函数）：

```
.pace/disabled 存在? ──YES──→ 豁免（跳过 PACE）
       │ NO
artifact 文件存在? ──YES──→ 'artifact'（最强信号）
       │ NO
docs/plans/YYYY-MM-DD-*.md 存在? ──YES──→ 'superpowers'
       │ NO
.pace-enabled 标记存在? ──YES──→ 'manual'
       │ NO
根目录 3+ 代码文件? ──YES──→ 'code-count'
       │ NO
false（非 PACE 项目，全部 hook 静默放行）
```

**豁免场景**：问答、单行修改、纯文档/注释、纯重构、用户说"简单改一下"

### 五阶段流程

| 阶段 | 名称 | 做什么 | 产出物 | Hook 强制点 |
|------|------|--------|--------|------------|
| **P** | Plan（规划） | 分析代码、识别依赖、风险评估、搜索资源 | 理解与计划 | 无 |
| **A** | Artifact（制品） | 创建/更新 task.md + implementation_plan.md，生成 CHG-ID，关联 findings | Artifact 文件 | PreToolUse deny（无活跃任务不允许写代码） |
| **C** | Check（确认） | **停止执行**，询问用户是否批准计划 | `<!-- APPROVED -->` 标记 | PreToolUse deny（未获批准不允许写代码） |
| **E** | Execute（执行） | 按计划实现代码，更新 task.md 进度 + walkthrough.md 记录 | 完成的代码 | PreToolUse 检查 impl_plan 需有 `[/]`；PostToolUse 归档提醒 |
| **V** | Verify（验证） | 测试验证、记录结果到 walkthrough | `<!-- VERIFIED -->` 标记 | Stop hook 检查（有 `[x]` 但无 VERIFIED → 阻止退出） |

### 阶段流转图

```
P（规划）
  ↓ 分析完成
A（创建 Artifact）
  ↓ 文件就绪
C（用户确认）──NO──→ 返回 A 修改
  ↓ YES（添加 APPROVED）
E（执行实现）
  ↓ 代码完成
V（验证测试）──FAIL──→ 返回 E 修复
  ↓ PASS（添加 VERIFIED）
归档 + 结束
```

---

## 3. Hook 系统

### 3.1 Hook I/O 协议

| 场景 | Exit Code | 输出通道 | AI 是否可见 | 用途 |
|------|-----------|----------|-----------|------|
| 静默放行 | 0 | stderr 或无 | ❌ | 检查通过，无需通知 |
| 信息提醒 | 0 | stdout JSON `additionalContext` | ✅ | 提醒但不阻止 |
| 拒绝工具调用 | 0 | stdout JSON `permissionDecision: "deny"` | ✅ | 阻止 Write/Edit |
| 阻止退出 | 2 | stderr | ✅ | 阻止 Stop |
| 上下文注入 | 0 | stdout 纯文本 | ✅ | SessionStart 专用 |

> **致命陷阱**：`exit 0 + stderr` = **完全忽略**（v3 的致命错误，v4 已修正）

### 3.2 session-start.js（SessionStart）

**触发**：新会话启动、恢复、清屏、Compact 恢复

| 编号 | 功能 | 说明 |
|------|------|------|
| S1 | 重置防循环计数器 | `.pace/stop-block-count` 清零 |
| S2 | 清除单会话标记 | 删除 `degraded`、`todowrite-used`、`archive-reminded`、`findings-reminded`、`impl-archive-reminded` |
| S3 | Compact 快照恢复 | 读取 `pre-compact-state.json`，注入进行中任务摘要 |
| S4 | 懒创建模板 | 非 'artifact' 信号 + 无 task.md → 自动创建 5 个 Artifact 文件 |
| S5 | 活跃区注入 | 逐个读取 5 个 Artifact 文件的 `<!-- ARCHIVE -->` 上方内容 |
| S6 | 跨会话 `[-]` 提醒 | 扫描活跃区的跳过项，最多提示 3 个 |
| S7 | TodoWrite 同步指令 | 根据活跃区状态注入同步提示（task.md 为权威源） |
| S8 | Findings 过期提醒 | `[ ]` 条目超过 14 天未流转 → 提醒采纳或否定（每日首次） |
| S9 | Git 状态注入 | 注入当前 branch + 最近 commit |
| S10 | 相关笔记注入 | 从 Obsidian thoughts/knowledge 扫描关联讨论（最多 5 条） |

**输出方式**：stdout 纯文本，直接作为 AI 上下文

### 3.3 pre-tool-use.js（PreToolUse:Write|Edit）

**触发**：任何 Write 或 Edit 工具调用前

#### 三级触发机制

| 级别 | 触发条件 | 行为 | 目的 |
|------|---------|------|------|
| **一级（强 deny）** | PACE 激活信号 + 无活跃任务 | deny + 懒创建模板 | 强制先创建 Artifact |
| **二级（前瞻 deny）** | 无强信号 + 即将写第 3 个代码文件 | deny + 自动创建模板 | code-count 触发前拦截 |
| **三级（软提醒）** | 1-2 个代码文件 | additionalContext | 建议创建 PACE Artifact |

#### 其他检查

| 编号 | 功能 | 行为 |
|------|------|------|
| H1 | Write artifact 覆盖保护 | 已存在的 task/impl_plan/walkthrough/findings 禁用 Write → deny |
| H2 | Obsidian 知识库模板提醒 | Write 到 thoughts/knowledge → additionalContext 提醒模板 |
| H6 | C 阶段批准检查 | 有活跃任务但无 `<!-- APPROVED -->` 或 `[/]`/`[!]` → deny |
| H7 | E 阶段前提检查 | 已批准但 impl_plan 无 `[/]` 进行中索引 → deny |
| H8 | 任务状态注入 | 正常通过时注入 task.md 活跃区内容 → additionalContext |

### 3.4 post-tool-use.js（PostToolUse:Write|Edit）

**触发**：Write 或 Edit 工具调用完成后

| 编号 | 功能 | 触发频率 | 说明 |
|------|------|---------|------|
| H1 | Stop 降级提醒 | 每次 | 存在 `.pace/degraded` 时提醒 |
| H2 | 归档提醒 | 每会话首次 | task.md 活跃区有已完成项 → 提醒归档 |
| H3 | ARCHIVE 格式检查 | 每次 | 编辑 Artifact 时检查标记格式 |
| H6 | APPROVED/VERIFIED 自签检测 | 每次 | Edit 添加批准/验证标记 → 提醒确认用户已审核 |
| H7 | Findings ⚠️ 警告 | 每会话首次 | findings.md 有未解决问题 |
| H8 | 否定理由不足检测 | 编辑 findings 时 | `[-]` 条目理由 < 10 字 → 提醒补充 |
| H9 | CHG 完成时 findings 关联检查 | 实时 | CHG 标 `[x]` 但关联 finding 仍为 `[ ]` → 提醒更新 |
| H10 | impl_plan 详情归档提醒 | 每会话首次 | 索引已完成但详情区还在活跃区 → 提醒归档 |
| H11 | Correction 双写提醒 | 每次 | Edit findings.md 写入 `### Correction:` → 提醒同步到 knowledge/ |
| C | TodoWrite 同步提醒 | 编辑 task.md 时 | 提醒同步 TodoWrite 状态 |

**输出方式**：全部为 additionalContext（信息性，不阻止）

### 3.5 stop.js（Stop）

**触发**：Claude 尝试停止/退出时

| 编号 | 功能 | 说明 |
|------|------|------|
| W1 | ARCHIVE 格式检查 | 检查 task.md 和 impl_plan 的标记格式 |
| W2 | 未完成任务检查 | 活跃区 pendingCount > 0 → 阻止 |
| W3 | 验证/归档优先级 | `[x]` 无 VERIFIED → 阻止验证；已验证有 done → 提醒归档；仅 `[-]` → 提醒归档 |
| W4 | impl_plan 一致性 | 任务全完成但 impl_plan 仍有 `[/]` → 提醒更新 |
| W5 | walkthrough 日期检查 | 有任务但 walkthrough 最近日期 ≠ 今日 → 提醒更新 |
| W6 | Artifact 不完整 | 有其他 Artifact 但缺 task.md → 提醒 |
| W8 | TodoWrite 残留检测 | 本会话用过 TodoWrite 且无活跃任务 → 清理 flag |
| W9 | 交叉验证 | AI 消息含"完成"但 task.md 还有 pending → 阻止 |

#### 防无限循环机制

```
Stop 触发
  ↓
读取 .pace/stop-block-count（初值 0）
  ↓
blockCount < 3 ?
  ├─ YES → exit 2 阻止 + stderr 反馈 + blockCount++
  └─ NO  → 降级 exit 0 + 写入 .pace/degraded + additionalContext
           （SessionStart 下次会话重置计数器）
```

### 3.6 todowrite-sync.js（PreToolUse:TodoWrite|TaskCreate|TaskUpdate）

**触发**：任何 TodoWrite、TaskCreate、TaskUpdate 工具调用前

| 编号 | 检查 | 说明 |
|------|------|------|
| T1 | Compaction 残留检测 | task.md 无活跃任务 + 写入操作 → HINT |
| T2 | 同步提醒 | 有 pending 任务 → HINT 对齐 task.md |
| T3 | 先归档后操作 | pending=0 但 done>0 → HINT 先归档 |
| T4 | 数量差异检测 | TodoWrite 项数与 task.md 差异 > 3 → HINT |
| T5 | task.md 不存在 | 写入操作但无 task.md → HINT |

**运行时效果**：写入 `.pace/todowrite-used` 标记

**输出方式**：全部为 additionalContext HINT（不阻止操作）

### 3.7 config-guard.js（ConfigChange）

**触发**：settings 配置文件变更时

| 检查 | 行为 | 说明 |
|------|------|------|
| disableAllHooks=true | additionalContext ⚠️ 强警告 | 防止用户意外禁用全部 hook |
| 删除 PACE hook 配置 | additionalContext 提醒 | 检测到 `/pace/` + delete/remove 关键词 |

### 3.8 pre-compact.js（PreCompact）

**触发**：Message 压缩前

**功能**：收集快照到 `.pace/pre-compact-state.json`

```json
{
  "timestamp": "ISO 8601",
  "artifacts": {
    "task.md": { "pending": 3, "done": 1, "inProgress": ["- [/] T-042 ..."] },
    "implementation_plan.md": { "hasInProgress": true }
  },
  "runtime": {
    "degraded": false,
    "todowriteUsed": true
  }
}
```

**用途**：SessionStart 在 Compact 恢复时读取此快照，注入关键状态摘要

---

## 4. Skill 系统

### 4.1 pace-workflow（PACE 核心工作流）

**触发条件**（满足任一）：
- 涉及 3+ 文件修改
- 需要新增依赖或修改配置
- 预计 10+ 工具调用
- 涉及架构设计或技术选型
- 单文件修改 100+ 行
- 核心模块/关键算法重构
- 用户明确要求规划/设计/分析

**内容**：定义 P-A-C-E-V 五阶段的具体执行步骤、检查清单和 Hook 交互规则。

**关键规则**：
- P 阶段搜索优先级：Context7 > 互联网搜索 > GitHub Issues
- A 阶段调用 change-management Skill 生成 CHG-ID，关联 findings.md
- C 阶段必须**停止执行**等待用户确认
- E 阶段支持 `[P]` 标记并行任务分配给 subagent/teammate
- E 阶段每完成 5 个子任务重读 task.md；超过 20 轮刷新核心 Artifact
- V 阶段按 必须/建议/可选 三级执行测试

### 4.2 artifact-management（文件管理规则）

**触发条件**：操作任何 Artifact 文件时自动激活

**内容**：
- 5 个 Artifact 文件的更新规则、时间戳格式、归档操作
- 双区结构规范（活跃区 + `<!-- ARCHIVE -->` + 归档区）
- 任务状态标记定义和转换规则
- spec.md 同步触发词：安装依赖、添加配置、创建核心模块、版本升级
- 归档操作必须原子化（单次 Edit 完成，禁止拆分为删除+插入）

### 4.3 change-management（变更 ID 管理）

**触发条件**：由 pace-workflow A 阶段调用（非独立使用）

**内容**：
- CHG-ID 生成规则（`CHG-YYYYMMDD-NN`）
- 变更索引格式（`- [状态] CHG-ID 标题 #change [tasks:: T-NNN~T-NNN]`）
- 各 PACE 阶段的变更管理动作
- findings 反向关联（A 阶段第 4 步回写 `[change:: CHG-ID]`）

### 4.4 pace-knowledge（Obsidian 知识库笔记管理）

**触发条件**：操作 Obsidian Vault 的 `thoughts/` 或 `knowledge/` 目录时自动激活

**内容**：
- `thoughts/` 笔记：酝酿中的想法（`discussing` → `concluded` → `archived`）
- `knowledge/` 笔记：跨项目可复用经验（从项目 findings 中提炼）
- frontmatter 必含 `summary`/`status`/`projects` 字段
- L0/L1/L2 信息分层：`summary`（~50 tokens）→ `## 摘要`（~300-500 tokens）→ `## 详情`（不限）
- SessionStart 自动注入 L0 匹配结果

---

## 5. 状态系统

### 5.1 任务状态（task.md）

| 标记 | 含义 | 说明 | 可转换到 |
|------|------|------|---------|
| `[ ]` | 待开始 | 任务已创建，尚未开始 | `[/]` |
| `[/]` | 进行中 | 正在执行的任务 | `[x]` `[-]` `[!]` |
| `[x]` | 已完成 | 任务完成 | 归档（最终状态） |
| `[-]` | 已跳过 | 任务取消或不再需要，需说明原因 | 归档（最终状态） |
| `[!]` | 阻塞 | 遇到问题，需要外部帮助 | `[/]` |

**Hook 如何使用这些状态**：

| 分类 | 包含状态 | 使用者 | 用途 |
|------|---------|--------|------|
| 活跃任务 | `[ ]` `[/]` `[!]` | PreToolUse | 判断是否有活跃任务（无则 deny） |
| 已完成（done） | `[x]` + `[-]` | countByStatus() | 归档检查、TodoWrite 同步 |
| 仅 [x] | `[x]` | stop.js xCount | V 阶段验证检查 |
| 待办（pending） | `[ ]` `[/]` `[!]` | stop.js | 未完成任务阻止退出 |

> **重要设计**：`countByStatus` 的 `done` 含 `[x]+[-]`，但 `stop.js` 的 `xCount` 仅统计 `[x]`——这是有意设计。`xCount > 0` 触发 V 阶段验证；`xCount === 0 && doneCount > 0` 表示只有跳过项，直接归档无需验证。

**特殊标记 `[P]`**：任务描述中添加 `[P]` 表示可并行执行（纯约定，无 Hook 强制）

### 5.2 变更索引状态（implementation_plan.md）

| 标记 | 含义 | 对应 PACE 阶段 | Hook 检测 |
|------|------|---------------|----------|
| `[ ]` | 规划中 | A 阶段创建 | PreToolUse deny（除非有 APPROVED） |
| `[/]` | 进行中 | C 阶段用户确认后 | PreToolUse E 阶段前提检查 |
| `[x]` | 已完成 | E/V 阶段完成 | PostToolUse H9 检查关联 findings |
| `[-]` | 废弃 | 用户明确取消 | PostToolUse 可直接归档 |
| `[!]` | 暂停 | 阻塞等待 | 无特殊 Hook 强制 |

### 5.3 Findings 状态（findings.md）

| 标记 | 含义 | 说明 |
|------|------|------|
| `[x]` | 已采纳/已验证 | 结论已实施，关联 CHG-ID |
| `[-]` | 保持现状/已否定 | 评估后不采取行动，**必须补充理由（≥10 字）** |
| `[ ]` | 参考中/待评估 | 初始状态，超过 14 天 SessionStart 提醒流转 |

**Hook 检测规则**：
- PostToolUse H7：`⚠️` 标记 → 每会话首次提醒
- PostToolUse H8：`[-]` 理由 < 10 字 → 提醒补充
- PostToolUse H9：CHG 标 `[x]` 但关联 finding 仍 `[ ]` → 实时提醒
- SessionStart S8：`[ ]` 条目 ≥ 14 天 → 每日首次提醒

### 5.4 状态转换全景图

```
                    ┌──────────────────────────────────────┐
                    │           任务生命周期               │
                    │                                      │
  创建 ──→ [ ] ──→ [/] ──┬──→ [x] ──→ VERIFIED ──→ 归档  │
                    │     │                                │
                    │     ├──→ [-] ──→ 归档（需说明原因）   │
                    │     │                                │
                    │     └──→ [!] ──→ [/]（解除阻塞）     │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │          变更生命周期                 │
                    │                                      │
  A 阶段 ──→ [ ] ──→ C 确认 ──→ [/] ──→ E 完成 ──→ [x]   │
                    │                                      │
                    │              └──→ [-] 废弃            │
                    └──────────────────────────────────────┘

                    ┌──────────────────────────────────────┐
                    │        Finding 生命周期               │
                    │                                      │
  记录 ──→ [ ] ──┬──→ [x] 已采纳（关联 CHG 完成）         │
                 │                                         │
                 └──→ [-] 保持现状（需 ≥10 字理由）         │
                    └──────────────────────────────────────┘
```

---

## 6. Artifact 文件结构

### 6.1 五个 Artifact 文件

| 文件 | 用途 | 有 ARCHIVE | 可 Write 覆盖 |
|------|------|-----------|--------------|
| `spec.md` | 项目元数据与技术栈 | ❌ | ✅ |
| `task.md` | 任务分解与进度追踪 | ✅ | ❌（已存在时 deny） |
| `implementation_plan.md` | 技术方案与变更索引 | ✅ | ❌（已存在时 deny） |
| `walkthrough.md` | 工作记录与验证结果 | ✅ | ❌（已存在时 deny） |
| `findings.md` | 调研记录与发现 | ✅ | ❌（已存在时 deny） |

### 6.2 双区结构

```
┌─────────────────────────────┐
│        活跃区               │ ← 新内容写在这里
│  （当前正在处理的内容）       │
│                             │
├─────────────────────────────┤
│  <!-- ARCHIVE -->           │ ← 分隔标记（HTML 注释，独占一行）
├─────────────────────────────┤
│        归档区               │ ← 已完成内容移到这里
│  （历史记录，Hook 不检查）    │
│                             │
└─────────────────────────────┘
```

**规则**：
- Hook 仅检查活跃区内容（`readActive()` 函数）
- 归档操作必须**单次 Edit 原子完成**（从活跃区删除 + 插入归档区），禁止拆分
- 标记格式必须是 `<!-- ARCHIVE -->`，禁止 `## ARCHIVE` 或 `# ARCHIVE`

### 6.3 各文件结构详情

#### spec.md
```markdown
---
summary: "[一句话项目描述]"
---
# 项目名 规格说明
## 项目概述
## 技术栈
## 编码规范
## 目录结构
## 依赖列表
```

#### task.md
```markdown
# 项目任务追踪
## 活跃任务
### CHG-YYYYMMDD-NN: 变更标题
<!-- APPROVED -->
- [ ] T-NNN 任务描述
- [/] T-NNN 任务描述
<!-- VERIFIED -->
<!-- ARCHIVE -->
## 已完成任务
### CHG-YYYYMMDD-NN: 变更标题 ✅
...
```

#### implementation_plan.md
```markdown
# 实施计划
## 变更索引
- [x] CHG-20260117-01 标题 #change [tasks:: T-001~T-002]
- [/] CHG-20260117-02 标题 #change [tasks:: T-003~T-004]
## 活跃变更详情
### CHG-20260117-02: 标题
...
<!-- ARCHIVE -->
```

#### walkthrough.md
```markdown
# 工作记录
## 最近工作
| 日期 | 完成内容 | 关联变更 |
## 最近一次详情
> **时间**: YYYY-MM-DDTHH:mm:ss+08:00
- 详细记录...
<!-- ARCHIVE -->
```

#### findings.md
```markdown
# 调研记录
## 摘要索引
- [x] 标题 — 关键结论 #finding [date:: YYYY-MM-DD] [change:: CHG-ID]
- [-] 标题 — 否定理由 #finding [date:: YYYY-MM-DD]
- [ ] 标题 — 待评估 #finding [date:: YYYY-MM-DD]
## 未解决问题
- ⚠️ 问题描述...
- 🔒 已知限制描述...
## Corrections 记录
<!-- 用户纠正 AI 错误行为时记录。格式：### Correction: 标题 + 错误行为/正确做法/触发场景/根本原因 + [knowledge:: 笔记名|project-only] -->
<!-- ARCHIVE -->
```

---

## 7. 特殊标记系统

### 7.1 `<!-- ARCHIVE -->`（双区分隔）

| 属性 | 说明 |
|------|------|
| 格式 | `<!-- ARCHIVE -->`（HTML 注释，独占一行） |
| 检测正则 | `/^<!-- ARCHIVE -->$/m`（行级匹配） |
| 错误格式 | `## ARCHIVE`、`# ARCHIVE`（Hook 会报错） |
| 用途 | 分隔活跃区（上方）和归档区（下方） |
| 检测者 | `readActive()`、`checkArchiveFormat()`、stop.js W1 |

### 7.2 `<!-- APPROVED -->`（C 阶段批准）

| 属性 | 说明 |
|------|------|
| 添加时机 | C 阶段用户确认后 |
| 添加位置 | task.md 活跃区（变更标题下方） |
| 检测正则 | `/^<!-- APPROVED -->$/m` |
| 等效条件 | `[/]` 或 `[!]` 任务也算已获批准 |
| 检测者 | PreToolUse H6（无批准 → deny） |
| 自签检测 | PostToolUse H6（AI 自行添加 → 提醒确认用户已审核） |
| 归档 | 随任务一起归档到 ARCHIVE 下方 |

### 7.3 `<!-- VERIFIED -->`（V 阶段验证）

| 属性 | 说明 |
|------|------|
| 添加时机 | V 阶段验证通过后 |
| 添加位置 | task.md 活跃区（任务列表下方） |
| 检测正则 | `/^<!-- VERIFIED -->$/m` |
| 检测者 | stop.js W3（有 `[x]` 但无 VERIFIED → exit 2 阻止退出） |
| 自签检测 | PostToolUse H6（AI 自行添加 → 提醒确认已验证） |
| 优先级 | 先检查验证（W3），后检查归档 |
| 归档 | 随任务一起归档到 ARCHIVE 下方 |

### 7.4 问题标记（findings.md）

| 标记 | 含义 | Hook 行为 |
|------|------|----------|
| `⚠️` | 未解决问题 | PostToolUse H7 每会话首次提醒 |
| `🔒` | 已知限制（不计入统计） | 不触发提醒 |
| `✅` | 已解决 | 不触发提醒 |
| `❓` | 待决策 | 不触发提醒 |

---

## 8. ID 命名规范

### 8.1 任务编号 `T-NNN`

- **格式**：三位数序号，全局递增，补零
- **生成**：读取 task.md 现有最大编号 + 1
- **示例**：T-001, T-042, T-100, T-186
- **使用场景**：
  - task.md 任务清单项
  - implementation_plan.md 索引 `[tasks:: T-001~T-002]`
  - walkthrough.md 完成记录引用

### 8.2 变更 ID `CHG-YYYYMMDD-NN`

- **格式**：`CHG` + 日期（8位）+ 当天序号（2位补零）
- **生成**：统计 implementation_plan.md 当天已有变更数 + 1
- **示例**：CHG-20260117-01, CHG-20260227-02
- **使用场景**：
  - implementation_plan.md 变更索引
  - task.md 变更分组标题
  - findings.md `[change:: CHG-ID]` 关联
  - walkthrough.md 关联变更列

### 8.3 时间戳格式

- **标准**：`YYYY-MM-DDTHH:mm:ss+08:00`（ISO 8601，东八区）
- **使用场景**：walkthrough.md 详情时间、implementation_plan.md 最后更新

---

## 9. 运行时状态文件

所有运行时状态存储在项目的 `.pace/` 目录下：

| 文件 | 写入者 | 消费者 | 用途 | 生命周期 |
|------|--------|--------|------|---------|
| `disabled` | 用户手动 | isPaceProject() | 豁免 PACE | 持久（用户手动删除） |
| `stop-block-count` | Stop(+1) / SessionStart(→0) | Stop | 防无限循环计数器 | 每会话重置 |
| `degraded` | Stop(≥3次) | PostToolUse H1 | 降级标记+未通过检查 | 每会话清除 |
| `todowrite-used` | todowrite-sync | Stop W8 | 本会话用过 TodoWrite | 每会话清除 |
| `archive-reminded` | PostToolUse H2 | PostToolUse | 归档提醒已触发 | 每会话清除 |
| `findings-reminded` | PostToolUse H7 | PostToolUse | Findings 提醒已触发 | 每会话清除 |
| `impl-archive-reminded` | PostToolUse H10 | PostToolUse | Impl_plan 详情归档提醒已触发 | 每会话清除 |
| `findings-age-YYYY-MM-DD` | SessionStart S8 | SessionStart | 每日首次过期扫描标记 | 每日一个 |
| `pre-compact-state.json` | PreCompact | SessionStart S3 | Compact 快照 | 下次 Compact 覆盖 |

---

## 10. 配置系统

### 10.1 settings.json Hook 事件配置

| 事件 | Matcher | 脚本 | 说明 |
|------|---------|------|------|
| SessionStart | `startup\|resume\|clear\|compact` | session-start.js | 新会话/恢复/清屏/Compact |
| PreToolUse | `Write\|Edit` | pre-tool-use.js | 代码修改前检查 |
| PreToolUse | `TodoWrite\|TaskCreate\|TaskUpdate` | todowrite-sync.js | 任务工具一致性 |
| PostToolUse | `Write\|Edit` | post-tool-use.js | 代码修改后提醒 |
| PreCompact | （无 matcher） | pre-compact.js | Compact 前快照 |
| ConfigChange | `project_settings\|local_settings` | config-guard.js | 配置变更保护 |
| Stop | （无 matcher） | stop.js | 退出前检查 |

### 10.2 CLAUDE.md 全局规则（G-1 ~ G-12）

| 规则 | 标题 | 核心内容 |
|------|------|---------|
| G-1 | 核心身份 | 高级首席软件工程师，输出中文 |
| G-2 | 语言规则 | 解释中文 + 术语英文 + Artifact 字段中文 |
| G-3 | 上下文恢复 | SessionStart 注入、task.md 权威源、Corrections 捕获+双写 knowledge/ |
| G-4 | 编码标准 | 风格适配、严格类型、中文注释、禁止 Bash 绕过 |
| G-5 | 沟通风格 | 零废话、直切主题、格式化 |
| G-6 | 敏感信息 | 环境变量、提交前检查、泄露停止 |
| G-7 | 文件操作确认 | 删除/覆盖需确认、Artifact 禁止 Write 覆盖 |
| G-8 | PACE 启用判定 | 豁免场景 + Hook 自动检测 + AI 判断 |
| G-9 | 任务完成检查 | 完成前确认 task/walkthrough/spec 已更新 |
| G-10 | 验证必行 | Terminal/Browser 验证、失败必修复 |
| G-11 | 环境 | Windows 11、路径格式约定 |
| G-12 | 网络研究优先级 | Context7 > fetch > Serper > Google AI Mode |

### 10.3 pace-utils.js 公共库

**常量**：

| 常量 | 值 | 说明 |
|------|-----|------|
| `PACE_VERSION` | `'v4.7.0'` | 集中版本号，其他脚本引用 |
| `CODE_EXTS` | `['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte']` | 代码文件扩展名 |
| `ARTIFACT_FILES` | `['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md']` | Artifact 文件列表 |
| `VAULT_PATH` | `'C:/Users/Xiao/OneDrive/Documents/Obsidian'` | Obsidian Vault 路径 |

**函数**：

| 函数 | 功能 |
|------|------|
| `isPaceProject(cwd)` | 多信号 PACE 激活判定，返回信号名或 false |
| `isTeammate()` | 检测 Agent Teams teammate 身份（环境变量） |
| `countCodeFiles(cwd)` | 统计根目录代码文件数 |
| `hasPlanFiles(cwd)` | 检测 Superpowers plan 文件 |
| `readActive(cwd, filename)` | 读取 ARCHIVE 上方活跃区 |
| `readFull(cwd, filename)` | 读取文件全文 |
| `checkArchiveFormat(cwd, filename)` | 检查 ARCHIVE 标记格式 |
| `createTemplates(cwd)` | 懒创建 Artifact 模板 + Obsidian Junction |
| `countByStatus(text, opts)` | 统一任务状态统计（pending/done/total） |
| `scanRelatedNotes(projectName)` | 扫描 Obsidian 相关笔记 |

---

## 11. 工具脚本

### 11.1 install.js（安装脚本）

**功能**：将 paceflow/ 源码同步到生产目录（`~/.claude/hooks/pace/`、`~/.claude/skills/`）

| 参数 | 说明 |
|------|------|
| `--dry-run` | 仅显示将执行的操作，不实际修改 |
| `--force` | 覆盖已存在的生产文件 |
| 无参数 | 仅安装缺失文件，跳过已存在的 |

**三步安装**：
1. hooks → `~/.claude/hooks/pace/`（脚本 + 模板）
2. skills → `~/.claude/skills/`（Skill 定义 + 模板）
3. settings → 提示手动合并 hooks 配置到 `~/.claude/settings.json`

### 11.2 verify.js（健康检查）

**5 组检查**：

| 组 | 检查内容 |
|----|---------|
| 语法 | 所有 hook 脚本 `node -c` 语法验证 |
| 一致性 | 源码与生产目录 diff 对比 |
| Settings | settings.json 包含所有预期 hook 事件 |
| 版本 | 所有脚本 require 的 PACE_VERSION 一致 |
| 模板 | hooks/templates/ 与 skills/templates/ 同步 |

### 11.3 test-pace-utils.js（单元测试）

覆盖 `isPaceProject()` 的 7 个场景：空目录、artifact 存在、disabled 豁免、manual 标记、superpowers plan、code-count、优先级验证

### 11.4 test-hooks-e2e.js（E2E 测试）

覆盖所有 hook 的 stdin/stdout/exit code 协议行为（25 个测试用例），包括：
- SessionStart 注入
- PreToolUse deny/pass
- PostToolUse 提醒
- Stop 阻止/降级
- TodoWrite-Sync 一致性
- Teammate 降级行为

---

## 12. Agent Teams 兼容性

### 12.1 检测机制

```javascript
// pace-utils.js
function isTeammate() {
  return !!process.env.CLAUDE_CODE_TEAM_NAME;
}
```

- Teammate 进程自动设置 `CLAUDE_CODE_TEAM_NAME` 环境变量（值为 team name）
- 主会话（lead）不设置此变量

### 12.2 各 Hook 兼容策略

| Hook | Teammate 行为 | 策略 |
|------|-------------|------|
| session-start.js | 不变 | 信息注入无害 |
| pre-tool-use.js | deny → additionalContext HINT | 降级：不阻止 teammate 写代码 |
| post-tool-use.js | 不变 | 全部为 additionalContext（本身不阻止） |
| stop.js | exit 2 → additionalContext + exit 0 | 降级：不阻止 teammate 退出 |
| todowrite-sync.js | 静默放行（early return） | 避免 Agent Teams 共享任务假阳性 |
| config-guard.js | 不变 | 仅 PACE 项目检查 |
| pre-compact.js | 不变 | 仅收集快照 |

### 12.3 设计原则

> **纪律由 lead（显性窗口）维护，teammate 专注干活。**

- **阻止 hook 降级**：stop.js / pre-tool-use.js 的 deny/exit 2 改为 additionalContext 提醒
- **同步 hook 静默**：todowrite-sync.js 直接 return 避免误报
- **信息 hook 保留**：session-start.js / post-tool-use.js 提供有用上下文

### 12.4 已知限制

- 🔒 todowrite-sync.js 无法区分团队任务（Agent Teams TaskCreate）与 PACE 任务操作
- 🔒 多 teammate 并发修改 `.pace/` 状态文件存在理论竞态风险
- Stop hook 不对 teammate 触发（官方 "main Claude Code agent" only）
- In-process vs Pane-based 行为不同（Windows in-process / macOS pane-based）

---

## 附录：版本演进里程碑

| 版本 | 关键变更 |
|------|---------|
| v4.3 | 多信号 PACE 检测 + 前瞻判断（code-count-lookahead） |
| v4.3.1 | 活跃任务定义修正 + 项目外文件豁免 |
| v4.3.2 | C 阶段批准检查 + Write artifact 覆盖保护 |
| v4.3.3 | 异步 stdin + Stop 降级 + 防无限循环 |
| v4.3.5 | 三级触发分级（DENY/lookahead/SOFT_WARN）+ 懒创建模板 |
| v4.3.6 | TodoWrite 四层同步方案（A+B+C+D） |
| v4.4.1 | Obsidian 知识库模板提醒 |
| v4.4.3 | E 阶段前提检查（impl_plan 需 `[/]`） |
| v4.5.0 | Compact 快照 + 交叉验证 + Findings 否定理由增强 |
| v4.6.0 | ConfigChange hook + PreCompact hook |
| v4.7.0 | Agent Teams 全量适配（isTeammate() + DENY 降级 + 静默放行） |
| v4.7.0+ | impl_plan 详情归档提醒（H10）+ Correction 双写提醒（H11 → knowledge/） |
