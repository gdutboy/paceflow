# PACEflow Hook 消息完整参考

> **版本**: v5.1.1 | **生成时间**: 2026-03-14 | **总消息数**: 89 条

PACEflow 所有 hook 输出给 AI 的消息清单。按 hook 分组，每组内按消息类型排序。

## 消息类型说明

| 类型 | 机制 | 效果 | 使用的 Hook |
|------|------|------|------------|
| **DENY** | `permissionDecision: "deny"` + stdout JSON | 阻止当前工具调用，AI 收到拒绝原因 | PreToolUse, TodoWrite Sync |
| **BLOCK** | `exit 2` + stderr | 阻止 AI 停止会话，stderr 内容反馈给 AI | Stop |
| **CONTEXT** | `additionalContext` + stdout JSON | 软提醒，AI 能看到但不阻止操作 | PreToolUse, PostToolUse, TodoWrite Sync, ConfigChange |
| **INJECT** | stdout 直接输出 | SessionStart 注入到 AI 上下文 | SessionStart |

---

## 1. PreToolUse (`pre-tool-use.js`)

匹配工具：`Write|Edit`

### DENY（9 条）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| D-1 | artifact 已迁移到 vault，但 Write/Edit 指向 CWD 中的 artifact 文件 | `artifact 文件已迁移到 Obsidian vault。请将 file_path 修改为：${correctPath}` | L66 |
| D-2 | Write 覆盖已有的受保护 artifact 文件（task/impl_plan/findings/walkthrough） | `禁止使用 Write 覆盖已有的 ${fileName}，请使用 Edit 工具进行修改。Write 会丢失全部历史内容。${skillRef}` | L83 |
| D-5 | Edit impl_plan 标记 CHG 为 `[x]` 但缺少 `### CHG-ID` 详情段落 | `不能将 ${missing} 标记为已完成 [x]：缺少详情段落。请先在 implementation_plan.md 添加详情记录具体变更内容，再标记索引为 [x]。` | L151 |
| D-6 | Edit impl_plan 添加新 `[ ]`/`[/]` 索引时缺少 `### CHG-ID` 详情段落 | `添加新变更索引 ${missing} 时必须同时写入详情段落。请在同一次 Edit 中包含索引和详情，或先添加详情再添加索引。` | L175 |
| D-7 | Edit impl_plan 检测到旧的 emoji/表格格式 | `implementation_plan.md 活跃区检测到旧的${format}，hook 无法识别。请先将内容迁移到新格式再编辑。` | L191 |
| D-8 | 写代码但检测到未桥接的原生计划文件（`.pace/current-native-plan`） | `检测到未桥接的原生计划文件：${nativePlan}。请先 Read 该文件，将计划内容桥接到 task.md + implementation_plan.md，然后删除 .pace/current-native-plan。` | L204 |
| D-9 | PACE 项目激活但写代码无活跃任务（强信号，5 个子场景） | 场景 A: `检测到 Superpowers 计划文件：${fileList}。请执行桥接...` | L232 |
|  |  | 场景 B: `检测到 Superpowers 信号但无计划文件。请先执行 P-A-C 流程。` | L237 |
|  |  | 场景 C: `task.md 中无进行中的活跃任务（全部已完成/跳过）。请先归档已完成任务，再定义新任务后写代码。` | L240 |
|  |  | 场景 D: `检测到 docs/plans/ 中有未同步的计划文件，请将计划中的任务同步到 task.md 后再写代码。` | L243 |
|  |  | 场景 E: `task.md 中无活跃任务。请先执行 P-A-C 流程定义任务后再写代码。` | L245 |
|  |  | 场景 F（task.md 不存在）: `task.md 不存在。请先创建 Artifact 文件。` | L247 |
| D-10 | Write 新文件将达到 PACE 激活阈值（第 3 个代码文件） | `即将写入第 ${futureCount} 个代码文件，达到 PACE 激活阈值。请先在 task.md 中定义任务，获取用户批准后再写代码。` | L262 |
| D-12 | 有活跃任务但未获 C 阶段批准（缺 `<!-- APPROVED -->` 或 `[/]` 任务） | `task.md 有待做任务但未获用户批准。请先执行 C 阶段（Check）：询问用户是否批准计划。⚠️ 请直接询问用户是否批准当前计划，而非反复尝试写代码。` | L293 |
| D-13 | 有活跃任务且已获批，但 impl_plan 无 `[/]` 进行中索引 | 场景 A（不存在）: `implementation_plan.md 不存在。请先在 A 阶段创建变更索引。` | L305 |
|  |  | 场景 B（无 [/]）: `implementation_plan.md 无进行中的变更索引（[/]）。请先将当前变更的索引状态从 [ ] 改为 [/]。` | L306 |

### CONTEXT（6 条）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| D-3 | Write 新建 artifact 文件时注入模板 | `新建 ${fileName}：请严格按照以下官方模板格式，保留双区结构和注释说明：\n\n${tmplContent}` | L105 |
| D-4 | Write 到 vault 中的 knowledge/ 或 thoughts/ 笔记 | knowledge/: `写入 knowledge/ 笔记，必须包含以下格式：YAML frontmatter 必填字段...` | L124 |
|  |  | thoughts/: `写入 thoughts/ 笔记，请包含 YAML frontmatter 和 ## 摘要 + ## 详情 结构。` | L127 |
| D-11 | 项目中已有 1-2 个代码文件，提醒建立 PACE | `提醒：这是项目中的第 ${count} 个代码文件，如果这是正式项目，建议先创建 PACE Artifact 文件再继续写代码。` | L275 |
| D-14 | 正常情况：写代码且有活跃任务，注入 task.md 内容 | `当前任务状态：\n${taskActiveContent}` | L316 |
| D-15 | Teammate 模式：所有 DENY 降级为 CONTEXT | `PACE 提醒（teammate 模式）：${reason}` | L27 |

---

## 2. PostToolUse (`post-tool-use.js`)

匹配工具：`Write|Edit`

### CONTEXT（19 条，合并为单条 `additionalContext` 输出）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| W-1 | ARCHIVE 格式检查失败（编辑 artifact 文件后） | `${archFmt}`（checkArchiveFormat 返回的诊断消息） | L57 |
| W-2 | task.md 活跃区有 N 个已完成项（首次提醒，warnOnce） | `task.md 活跃区有 ${doneCount} 个已完成项，请归档到 ARCHIVE 下方。${archiveOp}` | L63 |
| W-3 | 编辑 task.md + 有已完成项 → TodoWrite 同步 | `归档后请同步更新 TodoWrite（标记完成或清空）` | L70 |
| W-4 | 编辑 task.md + 有活跃任务无已完成项 → TodoWrite 同步 | `task.md 有 ${pendingCount} 个活跃任务，请用 TodoWrite 同步对应的 todo 项` | L73 |
| W-5 | 检测到 `<!-- APPROVED -->` 或 `<!-- VERIFIED -->` 被添加 | `检测到 ${marker} 被添加到 task.md，请确认此操作已获用户审核` | L83 |
| W-6 | impl_plan 标记 CHG `[x]`，但关联 finding 仍为 `[ ]` | `CHG 已完成但关联 finding 仍为 [ ]：${details}，请更新为 [x]` | L102 |
| W-7 | Stop 降级标记存在（`.pace/degraded`） | `Stop hook 已降级（连续阻止 3 次），请检查未通过的 PACE 检查项：${content}` | L47 |
| W-8 | impl_plan 活跃区有已完成变更详情未归档（首次提醒，warnOnce） | `implementation_plan.md 活跃区有 ${count} 个已完成变更详情未归档：${list}。${archiveOp}` | L117 |
| W-9 | 编辑 impl_plan 后索引已完成但缺详情 | `impl_plan 有已完成变更缺少详情段落：${display}。请补充详情记录具体变更内容。` | L128 |
| W-10 | findings.md 有未解决问题（⚠️）（首次提醒） | `findings.md 有 ${unresolved} 个未解决问题（⚠️），请检查是否需要处理` | L136 |
| W-11 | 编辑 findings.md 检测到新 Correction 写入 | `检测到新 Correction 写入 findings.md。请评估是否为跨项目通用经验：如果是，同步写入 knowledge/ 对应笔记并补 [knowledge:: 笔记名]；如果仅限本项目，补 [knowledge:: project-only]` | L142 |
| W-12 | findings.md 有 `[-]` 条目理由 < 10 字 | `findings [-] 条目理由不足: "${excerpt}" 请补充否定决策理由` | L152 |
| W-13 | findings.md 有"保持现状"条目 | `findings.md 有 ${keepCount} 条"保持现状"条目，请确认已记录否定理由（为什么不做）` | L159 |
| W-14 | findings.md 有 `[ ]` 索引缺详情段落 | `findings.md 有 [ ] 索引缺少详情段落：${display}。请在"## 未解决问题"下补充"### [日期] 标题"记录问题背景和修复方向` | L172 |
| W-15 | findings 活跃区有已解决详情段落未归档（首次提醒） | `findings 活跃区有 ${staleCount} 个已解决详情段落，请归档到 ARCHIVE 下方。${archiveOp}` | L186 |
| W-16 | walkthrough 活跃区详情 > 3 个 | `walkthrough 活跃区有 ${detailCount} 个详情段落（建议保留最近 3 个），请将旧详情归档到 ARCHIVE 下方。${archiveOp}` | L197 |
| W-17 | 无 task.md 但检测到 PACE 激活信号 | `检测到 PACE 激活信号（${paceSignal}）但 task.md 不存在，请先创建 Artifact 文件。` | L205 |
| W-18 | 无 task.md 但有 3+ 代码文件 | `检测到 ${codeCount} 个代码文件但 task.md 不存在。如果这是 PACE 任务，请先创建 Artifact 文件。` | L209 |

> **合并输出**：所有警告合并为单条 `PACE 提醒：${warnings.join('；')}`（W-19, L245）

---

## 3. SessionStart (`session-start.js`)

### INJECT — Compact 恢复（7 条）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| S-1 | compact + 快照存在 | `=== Compact 恢复（快照 ${timestamp}）===\n进行中任务:\n  ${taskList}\n待办任务: ${pending} 个\n⚠️ Stop hook 之前已降级（本次已重置计数）` | L42-51 |
| S-2 | compact + 未桥接原生计划 | `⚠️ 检测到 compact 前有未桥接的原生计划文件：\n${planList}\n请 Read 相关文件并桥接到 PACE artifacts。` | L54-59 |
| S-3 | compact + AI 记录的 native plan 路径 | `⚠️ 你之前创建了原生计划文件：${planPath}\n请 Read 该文件并桥接到 PACE artifacts。` | L67-68 |
| S-4 | compact + PACE 项目 → 格式快速参考 + **G-9 清单** | 格式参考 10 项 + G-9 完成检查 4 项（task 归档/impl_plan 详情归档/walkthrough 索引+详情/spec 同步） | L76-96 |
| S-5 | compact + findings 状态 | `findings 状态：${openCount} 个开放项` | L100 |
| S-6 | compact + walkthrough 无今日记录 | `⚠️ compact 前 walkthrough 无今日记录` | L103 |

### INJECT — Startup 正常启动（16 条）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| S-7 | 未桥接的原生计划文件 | `=== Native Plan 桥接提醒 ===\n检测到未桥接的原生计划文件：${planPath}\n请 Read 该文件并桥接到 PACE artifacts，完成后删除 .pace/current-native-plan。` | L118-120 |
| S-8 | 每个 artifact 文件的活跃区注入 | `=== ${file} ===\n${output}` （5 个 artifact 分别注入，含智能截断） | L152-273 |
| S-9 | artifact 存储在 vault 时注入目录路径 | `=== Artifact 目录 ===\n路径: ${artDir}/\n请使用此路径读写 artifact 文件。` | L279 |
| S-10 | impl_plan 使用 emoji 状态标记 | `implementation_plan.md 使用了 emoji 状态标记，hook 无法识别。正确格式：${implIndex}` | L293 |
| S-11 | impl_plan 使用表格格式 | `implementation_plan.md 使用了表格格式，hook 无法识别。正确格式：${implIndex}` | L296 |
| S-12 | artifact 文件有多个 ARCHIVE 标记 | `${file} 有 ${count} 个 ARCHIVE 标记（应只有 1 个），readActive 会截断到第一个标记处` | L301/308 |
| S-13 | 格式合规警告汇总 | `=== 格式合规警告 ===\n${warnings}\n${skillRef}` | L312-314 |
| S-14 | task.md 有 `[-]` 跳过的任务 | `=== 跨会话提醒 ===\ntask.md 有 ${count} 个跳过的任务（[-]），请检查是否已完成需更新为 [x]：\n${list}` | L332-334 |
| S-15 | Superpowers 计划文件存在但 task.md 无活跃任务 | `=== Superpowers 桥接提醒 ===\n检测到计划文件（${fileList}）但 task.md 无活跃任务。\n请在派 subagent 前执行桥接。` | L345-348 |
| S-16 | TodoWrite 同步：有活跃任务 | `=== TodoWrite 同步 ===\n⚠️ task.md 是任务权威来源。请用 TodoWrite 创建与 task.md 活跃任务对应的 todo 项。` | L358 |
| S-17 | TodoWrite 同步：有已完成项待归档 | `=== TodoWrite 同步 ===\ntask.md 活跃区有已完成/跳过任务待归档，无进行中任务。归档后再清空 TodoWrite。` | L360 |
| S-18 | TodoWrite 同步：无活跃任务 | `=== TodoWrite 同步 ===\ntask.md 无活跃任务。如 TodoWrite 仍有残留项，请清空。` | L362 |
| S-19 | findings 超过 14 天未流转 | `=== Findings 过期提醒 ===\n以下 findings 超过 14 天未流转：\n${list}` | L390-391 |
| S-20 | Git 状态注入 | `=== Git 状态 ===\n分支: ${branch}\n最近提交: ${lastCommit}` | L411 |
| S-21 | 相关讨论笔记（thoughts/ + knowledge/） | `=== 相关讨论 (thoughts/ + knowledge/) ===\n${noteList}` | L421-425 |

---

## 4. Stop (`stop.js`)

### BLOCK（24 条，合并为编号列表 + exit 2 stderr）

**前缀选择逻辑**（L250-256）：
- 含 `AskUserQuestion` 且无"请继续执行" → `PACE 检查未通过，以下问题需要用户决策：`
- 含"请继续执行" → `PACE 检查未通过，请继续执行任务并处理以下问题：`
- 其他 → `PACE 完成度检查未通过。请仅修复以下检查项，不要执行新任务：`

**递进式阻止**：
- 第 2 次：`[提示] 这是第 N 次阻止，请逐项处理上述问题后再结束会话。`（L243）
- 第 3 次：`[警告] 下次将降级为软提醒不再阻止，但问题仍需处理。`（L244）
- 第 4 次：降级，写入 `.pace/degraded`，exit 0 放行（L230-237）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| **任务状态检查** | | | |
| B-1 | 有待做任务未获 C 阶段批准 | `task.md 有 ${pending} 个未完成任务且未获审批（缺少 APPROVED 标记）。请用 AskUserQuestion 询问用户是否批准执行计划。` | L64 |
| B-2 | 所有剩余任务均为 `[!]` 阻塞 | `task.md 所有 ${pending} 个剩余任务均为 [!] 阻塞状态。请用 AskUserQuestion 询问用户如何处理阻塞项` | L67 |
| B-3 | 有未完成任务（E 阶段执行中） | `task.md 还有 ${pending} 个未完成任务（进度 ${done}/${total}），请继续执行。` | L70 |
| B-4 | 有 `[x]` 已完成但未验证（缺 `<!-- VERIFIED -->`） | `task.md 有 ${xCount} 个已完成任务但未验证，请先执行 V 阶段验证后添加 VERIFIED 标记。` | L79 |
| B-5 | 有已完成项已验证，提醒归档 | `task.md 活跃区有 ${done} 个已完成项已验证，请归档到 ARCHIVE 下方。` | L82 |
| B-6 | 有已完成项未归档（含 `[-]`） | `task.md 活跃区有 ${done} 个已完成项未归档。` | L86 |
| **ARCHIVE 格式检查** | | | |
| B-7 | ARCHIVE 格式异常 | `${archFmt}`（checkArchiveFormat 诊断消息） | L47-49 |
| **impl_plan 检查** | | | |
| B-8 | impl_plan 仍有 `[/]` 但任务全部完成 | `implementation_plan.md 仍有 [/] 进行中，但任务已全部完成。请将索引状态改为 [x] 完成。` | L92 |
| B-9 | impl_plan 有已完成变更缺详情段落 | `implementation_plan.md 有 ${count} 个已完成变更缺少详情段落：${display}，请补充"### CHG-..."记录。` | L102 |
| **findings 检查** | | | |
| B-10 | findings 有 `[ ]` 索引缺详情段落 | `findings.md 有 ${count} 个 [ ] 索引缺少详情段落：${display}，请补充` | L115 |
| B-11 | findings 有超过 14 天的开放项 | `findings.md 有 ${count} 个超过 14 天的开放项需要用户决策，请用 AskUserQuestion 询问处理方式` | L128 |
| B-12 | findings 活跃区有已解决详情段落未归档 | `findings 活跃区有 ${count} 个已解决详情段落未归档` | L139 |
| **walkthrough 检查** | | | |
| B-13 | 无今日工作记录 | `walkthrough.md 最近更新是 ${latest}，今天的工作尚未记录` 或 `walkthrough.md 活跃区无日期记录，请更新工作记录` | L162-164 |
| B-14 | 索引已更新但缺详情段落 | `walkthrough.md 索引已更新但缺少详情段落，请补充"## YYYY-MM-DD 摘要"记录具体变更内容` | L168 |
| B-15 | 活跃区详情 > 3 个 | `walkthrough 活跃区有 ${count} 个详情段落（建议保留最近 3 个），请将旧详情归档到 ARCHIVE 下方` | L173 |
| B-16 | walkthrough.md 不存在 | `walkthrough.md 不存在，缺少工作记录` | L176 |
| **Artifact 完整性** | | | |
| B-17 | 其他 artifact 存在但缺 task.md | `检测到 ${existing} 但缺少 task.md，Artifact 不完整。` | L181 |
| B-18 | 3+ 代码文件但无 artifact | `检测到 ${count} 个代码文件但无 Artifact 文件，请用 AskUserQuestion 询问用户是否需要启用 PACE 流程` | L191 |
| **AI 声称完成** | | | |
| B-19 | AI 回复含"完成/done/finished"但 task.md 还有活跃任务 | `AI 声称完成，但 task.md 还有 ${pending} 个活跃任务。请先完成或标记 [-] 跳过，再归档到 ARCHIVE 下方` | L214 |
| **降级** | | | |
| B-20 | 连续阻止 3 次 → 降级放行 | （无 stderr，写入 `.pace/degraded` 文件，exit 0） | L230-237 |
| **Teammate** | | | |
| B-24 | Teammate 模式 → 不产生 stderr，仅 log | （不阻止，仅日志记录） | L224 |

---

## 5. TodoWrite Sync (`todowrite-sync.js`)

匹配工具：`TodoWrite|TaskCreate|TaskUpdate`

### DENY（2 条）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| T-1 | Superpowers 计划文件存在但 task.md 无活跃任务 | `检测到 Superpowers 计划文件（${fileList}）但 task.md 无活跃任务。请先执行桥接：${steps}` | L62 |
| T-6 | Superpowers 计划文件存在但 task.md 不存在 | `检测到 Superpowers 计划文件（${fileList}）但 task.md 不存在。请先执行桥接：${steps}` | L97 |

### CONTEXT（6 条，合并为单条输出）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| T-2 | task.md 无活跃任务但正在创建 todo | `task.md 无活跃任务，但正在创建 TodoWrite 项。task.md 是任务权威来源，请确认是否需要先在 task.md 中添加任务。` | L69 |
| T-3 | task.md 有活跃任务 + 写入 todo | `task.md 是任务权威来源（${count} 个活跃），请确保 TodoWrite 项与 task.md 对齐。` | L74 |
| T-4 | 活跃区只有已完成项 | `task.md 活跃区有 ${count} 个已完成项待归档，无进行中任务。请先归档再操作 TodoWrite。` | L79 |
| T-5 | TodoWrite 数量与 task.md 活跃任务差异大 | `TodoWrite（${todoCount} 项）与 task.md 顶层活跃任务（${taskCount} 项）数量差异较大，请确认是否对齐。` | L86 |
| T-7 | task.md 不存在但创建 todo（非 Superpowers） | `task.md 不存在。如果这是 PACE 项目，请先创建 task.md 再使用 TodoWrite。` | L104 |

> **合并输出**：所有 hint 合并为 `TodoWrite 同步校验：${hints.join(' ')}`（T-8, L116）

---

## 6. ConfigChange (`config-guard.js`)

### CONTEXT（2 条）

| ID | 触发条件 | 消息 | 代码行 |
|----|---------|------|--------|
| C-1 | 检测到 `disableAllHooks=true` | `⚠️ 严重警告：检测到 disableAllHooks=true，这会导致 PACE 保护完全失效。如需临时禁用单个项目，请使用 .pace/disabled 标记而非禁用全部 hooks。请立即撤回此配置变更。` | L32 |
| C-2 | 检测到可能删除 PACE hook 配置 | `检测到可能删除 PACE hook 配置，请确认这是有意操作。删除后 PACE 保护将部分失效。` | L48 |

---

## 7. PreCompact (`pre-compact.js`)

**无输出消息**。仅采集运行时快照写入 `.pace/pre-compact-state.json`，供 SessionStart compact 恢复时读取。

---

## 消息统计

| Hook | DENY | BLOCK | CONTEXT | INJECT | 总计 |
|------|------|-------|---------|--------|------|
| PreToolUse | 9 | — | 6 | — | **15** |
| PostToolUse | — | — | 19 | — | **19** |
| SessionStart | — | — | — | 21 | **21** |
| Stop | — | 24 | — | — | **24** |
| TodoWrite Sync | 2 | — | 6 | — | **8** |
| ConfigChange | — | — | 2 | — | **2** |
| PreCompact | — | — | — | — | **0** |
| **合计** | **11** | **24** | **33** | **21** | **89** |

## 日志记录（`pace-hooks.log`）

Hook 仅记录**非常规事件**，常规放行不记录：

| 事件类型 | 记录的 Hook | 说明 |
|---------|-----------|------|
| `DENY_*` | PreToolUse | 所有 deny 操作（D-1~D-13） |
| `WARN` | PostToolUse | 所有 context 提醒（W-1~W-18） |
| `BLOCK` | Stop | 每次 exit 2 阻止 |
| `DOWNGRADE` | Stop | 降级放行 |
| `ERROR` | 所有 | try-catch 捕获的异常 |
| `CREATE_TEMPLATES` | SessionStart | 首次创建模板文件 |
| `HINT` | TodoWrite Sync | deny 或 context 提醒 |
| `CONFIG_WARN` | ConfigChange | 配置变更警告 |

---

## 消息质量审查（2026-03-14）

> **审查标准**：AI 收到消息后，能否在零额外上下文（compact 后、新会话）的情况下正确执行？需要猜测、推断、回忆 = 不合格。

### 审查统计（v2 修正，2026-03-14 16:54）

| | ✅ 合格 | ⚠️ 有歧义 | ❌ 不合格 | — 机制 | 合计 |
|---|---|---|---|---|---|
| PreToolUse | 9 | 6 | 0 | 0 | 15 |
| PostToolUse | 9 | 9 | 0 | 1 | 19 |
| Stop | 12 | 4 | 6 | 2 | 24 |
| SessionStart | 13 | 7 | 1 | 0 | 21 |
| TodoWrite | 2 | 5 | 0 | 1 | 8 |
| ConfigChange | 1 | 1 | 0 | 0 | 2 |
| PreCompact | 0 | 0 | 0 | 0 | 0 |
| **合计** | **46** | **32** | **7** | **4** | **89** |

> v2 修正：S-2/S-3 "桥接"无步骤 ✅→⚠️、S-12 双 ARCHIVE 标记没说修法 ✅→⚠️、T-4 "先归档"缺 archiveOp ✅→⚠️

### ❌ 不合格（8 条）— AI 大概率执行错误或遗漏

| ID | 消息摘要 | 缺陷 | 修复方向 |
|----|---------|------|---------|
| **B-4** | "请先执行 V 阶段验证后添加 VERIFIED" | 没定义"验证"=通过 Terminal/Browser 运行确认功能正确+无报错。AI 会直接加标记不验证 | 改为引用 `${FORMAT_SNIPPETS.verified}`（snippet 本身需改进，见下方） |
| **B-10** | "findings 有 [ ] 索引缺详情，请补充" | 没给格式、没给位置。对比 W-14 至少说了"在 ## 未解决问题下补充 ### [日期] 标题" | 追加位置+格式：`在 ## 未解决问题 下补充 ### [日期] 标题，记录问题背景和修复方向` |
| **B-12** | "findings 活跃区有 N 个已解决详情段落未归档" | 没给归档方法。对比 W-15/B-5/B-6 都有 `archiveOp` | 追加 `${FORMAT_SNIPPETS.archiveOp}` |
| **B-13** | "walkthrough 最近更新是 X，今天的工作尚未记录" | 完全没说"记录"包含索引行+详情段落两部分，没给任何格式 | 追加：`请创建索引行 + 详情段落。${FORMAT_SNIPPETS.walkthroughDetail}`（walkthroughDetail 自包含完整格式） |
| **B-14** | "walkthrough 索引已更新但缺少详情段落，请补充 ## YYYY-MM-DD 摘要" | 只给了标题格式。缺时间戳、T-NNN 级描述、验证结果。v5.1.0 以来两次遗漏的直接原因 | 替换为完整详情格式引用：`${FORMAT_SNIPPETS.walkthroughDetail}`（需新增 snippet） |
| **B-16** | "walkthrough.md 不存在，缺少工作记录" | 只说"缺少"，没说要创建，没给初始格式 | 追加："请创建 walkthrough.md 并记录今日工作（索引表+详情段落）" |
| **S-4#1** | G-9 第 1 项："task.md — 标 [x]/[-] + 添加 VERIFIED + 归档" | 说"添加 VERIFIED"但没说先要运行验证。AI 可能跳过验证直接加标记 | 改为引用 `${FORMAT_SNIPPETS.verified}`（与 B-4 统一，snippet 含验证定义） |
| **S-4#3** | G-9 第 3 项："walkthrough — 追加索引行 + 详情段落（## YYYY-MM-DD 开头，含具体变更内容）" | "含具体变更内容"太笼统，已确认导致两次遗漏 | 改为引用 walkthroughDetail snippet 或展开完整格式 |

### ⚠️ 有歧义（28 条）— 可操作但 AI 可能偏离

#### 缺位置信息（5 条）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **D-5** | impl_plan 详情"添加到 implementation_plan.md"没说位置 | 追加 "在 `## 活跃变更详情` 下方添加" |
| **D-6** | 同 D-5 | 同上 |
| **B-9** | 同 D-5（Stop 版） | 同上 |
| **W-9** | 同 D-5（PostToolUse 版） | 同上 |
| **B-15** | walkthrough 归档缺 archiveOp | 追加 `${FORMAT_SNIPPETS.archiveOp}` |

#### "请确认/请检查"模式 — 缺判断标准或操作方式（7 条）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **W-5** | "请确认此操作已获用户审核"——AI 怎么确认？ | 改为 "此标记需用户明确同意。如未获确认，请用 AskUserQuestion 询问" |
| **W-7** | "请检查未通过的 PACE 检查项"——检查后做什么？ | 追加 "请立即处理以下检查项，Stop 降级后不再阻止退出但问题未修复" |
| **W-10** | "请检查是否需要处理"——太被动 | 改为 "请逐条查看并决定处理方式，或用 AskUserQuestion 询问用户" |
| **W-13** | "请确认已记录否定理由"——确认方式不明 | 改为 "如果条目理由缺失或不足 10 字，请补充否定理由（为什么不做）" |
| **S-6** | "compact 前 walkthrough 无今日记录"——没说该做什么 | 追加 "请在完成当前任务后更新 walkthrough（索引+详情）" |
| **S-14** | "请检查是否已完成需更新为 [x]"——怎么检查？ | 改为 "请用 AskUserQuestion 询问用户这些跳过的任务是否需要重新开启或更新为 [x]" |
| **C-2** | "请确认这是有意操作"——确认方式不明 | 改为 "请用 AskUserQuestion 询问用户是否有意删除 PACE hook 配置" |

#### TodoWrite 同步规则不明（5 条）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **W-3** | "标记完成或清空"——判断标准不明 | 改为 "归档后如果无剩余活跃任务则清空 TodoWrite，有剩余则更新对应项状态" |
| **W-4** | "同步对应的 todo 项"——映射规则不明 | 改为 "为每个 task.md 活跃顶层任务创建或更新对应的 TodoWrite 项" |
| **T-2** | "请确认是否需要先在 task.md 中添加任务"——犹豫 | 改为 "请先在 task.md 中添加任务再使用 TodoWrite，task.md 是权威来源" |
| **T-3** | "请确保对齐"——对齐规则不明 | 同 W-4 |
| **T-5** | "数量差异较大，请确认是否对齐"——同上 | 同 W-4 |

#### Skill/外部引用依赖（3 条）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **D-8** | 桥接步骤依赖 skill 调用，直接操作不足 | 追加核心步骤：Read plan → Edit task.md 添加任务 + APPROVED → Edit impl_plan 添加 CHG 索引 → 删除 .pace/current-native-plan |
| **D-9F** | "参考 G-8"可能不在上下文 | 改用 `${FORMAT_SNIPPETS.skillRef}` 或直接列出步骤 |
| **S-7** | 同 D-8 | 同上 |

#### "桥接"无步骤 / 缺修复指引（3 条，v2 新增）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **S-2** | compact 中 native plan "请 Read 并桥接"无具体步骤 | 追加桥接三步：Read plan → Edit task.md 添加任务 + APPROVED → Edit impl_plan 添加 CHG 索引 |
| **S-3** | 同 S-2（AI 记录的 plan 版） | 同上 |
| **S-12** | 双 ARCHIVE 标记只说"可能丢失活跃内容"没说怎么修 | 追加 "请删除多余的标记，只保留活跃区与归档区之间的那个" |

#### TodoWrite 归档方法缺失（1 条，v2 新增）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **T-4** | "请先归档再操作 TodoWrite"没给归档方法 | 追加 `${FORMAT_SNIPPETS.archiveOp}` |

#### 格式/指引不完整（5 条）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **D-4** | knowledge frontmatter 缺 YAML 示例 | 收益低（CONTEXT 不阻止 + AI 有 YAML 先验知识），保持现状或降到 P3 最低 |
| **D-10** | 首次 PACE 项目缺完整创建指引 | 追加 "5 个 Artifact 文件会自动创建，请在 task.md 中定义任务" |
| **W-17** | "创建 Artifact 文件"未说明范围 | 改为 "创建 spec.md/task.md/implementation_plan.md/walkthrough.md/findings.md" |
| **W-18** | 同 W-17 | 同上 |
| **B-17** | task.md 只给了单行格式 | 改用 `${FORMAT_SNIPPETS.taskGroup}` 给完整结构 |

#### 操作不具体（3 条）

| ID | 缺陷 | 修复方向 |
|----|------|---------|
| **S-16** | "创建与 task.md 活跃任务对应的 todo 项"——映射规则不明 | 同 W-4 |
| **B-19** | "完成或标记 [-] 跳过"——跳过需附理由未提，且"归档到 ARCHIVE 下方"缺 archiveOp | 追加 "标记 [-] 时需在同行或 findings 中记录跳过理由"+ `${archiveOp}` |
| **T-7** | "如果这是 PACE 项目"犹豫式表达 | 改为 "task.md 不存在。请先创建 task.md 定义任务再使用 TodoWrite，或用 .pace/disabled 标记此项目不使用 PACE"（明确二选一） |

### FORMAT_SNIPPETS 需新增/改进

| Snippet | 现状 | 改进 |
|---------|------|------|
| **walkthroughFormat**（现有） | `'索引表+详情 ## YYYY-MM-DD CHG-ID 摘要，工作结束必须更新'` | ❌ 不是格式，是描述。重写为索引行格式：`\| YYYY-MM-DD \| 完成内容 \| CHG-ID \|` |
| **walkthroughDetail**（新增） | 不存在 | 新增详情段落格式：`## YYYY-MM-DD CHG-ID 摘要\n**T-NNN 任务标题**\n- 改动：\`file\`:\`line\`，改动意图\n- 验证：Terminal/Browser 运行结果（通过/失败+原因）` |
| **verified**（改进） | `'<!-- VERIFIED --> 放在 <!-- APPROVED --> 下方，V 阶段验证通过后添加'` | 追加验证定义："V 阶段验证 = 通过 Terminal 或 Browser 运行确认功能正确且无报错" |

### walkthroughDetail 全面替换清单

> 定义 snippet 后，以下 **7 处**必须统一引用 `${FORMAT_SNIPPETS.walkthroughDetail}`：

| # | 文件:行 | 消息 ID | 当前内容 | 替换方式 |
|---|--------|--------|---------|---------|
| 1 | `stop.js:162` | B-13 | `今天的工作尚未记录` | 追加 `。请创建索引行 + 详情段落。${walkthroughDetail}` |
| 2 | `stop.js:164` | B-13 变体 | `请更新工作记录` | 追加 `。${walkthroughDetail}` |
| 3 | `stop.js:168` | B-14 | `请补充 "## YYYY-MM-DD 摘要" 记录具体变更内容` | 替换为 `请补充详情段落。${walkthroughDetail}` |
| 4 | `stop.js:176` | B-16 | `walkthrough.md 不存在，缺少工作记录` | 追加 `。请创建 walkthrough.md 并记录今日工作。${walkthroughDetail}` |
| 5 | `session-start.js:84` | S-4 格式参考 | `walkthrough 格式：${walkthroughFormat}` | 改为 `walkthrough 详情：${walkthroughDetail}` |
| 6 | `session-start.js:92` | S-4#3 G-9 | 硬编码 `追加索引行 + 详情段落（## YYYY-MM-DD 开头，含具体变更内容）` | 替换为 `追加索引行 + 详情段落。${walkthroughDetail}` |
| 7 | `session-start.js:103` | S-6 | `⚠️ compact 前 walkthrough 无今日记录` | 追加 `，请在完成任务后更新。${walkthroughDetail}` |

**不需要替换的位置**（归档/截断/快照/文件名列举）：stop.js:173、post-tool-use.js:197、session-start.js:169-194、pre-compact.js:59-64、pre-tool-use.js:247、pace-utils.js:53（walkthroughFormat 定义本身需重写但不引用 walkthroughDetail）

### implDetail snippet 引用一致性检查

> `implDetail` 已存在且内容完整（4 段结构 + 三要素），但有两个问题需修复。

#### 问题 1：位置缺失 — 所有引用处都没说"在哪里添加"

**影响范围**：D-5、D-6、W-9、B-9（4 条消息，均已在 ⚠️ 列表中）

**修复方案**：在 `implDetail` snippet 本身追加位置信息，或在每条消息中追加。推荐改 snippet（一处改动覆盖全部）：

```js
// 当前
implDetail: '### CHG-ID 标题\n\n**背景（Why）**：...',

// 改为
implDetail: '在 ## 活跃变更详情 下方添加：\n### CHG-ID 标题\n\n**背景（Why）**：...',
```

#### 问题 2：S-4 compact 格式参考区未引用 implDetail

**影响位置**：

| # | 文件:行 | 当前内容 | 问题 | 修复方式 |
|---|--------|---------|------|---------|
| 1 | `session-start.js:87` | `impl_plan 详情：${implDetailRule}` | `implDetailRule` 只是规则描述（`'每个 [x] 索引必须有 ### CHG-ID 详情段落'`），不含格式 | 改为 `impl_plan 详情：${implDetail}` |
| 2 | `session-start.js:91` | 硬编码 `索引标 [x] + 详情段落归档到 ARCHIVE 下方` | G-9 第 2 项没引用 snippet，AI compact 后不知道详情格式 | 改为 `索引标 [x] + 详情段落归档（格式：${implDetail}）` |

#### 已正确引用的位置（无需修改）

| # | 文件:行 | 消息 ID | 引用方式 |
|---|--------|--------|---------|
| 1 | `pre-tool-use.js:151` | D-5 | `格式：${FORMAT_SNIPPETS.implDetail}` ✅ |
| 2 | `pre-tool-use.js:175` | D-6 | `详情格式：${FORMAT_SNIPPETS.implDetail}` ✅ |
| 3 | `pre-tool-use.js:191` | D-7 | `详情格式：${FORMAT_SNIPPETS.implDetail}` ✅ |
| 4 | `post-tool-use.js:128` | W-9 | `格式：${FORMAT_SNIPPETS.implDetail}` ✅ |
| 5 | `stop.js:102` | B-9 | `格式：${FORMAT_SNIPPETS.implDetail}` ✅ |

> **与 walkthrough 对比**：implDetail 有 PreToolUse 硬门控（D-5/D-6 DENY），即使消息不够完美也会被反复 DENY 直到 AI 补上详情。walkthrough 只有 Stop 软拦截，AI 可以在用户先发消息时完全绕过——这就是 walkthrough 问题更严重的原因。

### 跨 hook Snippet 一致性检查

#### taskEntry vs taskGroup 误用

`taskEntry`（`- [ ] T-NNN 任务标题`）适用于快速参考或添加单个任务。
`taskGroup`（含 CHG 分组标题 + APPROVED + 多任务）适用于**引导 AI 创建 task.md**。

以下 4 处要求 AI 创建 task.md，但只给了 `taskEntry`，AI 不知道需要 CHG 分组标题 + APPROVED 标记：

| # | 文件:行 | 消息 ID | 当前引用 | 应改为 |
|---|--------|--------|---------|--------|
| 1 | `post-tool-use.js:205` | W-17 | `${taskEntry}` | `${taskGroup}` |
| 2 | `post-tool-use.js:209` | W-18 | `${taskEntry}` | `${taskGroup}` |
| 3 | `pre-tool-use.js:262` | D-10 | `${taskEntry}` | `${taskGroup}` |
| 4 | `stop.js:181` | B-17 | `${taskEntry}` | `${taskGroup}` |

> `session-start.js:79` compact 格式参考区用 `taskEntry` 作速查合理，不需改。

#### archiveOp 使用不一致

PostToolUse **全部有** `archiveOp`（W-2/W-8/W-15/W-16），但 Stop 和其他 hook 有缺口：

| # | 文件:行 | 消息 ID | 缺失 | 修复 |
|---|--------|--------|------|------|
| 1 | `stop.js:139` | B-12 | 归档无方法 ❌ | 追加 `。${archiveOp}` |
| 2 | `stop.js:173` | B-15 | 归档无方法 ⚠️ | 追加 `。${archiveOp}` |
| 3 | `stop.js:214` | B-19 | 归档无方法 ⚠️ | 追加 `${archiveOp}` |
| 4 | `todowrite-sync.js:79` | T-4 | 归档无方法 ⚠️ | 追加 `。${archiveOp}` |

> S-4 G-9 摘要格式（session-start.js:90-91）依赖上方 L50 的 `archiveOp` 注入，不需在每行重复。

#### findingsDetail snippet 缺失（建议新增）

当前 findings 详情格式在 W-14 中内联硬编码，B-10 完全没有。建议提取为 snippet：

```js
findingsDetail: '在 ## 未解决问题 下添加：\n### [YYYY-MM-DD] 标题\n问题背景、影响范围、修复方向',
```

**引用点**：

| # | 文件:行 | 消息 ID | 当前 | 修复 |
|---|--------|--------|------|------|
| 1 | `stop.js:115` | B-10 | `请补充`（无格式 ❌） | 追加 `。${findingsDetail}` |
| 2 | `post-tool-use.js:172` | W-14 | 内联硬编码 | 替换为 `${findingsDetail}` |

> 优先级 P2（findings 详情结构简单，但统一 snippet 消除不一致）

### 修复优先级

| 优先级 | 范围 | 说明 |
|--------|------|------|
| **P0** | B-13, B-14, S-4#3, walkthroughDetail 新增 | walkthrough 全线偏弱，已确认导致 2 次遗漏 |
| **P0** | B-4, S-4#1, verified 改进 | 验证=运行确认，防止自签 |
| **P1** | B-10, B-12, B-16 | Stop 检查项缺格式/方法 |
| **P1** | implDetail snippet 追加位置 | 一处改动覆盖 D-5/D-6/B-9/W-9 四条 |
| **P1** | session-start.js:87, :91 | S-4 compact 格式参考区 implDetail 引用缺失 |
| **P1** | B-15 追加 archiveOp | 与 W-16 同一检查，Stop 版缺归档方法 |
| **P1** | W-17/W-18/D-10/B-17 taskEntry→taskGroup | 创建 task.md 场景应给完整结构而非单行 |
| **P2** | W-5, W-7, W-10, W-13, S-6, S-14, C-2 | "请确认/请检查"模式 |
| **P2** | W-3, W-4, T-2, T-3, T-4, T-5, S-16 | TodoWrite 映射规则 + 归档方法缺失 |
| **P2** | findingsDetail snippet 新增, B-10/W-14 统一引用 | findings 详情格式统一 |
| **P3** | D-4, D-8, D-9F, D-10, W-17, W-18, B-17, B-19, S-2, S-3, S-7, S-12, T-7 | 格式/指引补全 + 桥接步骤 + 修复指引 |

---

## 最终修复方案（综合三份审计）

> **综合来源**：(1) 本文档审查 (2) `Hook消息审计报告.md`（独立交叉审计）(3) `snippet-audit-report.md`（snippet 逐条审计）
>
> **交叉审计修正**：文档消息描述系统性省略了实际附带的 FORMAT_SNIPPETS 引用——部分 ⚠️ 评级可能偏低（如 B-8/B-11 实际已有 snippet），但不影响修复方案（修复方向仍然成立）。

### 一、FORMAT_SNIPPETS 变更（pace-utils.js，一处改全局生效）

#### P0：新增 + 重写

> **⚠️ 实施注意事项（最终验证发现）**：
> 1. **walkthroughDetail 去掉 `> **时间**:` 行**——同时修复 stop.js L149 `detailDates` 正则，增加 `## YYYY-MM-DD` 标题匹配（见下方 stop.js 额外变更），使新旧格式均可检测。不要为迁就正则保留冗余数据。
> 2. **G-9 清单行（session-start.js L89-93）必须从单引号改为反引号**——当前是 `'...'` 不支持 `${}` 模板插值，`${FORMAT_SNIPPETS.xxx}` 会原样输出为字面文本。L79-87 已用反引号，L89-93 是历史遗留不一致。

```js
// ❌ 现有 → 重写
verified: '<!-- VERIFIED --> 放在 <!-- APPROVED --> 下方。V 阶段验证 = 通过 Terminal 运行测试或 Browser 确认功能正确且无报错后添加此标记',

// ❌ 现有 → 重写为索引行格式
walkthroughFormat: '| YYYY-MM-DD | 完成内容摘要 | CHG-ID |',

// ❌ 不存在 → 新增（无需 **时间**: 行，stop.js 检测已同步修复）
walkthroughDetail: '## YYYY-MM-DD CHG-ID 摘要\n**T-NNN 任务标题**\n- 改动：`file`:`line`，改动意图\n- 验证：Terminal/Browser 运行结果（通过/失败+原因）',
```

#### P1：位置信息追加

```js
// ⚠️ 现有 → 追加位置前缀
implDetail: '在 ## 活跃变更详情 下方添加：\n### CHG-ID 标题\n\n**背景（Why）**：为什么做。\n**范围（What）**：~N 行，M 文件。\n**技术决策（How）**：方案选择及理由。\n\n**T-NNN 任务标题**：\n  - `file:line` — 当前行为 → 目标行为\n  - 验收：完成条件',
```

#### P2：新增 + 简化

```js
// ⚠️ 不存在 → 新增
findingsDetail: '在 ## 未解决问题 下添加：\n### [YYYY-MM-DD] 标题\n问题背景、影响范围、修复方向',

// ⚠️ implDetailRule 保留不动（compact 速查仍有用），但 session-start.js:87 引用端改用 implDetail
```

### 二、Hook 消息变更（按文件分组）

#### stop.js（10 处修改 + 2 处 snippet 自动覆盖）

| # | 行 | ID | 当前 | 改为 |
|---|---|---|------|------|
| 0 | L149 | — | `detailDates` 正则只匹配 `**时间**:` | → 增加 `## YYYY-MM-DD` 标题匹配：`[...matchAll(/**时间**/), ...matchAll(/^## (\d{4})-(\d{1,2})-(\d{1,2})/gm)]` |
| 1 | L79 | B-4 | `...${verified}` | snippet 本身已改进，引用端**无需改** |
| 2 | L102 | B-9 | `...格式：${implDetail}` | snippet 本身已追加位置，引用端**无需改** |
| 3 | L115 | B-10 | `...请补充` | → `...请补充。${FORMAT_SNIPPETS.findingsDetail}` |
| 4 | L139 | B-12 | `...未归档` | → `...未归档。${FORMAT_SNIPPETS.archiveOp}` |
| 5 | L162 | B-13 | `...今天的工作尚未记录` | → `...今天的工作尚未记录。请创建索引行 + 详情段落。${FORMAT_SNIPPETS.walkthroughDetail}` |
| 6 | L164 | B-13v | `...请更新工作记录` | → `...请更新工作记录。${FORMAT_SNIPPETS.walkthroughDetail}` |
| 7 | L168 | B-14 | `...请补充 "## YYYY-MM-DD 摘要" 记录具体变更内容` | → `...请补充详情段落。${FORMAT_SNIPPETS.walkthroughDetail}` |
| 8 | L173 | B-15 | `...请将旧详情归档到 ${ARCHIVE_MARKER} 下方` | → `...请将旧详情归档到 ${ARCHIVE_MARKER} 下方。${FORMAT_SNIPPETS.archiveOp}` |
| 9 | L176 | B-16 | `walkthrough.md 不存在，缺少工作记录` | → `walkthrough.md 不存在。请创建并记录今日工作。${FORMAT_SNIPPETS.walkthroughDetail}` |
| 10 | L181 | B-17 | `${FORMAT_SNIPPETS.taskEntry}` | → `${FORMAT_SNIPPETS.taskGroup}` |
| 11 | L214 | B-19 | `...再归档到 ARCHIVE 下方` | → `...再归档到 ARCHIVE 下方。标记 [-] 时需在同行或 findings 中记录跳过理由。${FORMAT_SNIPPETS.archiveOp}` |

#### session-start.js（8 处修改）

| # | 行 | ID | 当前 | 改为 |
|---|---|---|------|------|
| 1 | L58 | S-2 | `请 Read 相关文件并桥接到 PACE artifacts（task.md + implementation_plan.md）。` | → `请执行桥接：Read plan → Edit task.md 添加任务 + APPROVED → Edit implementation_plan.md 添加 CHG 索引。` |
| 2 | L68 | S-3 | `请 Read 该文件并桥接到 PACE artifacts。` | → `请执行桥接：Read plan → Edit task.md 添加任务 + APPROVED → Edit implementation_plan.md 添加 CHG 索引。` |
| 3 | L84 | S-4 | `walkthrough 格式：${FORMAT_SNIPPETS.walkthroughFormat}` | → `walkthrough 详情：${FORMAT_SNIPPETS.walkthroughDetail}` |
| 4 | L87 | S-4 | `impl_plan 详情：${FORMAT_SNIPPETS.implDetailRule}` | → `impl_plan 详情格式：${FORMAT_SNIPPETS.implDetail}` |
| 5 | L90 | S-4#1 | 硬编码 `已完成项标 [x]/[-] + 添加 <!-- VERIFIED --> + 归档`（**单引号**） | → 改为**反引号** + `已完成项标 [x]/[-] + ${FORMAT_SNIPPETS.verified} + 归档到 ARCHIVE 下方` |
| 6 | L91 | S-4#2 | 硬编码 `索引标 [x] + 详情段落归档到 ARCHIVE 下方`（**单引号**） | → 改为**反引号** + `索引标 [x] + 详情段落归档（格式：${FORMAT_SNIPPETS.implDetail}）` |
| 7 | L92 | S-4#3 | 硬编码 `追加索引行 + 详情段落（## YYYY-MM-DD 开头，含具体变更内容）`（**单引号**） | → 改为**反引号** + `追加索引行 + 详情段落。${FORMAT_SNIPPETS.walkthroughDetail}` |
| 8 | L103 | S-6 | `⚠️ compact 前 walkthrough 无今日记录` | → `⚠️ compact 前 walkthrough 无今日记录，请在完成任务后更新。${FORMAT_SNIPPETS.walkthroughDetail}` |

#### pre-tool-use.js（2 处修改）

| # | 行 | ID | 当前 | 改为 |
|---|---|---|------|------|
| 1 | L175 | D-6 | `请在同一次 Edit 中包含索引和详情，或先添加详情再添加索引。` | → `请先添加详情段落，再添加索引。`（删除不可行的"同一次 Edit"选项，AI 总是先尝试第一个选项导致撞墙两次） |
| 2 | L262 | D-10 | `${FORMAT_SNIPPETS.taskEntry}` | → `${FORMAT_SNIPPETS.taskGroup}` |

#### post-tool-use.js（4 处修改）

| # | 行 | ID | 当前 | 改为 |
|---|---|---|------|------|
| 1 | L83 | W-5 | `请确认此操作已获用户审核` | → `此标记需用户明确同意。如未获确认，请用 AskUserQuestion 询问` |
| 2 | L172 | W-14 | 内联硬编码 findings 格式 | → `${FORMAT_SNIPPETS.findingsDetail}` |
| 3 | L205 | W-17 | `${FORMAT_SNIPPETS.taskEntry}` | → `${FORMAT_SNIPPETS.taskGroup}` |
| 4 | L209 | W-18 | `${FORMAT_SNIPPETS.taskEntry}` | → `${FORMAT_SNIPPETS.taskGroup}` |

#### todowrite-sync.js（2 处修改）

| # | 行 | ID | 当前 | 改为 |
|---|---|---|------|------|
| 1 | L79 | T-4 | `请先归档再操作 TodoWrite。` | → `请先归档再操作 TodoWrite。${FORMAT_SNIPPETS.archiveOp}` |
| 2 | L104 | T-7 | `如果这是 PACE 项目，请先创建 task.md 再使用 TodoWrite。` | → `请先创建 task.md 定义任务再使用 TodoWrite，或用 .pace/disabled 标记此项目不使用 PACE。` |

### 三、修改统计

| 文件 | snippet 变更 | 消息变更 | 合计 |
|------|------------|---------|------|
| pace-utils.js | 4（verified 重写 + walkthroughFormat 重写 + walkthroughDetail 新增 + implDetail 追加位置）+ 2 P2（findingsDetail 新增 + findingsFormat 保留不动） | — | 6 |
| stop.js | — | 10（+ 2 snippet 自动覆盖） | 12 |
| session-start.js | — | 8 | 8 |
| pre-tool-use.js | — | 2 | 2 |
| post-tool-use.js | — | 4 | 4 |
| todowrite-sync.js | — | 2 | 2 |
| **合计** | **6** | **26 + 2 自动覆盖** | **34** |

### 四、不修改的项（有意保留）

| 项 | 理由 |
|----|------|
| `implDetailRule` snippet | 保留作 compact 速查规则描述，但引用端（S-4 L87）改用 `implDetail` |
| D-4 knowledge frontmatter | P3 最低优先，AI 有 YAML 先验知识，CONTEXT 不阻止 |
| B-8/B-11 | 独立审计指出文档漏记了源码已有的 snippet（`implIndex`/三选一选项），实际消息已合格，无需修改源码 |
| S-15 | 独立审计确认已有桥接三步，维持 ✅ 评级 |
| P2 "请确认/请检查"模式（W-7/W-10/W-13/S-14/C-2） | 修复方向已记录在 ⚠️ 列表中，优先级低于 P0/P1，本轮不修改 |
| P2 TodoWrite 映射规则（W-3/W-4/T-2/T-3/T-5/S-16） | 同上 |
| P3 桥接步骤补全（D-8/S-7 已有 skill 引用） | S-2/S-3 在 session-start 修复中已追加步骤，D-8/S-7 维持 skill 引用 |
