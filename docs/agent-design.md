# PACEflow paceflow-artifact-writer Agent 设计文档

> **文档版本**：1.0
> **生成日期**：2026-05-02
> **状态**：设计中（pre-implementation）
> **关联文档**：
> - `docs/v6.0.0-design.md`（v6.0.0 架构设计，本文档是其第三块基石）
> - `docs/action-plan-2026-05-02.md`（行动项规划，第 4 节 POC-1 是本文档前身）

---

## 目录

1. [设计目标与定位](#1-设计目标与定位)
2. [三层架构（hook / agent / skill）](#2-三层架构hook--agent--skill)
3. [Agent 元数据](#3-agent-元数据)
4. [System Prompt 设计](#4-system-prompt-设计)
5. [指令协议（主 session → agent）](#5-指令协议主-session--agent)
6. [报告协议（agent → 主 session）](#6-报告协议agent--主-session)
7. [协作模式](#7-协作模式)
8. [项目版本兼容（v5/v6 双轨）](#8-项目版本兼容v5v6-双轨)
9. [测试用例](#9-测试用例)
10. [Phase 实施计划](#10-phase-实施计划)
11. [风险与缓解](#11-风险与缓解)
12. [开放问题](#12-开放问题)
13. [附录 A：完整 System Prompt](#附录-a完整-system-prompt)
14. [附录 B：调用示例](#附录-b调用示例)
15. [附录 C：测试脚本](#附录-c测试脚本)

---

## 1. 设计目标与定位

### 1.1 痛点回顾

PACEflow 的 artifact 操作（创建/更新/归档）当前由主 session 直接处理。在长期项目（如 ccauth：findings 45KB / impl_plan 381KB / task 152KB / walkthrough 260KB）中：

| 操作 | 当前主 session 消耗 | 失败率 |
|------|-------------------|--------|
| 创建新 CHG（写详情 + 加索引） | 5-30K tokens | 中 |
| 修改进行中详情 | 3-10K tokens | 高（大文件 Edit 循环） |
| **归档 CHG**（双步骤 ARCHIVE 移动） | **30-100K+ tokens** | **极高** |
| 创建新 finding（写详情段落 + 加索引） | 10-25K tokens | 中 |
| 记录 correction | 5K tokens | 低 |

**根因**：
1. 主 session 必须 Read 大文件才能 Edit（Claude Code 强制约束）
2. `old_string` 在大文件中冲突 → 循环失败
3. ARCHIVE 标记移动是双步骤精确匹配
4. PACEflow 格式严格（见 findings 第 514 行 H-1/H-2 多种字段命名系统）

### 1.2 设计目标

| 指标 | 当前（主 session 直做） | 目标（agent 派单） |
|------|---------------------|------------------|
| 单 CHG 收尾 token 消耗 | 30-100K | < 10K（节省 70%+） |
| 一次成功率（无 Edit 循环） | 50-70% | > 95% |
| 主 session 调用 prompt 长度 | 1500+ 字 | < 200 字 |
| 行为一致性（不同时段格式漂移） | 中（70-85%） | 高（接近 100%） |
| 主 session 上下文占用 | 高（含详情全文） | 低（仅指令 + 报告） |

### 1.3 定位

**paceflow-artifact-writer 是固化为 plugin 组件的 artifact 操作专员。**

- 不替代 hook（hook 是底线，所有工具调用必经过）
- 不替代 skill（skill 是规范文档，agent 内化它）
- **替代主 session 直接操作 artifact**（主 session 改回业务，agent 改文档）

### 1.4 非目标

- ❌ 不做技术决策（如"任务该不该开 CHG"，主 session 决定）
- ❌ 不做 PACE 协议层判断（如"V 阶段是否通过"，由 hook + 主 session 处理）
- ❌ 不嵌套调用其他 agent
- ❌ 不暴露给最终用户（slash command），只接受主 session 调用
- ❌ 不持久化状态（每次调用独立无状态）

---

## 2. 三层架构（hook / agent / skill）

### 2.1 架构图

```
┌─────────────────────────────────────────────────────┐
│  主 session（Claude）                              │
│   - 业务决策、用户交互、技术架构                     │
│   - artifact 操作时派 paceflow-artifact-writer      │
└─────────────────────┬───────────────────────────────┘
                      │
                  100 字指令
                      ▼
┌─────────────────────────────────────────────────────┐
│  paceflow-artifact-writer（Agent，本文档）           │
│   - 内化 v6.0.0 schema/wikilink/状态机/ARCHIVE       │
│   - 5 类指令机械执行                                 │
│   - 简略报告（成功）/ 详细报告（失败）              │
└─────────────────────┬───────────────────────────────┘
                      │
                  Write/Edit
                      ▼
┌─────────────────────────────────────────────────────┐
│  Hook 系统（hooks/*.js）                            │
│   - PreToolUse: 格式校验 + 三级触发                  │
│   - PostToolUse: 完整性检查 + 归档提醒              │
│   - 确定性强制（不能绕过）                          │
└─────────────────────┬───────────────────────────────┘
                      │
                  操作文件
                      ▼
┌─────────────────────────────────────────────────────┐
│  Artifact 文件                                      │
└─────────────────────────────────────────────────────┘

参考层（不在调用链上）：
┌─────────────────────────────────────────────────────┐
│  Skill 系统（skills/*/SKILL.md）                    │
│   - 主 session 在不确定时参考 skill 规范            │
│   - skill 引导主 session 派 agent                   │
│   - agent 不读 skill（已内化）                      │
└─────────────────────────────────────────────────────┘
```

### 2.2 各层职责

| 层 | 性质 | 职责 |
|---|------|------|
| **主 session** | 智能 + 高层 | 业务、决策、调用 agent |
| **paceflow-artifact-writer** | 智能 + 隔离 | artifact CRUD 机械执行 |
| **Hook** | 确定性 | 强制格式 + 完整性 + 状态守门 |
| **Skill** | 文档 | 规范知识库（agent 内化用） |

### 2.3 调用链 vs 参考链

- **调用链**：主 session → agent → hook → 文件
- **参考链**：skill 在 plugin 加载时为主 session 提供规范文档（不参与运行时调用）

---

## 3. Agent 元数据

### 3.1 完整 frontmatter

```yaml
---
name: paceflow-artifact-writer
description: |
  PACEflow artifact 操作专员。处理索引文件（task / implementation_plan / walkthrough /
  findings / corrections.md）和 changes/ 子目录详情文件的所有 CRUD（创建、更新、归档）。
  内化 v6.0.0 frontmatter schema、wikilink 规范、状态机、ARCHIVE 规则。主 session 在 100 字
  指令下精准完成 artifact 操作。支持 v5 双区结构和 v6 索引-详情结构双轨。
tools: [Read, Write, Edit, Bash, Glob, Grep]
model: sonnet
effort: medium
---
```

### 3.2 工具权限分析

| 工具 | 是否需要 | 用途 |
|------|---------|------|
| `Read` | ✅ | 读取现有文件、模板、上下文 |
| `Write` | ✅ | 创建新详情文件 |
| `Edit` | ✅ | 修改索引文件、详情段落 |
| `Bash` | ✅ | mkdir 创建子目录、wc 检查行数、ls 列文件 |
| `Glob` | ✅ | 列 changes/ 下所有 CHG 文件 |
| `Grep` | ✅ | 检查 wikilink 引用、find frontmatter 字段 |
| `WebFetch` | ❌ | agent 不上网 |
| `WebSearch` | ❌ | agent 不搜索 |
| `Task`/`TaskCreate` | ❌ | agent 不调用其他 agent |
| MCP tools | ❌ | agent 不依赖 MCP |
| `NotebookEdit` | ❌ | 不操作 notebook |

### 3.3 Model 选择

| Model | 场景 | 成本 | 推荐 |
|-------|-----|-----|------|
| Sonnet | 默认 | 中 | ✅ 平衡 |
| Haiku | 简单格式化（如归档移动 ARCHIVE） | 低 | 可选（特定指令） |
| Opus | 复杂 finding 详情写入 | 高 | 不推荐（agent 是机械执行，不需 Opus） |

**默认 Sonnet**。未来可在指令中允许 `model: haiku` 覆盖（如 `archive-chg` 简单任务）。

### 3.4 Effort 选择

`effort: medium` —— agent 任务通常是结构化的，不需要 high effort 的深度思考。

---

## 4. System Prompt 设计

### 4.1 设计原则

| 原则 | 说明 |
|------|------|
| **精简** | < 5K tokens（Sonnet 缓存阈值内） |
| **完整** | 覆盖所有 5 类指令 + 双版本兼容 |
| **机械** | 明确"不做什么"边界，避免 agent 自作主张 |
| **可测试** | 每条规则可写测试用例 |
| **版本同步** | 与 v6.0.0-design.md 的 schema 严格一致 |

### 4.2 结构

System prompt 由 11 个段落组成（按重要性排序）：

```
1. 工作范围（边界明确）
2. 你不要做的事（负面清单优先）
3. 项目版本检测（v5/v6 分支）
4. v6.0.0 文件结构
5. v6.0.0 Frontmatter Schema（CHG / finding / correction）
6. v6.0.0 Wikilink 规范
7. v6.0.0 状态机
8. v6.0.0 ARCHIVE 标记规则
9. v5.x 兼容规则（双区结构）
10. 5 类指令规范
11. 工作流程 + 报告格式
```

### 4.3 完整内容

**见附录 A**。

### 4.4 缓存策略

System prompt 严格控制 < 5K tokens 以利用 Anthropic API 的 prompt caching：
- agent 多次调用时，system prompt 部分缓存命中，仅指令部分计费
- 长期使用下，单次调用实际成本可降到几百 tokens

---

## 5. 指令协议（主 session → agent）

### 5.1 指令类型

| 类型 | 说明 | 频率 |
|------|------|-----|
| `create-chg` | 创建新 CHG/HOTFIX | 高 |
| `update-chg` | 修改进行中 CHG 详情 | 中 |
| `archive-chg` | CHG 完成归档 | 高 |
| `record-finding` | 记录新调研 finding | 中 |
| `record-correction` | 记录用户纠正 | 低 |

### 5.2 指令格式（统一）

```yaml
operation: <指令类型>
target: <CHG-ID 或 finding/correction 标识>
fields:
  <字段名>: <值>
  ...
```

主 session 调用示例：

```javascript
Agent({
  description: "创建 CHG-20260502-01",
  subagent_type: "paceflow-artifact-writer",
  prompt: `
operation: create-chg
fields:
  title: hooks.json if 条件优化
  tasks:
    - "T-498: todowrite-sync 加 if 条件"
    - "T-499: config-guard 加 if 条件"
    - "T-500: 验证 hook 触发率"
  related-finding: "[[finding-2026-05-02-v91-126]]"
  type: change
`
});
```

### 5.3 各指令字段规范

#### 5.3.1 create-chg

```yaml
operation: create-chg
fields:
  title: <CHG 标题，1 行>             # 必填
  tasks:                              # 必填，至少 1 个
    - "T-NNN: 任务描述"
  type: change | hotfix               # 默认 change
  related-finding: "[[finding-id]]"   # 可选
  background: <背景说明>               # 可选，写入实施详情段
  scope: <范围说明>                    # 可选
  technical-decision: <技术决策>       # 可选
```

agent 行为：
- 计算 chg-id（基于日期 + 当日序号自动递增）
- v6: Write `changes/chg-yyyymmdd-nn.md`（含 frontmatter + 5 段）
- v6: Edit `task.md` + `implementation_plan.md` 添加索引行
- v5: Edit `task.md` + `implementation_plan.md` 添加索引行 + 详情段落

#### 5.3.2 update-chg

```yaml
operation: update-chg
target: CHG-20260502-01
fields:
  section: tasks | implementation | work-record | research   # 必填
  action: append | replace | update-status                   # 必填
  content: <新内容>                                           # 视 action 而定
  task-id: T-NNN                                              # action=update-status 时必填
  new-status: " " | "/" | "x" | "-"                           # action=update-status 时必填
```

#### 5.3.3 archive-chg

```yaml
operation: archive-chg
target: CHG-20260502-01
fields:
  walkthrough-summary: <一行总结>      # 必填，写入 walkthrough.md 索引行
```

agent 行为：
- v6: Edit 详情 frontmatter `status: completed` + `completed-date`
- v6: Edit `task.md` 索引行 `[/]→[x]` 移到 ARCHIVE 下方
- v6: Edit `implementation_plan.md` 同上
- v6: Edit `walkthrough.md` 添加完成索引行
- v5: 移动详情段落到 ARCHIVE 下方（双步骤 ARCHIVE 标记移动）

#### 5.3.4 record-finding

```yaml
operation: record-finding
fields:
  title: <finding 标题>
  summary: <≤200 字符摘要>
  type: research | observation | comparison | bug-report
  impact: P0 | P1 | P2 | P3
  body: <Markdown 内容，含背景/发现/方案/调研来源>
  related-changes: ["[[chg-id1]]", "[[chg-id2]]"]   # 可选
  merges: ["[[finding-id]]"]                         # 可选，合并历史
  status: open | investigating                       # 默认 open
```

#### 5.3.5 record-correction

```yaml
operation: record-correction
fields:
  trigger-quote: <用户原话引用>
  wrong-behavior: <错误行为，≥20 字符>
  correct-behavior: <正确做法，≥20 字符>
  trigger-scenario: <触发场景>
  root-cause: <根本原因>
  knowledge-link: "[[knowledge-note-id]]" | "project-only"  # 必填
```

### 5.4 指令解析容错

agent 必须处理以下情况：
- **缺字段** → 报告 `missing-fields: [field1, field2]`，不执行
- **字段类型错** → 报告 `type-error`，不执行
- **未知指令类型** → 报告 `unknown-operation`，不执行
- **target 不存在** → 报告 `target-not-found`，不执行

---

## 6. 报告协议（agent → 主 session）

### 6.1 简略格式（成功，默认）

```markdown
## paceflow-artifact-writer 报告

**操作**：create-chg
**版本**：v6
**Target**：CHG-20260502-01

**新建文件**：
- changes/chg-20260502-01.md (3.2KB, 60 行)

**修改文件**：
- task.md (+1 行 L8)
- implementation_plan.md (+1 行 L15)

**Hook 反馈**：全部 PASS

**验证**：
- frontmatter schema: ✅
- wikilink 完整性: ✅ (1 link to finding-2026-05-02-v91-126)
- 跨索引一致性: ✅

**后续提示**：等待 C 阶段批准后再执行 update-chg
```

### 6.2 详细格式（失败）

```markdown
## paceflow-artifact-writer 报告

**操作**：archive-chg
**版本**：v6
**Target**：CHG-20260502-01
**状态**：FAILED

**失败原因**：hook-deny

**详细信息**：
PostToolUse hook denied:
"PACE 提醒：CHG-20260502-01 详情未标记任务全部完成，无法归档。
当前 [/] 任务: T-499, T-500"

**部分产出**（已回滚）：
无（hook 在第一步 Edit 时就 deny）

**主 session 应做的下一步**：
1. 派 update-chg 完成 T-499, T-500
2. 重新派 archive-chg
```

### 6.3 报告字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| 操作 | enum | ✅ | 5 类指令之一 |
| 版本 | enum | ✅ | v5 / v6 |
| Target | string | 视情况 | update/archive 必填 |
| 状态 | enum | 失败时 | SUCCESS（默认）/ FAILED |
| 新建文件 | list | ✅ | 含路径 + 大小 |
| 修改文件 | list | ✅ | 含路径 + 行变化 |
| Hook 反馈 | string | ✅ | "全部 PASS" 或具体 deny/warn |
| 验证 | object | ✅ | 3 项：schema/wikilink/一致性 |
| 失败原因 | enum | 失败时 | missing-fields / hook-deny / format-violation / file-conflict / target-not-found / out-of-scope |
| 详细信息 | string | 失败时 | 完整错误信息 |
| 部分产出 | list | 视情况 | 失败时已创建的文件 |
| 后续提示 | string | 可选 | 主 session 应做的下一步 |

---

## 7. 协作模式

### 7.1 主 session 何时派 agent（决策矩阵）

| 操作 | 主 session 直做 | 派 agent | 推荐 |
|------|---------------|---------|------|
| 创建新 CHG | 5-30K tokens | 主 200 字 + agent 5K | **agent**（节省 80%） |
| 修改进行中详情 | 3-10K tokens | 主 100 字 + agent 3K | **agent**（节省 70%） |
| 归档 CHG | 30-100K tokens | 主 50 字 + agent 5K | **强烈 agent**（节省 90%+） |
| 创建 finding | 10-25K tokens | 主 200 字 + agent 5K | **agent**（节省 75%） |
| 记录 correction | 5K tokens | 主 200 字 + agent 3K | **agent**（节省 40%） |
| 索引行单字段查询 | < 1K tokens | 主 50 字 + agent 1K | 直做（agent 启动开销不值） |
| TodoWrite 同步 | < 1K tokens | — | 直做 |

### 7.2 与 hook 的交互

agent 调用 Write/Edit 时：
1. PreToolUse hook 检查（agent 与主 session 同样经过）
2. 如 hook deny → agent 收到反馈 → 报告 FAILED（不重试绕过）
3. 如 hook 注入 additionalContext → agent 报告中引用
4. PostToolUse hook 检查 → agent 报告中引用反馈

**关键约束**：agent 收到 hook deny 后**禁止重试**——直接报告失败让主 session 决策。

### 7.3 与 skill 的关系

| skill | 与 agent 关系 |
|-------|-------------|
| `pace-workflow` | skill 引导主 session "artifact 操作请派 paceflow-artifact-writer" |
| `artifact-management` | agent 内化此 skill 的全部规范，主 session 不需读 |
| `pace-bridge` | skill 引导主 session "桥接计划时派 agent 执行 create-chg" |
| `pace-knowledge` | agent 不处理 knowledge/ 笔记（不在工作范围）；主 session 直做 |
| `paceflow-audit` | agent 不参与审计（审计是分析，agent 是 CRUD） |

### 7.4 主 session 验证 agent 报告

**信任但验证**：

```javascript
// 主 session 收到 agent 报告后
1. 抽查文件存在：Bash `ls -la <reported-path>`
2. 抽查行号准确：Bash `wc -l <index-file>`、Read 报告的行
3. 抽查 frontmatter：Read 详情文件前 20 行
4. 如发现不一致 → 主 session 修复 + 记录 correction（root-cause: agent-report-mismatch）
```

---

## 8. 项目版本兼容（v5/v6 双轨）

### 8.1 检测逻辑

agent 启动时执行：

```bash
ls "$ARTIFACT_DIR/changes" 2>/dev/null
```

- 有 `changes/` 目录 + 至少 1 个 .md 文件 → **v6.0.0**
- 否则 → **v5.x**

### 8.2 v5.x 操作差异

v5 是双区结构（索引 + 详情都在同一文件）：

| 操作 | v6 行为 | v5 行为 |
|------|--------|--------|
| 创建 CHG | Write changes/chg-xxx.md + Edit 索引 | Edit task.md/impl_plan.md 添加索引 + 详情段落 |
| 更新 CHG | Edit changes/chg-xxx.md | Edit 主 artifact 详情段落 |
| 归档 CHG | 改 frontmatter status + 移动索引行 | 移动详情段落到 ARCHIVE 下方（双步骤 ARCHIVE 标记移动） |
| 记录 finding | Write changes/findings/finding-xxx.md + Edit findings.md 索引 | Edit findings.md 摘要索引 + 详情段落 |
| 记录 correction | Write changes/corrections/... + Edit corrections.md | Edit findings.md "## Corrections 记录" 区 |

### 8.3 双轨过渡

| 时间点 | 状态 |
|-------|------|
| v6.0.0 发布 | agent 双轨支持，新项目默认 v6，旧项目保留 v5 |
| v6.5.0 评估 | 如 90%+ 项目已迁移，考虑废弃 v5 兼容 |
| v7.0.0 | 仅支持 v6（agent system prompt 可大幅精简） |

---

## 9. 测试用例

### 9.1 测试矩阵

| 用例 | 输入 | 期望 |
|------|-----|------|
| TC-01 create-chg v6 完整字段 | 完整 fields | 3 文件操作 + PASS |
| TC-02 create-chg v6 缺 title | 缺 title 字段 | 报告 missing-fields |
| TC-03 create-chg v5 项目 | v5 项目 + 完整 fields | 双区结构操作 |
| TC-04 archive-chg 任务未完成 | CHG 仍有 [/] 任务 | hook-deny 报告 |
| TC-05 archive-chg v6 正常 | 所有任务 [x] | 4 文件操作 + PASS |
| TC-06 record-finding 完整 | 完整 fields | 2 文件操作 + PASS |
| TC-07 record-finding summary 超 200 字符 | summary 250 字符 | format-violation |
| TC-08 record-correction 缺 knowledge-link | 缺该字段 | missing-fields |
| TC-09 update-chg target 不存在 | CHG-99999999-99 | target-not-found |
| TC-10 未知 operation | operation: foo | out-of-scope |
| TC-11 wikilink 完整性失败 | 引用不存在 finding | 验证失败警告 |
| TC-12 ARCHIVE 标记缺失 | findings.md 无 ARCHIVE | 报告并要求模板 |

### 9.2 集成测试场景

```bash
# 场景：完整 CHG 生命周期
1. 主 session 派 create-chg → agent 创建 CHG-X
2. 主 session 派 update-chg（添加任务） → agent 修改
3. 主 session 派 update-chg（标 [/]） → agent 修改
4. 主 session 派 archive-chg → agent 归档
5. 验证：4 文件最终状态正确
```

### 9.3 性能基准

| 指标 | 目标 |
|------|------|
| 单次调用平均 token | < 5K |
| 单次调用平均时长 | < 10s |
| 一次成功率 | > 95% |
| Hook deny 后正确报告率 | 100% |

---

## 10. Phase 实施计划

```
Phase A：System Prompt 设计 + PoC（~3 小时）
  ├── 写完整 system prompt（附录 A）
  ├── 派 general-purpose subagent 模拟 agent 行为
  ├── 跑 TC-01, TC-04, TC-05 三个核心用例
  └── 验证 system prompt 是否够用
       ↓
Phase B：Agent 文件创建（~1 小时）
  ├── paceflow/agents/paceflow-artifact-writer.md（标准 Plugin 目录）
  ├── plugin.json 注册（如需要）
  └── verify.js 检查 agent 加载
       ↓
Phase C：与 v6.0.0 集成（~2 小时）
  ├── pace-workflow skill 添加引导文本
  ├── post-tool-use.js 添加"建议派 agent"提醒
  └── 模板路径调整（agent 可访问 hooks/templates/）
       ↓
Phase D：dogfood（~1 周低强度）
  ├── PACEflow 自身使用 agent 处理所有 artifact 操作
  ├── 收集精准度数据（一次成功率、token 消耗、失败模式）
  └── 迭代 system prompt
       ↓
Phase E：发布
  └── 与 v6.0.0 同期 GA

总估时：~12 小时（含 1 周低强度 dogfood）
```

---

## 11. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|-----|------|
| agent 边界场景不覆盖 | 小概率失败 | 测试用例 + agent 检测 out-of-scope 时返回主 session |
| 主 session 误信 agent 报告 | 数据不一致 | 主 session 抽查（Bash wc/Read N 行） |
| system prompt 太大 cache miss | 成本翻倍 | 严格 < 5K tokens；定期审计 |
| agent 内化 schema 与文档漂移 | 行为错乱 | system prompt 与 v6.0.0-design.md 同步审查 |
| Hook deny 后 agent 反复重试 | 死循环 | system prompt 强制"deny 后不重试" |
| Plugin 注册路径错误 | agent 无法加载 | verify.js 启动时检查 |
| v5/v6 双轨分支错误 | 旧项目损坏 | 每次操作前打印检测到的版本 |
| agent 与其他 subagent 嵌套 | 失控 | system prompt 禁止 + 工具权限不含 Task |
| Model 升级后行为漂移 | 不一致 | model 字段固定为 sonnet，与 plugin 版本绑定 |

---

## 12. 开放问题

### 12.1 待 PoC 验证

1. system prompt < 5K tokens 是否足以覆盖全部规范？
2. agent 在 v5 项目下的双区结构操作是否准确？
3. 主 session 100 字指令是否真能精准传达需求？
4. agent 模型选择（Sonnet 默认）是否最优 ROI？

### 12.2 待 dogfood 决定

1. 是否需要 `verbose: true` 字段让 agent 返回详细报告（默认简略）？
2. 是否需要 `dry-run: true` 字段让 agent 仅检查不实际写？
3. 归档时是否自动派生 walkthrough-summary（agent 基于详情自动总结）？
4. 是否支持批量操作（一次指令多个 CHG）？

### 12.3 待 v7.0.0 评估

1. 是否扩展 agent 支持 spec.md 操作？（当前不支持，spec 改动稀少）
2. 是否拆分为多 agent（如 paceflow-archiver 专做归档）？
3. 是否引入 agent 间协议（如 paceflow-auditor 审计 agent 产出）？

---

## 附录 A：完整 System Prompt

完整内容已独立到 `paceflow/agents/paceflow-artifact-writer.md`（Claude Code Plugin 标准 agent 定义文件）。

本设计文档不重复 prompt 内容。修改 prompt 时请直接编辑 `paceflow/agents/paceflow-artifact-writer.md`，并在本文档第 11 节风险表中记录变更。

**为什么独立**：
- 避免双份维护（design.md 和 agent.md 同步成本）
- 符合 Claude Code Plugin 标准（agent 定义在 `agents/` 目录自动加载）
- prompt 修订有 git 单点
- 文档大小从 35KB 降到 ~22KB

**v2.0 修订**（基于 PoC 反馈，2026-05-02）：在 v1.0 system prompt 基础上修复 6 个缺陷：

| 严重度 | 缺陷 | v2.0 修复 |
|--------|------|----------|
| P1 | 缺索引行格式模板 | 新增"v6.0.0 索引行模板"段（5 个 artifact 文件各一） |
| P1 | 缺 status→checkbox 映射 | 新增"v6.0.0 状态→checkbox 映射"段（11 行映射表） |
| P2 | 缺 Edit 前置 Read 声明 | 新增"Edit 前置 Read（强制）"段 |
| P2 | 缺 PostToolUse 反馈处理 | 新增"Hook 反馈处理决策树"段（5 种情形） |
| P3 | 缺 slug 生成规则 | 新增"Slug 生成规则"段（5 条 + 3 示例） |
| P3 | frontmatter 字段顺序 | Schema 段加注"按下方 Schema 列出顺序" |

---


## 附录 B：调用示例

### B.1 创建 CHG

```javascript
Agent({
  description: "创建 CHG-20260502-01",
  subagent_type: "paceflow-artifact-writer",
  prompt: `
operation: create-chg
fields:
  title: hooks.json if 条件优化
  tasks:
    - "T-498: todowrite-sync 加 if 条件"
    - "T-499: config-guard 加 if 条件"
    - "T-500: 验证 hook 触发率不变"
  type: change
  related-finding: "[[finding-2026-05-02-v91-126]]"
  background: |
    Claude Code v2.1.85 引入 hook if 字段，可在 hook 进程启动前过滤工具名匹配，
    减少不必要的 Node.js 启动开销。
  scope: 仅修改 hooks.json 两处配置，不涉及 hook 脚本本身改动。
`
});
```

### B.2 归档 CHG

```javascript
Agent({
  description: "归档 CHG-20260502-01",
  subagent_type: "paceflow-artifact-writer",
  prompt: `
operation: archive-chg
target: CHG-20260502-01
fields:
  walkthrough-summary: "hooks.json if 条件优化（T-498-T-500，hook 启动开销减少 30%）"
`
});
```

### B.3 记录 finding

```javascript
Agent({
  description: "记录 v6.0.0 PoC finding",
  subagent_type: "paceflow-artifact-writer",
  prompt: `
operation: record-finding
fields:
  title: v6.0.0 索引-详情拆分架构 PoC 验证
  summary: "PoC 通过：subagent 8K tokens 完成主 session 30K+ 任务，节省 73%"
  type: observation
  impact: P0
  body: |
    ## 摘要
    通过派 subagent 创建 changes/chg-20260502-01-poc.md 验证 v6.0.0 拆分架构...
    
    ## 关键发现
    1. subagent 一次写对全部格式
    2. changes/ 新目录 hook 完全兼容
    ...
  related-changes: ["[[chg-20260502-01-poc]]"]
  status: accepted
`
});
```

### B.4 记录 correction

```javascript
Agent({
  description: "记录 correction：未主动归档",
  subagent_type: "paceflow-artifact-writer",
  prompt: `
operation: record-correction
fields:
  trigger-quote: "你忘了归档详情段落"
  wrong-behavior: "标记任务 [x] 后即认为完成，未执行 G-9 清单的归档步骤"
  correct-behavior: "G-9 明确要求标 [x] 后立即归档详情到 ARCHIVE 下方，不需询问"
  trigger-scenario: 任务收尾阶段，归档 task + 更新索引后产生"差不多了"的错觉
  root-cause: "索引=完成"错觉 + PostToolUse 提醒 warnOnce 同会话仅触发一次
  knowledge-link: project-only
`
});
```

---

## 附录 C：测试脚本

### C.1 PoC 测试脚本（Phase A）

```bash
# 派 general-purpose subagent 模拟 paceflow-artifact-writer 行为
# 跑 TC-01 / TC-04 / TC-05 三个核心用例

# 测试前快照
N0=$(wc -l < /home/paceaitian/.claude/plugins/cache/paceaitian-paceflow/paceflow/5.1.4/hooks/pace-hooks.log)
LS_BEFORE=$(ls /mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-hooks/changes/ 2>/dev/null | wc -l)

# subagent 调用（用附录 A 的 system prompt + TC-01 输入）
# ...subagent 执行...

# 测试后验证
N1=$(wc -l < .../pace-hooks.log)
LS_AFTER=$(ls .../changes/ | wc -l)

echo "Hook log delta: $((N1-N0))"
echo "Files added: $((LS_AFTER-LS_BEFORE))"
echo "Expected: hook delta ~= 6 (3 tools × 2 hook events), files added = 1"
```

### C.2 集成测试脚本（Phase D）

```javascript
// tests/test-paceflow-artifact-writer.js
const TESTS = [
  {
    name: 'TC-01 create-chg v6 完整字段',
    input: { /* ... */ },
    expect: {
      filesCreated: 1,
      filesModified: 2,
      hookFeedback: 'PASS',
      validations: { schema: true, wikilink: true, consistency: true }
    }
  },
  // ... 12 个用例
];

for (const tc of TESTS) {
  const result = await runAgentTest(tc.input);
  assertMatches(result, tc.expect);
}
```

---

## 文档关联

- **v6.0.0 架构设计**：`docs/v6.0.0-design.md`（本文档是其第三块基石）
- **行动项规划**：`docs/action-plan-2026-05-02.md`（第 4 节 POC-1 是本文档前身）
- **PACE 协议**：`skills/pace-workflow/SKILL.md`
- **Artifact 规范**：`skills/artifact-management/SKILL.md`（agent 内化的规范源）
- **PoC 验证文件**：`vault/projects/paceflow-hooks/changes/chg-20260502-01-poc.md`
