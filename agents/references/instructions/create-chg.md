# create-chg 指令详细规范

> 关联 agent：`paceflow-artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`（schema / wikilink / ARCHIVE 等通用规则）

## 输入字段

- `title`（必填）
- `tasks`（必填，至少 1 个，格式 `["T-NNN: desc", ...]`）
- `type`（默认 change，可选 hotfix / research）
- `related-finding`（可选，wikilink）
- `background` / `scope` / `technical-decision`（可选）

缺失必填字段时必须立即报告 `missing-fields`，且不得推断 / 兜底：
- 缺 `title` 或 `title` 为空 → `missing-fields: title`，禁止用 `background` / `scope` / task 描述派生标题
- 缺 `tasks` 或 `tasks` 为空 → `missing-fields: tasks`
- 任一必填字段缺失时，不分配 CHG-ID，不读取索引，不 Write / Edit 任何 artifact

## 操作步骤

> **报告标题强制**：最终输出的第一行必须字面是 `## paceflow-artifact-writer 报告`。禁止简化为 `## 报告`，禁止改写为 `## create-chg 报告` / `## 执行报告` / `## 操作摘要`，禁止在标题前添加任何说明文字。`report_title_strict` 会机械检查，标题不匹配即 FAIL。

0. 前置检查：先校验必填字段；缺字段 → `missing-fields` 且不写文件。再检查 `$ARTIFACT_DIR/changes` 目录必须已存在；不存在 → 报告 `not-pace-project`，禁止创建 base `changes/`，禁止写任何 artifact
1. 计算 chg-id（详见下方"CHG-ID 推算"段）
2. 写入前生成并自检详情文件 payload（frontmatter 顺序、任务清单、4 段结构）
3. Write `changes/chg-yyyymmdd-nn.md`（详情文件结构见下）
4. Read + Edit `task.md` 添加索引行（活跃任务区，按时间倒序插入顶部）
5. Read + Edit `implementation_plan.md` 添加索引行（变更索引区）
6. 基于 payload + Edit 成功 + hook 反馈做低成本验证；除非 hook 报告本次目标问题，不要再 Read 刚写好的详情文件或两个索引文件

资源约束：
- 不读 `walkthrough.md` / `findings.md` / `corrections.md`
- 不搜索 `~/.claude`
- 不为报告统计大小或行数运行 `wc` / `du`

## CHG-ID 推算（含冲突检测）

并发派多 agent 时可能撞 nn，需冲突检测（Claude Code Write 工具是覆盖语义，无 exclusive mode）：

1. `Bash: ls $ARTIFACT_DIR/changes/chg-YYYYMMDD-*.md $ARTIFACT_DIR/changes/hotfix-YYYYMMDD-*.md 2>/dev/null` 列出当日已有 ID
2. 提取最大 nn → next_nn = max + 1（无文件则 01）
3. **冲突检测**：如步骤 1 的列表中已包含目标文件名，则 next_nn += 1（最多 3 次）
4. 仍 CONFLICT → 报告 `file-conflict`，主 session 重新派遣

## 详情文件结构

```markdown
---
[frontmatter, 见 spec §2.1]
---

# <title>

## 任务清单

- [ ] T-NNN <task description>
- [ ] T-NNN <task description>

## 实施详情

**背景（Why）**：<background>

**范围（What）**：<scope>

**技术决策（How）**：<technical-decision>

**T-NNN <task title>**：
- 具体改动说明

## 工作记录

| 日期 | 完成内容 |
| --- | --- |

## 关联调研

- [[<related-finding>]] <关联说明>（如有）
```

## 索引行

```
- [ ] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-NNN~T-NNN]
```

刚创建的 CHG 默认状态 `[ ]`（planned），详情文件 **不包含** `<!-- APPROVED -->` 标记。

## 边界

- 缺 `title` 或 `title` 为空 → `missing-fields: title`，不得使用其他字段兜底
- 缺 `tasks` 或 `tasks` 为空 → `missing-fields: tasks`
- `$ARTIFACT_DIR/changes` 不存在 → `not-pace-project`

PACE 流程后续：
- C 阶段批准 → 主 session 调用 `update-chg action=approve` 添加 `<!-- APPROVED -->`
- 实施推进 → `update-chg action=update-status` 推动状态机（详见 update-chg 规范）
