# PACEflow Artifact Writer 规范参考

> **关联 agent**：`paceflow-artifact-writer.md`（同级目录上层）
> **用途**：当 agent 执行任务需要详细 schema / 索引行模板 / 兼容规则时按需 Read 此文件
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

`changes/findings/` 和 `changes/corrections/` 子目录在首次操作时**懒创建**（`mkdir -p`）。

`$ARTIFACT_DIR` 解析：
- 优先 vault 路径 `${VAULT_PATH}/projects/<project-name>/`
- fallback 当前 cwd

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

| frontmatter status | 索引行 checkbox |
|--------------------|---------------|
| `planned` (CHG) | `[ ]` |
| `in-progress` (CHG) | `[/]` |
| `completed` (CHG, 活跃区) | `[x]` |
| `archived` (CHG, ARCHIVE 下方) | `[x]` |
| `cancelled` (CHG) | `[-]` |
| `open` (finding) | `[ ]` |
| `investigating` (finding) | `[/]` |
| `accepted` (finding) | `[x]` |
| `rejected` (finding) | `[-]` |
| `merged` (finding) | `[-]` |
| `blocked` (finding) | `[!]` |

---

## 5. 索引行模板（5 个 artifact 文件各一）

### 5.1 task.md

```
- [<checkbox>] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-NNN~T-NNN]
```

例：`- [/] [[chg-20260502-01]] hooks.json if 条件优化 #change [tasks:: T-498~T-500]`

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

> **最后更新**: <YYYY-MM-DDTHH:mm:ss+08:00>

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

<!-- 格式：- [状态] [[finding-id|title]] — summary [date::] [impact::] -->


## 未解决问题


<!-- ARCHIVE -->

```

### 5.6.5 corrections.md

```markdown
# Corrections 记录

> AI 行为纠正历史。每条 correction 必双写到 knowledge/ 或标 project-only。

## 索引

<!-- 格式：- [[correction-id]] <title> [date::] [knowledge:: [[note]] | project-only] -->


<!-- ARCHIVE -->

```

---

## 6. ARCHIVE 标记规则

1. 标记必须独占一行：`<!-- ARCHIVE -->`
2. 归档 = 移动标记而非内容（Step 1 在待归档内容上方插入新 ARCHIVE，Step 2 删除旧 ARCHIVE）
3. 一个文件只能有一个 ARCHIVE 标记
4. ARCHIVE 之上是活跃区，之下是归档区

---

## 7. v5.x 兼容规则（旧项目，无 changes/ 目录）

不创建 `changes/` 目录。索引和详情在同一文件：

- 索引行格式（无 wikilink）：`- [状态] CHG-XXX 标题 #change [tasks::]`
- 详情段落：`### CHG-XXX 标题` + 段落（4 段：背景/范围/技术决策/任务分解）
- 归档移动详情段落到 ARCHIVE 下方（双步骤 ARCHIVE 标记移动）

详细 v5 格式参考主 session 的 `skills/artifact-management/references/format-reference.md`。

---

## 8. 5 类指令详细规范

每类指令的详细输入字段、操作步骤、详情文件结构、索引行模板、边界处理已外移到独立文件。**agent 在执行某类指令时按需 Read 对应文件**（一次 Read 后整会话复用）。

| 指令 | 详细规范文件 |
|------|------------|
| create-chg | `instructions/create-chg.md` |
| update-chg | `instructions/update-chg.md` |
| archive-chg | `instructions/archive-chg.md` |
| record-finding | `instructions/record-finding.md` |
| record-correction | `instructions/record-correction.md` |

**为什么独立**：
- 单条指令规范 ~50-80 行，agent 仅 Read 当前任务所需的那条（vs 整 §8 的 174 行）
- prompt cache 粒度更细：指令规范变更不影响其他指令的 cache
- 单指令测试更聚焦
- 5 个文件平均 ~2KB，单次 Read 仅 ~600 tokens

**何时 Read 哪个**：
- 解析主 session 指令后 → 识别指令类型 → Read 对应 instructions/*.md
- 已 Read 当前指令文件 → 整会话不再重复 Read

## 9. 验证规则

每次操作完成后必须验证：

| 验证项 | 检查内容 |
|-------|---------|
| frontmatter schema | 字段顺序 / 必填 / 枚举值 / 长度限制 |
| wikilink 完整性 | 每个 [[id]] 指向的文件必须存在 |
| 跨索引一致性 | 同一 CHG-ID 在 task.md / impl_plan.md 都有索引行 |
| ARCHIVE 标记 | 仅 1 个，独占一行 |
| 文件名一致 | frontmatter chg-id 与文件名映射正确（大小写） |

验证失败 → 报告 format-violation，列出具体问题。
