# PACEflow Artifact Writer 规范参考

> **关联 agent**：`artifact-writer.md`（同级目录上层）
> **用途**：当 agent 执行任务需要详细 schema / 索引行模板时按需 Read 此文件
> **不在 system prompt 中重复**：保持 agent prompt 精简（~150 行）

---

## 1. v6.0.0 文件结构

```
projects/<project>/
├── task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md
└── changes/
    ├── chg-yyyymmdd-nn.md
    ├── hotfix-yyyymmdd-nn.md
    ├── findings/finding-yyyy-mm-dd-slug.md
    └── corrections/correction-yyyy-mm-dd-nn-slug.md
```

`changes/` 根目录是 v6 项目 marker，必须预先存在。agent **不得**创建 base `changes/` 来初始化项目；缺失时立即报告 `not-pace-project`，且不得 Write / Edit 任何 artifact。

目录存在性检查必须使用显式状态输出：

```bash
test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING
```

禁止用 `ls "$ARTIFACT_DIR/changes"` 的空输出判断目录不存在；空目录存在时 stdout 也为空。

`changes/findings/` 和 `changes/corrections/` 子目录在首次操作时**懒创建**（`mkdir -p`），但前提是 base `changes/` 已存在。

`$ARTIFACT_DIR` 必须由主 session / hook 在 prompt 中显式传入，agent 不自行推断到 cwd 或改写到其他目录。`artifact_dir` 仅用于 PaceFlow artifacts：`task.md` / `implementation_plan.md` / `walkthrough.md` / `findings.md` / `corrections.md` / `changes/**`。

注意：`.pace-enabled` 是 PaceFlow 手动激活信号，`.pace/disabled` 是显式豁免；运行态 `.pace/` 目录本身不等于启用信号，也不等于 artifact 根目录。若 cwd 已启用 PaceFlow 但 `$ARTIFACT_DIR/changes` 缺失，不能在报告中写“项目未启用 PACE”；应说明“当前 artifact_dir 无 changes marker”，并要求主 session 重派时显式提供正确的 `artifact_dir: <path>`。

---

## 2. Frontmatter Schema

字段必须**按下方顺序**写入（不要重新排序）。

### 2.1 CHG/HOTFIX

```yaml
chg-id: CHG-YYYYMMDD-NN              # CHG-* 或 HOTFIX-* 大写
status: planned                      # planned | in-progress | completed | archived | cancelled
date: YYYY-MM-DD
type: change                         # change | hotfix | research
parent-tasks: ["[[task]]"]
parent-impl: ["[[implementation_plan]]"]
related-finding: null                # "[[finding-xxx]]" 或 null
aliases: []
tags: []
schema-version: "6.0"
completed-date: null                 # status=completed 时填 ISO datetime
verified-date: null                  # V 阶段验证通过时填 ISO datetime（与 <!-- VERIFIED --> 双表示同步，详见 §7）
archived-date: null                  # status=archived 时填
```

### 2.2 finding

```yaml
finding-id: FINDING-YYYY-MM-DD-slug
status: open                         # open | investigating | accepted | rejected | merged | blocked
type: research                       # research | observation | comparison | bug-report | correction
date: YYYY-MM-DD
impact: P1                           # P0 | P1 | P2 | P3
summary: ""                          # ≤ 200 字符
related-changes: []
merges: []
merged-by: null
rejection-reason: null               # status=rejected 时必填，≥ 10 字符
schema-version: "6.0"
```

### 2.3 correction

```yaml
correction-id: CORRECTION-YYYY-MM-DD-NN
date: YYYY-MM-DD
trigger-quote: ""
wrong-behavior: ""                   # ≥ 20 字符
correct-behavior: ""                 # ≥ 20 字符
trigger-scenario: ""
root-cause: ""
knowledge-link: null                 # "[[note]]" 或下方 project-scope
project-scope: null                  # "project-only" 或 null
schema-version: "6.0"
```

`correction-id` 是稳定 ID；详情文件名和 wikilink 必须追加 slug，格式为 `changes/corrections/correction-yyyy-mm-dd-nn-slug.md`。

**输入字段归一规则**（agent 内部转换）：

用户简化输入与 frontmatter 双字段的转换：

| 用户输入 | frontmatter 输出 |
|---------|-----------------|
| `knowledge-link: project-only` | `knowledge-link: null` + `project-scope: "project-only"` |
| `knowledge-link: "[[some-note]]"` | `knowledge-link: "[[some-note]]"` + `project-scope: null` |
| `project-scope: project-only` | 同上首例 |
| 缺二者 | 报告 `missing-fields` |
| 同时填且不一致 | 优先 `knowledge-link`，`project-scope: null` |

---

## 3. Wikilink 规范

4 种形式：
- `[[id]]`
- `[[id|alias]]`
- `[[id#section]]`
- `[[id#section|alias]]`

解析正则：`/\[\[([^\]\|#]+)(?:#([^\]\|]+))?(?:\|([^\]]+))?\]\]/g`

---

## 4. 状态→checkbox 映射

### 4.1 CHG/HOTFIX 状态机

完整状态机（含 V 阶段标记）。frontmatter `status` / `verified-date` / `<!-- VERIFIED -->` / 索引 checkbox 四个维度必须自洽，任一不一致即 `format-violation`。

| frontmatter status | verified-date | `<!-- VERIFIED -->` | 索引 checkbox | 说明 |
|---|---|---|---|---|
| `planned` | null | 缺 | `[ ]`（活跃区） | 未启动 |
| `in-progress` | null | 缺 | `[/]`（活跃区） | 进行中 |
| `completed` | null | 缺 | `[x]`（活跃区） | 任务完成但 V 未通过（block 状态） |
| `completed` | 有 | 有 | `[x]`（活跃区） | V 通过，待归档 |
| `archived` | 有 | 有 | `[x]`（ARCHIVE 下方） | 已归档 |
| `archived` | 有 | 缺 | `[x]`（ARCHIVE 下方） | `format-violation`（VERIFIED 注释缺失） |
| `archived` | 缺 | 有 | `[x]`（ARCHIVE 下方） | `format-violation`（verified-date 缺失） |
| `cancelled` | null | 缺 | `[-]`（ARCHIVE 下方） | 取消，不验证 |

### 4.2 finding 状态机

| frontmatter status | 索引行 checkbox |
|--------------------|---------------|
| `open` | `[ ]` |
| `investigating` | `[/]` |
| `accepted` | `[x]` |
| `rejected` | `[-]` |
| `merged` | `[-]` |
| `blocked` | `[!]` |

---

## 5. 索引行模板（5 个 artifact 文件各一）

### 5.1 task.md

```
- [<checkbox>] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-NNN~T-NNN] [worktree:: <name>] [branch:: <branch>]
```

例：`- [/] [[chg-20260502-01]] hooks.json if 条件优化 #change [tasks:: T-498~T-500]`

当 create-chg prompt 含 `execution-context: [worktree:: ...] [branch:: ...]` 时，task.md 与 implementation_plan.md 索引行保留这些字段。session id、owner state、lock 信息只属于 `.pace/` 运行态，不写入 artifact。

`T-NNN` 是当前 CHG/HOTFIX 内的局部任务 ID，不是全项目全局 ID。不同 CHG 可以同时包含 `T-001`；后续更新必须同时使用 `target: CHG-...` 与 `task-id: T-...` 定位。

**hashtag 与 type 对齐**：
- `type: change` → `#change`
- `type: hotfix` → `#hotfix`，文件名前缀 `hotfix-`，wikilink `[[hotfix-yyyymmdd-nn]]`
- `type: research` → `#research`

### 5.2 implementation_plan.md

格式同 task.md（活跃任务区或变更索引区均使用）。

### 5.3 walkthrough.md（表格行）

```
| <YYYY-MM-DD> | [[chg-yyyymmdd-nn]] <one-line summary> | <CHG-ID> |
```

例：`| 2026-05-02 | [[chg-20260502-01]] hooks.json if 条件优化（T-498-T-500） | CHG-20260502-01 |`

### 5.4 findings.md

```
- [<checkbox>] [[finding-yyyy-mm-dd-slug|<title>]] — <summary ≤200 字符> #finding [date:: YYYY-MM-DD] [impact:: P<N>] [<extra-meta>]
```

`<extra-meta>` 可包含：
- `[change:: [[chg-id]]]`（关联实施 CHG，status=accepted 时）
- `[merges:: [[finding-id]]]`（合并自）
- `[merged-into:: [[finding-id]]]`（被合并到）

例：`- [ ] [[finding-2026-05-02-v91-126|CC v2.1.91→126 评估]] — 35 版本，5 关键发现 #finding [date:: 2026-05-02] [impact:: P1]`

### 5.5 corrections.md

```
- [[correction-yyyy-mm-dd-nn-slug]] <title> [date:: YYYY-MM-DD] [knowledge:: [[note]] | project-only]
```

---

## 5.6 整文件模板（首次创建时）

当索引文件不存在时（如项目首次记录 correction 而 corrections.md 缺失），按以下模板 Write 新建。

### 5.6.1 task.md

```markdown
# 项目任务追踪

## 活跃任务


<!-- ARCHIVE -->

```

### 5.6.2 implementation_plan.md

```markdown
# 实施计划

## 变更索引

<!-- 格式：- [状态] [[wikilink]] 标题 #change [tasks::] -->


<!-- ARCHIVE -->

```

### 5.6.3 walkthrough.md

```markdown
# 工作记录

## 最近工作

| 日期 | 完成内容 | 关联变更 |
| --- | --- | --- |


<!-- ARCHIVE -->

```

### 5.6.4 findings.md

```markdown
# 调研记录

## 摘要索引

<!-- 格式：- [状态] [[finding-id|title]] — summary #finding [date::] [impact::] -->


<!-- ARCHIVE -->

```

### 5.6.5 corrections.md

```markdown
# Corrections 记录

> AI 行为纠正历史。每条 correction 必双写到 knowledge/ 或标 project-only。

## 索引

<!-- 格式：- [[correction-yyyy-mm-dd-nn-slug]] <title> [date::] [knowledge:: [[note]] | project-only] -->
<!-- frontmatter 稳定 ID 是 CORRECTION-YYYY-MM-DD-NN；wikilink 目标是带 slug 的详情文件名。 -->


<!-- ARCHIVE -->

```

---

## 6. ARCHIVE 标记规则

1. 标记必须独占一行：`<!-- ARCHIVE -->`
2. 归档 = 移动行内容到 ARCHIVE 下方，标记位置不变（详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/archive-chg.md` "ARCHIVE 内容移动"）
3. 一个文件只能有一个 ARCHIVE 标记
4. ARCHIVE 之上是活跃区，之下是归档区

---

## 7. VERIFIED 标记规则

V 阶段验证通过的标识。**双表示、单权威**：

| 维度 | 内容 | 用途 |
|------|------|------|
| 机器权威（单源） | frontmatter `verified-date: <ISO 8601 datetime>` | 状态时间戳；机械验证；hooks / agent 解析 |
| 人读 / hook 信号 | `<!-- VERIFIED -->` HTML 注释 | 视觉标记；hook 廉价文本检查 |
| 一致性约束 | 两者同时存在 ↔ 同时不存在 | 不一致即 `format-violation` |

datetime 格式强制：`YYYY-MM-DDTHH:mm:ss+08:00`（含日期 + 时间 + 时区）。生成命令：`date '+%Y-%m-%dT%H:%M:%S+08:00'`。

**位置**：详情文件 `<!-- APPROVED -->` 紧接下一行（不空行间隔）。

```markdown
- [x] T-901 任务一
- [x] T-902 任务二

<!-- APPROVED -->
<!-- VERIFIED -->

## 实施详情
```

**约束**：

1. `<!-- VERIFIED -->` 必须紧跟 `<!-- APPROVED -->` 下一行（不空行间隔）
2. 缺 `<!-- APPROVED -->` 而出现 `<!-- VERIFIED -->` → `format-violation`
3. 不在 `task.md`：永远在 `changes/<id>.md` 内
4. agent 是唯一写者：用户 / 主 session 不允许手写 `<!-- VERIFIED -->` 或 `verified-date`
5. 写入路径：派 `artifact-writer` 执行 `update-chg action=verify`，或在收尾时执行 `close-chg`（详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/update-chg.md` / `close-chg.md`）
6. 归档前置：`archive-chg` / `close-chg` 必须验证 `verified-date` 与 `<!-- VERIFIED -->` 一致，缺一即 `format-violation`

**与 ARCHIVE / APPROVED 标记的区别**：

| 标记 | 范围 | 位置 | 推动方式 |
|------|------|------|---------|
| `<!-- ARCHIVE -->` | 索引文件结构标记 | 5 个索引文件（task.md / implementation_plan.md / walkthrough.md / findings.md / corrections.md）；spec.md 是项目规格文件，不含 ARCHIVE 标记 | 文件创建时存在，永不删除 |
| `<!-- APPROVED -->` | 单 CHG C 阶段批准 | 详情文件 `changes/<id>.md` | 派 `update-chg action=approve` 或 `approve-and-start`，均需 `approval-confirmed/source/evidence` |
| `<!-- VERIFIED -->` | 单 CHG V 阶段验证 | 详情文件 `changes/<id>.md` | 派 `update-chg action=verify` 或 `close-chg` |

---

## 8. 6 类指令详细规范

每类指令的详细输入字段、操作步骤、详情文件结构、索引行模板、边界处理已外移到独立文件。**agent 在执行某类指令时按需 Read 对应文件**（一次 Read 后整会话复用）。

| 指令 | 详细规范文件 |
|------|------------|
| create-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/create-chg.md` |
| update-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/update-chg.md` |
| archive-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/archive-chg.md` |
| close-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/close-chg.md` |
| record-finding | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/record-finding.md` |
| record-correction | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/record-correction.md` |

**为什么独立**：
- 单条指令规范 ~50-80 行，agent 仅 Read 当前任务所需的那条（vs 整段的 174 行）
- prompt cache 粒度更细：指令规范变更不影响其他指令的 cache
- 单指令测试更聚焦
- 6 个文件平均 ~2KB，单次 Read 仅 ~600 tokens

**何时 Read 哪个**：
- 解析主 session 指令后 → 识别指令类型 → Read 对应 ${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/*.md
- 已 Read 当前指令文件 → 整会话不再重复 Read

## 9. 验证规则

每次操作完成后必须验证，但验证应优先使用**低成本证据**，避免写完后反复全量 Read。

| 验证项 | 检查内容 |
|-------|---------|
| frontmatter schema | 字段顺序 / 必填 / 枚举值 / 长度限制 |
| wikilink 完整性 | 每个 [[id]] 指向的文件必须存在 |
| 跨索引一致性 | 同一 CHG-ID 在 task.md / impl_plan.md 都有索引行 |
| ARCHIVE 标记 | 仅 1 个，独占一行 |
| 文件名一致 | frontmatter chg-id 与文件名映射正确（大小写） |

低成本证据优先级：

1. 输入字段校验 + agent 生成的 payload 自检（写入前完成）
2. Write/Edit 工具成功返回
3. Hook PASS / additionalContext 未指出本次目标问题
4. 必要时才 Read 目标文件的最小片段

不要为了报告而重复读取刚 Write/Edit 的完整文件。以下情况才需要额外 Read：

- Edit 需要当前上下文且本轮尚未 Read 该文件
- hook 对本次目标给出 warn/deny
- 归档移动需要定位原索引行或目标段
- 目标文件已存在，需要检查 id 冲突 / id-mismatch
- 工具调用失败或结果不确定

报告中的文件大小、行数、精确行号均为可选信息。不要为了填这些展示字段额外运行 `wc` / `du` / `ls -la`。

验证失败 → 报告 format-violation，列出具体问题。

## 10. 报告标题强制

最终输出的第一行必须**字面**是：

```markdown
## artifact-writer 报告
```

这是 `report_title_strict` 的机械检查项，任何变体都视为失败。

禁止：
- `## 报告`
- `## 执行报告`
- `## create-chg 报告`
- `## artifact-writer 执行报告`
- 标题前添加自然语言说明

报告内部字段可简短，但顶层 H2 不能简化、翻译、加副标题或改写。
