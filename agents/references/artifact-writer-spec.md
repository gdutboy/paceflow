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

### 8.1 create-chg

**输入字段**：
- `title`（必填）
- `tasks`（必填，至少 1 个，格式 `["T-NNN: desc", ...]`）
- `type`（默认 change）
- `related-finding`（可选）
- `background` / `scope` / `technical-decision`（可选）

**操作步骤**：
1. 计算 chg-id：基于今日 + 当日序号（扫 changes/ 同日 chg-* 文件最大序号 +1）
2. 生成 slug：参考 system prompt slug 规则
3. v6: `mkdir -p changes/`
4. v6: Write `changes/chg-yyyymmdd-nn.md`（含 frontmatter + 任务清单 + 实施详情 + 工作记录空表 + 关联调研）
5. v6: Read + Edit `task.md` 添加索引行（活跃任务区，按时间倒序插入顶部）
6. v6: Read + Edit `implementation_plan.md` 添加索引行（变更索引区）
7. v5: Edit task.md / implementation_plan.md 添加索引行 + 详情段落（详情含 4 段）

**详情文件结构**（v6）：

```markdown
---
[frontmatter, 见 §2.1]
---

# <title>

## 任务清单

- [ ] T-NNN <task description>
- [ ] T-NNN <task description>

<!-- APPROVED -->

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

### 8.2 update-chg

**输入字段**：
- `target`（必填，CHG-ID）
- `section`（必填：tasks | implementation | work-record | research）
- `action`（必填：append | replace | update-status）
- `content`（视 action 而定）
- `task-id` + `new-status`（action=update-status 时必填）

**操作步骤**：
- v6: Read + Edit `changes/chg-xxx.md` 对应段落
- v5: Read + Edit 主 artifact 详情段落

**update-status 子流程**：
1. Read changes/chg-xxx.md 找到 `- [<old>] T-NNN`
2. Edit 改 `<old>` 为 `<new-status>`（参考 §4 状态映射）

### 8.3 archive-chg

**输入字段**：
- `target`（必填，CHG-ID）
- `walkthrough-summary`（必填，一行总结）

**操作步骤**：
1. v6: Read + Edit 详情 frontmatter `status: completed` + `completed-date: <ISO datetime>`
2. v6: Read + Edit `task.md` 索引行 `[/]→[x]` 移到 ARCHIVE 下方
3. v6: Read + Edit `implementation_plan.md` 同上
4. v6: Read + Edit `walkthrough.md` 添加完成索引行（§5.3 模板）
5. v5: 移动详情段落到 ARCHIVE 下方（双步骤 ARCHIVE 标记移动）

**ARCHIVE 双步骤详解**（v5 + v6 共用）：
- Step 1：在待归档内容上方插入新 `<!-- ARCHIVE -->` 行
- Step 2：删除旧 `<!-- ARCHIVE -->` 行
- 净效果：标记移动到新位置，内容物理位置不变

### 8.4 record-finding

**输入字段**：
- `title`（必填）
- `summary`（必填，≤ 200 字符）
- `type`（必填，research | observation | comparison | bug-report）
- `impact`（必填，P0-P3）
- `body`（必填，Markdown 内容）
- `related-changes`（可选，wikilink list）
- `merges`（可选）
- `status`（默认 open）

**操作步骤**：
1. 生成 finding-id（FINDING-YYYY-MM-DD-slug）
2. v6: `mkdir -p changes/findings/`
3. v6: Write `changes/findings/finding-yyyy-mm-dd-slug.md`（frontmatter + body）
4. v6: Read + Edit `findings.md` 摘要索引添加索引行（§5.4 模板）
5. v5: Read + Edit `findings.md` 摘要索引 + `## 未解决问题` 区添加详情段落

**详情文件结构**（v6）：

```markdown
---
[frontmatter, 见 §2.2]
---

# <title>

[body 内容，按主 session 提供]
```

### 8.5 record-correction

**输入字段**：
- `trigger-quote`（必填）
- `wrong-behavior`（必填，≥ 20 字符）
- `correct-behavior`（必填，≥ 20 字符）
- `trigger-scenario`（必填）
- `root-cause`（必填）
- `knowledge-link` 或 `project-scope: project-only`（必填二选一）

**操作步骤**：
1. 生成 correction-id（CORRECTION-YYYY-MM-DD-NN，扫 changes/corrections/ 同日序号 +1）
2. v6: `mkdir -p changes/corrections/`
3. v6: Write `changes/corrections/correction-xxx.md`（frontmatter + body）
4. v6: Read + Edit `corrections.md` 添加索引行（§5.5 模板）
5. v5: Read + Edit `findings.md` "## Corrections 记录" 区添加 correction 段落

**详情文件结构**（v6）：

```markdown
---
[frontmatter, 见 §2.3]
---

# Correction: <title>

## 错误行为
<wrong-behavior>

## 正确做法
<correct-behavior>

## 触发场景
<trigger-scenario>

## 根本原因
<root-cause>

## 关联知识
- [[<knowledge-link>]]（如适用）
```

---

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
