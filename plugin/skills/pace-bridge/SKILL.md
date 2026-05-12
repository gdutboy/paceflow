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
- 若用户已经明确选择 artifact root，但配置尚未写入，先运行 hook 提示的 `set-artifact-root` helper（`--choice vault` 或 `--choice local`），再从目标项目 cwd 运行 reserve helper；不要手写 `.pace/artifact-root`，尤其不要在 git worktree 分支目录里手写该文件；不要给 helper 传 `--artifact-dir` / `--artifact-root` / `--project-dir`，自动化只可用 helper 的 `--cwd`。
- Helper 命令来源：优先使用 SessionStart / PreToolUse 提示中的完整命令。若当前上下文没有完整 helper 命令，不要搜索 `~/.claude/plugins/cache` 猜版本；以当前 skill base directory 为基准拼成同版本绝对路径：`../../hooks/set-artifact-root.js`、`../../hooks/reserve-artifact-id.js` 与 `../../hooks/sync-plan.js`。若无法确定 skill base directory，先触发/等待 hook 提供 helper 命令，不要自行扫描 cache。

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

先按 CHG 粒度拆分 plan。CHG 不是大计划容器，而是连续执行、可验证、可关闭的最小变更单元：

- 如果计划横跨前端、后端、存储、迁移、文档/配置，默认拆成多个 CHG。
- 如果某部分可以独立验证、独立回滚、独立交给一个 worktree/session 执行，就拆成独立 CHG。
- 每个 CHG 内可以有多个 `T-NNN`，但这些任务必须服务于同一个闭环，并默认连续完成。
- 不要为了保留原 plan 层级，把 4-5 个独立功能塞进一个 CHG。

每个 CHG 派遣前先预留编号。优先使用 SessionStart / PreToolUse 提示中的 reserve helper 完整命令；如果上下文没有完整命令，按上方 helper 命令来源从当前 skill base directory 拼出同版本绝对路径；不要搜索 `~/.claude/plugins/cache` 猜版本。

```bash
<运行 hook 提供的 node ".../hooks/reserve-artifact-id.js" --operation create-chg 命令>
```

如果当前桥接出的单元是 HOTFIX，预留时必须声明类型：

```bash
<运行 hook 提供的 node ".../hooks/reserve-artifact-id.js" --operation create-chg --type hotfix 命令>
```

同一 session 默认复用尚未消费的 `create-chg` reservation；如果已预留过普通 CHG 但当前单元应是 HOTFIX，或确实需要另一个新编号，加 `--new`：

```bash
<运行 hook 提供的 node ".../hooks/reserve-artifact-id.js" --operation create-chg --type hotfix --new 命令>
```

把 helper 输出的 `artifact_dir` / `operation` / `execution-context` / `reserved-id` / `reserved-file` 放到 Agent prompt 顶部，再追加：

```text
title: <计划标题>
tasks:
  - T-001: <任务标题，含验收条件>
  - T-002: <任务标题，含验收条件>
background: <从 plan 提炼 Why>
scope: <影响文件/模块与改动范围>
technical-decision: <关键设计决策和取舍>
```

任务不能只复制标题。每个任务应能让后续执行者不回读 plan 也知道目标和验收标准。若需要生成多个 CHG，标题应体现各自的闭环范围，如“数据结构/迁移”“后端接口”“前端调用”“文档配置”。

### Step 3：派 artifact writer

派 `artifact-writer` 执行 `create-chg`。agent 会创建：
- `changes/chg-yyyymmdd-nn.md`
- `task.md` 活跃 wikilink 索引
- `implementation_plan.md` 活跃 wikilink 索引

若没有先运行 helper，hook 会要求带 `reserved-id` / `reserved-file` 重派；把提示中的字段原样加入 Agent prompt 后重派。不要让 agent 自行扫描索引分配编号。

### Step 4：auto-APPROVED（可选）

如果用户已在上游计划流程中参与并确认设计，且准备开始当前 CHG 的首个任务，继续派：

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

批准标记写在 `changes/<id>.md`，首个任务会同步为 `[/]`；`task.md` 只保留索引。若一个 plan 被拆成多个 CHG，只 auto-APPROVED 当前准备连续执行的 CHG；其余 CHG 保持 planned。

### Step 5：标记已同步（硬收尾）

桥接成功后必须标记主计划文件已同步。不要省略这一步；否则后续会话无法审计这个 plan 是否已经桥接。

优先使用 SessionStart / PreToolUse 提示中的 plan 同步 helper 完整命令；如果上下文没有完整命令，按上方 helper 命令来源从当前 skill base directory 拼出同版本绝对路径；不要搜索 plugin cache 猜路径。

```bash
<运行 hook 提供的 node ".../hooks/sync-plan.js" --plan "<已桥接的 plan 绝对路径>" 命令>
```

helper 会写入项目运行态 `.pace/synced-plans`，并在 worktree 场景写宿主项目运行态。只传入已桥接的单个 plan 文件路径；不要传目录名或通配路径。

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
