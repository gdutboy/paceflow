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

Project Root 是 PACEflow 管理边界；`local` artifact root 表示 Project Root 本地目录，不是当前子目录。普通子目录默认继承最近父级 Project Root；独立子项目先运行 `set-project-root --mode independent`，再选择 artifact root。

继续、恢复或收口已有 CHG/HOTFIX 前，先 `Read` 对应 `changes/<id>.md`，确认 `## 任务清单`、实施详情和 `## 工作记录`；SessionStart 摘要只用于定位，不替代详情文件。

如果用户已明确选择 vault/local 或自定义 artifact 目录但 artifact-root 配置还不存在，正确做法是先运行 hook 提示的 `set-artifact-root` helper（`--choice vault`、`--choice local`，或 `--choice <绝对路径或相对 Project Root 路径>`），再从目标项目 cwd 运行 reserve helper。helper 会写入权威 runtime 配置位置。`.pace/artifact-root` 只由 `set-artifact-root` helper 写入；git worktree 与继承父 Project Root 的子目录走宿主项目共享位置。reserve helper 接受自身文档列出的参数；自动化用 `--cwd` 指定项目 cwd，其余 artifact/root/project 路径由 helper 自行解析。

Helper 命令来源按以下顺序执行：

1. 如果 SessionStart / PreToolUse 已给出完整 `node ".../hooks/*.js"` 命令，直接复制那条命令。
2. 如果当前项目还没有 PACEflow 信号，但本 skill 已加载，使用 Claude Code 加载本 skill 时提供的 skill 根目录（本 `SKILL.md` 所在目录）作为 `<skill-root>`。按当前动作选择下面一条模板运行；这不是顺序执行清单：

```bash
node "<skill-root>/../../hooks/set-project-root.js" --mode independent
node "<skill-root>/../../hooks/set-artifact-root.js" --choice local
node "<skill-root>/../../hooks/set-artifact-root.js" --choice vault
node "<skill-root>/../../hooks/reserve-artifact-id.js" --operation create-chg
node "<skill-root>/../../hooks/reserve-artifact-id.js" --operation record-correction
```

3. 如果从 `references/` 文件阅读说明，仍以 skill 根目录为基准，不以 `references/` 子目录为基准。
4. 如果当前上下文没有完整 hook 命令，也没有可用的 skill 根目录元数据，先触发/等待 hook 给出 helper 命令。helper 路径以 hook 命令或 skill 根目录为准，不扫描 `~/.claude/plugins/cache` 猜版本。

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

`spec.md` 是项目事实文件，不是 artifact-writer 管理对象。技术栈、依赖、配置、目录结构或编码约定变化时，由主 session 用 `Edit` 增量同步已有 `spec.md`。它不含 `ARCHIVE` / `APPROVED` / `VERIFIED` 标记，也不被 `close-chg` 或 `archive-chg` 修改。

---

## CHG 粒度

CHG/HOTFIX 是连续执行、可验证、可关闭的最小变更单元，不是大计划容器。

- 大计划可以存在，但应拆成多个 CHG：数据结构/迁移、后端接口、前端调用、文档/配置等可独立验证的部分分别建 CHG。
- 每个 CHG 内可以有多个 `T-NNN`，但这些任务应服务于同一个闭环，并默认在一次执行流中完成。
- 默认收尾路径是 `close-chg complete-open-tasks:true`，它会把仍 open 的 T-NNN 统一收口为 `[x]`、写 VERIFIED、归档索引并写 walkthrough。
- `update-status` 不是逐步看板更新；只在暂停、阻塞、跳过、跨 session、长任务进度或多 CHG/worktree 可见性需要时使用。
- 如果 CHG 的全部任务都被标为 `[-]`，该 CHG 表示取消，frontmatter 使用 `status: cancelled`；随后派 `archive-chg` 做取消归档，把根索引移到 ARCHIVE 下方 `[-]`，不验证、不改为 archived。

---

## 唯一写入路径

| 目标 | 操作 |
|------|------|
| 创建 CHG/HOTFIX | 派 `artifact-writer`，operation=`create-chg` |
| 仅批准 C 阶段，暂不开始 | operation=`update-chg`，target=`CHG-...`，action=`approve`，需要 `approval-confirmed: true` + `approval-source` + `approval-evidence` |
| 批准并开始首个任务 | operation=`update-chg`，target=`CHG-...`，action=`approve-and-start`，需要 `approval-confirmed: true` + `approval-source` + `approval-evidence` + `task-id` |
| 暂停/阻塞/跳过/跨 session 时更新任务状态 | operation=`update-chg`，target=`CHG-...`，section=`tasks`，action=`update-status`，task-id=`T-NNN`；`new-status=[!]` 必须带 `status-reason` / `block-reason` / `pause-reason`；全任务 `[-]` 表示取消 |
| 追加工作记录/实施说明 | operation=`update-chg`，target=`CHG-...`，section=`work-record` / `implementation`，action=`append` |
| 只记录 V 阶段暂不归档 | operation=`update-chg`，target=`CHG-...`，action=`verify` |
| 归档 CHG/HOTFIX | operation=`archive-chg`，target=`CHG-...`；已取消 CHG 也用此操作做取消归档 |
| 最后任务验证后完成并归档 | operation=`close-chg`，target=`CHG-...`，需要 `verification-confirmed: true` + `complete-open-tasks: true` |
| 记录 finding | operation=`record-finding` |
| 记录 correction | 先运行 reserve helper `--operation record-correction`，再派 operation=`record-correction` 并带 `reserved-file-prefix` |

`action=approve` 只完成 C 阶段，CHG 仍是 ready/deferred，不能据此写项目文件；只有 `approve-and-start` 或将任务恢复为 `[/]` 后才进入 E 阶段。`[!]` 表示 blocked/deferred：允许 Stop，但 Stop 会显示人可见提醒，恢复前不能继续写项目文件。

Legacy v5 项目先按 hook 提示 dry-run/迁移或桥接到 v6，迁移后再在 v6 `changes/**` 写详情。Git worktree 场景下 artifact root 与 `.pace` 运行态使用宿主项目共享位置；普通子目录默认继承最近父级 Project Root；普通项目文件仍写当前 worktree/cwd。

以下内容只由 `artifact-writer` 写入，主 session 通过派遣 agent 完成：
- `<!-- APPROVED -->` / `<!-- VERIFIED -->` 标记由 `update-chg` / `close-chg` 写入
- `verified-date` 由 `close-chg`（或 `update-chg action=verify`）设置
- CHG 三级标题详情段写入 `changes/<id>.md`，`task.md` / `implementation_plan.md` 只留 wikilink 索引
- finding 详情段写入 `changes/findings/<id>.md`，`findings.md` 只留摘要索引
- CHG 归档由 `close-chg` / `archive-chg` 移动索引行并更新 frontmatter 完成

### 最小字段模板

复制模板时保留字段名，CHG-ID 与 task-id 都用对应字段承载。

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

验证后收尾归档（close-chg 折叠 VERIFIED + REVIEWED + 归档；R 审计是主 session 在派 close-chg 前完成的编排步骤，详见 Skill(paceflow:pace-workflow) R 小节）：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: close-chg
target: CHG-YYYYMMDD-NN
verification-confirmed: true
complete-open-tasks: true
review-confirmed: true
review-source: manual | <所选 review agent 名>
review-findings: <P0/P1/P2/P3 计数 + 各自处置（HOTFIX / won't-fix finding / record-finding 的 wikilink）>
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

只记录审计，暂不归档（已 verified 的 CHG 跑完 R 审计、但还不收口时用；对标 `action=verify`）：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: review
review-confirmed: true
review-source: manual | <所选 review agent 名>
review-findings: <P0/P1/P2/P3 计数 + 各自处置 wikilink>
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

用户纠正类记录使用 `record-correction`；`record-finding` 的 `type` 限于 `research | observation | comparison | bug-report`。

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

`<!-- APPROVED -->`、`<!-- VERIFIED -->` 与 `<!-- REVIEWED -->` 只允许在 `changes/<id>.md` 内出现，三者**三行相邻、自上而下**：

```markdown
- [x] T-002 验证任务

<!-- APPROVED -->
<!-- VERIFIED -->
<!-- REVIEWED -->

## 实施详情
```

`verified-date` 是机器权威，`<!-- VERIFIED -->` 是人读/hook 信号。两者必须同时存在或同时不存在。
`<!-- VERIFIED -->` 必须紧邻 `<!-- APPROVED -->` 下一行，中间不留空行。

### R 阶段 REVIEWED 字段格式

与 V 阶段 verify/VERIFIED **完全同构**。R 阶段对抗审计跑过后，由 `close-chg`（主路径）或 `update-chg action=review`（暂不归档）写入。

| 维度 | 内容 |
|------|------|
| 机器权威（单源） | frontmatter `reviewed-date: YYYY-MM-DDTHH:mm:ss+08:00` |
| 人读 / hook 信号 | `<!-- REVIEWED -->`，紧邻 `<!-- VERIFIED -->` 下一行（无空行间隔） |
| 一致性约束 | 两者同时存在 ↔ 同时不存在；不一致即 `format-violation` |
| 顺序约束 | 仅在 `<!-- VERIFIED -->` 已存在时出现（先验证再审计）；未 verified 即出现 REVIEWED 即 `format-violation` |

派 `close-chg` 或 `update-chg action=review` 时必填三字段：

- `review-confirmed: true`——主 session 已编排对抗审计并路由 findings 后传入，agent 以此字段为唯一依据折叠 REVIEWED（仿 `verification-confirmed` / `approval-confirmed` gating）。缺失 → `missing-fields`，非 `true` → `format-violation`。
- `review-source`——`manual`（主 session 自己瞄一眼）或所选 review agent / 棱镜名。
- `review-findings`——P0/P1/P2/P3 计数 + 各自处置（HOTFIX / won't-fix finding / record-finding 的 wikilink），写入 `## 审查记录` 段（位于 `## 工作记录` 之后）：

```markdown
## 审查记录

| 日期 | 审计来源 | findings |
| --- | --- | --- |
| <YYYY-MM-DD> | <review-source> | <P0/P1/P2/P3 计数 + 各自处置 wikilink> |
```

> **流程证据语义，非质量裁决**：`<!-- REVIEWED -->` 只证"对抗审计这步跑过并记录了 findings 处置"，与 `<!-- APPROVED -->` 证"批准了"、`<!-- VERIFIED -->` 证"验证跑了"同理，**都不证明对应对象正确**。审计的派发、findings 路由（开 HOTFIX / record-finding）是主 session 编排活（见 Skill(paceflow:pace-workflow) R 小节）；agent 只落 `reviewed-date` + `<!-- REVIEWED -->` + `## 审查记录` 三项证据，不验证 findings 真伪、不要求"修完"。

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

- `CHG-YYYYMMDD-NN` / `HOTFIX-YYYYMMDD-NN`：由 hook 原子预留。主路径是在派 `artifact-writer create-chg` 前先运行 SessionStart / PreToolUse 提示中的 reserve helper 完整命令；如果上下文没有完整命令，按上方 helper 命令来源从当前 skill 根目录拼出同版本绝对路径。普通 CHG 用 `--operation create-chg`；HOTFIX 用 `--operation create-chg --type hotfix`。`create-chg --type` 只支持 `change` / `hotfix`；finding/research 沉淀走 `record-finding`。同一 session 默认复用尚未消费的 `create-chg` reservation，若已预留普通 CHG 后要改建 HOTFIX，或确实要第二个新编号，加 `--new`。再把 helper 输出的 `reserved-id` / `reserved-file` 原样写入 Agent prompt。
- `T-NNN`：由 artifact writer 为当前 CHG/HOTFIX 分配的局部编号，写入 `changes/<id>.md` 的 `## 任务清单`；不同 CHG 可以重复 `T-001`，后续操作用 `target + task-id` 定位。
- `FINDING-YYYY-MM-DD-slug`：详情在 `changes/findings/`。
- `CORRECTION-YYYY-MM-DD-NN`：由 hook 在派 `record-correction` 前原子预留；frontmatter 稳定 ID；详情文件名和 wikilink 追加 slug，格式为 `changes/corrections/correction-yyyy-mm-dd-nn-slug.md`。先按 helper 命令来源运行 `reserve-artifact-id.js --operation record-correction`，再把 helper 输出的 `reserved-file-prefix` 原样写入 Agent prompt。

编号一律来自 helper 预留；v6 的 `implementation_plan.md` 只保留索引，无内嵌详情区可供推导。

---

## 常用指令形态

创建变更：

先预留编号：

```bash
node "<SessionStart/PreToolUse 输出的 reserve-artifact-id.js 绝对路径>" --operation create-chg
# 若没有 hook 输出但本 skill 已加载：
node "<skill-root>/../../hooks/reserve-artifact-id.js" --operation create-chg
```

HOTFIX 预留：

```bash
node "<SessionStart/PreToolUse 输出的 reserve-artifact-id.js 绝对路径>" --operation create-chg --type hotfix
# 若没有 hook 输出但本 skill 已加载：
node "<skill-root>/../../hooks/reserve-artifact-id.js" --operation create-chg --type hotfix
```

若同一 session 已有未消费的普通 CHG reservation，但现在要创建 HOTFIX，或确实要新编号：

```bash
node "<SessionStart/PreToolUse 输出的 reserve-artifact-id.js 绝对路径>" --operation create-chg --type hotfix --new
# 若没有 hook 输出但本 skill 已加载：
node "<skill-root>/../../hooks/reserve-artifact-id.js" --operation create-chg --type hotfix --new
```

Correction 预留：

```bash
node "<SessionStart/PreToolUse 输出的 reserve-artifact-id.js 绝对路径>" --operation record-correction
# 若没有 hook 输出但本 skill 已加载：
node "<skill-root>/../../hooks/reserve-artifact-id.js" --operation record-correction
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
review-confirmed: true
review-source: manual | <所选 review agent 名>
review-findings: <P0/P1/P2/P3 计数 + 各自处置 wikilink>
verify-summary: <已运行并阅读的验证结果>
walkthrough-summary: <完成摘要>
```

连续执行的 CHG 由收尾的 `close-chg` 统一收口多个 T-NNN。`close-chg` 折叠 VERIFIED + REVIEWED + 归档；R 审计本身是主 session 在派 close-chg 前编排的步骤（见 Skill(paceflow:pace-workflow) R 小节）。只要主 session 已运行并读取验证结果，`close-chg complete-open-tasks:true` 就是默认收口方式。

---

## 关联 Skill

- `paceflow:pace-workflow`：P-A-C-E-V 流程控制。
- `paceflow:pace-knowledge`：finding/correction 需要沉淀到 knowledge/ 时使用。
