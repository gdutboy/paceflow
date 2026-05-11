# ticket01: PACEflow v6.0.27 全面审查报告

**审查时间**: 2026-05-07T23:23:52+08:00
**审查范围**: 42 文件（11 JS hook + 5 SKILL.md + 5 refs + 7 hook 模板 + 4 skill 模板 + 3 文档 + 3 测试 + 2 plugin 配置 + 2 本地工具）
**审查方法**: Phase 1 五维度并行审查（5 subagent）→ Phase 2 C/H 级路径追踪验证 → Phase 3 去重分级汇总

---

## 审查摘要

| Phase | 数据 |
|-------|------|
| Phase 1 原始发现 | 1C + 8H + 22W + 9I = 40 Total |
| Phase 2 验证结果 | 7 确认 / 2 部分正确 / 0 误报 |
| 误报率 | 0/9 (0%) |
| 综合健康度 | **7.5/10** |

### 各 Agent 健康度

| Agent | 审查目标 | 健康度 | 关键发现 |
|-------|---------|--------|---------|
| 1. 代码质量 | 核心 Hook（公共模块 + Write/Edit hook） | 8/10 | bashOutputRedirectTargets 不处理 2>/&>、displayDir 重复定义 |
| 2. 流程完整性 | 生命周期 Hook（SessionStart/Stop/PreCompact） | 7/10 | close-chg 缺少 complete-open-tasks 校验、verified-date 检测不一致 |
| 3. 一致性 | 辅助 Hook + Plugin + Agent 发布资产 | 7/10 | settings-hooks-excerpt.json 缺失 2 事件 |
| 4. Skill 模板 | 所有 Skill + 模板文件 | 8/10 | pace-knowledge SKILL.md 时间戳格式矛盾 |
| 5. 架构优化 | 测试 + 文档 + 整体架构 | 7.4/10 | 三份文档 Hook 数量不一致 |

---

## P0 必修（3 项）

### C-1: 三份文档 Hook 数量不一致

- **文件**: `README.md:52,145-162` / `CLAUDE.md:28-56` / `REFERENCE.md:81-93`
- **严重度**: Critical
- **验证**: ✅ 确认（实际 diff hooks.json vs 三文档）
- **描述**: 三份文档均声称 8 个 hook，实际 `hooks.json` 注册了 9 个事件类型（SessionStart / PreToolUse / PostToolUse / PostToolUseFailure / SubagentStop / PreCompact / ConfigChange / Stop / StopFailure），对应 10 个 hook 脚本（pace-utils.js 是公共模块不计入）。文档一致遗漏 `PostToolUseFailure` 和 `SubagentStop`。
- **影响**: 用户安装后的心理模型不完整，故障排查时可能忽略这两个 hook 的行为。
- **修复建议**: 三处文档统一更新为 10 个 hook 脚本/9 个事件，在 Hook 覆盖表补充 PostToolUseFailure 和 SubagentStop 的描述行。

### H-1: settings-hooks-excerpt.json 缺失 PostToolUseFailure 和 SubagentStop 事件

- **文件**: `config/settings-hooks-excerpt.json`
- **严重度**: High
- **验证**: ✅ 确认（逐事件对比 hooks.json vs excerpt）
- **描述**: hooks.json 注册了 9 个事件，但 settings-hooks-excerpt.json 只有 7 个，缺少 PostToolUseFailure（hooks.json L63-73）和 SubagentStop（hooks.json L74-84）。
- **影响**: 手动安装模式（`node install.js` 不带 `--plugin`）下，这两个 hook 不会写入 settings.json，对应功能完全失效。
- **修复建议**: 从 hooks.json 同步，补充两个事件配置。

### H-2: close-chg 缺少 complete-open-tasks 字段校验

- **文件**: `pre-tool-use.js:264-280`
- **严重度**: High
- **验证**: ✅ 确认（路径追踪 agentLifecyclePromptDenyReason → mentionsCloseChg 分支）
- **描述**: `agentLifecyclePromptDenyReason` 对 `close-chg` 操作只校验 `verification-confirmed`、`verify-summary`、`walkthrough-summary` 三个字段，不校验 `complete-open-tasks: true`。而 CLAUDE.md G-9 明确要求 close-chg 必须带 `complete-open-tasks: true`。
- **影响**: agent 可在未收口任务的情况下执行 close-chg，导致详情文件中 T-NNN 未收口到 `[x]`/`[-]`。
- **修复建议**: 在 mentionsCloseChg 分支的 missing 检查中添加 `if (!promptHasTrueField(text, 'complete-open-tasks')) missing.push('complete-open-tasks: true');`

---

## P1 建议（9 项）

### H-3: session-start.js compact 恢复 snap 为 null 时 TypeError

- **文件**: `session-start.js:110-112`
- **验证**: ⚠️ 部分正确（try-catch 已保护，正常路径不产生 null）
- **描述**: `snap.artifacts?.['task.md']?.inProgress` 使用了可选链，但如果快照文件内容恰好为 `null`（JSON.parse 合法输出），`snap.artifacts` 会抛出 TypeError。整个代码段在 try-catch 内，异常被静默捕获。
- **修复建议**: 在第 110 行后添加 `if (!snap || typeof snap !== 'object') return;`

### H-4: verified-date 检测逻辑在 pre-tool-use 和 post-tool-use 中不一致

- **文件**: `pre-tool-use.js:20-25` / `post-tool-use.js:87-88`
- **验证**: ✅ 确认（逐行 diff 两处正则）
- **差异表**:

| 对比维度 | pre-tool-use.js | post-tool-use.js |
|----------|----------------|-------------------|
| 正则 | `/^verified-date:[ \t]*(.*)$/m` | `/^verified-date:\s*(?!null\b).+/m` |
| 空白匹配 | `[ \t]*`（仅空格/Tab） | `\s*`（含 \r\v 等） |
| null 判定 | 捕获后 `.trim()` 比较 | 负向前瞻 `(?!null\b)` |

- **修复建议**: 提取为 `pace-utils.js` 的 `hasNonNullVerifiedDate()` 统一函数。

### H-5: stop.js else 分支内变量遮蔽

- **文件**: `stop.js:155`
- **验证**: ✅ 确认（实际 diff 两处声明）
- **描述**: else 分支内 `const paceSignal = isPaceProject(cwd)` 遮蔽了行 21 的外层 `paceSignal`。虽然结果相同（纯函数 + 同一 cwd），但降低代码可读性。
- **修复建议**: 删除第 155 行，复用外部 `paceSignal`。

### H-6: pace-knowledge SKILL.md 时间戳格式矛盾

- **文件**: `pace-knowledge/SKILL.md:35-36,82-83` / `hooks/templates/knowledge-note.md:6-7`
- **验证**: ✅ 确认（逐行对比）
- **描述**: SKILL.md 示例使用 `created: YYYY-MM-DD` / `updated: YYYY-MM-DD`（仅日期），模板使用 `created: YYYY-MM-DDTHH:mm:ss+08:00` / `updated: YYYY-MM-DDTHH:mm:ss+08:00`（完整 ISO 8601）。CLAUDE.md G-9 规定时间戳格式为 `YYYY-MM-DDTHH:mm:ss+08:00`。
- **修复建议**: 更新 SKILL.md 中两个模板示例的时间戳为完整格式。

### W-1: config-guard.js 正则遗漏 3 个脚本 + 引用不存在的 todowrite-sync

- **文件**: `config-guard.js:52`
- **描述**: 正则引用了 `todowrite-sync.js`（历史名称，已被 task-list-sync.js 替代），同时遗漏 `post-tool-use-failure.js`、`stop-failure.js`、`subagent-stop.js`。
- **修复建议**: 删除 `todowrite-sync`，补充三个缺失脚本名。

### W-2: verify.js EXPECTED_HOOKS 不完整

- **文件**: `verify.js:20-29`
- **描述**: EXPECTED_HOOKS 数组缺少 `post-tool-use-failure.js` 和 `subagent-stop.js`。
- **修复建议**: 补全两个脚本名。

### W-3: pre-tool-use.js displayDir 和 normalizeArtifactDirValue 重复定义

- **文件**: `pre-tool-use.js:140-153` / `pace-utils.js:116-118,240-249`
- **描述**: `displayDir` 在 pace-utils.js 已导出但 pre-tool-use.js 本地重新定义了完全相同的实现。`normalizeArtifactDirValue` 与 `pace-utils.js` 的 `normalizeArtifactRootChoice` 功能高度重叠。
- **修复建议**: 从 pace-utils 导入 `displayDir`，删除本地定义；评估 `normalizeArtifactRootChoice` 复用。

### W-4: pre-compact.js 快照 hook 携带持久化副作用

- **文件**: `pre-compact.js:100-102`
- **描述**: PreCompact hook 的职责是"compact 前收集状态快照"，但会向 `.pace/current-native-plan` 写入文件。这是持久化状态变更，不应在快照 hook 中发生。
- **修复建议**: 将此写入逻辑移至 session-start.js 的 compact 恢复路径。

### W-5: extractOpenKeys 使用 includes 做标题匹配可能误匹配子串

- **文件**: `pace-utils.js:719-724`
- **描述**: `extractOpenKeys` 提取 finding 标题后在 session-start.js 中用 `includes` 匹配。如果一个 finding 标题是另一个的子串（如"登录优化"与"登录优化二期"），可能触发错误的跳过或保留。
- **修复建议**: 改用精确字符串比较。

---

## P2 文档（3 项）

- **README.md:156**: "6 个索引模板" → 实际 `hooks/templates/` 有 7 个文件（6 个 artifact 索引 + 1 个 knowledge-note.md）
- **多文档 "v6-only" 声称**: 代码仍处理 v5 遗留检测和迁移提示分支。建议澄清为"v6 是唯一活跃格式，v5 遗留项目仅做检测和迁移提示"
- **spec.md 模板无 ARCHIVE 标记**: 与其他 5 个 ARTIFACT_FILES 模板不一致。建议添加注释说明 spec.md 为例外

---

## 验证矩阵

| 发现 | 验证方法 | 结论 |
|------|---------|------|
| C-1 文档数量不一致 | 实际 diff hooks.json vs 三文档 | ✅ 确认 |
| H-1 excerpt 缺失事件 | 逐事件对比 hooks.json vs excerpt | ✅ 确认 |
| H-2 complete-open-tasks 缺失 | 路径追踪 agentLifecyclePromptDenyReason | ✅ 确认 |
| H-3 snap null TypeError | 路径追踪 + try-catch 分析 | ⚠️ 部分正确（已保护） |
| H-4 verified-date 不一致 | 逐行 diff 两处正则 | ✅ 确认 |
| H-5 stop.js 变量遮蔽 | 实际 diff 两处声明 | ✅ 确认 |
| H-6 时间戳格式矛盾 | 逐行对比 SKILL.md vs 模板 | ✅ 确认 |
| H-7 COUNT_RE_PENDING 锚定 | 调用链追踪 stop.js→countByStatus | ⚠️ 部分正确（输入不含 code block） |
| H-8 bash 解析器无测试 | grep tests/ + 读 E2E 覆盖 | ✅ 确认 |

---

## 架构评估：P-A-C-E-V 保障矩阵

| 阶段 | Hook/Agent 保障 | 强度 |
|------|-----------------|------|
| **P**lan | PreToolUse deny 无活跃 CHG 时写代码；task-list-sync 校验任务一致性 | 强 (deny) |
| **A**rtifact | artifact-writer agent 统一写入；PostToolUse 校验 schema；PreToolUse 阻止主 session 直写 C/V 标记 | 强 (deny + agent 门控) |
| **C**heck | PreToolUse 检查 APPROVED 标记 + 批准确认字段 | 强 (deny) |
| **E**xecute | PostToolUse 归档提醒；PreToolUse 允许已批准的代码编辑 | 提醒 (additionalContext) |
| **V**erify | Stop 阻止未完成/未验证/未归档退出；SubagentStop 观察 artifact-writer 报告 | 强 (exit 2) |

---

## 修复优先级建议

| 优先级 | 数量 | 建议动作 |
|--------|------|---------|
| **P0 必修** | 3 | 本次变更修复（C-1 / H-1 / H-2） |
| **P1 建议** | 9 | 下次变更修复（H-3~H-6 / W-1~W-5） |
| **P2 文档** | 3 | 顺手修复 |
| **P3 延后** | 25 | I 级优化建议，派 record-finding 记录 |

---

## Hook I/O 协议合规（全部 PASS）

| Hook | 输出格式 | exit code |
|------|---------|-----------|
| pre-tool-use | `{hookSpecificOutput: {permissionDecision:"deny" \| additionalContext}}` | 0 |
| post-tool-use | `{hookSpecificOutput: {additionalContext}}` | 0 |
| session-start | 纯文本 stdout | 0 |
| stop | exit 2 + stderr 或 exit 0 | 2 或 0 |
| task-list-sync | `{hookSpecificOutput: {permissionDecision:"deny" \| additionalContext}}` | 0 |
| config-guard | `{hookSpecificOutput: {additionalContext}}` | 0 |
| pre-compact | 无 stdout（仅写文件） | 0 |
| stop-failure | 无 stdout（仅日志） | 0 |
| post-tool-use-failure | `{hookSpecificOutput: {additionalContext}}` | 0 |
| subagent-stop | `{hookSpecificOutput: {additionalContext}}` | 0 |

---

## 版本对齐验证（PASS）

| 位置 | 版本号 |
|------|--------|
| `pace-utils.js` PACE_VERSION | v6.0.27 |
| `plugin.json` version | 6.0.27 |
| `marketplace.json` version | 6.0.27 |
| 11 个 hook JS 语法检查 (node -c) | 全部通过 |

---

## 误报防御记录

本次审查严格执行了四大误报防御策略：
1. **模式匹配非路径追踪** → 所有逻辑错误发现均追踪到入口点
2. **缺设计意图上下文** → 所有 bug 报告前检查了 CLAUDE.md 开发约定和代码注释
3. **未实际 diff** → 所有"不一致"声称均逐行对比了两个文件
4. **严重度膨胀** → C 级仅 1 项（文档数量不一致），其余降级为 H/W

误报率 0%（0/9 C/H 发现被否定），说明审查纪律执行到位——但部分正确率 22%（2/9），提示 H-3 和 H-7 的初始分级偏严。

---

*审查依据: PACEflow v6.0.27 源码 + 42 文件动态 Glob 扫描*
*审查工具: 5-agent 并行审查 + Phase 2 路径追踪验证 + Phase 3 去重分级*
