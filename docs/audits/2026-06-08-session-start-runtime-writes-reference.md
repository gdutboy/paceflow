# SessionStart 运行态写盘 Reference（重构前 characterization）

> **目的**：SessionStart 分层重构前，完整刻画当前 `plugin/hooks/session-start.js` 的所有运行态写盘行为。
> 重构原则是「**行为/时机/语义不变、结构解耦**」——把散落写盘集中成单一副作用步骤、注入层纯函数化。
> 重构后用本文档**逐条对比**验证每个写盘点的触发条件 / 目标 / 语义未变（行号会变、行为不变）。
>
> **采集时点**：2026-06-08，`session-start.js` 831 行（v6.4.0）。
> **边界**：只记 SessionStart 自身写盘；不含其它 hook（stop / pre-tool-use / pre-compact）的写盘。PreCompact 快照 schema 单列于 §4（因 compact 模式消费它）。

## 1. 关键常量

| 常量 | 值 | 说明 |
|---|---|---|
| `PACE_RUNTIME` | `getProjectRuntimeDir(cwd)` → 项目 `.pace/` | 运行态目录 |
| `COUNTER_FILE` | `.pace/stop-block-count` | **Stop gate 降级计数**（与 `stop.js` 耦合，重构必须保持语义） |
| `PRINT_ONLY` | `!!process.env.PACE_PRINT_ONLY` | helper 预览开关，置位时**跳过全部写盘** |
| `SESSION_OUTPUT_BUDGET_BYTES` | `46000` | 注入字节预算（非写盘，供参考） |

## 2. 写盘点清单（12 处）

> 「事件」列：startup = `eventType !== 'compact'`（startup/resume/clear）；compact = `eventType === 'compact'`；both = 无 eventType 守卫。
> 所有写盘点均额外受 `!PRINT_ONLY` 保护（直接或经父块）。

| ID | 当前行 | 触发条件 | 事件 | 操作 | 目标 | 语义 |
|----|--------|---------|------|------|------|------|
| **W1** | 148 | `paceSignal && !rootChoicePending` | startup | mkdir | `.pace/` | 创建运行态目录 |
| **W2** | 149 | 同 W1 | startup | writeFile `'0'` | `.pace/stop-block-count` | **重置 Stop 降级计数** |
| **W3** | 152 | 同 W1，遍历 `SESSION_SCOPED_FLAGS`（9 项） | startup | unlink | `.pace/{degraded,task-list-used,todowrite-used,archive-reminded,findings-reminded,impl-archive-reminded,cli-refresh-done,walkthrough-archive-reminded,findings-archive-reminded}` | 清会话级 flag |
| **W4** | 157 | 同 W1，遍历 `SESSION_SCOPED_FLAG_PREFIXES`（6 项前缀） | startup | unlink | `.pace/{archive-reminded-,status-mismatch-,verify-missing-,review-missing-,blocked-tasks-,post-continue-}*` | 清前缀匹配 flag |
| **W5** | 165 | 同 W1，非今日 findings-age | startup | unlink | `.pace/findings-age-*`（≠ 今日） | 清过期 findings-age flag |
| **W6** | 170 | 同 W1，经 `sweepStaleRuntimeOwners` | startup | unlink | `.pace/change-owners/*.json` + `.pace/reservations/*.json`（`state==='closed'` 或 mtime 超 `CHANGE_OWNER_TTL_MS`=30min） | 清 stale owner/reservation |
| **W7** | 181 | `compact` && 快照存在但非对象 | compact | unlink | `.pace/pre-compact-state.json` | 删非法快照 |
| **W8** | 205-206 | `compact` && 快照合法 && `blockCount>0` | compact | mkdir + writeFile | `.pace/stop-block-count` ← `blockCount` | **从快照恢复 Stop 降级计数** |
| **W9** | 257 | `compact` && 快照合法（消费后） | compact | unlink | `.pace/pre-compact-state.json` | 消费后删快照 |
| **W10** | 277 | `paceSignal && !rootChoicePending`，经 `ensureProjectInfra` | both | mkdir + writeFile | `.pace/.gitignore`（内容 `*\n`，仅缺失时）+ vault 项目目录（仅已配置或已存在 `changes/` 时 mkdir） | 创建基础设施 |
| **W11** | 303 | `paceSignal && paceSignal!=='artifact' && !v5 && !exists(artDir/task.md)`（282 行 `if (rootChoicePending && !task.md)` 的 **else-if**），经 `createTemplates` | both（**无 eventType 守卫**） | mkdir + writeFile | `artDir` + `changes/{,findings,corrections}` + 复制缺失的 6 个 `ARTIFACT_FILES` 模板 | 初始化 artifact 骨架；configError / v5-needsPrompt 时 throw |
| **W12** | 784 | `paceSignal` && 当日首次（`findings-age-<today>` 不存在） | both | writeFile `'1'` | `.pace/findings-age-<today>` | 标记今日已发过期提醒 |

**控制流要点（易记错，重构必须精确对照）**：
- W1–W6 在同一个 `if (!PRINT_ONLY && paceSignal && !rootChoicePending && eventType !== 'compact')` 块（147 行）内，**仅 startup**。
- W8 在 compact 快照恢复块内，与「注入快照恢复内容」**读写交缠在同一 if**（174–258）。
- W10（`ensureProjectInfra`）是独立 if（276），**both 模式**。
- W11（`createTemplates`）是 282 行 rootChoicePending 块的 else-if，**both 模式、无 eventType 守卫**（compact 也可能触发）。
- W12 在 findings 过期提醒块（757–787）内，**both 模式**。

## 3. PRINT_ONLY 守卫现状（7 处散落）

行 `147 / 181 / 203 / 257 / 276 / 302 / 784`。第 20 行注释靠「新增写盘必须同样加守卫」的人工纪律维持——CHG-08-01 R 审计曾抓到 2 处 unlink 漏守卫（P1）。
**重构目标**：12 个写盘点集中成单一「运行态副作用」步骤，`PRINT_ONLY` 改为该步骤入口一处短路，删除 7 处散落守卫。

## 4. PreCompact 快照 schema（`.pace/pre-compact-state.json`）

由 `pre-compact.js` 写入（155 行），由 `session-start.js` compact 分支消费（W7/W8/W9 + S4 注入恢复内容）。重构 compact 处理时，对快照的消费契约必须不变。

```jsonc
{
  "timestamp": "<ISO 8601>",                       // new Date().toISOString()
  "artifacts": {
    "task.md": {
      "pending": <int>, "done": <int>,             // countByStatus topLevelOnly
      "inProgress": ["- [/] 任务文本", ...]          // 进行中任务原始行
    },
    "implementation_plan.md": { "hasInProgress": <bool> }
  },
  "activeChanges": [                                // 仅 paceSignal==='artifact'
    { /* summarizeActiveChanges 全字段：id,category,status,pending,
         approved,verified,reviewed,path */
      "ownerDisposition": "<...>", "ownerWorktree": "<...>",
      "ownerBranch": "<...>", "ownerState": "<...>" }
  ],
  "runtime": {
    "degraded": <bool>,                            // .pace/degraded 存在
    "legacyTaskPanelUsed": <bool>,                 // task-list-used/todowrite-used 存在
    "blockCount": <int>                            // .pace/stop-block-count 读值
  },
  "findings": { "openCount": <int> },              // findings.md 活跃区 [ ] 计数
  "walkthrough": { "hasTodayEntry": <bool> },      // walkthrough.md 有今日行
  "nativePlans": ["<plan 绝对路径>", ...]            // 最近 native plans
}
```

**关键观察**：快照存的是**状态摘要**（计数 / bool / id 列表 / 进行中任务文本），**不存内容全文**（无 spec、无 walkthrough 正文、无 finding 详情）。compact 恢复时先注入这些摘要（S4），随后通用注入又实时读 artifact 全文——这是 G11（快照 activeChanges 与实时活跃 CHG 摘要重复）的来源。

## 5. 重构后验证清单

重构后逐条勾验（用本文件做 golden reference）：

- [ ] W1–W12 全部保留，触发条件等价（事件模式 startup/compact/both 不变）
- [ ] `COUNTER_FILE` 仍为 `.pace/stop-block-count`，W2 重置 `'0'` / W8 恢复 `blockCount` 语义不变（Stop gate 耦合不受影响）
- [ ] W3/W4/W5 清理的 flag 集合不变（与 `SESSION_SCOPED_FLAGS`/`_PREFIXES` 同源）
- [ ] W6 sweep TTL + closed 判据不变
- [ ] W10/W11 的 both 模式语义不变（compact 也会触发 createTemplates/ensureProjectInfra）
- [ ] PreCompact 快照消费契约（§4 schema）不变
- [ ] `PRINT_ONLY` 仍能跳过全部 12 个写盘点（集中后一处短路）
- [ ] 新增：注入层纯函数可单测（喂 fixture state → 断言分层输出）
