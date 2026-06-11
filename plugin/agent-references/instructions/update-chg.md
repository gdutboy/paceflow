# update-chg 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## When To Use

用于更新既有 CHG/HOTFIX：批准、批准并开始、暂停/恢复任务、追加记录或只记录验证。连续执行并已验证通过时，默认改用 `close-chg` 一次完成收尾（最后收尾交给单次 `close-chg`，而非多次 update）。

## Correct Prompt Examples

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
status-reason: <用户要求恢复或阻塞已解除>
```

只记录验证：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: verify
verify-summary: <已运行并读取的验证结果>
```

只记录审计（暂不归档）：

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-chg
target: CHG-YYYYMMDD-NN
action: review
review-confirmed: true
review-source: manual | <所选 review agent 名>
review-findings: <P0/P1/P2/P3 计数 + 各自处置（HOTFIX/won't-fix finding/record-finding 的 wikilink）>
```

## 输入字段

- `target`（必填，CHG-ID）
- `section`（action=approve / approve-and-start / verify / review 时不必填；其他 action 必填，枚举：`tasks` | `implementation` | `work-record` | `research`）
- `action`（必填，枚举：`append` | `replace` | `update-status` | `approve` | `approve-and-start` | `verify` | `review`）
- `content`（视 action 而定）
- `task-id` + `new-status`（action=update-status 时必填）
- `approval-confirmed: true` + `approval-source` + `approval-evidence`（action=approve / approve-and-start 时必填）
- `task-id`（action=approve-and-start 时必填）
- `verify-summary`（action=verify 时必填，写入 `## 工作记录` 单元格）
- `review-confirmed: true` + `review-source` + `review-findings`（action=review 时必填；`review-source` 是 `manual` 或所选 review agent 名，`review-findings` 写 P0/P1/P2/P3 计数 + 各自处置 wikilink，写入 `## 审查记录` 段）

## 操作步骤

> **报告标题强制**：所有 action（append / replace / update-status / approve / approve-and-start / verify / review）完成后，报告第一行字面是 `## artifact-writer 报告`，第一个字符为 `#`，标题作为独立单行（见 `agents/artifact-writer.md` §报告格式）。失败、幂等、部分修复场景同样适用。
> **全局对话样式豁免**：最终报告自成一体，第一行直接是 `## artifact-writer 报告`；时间戳、Insight 块、固定结尾语等主 session / CLAUDE.md 样式均不进入本报告。
> **错误码层级**：`operation=update-chg` 已识别时，非法 `action` 属于字段值非法，报告 `format-violation`。`out-of-scope` 的适用范围仅限未知 operation（如 `delete-chg`）。

### 通用前置

0. 用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 判断 base changes 目录；`MISSING` 时报告 `not-pace-project` 并停止，不写任何文件（base `changes/` 由项目初始化负责创建）。目录存在性以该 `test -d` 结果为准。
1. 解析 target → 路径：`changes/chg-yyyymmdd-nn.md` 或 `changes/hotfix-yyyymmdd-nn.md`
2. 文件不存在 → 报告 `target-not-found`

### action=append

Read + Edit changes/chg-xxx.md 对应 section 末尾追加 content

### action=replace

Read + Edit 整个 section 替换为 content

### action=update-status

- 仅适用于 `section=tasks`
- `new-status=[!]` 表示暂停/阻塞，必须带 `status-reason` / `block-reason` / `pause-reason` 之一；原因写入 `## 工作记录`。`[!]` 的语义仅为「该任务当前挂起、等待同一 owner 后续恢复」（与完成态 `[x]` 区分，且不触发其他 worktree 接手）。
- 子流程：
  1. Read changes/chg-xxx.md 找到 `- [<old>] T-NNN`
  2. Edit 改 `<old>` 为 `<new-status>`（参考 spec §4 状态映射）
  3. **frontmatter 联动**（每次 update-status 后必执行）：
     - Read `## 任务清单` 段，统计任务状态
     - 全部为 `[-]` → Edit frontmatter `status` → `cancelled`，不写 `completed-date`
     - 全部为 `[x]` 或 `[-]` 且至少一个 `[x]` → Edit frontmatter `status` → `completed`，并添加 `completed-date: <ISO 8601 datetime>`
     - 仍有 `[/]` 但 frontmatter `status: planned` → Edit frontmatter `status` → `in-progress`
     - 否则 frontmatter 不变
     - **datetime 格式强制**：`YYYY-MM-DDTHH:mm:ss+08:00`，三段齐全——日期 + 时间 + 时区（如 `2026-05-03T03:05:13+08:00`）。用 `Bash: date -Iseconds` 或 `date '+%Y-%m-%dT%H:%M:%S+08:00'` 生成即可满足该格式
  4. **根索引 checkbox 联动**（frontmatter status 变化或暂停/恢复时必执行）：
     - 若 `new-status=[!]`，根索引 checkbox 改为 `[!]`
     - 若 `new-status=[/]` 且根索引当前为 `[!]`，根索引 checkbox 改回 `[/]`
     - 否则若 step 3 改了 frontmatter `status`，按 spec §4 映射推算根索引 checkbox：
       - `planned` → `[ ]`
       - `in-progress` → `[/]`
       - `completed`（活跃区） → `[x]`
       - `cancelled` → `[-]`
     - Read + Edit `task.md` 找 `- [<old>] [[<chg-id>]]` → 改 `<old>` 为新 checkbox（v7 起 task.md 是唯一索引）
     - 若 frontmatter status 未变（如多个 [x] 但仍有 [/]），跳过此步

连续执行的同一 CHG，逐个 T-NNN 的 `[x]` 收口可以合并到收尾一次完成。CHG 是连续执行、可验证、可关闭的最小变更单元；若主 session 正在同一执行流里继续完成剩余任务，应继续写代码/测试，最后验证通过后直接派 `close-chg complete-open-tasks: true`，由 close-chg 一次完成 open tasks 收口、completed、VERIFIED、归档和 walkthrough。`update-status [!]` 的适用场景是暂停/阻塞；`update-status [x]` 的适用场景是跨 session、长任务进度可见性，或最后任务暂不验证/暂不收尾时停在 completed。

### action=approve

C 阶段批准后由主 session 调用，向详情文件插入 `<!-- APPROVED -->` 标记。

**硬前置**：
- `approval-confirmed` 必须为布尔 `true`；缺失 → `missing-fields`，非 true → `format-violation`。批准状态以 prompt 显式 `approval-confirmed: true` 为唯一依据。
- `approval-source` 必填，推荐枚举：`user-directive` / `ask-user-question` / `accepted-plan` / `prior-approved-plan`。
- `approval-evidence` 必填，写一句用户原话或已确认方案摘要。agent 不验证证据真伪，但报告中必须保留，方便审计。
- `action=approve` 的语义限定为“已批准但暂不开始”（ready/deferred），仅插入 APPROVED 标记，不授予项目文件写入许可。若 prompt 同时要求 `status: in-progress`、标记 `[/]` 或“开始执行”，报告 `format-violation` 并提示改用 `action=approve-and-start`。

子流程：
1. Read changes/chg-xxx.md
2. 检查是否已含 `<!-- APPROVED -->` → 已有则报告 `status: SUCCESS`，`reason: "already approved, no change"`，`files_modified: []`（幂等，不重复插入）
3. Edit 在 `## 任务清单` 段最后一个任务行**之后保留原空行**，插入 `<!-- APPROVED -->` 独占一行 + 一个空行，如下：

   修改前：
   ```
   - [ ] T-902 测试任务二

   ## 实施详情
   ```

   修改后：
   ```
   - [ ] T-902 测试任务二

   <!-- APPROVED -->

   ## 实施详情
   ```

   注意：`<!-- APPROVED -->` 独占一行，上方保留最后一个任务行原有的空行、下方保留一个空行（即与任务行之间始终隔一个空行）。

4. status 不变（保持 `planned` 直到第一个 `[/]` 由 update-status 推升 `in-progress`）

注：approve 仅插入标记。状态机推动由 update-status 自动联动，避免双重写入。

### action=approve-and-start

C 阶段用户已明确批准、并准备开始整个 CHG 时由主 session 调用。`task-id` 是执行锚点（first task anchor）：它只标记本轮连续执行从哪个 T-NNN 开始，不表示只批准或只执行这一个任务。此 action 将 `approve` 与首次 `update-status` 合并，避免同一个 CHG 连续派两次 agent。

**硬前置**：
- `approval-confirmed` 必须为布尔 `true`；缺失 → `missing-fields`，非 true → `format-violation`。批准状态以 prompt 显式 `approval-confirmed: true` 为唯一依据。
- `approval-source` 必填，推荐枚举：`user-directive` / `ask-user-question` / `accepted-plan` / `prior-approved-plan`。
- `approval-evidence` 必填，写一句用户原话或已确认方案摘要。agent 不验证证据真伪，但报告中必须保留，方便审计。
- `task-id` 必填，指明要标记为 `[/]` 的首个 T-NNN；同一 CHG 内后续任务默认由主 session 连续完成，并由 `close-chg complete-open-tasks:true` 统一收口。

子流程：
1. Read `changes/chg-xxx.md`
2. 前置校验：
   - frontmatter `status` 只能是 `planned` 或 `in-progress`
   - `task-id` 必须存在于 `## 任务清单`
   - 该任务当前只能是 `[ ]` 或 `[/]`；若为 `[x]` / `[-]` / `[!]` → `format-violation: task not startable`
3. APPROVED 幂等写入：
   - 若缺 `<!-- APPROVED -->`，按 `action=approve` 的位置规则插入
   - 若已存在，不重复插入
4. 任务与状态联动：
   - 将 `task-id` 标为 `[/]`；若已是 `[/]` 则不改
   - 若 frontmatter `status: planned`，改为 `status: in-progress`
   - Read + Edit `task.md`，将对应索引 checkbox 改为 `[/]`
5. 报告 `status: SUCCESS`，列出修改的详情文件和两个根索引文件；完全幂等时允许 `files_modified: []`

边界：
- 缺 `approval-confirmed` / `approval-source` / `approval-evidence` / `task-id` → `missing-fields`
- `approval-confirmed` 非 true → `format-violation`
- status 为 `completed` / `archived` / `cancelled` → `format-violation`
- `<!-- VERIFIED -->` 或 `verified-date` 已存在 → `format-violation`

### action=verify

V 阶段验证通过后由主 session 调用，写入"双表示、单权威"的 V 阶段标志（详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/artifact-writer-spec.md` §7）。这是“只记录验证、暂不归档”的例外路径；默认收尾请使用 `close-chg`：
- 机器权威：frontmatter `verified-date: <ISO 8601 datetime>`
- 人读 / hook 信号：`<!-- VERIFIED -->` HTML 注释（紧邻 `<!-- APPROVED -->` 下一行）
- 一致性约束：两者必须同时存在或同时不存在，不一致即 `format-violation`

子流程：
1. Read `changes/chg-xxx.md`（target 解析失败 → `target-not-found`）
2. **前置校验**（任一失败即 `format-violation`，不写文件）：
   - frontmatter `status` 必须等于 `completed`（验证仅在 `completed` 状态下进行）
   - `<!-- APPROVED -->` 必须存在
3. **幂等检查**（已完整验证 → SUCCESS 幂等，不写文件）：
   - frontmatter `verified-date` 已有非 null 值 **AND** `<!-- VERIFIED -->` 已存在
   - 报告 `status: SUCCESS`，`reason: "already verified, no change"`，`files_modified: []`
4. **不一致检查**（任一失败即 `format-violation`，不写文件）：
   - `verified-date` 已有但 `<!-- VERIFIED -->` 缺失
   - `<!-- VERIFIED -->` 存在但 `verified-date` 为 null
5. **写入**（按顺序，原子语义）：
   - Edit frontmatter：`verified-date: <date '+%Y-%m-%dT%H:%M:%S+08:00' 输出>`，置于 `completed-date` 与 `archived-date` 之间
   - Edit 详情正文：在 `<!-- APPROVED -->` 行之后、紧邻插入 `<!-- VERIFIED -->`（不空行间隔）
   - Edit `## 工作记录` 表格末尾追加：`| <YYYY-MM-DD> | 验证通过：<verify-summary> |`
6. 报告 `status: SUCCESS`，`files_modified: ["changes/chg-xxx.md"]`
   - 最终回答第一行字面是 `## artifact-writer 报告`，第一个字符为 `#`，标题前直接进入该行（无过渡句、无说明文字）

修改前：
```
- [x] T-902 测试任务二

<!-- APPROVED -->

## 实施详情
```

修改后：
```
- [x] T-902 测试任务二

<!-- APPROVED -->
<!-- VERIFIED -->

## 实施详情
```

注：verify 仅插入 V 阶段标志，不动 status（status 已由 update-status 推到 `completed`）。归档时由 archive-chg 推 `status: archived`。

### action=review

R 阶段对抗审计跑过后由主 session 调用，写入"双表示、单权威"的 R 阶段标志（与 `action=verify` 写 V 阶段标志完全同构，详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/artifact-writer-spec.md` §7.1）。这是“只记录审计、暂不归档”的例外路径；默认收尾请使用 `close-chg`（它一把梭折叠 VERIFIED + REVIEWED + 归档）：

- 机器权威：frontmatter `reviewed-date: <ISO 8601 datetime>`
- 人读 / hook 信号：`<!-- REVIEWED -->` HTML 注释（紧邻 `<!-- VERIFIED -->` 下一行）
- 一致性约束：两者必须同时存在或同时不存在，不一致即 `format-violation`

> **职责边界**：审计本身（派 review subagent、读报告、判断 findings 处置）是主 session 的编排活；本 agent 只落字——不跑审计、不做质量裁决、不派 agent。审计是否跑过由主 session 判定后经 `review-confirmed: true` 传入，agent 以此字段为唯一依据。

**硬前置**：
- `review-confirmed` 必须为布尔 `true`；缺失 → `missing-fields`，非 true → `format-violation`。审计状态以 prompt 显式 `review-confirmed: true` 为唯一依据。
- `review-source` 必填（`manual` 或所选 review agent 名）。
- `review-findings` 必填，写 P0/P1/P2/P3 计数 + 各自处置（HOTFIX / won't-fix finding / record-finding 的 wikilink）。**对每条「已修」的 finding，标注主 session 的修前复核方式**（如「CS-PROGRESS：主 session 读 session-start.js:614 确认」），让 REVIEWED 记录天然留下「修前复核发生过」的纸面证据。agent 不验证证据真伪，但报告中必须保留，方便审计与回看。

子流程：
1. Read `changes/chg-xxx.md`（target 解析失败 → `target-not-found`）
2. **前置校验**（任一失败即 `format-violation`，不写文件）：
   - 目标 CHG 必须已 verified：`verified-date` 为非 null 值 **AND** `<!-- VERIFIED -->` 已存在。缺其一即拒绝，提示「先验证再审计（派 update-chg action=verify 或 close-chg 写 VERIFIED 后再 review）」。
   - frontmatter `status` 必须等于 `completed`（审计与验证同在 `completed` 状态下进行）
3. **幂等检查**（已完整审计 → SUCCESS 幂等，不写文件）：
   - frontmatter `reviewed-date` 已有非 null 值 **AND** `<!-- REVIEWED -->` 已存在
   - 报告 `status: SUCCESS`，`reason: "already reviewed, no change"`，`files_modified: []`
4. **不一致检查**（任一失败即 `format-violation`，不写文件）：
   - `reviewed-date` 已有但 `<!-- REVIEWED -->` 缺失
   - `<!-- REVIEWED -->` 存在但 `reviewed-date` 为 null
5. **写入**（按顺序，原子语义）：
   - Edit frontmatter：`reviewed-date: <date '+%Y-%m-%dT%H:%M:%S+08:00' 输出>`，置于 `verified-date` 与 `archived-date` 之间
   - Edit 详情正文：在 `<!-- VERIFIED -->` 行之后、紧邻插入 `<!-- REVIEWED -->`（不空行间隔）
   - Edit 详情正文：append/更新 `## 审查记录` 段，写入 review-source 与 review-findings（无该段则在 `## 工作记录` 段之后新建 `## 审查记录` 段）
6. 报告 `status: SUCCESS`，`files_modified: ["changes/chg-xxx.md"]`
   - 最终回答第一行字面是 `## artifact-writer 报告`，第一个字符为 `#`，标题前直接进入该行（无过渡句、无说明文字）

修改前：
```
- [x] T-902 测试任务二

<!-- APPROVED -->
<!-- VERIFIED -->

## 实施详情
```

修改后：
```
- [x] T-902 测试任务二

<!-- APPROVED -->
<!-- VERIFIED -->
<!-- REVIEWED -->

## 实施详情
```

`## 审查记录` 段示例（写在 `## 工作记录` 之后）：
```
## 审查记录

| 日期 | 审计来源 | findings |
| --- | --- | --- |
| <YYYY-MM-DD> | <review-source> | <review-findings> |
```

注：review 仅插入 R 阶段标志 + 审查记录，不动 status（status 已由 update-status 推到 `completed`）。findings 的开 HOTFIX / record-finding 路由由主 session 在调用本 action 前完成，不在本 action 范围；归档时由 close-chg / archive-chg 推 `status: archived`。

## section 含义

| section | 对应文件位置 |
|---------|------------|
| tasks | changes/chg-xxx.md `## 任务清单` |
| implementation | changes/chg-xxx.md `## 实施详情` |
| work-record | changes/chg-xxx.md `## 工作记录` |
| research | changes/chg-xxx.md `## 关联调研` |

## 边界

- target 不存在 → `target-not-found`
- section 不在枚举内 → `format-violation`
- action 不在 `append` / `replace` / `update-status` / `approve` / `approve-and-start` / `verify` / `review` 枚举内 → `format-violation`（operation 已识别时归为字段值非法）
- action=update-status 但 section ≠ tasks → `format-violation`
- task-id 在 tasks 段中找不到 → `target-not-found`
- action=approve 但 `<!-- APPROVED -->` 已存在 → SUCCESS 幂等（reason: `already approved, no change`）
- action=approve 缺 `approval-confirmed` / `approval-source` / `approval-evidence` → `missing-fields`
- action=approve 的 prompt 同时要求开始执行 / `in-progress` / `[/]` → `format-violation`（应改用 `approve-and-start`）
- action=approve 但 `## 任务清单` 段缺失 → `format-violation`
- action=approve-and-start 但 `approval-confirmed` / `approval-source` / `approval-evidence` / `task-id` 缺失 → `missing-fields`
- action=approve-and-start 但 `approval-confirmed` 非 true → `format-violation`
- action=approve-and-start 但 task-id 当前为 `[x]` / `[-]` / `[!]` → `format-violation`
- target 文件存在但 frontmatter `chg-id` 与文件名不匹配 → `id-mismatch`
- action=verify 但 frontmatter `status` ≠ `completed` → `format-violation`
- action=verify 但缺 `<!-- APPROVED -->` → `format-violation`
- action=verify 但 `verified-date` 已有非 null 值 **AND** `<!-- VERIFIED -->` 已存在 → SUCCESS 幂等（reason: `already verified, no change`）
- action=verify 但 `verified-date` 与 `<!-- VERIFIED -->` 不一致（仅一者存在） → `format-violation`
- action=review 但 `review-confirmed` / `review-source` / `review-findings` 缺失 → `missing-fields`
- action=review 但 `review-confirmed` 非 true → `format-violation`
- action=review 但目标 CHG 未 verified（缺 `verified-date` 非 null 或缺 `<!-- VERIFIED -->`） → `format-violation`（提示先验证再审计）
- action=review 但 frontmatter `status` ≠ `completed` → `format-violation`
- action=review 但 `reviewed-date` 已有非 null 值 **AND** `<!-- REVIEWED -->` 已存在 → SUCCESS 幂等（reason: `already reviewed, no change`）
- action=review 但 `reviewed-date` 与 `<!-- REVIEWED -->` 不一致（仅一者存在） → `format-violation`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`
