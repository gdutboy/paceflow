---
name: artifact-management
effort: medium
description: >
  Use for PACEflow artifact fields and formats: task indexes, CHG/HOTFIX
  lifecycle operations, artifact-writer prompts, approvals, verification, and archive.
---

# Artifact 文件管理规则

PACEflow v6 是 agent-driven artifact workflow。主 session 不直接 Write/Edit artifact；需要创建、更新、批准、验证、归档、记录 finding/correction 时，派 `artifact-writer` 执行。

`artifact_dir` 必须指向 hook 解析出的 artifact 根目录，只用于 PaceFlow artifacts：`spec.md` / `task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` / `corrections.md` / `changes/**`。

如果用户已明确选择 vault/local 但 artifact-root 配置还不存在，正确做法是先运行 hook 提示的 `set-artifact-root` helper（`--choice vault` 或 `--choice local`），再从目标项目 cwd 运行 reserve helper。helper 会写入权威 runtime 配置位置。禁止手写 `.pace/artifact-root`，尤其不要在 git worktree 分支目录里手写该文件。reserve helper 只接受自身文档列出的参数；自动化只可用 `--cwd` 指定项目 cwd，不传 `--artifact-dir` / `--artifact-root` / `--project-dir`。

Helper 命令来源：正确做法是优先使用 SessionStart / PreToolUse 提示中的完整命令。若当前上下文没有完整 helper 命令，以当前 skill 根目录为基准拼成同版本绝对路径：`../../hooks/set-artifact-root.js` 与 `../../hooks/reserve-artifact-id.js`。若从 `references/` 文件阅读说明，仍以 skill 根目录为基准，不以 `references/` 子目录为基准。若无法确定 skill 根目录，先触发/等待 hook 提供 helper 命令。禁止搜索 `~/.claude/plugins/cache` 猜版本。

权威规范：
- Agent prompt：`${CLAUDE_PLUGIN_ROOT}/agents/artifact-writer.md`
- Schema / 索引模板：`${CLAUDE_PLUGIN_ROOT}/agent-references/artifact-writer-spec.md`
- 操作步骤：`${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/*.md`
- 格式速查：[references/format-reference.md](references/format-reference.md)
- CHG/HOTFIX 生命周期速查：[references/change-lifecycle.md](references/change-lifecycle.md)

---

## v6 文件模型

Artifact root 文件：

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

`spec.md` 是项目事实文件，不是 artifact-writer 管理对象。技术栈、依赖、配置、目录结构或编码约定变化时，由主 session 用 `Edit` 同步；不要用 `Write` 覆盖已有 `spec.md`。它不含 `ARCHIVE` / `APPROVED` / `VERIFIED` 标记，也不被 `close-chg` 或 `archive-chg` 修改。

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
| 仅批准 C 阶段，暂不开始 | operation=`update-chg`，target=`CHG-...`，action=`approve`，需要 `approval-confirmed: true` + `approval-source` + `approval-evidence` |
| 批准并开始首个任务 | operation=`update-chg`，target=`CHG-...`，action=`approve-and-start`，需要 `approval-confirmed: true` + `approval-source` + `approval-evidence` + `task-id` |
| 暂停/阻塞/跳过/跨 session 时更新任务状态 | operation=`update-chg`，target=`CHG-...`，section=`tasks`，action=`update-status`，task-id=`T-NNN`；`new-status=[!]` 必须带 `status-reason` / `block-reason` / `pause-reason` |
| 追加工作记录/实施说明 | operation=`update-chg`，target=`CHG-...`，section=`work-record` / `implementation`，action=`append` |
| 只记录 V 阶段暂不归档 | operation=`update-chg`，target=`CHG-...`，action=`verify` |
| 归档 CHG/HOTFIX | operation=`archive-chg`，target=`CHG-...` |
| 最后任务验证后完成并归档 | operation=`close-chg`，target=`CHG-...`，需要 `verification-confirmed: true` + `complete-open-tasks: true` |
| 记录 finding | operation=`record-finding` |
| 记录 correction | 先运行 reserve helper `--operation record-correction`，再派 operation=`record-correction` 并带 `reserved-file-prefix` |

`action=approve` 只完成 C 阶段，CHG 仍是 ready/deferred，不能据此写项目文件；只有 `approve-and-start` 或将任务恢复为 `[/]` 后才进入 E 阶段。`[!]` 表示 blocked/deferred：允许 Stop，但 Stop 会显示人可见提醒，恢复前不能继续写项目文件。

Legacy v5 项目必须先按 hook 提示 dry-run/迁移或桥接到 v6；不要在旧 v5 活跃区继续手写详情。Git worktree 场景下 artifact root 与 `.pace` 运行态使用宿主项目共享位置；普通项目文件仍写当前 worktree/cwd。

主 session 禁止：
- 直接写 `<!-- APPROVED -->` / `<!-- VERIFIED -->`
- 直接设置 `verified-date`
- 在 `task.md` 或 `implementation_plan.md` 写 CHG 三级标题详情段
- 在 `findings.md` 写 finding 详情段
- 用移动 `<!-- ARCHIVE -->` 标记的方式归档 CHG 详情

### 最小字段模板

复制模板时保留字段名，不要只在正文里提到 CHG-ID 或 task-id。

创建 CHG/HOTFIX：

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

仅批准，暂不开始：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: approve
approval-confirmed: true
approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan
approval-evidence: <用户原话或已确认方案摘要>
```

批准并开始：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: approve-and-start
task-id: T-001
approval-confirmed: true
approval-source: user-directive | ask-user-question | accepted-plan | prior-approved-plan
approval-evidence: <用户原话或已确认方案摘要>
```

恢复暂停/阻塞任务：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
section: tasks
action: update-status
task-id: T-001
new-status: [/]
status-reason: <用户要求恢复或当前阻塞已解除>
```

验证后收尾归档：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: close-chg
target: CHG-YYYYMMDD-NN
verification-confirmed: true
complete-open-tasks: true
verify-summary: <已运行并读取的验证结果>
walkthrough-summary: <完成摘要>
```

只记录验证，暂不归档：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: verify
verify-summary: <已运行并读取的验证结果>
```

只归档已验证 CHG：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: archive-chg
target: CHG-YYYYMMDD-NN
walkthrough-summary: <完成摘要>
```

记录 finding：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: record-finding
title: <finding 标题>
summary: <≤200 字摘要>
type: research | observation | comparison | bug-report
impact: P0 | P1 | P2 | P3
body: <完整 Markdown 正文>
```

用户纠正类记录使用 `record-correction`，不要把 `type: correction` 写入 `record-finding`。

记录 correction：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: record-correction
reserved-id: <reserve helper 输出>
reserved-file-prefix: <reserve helper 输出>
trigger-quote: <用户纠正原话>
wrong-behavior: <错误行为，至少 20 字符>
correct-behavior: <正确行为，至少 20 字符>
trigger-scenario: <触发场景>
root-cause: <根因>
knowledge-link: [[note]] 或 project-scope: project-only
```

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
| `[!]` | 暂停/阻塞 |
| `[-]` | 跳过 |

---

## 编号规范

- `CHG-YYYYMMDD-NN` / `HOTFIX-YYYYMMDD-NN`：由 hook 原子预留。主路径是在派 `artifact-writer create-chg` 前先运行 SessionStart / PreToolUse 提示中的 reserve helper 完整命令；如果上下文没有完整命令，按上方 helper 命令来源从当前 skill 根目录拼出同版本绝对路径；不要搜索 `~/.claude/plugins/cache` 猜版本。普通 CHG 用 `--operation create-chg`；HOTFIX 用 `--operation create-chg --type hotfix`。同一 session 默认复用尚未消费的 `create-chg` reservation，若已预留普通 CHG 后要改建 HOTFIX，或确实要第二个新编号，加 `--new`。再把 helper 输出的 `reserved-id` / `reserved-file` 原样写入 Agent prompt。
- `T-NNN`：由 artifact writer 为当前 CHG/HOTFIX 分配的局部编号，写入 `changes/<id>.md` 的 `## 任务清单`；不同 CHG 可以重复 `T-001`，后续操作用 `target + task-id` 定位。
- `FINDING-YYYY-MM-DD-slug`：详情在 `changes/findings/`。
- `CORRECTION-YYYY-MM-DD-NN`：由 hook 在派 `record-correction` 前原子预留；frontmatter 稳定 ID；详情文件名和 wikilink 追加 slug，格式为 `changes/corrections/correction-yyyy-mm-dd-nn-slug.md`。先运行 `node ".../hooks/reserve-artifact-id.js" --operation record-correction`，再把 helper 输出的 `reserved-file-prefix` 原样写入 Agent prompt。

不要从 `implementation_plan.md` 的内嵌详情推导编号；v6 没有内嵌详情区。

---

## 常用指令形态

创建变更：

先预留编号：

```bash
<运行 hook 提供的 node ".../hooks/reserve-artifact-id.js" --operation create-chg 命令>
```

HOTFIX 预留：

```bash
<运行 hook 提供的 node ".../hooks/reserve-artifact-id.js" --operation create-chg --type hotfix 命令>
```

若同一 session 已有未消费的普通 CHG reservation，但现在要创建 HOTFIX，或确实要新编号：

```bash
<运行 hook 提供的 node ".../hooks/reserve-artifact-id.js" --operation create-chg --type hotfix --new 命令>
```

Correction 预留：

```bash
<运行 hook 提供的 node ".../hooks/reserve-artifact-id.js" --operation record-correction 命令>
```

把 helper 输出放在 prompt 顶部：

```text
派 artifact-writer:
artifact_dir: <helper 输出>
operation: create-chg
execution-context: <helper 输出>
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
