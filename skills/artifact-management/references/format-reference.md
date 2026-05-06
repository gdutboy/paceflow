# Artifact 格式参考

本文件是 `artifact-management` 的 v6 速查。完整 schema 以 `agents/references/artifact-writer-spec.md` 为准。

---

## 索引文件

### task.md

```markdown
# 项目任务追踪

## 活跃任务

- [/] [[chg-20260504-01]] hooks v6 改造 #change [tasks:: T-001~T-006]

<!-- ARCHIVE -->
```

### implementation_plan.md

```markdown
# 实施计划

## 变更索引

- [/] [[chg-20260504-01]] hooks v6 改造 #change [tasks:: T-001~T-006]

<!-- ARCHIVE -->
```

两者只存 wikilink 索引，不写 CHG 三级标题详情段。

### walkthrough.md

```markdown
# 工作记录

## 最近工作

| 日期 | 完成内容 | 关联变更 |
| --- | --- | --- |
| 2026-05-04 | [[chg-20260504-01]] hooks v6 改造验证通过 | CHG-20260504-01 |

<!-- ARCHIVE -->
```

### findings.md

```markdown
# 调研记录

## 摘要索引

- [ ] [[finding-2026-05-04-hook-schema|hook schema 校验缺口]] — schema violation 需要 PostToolUse 提醒 #finding [date:: 2026-05-04] [impact:: P1]

<!-- ARCHIVE -->
```

finding 详情写在 `changes/findings/<id>.md`。

### corrections.md

```markdown
# Corrections 记录

## 索引

- [[correction-2026-05-04-01-install-path]] 混淆 plugin install 与本地 install.js [date:: 2026-05-04] [knowledge:: project-only]

<!-- ARCHIVE -->
```

correction 详情写在 `changes/corrections/<id>.md`。

---

## CHG/HOTFIX 详情文件

位置：`changes/chg-yyyymmdd-nn.md` 或 `changes/hotfix-yyyymmdd-nn.md`。

```markdown
---
chg-id: CHG-YYYYMMDD-NN
status: planned
date: YYYY-MM-DD
type: change
parent-tasks: ["[[task]]"]
parent-impl: ["[[implementation_plan]]"]
related-finding: null
aliases: []
tags: []
schema-version: "6.0"
completed-date: null
verified-date: null
archived-date: null
---

# 标题

## 任务清单

- [ ] T-001 任务描述

<!-- APPROVED -->
<!-- VERIFIED -->

## 实施详情

**背景（Why）**：...

**范围（What）**：...

**技术决策（How）**：...

## 工作记录

| 日期 | 完成内容 |
| --- | --- |

## 关联调研
```

创建时不含 `APPROVED` / `VERIFIED`。批准和验证只能由 `artifact-writer update-chg` 或 `close-chg` 写入。

---

## 标记规则

| 标记 | 位置 | 写入操作 |
|------|------|----------|
| `<!-- ARCHIVE -->` | 索引文件分隔活跃区/归档区 | `archive-chg` 移动索引行 |
| `<!-- APPROVED -->` | `changes/<id>.md` 任务清单后 | `update-chg action=approve` 或 `approve-and-start` |
| `<!-- VERIFIED -->` | 紧邻 APPROVED 下一行 | `update-chg action=verify` 或 `close-chg` |

`verified-date` 与 `<!-- VERIFIED -->` 必须同时存在或同时不存在。

---

## 常见错误速查

| 错误格式 | 正确做法 |
|---------|----------|
| `task.md` 内写 CHG 三级标题详情 | 派 agent 写 `changes/<id>.md` |
| `implementation_plan.md` 内写旧式活跃详情区 | 只保留 wikilink 索引 |
| 主 session 直接写 `<!-- APPROVED -->` | 派 `update-chg action=approve` 或 `approve-and-start` |
| 主 session 直接写 `<!-- VERIFIED -->` / `verified-date` | 验证通过后派 `close-chg`，或派 `update-chg action=verify` |
| `findings.md` 写长详情 | 派 `record-finding` 写 `changes/findings/<id>.md` |
| `findings.md` 内的旧 correction 区 | v6 使用 `corrections.md` + `changes/corrections/` |
| 归档时上移 `<!-- ARCHIVE -->` 包住详情 | 派 `close-chg` 或 `archive-chg` 移动索引行并更新详情 frontmatter |
