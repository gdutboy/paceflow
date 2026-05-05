# Production Prompt Smoke Commands

> 用途：验证真实主 session 派发路径。`prepare --mode production` 只输出
> `ARTIFACT_DIR`、`operation`、`fields`，不注入 harness 里的详细规范、spec 绝对路径、
> report title 约束或资源约束。
>
> 先用 GLM 5.1 跑本清单；v4pro 可作为对照。D2 large-body 不放入 hard gate，
> 单独作为模型内容保真 / 长文本搬运能力测试。

```bash
cd /mnt/k/AI/paceflow-hooks/paceflow
mkdir -p /tmp/paceflow-agent-baseline-production
```

不要并行执行使用同一 fixture 的 `prepare`。多个 case 共用 `/tmp/test-vault/empty-v6`，
必须按 prepare → verify → teardown 串行跑。

## Core Structural Cases

```bash
node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a1-create-chg.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a1-create-chg.yaml /tmp/paceflow-agent-baseline-production/tc-a1-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a1-create-chg.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a8-update-chg-verify.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a8-update-chg-verify.yaml /tmp/paceflow-agent-baseline-production/tc-a8-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a8-update-chg-verify.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b1-missing-title.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b1-missing-title.yaml /tmp/paceflow-agent-baseline-production/tc-b1-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b1-missing-title.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b7-out-of-scope.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b7-out-of-scope.yaml /tmp/paceflow-agent-baseline-production/tc-b7-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b7-out-of-scope.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b8-unknown-operation.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b8-unknown-operation.yaml /tmp/paceflow-agent-baseline-production/tc-b8-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b8-unknown-operation.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b9-not-pace-project.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b9-not-pace-project.yaml /tmp/paceflow-agent-baseline-production/tc-b9-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b9-not-pace-project.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-d/tc-d5-broken-wikilink.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-d/tc-d5-broken-wikilink.yaml /tmp/paceflow-agent-baseline-production/tc-d5-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-d/tc-d5-broken-wikilink.yaml
```

## Optional Content Fidelity Case

```bash
node tests/agent-tests/run-tests.js prepare cases/phase-d/tc-d2-large-body.yaml --mode production
node tests/agent-tests/run-tests.js verify cases/phase-d/tc-d2-large-body.yaml /tmp/paceflow-agent-baseline-production/tc-d2-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-d/tc-d2-large-body.yaml
```

## Review Outputs

```bash
git status --short --branch
```

审查：
- `/tmp/claude-1000/response.md`
- `/tmp/paceflow-agent-baseline-production/*-report.json`
- `tests/agent-tests/results/<date>/*.report.md`
