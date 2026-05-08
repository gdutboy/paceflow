---
name: audit
effort: high
description: >
  PACEflow 内部系统全面审查框架。启动 5-agent 并行团队，基于代码、配置、
  测试和真实日志独立审查质量、流程、一致性、Skill模板和架构，产出去重分级报告。
  当用户说"完整分析"、
  "全面审查"、"全面检查"、"审计"、"代码审查"、"full audit"、"code review"、
  "comprehensive review"或调用 /audit 时触发。版本发布前的质量门控也应使用此 skill。
---

# PACEflow 全面审查

> 内部资料：该流程只用于 PaceFlow 仓库自身审计，不随 marketplace 插件发布，也不是用户项目工作流 skill。

## 触发场景

- 用户说"完整分析"、"全面审查"、"全面检查"
- 用户调用 `/audit`
- 版本发布前的质量门控

## 审查原则

> 本 skill 的核心价值是**独立发现问题**，不是照 guidebook/action-plan/README 打勾。

证据优先级：

1. 当前代码与配置：`plugin/hooks/**`、`plugin/agents/**`、`plugin/agent-references/**`、`plugin/skills/**`、`plugin/.claude-plugin/**`、`.claude-plugin/**`
2. 当前测试与 fixture：`tests/**`、`tests/agent-tests/**`
3. 真实运行证据：`plugin/hooks/pace-hooks.log`、Claude Code session JSONL、production smoke 产物
4. 用户面/内部文档：`README.md`、`REFERENCE.md`、`CLAUDE.md`、`docs/**`

文档只能用于发现候选矛盾或设计意图，不能单独作为 bug 证据。任何 C/H 级问题都必须从代码路径、配置注册、测试缺口或真实日志中独立证明。

当前 v6 审计基线：

- marketplace `source` 指向 `./plugin`；发布面是 4 个用户 skill + `artifact-writer` agent + hooks/agent-references/migrate；`internal/skills/audit/`、docs、tests、tickets 不随 marketplace 发布
- v6-only `changes/**` 详情模型；v5 活跃流程只允许迁移/桥接，不继续兼容
- artifact root 可为 local/vault/custom，真实 git worktree 沿用宿主项目 `.pace/artifact-root`
- `artifact-writer` 是唯一 artifact 写入者；主 session 不得直写 C/V 标记
- 项目级 `artifact-writer.lock` 串行化 shared artifact 写入；Bash 不得修改该锁
- `approve-and-start` 与 `close-chg` 是主路径合并操作；验证证据由主 session 运行并读取
- `SubagentStop` 报告标题问题是观察/恢复提示，不是 artifact 功能阻断

## 审查范围

> Agent 必须**动态发现**文件，不依赖预设数量。使用 Glob 扫描。

| 类别 | Glob 模式 |
|------|-----------|
| Hook 脚本 | `plugin/hooks/*.js` |
| Hook 配置 | `plugin/hooks/hooks.json` |
| Hook 模板 | `plugin/hooks/templates/*.md` |
| 用户 Skill | `plugin/skills/*/SKILL.md` + `plugin/skills/*/references/*.md` + `plugin/skills/*/templates/*.md` |
| 内部 Skill | `internal/skills/**/*.md` |
| Agent | `plugin/agents/**/*.md` + `plugin/agent-references/**/*.md` |
| Plugin 元数据 | `plugin/.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` |
| 迁移工具 | `plugin/migrate/**/*.js` |
| 本地工具 | `install.js` + `verify.js`（仅本地验证，不是正式安装路径） |
| 测试 | `tests/**/*.js` + `tests/agent-tests/**/*.yaml` |
| 文档（被审计对象） | `CLAUDE.md` + `README.md` + `REFERENCE.md` + `docs/**/*.md` |

---

## 严重度标准

| 级别 | 定义 | C 级门槛 |
|------|------|---------|
| **C** Critical | 功能错误、数据丢失、流程阻塞 | 必须证明**具体触发路径** |
| **H** High | 影响可靠性但不阻塞 | — |
| **W** Warning | 代码质量、文档过时 | — |
| **I** Info | 优化建议、风格改进 | — |

每个发现必须包含：文件名:行号、问题描述、建议修复。

---

## Phase 1：五维度并行审查

启动 5 个 subagent **并行**执行（Agent 工具，subagent_type: `general-purpose`）。

| Agent | 审查目标 | 关注维度 |
|-------|---------|---------|
| 1. 代码质量 | 核心 Hook（公共模块 + Write/Edit hook） | Bug/正则/路径/异常/I/O 协议 |
| 2. 流程完整性 | 生命周期 Hook（SessionStart/Stop/PreCompact） | stdin 解析/防循环/快照/降级 |
| 3. 一致性 | 辅助 Hook + Plugin + Agent 发布资产 | hooks.json/plugin/agents 一致性 |
| 4. Skill 模板 | 用户 Skill + 内部 audit + 模板 | v6 口径/交叉引用/格式/正则兼容 |
| 5. 架构优化 | 测试 + 文档 + 整体架构 | agent contract 覆盖度/文档准确性/流程缺口 |

> 每个 agent 的完整 prompt 和共享审查纪律见 [references/agent-prompts.md](references/agent-prompts.md)。

---

## Phase 2：验证筛选

> 历史误报率 50-80%，验证是流程核心。

对 **C/H 级**发现启动验证 subagent：

| 验证方法 | 适用场景 |
|---------|---------|
| 路径追踪 | 逻辑错误 — 从问题行追踪到入口确认可达 |
| 实际 diff | 不一致声称 — 逐行对比两个文件 |
| 设计意图查证 | 可能有意设计 — 检查 CLAUDE.md + 注释 |
| 最小复现 | 可构造触发条件 — E2E 测试验证 |
| 真实证据复核 | production smoke / hook log / session JSONL — 确认是否真实发生 |

结果三分类：✅ 确认 / ⚠️ 部分正确 / ❌ 误报

W/I 级快速扫描去重合并，不逐一验证。

---

## Phase 3：汇总报告

1. **去重**：同文件+同行号+同性质 → 合并
2. **分级**：P0 必修（C+高影响H）→ P1 建议（W）→ P2 文档 → P3 延后（I → 派 `record-finding`）
3. **建议后续变更**：每个 P0/P1 问题推荐对应 CHG-ID 或归入现有 CHG
4. **审查输入版本记录**：记录 git HEAD、工作区 diff 状态、动态发现的关键文件数量和可用日志/session 证据
5. **生成 ticketNN.md**

> 报告模板和误报防御策略见 [references/audit-procedures.md](references/audit-procedures.md)。

---

## 快速参考

```mermaid
flowchart TD
    A["/audit 触发"] --> B["Phase 1: 5 subagent 并行审查"]
    B --> C1["Agent 1: 核心 Hook"]
    B --> C2["Agent 2: 生命周期 Hook"]
    B --> C3["Agent 3: 辅助 Hook + 工具链"]
    B --> C4["Agent 4: Skill 模板同步"]
    B --> C5["Agent 5: 架构与优化"]
    C1 & C2 & C3 & C4 & C5 --> D["汇总所有发现"]
    D --> E["Phase 2: C/H 级路径追踪验证"]
    E --> F["三分类: ✅确认 / ⚠️部分正确 / ❌误报"]
    F --> G["Phase 3: 去重+分级+报告"]
    G --> H["ticketNN.md 标准报告"]
```
