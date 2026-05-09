---
name: pace-bridge
effort: medium
description: >
  将 Superpowers/native plan 文件桥接到 PACEflow v6 artifacts。读取 docs/plans/、
  docs/superpowers/plans/，或在用户明确给出路径时读取 ~/.claude/plans/ 的计划，整理为 create-chg 输入，
  然后派 artifact-writer 创建 changes/<id>.md 与 task/implementation_plan 索引。
---

# Plan → PACEflow 桥接

pace-bridge 不直接 Edit `task.md` / `implementation_plan.md`。桥接的唯一写入路径是派 `artifact-writer`。

---

## 触发场景

- PreToolUse / Claude 任务列表同步 DENY 提示检测到项目内计划文件。
- SessionStart 注入 Superpowers/native plan 桥接提醒。
- 用户要求“同步计划”“桥接计划”“把 plan 转成 PACE”。

---

## 前提

- 存在未同步的项目内 plan 文件：`docs/plans/` 或 `docs/superpowers/plans/`。
- `~/.claude/plans/` 不由 hook 自动扫描；只有当用户或 SessionStart/Claude 明确给出具体路径时，才手动读取并桥接该文件。
- 当前没有同一计划对应的活跃 CHG。
- 如果计划来自已获用户确认的 brainstorming/writing-plans，可执行 auto-APPROVED；否则桥接后进入 C 阶段等待用户批准。
- Claude Code 原生 plan 的文件名/会话名可能随版本变化；桥接只以 hook 提供的明确路径、文件内容和最近修改时间为依据，不凭文件名是否随机判断。

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
artifact_dir: <SessionStart hook 提供的 artifact 目录>
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

如果用户已在上游计划流程中参与并确认设计，且准备开始首个任务，继续派：

```text
artifact_dir: <SessionStart hook 提供的 artifact 目录>
operation: update-chg
target: <CHG-ID>
action: approve-and-start
task-id: <首个 T-NNN>
approval-confirmed: true
approval-source: prior-approved-plan
approval-evidence: <上游计划流程中用户确认的方案摘要>
```

批准标记写在 `changes/<id>.md`，首个任务会同步为 `[/]`；`task.md` 只保留索引。

### Step 5：标记已同步（硬收尾）

桥接成功后必须标记主计划文件已同步。不要省略这一步；否则后续会话无法审计这个 plan 是否已经桥接。

写入目标是**项目运行态目录**的 `synced-plans`，不是 artifact 目录，也不是 `task.md`。worktree 场景必须写宿主项目的 `.pace/synced-plans`，不要写 worktree 自己的 `.pace/synced-plans`。优先使用 hook 提示里的配置文件路径：若提示 `配置文件=/path/to/project/.pace/artifact-root`，则 synced plans 文件是 `/path/to/project/.pace/synced-plans`。

若没有现成路径，用下面命令幂等追加主计划文件名（只写 basename，每行一个）：

```bash
PLAN_PATH="<已桥接的 plan 绝对路径>"
PLAN_NAME="$(basename "$PLAN_PATH")"
GIT_COMMON_DIR="$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [ -n "$GIT_COMMON_DIR" ]; then
  RUNTIME_DIR="$(dirname "$GIT_COMMON_DIR")/.pace"
else
  RUNTIME_DIR="$PWD/.pace"
fi
mkdir -p "$RUNTIME_DIR"
touch "$RUNTIME_DIR/synced-plans"
grep -Fxq "$PLAN_NAME" "$RUNTIME_DIR/synced-plans" || printf '%s\n' "$PLAN_NAME" >> "$RUNTIME_DIR/synced-plans"
```

`~/.claude/plans/<name>.md` 这类 Claude Code native plan 也写 `<name>.md`，不要写完整路径。hook 会把同名 `-design.md` 伴随文件视为已同步；不要手写整个目录名。

禁止一次性记录整个 `docs/plans/` 目录；多窗口场景下会吞掉其他窗口的未桥接计划。

---

## 验证

桥接完成后确认：
- `task.md` 与 `implementation_plan.md` 都有同一 `[[chg-*]]` 索引。
- `changes/<id>.md` 存在，frontmatter `status: planned` 或后续已批准。
- auto-APPROVED 场景下详情文件含 `<!-- APPROVED -->`。
- 项目运行态 `.pace/synced-plans` 已包含源计划 basename。

---

## 转换摘要格式

```text
=== pace-bridge 转换摘要 ===
源计划: <plan path>
变更 ID: CHG-YYYYMMDD-NN
任务范围: T-NNN ~ T-NNN（共 N 个）
批准状态: pending / auto-approved-started
执行方式推荐: subagent-driven-development / executing-plans / dispatching-parallel-agents / direct
```
