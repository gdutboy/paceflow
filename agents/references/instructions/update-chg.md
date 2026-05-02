# update-chg 指令详细规范

> 关联 agent：`paceflow-artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `target`（必填，CHG-ID）
- `section`（action=approve 时不必填；其他 action 必填，枚举：`tasks` | `implementation` | `work-record` | `research`）
- `action`（必填，枚举：`append` | `replace` | `update-status` | `approve`）
- `content`（视 action 而定）
- `task-id` + `new-status`（action=update-status 时必填）

## 操作步骤

> **报告标题强制**：所有 action（append / replace / update-status / approve）完成后，报告标题字面使用 `## paceflow-artifact-writer 报告`（见 `agents/paceflow-artifact-writer.md` §报告格式与§你不要做的事 #9）。**禁止**改写为 `## 执行报告` / `## paceflow-artifact-writer 执行报告` / `## 强制报告格式` / `## 操作摘要` 等变体，**禁止**加任何副标题如 `（批量 update-status + frontmatter 联动）`。

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
2. 检查是否已含 `<!-- APPROVED -->` → 已有则报告 `already-approved`（幂等，不重复插入）
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
- action=update-status 但 section ≠ tasks → `format-violation`
- task-id 在 tasks 段中找不到 → `target-not-found`
- action=approve 但 `<!-- APPROVED -->` 已存在 → `already-approved`（幂等，非错误）
- action=approve 但 `## 任务清单` 段缺失 → `format-violation`
