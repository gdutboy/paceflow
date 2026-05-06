# artifact-writer 测试框架

> v6.0.0 Phase A-D 测试套件。Phase A 已就绪。

## 目录结构

```
tests/agent-tests/
├── README.md                # 本文件
├── run-tests.js             # 主运行器（CLI: node run-tests.js [phase]）
├── cases/                   # 测试用例（YAML）
│   └── phase-a/             # 核心指令 happy path
├── fixtures/                # vault 状态快照（cp -r 到临时目录后跑测试）
│   └── empty-v6/            # 空 v6 项目（5 索引模板 + 空 changes/）
├── helpers/                 # 框架基础设施
│   ├── fixture-setup.js     # cp -r fixture → /tmp/test-vault/
│   ├── fixture-teardown.js  # rm -rf /tmp/test-vault/
│   ├── subagent-runner.js   # 协调 artifact-writer 派遣 + 报告捕获
│   └── verify-output.js     # YAML expected vs 真实产出对比
└── results/                 # 历史结果（按日期分组，git-ignored）
    └── YYYY-MM-DD/
        ├── manifest.json    # 本次运行元数据 + 各用例 PASS/FAIL 摘要
        └── tc-*.report.md   # 每个用例的详细报告
```

## 用法

### 一次性自测框架

```bash
cd paceflow/tests/agent-tests
node run-tests.js dummy        # 跑 mock 用例验证框架基础设施
```

### 跑 Phase A（v6.0.0 重测）

由于 Claude Code Agent tool 必须在主 session 内调用，**Phase 1 半自动模式**：

1. 主 session 内逐个跑用例：
   ```javascript
   // 主 session 跑：
   const runner = require('./helpers/subagent-runner');
   const tc = runner.loadCase('cases/phase-a/tc-a1-create-chg.yaml');
   await runner.setupFixture(tc);
   // 主 session 派遣 artifact-writer agent，prompt 由 runner 生成
   // agent 完成后，主 session 调用 verify
   await runner.verifyAndReport(tc, agentReport);
   await runner.teardown(tc);
   ```

2. 命令行批量（Phase 2，需研究 `claude --agent` CLI 子命令）：
   ```bash
   node run-tests.js A    # 自动迭代 phase-a/*.yaml
   ```

## 用例 YAML 格式

```yaml
id: TC-A1
phase: A
indication: smoke-test-create-chg
description: 验证 create-chg happy path

setup:
  fixture: empty-v6              # fixtures/<name>/
  variables:
    project_path: /tmp/test-vault/empty-v6

input:
  operation: create-chg
  fields:
    title: ...
    tasks: ["T-NNN: ..."]

expected:
  status: SUCCESS
  files_created: ["changes/chg-{date}-01.md"]
  files_modified: ["task.md", "implementation_plan.md"]
  validations:
    frontmatter_schema: pass
    wikilink_integrity: pass
  max_tokens: 40000
  max_duration_ms: 180000
  max_tool_uses: 12        # 可选；用于捕获 over-investigation

teardown:
  cleanup: true
```

`{date}` 由 runner 替换为 `YYYYMMDD`（运行日）。

## 验收标准（Phase A）

- 5/5 PASS
- 各用例资源预算通过：`max_tokens` / `max_duration_ms` / 可选 `max_tool_uses`
- 验证项全 pass（schema / wikilink / cross_index）

预算说明：`max_tokens` 使用 Claude Code subagent 的 `total_tokens`，包含 agent 启动、system prompt、spec/instruction Read 和工具回环成本；当前实测标准预算为 35-40K，而不是早期 PoC 的 5-8K。

未达标 → 看 `results/<date>/manifest.json` + tc-*.report.md 定位失败根因，决定修 agent / spec / instructions / fixture。

## 关联文档

- `docs/agent-testing-strategy.md`：完整 5 Phase 策略 + 验收
- `docs/v6.0.0-design.md`：架构设计
- `agents/artifact-writer.md`：被测 agent
- `ticket.md`：Sprint 3 实施记录
