---
name: pace-bridge
description: 将 Superpowers 计划文件（docs/plans/）桥接到 PACEflow artifacts（task.md + implementation_plan.md）。
  当 PreToolUse DENY 提示"检测到 Superpowers 计划文件"或 SessionStart 提示"Superpowers 桥接提醒"时使用。
---

# Superpowers → PACEflow 桥接

## 触发场景

- PreToolUse DENY 消息包含"检测到 Superpowers 计划文件"
- TodoWrite/TaskCreate DENY 消息包含"Superpowers 计划文件"
- SessionStart 注入"Superpowers 桥接提醒"
- 用户手动调用 `/pace-bridge`

## 前提

- `docs/plans/` 中存在 Superpowers plan 文件
- `task.md` 无活跃任务
- 用户已在 Superpowers 流程中审批计划（等价于 PACE C 阶段批准）

## 桥接步骤

### Step 1：读取计划
Read `docs/plans/` 中最新的 plan 文件，提取任务列表和实施策略。

### Step 2：生成变更 ID
- 读取 `implementation_plan.md` 当天已有 CHG 数量，生成 `CHG-YYYYMMDD-NN`
- 读取 `task.md`（含 ARCHIVE 区）最大 T 编号，从 `T-(max+1)` 开始

### Step 3：写入 implementation_plan.md
Edit 变更索引区添加：
```
- [/] CHG-YYYYMMDD-NN 标题 #change [tasks:: T-NNN~T-NNN]
```

### Step 4：写入 task.md
Edit 活跃区添加：
```
**焦点变更**：CHG-YYYYMMDD-NN 标题

## 活跃任务

<!-- APPROVED -->

### CHG-YYYYMMDD-NN: 标题

- [/] T-NNN: 第一个任务
- [ ] T-NNN: 第二个任务
...
```

### Step 5：验证
确认 task.md 有 `[/]` 任务 + `<!-- APPROVED -->` + implementation_plan.md 有 `[/]` 变更。

### Step 6：标记已同步
将已桥接的 plan 文件名写入 `.pace/synced-plans`（每行一个文件名），防止后续 session 重复提示桥接。
```bash
# 示例：echo "2026-03-04-superpowers-paceflow-fusion.md" >> .pace/synced-plans
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
源计划: docs/plans/YYYY-MM-DD-<feature>.md
变更 ID: CHG-YYYYMMDD-NN
任务范围: T-NNN ~ T-NNN（共 N 个）
执行方式推荐: subagent-driven-development / executing-plans / dispatching-parallel-agents
```
