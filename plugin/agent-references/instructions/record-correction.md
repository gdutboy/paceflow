# record-correction 指令详细规范

> 关联 agent：`artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`

## 输入字段

- `trigger-quote`（必填，用户原话引用）
- `wrong-behavior`（必填，≥ 20 字符）
- `correct-behavior`（必填，≥ 20 字符）
- `trigger-scenario`（必填）
- `root-cause`（必填）
- `knowledge-link` 或 `project-scope: project-only`（必填二选一）

## title 派生规则

record-correction 输入字段无显式 `title`，但详情文件 `# Correction: <title>` 和索引行需要。从 `wrong-behavior` 派生：

- 取核心语义，30-40 字符
- 去除标点，保留实词
- 形如"X 导致 Y"或"未做 X"的精炼短语

**示例**：

| wrong-behavior | 派生的 title |
|---------------|------------|
| "起手设计 agent 时把所有规范都内嵌到 system prompt 导致 357 行..." | agent 设计内嵌规范导致 prompt 膨胀 |
| "任务标记 [x] 后即认为完成，未执行 G-9 清单的归档步骤" | 任务完成后未主动归档 |
| "thinking 中已识别异常但用其他证据合理化跳过验证" | 验证异常被合理化跳过 |

## knowledge-link 输入归一

用户简化输入与 frontmatter 双字段的转换规则：

| 用户输入 | frontmatter 输出 |
|---------|-----------------|
| `knowledge-link: project-only` | `knowledge-link: null` + `project-scope: "project-only"` |
| `knowledge-link: "[[some-note]]"` | `knowledge-link: "[[some-note]]"` + `project-scope: null` |
| `project-scope: project-only` | 同首例 |
| 缺二者 | `missing-fields` |
| 同时填且不一致 | 优先 `knowledge-link`，`project-scope: null` |

## 操作步骤

0. 前置检查：用 `test -d "$ARTIFACT_DIR/changes" && echo EXISTS || echo MISSING` 检查 `$ARTIFACT_DIR/changes` 目录必须已存在；`MISSING` → 报告 `not-pace-project`，禁止创建 base `changes/`，禁止写任何 artifact。禁止用 `ls "$ARTIFACT_DIR/changes"` 空输出判断目录不存在。
1. 派生 title（参考上方规则）
2. 归一化 knowledge-link / project-scope（参考上方规则）
3. 使用 prompt 中由 `reserve-artifact-id.js --operation record-correction` 或 hook deny 文案预留的 `reserved-id` 作为 correction-id（CORRECTION-YYYY-MM-DD-NN）。若 prompt 缺 `reserved-id` / `reserved-file-prefix`，报告 `hook-deny` 并让主 session 先预留后重派；不得自行扫描 `changes/corrections/` 分配同日序号
4. 生成 slug（基于派生的 title）
5. `mkdir -p changes/corrections/`（仅在 base `changes/` 已存在时）
6. Write `changes/corrections/correction-yyyy-mm-dd-nn-slug.md`（详情文件结构见下）
7. corrections.md 不存在 → Write 新建（用 spec §5.6.5 模板）
8. Read + Edit `corrections.md` 添加索引行（spec §5.5 模板）

## 详情文件结构

```markdown
---
[frontmatter, 见 spec §2.3，注意经过 knowledge-link 归一]
---

# Correction: <派生的 title>

## 错误行为

<wrong-behavior>

## 正确做法

<correct-behavior>

## 触发场景

<trigger-scenario>

## 根本原因

<root-cause>

## 关联知识

- [[<knowledge-link>]]（如适用）
- 或：仅本项目（project-only）
```

## 索引行

```
- [[correction-yyyy-mm-dd-nn-slug]] <派生的 title> [date:: YYYY-MM-DD] [knowledge:: [[note]] | project-only]
```

## 边界

- wrong-behavior < 20 字符 → `format-violation: wrong-behavior too short`
- correct-behavior < 20 字符 → `format-violation: correct-behavior too short`
- knowledge-link 和 project-scope 都缺 → `missing-fields`
- 派生 title 失败（wrong-behavior 全为标点/无实词）→ 报告 `format-violation: cannot derive title`
- v6 项目但 corrections.md 缺失 → 用 spec §5.6.5 模板 Write 新建（不算错误）
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`
