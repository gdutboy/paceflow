# close-chg 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## When To Use

用于主 session 已运行并读取验证结果，且验证通过后收尾当前 CHG/HOTFIX。它是默认收尾路径，会一次完成 open tasks 收口、VERIFIED、归档和 walkthrough。

## Correct Prompt Example

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: close-chg
target: CHG-YYYYMMDD-NN
verification-confirmed: true
complete-open-tasks: true
review-confirmed: true
review-source: manual | <所选 review agent 名>
review-findings: <P0/P1/P2/P3 计数 + 各自处置（HOTFIX/won't-fix finding/record-finding 的 wikilink）>
verify-summary: <已运行并读取的验证结果>
implementation-notes:
  - T-NNN: <该任务实际改动——改了哪些文件、关键实现、对应 commit>
walkthrough-summary: <完成摘要>
```

## 输入字段

- `target`（必填，CHG-ID）
- `verification-confirmed`（必填，必须为布尔 `true`）
- `complete-open-tasks`（必填，必须为布尔 `true`；主 session 已确认验证通过时允许把 `[ ]` / `[/]` 的 T-NNN 收口为 `[x]`）
- `review-confirmed`（必填，必须为布尔 `true`；主 session 已编排对抗审计并路由 findings 后传入，agent 以此字段为唯一依据折叠 REVIEWED）
- `review-source`（必填，`manual` 或所选 review agent 名）
- `review-findings`（必填，P0/P1/P2/P3 计数 + 各自处置 wikilink，写入 `## 审查记录`）
- `verify-summary`（必填，一行验证结果摘要，写入 `## 工作记录`）
- `implementation-notes`（必填，per-task 实施说明：每个 T-NNN 的实际改动——改了哪些文件、关键实现、对应 commit。与 `verify-summary` 同款内容字段（存在且非空，长短不限），写入 `## 实施详情` 段各 `### T-NNN` 标题下，见操作步骤 1.5）
- `walkthrough-summary`（必填，一行完成摘要，写入 `walkthrough.md`）

## 语义

`close-chg` 是收尾合并操作，只能在主 session 已经运行并阅读验证结果、且已编排对抗审计并路由 findings 后调用。它可以一次完成：

1. 必要时把未完成任务收口为 `[x]`
2. 把 `implementation-notes` 按任务写入 `## 实施详情` 执行态记录
3. 推 frontmatter `status` 到 `completed`
4. 写入 `verified-date` + `<!-- VERIFIED -->`
5. 写入 `reviewed-date` + `<!-- REVIEWED -->` + `## 审查记录`（在 VERIFIED 之后、归档之前）
6. 追加验证工作记录
7. 归档到 ARCHIVE 下方并写 `walkthrough.md`

即 close-chg 主路径一把梭：完成 → VERIFIED → REVIEWED → 归档 → walkthrough。

验证是否通过由主 session 判定后经 `verification-confirmed: true` 传入；对抗审计是否跑过由主 session 判定后经 `review-confirmed: true` 传入。两者均为布尔 `true` 是写入任何 artifact 的前提；任一缺失或非 true 时仅报告对应错误码并停止。REVIEWED 只证"审计这步跑过并记录 findings 处置"，不裁决代码质量；findings 的开 HOTFIX / record-finding 路由是主 session 在调用 close-chg 前完成的编排活，close-chg 不跑审计、不开 HOTFIX、不判断，无论审计挖出什么都照常归档（不阻断结论）。

主路径：一个连续 CHG 的代码写完后，主 session 先运行验证并读取结果；验证通过后直接派 `close-chg verification-confirmed: true complete-open-tasks: true`。即使详情中仍有 `[ ]` / `[/]` 的 T-NNN，只要这些任务已经在本轮执行并由验证覆盖，也由 close-chg 统一收口。逐个 `update-status [x]` + `update-chg action=verify` + 归档的拆分路径，仅在用户明确要求暂不归档或需要跨 session 留存进度时使用。

> **报告标题强制**：最终报告第一行字面是 `## artifact-writer 报告`，第一个字符为 `#`，标题前直接进入该行（无自然语言、无空行、无说明前缀）。失败、幂等、部分修复场景同样适用。
> **全局对话样式豁免**：最终报告自成一体，第一个字符是 `#`；时间戳、Insight 块、固定结尾语等主 session / CLAUDE.md 样式均不进入本报告。

## 前置检查

0. 用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 判断 base changes 目录；`MISSING` 时报告 `not-pace-project` 并停止，不写任何文件（base `changes/` 由项目初始化负责创建）。目录存在性以该 `test -d` 结果为准。
1. 解析 target → 详情文件路径；文件不存在 → `target-not-found`
2. 校验必填字段：
   - 缺 `verification-confirmed` / `complete-open-tasks` / `review-confirmed` / `review-source` / `review-findings` / `verify-summary` / `implementation-notes` / `walkthrough-summary` → `missing-fields`
   - `verification-confirmed` 非布尔 `true` → `format-violation`
   - `complete-open-tasks` 非布尔 `true` → `format-violation`
   - `review-confirmed` 非布尔 `true` → `format-violation`
   - 缺 `review-confirmed` 时拒绝并提示：改派 `update-chg action=review` 单独记录审计，或补齐 `review-confirmed` / `review-source` / `review-findings` 后重派 close-chg（与缺 `verification-confirmed` 同款处理）
3. Read 详情文件，校验：
   - `<!-- APPROVED -->` 必须存在
   - frontmatter `status` 必须是非 cancelled 的活跃终态前状态（`planned` / `in-progress` / `completed` / `archived`）；`cancelled` 改走 `archive-chg` 取消式归档
   - `verified-date` 与 `<!-- VERIFIED -->` 必须同时存在或同时不存在；仅一者存在 → `format-violation: verification state inconsistent`
   - 任务清单全部为 `[ ]` / `[/]` / `[x]` / `[-]`（出现 `[!]` 阻塞任务时先解除阻塞）
4. 任务收口规则：
   - `complete-open-tasks: true` 是收口 `[ ]` / `[/]` 任务的前提；满足时把所有 `[ ]` / `[/]` T-NNN 改为 `[x]`。否则（存在 `[ ]` / `[/]` 但 `complete-open-tasks` 非 true）→ `format-violation: tasks not done`
   - W3：若 `## 任务清单` 全部为 `[-]`（全跳过、收口后无任何 `[x]`）→ `format-violation: all tasks skipped, use cancelled + archive-chg`，此时保持 status 不变、不归档。全 `[-]` 语义是 cancelled（见 `update-chg.md` 全 `[-]` → `cancelled`），应派 `update-chg` 推 `cancelled` 后用 `archive-chg` 取消式归档（cancelled 的收尾归 `archive-chg`，close-chg 只写非 cancelled 的 `completed`）。
   - close-chg 写 `completed` 的前提：收口后任务全为 `[x]` / `[-]` 且至少有一个 `[x]`（与 `update-chg.md` 一致）。

## 操作步骤

> **CRLF / stale-read / Edit 匹配失败处理**：修改 artifact 始终只用 `Edit` / `MultiEdit`。若 `Edit` 因换行符差异匹配失败，直接重试同一个 `Edit`；PreToolUse hook 会在 `Edit` / `MultiEdit` 前将 artifact 的 CRLF 机械归一化为 LF。若工具报 `File has been modified since read`，说明其他 session 已改过文件快照（属并发改动）；立即重新 `Read` 目标 artifact，基于最新内容重试。

### 0. 根索引结构预检

在改详情 status / verified / archived 之前，先 Read `task.md`（v7 起唯一 CHG 索引）：

- 若缺 `<!-- ARCHIVE -->`，但文件中存在目标 CHG/HOTFIX 活跃索引行：先在文件末尾补一个独占行 `<!-- ARCHIVE -->`，再继续后续步骤。
- 若缺 `<!-- ARCHIVE -->` 且找不到目标索引行：报告 `format-violation: archive marker missing`。
- 顺序约束：先在本步确认根索引可归档（标记存在或已补、目标索引行可定位），再进入后续修改详情 `status: archived` 的步骤。

### 1. 完成状态联动

- 若 status 为 `planned` / `in-progress` / `completed`：
  - 确保所有 T-NNN 为 `[x]` 或 `[-]`
  - Edit frontmatter：`status: completed`（v7 帧无 `completed-date` 字段，完成时刻由 `verified-date`/`reviewed-date` 承载）
  - Read + Edit `task.md`，对应活跃索引 checkbox 改为 `[x]`
- 若 status 已是 `archived`：
  - 不改 status / completed-date / archived-date
  - 继续执行索引归档一致性修复（若根索引仍在活跃区）

### 1.5 写入实施详情执行态记录

把 `implementation-notes` 的各任务说明写入 `## 实施详情` 段末尾（规划态 Why/What/How 之后、`## 工作记录` 之前），每个任务一个三级标题：

```markdown
### T-NNN

<该任务实际改动说明>
```

- 若存在创建时的占位注释行（「（各任务的实施说明在执行阶段由 … 不在此预填占位符。）」），写入时删除该行。
- 若某 `### T-NNN` 标题已存在（此前 `update-chg section=implementation` append 过）：不重复建标题，在该标题下补充本次说明；内容已一致则幂等跳过。
- `[-]` 跳过任务可省略或写一行跳过原因。

### 2. 写入 V 阶段标记

- 若尚未 verified：
  - Edit frontmatter：`verified-date: <ISO 8601 datetime>`，置于 `completed-date` 与 `archived-date` 之间
  - Edit 详情正文：在 `<!-- APPROVED -->` 行之后紧邻插入 `<!-- VERIFIED -->`
  - Edit `## 工作记录` 表格末尾追加：`| <YYYY-MM-DD> | 验证通过：<verify-summary> |`
- 若已 verified：
  - 不重复写 `verified-date` / `<!-- VERIFIED -->`
  - 不重复追加验证工作记录

### 2.5 写入 R 阶段标记

在写完 V 阶段标记之后、归档之前折叠 REVIEWED（与 §2 写 VERIFIED 同构，详见 `../artifact-writer-spec.md` §7.1）：

- 若尚未 reviewed：
  - Edit frontmatter：`reviewed-date: <ISO 8601 datetime>`，置于 `verified-date` 与 `archived-date` 之间
  - Edit 详情正文：在 `<!-- VERIFIED -->` 行之后紧邻插入 `<!-- REVIEWED -->`（不空行间隔）
  - Edit 详情正文：append/更新 `## 审查记录` 段（写在 `## 工作记录` 之后），写入 `| <YYYY-MM-DD> | <review-source> | <review-findings> |`
- 若已 reviewed：
  - 不重复写 `reviewed-date` / `<!-- REVIEWED -->`
  - 不重复追加审查记录

注：本步只在 `verified-date` + `<!-- VERIFIED -->` 已落（§2 本次刚写或此前已存在）后执行，保证 REVIEWED 紧跟 VERIFIED 下一行；REVIEWED 是流程证据，不裁决 findings。

### 3. 归档索引

归档规则与 `archive-chg.md` 相同：**移动索引行内容到 ARCHIVE 下方，ARCHIVE 标记位置不变**。

- Read `task.md`
  - 若活跃区存在目标索引行：删除活跃区该行，并插入到 `<!-- ARCHIVE -->` 下方，checkbox 必须为 `[x]`
  - 若活跃区没有、ARCHIVE 下方已有目标索引行：视为幂等
  - 两处都没有 → `format-violation: index row not found`
- Read `walkthrough.md`
  - `<slug>` 取目标详情文件名去掉 `.md` 后的完整 stem；wikilink 写 `[[<stem>|<纯ID小写>]]`——带 slug 文件如 `chg-20260610-06-activation-signal-tighten-dual-entry-lock-fix.md` 对应 `[[chg-20260610-06-activation-signal-tighten-dual-entry-lock-fix|chg-20260610-06]]`，旧无 slug 文件如 `chg-20260511-02.md` 对应 `[[chg-20260511-02]]`（stem 来源是文件名，与标题无关）。
  - 从 `task.md` 的目标索引行提取执行上下文（如 `[worktree:: smoke] [branch:: feature-x]`）；若存在，walkthrough 完成内容末尾必须保留同一组上下文。上下文只写 `[worktree:: ...] [branch:: ...]` 这类人读字段；session id、owner state、lock 信息留在 `.pace/`。
  - 若今日或历史已有包含 `[[<stem>` 且关联变更列为 `<CHG-ID>` 的 walkthrough 行：不重复追加；若该行缺少索引行已有的执行上下文，则 Edit 该行补齐。
  - 否则在 `## 最近工作` 表头与分隔行的下一行**插入为第一条**（最新在顶，prepend）：`| <YYYY-MM-DD> | [[<stem>\|<纯ID小写>]] <walkthrough-summary> [worktree:: <name>] [branch:: <branch>] | <CHG-ID> |`——**表格内别名分隔符必须写 `\|` 转义**（裸 `|` 会切坏表格列）。没有上下文时省略 `[worktree:: ...] [branch:: ...]`；旧无 slug 文件 stem=纯ID，直接 `[[<stem>]]` 无别名无需转义。
  - 若 `## 最近工作` 下尚无表头，先写入表头 `| 日期 | 完成内容 | 关联变更 |` 与分隔行 `| --- | --- | --- |`，再把上面的表格行作为表头下第一条写入（见 `artifact-writer-spec.md` §5.3）。

### 4. 归档详情状态

- 若 status 不是 `archived`：
  - Edit frontmatter：`status: archived`
  - 若 `archived-date: null`，填 `<ISO 8601 datetime>`
- 若 status 已是 `archived`：
  - 保持不变，报告中写 `reason: "already archived, index checked/repaired"`

## 边界

- 缺必填字段 → `missing-fields`
- `verification-confirmed` 非 true → `format-violation`
- `complete-open-tasks` 非 true → `format-violation`
- 缺 `review-confirmed` / `review-source` / `review-findings` → `missing-fields`（提示改派 `update-chg action=review` 或补字段后重派）
- 缺 `implementation-notes` → `missing-fields`（实施详情执行态记录是 close 的输入，由主 session 按任务整理实际改动传入，agent 不代写、不留空）
- `review-confirmed` 非 true → `format-violation`
- `reviewed-date` 与 `<!-- REVIEWED -->` 不一致（仅一者存在） → `format-violation: review state inconsistent`
- `<!-- APPROVED -->` 缺失 → `format-violation`
- 任务存在 `[!]` → `format-violation: blocked tasks`
- 任务存在 `[ ]` / `[/]` 且 `complete-open-tasks` 不是 true → `format-violation: tasks not done`
- `verified-date` 与 `<!-- VERIFIED -->` 不一致 → `format-violation: verification state inconsistent`
- status 为 `cancelled` → `format-violation: cancelled change`
- ARCHIVE 标记缺失但目标索引行仍在活跃区 → 先补 `<!-- ARCHIVE -->` 独占行再归档；缺标记且目标索引行也不存在 → `format-violation: archive marker missing`
- 根索引行在活跃区和 ARCHIVE 下方都找不到 → `format-violation: index row not found`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`

## 最终报告硬约束（最后执行）

完成所有 Write/Edit 后，最终回答从下面这一行开始：

```markdown
## artifact-writer 报告
```

只输出报告本身，第一个字符是 `#`，标题前直接进入该行（无过渡句、无说明文字）。
