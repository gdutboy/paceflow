---
name: artifact-management
effort: medium
description: >
  PACEflow v6 artifact 格式与变更管理规则。涉及 task.md、implementation_plan.md、
  walkthrough.md、findings.md、corrections.md、changes/ 详情文件、T-NNN、
  CHG/HOTFIX/FINDING/CORRECTION 编号、APPROVED/VERIFIED/ARCHIVE 标记时自动激活。
---

# Artifact 文件管理规则

PACEflow v6 是 agent-driven artifact workflow。主 session 不直接 Write/Edit artifact；需要创建、更新、批准、验证、归档、记录 finding/correction 时，派 `artifact-writer` 执行。

`artifact_dir` 必须指向 hook 解析出的 artifact 根目录。常规存储位置只有两类：Obsidian vault project 或本地项目根目录；`.pace/artifact-root` 是显式覆盖通道，可写入 `vault`、`local` 或自定义绝对/相对路径。选择“本地项目目录”时，这个目录是项目根目录本身；真实 git worktree 会读取宿主项目 `.pace/artifact-root` 并共用宿主 artifact；`.pace/` 只保存配置/运行态信号，不存 `task.md` / `implementation_plan.md` / `changes/**`。

权威规范：
- Agent prompt：`${CLAUDE_PLUGIN_ROOT}/agents/artifact-writer.md`
- Schema / 索引模板：`${CLAUDE_PLUGIN_ROOT}/agent-references/artifact-writer-spec.md`
- 操作步骤：`${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/*.md`

---

## v6 文件模型

索引文件：

| 文件 | 用途 | 活跃区内容 |
|------|------|------------|
| `spec.md` | 项目元数据与技术栈 | 项目事实 |
| `task.md` | CHG/HOTFIX 任务索引 | `[[chg-id]]` / `[[hotfix-id]]` 行 |
| `implementation_plan.md` | CHG/HOTFIX 实施索引 | 同 task.md 的变更索引 |
| `walkthrough.md` | 完成记录索引 | 日期表格行 |
| `findings.md` | finding 摘要索引 | `[[finding-id|title]]` 行 |
| `corrections.md` | correction 摘要索引 | `[[correction-yyyy-mm-dd-nn-slug]]` 行 |

详情文件：

```text
changes/
├── chg-yyyymmdd-nn.md
├── hotfix-yyyymmdd-nn.md
├── findings/finding-yyyy-mm-dd-slug.md
└── corrections/correction-yyyy-mm-dd-nn-slug.md
```

`task.md`、`implementation_plan.md`、`walkthrough.md`、`findings.md`、`corrections.md` 只保留索引。任务清单、实施详情、工作记录、finding 详情、correction 详情都写入 `changes/**`。

---

## CHG 粒度

CHG/HOTFIX 是连续执行、可验证、可关闭的最小变更单元，不是大计划容器。

- 大计划可以存在，但应拆成多个 CHG：数据结构/迁移、后端接口、前端调用、文档/配置等可独立验证的部分分别建 CHG。
- 每个 CHG 内可以有多个 `T-NNN`，但这些任务应服务于同一个闭环，并默认在一次执行流中完成。
- 默认收尾路径是 `close-chg complete-open-tasks:true`，它会把仍 open 的 T-NNN 统一收口为 `[x]`、写 VERIFIED、归档索引并写 walkthrough。
- `update-status` 不是逐步看板更新；只在暂停、阻塞、跳过、跨 session、长任务进度或多 CHG/worktree 可见性需要时使用。

---

## 唯一写入路径

| 目标 | 操作 |
|------|------|
| 创建 CHG/HOTFIX | 派 `artifact-writer`，operation=`create-chg` |
| 仅批准 C 阶段，暂不开始 | operation=`update-chg`，action=`approve`，需要 `approval-confirmed: true` + `approval-source` + `approval-evidence` |
| 批准并开始首个任务 | operation=`update-chg`，action=`approve-and-start`，需要 `approval-confirmed: true` + `approval-source` + `approval-evidence` + `task-id` |
| 暂停/阻塞/跳过/跨 session 时更新任务状态 | operation=`update-chg`，section=`tasks`，action=`update-status` |
| 追加工作记录/实施说明 | operation=`update-chg`，section=`work-record` / `implementation`，action=`append` |
| 只记录 V 阶段暂不归档 | operation=`update-chg`，action=`verify` |
| 归档 CHG/HOTFIX | operation=`archive-chg` |
| 最后任务验证后完成并归档 | operation=`close-chg`，需要 `verification-confirmed: true` + `complete-open-tasks: true` |
| 记录 finding | operation=`record-finding` |
| 记录 correction | operation=`record-correction` |

主 session 禁止：
- 直接写 `<!-- APPROVED -->` / `<!-- VERIFIED -->`
- 直接设置 `verified-date`
- 在 `task.md` 或 `implementation_plan.md` 写 CHG 三级标题详情段
- 在 `findings.md` 写 finding 详情段
- 用移动 `<!-- ARCHIVE -->` 标记的方式归档 CHG 详情

---

## 标记位置

`<!-- APPROVED -->` 与 `<!-- VERIFIED -->` 只允许在 `changes/<id>.md` 内出现：

```markdown
- [x] T-002 验证任务

<!-- APPROVED -->
<!-- VERIFIED -->

## 实施详情
```

`verified-date` 是机器权威，`<!-- VERIFIED -->` 是人读/hook 信号。两者必须同时存在或同时不存在。

---

## 状态映射

| detail frontmatter `status` | 根索引 checkbox | 说明 |
|-----------------------------|-----------------|------|
| `planned` | `[ ]` | 已创建，未批准执行 |
| `in-progress` | `[/]` | 已批准并开始执行 |
| `completed` + 未 verified | `[x]` 活跃区 | 执行完成，V 阶段待验证 |
| `completed` + verified | `[x]` 活跃区 | 验证通过，待归档 |
| `archived` | `[x]` ARCHIVE 下方 | 已归档 |
| `cancelled` | `[-]` ARCHIVE 下方 | 取消，不验证 |

任务状态仍使用 `T-NNN`：

| 标记 | 含义 |
|------|------|
| `[ ]` | 未开始 |
| `[/]` | 进行中 |
| `[x]` | 完成 |
| `[!]` | 阻塞 |
| `[-]` | 跳过 |

---

## 编号规范

- `CHG-YYYYMMDD-NN` / `HOTFIX-YYYYMMDD-NN`：由 hook 原子预留。主路径是在派 `artifact-writer create-chg` 前先运行 `node "${CLAUDE_PLUGIN_ROOT}/hooks/reserve-artifact-id.js" --operation create-chg`，再把 helper 输出的 `reserved-id` / `reserved-file` 原样写入 Agent prompt。若跳过 helper，PreToolUse 会用 deny 文案返回同样字段，作为 fallback。
- `T-NNN`：由 artifact writer 为当前 CHG/HOTFIX 分配的局部编号，写入 `changes/<id>.md` 的 `## 任务清单`；不同 CHG 可以重复 `T-001`，后续操作用 `target + task-id` 定位。
- `FINDING-YYYY-MM-DD-slug`：详情在 `changes/findings/`。
- `CORRECTION-YYYY-MM-DD-NN`：由 hook 在派 `record-correction` 时原子预留；frontmatter 稳定 ID；详情文件名和 wikilink 追加 slug，格式为 `changes/corrections/correction-yyyy-mm-dd-nn-slug.md`。

不要从 `implementation_plan.md` 的内嵌详情推导编号；v6 没有内嵌详情区。

---

## 常用指令形态

创建变更：

先预留编号：

```bash
node "${CLAUDE_PLUGIN_ROOT}/hooks/reserve-artifact-id.js" --operation create-chg
```

把 helper 输出放在 prompt 顶部：

```text
派 artifact-writer:
artifact_dir: <helper 输出>
operation: create-chg
reserved-id: <helper 输出>
reserved-file: <helper 输出>
title: <标题>
tasks:
  - T-001: <任务>
background: <Why>
scope: <What>
technical-decision: <How>
```

批准：

```text
派 artifact-writer:
artifact_dir: <SessionStart hook 提供的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: approve
approval-confirmed: true
approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan
approval-evidence: <用户原话或已确认方案摘要>
```

批准并开始：

```text
派 artifact-writer:
artifact_dir: <SessionStart hook 提供的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: approve-and-start
task-id: T-001
approval-confirmed: true
approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan
approval-evidence: <用户原话或已确认方案摘要>
```

只记录验证、暂不归档：

```text
派 artifact-writer:
artifact_dir: <SessionStart hook 提供的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: verify
verify-summary: <验证通过摘要>
```

归档：

```text
派 artifact-writer:
artifact_dir: <SessionStart hook 提供的 artifact 目录>
operation: archive-chg
target: CHG-YYYYMMDD-NN
walkthrough-summary: <完成摘要>
```

验证后收尾并归档：

```text
派 artifact-writer:
artifact_dir: <SessionStart hook 提供的 artifact 目录>
operation: close-chg
target: CHG-YYYYMMDD-NN
verification-confirmed: true
complete-open-tasks: true
verify-summary: <已运行并阅读的验证结果>
walkthrough-summary: <完成摘要>
```

连续执行的 CHG 不需要在每个 T-NNN 完成后都派 `update-status`。只要主 session 已运行并读取验证结果，`close-chg complete-open-tasks:true` 就是默认收口方式。

---

## 关联 Skill

- `paceflow:pace-workflow`：P-A-C-E-V 流程控制。
- `paceflow:pace-knowledge`：finding/correction 需要沉淀到 knowledge/ 时使用。
