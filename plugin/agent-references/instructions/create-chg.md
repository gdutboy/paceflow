# create-chg 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`（schema / wikilink / ARCHIVE 等通用规则）

## When To Use

用于创建新的 CHG/HOTFIX 详情文件和根索引行。主 session 必须先通过 reserve helper 取得 `reserved-id` / `reserved-file`，再派本操作。

## Correct Prompt Example

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: create-chg
execution-context: <reserve helper 输出>
reserved-id: <reserve helper 输出>
reserved-file: <reserve helper 输出>
title: <变更标题>
tasks:
  - T-001: <任务标题与验收>
background: <Why>
scope: <What>
technical-decision: <How>
```

## 输入字段

- `title`（必填）
- `tasks`（必填，至少 1 个；推荐格式 `["任务描述", ...]`，artifact-writer 为当前 CHG/HOTFIX 分配 `T-001...`）
- `type`（默认 change，可选 hotfix）
- `related-finding`（可选，wikilink）
- `background` / `scope` / `technical-decision`（可选）
- `execution-context`（可选但推荐，由 reserve helper 输出，例如 `[worktree:: main] [branch:: main]`）

缺失必填字段时立即报告 `missing-fields`，字段值以 prompt 原样为准：
- 缺 `title` 或 `title` 为空 → `missing-fields: title`，`title` 只能取自 prompt 显式 `title`，与 `background` / `scope` / task 描述无关
- 缺 `tasks` 或 `tasks` 为空 → `missing-fields: tasks`
- 任一必填字段缺失时仅报告 `missing-fields`：跳过 hook 预留编号写入、跳过读取索引、跳过对任何 artifact 的 Write / Edit

## 操作步骤

> **报告标题强制**：最终输出的第一行字面是 `## artifact-writer 报告`，第一个字符为 `#`，标题前直接进入该行（无说明文字、无空行）。`report_title_strict` 会机械检查，标题不匹配即 FAIL。

0. 前置检查：先校验必填字段；缺字段 → 报告 `missing-fields` 并停止（不写文件）。再用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 判断 base changes 目录；`MISSING` 时报告 `not-pace-project` 并停止，不写任何文件（base `changes/` 由项目初始化负责创建）。目录存在性以该 `test -d` 结果为准。
1. 计算 chg-id（详见下方"CHG-ID 推算"段）
2. 为当前 CHG/HOTFIX 分配局部任务 ID：按输入顺序生成 `T-001...T-NNN`；若迁移/测试输入已显式带 `T-NNN:`，保留该 CHG 内编号。任务编号始终是 CHG 局部的，编号来源限于本次输入顺序或输入自带的 `T-NNN`。
3. 写入前生成并自检详情文件 payload（frontmatter 顺序、任务清单、4 段结构）
4. Write `changes/chg-yyyymmdd-nn.md`（详情文件结构见下）
5. Read + Edit `task.md` 添加索引行（活跃任务区，按时间倒序插入顶部；按下方"索引插入契约"组织替换片段）
6. Read + Edit `implementation_plan.md` 添加索引行（变更索引区；按下方"索引插入契约"组织替换片段）
7. 基于 payload + Edit 成功 + hook 反馈做低成本验证；验证只依据这三项信号即可，仅当 hook 报告本次目标问题时才重新 Read 详情文件或两个索引文件

资源约束（本操作只触达详情文件与 `task.md` / `implementation_plan.md` 两个索引）：
- 读取范围限于上述目标文件，`walkthrough.md` / `findings.md` / `corrections.md` 与 `~/.claude` 均不在本操作范围内
- 报告中的体量描述基于已掌握的 payload，无需运行 `wc` / `du` 统计大小或行数

## CHG-ID 分配（hook reservation + 二次防御）

并发派多 agent 时，编号唯一来源是 hook 预留：主 session 先运行 hook/skill 提供的 `reserve-artifact-id.js --operation create-chg` 绝对路径命令，原子预留 `CHG-YYYYMMDD-NN` 或 `HOTFIX-YYYYMMDD-NN`，再把 helper 输出的 `reserved-id` / `reserved-file` 原样写进 Agent prompt。artifact-writer 始终使用 prompt 中的 hook 预留编号（`reserved-id` 是 nn 的权威来源）。

二次防御：

1. 若 prompt 已包含 helper 或 hook deny 文案给出的 `reserved-id` / `reserved-file`：直接使用该编号与文件路径。
2. 若缺少 reserved 信息：报告 `hook-deny` 并停止，由主 session 重新预留后再派遣 artifact-writer（新建 `changes/chg-*.md` / `changes/hotfix-*.md` 始终以 reserved 信息为前提）。
3. 写入目标文件已存在 → 报告 `file-conflict` 并停止，由主 session 重新派遣；已有详情保持原样（Write 仅用于尚不存在的预留文件）。

## 详情文件结构

```markdown
---
[frontmatter, 见 spec §2.1]
---

# <title>

## 任务清单

- [ ] T-NNN <task description>
- [ ] T-NNN <task description>

## 实施详情

**背景（Why）**：<background>

**范围（What）**：<scope>

**技术决策（How）**：<technical-decision>

**T-NNN <task title>**：
- 具体改动说明

## 工作记录

| 日期 | 完成内容 |
| --- | --- |

## 关联调研

- [[<related-finding>]] <关联说明>（如有）
```

## 任务 ID 与索引行

`T-NNN` 是 **当前 CHG/HOTFIX 内的局部任务 ID**，不是全项目全局 ID。不同 CHG 都可以有 `T-001`，后续操作必须同时带 `target: CHG-...` 与 `task-id: T-...` 消除歧义。主 session 不需要为新 CHG 预分配 T-ID。

```
- [ ] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-NNN~T-NNN] [worktree:: <name>] [branch:: <branch>]
```

### 索引插入契约

目标输出是：每条 CHG/HOTFIX 索引独占一行，且该行从行首 `- [` 开始，位于说明注释之后、`<!-- ARCHIVE -->` 之前。

<example>
Read 到的空活跃区：

```markdown
<!-- 详情与任务清单位于 changes/<id>.md；本文件只保留索引。 -->


<!-- ARCHIVE -->
```

Edit 使用的替换片段：

```text
old_string:


<!-- ARCHIVE -->

new_string:

- [ ] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-001~T-001] [worktree:: main] [branch:: main]

<!-- ARCHIVE -->
```

替换后的目标片段：

```markdown
<!-- 详情与任务清单位于 changes/<id>.md；本文件只保留索引。 -->

- [ ] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-001~T-001] [worktree:: main] [branch:: main]

<!-- ARCHIVE -->
```
</example>

写入前自检 `new_string`：如果 `old_string` 以换行开头，`new_string` 也保留一个前导换行，使新增索引行与上一行注释、标题或正文之间保留空行隔开。验证"跨索引一致性"时，按行首格式 `^- \[[ x/!-]\] \[\[(chg|hotfix)-YYYYMMDD-NN\]\]` 逐行匹配（以行首 checkbox + wikilink 的完整格式为准）。

刚创建的 CHG 默认状态 `[ ]`（planned），详情文件 **不包含** `<!-- APPROVED -->` 标记。

若 prompt 包含 `execution-context`，task.md 与 implementation_plan.md 的索引行必须保留其中的 `[worktree:: ...] [branch:: ...]` 字段，方便多 worktree 并发时人读区分。artifact 索引只写 `[worktree:: ...] [branch:: ...]` 这类人读上下文；session id、lock、owner state 等运行态只写 `.pace/`。

## 边界

- 缺 `title` 或 `title` 为空 → `missing-fields: title`（`title` 只取自 prompt 显式字段）
- 缺 `tasks` 或 `tasks` 为空 → `missing-fields: tasks`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`

PACE 流程后续：
- 若用户批准并准备开始 → 主 session 优先调用 `update-chg action=approve-and-start approval-confirmed:true approval-source:<source> approval-evidence:<evidence> task-id:T-NNN`
- 若用户只批准但暂不执行 → 才调用 `update-chg action=approve approval-confirmed:true approval-source:<source> approval-evidence:<evidence>` 添加 `<!-- APPROVED -->`
- 实施推进 → 连续执行时由主 session 写代码、运行验证，验证通过后优先 `close-chg complete-open-tasks:true` 收口；`update-chg action=update-status` 仅用于暂停、阻塞、跳过、跨 session 或暂不验证（详见 update-chg 规范）
