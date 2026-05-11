# update-chg 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `target`（必填，CHG-ID）
- `section`（action=approve / approve-and-start / verify 时不必填；其他 action 必填，枚举：`tasks` | `implementation` | `work-record` | `research`）
- `action`（必填，枚举：`append` | `replace` | `update-status` | `approve` | `approve-and-start` | `verify`）
- `content`（视 action 而定）
- `task-id` + `new-status`（action=update-status 时必填）
- `approval-confirmed: true` + `approval-source` + `approval-evidence`（action=approve / approve-and-start 时必填）
- `task-id`（action=approve-and-start 时必填）
- `verify-summary`（action=verify 时可选，写入 `## 工作记录` 单元格）

## 操作步骤

> **报告标题强制**：所有 action（append / replace / update-status / approve / approve-and-start / verify）完成后，报告标题字面使用 `## artifact-writer 报告`（见 `agents/artifact-writer.md` §报告格式与§你不要做的事 #9）。**禁止**改写为 `## 执行报告` / `## artifact-writer 执行报告` / `## 强制报告格式` / `## 操作摘要` 等变体，**禁止**加任何副标题如 `（批量 update-status + frontmatter 联动）`。
> **全局对话样式豁免**：最终报告不得继承主 session / CLAUDE.md 的时间戳、Insight 块、固定结尾语或任何前后缀。第一行必须直接是 `## artifact-writer 报告`。
> **错误码层级**：`operation=update-chg` 已识别时，非法 `action` 是字段值非法，必须报告 `format-violation`；禁止报告 `out-of-scope`。`out-of-scope` 仅用于未知 operation（如 `delete-chg`）。

### 通用前置

0. 用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 检查 `$ARTIFACT_DIR/changes` 目录必须已存在；`MISSING` → 报告 `not-pace-project`，禁止创建 base `changes/`，禁止写任何 artifact。禁止用 `ls "$ARTIFACT_DIR/changes"` 空输出判断目录不存在。
1. 解析 target → 路径：`changes/chg-yyyymmdd-nn.md` 或 `changes/hotfix-yyyymmdd-nn.md`
2. 文件不存在 → 报告 `target-not-found`

### action=append

Read + Edit changes/chg-xxx.md 对应 section 末尾追加 content

### action=replace

Read + Edit 整个 section 替换为 content

### action=update-status

- 仅适用于 `section=tasks`
- 子流程：
  1. Read changes/chg-xxx.md 找到 `- [<old>] T-NNN`
  2. Edit 改 `<old>` 为 `<new-status>`（参考 spec §4 状态映射）
  3. **frontmatter 联动**（每次 update-status 后必执行）：
     - Read `## 任务清单` 段，统计任务状态
     - 全部为 `[x]` 或 `[-]` → Edit frontmatter `status` → `completed`，并添加 `completed-date: <ISO 8601 datetime>`
     - 仍有 `[/]` 但 frontmatter `status: planned` → Edit frontmatter `status` → `in-progress`
     - 否则 frontmatter 不变
     - **datetime 格式强制**：`YYYY-MM-DDTHH:mm:ss+08:00`（含日期+时间+时区，如 `2026-05-03T03:05:13+08:00`），**禁止仅写 date** 如 `2026-05-03`。可用 `Bash: date -Iseconds` 或 `date '+%Y-%m-%dT%H:%M:%S+08:00'` 生成
  4. **根索引 checkbox 联动**（frontmatter status 变化时必执行）：
     - 若 step 3 改了 frontmatter `status`，按 spec §4 映射推算根索引 checkbox：
       - `planned` → `[ ]`
       - `in-progress` → `[/]`
       - `completed`（活跃区） → `[x]`
       - `cancelled` → `[-]`
     - Read + Edit `task.md` 找 `- [<old>] [[<chg-id>]]` → 改 `<old>` 为新 checkbox
     - Read + Edit `implementation_plan.md` 同上
     - 若 frontmatter status 未变（如多个 [x] 但仍有 [/]），跳过此步

连续执行的同一 CHG 不需要每完成一个 T-NNN 就派 `update-status [x]`。CHG 是连续执行、可验证、可关闭的最小变更单元；若主 session 正在同一执行流里继续完成剩余任务，应继续写代码/测试，最后验证通过后直接派 `close-chg complete-open-tasks: true`，由 close-chg 一次完成 open tasks 收口、completed、VERIFIED、归档和 walkthrough。`update-status [x]` 只用于暂停、阻塞、跳过、跨 session、长任务进度可见性，或最后任务暂不验证/暂不收尾时停在 completed。

### action=approve

C 阶段批准后由主 session 调用，向详情文件插入 `<!-- APPROVED -->` 标记。

**硬前置**：
- `approval-confirmed` 必须为布尔 `true`；缺失 → `missing-fields`，非 true → `format-violation`。禁止由 agent 自行推断用户已批准。
- `approval-source` 必填，推荐枚举：`user-directive` / `ask-user-question` / `accepted-plan` / `prior-approved-plan`。
- `approval-evidence` 必填，写一句用户原话或已确认方案摘要。agent 不验证证据真伪，但报告中必须保留，方便审计。
- `action=approve` 只能表示“已批准但暂不开始”。若 prompt 同时要求 `status: in-progress`、标记 `[/]` 或“开始执行”，必须报告 `format-violation`，提示改用 `action=approve-and-start`。

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

   注意：APPROVED 上下各保留一空行，**禁止紧贴**任务行（`- [ ] T-902\n<!-- APPROVED -->` 是错误格式）。

4. status 不变（保持 `planned` 直到第一个 `[/]` 由 update-status 推升 `in-progress`）

注：approve 仅插入标记。状态机推动由 update-status 自动联动，避免双重写入。

### action=approve-and-start

C 阶段用户已明确批准、并准备开始某个 T-NNN 时由主 session 调用。此 action 将 `approve` 与首次 `update-status` 合并，避免同一个 CHG 连续派两次 agent。

**硬前置**：
- `approval-confirmed` 必须为布尔 `true`；缺失 → `missing-fields`，非 true → `format-violation`。禁止由 agent 自行推断用户已批准。
- `approval-source` 必填，推荐枚举：`user-directive` / `ask-user-question` / `accepted-plan` / `prior-approved-plan`。
- `approval-evidence` 必填，写一句用户原话或已确认方案摘要。agent 不验证证据真伪，但报告中必须保留，方便审计。
- `task-id` 必填，指明要标记为 `[/]` 的 T-NNN。

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
   - Read + Edit `task.md` 和 `implementation_plan.md`，将对应索引 checkbox 改为 `[/]`
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
   - frontmatter `status` 必须等于 `completed`（其他状态不允许验证）
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
   - Edit `## 工作记录` 表格末尾追加：`| <YYYY-MM-DD> | 验证通过：<verify-summary 或 "无附加说明"> |`
6. 报告 `status: SUCCESS`，`files_modified: ["changes/chg-xxx.md"]`
   - 最终回答第一行必须直接是 `## artifact-writer 报告`
   - 禁止在报告前写任何过渡句或说明文字

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
- action 不在 `append` / `replace` / `update-status` / `approve` / `approve-and-start` / `verify` 枚举内 → `format-violation`（不是 `out-of-scope`）
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
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`
