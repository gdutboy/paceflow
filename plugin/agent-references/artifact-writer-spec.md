# PACEflow Artifact Writer 规范参考

> **关联 agent**：`artifact-writer.md`（同级目录上层）
> **用途**：当 agent 执行任务需要详细 schema / 索引行模板时按需 Read 此文件
> **职责分工**：详细 schema 留在本文件按需 Read，agent system prompt 保持精简（~150 行）

---

## 1. 文件结构

```
projects/<project>/
├── spec.md
├── task.md / walkthrough.md / findings.md / corrections.md
└── changes/
    ├── chg-yyyymmdd-nn.md
    ├── hotfix-yyyymmdd-nn.md
    ├── findings/finding-yyyy-mm-dd-slug.md
    └── corrections/correction-yyyy-mm-dd-nn-slug.md
```

`changes/` 根目录是 PACEflow 项目 marker，必须预先存在。base `changes/` 由项目初始化提供，agent 以它的存在作为执行前提；缺失时立即报告 `not-pace-project` 并停止（此时不 Write / Edit 任何 artifact）。

目录存在性检查必须使用显式状态输出：

```bash
test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING
```

目录存在性以 `test -d … && echo EXISTS || echo MISSING` 的显式输出为准（`ls` 在空目录下 stdout 也为空，无法区分缺失与空目录）。

`changes/findings/` 和 `changes/corrections/` 子目录在首次操作时**懒创建**（`mkdir -p`），但前提是 base `changes/` 已存在。

`$ARTIFACT_DIR` 必须由主 session / hook 在 prompt 中显式传入，agent 直接采用这个传入值（其指向到 cwd 或其他目录的解析由主 session / hook 负责）。`artifact_dir` 仅用于 PaceFlow artifacts：`spec.md` / `task.md` / `walkthrough.md` / `findings.md` / `corrections.md` / `changes/**`。

`spec.md` 是 artifact root 内的项目事实文件，但不属于 artifact-writer 工作范围；技术栈、依赖、配置、目录结构和编码约定由主 session 直接 `Edit` 维护。

注意：`.pace-enabled` 是 PaceFlow 手动激活信号，`.pace/disabled` 是显式豁免；启用信号以这些显式 marker 为准，运行态 `.pace/` 目录本身既不作启用信号，也不作 artifact 根目录。若 cwd 已启用 PaceFlow 但 `$ARTIFACT_DIR/changes` 缺失，报告应说明“当前 artifact_dir 无 changes marker”（如实反映项目已启用、问题在 artifact_dir 指向），并要求主 session 重派时显式提供正确的 `artifact_dir: <path>`。

---

## 2. Frontmatter Schema

字段必须**严格按下方顺序**写入。

### 2.1 CHG/HOTFIX

```yaml
status: planned                      # planned | in-progress | completed | archived | cancelled
date: YYYY-MM-DD                     # 创建日期（人读）
change-set: null                     # key 恒在；仅 batch create 成员把值改为变更集名，单 CHG 保持 null
change-set-seq: null                 # key 恒在；batch 成员值如 "2/4"，单 CHG 保持 null
verified-date: null                  # V 阶段验证通过时填 ISO datetime（与 <!-- VERIFIED --> 双表示同步，详见 §7）
reviewed-date: null                  # R 阶段对抗审计跑过时填 ISO datetime（与 <!-- REVIEWED --> 双表示同步，详见 §7.1）
archived-date: null                  # status=archived 或取消归档时填（归档时刻的唯一来源）
parent-tasks: ["[[<artifact-dir-name>/task|task]]"]   # <artifact-dir-name> 取 artifact_dir 最后一段目录名（如 paceflow-hooks），部分路径写法在多项目库内唯一消歧
schema-version: "7.0"
```

**封闭合同（hook `validateFrontmatterSchema` 确定性校验）**：上方 9 个 key 是 CHG 帧的完整集合——**缺失任一 key 或出现集合外 key 都报 `format-violation`**。key 恒在、未到阶段值为 `null`。CHG ID 由文件名唯一承载，type 由文件名前缀承载，关联调研走正文 wikilink。`change-set`/`change-set-seq` 同样 key 恒在：batch 成员只改值，单 CHG 保持 `null`。

> [!NOTE]
> **强制层级**：封闭合同由 PostToolUse 写盘后软提示（warning 级）即时打回运行中的 artifact-writer 自修、并由 Stop 完成度门兜底；**非 PreToolUse 写时 deny，也不回滚已落盘 frontmatter**。「确定性校验」指校验判定本身确定（同输入同结论、机器可复算），不指写时硬拦截。下文各帧的 `format-violation` 均为此 WARN 软门语义。

### 2.2 finding

```yaml
status: open                         # open | investigating | accepted | rejected | merged | blocked
date: YYYY-MM-DD
schema-version: "7.0"
```

**封闭合同**：上方 3 个 key 是 finding 帧的完整集合（缺失/多余都报 `format-violation`）。`impact`/`summary`/`type` 的权威在 findings.md 索引行；`type`（输入枚举 `research | observation | comparison | bug-report`，纠正记录走 `record-correction`）写入索引行 `[type:: <type>]` meta；`related-changes`/`merges` 输入写入索引行 meta，`rejection-reason` 写入正文；`finding-id` 由文件名承载。

### 2.3 correction

```yaml
date: YYYY-MM-DD
schema-version: "7.0"
```

**封闭合同**：上方 2 个 key 是 correction 帧的完整集合（缺失/多余都报 `format-violation`）。五个文本字段（`trigger-quote` / `wrong-behavior` / `correct-behavior` / `trigger-scenario` / `root-cause`）**正文 6 段单源**（见 `instructions/record-correction.md` 详情文件结构）；`knowledge-link`/`project-scope` 由 corrections.md 索引行 `[knowledge::]`/`[scope::]` 与正文承载；`correction-id` 由文件名承载（详情文件名 `changes/corrections/correction-yyyy-mm-dd-nn-slug.md`）。

**输入字段归一规则**（agent 内部转换）：`knowledge-link` / `project-scope` 输入归一到 corrections.md 索引行 meta——`[knowledge:: [[note]]]` 或 `[scope:: project-only]`。转换表的权威定义见 `instructions/record-correction.md`「knowledge-link 输入归一」（缺二者报 `missing-fields`；同时填且不一致优先 `knowledge-link`）。

<!-- schema-keys: chg = status,date,change-set,change-set-seq,verified-date,reviewed-date,archived-date,parent-tasks,schema-version | finding = status,date,schema-version | correction = date,schema-version -->

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

完整状态机（含 V / R 阶段标记）。frontmatter `status` / `verified-date` / `<!-- VERIFIED -->` / `reviewed-date` / `<!-- REVIEWED -->` / 索引 checkbox 六个维度必须自洽，任一不一致即 `format-violation`。`reviewed-date` 与 `<!-- REVIEWED -->` 必须同时存在或同时不存在（同 verified 的双表示约束），且仅在已 verified 时出现。

下表「Stop 拦"未审计"」是 hook 侧的 warning 级软门。agent 不做这层判定，只负责按指令写 REVIEWED 三项证据（`reviewed-date` + `<!-- REVIEWED -->` + `## 审查记录`）。

| frontmatter status | verified-date | `<!-- VERIFIED -->` | reviewed-date | `<!-- REVIEWED -->` | 索引 checkbox | 说明 |
|---|---|---|---|---|---|---|
| `planned` | null | 缺 | null | 缺 | `[ ]`（活跃区） | 未启动 |
| `in-progress` | null | 缺 | null | 缺 | `[/]`（活跃区） | 进行中 |
| `completed` | null | 缺 | null | 缺 | `[x]`（活跃区） | 任务完成但 V 未通过（block 状态） |
| `completed` | 有 | 有 | null | 缺 | `[x]`（活跃区） | V 通过但未审计（block 状态，Stop 拦"未审计"） |
| `completed` | 有 | 有 | 有 | 有 | `[x]`（活跃区） | V 通过且已审计，待归档 |
| `archived` | 有 | 有 | 有 | 有 | `[x]`（ARCHIVE 下方） | 已归档 |
| `archived` | 有 | 缺 | — | — | `[x]`（ARCHIVE 下方） | `format-violation`（VERIFIED 注释缺失） |
| `archived` | 缺 | 有 | — | — | `[x]`（ARCHIVE 下方） | `format-violation`（verified-date 缺失） |
| `completed` | null | 缺 | 有 | 有 | `[x]`（活跃区） | `format-violation`（未 verified 不得 reviewed） |
| `cancelled` | null | 缺 | null | 缺 | `[-]`（ARCHIVE 下方） | 取消，不验证不审计 |

`cancelled` 只用于全部 T-NNN 都为 `[-]` 的 CHG/HOTFIX；混合 `[x]` + `[-]` 表示部分任务跳过但变更完成，仍使用 `completed`。

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

## 5. 索引行模板（4 个索引文件各一）

> 注：§5.2 与 §5.6.2 原为 implementation_plan.md 模板，v7 退役后编号保留空位——刻意不重编号，避免其他指令文件（archive-chg / close-chg / record-finding / record-correction / update-index）对 §5.x 章节号的入向引用漂移。

### 5.1 task.md

```
- [<checkbox>] [[chg-yyyymmdd-nn-<slug>|chg-yyyymmdd-nn]] <title> #change [tasks:: T-NNN~T-NNN] [worktree:: <name>] [branch:: <branch>]
```

例：`- [/] [[chg-20260610-06-activation-signal-tighten-dual-entry-lock-fix|chg-20260610-06]] 激活信号收紧 #change [tasks:: T-001~T-004]`

wikilink 用**详情文件名全名 + `|` 纯 ID 别名**（Obsidian 按文件名解析 wikilink，写全名才能解析到详情文件）。无 slug 详情文件（`chg-yyyymmdd-nn.md`）的索引行直接用 `[[chg-yyyymmdd-nn]]`。

机械格式：CHG/HOTFIX 索引行必须独占一行，并从行首 `- [` 开始。低成本验证时用行首格式确认索引，而不是只搜索 wikilink 文本。

当 create-chg prompt 含 `execution-context: [worktree:: ...] [branch:: ...]` 时，task.md 索引行保留这些字段。session id、owner state、lock 信息只属于 `.pace/` 运行态，不写入 artifact。

`T-NNN` 是当前 CHG/HOTFIX 内的局部任务 ID，不是全项目全局 ID。不同 CHG 可以同时包含 `T-001`；后续更新必须同时使用 `target: CHG-...` 与 `task-id: T-...` 定位。

**hashtag 与 type 对齐**：
- `type: change` → `#change`
- `type: hotfix` → `#hotfix`，文件名前缀 `hotfix-`，wikilink `[[hotfix-yyyymmdd-nn-<slug>|hotfix-yyyymmdd-nn]]`

### 5.3 walkthrough.md（表格行）

```
| <YYYY-MM-DD> | [[chg-yyyymmdd-nn-<slug>\|chg-yyyymmdd-nn]] <one-line summary> [worktree:: <name>] [branch:: <branch>] | <CHG-ID> |
```

例：`| 2026-06-10 | [[chg-20260610-06-activation-signal-tighten-dual-entry-lock-fix\|chg-20260610-06]] 激活信号收紧（T-001-T-004） [worktree:: main] [branch:: master] | CHG-20260610-06 |`

wikilink 同 §5.1 全名 + 纯 ID 别名，但**表格内别名分隔符必须写 `\|` 转义**（裸 `|` 是 Markdown 表格列分隔符，会切坏表格列）；旧无 slug 文件保持纯 ID（无别名无需转义）。task.md 是列表行非表格，用裸 `|` 即可。

新记录插入到表头与分隔行的下一行（最新在顶，prepend），与 walkthrough 详情段落方向一致；session-start 注入按日期降序保留最近若干条。

当 task.md 的目标索引行含 `[worktree:: ...] [branch:: ...]` 时，walkthrough 完成内容列也必须保留同一组字段；没有上下文时省略。session id、owner state、lock 信息只属于 `.pace/` 运行态，不写入 artifact。

### 5.4 findings.md

```
- [<checkbox>] [[finding-yyyy-mm-dd-slug|<title>]] — <summary ≤200 字符> #finding [date:: YYYY-MM-DD] [impact:: P0-P3] [type:: <type>] [<extra-meta>]
```

`<extra-meta>` 可包含：
- `[change:: [[<chg 详情文件名全名>|chg-id]]]`（关联实施 CHG，status=accepted 时；目标是带 slug 文件时用全名+别名，旧无 slug 文件直接 `[[chg-id]]`——glob `changes/chg-yyyymmdd-nn*.md` 取 stem）
- `[merges:: [[finding-id]]]`（合并自）
- `[merged-into:: [[finding-id]]]`（被合并到）

例：`- [ ] [[finding-2026-05-02-v91-126|CC v2.1.91→126 评估]] — 35 版本，5 关键发现 #finding [date:: 2026-05-02] [impact:: P1] [type:: comparison]`

新记录插入到活跃区第一个 finding 索引行之前（最新在顶，prepend；活跃区暂无索引行时插到最后一个标题下方，兼容「## 摘要索引」/「## 未解决问题」变体），与 walkthrough 方向一致；session-start 注入另按 impact 优先 + date 降序重排，不依赖文件物理顺序。

### 5.5 corrections.md

```
- [[correction-yyyy-mm-dd-nn-slug]] <title> [date:: YYYY-MM-DD] [knowledge:: [[note]]]（project-only 场景改用 [scope:: project-only]，不把 scope 值塞进 [knowledge::]）
```

新记录插入到活跃区第一个 correction 索引行之前（最新在顶，prepend，与下一条间不留空行；活跃区暂无索引行时插到「## 活跃记录」/「## 索引」标题下方），与 walkthrough / findings 方向一致；session-start 注入另按 date 降序保留最近 6 条，不依赖文件物理顺序。

---

## 5.6 整文件模板（首次创建时）

当索引文件不存在时（如项目首次记录 correction 而 corrections.md 缺失），按以下模板 Write 新建。

### 5.6.1 task.md

```markdown
# 项目任务追踪

## 活跃任务


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

<!-- 格式：- [状态] [[finding-id|title]] — summary #finding [date::] [impact::] [type::] [change::] -->


<!-- ARCHIVE -->

```

### 5.6.5 corrections.md

```markdown
# Corrections 记录

> AI 行为纠正历史。每条 correction 必双写到 knowledge/ 或标 project-only。

## 索引

<!-- 格式：- [[correction-yyyy-mm-dd-nn-slug]] <title> [date::] [knowledge:: [[note]]] 或 [scope:: project-only] -->
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

1. `<!-- VERIFIED -->` 紧跟 `<!-- APPROVED -->` 下一行（两行相邻，无空行间隔）
2. `<!-- VERIFIED -->` 仅在 `<!-- APPROVED -->` 已存在时出现；二者顺序颠倒（有 VERIFIED 无 APPROVED）即 `format-violation`
3. 位置永远在 `changes/<id>.md` 内（task.md 不承载此标记）
4. agent 是唯一写者：`<!-- VERIFIED -->` 与 `verified-date` 由 agent 经指令写入，用户 / 主 session 通过派发 agent 触达
5. 写入路径：派 `artifact-writer` 执行 `update-chg action=verify`，或在收尾时执行 `close-chg`（详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/update-chg.md` / `close-chg.md`）
6. 归档前置：`archive-chg` / `close-chg` 必须验证 `verified-date` 与 `<!-- VERIFIED -->` 一致，缺一即 `format-violation`；唯一例外是 `status: cancelled` 的 `archive-chg` 取消归档，它不验证、不改为 archived，只移动 `[-]` 索引行到 ARCHIVE 下方

**与 ARCHIVE / APPROVED 标记的区别**：

| 标记 | 范围 | 位置 | 推动方式 |
|------|------|------|---------|
| `<!-- ARCHIVE -->` | 索引文件结构标记 | 4 个索引文件（task.md / walkthrough.md / findings.md / corrections.md）；spec.md 是项目规格文件，不含 ARCHIVE 标记 | 文件创建时存在，永不删除 |
| `<!-- APPROVED -->` | 单 CHG C 阶段批准 | 详情文件 `changes/<id>.md` | 派 `update-chg action=approve` 或 `approve-and-start`，均需 `approval-confirmed/source/evidence` |
| `<!-- VERIFIED -->` | 单 CHG V 阶段验证 | 详情文件 `changes/<id>.md` | 派 `update-chg action=verify` 或 `close-chg` |
| `<!-- REVIEWED -->` | 单 CHG R 阶段审计 | 详情文件 `changes/<id>.md` | 派 `update-chg action=review` 或 `close-chg`，均需 `review-confirmed/source/findings` |

---

## 7.1 REVIEWED 标记规则

R 阶段对抗审计跑过的标识，与 §7 VERIFIED **完全同构**。**双表示、单权威**：

| 维度 | 内容 | 用途 |
|------|------|------|
| 机器权威（单源） | frontmatter `reviewed-date: <ISO 8601 datetime>` | 状态时间戳；机械验证；hooks / agent 解析 |
| 人读 / hook 信号 | `<!-- REVIEWED -->` HTML 注释 | 视觉标记；hook 廉价文本检查 |
| 一致性约束 | 两者同时存在 ↔ 同时不存在 | 不一致即 `format-violation` |

datetime 格式强制：`YYYY-MM-DDTHH:mm:ss+08:00`（含日期 + 时间 + 时区）。生成命令：`date '+%Y-%m-%dT%H:%M:%S+08:00'`。

**位置**：详情文件 `<!-- VERIFIED -->` 紧接下一行（不空行间隔）。

```markdown
- [x] T-901 任务一
- [x] T-902 任务二

<!-- APPROVED -->
<!-- VERIFIED -->
<!-- REVIEWED -->

## 实施详情
```

**约束**：

1. `<!-- REVIEWED -->` 紧跟 `<!-- VERIFIED -->` 下一行（两行相邻，无空行间隔）
2. `<!-- REVIEWED -->` 仅在 `<!-- VERIFIED -->` 已存在时出现；未 verified 即出现 REVIEWED（顺序颠倒）即 `format-violation`——审计的语义前提是验证已通过（"先验证再审计"）
3. 位置永远在 `changes/<id>.md` 内（task.md 不承载此标记）
4. agent 是唯一写者：`<!-- REVIEWED -->` 与 `reviewed-date` 由 agent 经指令写入，用户 / 主 session 通过派发 agent 触达
5. 写入路径：派 `artifact-writer` 执行 `update-chg action=review`，或在收尾时执行 `close-chg`（详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/update-chg.md` / `close-chg.md`）
6. **流程证据语义，非质量裁决**：REVIEWED 只证"对抗审计这步跑过并记录了 findings 处置"，不证代码无缺陷（与 APPROVED 证"批准了"、VERIFIED 证"验证跑了"同理）。审计的派发、findings 路由（开 HOTFIX / record-finding）是主 session 编排活，agent 只落 `reviewed-date` + `<!-- REVIEWED -->` + `## 审查记录` 三项证据，不验证 findings 真伪、不要求"修完"

`## 审查记录` 段结构（写在 `## 工作记录` 之后）：

```markdown
## 审查记录

| 日期 | 审计来源 | findings |
| --- | --- | --- |
| <YYYY-MM-DD> | <review-source（manual 或所选 review agent 名）> | <P0/P1/P2/P3 计数 + 各自处置 wikilink> |
```

---

## 7.2 实施详情执行态记录（implementation-notes）

`## 实施详情` 段双态：create 时写入规划态（Why/What/How，见 `create-chg.md`）；close 时由 `close-chg` 必填字段 `implementation-notes` 写入执行态——每个 T-NNN 的实际改动（改了哪些文件、关键实现、对应 commit），格式为各任务 `### T-NNN` 三级标题，位于规划态之后、`## 工作记录` 之前。

字段校验与 `verify-summary` 对齐（内容字段，存在且非空，长短不限）。中途补充仍可用 `update-chg section=implementation action=append`（不强制）；close-chg 收口时缺失即 `missing-fields`——否则详情文件只剩创建时的规划态信息，执行情况无从审计。`update-chg action=verify`（只记录验证暂不归档）不要求此字段。

### create 时规划态前提被证伪的勘误约定

若 CHG 执行中发现 create 时写入的规划态（标题 / `## 任务清单` 任务行 / `## 实施详情` 的 Why/What/How）前提**已被证伪**（如「判定为死代码」被测试推翻、技术方案中途改向），**不重写 create 段**——规划态是不可变的原始计划记录，保留作历史与决策追溯。改为派 `update-chg section=work-record action=append` 在 `## 工作记录` 追加一条醒目 `⚠️ 勘误` 条目，指明前段哪些结论被证伪、实际交付以 `## 实施详情` 执行态为准。这样既保留「原始计划 → 被证伪 → 改向」的诚实历史，又让后续审计不被前段旧叙述误导。（artifact-writer 无「改写已归档 CHG 规划段」的操作是有意设计，勘误统一走 work-record。）

---

## 8. 各类指令详细规范

每类指令的详细输入字段、操作步骤、详情文件结构、索引行模板、边界处理已外移到独立文件。**agent 在执行某类指令时按需 Read 对应文件**（一次 Read 后整会话复用）。

| 指令 | 详细规范文件 |
|------|------------|
| create-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/create-chg.md` |
| update-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/update-chg.md` |
| archive-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/archive-chg.md` |
| close-chg | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/close-chg.md` |
| record-finding | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/record-finding.md` |
| record-correction | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/record-correction.md` |
| update-finding | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/update-finding.md` |
| update-index | `${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/update-index.md` |

**何时 Read 哪个**：
- 解析主 session 指令后 → 识别指令类型 → Read 对应 ${CLAUDE_PLUGIN_ROOT}/agent-references/instructions/*.md
- 已 Read 当前指令文件 → 整会话不再重复 Read

## 9. 验证规则

每次操作完成后必须验证，验证优先使用**低成本证据**，把全量 Read 留给下方明确需要的场景。

| 验证项 | 检查内容 |
|-------|---------|
| frontmatter schema | 字段顺序 / 必填 / 枚举值 / 长度限制 |
| wikilink 完整性 | 每个 [[id]] 指向的文件必须存在 |
| 索引存在 | 同一 CHG-ID 在 task.md 有唯一索引行 |
| ARCHIVE 标记 | 仅 1 个，独占一行 |
| schema 合同 | frontmatter key 集合与阶段必填符合 §2.1-2.3（hook validateFrontmatterSchema 同步校验） |

低成本证据优先级：

1. 输入字段校验 + agent 生成的 payload 自检（写入前完成）
2. Write/Edit 工具成功返回
3. Hook PASS / additionalContext 未指出本次目标问题
4. 必要时才 Read 目标文件的最小片段

报告依据优先取自上述低成本证据；以下情况才追加额外 Read：

- Edit 需要当前上下文且本轮尚未 Read 该文件
- hook 对本次目标给出 warn/deny
- 归档移动需要定位原索引行或目标段
- 目标文件已存在，需要检查 id 冲突 / id-mismatch
- 工具调用失败或结果不确定

报告中的文件大小、行数、精确行号均为可选信息，省略即可；`wc` / `du` / `ls -la` 仅在确有诊断需要时运行。

验证失败 → 报告 format-violation，列出具体问题。

## 9.1 CRLF / stale-read / Edit 匹配失败处理

修改 artifact 始终只用 `Edit` / `MultiEdit`。若 `Edit` 因换行符差异匹配失败，直接重试同一个 `Edit`（PreToolUse hook 会在 `Edit` / `MultiEdit` 前把 artifact 的 CRLF 机械归一化为 LF）。若工具报 `File has been modified since read`，这是并发 session 改动导致的快照过期，不是 hook 锁失败：立即重新 `Read` 目标 artifact，基于最新内容重试。

## 10. 报告标题强制

最终输出的第一行必须**字面**是：

```markdown
## artifact-writer 报告
```

这是 `report_title_strict` 的机械检查项，只认这一行原文。

机械检查只放行字面 `## artifact-writer 报告`；以下都属于变体而判为失败，应回到上面这行原文：
- `## 报告`
- `## 执行报告`
- `## create-chg 报告`
- `## artifact-writer 执行报告`
- 标题前添加的自然语言说明

报告内部字段可简短，顶层 H2 保持原文这一行（不简化、翻译、加副标题或改写）。
