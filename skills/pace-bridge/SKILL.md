---
name: pace-bridge
effort: medium
description: >
  将 Superpowers/native plan 文件桥接到 PACEflow v6 artifacts。读取 docs/plans/、
  docs/superpowers/plans/ 或 ~/.claude/plans/ 的计划，整理为 create-chg 输入，
  然后派 artifact-writer 创建 changes/<id>.md 与 task/implementation_plan 索引。
---

# Plan → PACEflow 桥接

pace-bridge 不直接 Edit `task.md` / `implementation_plan.md`。桥接的唯一写入路径是派 `artifact-writer`。

---

## 触发场景

- PreToolUse / TodoWrite DENY 提示检测到计划文件。
- SessionStart 注入 Superpowers/native plan 桥接提醒。
- 用户要求“同步计划”“桥接计划”“把 plan 转成 PACE”。

---

## 前提

- 存在未同步的 plan 文件：`docs/plans/`、`docs/superpowers/plans/` 或 `~/.claude/plans/`。
- 当前没有同一计划对应的活跃 CHG。
- 如果计划来自已获用户确认的 brainstorming/writing-plans，可执行 auto-APPROVED；否则桥接后进入 C 阶段等待用户批准。

---

## 桥接步骤

### Step 1：读取计划

读取最新未同步 plan，提取：
- 标题与目标
- 任务列表
- 影响文件/模块
- 技术决策与风险
- 验收条件
- 推荐执行方式（串行、TDD、subagent-driven、parallel agents）

### Step 2：组织 create-chg 输入

```text
operation: create-chg
title: <计划标题>
tasks:
  - T-001: <任务标题，含验收条件>
  - T-002: <任务标题，含验收条件>
background: <从 plan 提炼 Why>
scope: <影响文件/模块与改动范围>
technical-decision: <关键设计决策和取舍>
```

任务不能只复制标题。每个任务应能让后续执行者不回读 plan 也知道目标和验收标准。

### Step 3：派 artifact writer

派 `artifact-writer` 执行 `create-chg`。agent 会创建：
- `changes/chg-yyyymmdd-nn.md`
- `task.md` 活跃 wikilink 索引
- `implementation_plan.md` 活跃 wikilink 索引

### Step 4：auto-APPROVED（可选）

如果用户已在上游计划流程中参与并确认设计，继续派：

```text
operation: update-chg
target: <CHG-ID>
action: approve
```

批准标记写在 `changes/<id>.md`；`task.md` 只保留索引。

### Step 5：标记已同步

把桥接的主计划文件及同名前缀伴随文件写入 `.pace/synced-plans`，每行一个文件名。

禁止一次性记录整个 `docs/plans/` 目录；多窗口场景下会吞掉其他窗口的未桥接计划。

---

## 验证

桥接完成后确认：
- `task.md` 与 `implementation_plan.md` 都有同一 `[[chg-*]]` 索引。
- `changes/<id>.md` 存在，frontmatter `status: planned` 或后续已批准。
- auto-APPROVED 场景下详情文件含 `<!-- APPROVED -->`。

---

## 转换摘要格式

```text
=== pace-bridge 转换摘要 ===
源计划: <plan path>
变更 ID: CHG-YYYYMMDD-NN
任务范围: T-NNN ~ T-NNN（共 N 个）
批准状态: pending / auto-approved
执行方式推荐: subagent-driven-development / executing-plans / dispatching-parallel-agents / direct
```
