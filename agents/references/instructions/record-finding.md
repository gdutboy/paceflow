# record-finding 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `title`（必填）
- `summary`（必填，≤ 200 字符）
- `type`（必填，枚举：`research` | `observation` | `comparison` | `bug-report`）
- `impact`（必填，枚举：`P0` | `P1` | `P2` | `P3`）
- `body`（必填，Markdown 内容，含背景/发现/方案/调研来源）
- `related-changes`（可选，wikilink list）
- `merges`（可选，wikilink list，合并历史）
- `status`（默认 `open`，可选 `investigating` / `accepted` / `rejected` / `merged` / `blocked`）
- `rejection-reason`（status=rejected 时必填，≥ 10 字符）

`body` 是 opaque Markdown payload，必须原样写入详情文件：
- 不得摘要、截断、改写、重排、合并段落或删除重复内容
- 不得把正文中的 wikilink 当成 frontmatter 强约束引用
- 允许的唯一归一化是换行风格（CRLF/LF）；正文字符、段落顺序、代码块、表格、引用块必须保持
- 如果无法完整写入 body，不得报告 SUCCESS

## 操作步骤

0. 前置检查：用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 检查 `$ARTIFACT_DIR/changes` 目录必须已存在；`MISSING` → 报告 `not-pace-project`，禁止创建 base `changes/`，禁止写任何 artifact。禁止用 `ls "$ARTIFACT_DIR/changes"` 空输出判断目录不存在。
1. 生成 finding-id（FINDING-YYYY-MM-DD-slug，slug 参考 spec slug 规则）
2. `mkdir -p changes/findings/`（仅在 base `changes/` 已存在时）
3. Write `changes/findings/finding-yyyy-mm-dd-slug.md`（详情文件结构见下；`body` 必须使用输入原文）
4. Read + Edit `findings.md` 摘要索引添加索引行（spec §5.4 模板）

## 详情文件结构

```markdown
---
[frontmatter, 见 spec §2.2]
---

# <title>

[body 内容，按主 session 提供]
```

## 索引行

```
- [<checkbox>] [[finding-yyyy-mm-dd-slug|<title>]] — <summary> #finding [date:: YYYY-MM-DD] [impact:: P<N>] [<extra-meta>]
```

`<checkbox>` 按 status 映射（spec §4）：
- `open` → `[ ]`
- `investigating` → `[/]`
- `accepted` → `[x]`
- `rejected` / `merged` → `[-]`
- `blocked` → `[!]`

`<extra-meta>` 可选：
- `[change:: [[chg-id]]]`（status=accepted 时）
- `[merges:: [[finding-id]]]`（合并自）
- `[merged-into:: [[finding-id]]]`（被合并到）

## 边界

- summary > 200 字符 → `format-violation`
- body 缺失 → `missing-fields`
- body 被摘要 / 截断 / 改写 / 重排 → `format-violation`
- status=rejected 但缺 rejection-reason 或长度 < 10 → `missing-fields`
- merges 中 wikilink 指向不存在的 finding → 警告但不阻止（建议主 session 检查）
- related-changes 中 wikilink 指向不存在的 CHG → 警告但不阻止（建议主 session 检查）
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`

> **§边界 vs §8 通用验证规则关系**：本节是 lex specialis（特殊条款），优先级高于上层 `../artifact-writer-spec.md` §8 通用 wikilink 强校验。merges / related-changes 字段允许"warn but don't block"，其他字段仍按 §8 通用强校验。
