# update-chg 指令详细规范

> 关联 agent：`paceflow-artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `target`（必填，CHG-ID）
- `section`（action=approve / verify 时不必填；其他 action 必填，枚举：`tasks` | `implementation` | `work-record` | `research`）
- `action`（必填，枚举：`append` | `replace` | `update-status` | `approve` | `verify`）
- `content`（视 action 而定）
- `task-id` + `new-status`（action=update-status 时必填）
- `verify-summary`（action=verify 时可选，写入 `## 工作记录` 单元格）

## 操作步骤

> **报告标题强制**：所有 action（append / replace / update-status / approve / verify）完成后，报告标题字面使用 `## paceflow-artifact-writer 报告`（见 `agents/paceflow-artifact-writer.md` §报告格式与§你不要做的事 #9）。**禁止**改写为 `## 执行报告` / `## paceflow-artifact-writer 执行报告` / `## 强制报告格式` / `## 操作摘要` 等变体，**禁止**加任何副标题如 `（批量 update-status + frontmatter 联动）`。

### 通用前置

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

### action=approve

C 阶段批准后由主 session 调用，向详情文件插入 `<!-- APPROVED -->` 标记。

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

### action=verify

V 阶段验证通过后由主 session 调用，写入"双表示、单权威"的 V 阶段标志（详见 `${CLAUDE_PLUGIN_ROOT}/agents/references/artifact-writer-spec.md` §7）：
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
- action 不在 `append` / `replace` / `update-status` / `approve` / `verify` 枚举内 → `format-violation`
- action=update-status 但 section ≠ tasks → `format-violation`
- task-id 在 tasks 段中找不到 → `target-not-found`
- action=approve 但 `<!-- APPROVED -->` 已存在 → SUCCESS 幂等（reason: `already approved, no change`）
- action=approve 但 `## 任务清单` 段缺失 → `format-violation`
- target 文件存在但 frontmatter `chg-id` 与文件名不匹配 → `id-mismatch`
- action=verify 但 frontmatter `status` ≠ `completed` → `format-violation`
- action=verify 但缺 `<!-- APPROVED -->` → `format-violation`
- action=verify 但 `verified-date` 已有非 null 值 **AND** `<!-- VERIFIED -->` 已存在 → SUCCESS 幂等（reason: `already verified, no change`）
- action=verify 但 `verified-date` 与 `<!-- VERIFIED -->` 不一致（仅一者存在） → `format-violation`
