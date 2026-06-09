# update-index 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## When To Use

对索引文件做**文件级结构维护**（区别于 `update-finding` 改单条 finding 的状态/正文）。当前支持 `action=reorder`：把索引文件**活跃区**的索引行按日期降序（最新在顶，新→旧）重排，并清理多余空行。

典型场景：prepend 规则（spec §5.4 / §5.5）确立后，迁移存量 `findings.md` / `corrections.md`，把历史索引行从旧→新翻转为新→旧；或修复手工编辑导致的乱序 / 多余空行。

这是一个 multi-action operation——当前只实现 `reorder`，后续可在同一 operation 下扩展其他索引维护 action（如 normalize），无需新增 operation。

## Correct Prompt Example

```text
artifact_dir: <hook 解析出的 artifact 目录>
operation: update-index
target: findings.md | corrections.md
action: reorder
```

## 输入字段

- `target`（必填，枚举：`findings.md` | `corrections.md`）：要维护的索引文件
- `action`（必填，枚举：`reorder`）：维护动作

## 操作步骤

0. 前置检查：`test -d "$ARTIFACT_DIR/changes"` → MISSING 报 `not-pace-project`，不写任何文件。
1. 解析 target → `$ARTIFACT_DIR/<target>`；文件不存在 → `target-not-found`。
2. Read 目标文件。
3. **定位活跃区**：文件开头到第一个 `<!-- ARCHIVE -->` 之间。无 ARCHIVE 标记 → `format-violation`（索引文件必须有双区结构）。ARCHIVE 标记及其下方（含 v5 历史区）一律不动。
4. **action=reorder**：
   - 收集活跃区内的索引行：`findings.md` 为 `- [<状态>] [[finding-...]]`；`corrections.md` 为 `- [[correction-...]]`。
   - 每行提取日期：优先 `[date:: YYYY-MM-DD]`，缺失时回落到 wikilink id 中的 `YYYY-MM-DD`。
   - 按日期**降序**重排（最新在顶）；同日期保持原相对顺序（稳定排序）。
   - 只对活跃区内**第一个到最后一个索引行之间的范围**操作：这些索引行按日期降序重排为连续单段（行间无空行）回填该范围；该范围**之前**的标题（`## ...`）/格式注释（`<!-- 格式：... -->`）/blockquote 原位不动，该范围**之后**到 `<!-- ARCHIVE -->` 之间的内容也不动。
   - 若索引行之间夹有非空的说明文字行（非索引、非空行），保守起见**不重排该文件**并报告 `format-violation`（索引段不纯，避免搬动正文）。
5. **幂等检查**：若活跃区索引行已是日期降序且彼此连续（行间无多余空行）→ SUCCESS 幂等（reason: `already ordered`），不写文件。清理索引行间多余空行是 reorder 的有意副作用——含空行的存量文件首次迁移必然写入，非幂等空转。
6. Edit 写回（只替换活跃区索引段，ARCHIVE 区及下方不动）。
7. 报告 SUCCESS，`files_modified` 列出实际改动的文件。

## 边界

- `target` 不在枚举（`findings.md` | `corrections.md`）→ `format-violation`
- `action` 不在枚举（`reorder`）→ `format-violation`
- target 文件不存在 → `target-not-found`
- 活跃区无 `<!-- ARCHIVE -->` 双区结构 → `format-violation`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`

> **只重排不改写**：update-index 是顺序 / 空行维护，**绝不修改任何索引行的文本内容**（状态 checkbox / 标题 / summary / date / impact / knowledge / wikilink 全部逐字保留），也不增删索引行——重排前后索引行集合必须完全相同，只是顺序变化。增删索引行走 `record-finding` / `record-correction` / `update-finding`。写回后自检：活跃区索引行数与重排前一致、每行原文都能在原文件找到。
