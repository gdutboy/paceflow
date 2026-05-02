# create-chg 指令详细规范

> 关联 agent：`paceflow-artifact-writer.md`
> 上层规范：`../artifact-writer-spec.md`（schema / wikilink / ARCHIVE 等通用规则）

## 输入字段

- `title`（必填）
- `tasks`（必填，至少 1 个，格式 `["T-NNN: desc", ...]`）
- `type`（默认 change，可选 hotfix / research）
- `related-finding`（可选，wikilink）
- `background` / `scope` / `technical-decision`（可选）

## 操作步骤

1. 计算 chg-id：基于今日 + 当日序号（扫 `changes/` 同日 `chg-*` 或 `hotfix-*` 文件最大序号 +1）
2. 生成 slug（参考 system prompt slug 规则）
3. v6: `mkdir -p changes/`
4. v6: Write `changes/chg-yyyymmdd-nn.md`（详情文件结构见下）
5. v6: Read + Edit `task.md` 添加索引行（活跃任务区，按时间倒序插入顶部）
6. v6: Read + Edit `implementation_plan.md` 添加索引行（变更索引区）
7. v5: Edit task.md / implementation_plan.md 添加索引行 + 详情段落（详情含 4 段）

## 详情文件结构（v6）

```markdown
---
[frontmatter, 见 spec §2.1]
---

# <title>

## 任务清单

- [ ] T-NNN <task description>
- [ ] T-NNN <task description>

<!-- APPROVED -->

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

## 索引行（v6）

```
- [ ] [[chg-yyyymmdd-nn]] <title> #change [tasks:: T-NNN~T-NNN]
```

刚创建的 CHG 默认状态 `[ ]`（planned），等待 C 阶段批准后才改 `[/]`。
