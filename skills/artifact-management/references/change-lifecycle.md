# 变更 ID 生命周期

本文件是 PACEflow v6 的 CHG/HOTFIX 生命周期速查。完整操作步骤以 `agents/references/instructions/*.md` 为准。

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

ID 由 `paceflow-artifact-writer create-chg` 扫描 `changes/` 后生成，主 session 不自行写入文件。

---

## 生命周期

| 阶段 | detail status | 索引状态 | agent 操作 |
|------|---------------|----------|------------|
| A 创建 | `planned` | `[ ]` | `create-chg` |
| C 批准 | `planned` | `[ ]` | `update-chg action=approve` |
| E 开始 | `in-progress` | `[/]` | `update-chg section=tasks action=update-status new-status=[/]` |
| E 完成 | `completed` | `[x]` | 所有任务 `[x]`/`[-]` 后由 update-status 联动 |
| V 验证 | `completed` + `verified-date` | `[x]` 活跃区 | `update-chg action=verify` |
| 归档 | `archived` | `[x]` ARCHIVE 下方 | `archive-chg` |
| 取消 | `cancelled` | `[-]` ARCHIVE 下方 | 按 agent 规范处理 |

---

## PACE 集成

| PACE 阶段 | 主 session 职责 | artifact writer 职责 |
|-----------|-----------------|----------------------|
| P | 分析需求、识别范围、形成任务拆分 | 无 |
| A | 组织 create-chg 输入 | 创建详情文件 + 根索引 |
| C | 询问用户是否批准 | 写 `<!-- APPROVED -->` |
| E | 修改代码、运行中维护进度请求 | 更新 T-NNN、frontmatter、根索引、工作记录 |
| V | 运行验证并阅读结果 | 写 `verified-date` + `<!-- VERIFIED -->` |
| 归档 | 确认验证通过后派归档 | 更新详情 status 并移动索引 |

---

## 完成检查清单

结束一个 CHG/HOTFIX 前必须满足：

- [ ] `changes/<id>.md` 所有任务为 `[x]` 或 `[-]`
- [ ] frontmatter `status: completed`
- [ ] `completed-date` 非 null
- [ ] 已运行并阅读验证结果
- [ ] `verified-date` 非 null
- [ ] `<!-- VERIFIED -->` 存在且紧邻 `<!-- APPROVED -->`
- [ ] `walkthrough.md` 有当天索引行
- [ ] 已派 `archive-chg`，根索引不再留在活跃区

Stop hook 会阻止 completed 未 verified、verified 未归档、索引/详情不一致等状态。

---

## Finding / Correction 联动

- 源自 finding 的变更：`create-chg` 输入带 `related-finding`，agent 在详情中保留关联。
- 新 finding：派 `record-finding` 写 `changes/findings/<id>.md` 和 `findings.md` 摘要索引。
- 用户纠正：派 `record-correction` 写 `changes/corrections/<id>.md` 和 `corrections.md` 摘要索引。
- 跨项目通用经验：再用 `paceflow:pace-knowledge` 沉淀到 `knowledge/`。
