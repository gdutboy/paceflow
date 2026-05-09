# ticket-audit-2026-05-09: PACEflow v6.0.35 全面审查

## 审查摘要

审查时间: 2026-05-09T01:45:48+08:00
审查范围: ~13,000 行（动态发现：10 hook 脚本 + 1 公共模块 + 7 模板 + 4 用户 Skill + 6 引用 + 4 子模板 + 3 内部审计 + 1 agent 定义 + 7 agent 指令 + 3 测试 + 14 文档）
证据基线: git HEAD `60b92a5` + 工作区 `docs/action-plan-2026-05-02.md` 修改 + 动态发现文件；文档仅作候选线索

Phase 1 原始发现: 1C + 8H + 多 W/I = 来自 5 agent 并行审查
Phase 2 验证结果: 3 确认 / 3 部分正确 / 2 误报
误报率: 2/8 C/H (25%)

确认发现统计: 0C_confirmed + 1H_confirmed + 多 W/I

---

## P0 必修

- [H-1] `plugin/hooks/session-start.js:527` — findings 过期天数计算存在时区偏差
  - **描述**：`Math.floor((today - new Date(dm[1])) / 86400000)` 中 `today` 是 `new Date()`（本地时间），`new Date(dm[1])` 解析 `YYYY-MM-DD` 为 UTC 午夜。在 UTC+8 时区，同一天的北京时间 07:00 对应 UTC 前日 23:00，`Math.floor` 会少算 1 天。
  - **触发条件**：用户在 UTC+8 凌晨（00:00-07:59）触发 SessionStart，且 findings 的 `date` 恰好在 14 天边界。
  - **建议修复**：统一使用 `todayISO()` 生成日期字符串比较，或使用 `Date.UTC(year, month-1, day)` 构造 UTC 日期后做天数差。

---

## P1 建议

### 代码质量

- [W-1] `plugin/hooks/post-tool-use.js:34,63-68` — PostToolUse 中 `bashCommand` 变量和 `isRuntimeConfigEdit` 的 Bash 分支为死代码（hooks.json matcher 仅 `Write|Edit|MultiEdit`，`toolName === 'Bash'` 永不为真）。建议清理或注明保留原因。
- [W-2] `plugin/hooks/stop.js:91` — `requiresWalkthrough = true` 在循环中无条件赋值后又被 `blocked`/`running` 分支 `continue` 跳过消费，语义正确但代码路径易误导。建议移到最后一个需设置的分支内或重命名变量。
- [W-3] `plugin/hooks/pre-tool-use.js:362-367` — `denyOrHint` 返回对象由调用方负责 stdout 写入，与 `hardDeny`（内部写入）风格不一致。建议统一为 `hardDeny` 风格。
- [W-4] `plugin/hooks/session-start.js:94` — stop-block-count 重置硬编码 `'0'` 而非复用 `setBlockCount` 统一函数，存在未来不同步风险。
- [W-5] `plugin/hooks/session-start.js:311-314` — walkthrough 截断隐式假设最新优先排列，oldest-first 排列会丢失最新数据。建议在模板注释中明确排序约定或显式排序后截断。
- [W-6] `plugin/hooks/session-start.js:342-352` — findings 详情匹配依赖 H3 标题与索引行严格一致，无差异时静默跳过。建议在日志中记录匹配失败的标题。
- [W-7] `plugin/hooks/pre-tool-use.js:1022-1025` — 非 Agent 路径 `createTemplates` 调用未持写锁（在 deny 路径上，实际不会与 Agent 并发，但缺显式守卫注释）。
- [W-8] `plugin/hooks/pre-tool-use.js:101-104` — `bashPathLooksArtifact` 最后兜底正则 `^(?:\.\/)?(?:task\.md|...)$` 和 `^(?:\.\/)?changes\/` 不验证 CWD 上下文。在实际中作为最后 fallback 风险极低，但可加注释说明。
- [W-9] `plugin/hooks/pace-utils.js:386` — `normalizeArtifactRootChoice` 不做路径大小写归一化，Windows 上 `C:\Users\...` vs `c:\users\...` 严格比较失败。建议 `toLowerCase` 后再比较路径。
- [W-10] `plugin/hooks/session-start.js:89` — compact 恢复路径不表达 `rootChoicePending` 阻塞原因（虽 PreCompact 在 rootChoicePending 时跳过，正常流程会重新提示，但 UX 上缺解释）。

### 工具链

- [W-11] `install.js:67-77` — `isSamePaceMatcher` 仅处理 `Write|Edit` → `Write|Edit|MultiEdit` 单向升级，未覆盖 `PostToolUseFailure` 事件类型判据。
- [W-12] `install.js:59` — `filesEqual` try-catch 吞掉"源文件不存在"错误，静默返回 false，降低安装失败可诊断性。

---

## P2 文档

- [W-D1] `plugin/skills/pace-workflow/SKILL.md:141` — `close-chg` 效果仅描述 `status: completed`，遗漏最终 `status: archived`（close-chg.md §4）。与 `change-lifecycle.md` 矛盾。
- [W-D2] `plugin/hooks/templates/findings.md:5` — 模板注释索引行格式缺 `#finding` 标签，与 `task.md`（有 `#change`）、`implementation_plan.md`（有 `#change`）不一致。
- [W-D3] `plugin/skills/artifact-management/SKILL.md:17-19` — "权威规范"路径未标注 `${CLAUDE_PLUGIN_ROOT}/` 前缀，AI 以 SKILL 所在目录为基准解析会失败。
- [W-D4] `docs/v6.0.0-design.md` — 标注"pre-implementation"且含 v5 双轨过渡等已废除设计，建议添加"历史文档"警告或合并最终决策到 `REFERENCE.md`。
- [W-D5] `plugin/hooks/pace-utils.js:566` — `getArtifactDir` 注释未提及 legacy v5 dir 优先级，与代码不一致。

---

## 部分正确 / 有意设计

- [N-1] `stop.js:192-195` — Teammate Stop 缺 additionalContext → I-6 已知限制，代码注释明确"Stop hook 不支持 additionalContext"。不修复。
- [N-2] `session-start.js:89` — compact 恢复缺 root choice pending → PreCompact 在 rootChoicePending 时完全跳过，恢复时走正常启动路径会重新提示。流程正确。不修复。

---

## 误报分析

- [FP-1] `pace-utils.js` ARTIFACT_WRITER_LOCK_TTL_MS 30min → 设计权衡：SubagentStop 和 PostToolUseFailure 双重释放锁；过期间隔可通过 `PACE_ARTIFACT_LOCK_TTL_MS` 环境变量覆盖；30min 是保守默认值。
- [FP-2] `session-start.js:58` callback 丢失 → `realStdoutWrite` 调用不传 callback，但 `process.nextTick(cb)` 在第 42/62 行分别处理了截断前后的回调。回调未丢失。
- [FP-3] `stop.js:146` COMPLETION_PHRASES 分词边界 → 中文无 `\b` 概念，当前设计宁可误报不可漏报，low-stakes（只产生 warning 不阻塞）。

---

## P3 延后（I 级优化建议）

- [I-1] `tests/test-hooks-e2e.js` — StopFailure 测试仅 1 个，建议增加"不产生 stdout"断言
- [I-2] `plugin/hooks/session-start.js:202-213` — native plan 检测在 startup/compact 路径重复，可提取公共函数
- [I-3] `tests/test-hooks-e2e.js` — 缺 artifact 写锁的真正并发多进程 E2E 测试
- [I-4] `plugin/hooks/task-list-sync.js:84` — `TODO_DRIFT_THRESHOLD` 硬编码为 3，建议环境变量化
- [I-5] `plugin/hooks/task-list-sync.js:63-64` — artifact 项目路径下 `formatBridgeHint` 预计算为死代码
- [I-6] `plugin/skills/artifact-management/templates/change-implementation_plan.md` — 旧重定向别名，无活跃引用
- [I-7] `internal/skills/audit/SKILL.md:80` — Phase 1 Agent 数量"5 个"硬编码
- [I-8] `plugin/hooks/session-start.js:285-293` — spec.md 截断使用中文字符串 `## 技术栈` 硬编码
- [I-9] `plugin/hooks/stop.js:190-231` — warning 输出逻辑的共享 `setBlockCount` 模式可提取
- [I-10] `plugin/hooks/pace-utils.js:944` — `padEnd(11)` 对齐宽度跨不同 hook 名不一致
- [I-11] `plugin/hooks/pre-tool-use.js:955` — `PASS_V6_NON_CODE` 日志不区分 toolName
- [I-12] `plugin/hooks/post-tool-use-failure.js:24` — `tool_name` 回退路径冗余

---

## 已知限制 / 有意设计记录

- [N-3] `README.md:90` "9 个 hook 脚本（8 类 hook 事件）"表述准确：10 个 .js 含 1 个公共工具 + 9 个 hook 脚本覆盖 8 类事件（PreToolUse 由 pre-tool-use.js 和 task-list-sync.js 双脚本服务）
- [N-4] `REFERENCE.md` 第 8 节"发布检查"8/8 项通过
- [N-5] `plugin/.claude-plugin/plugin.json:12` agents 字段正确声明 `./agents/artifact-writer.md`
- [N-6] Artifact 写锁生命周期完整（PreToolUse 获取 → SubagentStop/PostToolUseFailure 释放 → TTL 兜底）
- [N-7] SessionStart 50KB 输出保护机制完整（二分查找截断到字节边界）
- [N-8] `post-tool-use-failure.js` 无显式 `process.exit(0)`，依赖事件循环自然退出（与其他 hook 风格不同但无害）

---

## 验证矩阵

| 发现 | 原级别 | 验证方法 | 结论 |
|------|--------|----------|------|
| LOCK_TTL 30min | C | 设计意图查证 | ❌ 误报 |
| Teammate additionalContext | H | 设计意图查证（I-6 注释） | ⚠️ 有意设计 |
| PostToolUse Bash 死代码 | H | 路径追踪（hooks.json matcher） | ✅ 确认 → W |
| 截断 callback 丢失 | H | 代码逐行追踪 | ❌ 误报 |
| findings 时区偏差 | H | 路径追踪 + 时区分析 | ✅ 确认 → H |
| close-chg 状态描述 | H | 实际 diff（SKILL vs close-chg.md） | ✅ 确认 → W |
| compact recovery root choice | H | 路径追踪（PreCompact skip → 正常路径） | ⚠️ 流程正确 → W |
| bashPathLooksArtifact 宽泛 | H | 路径追踪（fallback 链路） | ⚠️ 低风险 → W |

---

## 整体健康度：8/10

- **Hook 代码质量**：8/10（零运行时 crash，1 个确认 H 级时区 bug，无数据损坏路径）
- **流程完整性**：8.5/10（P-A-C-E-V 链路完整，lock 释放双重保障，防循环降级健全）
- **Plugin/发布一致性**：9/10（零 C/H，hooks.json 与 settings 完全一致，发布面完备）
- **Skill/模板**：7/10（1 个状态描述矛盾，2 个格式不一致）
- **测试/文档/架构**：8/10（REFERENCE 发布检查全通过，v6.0.0-design.md 过时）

### 最紧迫的 3 个改进项

1. **[H] `session-start.js:527`** — 修复 findings 过期天数时区偏差（UTC vs local）
2. **[W] `pace-workflow/SKILL.md:141`** — 补全 close-chg 最终 `status: archived` 状态变迁
3. **[W] `post-tool-use.js:34,63-68`** — 清理 PostToolUse 中 Bash 死代码

---

## 证据来源

- `plugin/hooks/pace-utils.js` (公共模块，~1100 行)
- `plugin/hooks/pre-tool-use.js` (PreToolUse，~1200 行)
- `plugin/hooks/post-tool-use.js` (PostToolUse，~200 行)
- `plugin/hooks/post-tool-use-failure.js` (PostToolUseFailure，~100 行)
- `plugin/hooks/session-start.js` (SessionStart，~600 行)
- `plugin/hooks/stop.js` (Stop，~250 行)
- `plugin/hooks/pre-compact.js` (PreCompact，~120 行)
- `plugin/hooks/subagent-stop.js` (SubagentStop，~120 行)
- `plugin/hooks/stop-failure.js` (StopFailure，~80 行)
- `plugin/hooks/task-list-sync.js` (TaskListSync，~120 行)
- `plugin/hooks/hooks.json` (Hook 注册配置)
- `plugin/agents/artifact-writer.md` (Agent 定义，283 行)
- `plugin/agent-references/instructions/close-chg.md` (close-chg 指令)
- `plugin/skills/pace-workflow/SKILL.md` (PACE 流程 Skill)
- `plugin/skills/artifact-management/SKILL.md` (Artifact 管理 Skill)
- `.claude-plugin/marketplace.json` + `plugin/.claude-plugin/plugin.json`
- `tests/test-hooks-e2e.js` + `tests/test-pace-utils.js`
- `REFERENCE.md` + `README.md`
