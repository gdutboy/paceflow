# v6 CHG 详情模板

> 保留此文件名是为了兼容旧 skill 引用；v6 不再把变更详情写进 `implementation_plan.md`。真正的详情文件由 `paceflow-artifact-writer create-chg` 创建在 `changes/<id>.md`。

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

# 变更标题

## 任务清单

- [ ] T-001 任务标题（验收：可验证条件）

## 实施详情

**背景（Why）**：为什么需要这个变更。

**范围（What）**：影响哪些文件/模块。

**技术决策（How）**：选择的方案及理由。

## 工作记录

| 日期 | 完成内容 |
| --- | --- |

## 关联调研
```
