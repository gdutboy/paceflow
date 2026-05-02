# PACEflow Agent Testing Strategy

> **文档版本**：1.0
> **生成日期**：2026-05-02
> **状态**：测试规划（待实施）
> **关联文档**：
> - `docs/agent-design.md`（agent 设计）
> - `docs/v6.0.0-design.md`（架构设计）
> - `agents/paceflow-artifact-writer.md`（v3.1 system prompt）

---

## 目录

1. [测试目标](#1-测试目标)
2. [测试维度矩阵](#2-测试维度矩阵)
3. [Phase A: Smoke Tests](#3-phase-a-smoke-tests)
4. [Phase B: Error Paths](#4-phase-b-error-paths)
5. [Phase C: Integration Tests](#5-phase-c-integration-tests)
6. [Phase D: Edge Cases](#6-phase-d-edge-cases)
7. [Phase E: Long-term Dogfood](#7-phase-e-long-term-dogfood)
8. [测试框架设计](#8-测试框架设计)
9. [Subagent 调用模板](#9-subagent-调用模板)
10. [报告与评估格式](#10-报告与评估格式)
11. [运行时监控](#11-运行时监控)
12. [验收标准](#12-验收标准)
13. [风险与缓解](#13-风险与缓解)
14. [附录 A：完整测试用例清单](#附录-a完整测试用例清单)
15. [附录 B：测试框架代码示例](#附录-b测试框架代码示例)

---

## 1. 测试目标

### 1.1 核心问题

paceflow-artifact-writer 是 v6.0.0 的第三块基石，用于替代主 session 直接操作 artifact。如何在不同场景下多次调用，验证：

- **精准度**：不同指令、不同输入、不同上下文下的一次成功率
- **健壮性**：边界条件、错误输入、异常状态的处理
- **一致性**：multi-turn 调用、并发调用的行为稳定
- **效率**：token 消耗、调用时长、cache 命中率
- **可观测**：报告完整度、与实际产出的一致性

### 1.2 关键 KPI

| 指标 | 目标 | 测量方式 |
|------|-----|---------|
| 一次成功率 | ≥ 95% | （成功调用数 / 总调用数） |
| 平均 token 消耗 | ≤ 7K（含首次 ref Read） | subagent usage 报告 |
| Hook deny 后正确报告率 | 100% | 报告中含 deny 详情且无重试 |
| frontmatter schema 错误率 | ≤ 2% | 验证产出文件 |
| 跨索引一致性错误率 | ≤ 2% | task.md 与 impl_plan.md 同步检查 |
| 主 session 抽查发现的偏差率 | ≤ 5% | 主 session 验证次数中发现问题占比 |

---

## 2. 测试维度矩阵

```
指令类型 (5) × 项目版本 (2) × 路径 (2) = 20 个核心组合
                                      + 集成测试 (5)
                                      + 极端场景 (5)
                                      + dogfood (持续)
```

### 2.1 维度

| 维度 | 选项 |
|------|------|
| **指令类型** | create-chg / update-chg / archive-chg / record-finding / record-correction |
| **项目版本** | v5（双区结构） / v6（拆分结构） |
| **路径** | happy（合规输入） / error（缺字段、超长、状态错） |
| **上下文** | 单 turn / multi-turn / 并发 |
| **数据规模** | 小（<1KB） / 中（1-10KB） / 大（10K+ tokens） |

### 2.2 测试 Phase 概览

| Phase | 范围 | 用例数 | 预估时长 | 自动化 |
|-------|-----|--------|---------|-------|
| A | Smoke Tests（happy path） | 5 | ~30 min | 是（subagent 并行） |
| B | Error Paths（边界覆盖） | 5 | ~30 min | 是 |
| C | Integration（生命周期） | 1（4 步组合） | ~20 min | 半自动（串行） |
| D | Edge Cases（极端场景） | 4-5 | ~40 min | 半自动 |
| E | Long-term Dogfood | 持续 | 1-2 周 | 被动收集 |

---

## 3. Phase A: Smoke Tests

### 3.1 目标

验证 5 类指令的 happy path 在 v6 项目下都能一次成功。

### 3.2 测试用例

| ID | 指令 | 输入摘要 | 期望输出 |
|----|------|--------|---------|
| TC-A1 | create-chg | title="test chg", tasks=["T-901: dummy"] | 1 详情文件 + 2 索引行 + PASS |
| TC-A2 | update-chg | target=TC-A1 chg-id, action=append, content="新任务" | 1 索引修改 + PASS |
| TC-A3 | archive-chg | target=TC-A1 chg-id, walkthrough-summary="测试归档" | frontmatter status:completed + 3 索引归档 |
| TC-A4 | record-finding | title="test finding", summary="...", body="..." | 1 详情 + 1 索引 + PASS |
| TC-A5 | record-correction | trigger-quote="...", wrong/correct-behavior(各 25 字), root-cause="...", project-only | 1 详情 + 1 索引（含建 corrections.md if 缺）|

### 3.3 执行方式

主 session 用单消息**并行**派 5 个 subagent（不同 target，避免冲突）：

```javascript
// 单消息 5 个 Agent 调用并行
[
  Agent({description: "TC-A1 create-chg", subagent_type: "general-purpose", prompt: "...TC-A1 prompt..."}),
  Agent({description: "TC-A2 update-chg", subagent_type: "general-purpose", prompt: "...TC-A2..."}),
  Agent({description: "TC-A3 archive-chg", subagent_type: "general-purpose", prompt: "...TC-A3..."}),
  Agent({description: "TC-A4 record-finding", subagent_type: "general-purpose", prompt: "...TC-A4..."}),
  Agent({description: "TC-A5 record-correction", subagent_type: "general-purpose", prompt: "...TC-A5..."})
]
```

### 3.4 验收

- 5/5 PASS：进入 Phase B
- 4/5 PASS：分析失败原因，修复 spec/instruction，重跑失败用例
- ≤ 3/5 PASS：阻塞 v6.0.0 发布

---

## 4. Phase B: Error Paths

### 4.1 目标

验证 5 类指令在错误输入下正确报告 FAILED + 不重试。

### 4.2 测试用例

| ID | 指令 | 错误注入 | 期望失败码 |
|----|------|---------|----------|
| TC-B1 | create-chg | 缺 title 字段 | `missing-fields` |
| TC-B2 | update-chg | target=CHG-99999999-99（不存在） | `target-not-found` |
| TC-B3 | archive-chg | 任务列表中有 [/] 进行中任务 | `format-violation: tasks not done` |
| TC-B4 | record-finding | summary = 250 字符（超 200 限制） | `format-violation: summary too long` |
| TC-B5 | record-correction | wrong-behavior = 10 字符（不足 20） | `format-violation: wrong-behavior too short` |

### 4.3 执行方式

并行派 5 个 subagent，每个跑一个 error path。每个 subagent 报告必须含：
- `状态: FAILED`
- 完整 `失败原因`
- 主 session 应做的下一步

### 4.4 验收

- 5/5 正确报告 FAILED：进入 Phase C
- 任何 subagent 尝试"自动修复输入"或绕过失败：标注为 P0 缺陷，修订 system prompt 强化"不假设字段值"约束

---

## 5. Phase C: Integration Tests

### 5.1 目标

验证 CHG 完整生命周期（create → update → update-status → archive）的多指令组合正确性。

### 5.2 测试用例

| 步骤 | 指令 | 输入摘要 | 验证点 |
|------|------|--------|-------|
| TC-C1.1 | create-chg | 创建 CHG-X，3 个任务 | 详情文件含 [ ] × 3 |
| TC-C1.2 | update-chg | T-901 → [/] | 详情文件 [ ] → [/] |
| TC-C1.3 | update-chg | append 工作记录 | 工作记录段 +1 行 |
| TC-C1.4 | update-chg | T-901/902/903 → [x] | 全部任务 [x] |
| TC-C1.5 | archive-chg | walkthrough-summary | frontmatter status:completed + 3 索引归档 |

### 5.3 执行方式

派 **1 个 subagent 串行执行 5 步**（multi-turn 场景测试 spec/instruction cache 复用）：

```javascript
Agent({
  description: "Phase C 集成测试",
  subagent_type: "general-purpose",
  prompt: "按顺序执行 5 个指令，每步报告。模拟主 session 多次调用 agent 的场景。"
})
```

### 5.4 验收

- 5 步全部 PASS
- 跨索引一致性：task.md 和 impl_plan.md 都有 CHG-X 索引
- ARCHIVE 标记移动正确（仅 1 个 ARCHIVE 标记独占一行）
- spec / 当前指令文件复用（subagent 报告 Read 次数 ≤ 总指令数 + 2）

---

## 6. Phase D: Edge Cases

### 6.1 目标

验证极端场景下的健壮性。

### 6.2 测试用例

| ID | 场景 | 输入 | 期望 |
|----|------|------|------|
| TC-D1 | corrections.md 不存在 | record-correction | agent 用 spec §5.6.5 模板 Write 新建 |
| TC-D2 | 大 finding body | record-finding，body 10K+ tokens | 完整写入，token 消耗合理 |
| TC-D3 | ARCHIVE 标记缺失 | 主 artifact 无 ARCHIVE | 报告 + 提示主 session 创建 |
| TC-D4 | 并发 2 个 subagent | 同时改不同 CHG | pace-hooks.log 无冲突 |
| TC-D5 | wikilink 完整性失败 | related-finding 指向不存在文件 | 警告（不阻止），报告中提及 |

### 6.3 验收

- TC-D1 / D2 / D5 PASS
- TC-D3 触发正确报告 + 提示
- TC-D4 验证 hook 日志无错乱（PreToolUse / PostToolUse 顺序正确）

---

## 7. Phase E: Long-term Dogfood

### 7.1 目标

在真实工作流中验证 agent 的长期可靠性。

### 7.2 部署方式

| 项目 | 部署策略 | 时长 |
|------|---------|-----|
| **PACEflow 自身** | v6.0.0 实施期间，每个 CHG/finding/correction 都派 agent | 持续（高频） |
| **ccauth 项目**（可选） | 选 1 周作为 "agent-only 期"，所有 artifact 操作走 agent | 1 周 |
| **新项目**（可选） | 从空开始用 agent | 持续 |

### 7.3 数据收集

每周汇总：

| 指标 | 来源 |
|------|------|
| 总调用次数 | subagent 调用日志 |
| 一次成功率 | 失败次数 / 总数 |
| 平均 token | subagent usage 累计 |
| 失败模式 top 5 | 失败原因聚类 |
| spec/instruction 修订需求 | 失败案例分析 |
| 主 session 抽查偏差 | 偏差记录 |

### 7.4 反馈闭环

```
失败案例 → record-correction（root-cause: agent-X-issue）
   ↓
每月汇总 → 识别系统性问题
   ↓
修订 spec / instruction
   ↓
新 v3.x 版本发布 → 派 PoC 验证
```

---

## 8. 测试框架设计

### 8.1 目录结构

```
paceflow/tests/agent-tests/
├── README.md                  # 测试指南
├── run-tests.js               # 测试运行器
├── cases/
│   ├── phase-a/
│   │   ├── tc-a1-create-chg.yaml
│   │   ├── tc-a2-update-chg.yaml
│   │   ├── tc-a3-archive-chg.yaml
│   │   ├── tc-a4-record-finding.yaml
│   │   └── tc-a5-record-correction.yaml
│   ├── phase-b/
│   │   ├── tc-b1-missing-title.yaml
│   │   └── ...
│   ├── phase-c/
│   │   └── tc-c1-chg-lifecycle.yaml
│   └── phase-d/
│       └── ...
├── fixtures/                  # 测试 fixture（vault 状态快照）
│   ├── empty-v6/              # 空 v6 项目
│   ├── populated-v6/          # 有数据的 v6 项目
│   └── mixed-v5-v6/           # 混合状态项目
├── results/                   # 历史测试结果
│   └── 2026-05-XX/
│       ├── manifest.json      # 运行元数据
│       ├── tc-a1.report.md
│       └── ...
└── helpers/
    ├── subagent-runner.js    # 派 subagent 并收集报告
    ├── fixture-setup.js       # 测试前 setup vault 状态
    ├── fixture-teardown.js   # 测试后清理
    └── verify-output.js       # 验证 agent 产出
```

### 8.2 测试用例格式（YAML）

```yaml
# tc-a1-create-chg.yaml
id: TC-A1
phase: A
indication: smoke-test-create-chg
description: 验证 create-chg 指令在 v6 项目下的 happy path

setup:
  fixture: empty-v6
  variables:
    project_path: /tmp/test-vault/empty-v6

input:
  operation: create-chg
  fields:
    title: TC-A1 测试 CHG
    tasks:
      - "T-901: 测试任务 1"
      - "T-902: 测试任务 2"
    type: change

expected:
  status: SUCCESS
  files_created:
    - changes/chg-{date}-01.md
  files_modified:
    - task.md
    - implementation_plan.md
  hook_feedback: "全部 PASS"
  validations:
    frontmatter_schema: pass
    wikilink_integrity: pass
    cross_index_consistency: pass
  max_tokens: 8000
  max_duration_ms: 30000

teardown:
  cleanup: true  # 删除创建的文件，恢复 fixture
```

### 8.3 测试运行器（伪代码）

```javascript
// run-tests.js
const { runTestCase } = require('./helpers/subagent-runner');

async function runPhase(phase) {
  const cases = loadCases(`cases/${phase}/`);
  const results = [];

  for (const testCase of cases) {
    const setupResult = await setupFixture(testCase.setup.fixture);
    const agentResult = await runAgent(testCase.input);
    const verifyResult = await verifyOutput(agentResult, testCase.expected);

    results.push({
      id: testCase.id,
      passed: verifyResult.passed,
      tokens: agentResult.tokens,
      duration_ms: agentResult.duration,
      diffs: verifyResult.diffs,
    });

    await teardownFixture(testCase.setup.fixture);
  }

  return results;
}

async function main() {
  const phaseResults = {
    A: await runPhase('phase-a'),
    B: await runPhase('phase-b'),
    C: await runPhase('phase-c'),
    D: await runPhase('phase-d'),
  };

  generateReport(phaseResults);  // 输出 results/<date>/manifest.json + 各用例报告
}

main();
```

### 8.4 Fixture 设计

| Fixture | 内容 | 用途 |
|---------|-----|------|
| `empty-v6` | 5 个索引文件（仅模板） + 空 changes/ | Phase A/B 基础测试 |
| `populated-v6` | 5+ CHG / 10+ finding 已存在 | Phase C 集成测试 |
| `mixed-v5-v6` | v5 主索引 + 部分 changes/ | Phase D 边界场景 |
| `large-data` | findings.md 27K+ tokens | Phase D 大文件测试 |
| `corrupted` | ARCHIVE 标记缺失 / wikilink 破损 | Phase D 错误恢复 |

---

## 9. Subagent 调用模板

### 9.1 单 happy path 模板

```
你是 paceflow-artifact-writer agent。

## Step 0：加载 system prompt
Read /mnt/k/AI/paceflow-hooks/paceflow/agents/paceflow-artifact-writer.md

## Step 1：执行测试指令
{完整 YAML 指令}

## Step 2：执行（真实创建文件）
ARTIFACT_DIR = {target vault path}

按 system prompt 严格执行（含 Read references / Edit 前置 Read / 验证 / 报告）。

## 严格约束
1. 仅用 system prompt 允许的工具
2. 真实创建文件
3. 严格按报告格式输出
4. 不要清理创建的文件

## Step 3：附加测试评估
在 agent 报告之后，追加【测试评估】：
- 一次成功（无 Edit 重试）：yes/no
- frontmatter 字段顺序：yes/no
- wikilink 完整性：yes/no
- token 消耗：N
- 与 expected 对比的差异：[list]
```

### 9.2 集成测试模板

```
你是 paceflow-artifact-writer agent。

按以下顺序执行 5 个指令（multi-turn 场景），每个指令独立报告：

Step 1: {TC-C1.1 输入}
Step 2: {TC-C1.2 输入}
...

每步完成后：
- 报告本步骤产出
- 累计 token / Read 次数

最终报告：
- 5 步是否全部 PASS
- 累计 token
- spec / instruction 是否复用
- 跨索引一致性最终状态
```

### 9.3 并行测试模板（Phase D-4）

主 session 单消息派 2 个 subagent 同时改不同 CHG：

```javascript
[
  Agent({description: "并发 CHG-A", prompt: "create CHG-A then update T-901..."}),
  Agent({description: "并发 CHG-B", prompt: "create CHG-B then update T-911..."})
]
```

主 session 收两份报告后检查 pace-hooks.log 无冲突。

---

## 10. 报告与评估格式

### 10.1 单测试用例报告

```markdown
# TC-XX 报告

**用例**：TC-XX
**Phase**：A/B/C/D
**指令**：create-chg / update-chg / ...
**项目版本**：v6
**状态**：PASS / FAIL

## Agent 报告（原文）

[完整 agent 输出]

## 测试评估

| 维度 | 期望 | 实测 | PASS/FAIL |
|------|-----|------|----------|
| 一次成功 | yes | yes | ✅ |
| frontmatter schema | valid | valid | ✅ |
| token 消耗 | ≤ 8K | 6.2K | ✅ |
| ... |

## 差异

[与 expected 不一致的项]

## 修订建议（如 FAIL）

[针对 spec / instruction 的修订点]
```

### 10.2 Phase 汇总报告

```markdown
# Phase {X} 测试汇总

**日期**：YYYY-MM-DD
**总用例**：N
**通过**：N
**失败**：N
**通过率**：N%

## 详细结果

| 用例 | 状态 | tokens | 耗时 | 备注 |
|------|-----|--------|-----|-----|

## 失败模式聚类

| 失败原因 | 数量 | 影响用例 | 修订建议 |
|---------|-----|---------|---------|

## 下一步

[基于结果的行动建议]
```

---

## 11. 运行时监控

### 11.1 主 session 抽查清单

每次派 agent 后，主 session 应抽查（不依赖测试框架）：

| 检查 | 命令 |
|------|-----|
| 文件存在 | `Bash: ls -la <reported-path>` |
| 行号准确 | `Bash: wc -l <index-file>` |
| frontmatter 正确 | `Read <detail-file>` 前 15 行 |
| Hook log 一致 | `Bash: tail -20 <pace-hooks.log>` |
| 索引行匹配 | `Bash: grep "<chg-id>" <index-file>` |

### 11.2 主 session 偏差处理

发现 agent 报告与实际不符时：
1. 派 record-correction 记录（`root-cause: agent-report-mismatch`）
2. 主 session 自己 Edit 修复实际状态
3. 累计 3 次同 root-cause → 升级 finding

### 11.3 Hook log 自动审计

```bash
# 每周跑一次
grep -E "act=DENY|act=ERROR|WARN" \
  /home/paceaitian/.claude/plugins/cache/paceaitian-paceflow/paceflow/5.1.4/hooks/pace-hooks.log \
  | tail -50
```

---

## 12. 验收标准

### 12.1 v6.0.0 发布前必达

- Phase A：5/5 PASS
- Phase B：5/5 正确报告 FAILED
- Phase C：5/5 PASS（生命周期完整）
- Phase D：核心 3/5 PASS（D1, D2, D5）
- 一次成功率 ≥ 95%
- 平均 token ≤ 7K

### 12.2 v6.5.0（dogfood 后）必达

- Phase E 持续 1-2 周后：
  - 总调用 ≥ 50 次
  - 一次成功率 ≥ 90%
  - 失败模式 top 3 全部修复
  - 主 session 抽查偏差率 ≤ 5%

### 12.3 v7.0.0 必达

- 删除 v5 兼容代码后（如决定全面 v6）：
  - 所有 Phase 重测
  - agent / spec / instructions 进一步精简
  - 一次成功率 ≥ 98%

---

## 13. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 测试用例污染真实 vault | 用 `/tmp/test-vault-*/` fixture，与生产 vault 隔离 |
| subagent 行为不可重现 | 用 fixture + 固定 model（sonnet）+ 严格 prompt |
| 测试 fixture 老化（不反映真实 v6 状态） | 每月用真实 PACEflow vault 快照刷新 fixture |
| Phase E dogfood 数据不足 | 鼓励主开发者所有 artifact 操作走 agent |
| 测试通过但生产失败 | fixture 与生产 vault 数据形态对齐 |
| 并行测试冲突 | 不同测试用不同 target，避免同一 vault 同名文件 |

---

## 附录 A：完整测试用例清单

### Phase A（5 个）

| ID | 指令 | 输入要点 |
|----|------|--------|
| TC-A1 | create-chg | title="A1 test", tasks=2, type=change |
| TC-A2 | update-chg | target=A1, action=append, section=tasks |
| TC-A3 | archive-chg | target=A1（先标 [x] 任务），summary="A1 done" |
| TC-A4 | record-finding | title="A4 test", impact=P3, body 简短 |
| TC-A5 | record-correction | trigger/wrong/correct/scenario/cause 各填，project-only |

### Phase B（5 个）

| ID | 指令 | 错误注入 |
|----|------|--------|
| TC-B1 | create-chg | 缺 title |
| TC-B2 | update-chg | target=CHG-99999999-99 |
| TC-B3 | archive-chg | 任务有 [/] |
| TC-B4 | record-finding | summary 250 字符 |
| TC-B5 | record-correction | wrong-behavior 10 字符 |

### Phase C（1 个生命周期）

| ID | 步骤 | 指令 |
|----|------|------|
| TC-C1.1 | 创建 | create-chg（3 任务）|
| TC-C1.2 | 状态变更 | update-chg（T-901 → [/]）|
| TC-C1.3 | 工作记录 | update-chg（append work-record）|
| TC-C1.4 | 全部完成 | update-chg（T-901/902/903 → [x]）|
| TC-C1.5 | 归档 | archive-chg |

### Phase D（5 个）

| ID | 场景 |
|----|------|
| TC-D1 | corrections.md 不存在（已在 PoC v3 验证 PASS）|
| TC-D2 | 大 finding body（10K tokens）|
| TC-D3 | ARCHIVE 标记缺失 |
| TC-D4 | 并行 2 subagent |
| TC-D5 | wikilink 指向不存在文件 |

---

## 附录 B：测试框架代码示例

### B.1 subagent-runner.js（核心调用逻辑）

```javascript
const fs = require('fs');
const yaml = require('js-yaml');

async function runAgent(testInput) {
  const prompt = buildPrompt(testInput);
  // 使用 Anthropic API 派 subagent，model=sonnet
  const result = await callAgent({
    description: testInput.description,
    subagent_type: 'general-purpose',
    prompt,
  });

  return {
    raw_report: result.text,
    tokens: result.usage.total_tokens,
    duration_ms: result.duration_ms,
    parsed: parseAgentReport(result.text),
  };
}

function buildPrompt(testInput) {
  const fields = yaml.dump({ operation: testInput.operation, fields: testInput.fields });
  return `
你是 paceflow-artifact-writer agent。

## Step 0
Read agents/paceflow-artifact-writer.md（system prompt 来源）

## Step 1
执行：
\`\`\`yaml
${fields}
\`\`\`

## Step 2
ARTIFACT_DIR = ${testInput.project_path}
真实创建文件，按 system prompt 报告格式输出。
`;
}
```

### B.2 verify-output.js（产出验证）

```javascript
async function verifyOutput(agentResult, expected) {
  const diffs = [];

  // 验证 status
  if (agentResult.parsed.status !== expected.status) {
    diffs.push({ field: 'status', expected: expected.status, actual: agentResult.parsed.status });
  }

  // 验证文件创建
  for (const f of expected.files_created || []) {
    const resolvedPath = resolveTemplate(f, expected); // 替换 {date} 等
    if (!fs.existsSync(resolvedPath)) {
      diffs.push({ field: 'files_created', path: resolvedPath, missing: true });
    }
  }

  // 验证 token
  if (agentResult.tokens > expected.max_tokens) {
    diffs.push({ field: 'tokens', expected: `≤ ${expected.max_tokens}`, actual: agentResult.tokens });
  }

  // 验证 frontmatter schema
  for (const f of expected.files_created || []) {
    const content = fs.readFileSync(f, 'utf8');
    const fm = parseFrontmatter(content);
    const errors = validateSchema(fm, getSchemaForFile(f));
    if (errors.length > 0) {
      diffs.push({ field: 'frontmatter', path: f, errors });
    }
  }

  return {
    passed: diffs.length === 0,
    diffs,
  };
}
```

### B.3 fixture-setup.js（测试前 setup）

```javascript
async function setupFixture(fixtureName) {
  const fixturePath = `tests/agent-tests/fixtures/${fixtureName}`;
  const targetPath = `/tmp/test-vault-${Date.now()}-${fixtureName}`;

  // 复制 fixture 到临时目录
  await copyDirRecursive(fixturePath, targetPath);

  return { project_path: targetPath };
}

async function teardownFixture(targetPath) {
  // 保留产出便于人工检查（不自动删）
  console.log(`Test artifacts retained at: ${targetPath}`);
}
```

---

## 14. 实施路径

```
阶段 0：当前（已完成 v3.1 + PoC v1/v2/v3 验证）
   ↓
阶段 1：Phase A 并行测试（~30 min）
   └── 派 5 个 subagent 跑 TC-A1~TC-A5
       ↓
阶段 2：评估 Phase A 结果，决定是否启动 Phase B/C/D
   ↓
阶段 3：测试框架建设（~3-4 小时）
   ├── tests/agent-tests/ 目录结构
   ├── run-tests.js 运行器
   ├── fixtures/（empty-v6 / populated-v6 等）
   └── 5+10+1+5 = 21 个测试用例 YAML
       ↓
阶段 4：Phase E Long-term Dogfood（持续 1-2 周）
   └── PACEflow 自身使用 + 数据收集
       ↓
阶段 5：v6.0.0 发布前最终验收
   └── 所有 Phase 通过 + KPI 达标
```

---

## 15. 待决策项

1. 是否立即启动 Phase A（并行 5 subagent，~30 min）？
2. 是否同步建测试框架（阶段 3，~3-4 小时）？
3. 是否调整 KPI（如一次成功率从 95% 提至 98%）？
4. 是否扩展 Phase E 到 ccauth 项目（验证大型项目场景）？
