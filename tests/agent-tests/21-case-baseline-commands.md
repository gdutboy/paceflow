# 21-case Agent Baseline Commands

> 用途：PACEflow v6 agent fixture 全量 baseline（Phase A 8 个 + Phase B 9 个 + Phase D 4 个）。
>
> 每个 case 的流程固定为：
> 1. `prepare` 输出 agent prompt
> 2. 在 Claude Code 主 session 派遣 `paceflow-artifact-writer`
> 3. 将 agent 报告保存为 `/tmp/paceflow-agent-baseline/<tc-id>-report.json`
> 4. `verify`
> 5. `teardown`

```bash
cd /mnt/k/AI/paceflow-hooks/paceflow
mkdir -p /tmp/paceflow-agent-baseline
```

## Phase A

```bash
node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a1-create-chg.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a1-create-chg.yaml /tmp/paceflow-agent-baseline/tc-a1-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a1-create-chg.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a2-update-chg.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a2-update-chg.yaml /tmp/paceflow-agent-baseline/tc-a2-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a2-update-chg.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a3-archive-chg.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a3-archive-chg.yaml /tmp/paceflow-agent-baseline/tc-a3-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a3-archive-chg.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a4-record-finding.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a4-record-finding.yaml /tmp/paceflow-agent-baseline/tc-a4-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a4-record-finding.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a5-record-correction.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a5-record-correction.yaml /tmp/paceflow-agent-baseline/tc-a5-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a5-record-correction.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a6-hotfix.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a6-hotfix.yaml /tmp/paceflow-agent-baseline/tc-a6-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a6-hotfix.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a7-merges-field.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a7-merges-field.yaml /tmp/paceflow-agent-baseline/tc-a7-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a7-merges-field.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-a/tc-a8-update-chg-verify.yaml
node tests/agent-tests/run-tests.js verify cases/phase-a/tc-a8-update-chg-verify.yaml /tmp/paceflow-agent-baseline/tc-a8-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-a/tc-a8-update-chg-verify.yaml
```

## Phase B

```bash
node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b1-missing-title.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b1-missing-title.yaml /tmp/paceflow-agent-baseline/tc-b1-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b1-missing-title.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b2-target-not-found.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b2-target-not-found.yaml /tmp/paceflow-agent-baseline/tc-b2-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b2-target-not-found.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b3-archive-with-in-progress.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b3-archive-with-in-progress.yaml /tmp/paceflow-agent-baseline/tc-b3-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b3-archive-with-in-progress.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b4-summary-too-long.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b4-summary-too-long.yaml /tmp/paceflow-agent-baseline/tc-b4-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b4-summary-too-long.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b5-wrong-behavior-too-short.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b5-wrong-behavior-too-short.yaml /tmp/paceflow-agent-baseline/tc-b5-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b5-wrong-behavior-too-short.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b6-id-mismatch.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b6-id-mismatch.yaml /tmp/paceflow-agent-baseline/tc-b6-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b6-id-mismatch.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b7-out-of-scope.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b7-out-of-scope.yaml /tmp/paceflow-agent-baseline/tc-b7-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b7-out-of-scope.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b8-unknown-operation.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b8-unknown-operation.yaml /tmp/paceflow-agent-baseline/tc-b8-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b8-unknown-operation.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-b/tc-b9-not-pace-project.yaml
node tests/agent-tests/run-tests.js verify cases/phase-b/tc-b9-not-pace-project.yaml /tmp/paceflow-agent-baseline/tc-b9-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-b/tc-b9-not-pace-project.yaml
```

## Phase D

```bash
node tests/agent-tests/run-tests.js prepare cases/phase-d/tc-d1-corrections-md-missing.yaml
node tests/agent-tests/run-tests.js verify cases/phase-d/tc-d1-corrections-md-missing.yaml /tmp/paceflow-agent-baseline/tc-d1-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-d/tc-d1-corrections-md-missing.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-d/tc-d2-large-body.yaml
node tests/agent-tests/run-tests.js verify cases/phase-d/tc-d2-large-body.yaml /tmp/paceflow-agent-baseline/tc-d2-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-d/tc-d2-large-body.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-d/tc-d3-archive-marker-missing.yaml
node tests/agent-tests/run-tests.js verify cases/phase-d/tc-d3-archive-marker-missing.yaml /tmp/paceflow-agent-baseline/tc-d3-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-d/tc-d3-archive-marker-missing.yaml

node tests/agent-tests/run-tests.js prepare cases/phase-d/tc-d5-broken-wikilink.yaml
node tests/agent-tests/run-tests.js verify cases/phase-d/tc-d5-broken-wikilink.yaml /tmp/paceflow-agent-baseline/tc-d5-report.json
node tests/agent-tests/run-tests.js teardown cases/phase-d/tc-d5-broken-wikilink.yaml
```

## After Run

```bash
git status --short --branch
```

跑完后审查：
- `/tmp/claude-1000/response.md`
- `/tmp/paceflow-agent-baseline/*-report.json`
- `tests/agent-tests/results/<date>/*.report.md`
