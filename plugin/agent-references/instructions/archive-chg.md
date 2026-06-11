# archive-chg 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## When To Use

用于已完成、已验证且已审计的 CHG/HOTFIX 仍停在活跃索引区时做归档或索引修复；也用于已取消（`status: cancelled`，全部任务 `[-]`）的 CHG/HOTFIX 做 index-only 取消归档。若主 session 刚完成验证，优先使用 `close-chg` 一次收口。

## Correct Prompt Example

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: archive-chg
target: CHG-YYYYMMDD-NN
walkthrough-summary: <完成摘要>
```

## 输入字段

- `target`（必填，CHG-ID）
- `walkthrough-summary`（必填，一行总结，用于 walkthrough.md 索引行）

## 前置检查

0. 用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 判断 base changes 目录；`MISSING` 时报告 `not-pace-project` 并停止，不写任何文件（base `changes/` 由项目初始化负责创建）。目录存在性以该 `test -d` 结果为准。
1. 解析 target → 详情文件路径
2. 文件不存在 → `target-not-found`
3. v6: Read 详情文件 frontmatter，确认 `status` 当前为 `completed`、`archived` 或 `cancelled`
   - 若 `status=archived` → 进入 index-only repair：保留详情 frontmatter 原样，只检查/修复 task.md 与 implementation_plan.md 归档位置，并补 walkthrough（若缺）
   - 若 `status=cancelled` → 进入 cancelled archive-only：保留详情 frontmatter 原样（跳过验证检查），校验所有任务均为 `[-]`，并把 `[-]` 索引行移动到 ARCHIVE 下方
   - 若 `status=planned` / `in-progress` → 报告 `format-violation: status not terminal`
4. v6: Read 详情文件 `## 任务清单` 段，确认所有任务都是 `[x]` 或 `[-]`
   - 若有 `[/]` 或 `[ ]` 任务 → 报告 `format-violation: tasks not done` + 列出未完成任务
   - 若 `status=cancelled` 但存在非 `[-]` 任务 → 报告 `format-violation: cancelled tasks not all skipped`
5. **v6 V 阶段强制验证**（`status=cancelled` 跳过此步骤；详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/artifact-writer-spec.md` §7 VERIFIED 标记规则）：
   - frontmatter `verified-date` 必须为非 null 值
   - 正文必须含 `<!-- VERIFIED -->` 标记
   - 任一缺失 → 报告 `format-violation: not verified`，提示主 session 在验证通过后派 `close-chg`，或先派 `update-chg action=verify`
   - 两者仅一者存在（不一致）→ 报告 `format-violation: verification state inconsistent`，提示派 `update-chg action=verify` 修复
6. **v6 R 阶段强制审计**（`status=cancelled` 跳过此步骤；详见 `${CLAUDE_PLUGIN_ROOT}/agent-references/artifact-writer-spec.md` §7.1 REVIEWED 标记规则）：
   - frontmatter `reviewed-date` 必须为非 null 值
   - 正文必须含 `<!-- REVIEWED -->` 标记
   - 任一缺失 → 报告 `format-violation: not reviewed`，提示主 session 编排对抗审计后派 `close-chg`，或先派 `update-chg action=review`
   - 两者仅一者存在（不一致）→ 报告 `format-violation: review state inconsistent`，提示派 `update-chg action=review` 修复

## 操作步骤

> **CRLF / stale-read / Edit 匹配失败处理**：修改 artifact 始终只用 `Edit` / `MultiEdit`。若 `Edit` 因换行符差异匹配失败，直接重试同一个 `Edit`；PreToolUse hook 会在 `Edit` / `MultiEdit` 前将 artifact 的 CRLF 机械归一化为 LF。若工具报 `File has been modified since read`，立即重新 `Read` 目标 artifact，基于最新内容重试；这通常是并发 session 改了索引快照（属并发改动）。

0. **根索引结构预检**：
   - Read `task.md` 与 `implementation_plan.md`
   - 若缺 `<!-- ARCHIVE -->`，但文件中存在目标 CHG/HOTFIX 活跃索引行：先在文件末尾补一个独占行 `<!-- ARCHIVE -->`
   - 若缺 `<!-- ARCHIVE -->` 且找不到目标索引行：报告 `format-violation: archive marker missing`
1. **更新详情 frontmatter**：
   - Read changes/chg-xxx.md
   - 若 status 已是 `archived`：保留详情 frontmatter 原样，继续索引 repair
   - 若 status 是 `cancelled`：保留详情 frontmatter 原样（含 `archived-date` / `verified-date` / `reviewed-date` 维持 null），继续索引归档
   - 否则 Edit 改 `status` → `archived`
   - 若 `archived-date: null`，填 `<ISO 8601 datetime>`
   - 若 `completed-date` 仍为 null（兜底场景）→ 填同一 ISO 8601 datetime
2. **task.md 索引行归档**（按"ARCHIVE 内容移动"两步 Edit）：
   - Read task.md
   - 找到 `- [x] [[chg-xxx]] ...` 行；若 status 是 `cancelled`，找到 `- [-] [[chg-xxx]] ...` 行
   - Edit 1：从活跃区删除该行
   - Edit 2：在 `<!-- ARCHIVE -->` 下方插入同一终态索引行（`[x]` 或 `[-]`，其余 wikilink / 标题 / 元数据原样保留）
3. **implementation_plan.md 索引行归档**：同 task.md
4. **walkthrough.md 添加完成索引行**：
   - Read walkthrough.md
   - `<stem>` 取目标详情文件名去掉 `.md` 后的完整 stem；wikilink 写 `[[<stem>|<纯ID小写>]]`——带 slug 文件如 `chg-20260610-06-activation-signal-tighten.md` 对应 `[[chg-20260610-06-activation-signal-tighten|chg-20260610-06]]`，旧无 slug 文件如 `chg-20260511-02.md` 对应 `[[chg-20260511-02]]`（stem 来源是文件名，与标题无关；与 `close-chg.md` §3 / `artifact-writer-spec.md` §5.3 同一规则）。
   - 从 `task.md` 或 `implementation_plan.md` 的目标索引行提取执行上下文（如 `[worktree:: smoke] [branch:: feature-x]`）；若存在，walkthrough 完成内容末尾必须保留同一组上下文。上下文只写 `[worktree:: ...] [branch:: ...]` 这类人读字段；session id、owner state、lock 信息留在 `.pace/`。
   - 若已有包含 `[[<stem>` 且关联变更列为 `<CHG-ID>` 的 walkthrough 行：不重复追加；若该行缺少索引行已有的执行上下文，则 Edit 该行补齐。
   - 在"## 最近工作"表头与分隔行的下一行**插入为第一条**（最新在顶，prepend）：`| <YYYY-MM-DD> | [[<stem>\|<纯ID小写>]] <walkthrough-summary> [worktree:: <name>] [branch:: <branch>] | <CHG-ID> |`——**表格内别名分隔符必须写 `\|` 转义**（裸 `|` 会切坏表格列）。没有上下文时省略 `[worktree:: ...] [branch:: ...]`；旧无 slug 文件 stem=纯ID，直接 `[[<stem>]]` 无别名无需转义。
   - 若 `## 最近工作` 下尚无表头，先写入表头 `| 日期 | 完成内容 | 关联变更 |` 与分隔行 `| --- | --- | --- |`，再把上面的表格行作为表头下第一条写入（见 `artifact-writer-spec.md` §5.3）。

## ARCHIVE 内容移动（详解）

归档 = **移动行内容到 ARCHIVE 下方，标记位置不变**。

```
当前文件状态：
  [活跃区内容]
  - [x] [[chg-A]] CHG A    <- 待归档行（cancelled 时为 [-]）
  - [ ] [[chg-B]] CHG B    <- 仍活跃（不动）

  <!-- ARCHIVE -->         <- 标记位置（不动）

  [归档区内容]
```

**Step 1**：从活跃区**删除**待归档行（Edit 1）：

```
  [活跃区内容]
  - [ ] [[chg-B]] CHG B    <- 保留，未受影响

  <!-- ARCHIVE -->

  [归档区内容]
```

**Step 2**：在 ARCHIVE 下方**插入**已改 `[x]` 的行（Edit 2，紧跟标记，最近归档置顶）：

```
  [活跃区内容]
  - [ ] [[chg-B]] CHG B

  <!-- ARCHIVE -->

  - [x] [[chg-A]] CHG A    <- 新归档（最上；cancelled 时为 [-]）
  [其他归档区内容]
```

### Edit 工具实现

**Edit 1**（活跃区删除原行）：
- `old_string`：完整索引行（含末尾换行）
  例：`- [x] [[chg-A]] <title> #change [tasks:: T-001~T-003]\n`
- `new_string`：空字符串

**Edit 2**（归档区紧贴标记下方插入）：
- `old_string`：`<!-- ARCHIVE -->\n`
- `new_string`：`<!-- ARCHIVE -->\n\n- [x] [[chg-A]] <title> #change [tasks:: T-001~T-003]\n`

注意：归档前活跃索引行必须已经是终态 checkbox：completed/archived 用 `[x]`，cancelled 用 `[-]`。归档只移动该行到 ARCHIVE 下方，其余 wikilink / 标题 / 元数据原样保留。

## 边界

- 任务未全部完成（含 [/] 或 [ ]）→ `format-violation: tasks not done`
- frontmatter status 不是 completed / archived / cancelled → `format-violation: status not terminal`
- frontmatter status 已是 archived → 走 index-only repair，报告中说明本次为索引修复（如 `reason: index checked/repaired`）
- frontmatter status 是 cancelled → 走 index-only 取消归档；跳过 verified-date / `<!-- VERIFIED -->` 检查，并保持 status 为 cancelled
- frontmatter status 是 cancelled 但任务不全是 `[-]` → `format-violation: cancelled tasks not all skipped`
- 非 cancelled 的 CHG/HOTFIX：frontmatter `verified-date` 为 null **AND** 正文缺 `<!-- VERIFIED -->` → `format-violation: not verified`（提示验证通过后派 `close-chg`，或先派 `update-chg action=verify`）
- 非 cancelled 的 CHG/HOTFIX：frontmatter `verified-date` 与正文 `<!-- VERIFIED -->` 不一致（仅一者存在） → `format-violation: verification state inconsistent`（提示派 `update-chg action=verify` 修复）
- 非 cancelled 的 CHG/HOTFIX：frontmatter `reviewed-date` 为 null **AND** 正文缺 `<!-- REVIEWED -->` → `format-violation: not reviewed`（提示编排审计后派 `close-chg`，或先派 `update-chg action=review`）
- 非 cancelled 的 CHG/HOTFIX：frontmatter `reviewed-date` 与正文 `<!-- REVIEWED -->` 不一致（仅一者存在） → `format-violation: review state inconsistent`（提示派 `update-chg action=review` 修复）
- 详情文件不存在 → `target-not-found`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`
- ARCHIVE 标记缺失但目标索引行仍在活跃区 → 先补 `<!-- ARCHIVE -->` 独占行再移动索引；缺标记且目标索引行也不存在 → `format-violation: archive marker missing`
- 索引行在 task.md 或 implementation_plan.md 中找不到 → `format-violation: index row not found`
