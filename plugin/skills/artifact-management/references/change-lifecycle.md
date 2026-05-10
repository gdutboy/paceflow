# 变更 ID 生命周期

本文件是 PACEflow v6 的 CHG/HOTFIX 生命周期速查。完整操作步骤以 `agent-references/instructions/*.md` 为准。

---

## ID 格式

```text
CHG-YYYYMMDD-NN
HOTFIX-YYYYMMDD-NN
```

详情文件名为小写：

```text
changes/chg-yyyymmdd-nn.md
changes/hotfix-yyyymmdd-nn.md
```

ID 由 hook 在派 `artifact-writer create-chg` 时原子预留，并通过 additionalContext 注入 `reserved-id` / `reserved-file`；artifact writer 必须使用该预留编号，主 session 不自行写入文件。

`T-NNN` 是单个 CHG/HOTFIX 内的局部任务编号。不同 CHG 可以都从 `T-001` 开始；所有状态更新必须同时带 `target: CHG-...` 和 `task-id: T-...`，避免多 worktree / 多 CHG 并发时产生歧义。

---

## 生命周期

| 阶段 | detail status | 索引状态 | agent 操作 |
|------|---------------|----------|------------|
| A 创建 | `planned` | `[ ]` | `create-chg` |
| C 仅批准暂不开始 | `planned` | `[ ]` | `update-chg action=approve approval-confirmed=true approval-source=<source> approval-evidence=<evidence>` |
| E 开始 | `in-progress` | `[/]` | `update-chg section=tasks action=update-status new-status=[/]` |
| C+E 合并 | `in-progress` | `[/]` | `update-chg action=approve-and-start approval-confirmed=true approval-source=<source> approval-evidence=<evidence> task-id=T-NNN` |
| E 中间任务完成 | `in-progress` | `[/]` | `update-chg action=update-status new-status=[x]` |
| E 最后任务暂不验证 | `completed` | `[x]` | `update-chg action=update-status new-status=[x]` |
| V 只记录验证暂不归档 | `completed` + `verified-date` | `[x]` 活跃区 | `update-chg action=verify` |
| 归档 | `archived` | `[x]` ARCHIVE 下方 | `archive-chg` |
| 最后任务 V+归档合并 | `archived` | `[x]` ARCHIVE 下方 | `close-chg verification-confirmed=true complete-open-tasks=true` |
| 取消 | `cancelled` | `[-]` ARCHIVE 下方 | 按 agent 规范处理 |

---

## PACE 集成

| PACE 阶段 | 主 session 职责 | artifact writer 职责 |
|-----------|-----------------|----------------------|
| P | 分析需求、识别范围、形成任务拆分 | 无 |
| A | 组织 create-chg 输入 | 创建详情文件 + 根索引 |
| C | 确认用户是否已批准 | 写 `<!-- APPROVED -->`；若立即开始则用 `approve-and-start`。确认可来自直接执行指令、AskUserQuestion、已接受方案或已批准计划 |
| E | 修改代码、运行中维护进度请求 | 更新中间 T-NNN、frontmatter、根索引、工作记录 |
| V | 运行验证并阅读结果 | 主路径用 `close-chg complete-open-tasks=true` 合并最后任务收口、VERIFIED 与归档 |
| 归档 | 确认验证通过后派归档 | `close-chg` 更新详情 status、移动索引并写 walkthrough |

---

## 完成检查清单

结束一个 CHG/HOTFIX 前必须满足：

- [ ] 验证前不要派 `verify` / `close-chg`；验证必须先运行并读取结果
- [ ] `changes/<id>.md` 所有任务为 `[x]` 或 `[-]`（最后任务可由 `close-chg complete-open-tasks=true` 收口）
- [ ] frontmatter `status: completed`
- [ ] `completed-date` 非 null
- [ ] 已运行并阅读验证结果
- [ ] `verified-date` 非 null
- [ ] `<!-- VERIFIED -->` 存在且紧邻 `<!-- APPROVED -->`
- [ ] `walkthrough.md` 有当天索引行
- [ ] 已派 `close-chg`（或已验证后派 `archive-chg`），根索引不再留在活跃区

Stop hook 会阻止 completed 未 verified、verified 未归档、索引/详情不一致等状态。

---

## Finding / Correction 联动

- 源自 finding 的变更：`create-chg` 输入带 `related-finding`，agent 在详情中保留关联。
- 新 finding：派 `record-finding` 写 `changes/findings/<id>.md` 和 `findings.md` 摘要索引。
- 用户纠正：派 `record-correction` 写 `changes/corrections/<id>.md` 和 `corrections.md` 摘要索引。
- 跨项目通用经验：再用 `paceflow:pace-knowledge` 沉淀到 `knowledge/`。
