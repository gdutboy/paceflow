# archive-chg 指令详细规范

> 关联 agent：`paceflow-artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `target`（必填，CHG-ID）
- `walkthrough-summary`（必填，一行总结，用于 walkthrough.md 索引行）

## 前置检查

1. 解析 target → 详情文件路径
2. 文件不存在 → `target-not-found`
3. v6: Read 详情文件 frontmatter，确认 `status` 当前为 `in-progress` 或 `completed`
   - 若 `status=archived` → 已归档，报告 `format-violation: already archived`
   - 若 `status=planned` 或 `cancelled` → 报告 `format-violation: cannot archive in current status`
4. v6: Read 详情文件 `## 任务清单` 段，确认所有任务都是 `[x]` 或 `[-]`
   - 若有 `[/]` 或 `[ ]` 任务 → 报告 `format-violation: tasks not done` + 列出未完成任务

## 操作步骤

1. **更新详情 frontmatter**：
   - Read changes/chg-xxx.md
   - Edit 改 `status` → `archived`
   - 添加 `archived-date: <ISO 8601 datetime>`
   - 若 `completed-date` 仍为 null（兜底场景）→ 填同一 ISO 8601 datetime
2. **task.md 索引行归档**（按"ARCHIVE 内容移动"两步 Edit）：
   - Read task.md
   - 找到 `- [/] [[chg-xxx]] ...` 行
   - Edit 1：从活跃区删除该行
   - Edit 2：在 `<!-- ARCHIVE -->` 下方插入 `- [x] [[chg-xxx]] ...`（状态字符改 `[x]`，其余原样保留）
3. **implementation_plan.md 索引行归档**：同 task.md
4. **walkthrough.md 添加完成索引行**：
   - Read walkthrough.md
   - 在"## 最近工作"表格活跃区追加：`| <YYYY-MM-DD> | [[chg-xxx]] <walkthrough-summary> | <CHG-ID> |`

## ARCHIVE 内容移动（详解）

归档 = **移动行内容到 ARCHIVE 下方，标记位置不变**。

```
当前文件状态：
  [活跃区内容]
  - [/] [[chg-A]] CHG A    <- 待归档行
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

  - [x] [[chg-A]] CHG A    <- 新归档（最上）
  [其他归档区内容]
```

### Edit 工具实现

**Edit 1**（活跃区删除原行）：
- `old_string`：完整索引行（含末尾换行）
  例：`- [/] [[chg-A]] <title> #change [tasks:: T-001~T-003]\n`
- `new_string`：空字符串

**Edit 2**（归档区紧贴标记下方插入）：
- `old_string`：`<!-- ARCHIVE -->\n`
- `new_string`：`<!-- ARCHIVE -->\n\n- [x] [[chg-A]] <title> #change [tasks:: T-001~T-003]\n`

注意：状态字符必须从 `[/]`（或 `[ ]`/`[!]`）改为 `[x]`，其余 wikilink / 标题 / 元数据原样保留。

## 边界

- 任务未全部完成（含 [/] 或 [ ]）→ `format-violation: tasks not done`
- frontmatter status 已是 archived → `format-violation: already archived`
- 详情文件不存在 → `target-not-found`
- ARCHIVE 标记缺失 → 报告并提示主 session 创建模板
- 索引行在 task.md 或 implementation_plan.md 中找不到 → `format-violation: index row not found`
