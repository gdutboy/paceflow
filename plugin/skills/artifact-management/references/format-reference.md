# Artifact 格式参考

本文件是 `artifact-management` 的 v6 速查。完整 schema 以 `agent-references/artifact-writer-spec.md` 为准。

---

## Artifact root 文件

### spec.md

`spec.md` 是 artifact root 内的项目事实文件，记录项目目标、技术栈、依赖、配置、目录结构和编码约定。它由主 session 直接 `Edit` 维护，不由 `artifact-writer` 创建 CHG 生命周期记录；已有文件用 `Edit` 增量更新。

`spec.md` 不含 `<!-- ARCHIVE -->` / `<!-- APPROVED -->` / `<!-- VERIFIED -->` / `<!-- REVIEWED -->`，也不参与 `close-chg` / `archive-chg` 的索引归档。

### task.md

```markdown
# 项目任务追踪

## 活跃任务

- [/] [[chg-20260504-01-hooks-v6-rework|chg-20260504-01]] hooks v6 改造 #change [tasks:: T-001~T-006] [worktree:: main] [branch:: main]

<!-- ARCHIVE -->
```

（v7 起 `implementation_plan.md` 退役——task.md 是唯一 CHG 索引，存量文件由 migrate-v7 改写为 tombstone。）

task.md 只存 wikilink 索引，不写 CHG 三级标题详情段。

### walkthrough.md

```markdown
# 工作记录

## 最近工作

| 日期 | 完成内容 | 关联变更 |
| --- | --- | --- |
| 2026-05-04 | [[chg-20260504-01-hooks-v6-rework\|chg-20260504-01]] hooks v6 改造验证通过 [worktree:: main] [branch:: main] | CHG-20260504-01 |

<!-- ARCHIVE -->
```

已知 worktree/branch 上下文时，在完成内容中保留 `[worktree:: ...] [branch:: ...]`；如果 close-chg 时没有这些上下文，直接省略该标记（仅在上下文已知时填写真实值）。

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
status: planned
date: YYYY-MM-DD
change-set: null
change-set-seq: null
verified-date: null
reviewed-date: null
archived-date: null
parent-tasks: ["[[<artifact-dir-name>/task|task]]"]
schema-version: "7.0"
---

# 标题

## 任务清单

- [ ] T-001 任务描述

## 实施详情

**背景（Why）**：...

**范围（What）**：...

**技术决策（How）**：...

## 工作记录

| 日期 | 完成内容 |
| --- | --- |

## 关联调研
```

创建时不含 `APPROVED` / `VERIFIED`。批准只能由 `artifact-writer update-chg action=approve/approve-and-start` 写入，二者都必须带 `approval-confirmed/source/evidence`；验证主路径由 `close-chg` 写入，`update-chg action=verify` 只用于暂不归档。

---

## 标记规则

| 标记 | 位置 | 写入操作 |
|------|------|----------|
| `<!-- ARCHIVE -->` | 索引文件分隔活跃区/归档区 | `archive-chg` 移动索引行 |
| `<!-- APPROVED -->` | `changes/<id>.md` 任务清单后 | `update-chg action=approve` 或 `approve-and-start`（均需确认字段） |
| `<!-- VERIFIED -->` | 紧邻 APPROVED 下一行 | 主路径 `close-chg`；暂不归档时 `update-chg action=verify` |
| `<!-- REVIEWED -->` | 紧邻 VERIFIED 下一行 | 主路径 `close-chg`；暂不归档时 `update-chg action=review`（均需 `review-confirmed/source/findings`） |

`verified-date` 与 `<!-- VERIFIED -->` 必须同时存在或同时不存在；`reviewed-date` 与 `<!-- REVIEWED -->` 同理，且仅在已 verified 时出现。R 阶段审计是主 session 编排步骤，REVIEWED 只证审计跑过、不裁决质量（见 Skill(paceflow:pace-workflow) R 小节）。

---

## 常见错误速查

| 错误格式 | 正确做法 |
|---------|----------|
| `task.md` 内写 CHG 三级标题详情 | 派 agent 写 `changes/<id>.md` |
| 写 `implementation_plan.md`（v7 已退役） | 只写 task.md 单索引 |
| 主 session 直接写 `<!-- APPROVED -->` | 派 `update-chg action=approve` 或 `approve-and-start`，并带 `approval-confirmed/source/evidence` |
| 主 session 直接写 `<!-- VERIFIED -->` / `verified-date` | 验证通过后派 `close-chg complete-open-tasks:true`；暂不归档时才派 `update-chg action=verify` |
| `findings.md` 写长详情 | 派 `record-finding` 写 `changes/findings/<id>.md` |
| `findings.md` 内的旧 correction 区 | v6 使用 `corrections.md` + `changes/corrections/` |
| 归档时上移 `<!-- ARCHIVE -->` 包住详情 | 派 `close-chg` 或 `archive-chg` 移动索引行并更新详情 frontmatter |
