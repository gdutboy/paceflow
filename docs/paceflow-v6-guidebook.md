# PACEflow v6 Guidebook

> 生成日期：2026-05-04
> 范围：本地仓库、GitHub 远端 `origin/master`、PACEflow vault 流程图与项目 artifact
> 结论：v6.0.0 按 breaking change 推进，不继续兼容 v5 运行格式

> 执行状态更新（2026-05-04）：本文件最初是升级审计 guidebook，部分“当前缺口”章节描述的是修复前状态。后续已完成 P0.1 agent spec 自洽修复、P0.5 hook v6 改造、plugin marketplace 安装路径澄清、skills/CLAUDE/README/REFERENCE v6-only 口径收敛。`install.js` / `verify.js` 只作为本地验证工具，不是正式安装路径。剩余发布前重点是 marketplace 实装验证、vault 迁移重跑、完整 agent fixture 报告与流程图/长文档清理。

---

## 0. 阅读结论

PACEflow v6 的核心改变不是“换一种 artifact 格式”，而是把 artifact CRUD 从主 session 移到 `paceflow-artifact-writer` agent，并把主索引文件变成轻量 wikilink 索引。主 session 保留业务判断、用户交互、代码实现和 hook 修复；artifact 的创建、更新、归档、finding/correction 记录必须派 agent。

当前状态分三层：

| 层 | 当前状态 | v6 判断 |
|---|---|---|
| Agent | `agents/paceflow-artifact-writer.md` v4.0 已是 v6-only；现有测试报告记录 24/24 功能操作正确，当前 fixture 已扩到 Phase A 7 / Phase B 9 / Phase D 4 | 可作为 v6 artifact 操作权威执行器，但扩展 fixture 仍需跑完并记录报告 |
| Hook | `hooks/*.js` 仍按 v5 主文件内嵌详情、`task.md` 内 APPROVED/VERIFIED、5 artifact 文件运行 | v6 发布前最大缺口 |
| Skill/Docs/CLAUDE | 大量内容仍引导 v5 双区 + `### CHG-ID` 详情段落 | 必须重写为“主 session 派 agent”规则 |

GitHub 远端只有 `master`，没有 `main` 分支。`origin/master` 当前仍是 v5.1.4 代码树，缺少本地已提交的 `agents/`、`docs/v6*`、`tests/agent-tests/`、`migrate/` 等 v6 工作。当前本地分支与 `origin/master` 已分叉：超前 18 个提交、落后 1 个提交。工作区还有一批未提交修改，其中多数 hook/skill/doc 文件存在整文件 diff，需要提交时精确 add，禁止 `git add .`。

---

## 1. 权威信息源

本 guidebook 以这些材料为准：

| 类别 | 路径 | 结论 |
|---|---|---|
| 远端基线 | `origin/master` | v5.1.4，仅含 hooks/skills/templates/docs，未含 v6 agent 与测试 |
| 本地 v6 ticket | `ticket.md` | 当前瓶颈是 hooks v6 适配、B 方案迁移、版本 bump |
| Agent prompt | `agents/paceflow-artifact-writer.md` | v6-only 执行契约，禁止 v5 fallback |
| Agent spec | `agents/references/artifact-writer-spec.md` | schema、wikilink、索引模板、验证规则 |
| 指令规范 | `agents/references/instructions/*.md` | 5 类 operation 的实际步骤 |
| v6 设计 | `docs/v6.0.0-design.md` | 架构设计仍含双轨兼容旧段落，需要按 v6-only 修订 |
| B 方案 | `docs/v5-archival-strategy.md` + `migrate/batch-archive-v5.js` | 伪迁移，把 v5 活跃内容推到 ARCHIVE 下方 |
| 测试 | `tests/agent-tests/` | Phase A/B/D fixture、yaml、verify 机械层 |
| 旧流程图 | `paceflow-flow-ascii.md` / `paceflow-complete-flow.md` | v5 hook 决策链参考，需重画 v6 版本 |
| CLAUDE | `CLAUDE.md` | 项目根目录规则文件，仍按 v5 artifact 权威、5 文件双区和 `findings.md` correction 运行 |

---

## 2. v6 架构总览

### 2.1 文件结构

v6 artifact 目录位于：

```
$PACE_VAULT_PATH/projects/<project-name>/
```

fallback 是项目 cwd。v6 项目的判定信号是 artifact 目录下存在 `changes/` 目录。

标准结构：

```text
projects/<project>/
├── spec.md
├── task.md
├── implementation_plan.md
├── walkthrough.md
├── findings.md
├── corrections.md
└── changes/
    ├── chg-yyyymmdd-nn.md
    ├── hotfix-yyyymmdd-nn.md
    ├── findings/
    │   └── finding-yyyy-mm-dd-slug.md
    └── corrections/
        └── correction-yyyy-mm-dd-nn-slug.md
```

### 2.2 核心原则

1. 主索引文件只放索引行，不放 CHG/finding/correction 详情。
2. CHG/HOTFIX 的任务清单、APPROVED、实施详情、工作记录、关联调研都在 `changes/<id>.md`。
3. finding 详情在 `changes/findings/<id>.md`，`findings.md` 只保留摘要索引。
4. correction 详情在 `changes/corrections/<id>.md`，`corrections.md` 只保留索引。
5. 状态权威来自详情文件 frontmatter；索引 checkbox 是展示与 hook 快速判断。
6. 归档 CHG 时移动索引行到 `<!-- ARCHIVE -->` 下方，详情文件不移动，只更新 frontmatter status。
7. v5 的 `### CHG-ID` 内嵌任务、`## 活跃变更详情`、findings 内嵌详情、findings 内 Corrections 区都视为历史格式。

### 2.3 v6-only 决策

不再保留 `detectProjectVersion(cwd) -> v5/v6` 的运行分支。v6 发布版应采用：

```text
changes/ 存在      -> v6 项目，按 v6 规则运行
changes/ 不存在    -> 非 v6 PACE 项目，提示执行 B 方案初始化或创建 v6 模板
v5 artifact 存在   -> 历史数据，仅在 ARCHIVE 下方保留，不参与活跃流程
```

`docs/v6.0.0-design.md` 中 “双轨兼容机制”“旧函数保留向后兼容”“v5 路径保持现有逻辑不变” 应删除或改成 “v5 历史归档读取说明”。

---

## 3. Agent 执行契约

### 3.1 什么时候必须派 agent

以下任何 artifact 操作都必须派 `paceflow-artifact-writer`：

| 操作 | Agent operation |
|---|---|
| 创建 CHG/HOTFIX/research 变更 | `create-chg` |
| 更新 CHG 任务、实施、工作记录、调研段 | `update-chg` |
| C 阶段批准，插入 `<!-- APPROVED -->` | `update-chg action=approve` |
| 更新任务状态 `[ ]` / `[/]` / `[x]` / `[-]` | `update-chg action=update-status` |
| 归档 CHG | `archive-chg` |
| 记录调研发现 | `record-finding` |
| 记录用户纠正 | `record-correction` |

主 session 不直接 Edit 这些文件：

```text
task.md
implementation_plan.md
walkthrough.md
findings.md
corrections.md
changes/**/*.md
```

例外只限：

1. 修改 agent 自身 prompt/spec/instructions。
2. 修 hook/skill/doc/template 源码。
3. 迁移脚本执行后的机械验证与回滚。

### 3.2 主 session 调用模板

主 session 给 agent 的 prompt 使用结构化字段，不写散文：

```yaml
operation: create-chg
artifact_dir: /absolute/path/to/vault/projects/<project>
fields:
  title: "..."
  tasks:
    - "T-001: ..."
  type: change
  background: "..."
  scope: "..."
  technical-decision: "..."
```

必须给出 `artifact_dir` 或足够让 agent 判断 `$ARTIFACT_DIR` 的 cwd / vault 上下文。并发派 agent 时，确保不同 agent 不操作同一个 CHG/finding/correction 详情文件。

### 3.3 Agent 的硬性输出

agent 每次报告第一个 H2 必须字面等于：

```markdown
## paceflow-artifact-writer 报告
```

失败报告的失败原因只能取封闭枚举：

```text
missing-fields
hook-deny
format-violation
file-conflict
target-not-found
out-of-scope
id-mismatch
not-pace-project
```

注意：`update-chg.md` 仍写着 `already-approved`，但它不在封闭失败枚举内。建议把它定义为成功幂等状态，而不是失败码；报告中写 “状态：SUCCESS（already approved，无变更）”。

### 3.4 Agent 项目检测

agent 启动后第一步检查：

```bash
ls "$ARTIFACT_DIR/changes" 2>/dev/null
```

无 `changes/`：报告 `not-pace-project`，不创建 v5 内容，不 fallback。

### 3.5 Agent 工具与禁止项

允许工具：

```text
Read, Write, Edit, Bash, Glob, Grep
```

禁止：

```text
WebFetch, WebSearch, Task, MCP, 修改 hooks/skills/.js/.json/spec.md/knowledge/thoughts
```

任何 Edit 前必须 Read 目标文件。Bash/grep/head 不等价于 Read。

### 3.6 大文件 Read 策略

当主索引或历史文件过大：

1. Bash 定位 `<!-- ARCHIVE -->` 与标题行。
2. 只 Read ARCHIVE 上方活跃区。
3. 如需历史，只 Read 目标段前后 5-10 行。
4. 不读取完整 v5 历史归档区来“顺手整理”。

### 3.7 验证项

agent 完成后必须自检：

| 验证项 | 要求 |
|---|---|
| frontmatter schema | 字段顺序、必填字段、枚举值、长度限制通过 |
| wikilink 完整性 | 索引行的 `[[id]]` 能解析到详情文件 |
| 跨索引一致性 | CHG 在 `task.md` 与 `implementation_plan.md` 中一致 |
| ARCHIVE | 索引文件仅 1 个 `<!-- ARCHIVE -->` 且独占行 |
| 文件名一致 | `chg-id` / `finding-id` / `correction-id` 与文件名映射一致 |

机械层用 `tests/agent-tests/helpers/verify-output.js` 校验，默认检查报告标题。

---

## 4. v6 数据规范

### 4.1 CHG/HOTFIX frontmatter

```yaml
chg-id: CHG-YYYYMMDD-NN
status: planned
date: YYYY-MM-DD
type: change
parent-tasks: ["[[task]]"]
parent-impl: ["[[implementation_plan]]"]
related-finding: null
aliases: []
tags: []
schema-version: "6.0"
completed-date: null
archived-date: null
```

状态：

| status | 索引 checkbox | 位置 |
|---|---|---|
| `planned` | `[ ]` | 活跃区 |
| `in-progress` | `[/]` | 活跃区 |
| `completed` | `[x]` | 活跃区，待归档 |
| `archived` | `[x]` | ARCHIVE 下方 |
| `cancelled` | `[-]` | ARCHIVE 下方 |

### 4.2 CHG 详情结构

```markdown
---
frontmatter
---

# <title>

## 任务清单

- [ ] T-NNN <task description>

<!-- APPROVED -->

## 实施详情

**背景（Why）**：...

**范围（What）**：...

**技术决策（How）**：...

**T-NNN <task title>**：
- 具体改动说明

## 工作记录

| 日期 | 完成内容 |
| --- | --- |

## 关联调研
```

`<!-- APPROVED -->` 不在 `task.md`。它属于 CHG 详情文件。create 时不写，C 阶段由 `update-chg action=approve` 插入。

`<!-- VERIFIED -->` 建议同样迁到 CHG 详情文件，放在 `<!-- APPROVED -->` 后或 `## 工作记录` 前，作为该 CHG 的 V 阶段验证完成标记。当前 agent spec 尚未完全定义 VERIFIED 的 v6 位置，这是 hook/agent spec 必须补齐的 P0 缺口。

### 4.3 主索引模板

`task.md`：

```markdown
# 项目任务追踪

## 活跃任务

- [/] [[chg-yyyymmdd-nn]] 标题 #change [tasks:: T-001~T-003]

<!-- ARCHIVE -->
```

`implementation_plan.md`：

```markdown
# 实施计划

## 变更索引

<!-- 格式：- [状态] [[wikilink]] 标题 #change [tasks::] -->

- [/] [[chg-yyyymmdd-nn]] 标题 #change [tasks:: T-001~T-003]

<!-- ARCHIVE -->
```

`walkthrough.md`：

```markdown
# 工作记录

## 最近工作

| 日期 | 完成内容 | 关联变更 |
| --- | --- | --- |
| YYYY-MM-DD | [[chg-yyyymmdd-nn]] 摘要 | CHG-YYYYMMDD-NN |

<!-- ARCHIVE -->
```

`findings.md`：

```markdown
# 调研记录

## 摘要索引

- [ ] [[finding-yyyy-mm-dd-slug|标题]] — summary #finding [date:: YYYY-MM-DD] [impact:: P1]

<!-- ARCHIVE -->
```

`corrections.md`：

```markdown
# Corrections 记录

> AI 行为纠正历史。每条 correction 必双写到 knowledge/ 或标 project-only。

## 索引

- [[correction-yyyy-mm-dd-nn-slug]] 标题 [date:: YYYY-MM-DD] [knowledge:: project-only]

<!-- ARCHIVE -->
```

---

## 5. v6 PACE 工作流

### 5.1 P 阶段：Plan

仍可用 Superpowers brainstorming / writing-plans 或原生规划。P 阶段产物可以是 `docs/plans/*.md`、`docs/superpowers/plans/*.md` 或用户已经明确给出的需求。

### 5.2 A 阶段：Artifact

主 session 派 agent：

```yaml
operation: create-chg
fields:
  title: "..."
  tasks:
    - "T-001: ..."
```

agent 创建 `changes/chg-*.md` 和 `task.md` / `implementation_plan.md` 索引。主 session 不直接写 `task.md` 和 `implementation_plan.md`。

### 5.3 C 阶段：Check

用户批准后主 session 派 agent：

```yaml
operation: update-chg
fields:
  target: "CHG-YYYYMMDD-NN"
  action: approve
```

agent 在详情文件任务清单后插入 `<!-- APPROVED -->`。随后首次执行任务时，主 session 派 agent 用 `update-status` 把相关任务标 `[/]`，并联动 frontmatter `status: in-progress`、主索引 `[ ] -> [/]`。

### 5.4 E 阶段：Execute

写代码前 hook 应检查：

1. 当前有活跃 CHG 索引 `[ ]` / `[/]` / `[!]`。
2. 对应 `changes/<id>.md` 存在。
3. 详情文件含 `<!-- APPROVED -->` 或有任务 `[/]` / `[!]`。
4. `task.md` 与 `implementation_plan.md` 都有同一个 CHG wikilink。

每个任务状态变更都派 agent `update-chg action=update-status`。

### 5.5 V 阶段：Verify

验证通过后，主 session 派 agent 记录验证结果到 `changes/<id>.md` 的 `## 工作记录`，并写入 v6 定义的 `<!-- VERIFIED -->` 标记。若仍采用 v5 的 `task.md` VERIFIED，hook 会误判或把多个 CHG 混成一个验证状态。

### 5.6 Archive

主 session 派 agent：

```yaml
operation: archive-chg
fields:
  target: "CHG-YYYYMMDD-NN"
  walkthrough-summary: "..."
```

agent：

1. 验证所有任务都是 `[x]` 或 `[-]`。
2. frontmatter `status -> archived`，填 `completed-date` / `archived-date`。
3. 从 `task.md` 和 `implementation_plan.md` 活跃区删除索引行。
4. 在各自 `<!-- ARCHIVE -->` 下方插入 `[x]` 索引行。
5. `walkthrough.md` 最近工作表追加完成记录。

---

## 6. Hook v6 改造清单

### 6.1 `hooks/pace-utils.js`

当前问题：

- `PACE_VERSION` 仍是 `v5.1.4`。
- `ARTIFACT_FILES` 缺 `corrections.md`。
- `FORMAT_SNIPPETS` 全是 v5 内嵌详情与 task.md APPROVED/VERIFIED。
- `findMissingImplDetails()` 查 `implementation_plan.md` 内 `### CHG-ID`。
- `findMissingFindingsDetails()` 查 `findings.md` 内 `### [日期]`。
- 无 wikilink / frontmatter / detail 文件工具。

v6 必做：

1. `PACE_VERSION = 'v6.0.0'`。
2. `ARTIFACT_FILES = ['spec.md','task.md','implementation_plan.md','walkthrough.md','findings.md','corrections.md']`。
3. 新增 `isV6Project(cwd)`，仅检查 `changes/`。
4. 新增 `parseWikilinks()` / `resolveWikilinkPath()` / `checkAllWikilinks()`。
5. 新增 `parseFrontmatter()` / `readDetailFile()` / `validateChgFrontmatter()` / `validateFindingFrontmatter()` / `validateCorrectionFrontmatter()`。
6. 新增 `listChgFiles()` / `listFindingFiles()` / `listCorrectionFiles()`。
7. 替换 `FORMAT_SNIPPETS` 为 v6 wikilink 索引、详情文件路径、agent 派遣提示。
8. 删除 v5 详情缺失检查函数，或改名为 `findBrokenChgWikilinks()` / `findBrokenFindingWikilinks()`。

### 6.2 `hooks/pre-tool-use.js`

当前问题：

- Write 覆盖保护仍禁止已有 `task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` Write。
- 新建 artifact 时注入 v5 模板。
- impl_plan 详情守门要求索引对应 `### CHG-ID` 段。
- C 阶段从 `task.md` 查 `<!-- APPROVED -->`。
- E 阶段只查 `implementation_plan.md` 是否有 `- [/]`。
- native/Superpowers 桥接提示要求主 session 直接 Edit `task.md` + `implementation_plan.md`。

v6 必做：

1. 对 artifact 操作给出 “请派 `paceflow-artifact-writer`” 的 deny/hint，而不是要求主 session 手写格式。
2. 代码文件执行前，解析 `task.md` 和 `implementation_plan.md` 中活跃 wikilink，确认至少一个当前 CHG 有详情文件。
3. C 阶段批准检查改为读取 `changes/<id>.md` 是否含 `<!-- APPROVED -->`。
4. E 阶段检查改为：索引 `[/]` 与详情 frontmatter `status: in-progress` 一致。
5. 删除 impl_plan `### CHG-ID` 检查。
6. 不再用 v5 `FORMAT_SNIPPETS.taskGroup` / `implDetail`。
7. Superpowers/native plan 场景提示：先派 agent create-chg，不直接 Edit artifact。

### 6.3 `hooks/post-tool-use.js`

当前问题：

- 只把 5 个主文件视为 artifact。
- ARCHIVE 格式检查不覆盖 `corrections.md`。
- APPROVED/VERIFIED 自签只检查 `task.md`。
- CHG 完成后 findings 关联检查仍扫 `findings.md` v5 `[change:: CHG-ID]`。
- impl_plan 详情归档/完整性仍基于 `### CHG-ID`。
- findings 详情完整性/归档仍基于 `findings.md` 内详情段。
- correction 双写仍检测 `findings.md` 的 `### Correction:`。
- TodoWrite 提醒是 v5 顶层任务模式。

v6 必做：

1. Edit 索引文件后检查 wikilink 目标存在。
2. Write/Edit `changes/**/*.md` 后校验 frontmatter schema。
3. CHG status / checkbox 联动不一致时提醒派 agent 修复。
4. correction 双写改为监听 `corrections.md` 与 `changes/corrections/*.md`。
5. findings 过期/流转改为读取 finding 详情 frontmatter。
6. 移除 impl_plan/finding 内嵌详情提醒。
7. 对主 session 直接 Edit artifact 的行为提示改派 agent。

### 6.4 `hooks/stop.js`

当前问题：

- V 阶段验证从 `task.md` 查 `<!-- VERIFIED -->`。
- C 阶段未批准从 `task.md` 查 `<!-- APPROVED -->`。
- impl_plan 详情终态查 `### CHG-ID`。
- findings 详情终态查 `### [日期]`。
- walkthrough 今日详情仍要求主文件内详情段。
- 任务 pending/done 统计只看 task.md 索引，不看详情文件任务清单。

v6 必做：

1. 以活跃 CHG wikilink 列表为入口，读取每个详情文件。
2. 未完成任务统计来自 `changes/<id>.md ## 任务清单`。
3. APPROVED/VERIFIED 检查来自详情文件。
4. `task.md` / `implementation_plan.md` 活跃 CHG 集合必须一致。
5. 索引 `[x]` 但详情 status 非 `completed/archived` 时 block。
6. 详情 status `completed` 但索引未归档时 block。
7. findings 14 天逻辑基于 finding frontmatter `date/status`。
8. walkthrough 检查改为最近工作表行，不要求主文件详情段。

### 6.5 `hooks/session-start.js`

当前问题：

- 遍历 5 个 artifact，不注入 `corrections.md`。
- 注入逻辑仍截断 v5 内嵌详情。
- compact 恢复格式参考仍是 v5。
- Superpowers 桥接提示仍要求直接 Edit task/impl_plan。
- 格式合规检查仍查 impl_plan 表格/emoji/双 ARCHIVE 等 v5 迁移问题。

v6 必做：

1. 注入 6 个索引文件活跃区。
2. 对活跃 CHG/finding/correction wikilink 加 L0 摘要：id、status、summary/title、pending 任务数。
3. compact 恢复注入 v6 agent 派遣提示。
4. 模板懒创建必须创建 `changes/`、`changes/findings/`、`changes/corrections/`、`corrections.md`。
5. B 方案执行后，对 v5 历史只提示 “ARCHIVE 下方历史，按需 Read”，不再尝试截断 v5 详情。

### 6.6 `hooks/todowrite-sync.js`

当前问题：

- `task.md` 被视为任务权威来源。
- 顶层 checkbox 数量与 TodoWrite 对齐。

v6 必做：

1. `task.md` 是 CHG 索引，不是子任务权威。
2. 子任务权威改为活跃 `changes/<id>.md ## 任务清单`。
3. TodoWrite 应映射到 `T-NNN` 子任务，附带 CHG ID。
4. `task.md` 无顶层任务不能说明无任务，需要检查详情文件。
5. Superpowers 桥接 deny 改为 “派 agent create-chg”。

### 6.7 `hooks/pre-compact.js`

当前问题：

- snapshot 只记录 task.md 统计与 impl_plan 是否有 `[/]`。
- findings/walkthrough snapshot 仍基于主文件。

v6 必做：

1. snapshot 记录活跃 CHG 列表、详情 status、未完成 T 编号、APPROVED/VERIFIED 状态。
2. snapshot 记录 open/investigating/blocked finding 统计。
3. snapshot 记录 broken wikilink / schema violation 摘要。

### 6.8 `hooks/config-guard.js`

基本可保留。需要补充检测 agent/hook 配置删除：

- `paceflow-artifact-writer.md`
- `agents/references/**`
- `StopFailure` 在 `hooks/hooks.json` 中必须保留。

### 6.9 `hooks/hooks.json` / `config/settings-hooks-excerpt.json`

v6 正式安装路径是 Claude Code Plugin marketplace：

```text
/plugin marketplace add paceaitian/paceflow
/plugin install paceflow@paceaitian-paceflow
```

`hooks/hooks.json` 是 hook 注册权威，当前已有 `StopFailure`。`config/settings-hooks-excerpt.json`、`install.js`、`verify.js` 只作为本地验证/手动调试工具，不作为 v6 发布安装链路的权威，不应进入发布面设计。

Hook 注册机制可保持不变；发布前重点确认 plugin 安装后 `hooks/`、`skills/`、`agents/` 都随 marketplace 包可用。

---

## 7. Skill v6 改造清单

### 7.1 `skills/artifact-management`

当前仍是 v5 主规则。必须全面重写为 v6 权威 skill：

- description 增加 `corrections.md`、`changes/`、wikilink、frontmatter。
- 删除 “5 个核心 Artifact” 改为 “6 个索引文件 + changes 详情”。
- 删除 “主文件已存在禁止 Write 覆盖” 的泛化规则，改为 “主 session 不直接写 artifact，派 agent”。
- 删除 “双区结构 = 所有详情在主文件活跃区” 叙述。
- 删除 “归档 = 移动 ARCHIVE 标记上移” 作为 CHG 归档主算法；v6 归档是移动索引行到 ARCHIVE 下方。
- 删除 `## 活跃变更详情`、`### CHG-ID`、findings 内 `### [日期]` 详情规则。
- APPROVED/VERIFIED 位置改到 `changes/<id>.md`。
- 编号规范改为从 `changes/` 文件名扫描生成 ID，而不是从 `implementation_plan.md` 扫描。
- 内容深度要求移到详情文件各 section。
- references 下新增或重写：`format-reference-v6.md`、`change-lifecycle-v6.md`、`wikilink-syntax.md`、`frontmatter-schema.md`、`agent-operation-reference.md`。

### 7.2 `skills/pace-workflow`

当前 A/C/E/V 阶段都要求主 session 直接改 task/impl_plan。

v6 必做：

- A 阶段：调用 `paceflow-artifact-writer create-chg`。
- C 阶段：用户批准后调用 `update-chg action=approve`。
- E 阶段：进度维护调用 `update-chg action=update-status`，工作记录调用 `update-chg section=work-record action=append`。
- V 阶段：验证结果写入详情文件，由 agent 记录；VERIFIED 位置改为 v6 详情文件。
- G-9 完成检查改成 “agent archive-chg 后 hook 验证”。

### 7.3 `skills/pace-bridge`

当前桥接步骤写入 `implementation_plan.md` 详情区和 `task.md` CHG 分组。

v6 必做：

- 从 plan 提取字段后派 agent `create-chg`，不要直接 Edit。
- auto-APPROVED 改为派 agent `update-chg action=approve`，随后 `update-status` 把首个任务改 `[/]`。
- `.pace/synced-plans` 仍保留。
- 输出摘要改为包含 `changes/<id>.md` 路径。

### 7.4 `skills/pace-knowledge`

当前 corrections 双写仍写 `findings.md ## Corrections 记录`。

v6 必做：

- correction 主记录改为 `record-correction`，写 `corrections.md` + `changes/corrections/*.md`。
- finding 提取 knowledge 后，回写 finding 详情 frontmatter 或索引 extra-meta，而不是 v5 findings 详情段。
- SessionStart L0 注入规则保留。

### 7.5 `skills/paceflow-audit`

当前审计范围没有 `agents/`、`changes/`、v6 tests；prompt 仍要求读 `CLAUDE.md` v5 章节。

v6 必做：

- 审查范围加入 `agents/*.md`、`agents/references/**/*.md`、`tests/agent-tests/**/*.js|yaml|md`、`migrate/*.js`。
- Skill 模板审查关注 v6 索引模板、frontmatter schema、wikilink 解析。
- 架构审查明确检查 “是否仍有 v5 双区 fallback”。
- Phase 2 验证加入 agent spec 机械检查与 hook v6 fixture。

---

## 8. CLAUDE.md / README / REFERENCE 缺口

### 8.1 `CLAUDE.md`

当前问题：

- G-3 写明 SessionStart 注入 5 个 Artifact 文件，缺 `corrections.md` 与 `changes/`。
- G-3 仍声明 `task.md` 是任务权威来源；v6 权威应是 `changes/<id>.md` 详情文件，`task.md` 只是索引。
- G-3 要求 correction 写入 `findings.md ## Corrections 记录`；v6 应派 agent 执行 `record-correction`，写 `corrections.md` + `changes/corrections/*.md`。
- G-7 仍写 5 个 Artifact 文件遵循双区结构，并禁止 Write 覆盖其中 3 个文件；v6 主文件是索引，详情在 `changes/`。
- G-8 仍要求 C/V 标记 `<!-- APPROVED -->`、`<!-- VERIFIED -->` 添加到 `task.md` 活跃区；v6 应添加到详情文件 frontmatter/字段或按 agent spec 定义的权威位置。
- G-9 仍要求完成时归档 `task.md`、`implementation_plan.md` 详情段，并向 `walkthrough.md` 追加详情段；v6 应归档/更新详情文件并同步索引。
- G-4 允许主 session 用 Edit 修改文件，但没有把 artifact CRUD 从主 session 移交给 `paceflow-artifact-writer` agent。
- G-4 “Subagent 分流” 是通用研究分流规则，不能替代 v6 artifact writer 的强制派发规则。

v6 必做：

1. 改成 v6.0.0 breaking change 项目说明。
2. 改写上下文恢复：SessionStart 注入 6 个索引 + active `changes/*.md` 摘要，旧 5 文件规则删除。
3. 改写任务权威：`changes/<CHG|HOTFIX>.md` 是单个变更权威，`task.md`/`implementation_plan.md`/`walkthrough.md` 是索引。
4. 改写 corrections：用户纠正必须派 `paceflow-artifact-writer` 执行 `record-correction`。
5. 写入 agent 读写边界：artifact 变更必须派 agent；主 session 直接 Edit artifact 视为流程违规。
6. 明确 hooks 是机械保障，agent 是 artifact CRUD 执行层，skills 是规范说明层。
7. 增加 v6 验证命令：`node tests/agent-tests/run-tests.js dummy`、agent yaml prepare/verify、hook/unit/e2e。

### 8.2 `README.md`

当前仍写：

- 5 个 artifact。
- task/impl_plan 内嵌状态。
- C/V 标记在 `task.md`。
- 8/9 hook 数量描述不一致。
- 项目结构无 `agents/`、`migrate/`、`tests/agent-tests/`。
- 版本 v5.1.4。

v6 必做：

- 首页说明 “6 个索引文件 + changes 详情 + agent writer”。
- 安装后注册 hook/skills/agent。
- 工作原理加 agent 层。
- C/V 阶段说明改到详情文件。
- 版本历史新增 v6.0.0。

### 8.3 `REFERENCE.md`

当前是完整 v5 手册。v6 发布时不应局部修补，应重写为 v6 reference：

- Hook I/O 协议可保留。
- PACE 工作流重写为 agent 驱动。
- Hook 系统逐个改为 v6 行为。
- Skill 系统改为 5 skills + 1 agent。
- 状态系统改为 frontmatter status + checkbox 映射。
- Artifact 文件结构改为索引-详情。
- 特殊标记 APPROVED/VERIFIED 位置改到详情文件。
- 工具脚本加入 `migrate/batch-archive-v5.js` 和 agent-tests。
- Agent Teams 兼容策略需重新评估：teammate 降级在 v6 是否仍允许跳过 agent。

### 8.4 `docs/v6.0.0-design.md`

必须删除或修订：

- “双轨过渡” 原则。
- 第 11 节 “双轨兼容机制”。
- Phase 3 checklist 中 “v5 路径保持现有逻辑不变”。
- 风险表中 “双轨期混乱”。
- `migrate-v6.js` 完整迁移路线可降级为未来可选，v6.0.0 主线采用 B 方案。

### 8.5 Agent spec / tests 缺口

当前 agent prompt 已是 v6-only，但权威 spec 与测试 fixture 仍有几处需要收敛：

- `agents/references/artifact-writer-spec.md` §5.6.4 的 `findings.md` 整文件模板仍包含 `## 未解决问题`。这与 v6 “finding 详情只在 `changes/findings/`” 冲突，应删除该段或改成仅说明历史归档区可能存在。
- `tests/agent-tests/fixtures/*/findings.md` 也保留 `## 未解决问题`，会把旧结构固化进测试基线。v6-only 发布前 fixture 应同步改为纯摘要索引 + ARCHIVE。
- `migrate/batch-archive-v5.js` 的 `V6_TEMPLATES.findings.md` 同样保留 `## 未解决问题`，且当前脚本只创建 `corrections.md`，不创建 `changes/` / `changes/findings/` / `changes/corrections/`。如果按 guidebook 的 v6 判定规则运行，迁移后的纯 v5 项目仍会被 agent 报 `not-pace-project`。
- `agents/references/instructions/update-chg.md` 把已批准写成 `already-approved`。当前 agent prompt 的失败原因枚举不包含它，guidebook 建议把它作为成功幂等状态；spec/instruction 需要同步。
- `tests/agent-tests/cases/phase-b/tc-b8-unknown-operation.yaml` 描述仍提 `unknown-operation`。agent prompt 已废除该失败码：非法 operation 应是 `out-of-scope`，非法 `update-chg action` 应是 `format-violation`。
- `<!-- VERIFIED -->` 的 v6 权威位置仍未进入 agent spec。当前 guidebook 按 “详情文件内” 推进，但发布前必须把位置、插入时机、hook 检查规则写入 spec 与 tests。
- `docs/agent-testing-report-2026-05-03.md` 的已执行报告覆盖 A1-A5 / B1-B5 / D1-D3,D5；当前 yaml 已扩展到 A1-A7 / B1-B9 / D1-D3,D5，扩展用例还需要重新跑并生成新报告。

### 8.6 流程图文档

`paceflow-flow-ascii.md` 和 `paceflow-complete-flow.md` 是 v5.1.1 hook 流程图。需要新增 v6 图：

- 主 session -> agent -> hook -> artifact。
- PreToolUse v6 读 wikilink + detail frontmatter。
- Stop v6 从详情任务清单统计 pending。
- PostToolUse v6 做 schema/wikilink 校验。

### 8.7 plugin 发布缺口

v6 引入 agent 后，正式发布链路必须以 Claude Code Plugin marketplace 为准：

- `/plugin marketplace add paceaitian/paceflow` + `/plugin install paceflow@paceaitian-paceflow` 是用户安装入口。
- `install.js` / `verify.js` 仅用于本地 smoke/健康检查，不能作为 README 的正式安装说明，也不能作为 plugin 发布是否成功的权威。
- plugin 发布包必须包含 `agents/paceflow-artifact-writer.md` 与 `agents/references/**`，否则插件安装后没有 artifact writer。
- `.claude-plugin/plugin.json` 与 `.claude-plugin/marketplace.json` 仍是 `5.1.4`，发布前需 bump 到 `6.0.0` 并确认 Claude Code Plugin 自动加载 `agents/` 目录。
- `bump-version.js` 已覆盖 `pace-utils.js`、plugin、marketplace、README/REFERENCE，但 v6 changelog 与 agent prompt 版本说明也应纳入发布清单。

---

## 9. 模板缺口

当前 `hooks/templates/` 仍是 v5 模板。

v6 必做：

| 文件 | 当前问题 | v6 要求 |
|---|---|---|
| `task.md` | CHG 分组、APPROVED/VERIFIED、T-NNN 子任务 | 只保留 wikilink 索引 |
| `implementation_plan.md` | `## 活跃变更详情` 和 `### CHG-ID` | 删除详情区，只保留变更索引 |
| `walkthrough.md` | 要求详情段落 | 只保留最近工作表 |
| `findings.md` | `## 未解决问题` 与 `## Corrections 记录` | 只保留 finding 摘要索引；corrections 独立 |
| `corrections.md` | 缺失 | 新增 |
| `chg-template.md` | 缺失 | 新增详情模板 |
| `finding-template.md` | 缺失 | 新增详情模板 |
| `correction-template.md` | 缺失 | 新增详情模板 |

`migrate/batch-archive-v5.js` 已内置简化索引模板，但当前 `findings.md` 模板仍残留 `## 未解决问题`，且 hook 模板目录还未同步。v6-only 发布前必须统一为同一套模板。

---

## 10. 迁移与发布路线

### 10.1 B 方案标准

对每个项目执行：

```bash
node migrate/batch-archive-v5.js <vault/projects/project> --dry-run
node migrate/batch-archive-v5.js <vault/projects/project>
```

验证：

```bash
for f in task.md implementation_plan.md walkthrough.md findings.md; do
  grep -c "^<!-- ARCHIVE -->$" "$f"
  awk '/^<!-- ARCHIVE -->$/{exit} {print}' "$f" | wc -l
  wc -l "$f" "$f.v5-backup"
done
```

期望：

- 每个主文件只有 1 个 ARCHIVE。
- 活跃区为空或仅模板，通常 <= 10 行。
- v5 原内容在 ARCHIVE 下方。
- `corrections.md` 存在。
- `changes/`、`changes/findings/`、`changes/corrections/` 存在；已有 PoC 详情保留。
- `findings.md` 活跃区不含 `## 未解决问题`，旧 `## 未解决问题` 只允许出现在 ARCHIVE 下方的 v5 历史中。

当前 `migrate/batch-archive-v5.js` 尚未满足上述标准：它不创建 `changes/` 子目录，且新 `findings.md` 模板仍包含 `## 未解决问题`。该脚本必须先修再用于 dogfood。

### 10.2 发布前 P0 顺序

1. 修 `pace-utils.js` v6 基础函数和模板常量。
2. 修 `hooks/templates/` v6 模板。
3. 修 `pre-tool-use.js` / `stop.js` / `post-tool-use.js` 三个核心 hook。
4. 修 `session-start.js` / `todowrite-sync.js` / `pre-compact.js`。
5. 修 plugin 元数据并确认 marketplace 安装包含 `agents/`；`install.js` / `verify.js` 仅作本地验证。
6. 修 skills。
7. 更新 CLAUDE/README/REFERENCE。
8. 跑 B 方案迁移 PACEflow vault。
9. 跑 agent tests 和 hook tests。
10. bump version + changelog。

### 10.3 最低验收

Agent：

- Phase A 当前 7 个 yaml 用例需 PASS。
- Phase B 当前 9 个 yaml 用例需 PASS。
- Phase D 当前 4 个 yaml 用例需 PASS。
- report title strict 默认开启。

Hook：

- v6 empty project：SessionStart 创建 6 索引 + changes 子目录。
- create-chg 后写代码：PreToolUse 放行仅在 APPROVED + in-progress 条件满足时发生。
- 无 APPROVED：PreToolUse deny。
- 任务 `[x]` 但无 VERIFIED：Stop block。
- broken wikilink：PostToolUse warning 或 Stop block，按严重度定义。
- schema invalid：PostToolUse warning；Stop 是否 block 需明确。

Docs：

- `rg "活跃变更详情|### CHG|findings.md.*详情|Corrections 记录|5 个 Artifact|task.md.*权威|v5/v6 双轨|v5.1.4" README.md REFERENCE.md skills hooks/templates CLAUDE.md` 无未处理命中。

---

## 11. 初始缺口总表

> 下表保留初始审计视角，用于追踪 v6 升级来源。若与执行状态更新冲突，以本文件顶部“执行状态更新”和当前代码为准。

| 优先级 | 文件/模块 | 缺口 |
|---|---|---|
| P0 | `hooks/pace-utils.js` | v6 工具函数、corrections.md、schema/wikilink、版本号 |
| P0 | `hooks/pre-tool-use.js` | C/E 门控仍查 v5 主文件 |
| P0 | `hooks/stop.js` | 完成/验证/详情终态仍查 v5 主文件 |
| P0 | `hooks/post-tool-use.js` | 无 schema/wikilink 检查，仍查 v5 详情 |
| P0 | `hooks/templates/*` | v5 模板，缺 v6 详情模板与 corrections.md |
| P0 | `agents/references/artifact-writer-spec.md` | `findings.md` 模板残留 `## 未解决问题`，VERIFIED 位置未定义，`already-approved` 需与失败枚举对齐 |
| P0 | `tests/agent-tests/fixtures/*` | v6 fixture 仍固化 `findings.md ## 未解决问题`，扩展 A/B 用例未形成新测试报告 |
| P0 | `migrate/batch-archive-v5.js` | 不创建 `changes/` 子目录；新 `findings.md` 模板仍残留 `## 未解决问题` |
| P0 | plugin 发布链路 | marketplace 安装必须包含 `agents/`；`install.js` / `verify.js` 仅作本地验证，不作为正式安装路径 |
| P0 | `skills/artifact-management/*` | v5 规则权威源，必须重写 |
| P0 | `skills/pace-workflow/*` | A/C/E/V 仍要求主 session 直接 Edit artifact |
| P0 | `skills/pace-bridge/SKILL.md` | 桥接仍写 task/impl_plan 内嵌详情 |
| P0 | `CLAUDE.md` | v5 artifact 运行规则：5 文件、`task.md` 权威、correction 写 `findings.md`、主 session 直接 Edit artifact |
| P1 | `skills/pace-knowledge/SKILL.md` | corrections 仍写 findings.md |
| P1 | `skills/paceflow-audit/*` | 审计范围缺 agents/tests/迁移/v6 检查 |
| P1 | `README.md` / `REFERENCE.md` | v5 公共文档，需重写 |
| P1 | `docs/v6.0.0-design.md` | 仍有双轨兼容章节，与 v6-only 决策冲突 |
| P1 | `.claude-plugin/plugin.json` / `marketplace.json` | 版本仍是 5.1.4；需确认 `agents/` 插件加载与发布元数据 |
| P1 | `config/settings-hooks-excerpt.json` | 缺 StopFailure，和 hooks.json 不一致 |
| P2 | `docs/agent-design.md` | 早期设计仍含 v5/v6 双轨、unknown-operation 等旧描述 |
| P2 | `docs/agent-testing-strategy.md` | 测试矩阵仍含 v5/mixed-v5-v6 思路 |
| P2 | 流程图文档 | 仍是 v5.1.1 hook 决策链 |

---

## 12. 后续执行纪律

1. 不继续兼容 v5 活跃流程；v5 数据只作为 ARCHIVE 历史。
2. 主 session 不直接改 artifact；一律派 agent。
3. Hook 不给 AI v5 修复提示；hook 输出必须说清楚“派 paceflow-artifact-writer”。
4. Agent spec 比自然语言更重要；发现偏差优先修 spec/instruction，再补 prompt。
5. 机械验证必须保留：report title strict、failure reason enum、wikilink/schema/cross-index。
6. 当前工作区有历史未提交修改；提交时只 add 本次改动文件。
