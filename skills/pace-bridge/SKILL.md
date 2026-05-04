---
name: pace-bridge
effort: medium
description: >
  将计划文件桥接到 PACEflow artifacts（task.md + implementation_plan.md）。
  支持 Superpowers 计划（docs/plans/ 或 docs/superpowers/plans/）和 Claude Code
  plan mode（~/.claude/plans/）。当 DENY 提示"检测到计划文件"或用户请求"同步计划"、
  "桥接计划"时激活。
---

# Superpowers → PACEflow 桥接

## 触发场景

- PreToolUse DENY 消息包含"检测到 Superpowers 计划文件"
- TodoWrite/TaskCreate DENY 消息包含"Superpowers 计划文件"
- SessionStart 注入"Superpowers 桥接提醒"
- 用户手动调用 `/pace-bridge`

## 前提

- `docs/plans/` 或 `docs/superpowers/plans/` 中存在 Superpowers plan 文件
- `task.md` 无活跃任务
- 用户已在 Superpowers 流程中审批计划（等价于 PACE C 阶段批准）

## 桥接步骤

### Step 1：读取计划
Read `docs/plans/` 或 `docs/superpowers/plans/` 中最新的 plan 文件，提取任务列表和实施策略。

### Step 2：生成变更 ID
- 读取 `implementation_plan.md` 当天已有 CHG 数量，生成 `CHG-YYYYMMDD-NN`（格式详见 `paceflow:artifact-management` 编号规范）
- 读取 `task.md`（含 ARCHIVE 区）最大 T 编号，从 `T-(max+1)` 开始

### Step 3：写入 implementation_plan.md
Edit 变更索引区添加：
```
- [/] CHG-YYYYMMDD-NN 标题 #change [tasks:: T-NNN~T-NNN]
```

Edit 活跃变更详情区添加 `### CHG-ID 标题` 段落，**从源计划提取并展开为 4 段结构**：

1. **背景**（Why）：从 plan 文件提取需求动机，用中文重述（技术术语保留英文）
2. **范围**（What）：影响文件列表 + 预估改动量（从 plan 任务列表推断）
3. **技术决策**（How）：从 plan 提取技术选型和设计决策（如"选择 SQLite 而非 PostgreSQL，因为..."）
4. **任务分解**：每个 T-NNN 展开含文件定位（`file:line`）、改动意图（当前→目标）和验收条件

> **禁止仅列任务标题**。Artifact 必须能独立理解，不需要回溯源 plan 文件。

### Step 4：写入 task.md
Edit 活跃区添加：
```
**焦点变更**：CHG-YYYYMMDD-NN 标题

## 活跃任务

### CHG-YYYYMMDD-NN: 标题

<!-- APPROVED -->

- [/] T-NNN 第一个任务
- [ ] T-NNN 第二个任务
...
```

### Step 5：验证
确认 task.md 有 `[/]` 任务 + `<!-- APPROVED -->` + implementation_plan.md 有 `[/]` 变更。

### Step 6：标记已同步
将桥接的主计划文件**及其伴随文件**（同名前缀，如 `-design.md`）写入 `.pace/synced-plans`（每行一个文件名）。hook 检测匹配所有 `YYYY-MM-DD-*.md` 文件，伴随文件不记录会导致误 DENY。
**禁止**一次性记录 `docs/plans/` 全部文件——多窗口场景下会吞掉其他窗口未桥接的计划。
```bash
# 示例：桥接 2026-03-08-context-memory.md 时，记录主文件及伴随文件
echo "2026-03-08-context-memory.md" >> .pace/synced-plans
echo "2026-03-08-context-memory-design.md" >> .pace/synced-plans
```

## 重要提示

- **artifact 文件是 .md**，不在 CODE_EXTS 中，Edit 操作不受"无活跃任务 DENY"限制
- 使用 **Edit** 修改已有 artifact，不要用 Write 覆盖
- 并发 subagent：第一个完成桥接后，后续 subagent 自动通过

## auto-APPROVED 说明

pace-bridge 自动在 task.md 写入 `<!-- APPROVED -->`，这是设计行为而非遗漏：
- 用户在 brainstorming 中已参与设计决策（What to build）
- writing-plans 已生成详细实施计划（How to build）
- 格式转换是机械性操作，不引入新的设计决策
- 用户通过事后审阅 task.md 发现问题可随时叫停

此行为等价于 PACE C 阶段的 `<!-- APPROVED -->`，使 C 阶段被吸收。

## 转换摘要格式

桥接完成后，**必须**输出以下结构化摘要供用户事后审阅：

```
=== pace-bridge 转换摘要 ===
源计划: docs/plans/YYYY-MM-DD-<feature>.md 或 docs/superpowers/plans/YYYY-MM-DD-<feature>.md
变更 ID: CHG-YYYYMMDD-NN
任务范围: T-NNN ~ T-NNN（共 N 个）
执行方式推荐: subagent-driven-development / executing-plans / dispatching-parallel-agents
```
