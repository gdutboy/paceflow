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

## 操作步骤（v6）

1. **更新详情 frontmatter**：
   - Read changes/chg-xxx.md
   - Edit 改 `status: in-progress` → `status: completed`
   - 添加 `completed-date: <ISO 8601 datetime>`
2. **task.md 索引行归档**：
   - Read task.md
   - 找到 `- [/] [[chg-xxx]] ...` 行
   - 改 `[/]` → `[x]`
   - 移到 ARCHIVE 下方（双步骤标记移动，见下）
3. **implementation_plan.md 索引行归档**：同 task.md
4. **walkthrough.md 添加完成索引行**：
   - Read walkthrough.md
   - 在"## 最近工作"表格活跃区追加：`| <YYYY-MM-DD> | [[chg-xxx]] <walkthrough-summary> | <CHG-ID> |`

## 操作步骤（v5）

1. 移动详情段落到 ARCHIVE 下方（双步骤 ARCHIVE 标记移动）
2. task.md / implementation_plan.md 索引行 `[/]→[x]`
3. walkthrough.md 添加完成索引行

## ARCHIVE 双步骤标记移动（详解）

归档 = **移动标记而非内容**：

```
当前文件状态：
  [活跃区内容]
  - [/] [[chg-xxx]] <- 待归档行
  ...
  [其他活跃内容]
  
  <!-- ARCHIVE -->         <- 当前 ARCHIVE 标记位置
  
  [归档区内容]
```

Step 1：在待归档内容**上方**插入新 `<!-- ARCHIVE -->`（同时把 [/] 改 [x]）：

```
  [活跃区内容]
  
  <!-- ARCHIVE -->         <- 新插入的标记
  
  - [x] [[chg-xxx]] <- 已改状态的行
  ...
  [原本是活跃但现在归档的内容]
  
  <!-- ARCHIVE -->         <- 旧标记（待删除）
  
  [更老的归档区内容]
```

Step 2：删除旧 `<!-- ARCHIVE -->`：

```
  [活跃区内容]
  
  <!-- ARCHIVE -->         <- 唯一标记
  
  - [x] [[chg-xxx]]
  ...
  [所有归档内容]
```

净效果：标记物理上从旧位置移到新位置，归档行无需移动文件位置。

## 边界

- 任务未全部完成（含 [/] 或 [ ]）→ `format-violation: tasks not done`
- frontmatter status 已是 archived → `format-violation: already archived`
- 详情文件不存在 → `target-not-found`
- ARCHIVE 标记缺失 → 报告并提示主 session 创建模板
- 索引行在 task.md 或 implementation_plan.md 中找不到 → `format-violation: index row not found`
