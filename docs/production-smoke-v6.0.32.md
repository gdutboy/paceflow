# PACEflow v6.0.32 Production Smoke

> Purpose: verify the installed marketplace plugin in a real Claude Code main session.
> This is different from `tests/agent-tests/*` fixture baselines.

## Preconditions

Use a fresh Claude Code session after installing PaceFlow from marketplace.

Expected plugin:

```text
paceflow @ paceaitian-paceflow
Version: 6.0.32
Installed components:
  Agents: artifact-writer
  Skills: artifact-management, pace-bridge, pace-knowledge, pace-workflow
  Hooks: SessionStart, PreToolUse, PostToolUse, PostToolUseFailure, SubagentStop, PreCompact, Stop, StopFailure
```

Optional vault env for vault-route tests:

```bash
export PACE_VAULT_PATH="/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian"
```

Plugin log path:

```bash
PLUGIN_DIR="$HOME/.claude/plugins/cache/paceaitian-paceflow/paceflow/6.0.32"
tail -n 80 "$PLUGIN_DIR/hooks/pace-hooks.log"
```

If the cache path differs, find it with:

```bash
find "$HOME/.claude/plugins" -path '*paceaitian-paceflow*paceflow*6.0.32*' -type d | head
```

## Smoke 0: Clean Project

Create a small local project:

```bash
rm -rf /mnt/k/AI/paceflowv6test
mkdir -p /mnt/k/AI/paceflowv6test
cd /mnt/k/AI/paceflowv6test
cat > calc.js <<'EOF'
export function add(a, b) {
  return a + b;
}
EOF
cat > calc.test.js <<'EOF'
import { add } from './calc.js';

if (add(1, 2) !== 3) throw new Error('add failed');
console.log('ok');
EOF
cat > package.json <<'EOF'
{"type":"module","scripts":{"test":"node calc.test.js"}}
EOF
```

Start Claude Code in `/mnt/k/AI/paceflowv6test`.

First message:

```text
hi
```

Expected:

- No `AskUserQuestion` yet.
- No local `task.md`, `implementation_plan.md`, or `changes/`.
- No Obsidian `projects/paceflowv6test` folder created just by SessionStart.
- No `.pace/` created just by idle SessionStart.

Verify outside Claude Code:

```bash
cd /mnt/k/AI/paceflowv6test
test ! -e task.md
test ! -d changes
test ! -d .pace
```

## Smoke 1: Local Artifact Root + Create CHG

In Claude Code:

```text
在这个项目中按 PACEflow v6 执行一个小改动：给 calc.js 增加 multiply(a,b)，并给 calc.test.js 增加测试。
```

When PaceFlow asks where to store artifacts, choose:

```text
本地项目目录
```

Expected:

- PreToolUse blocks the first code edit until artifact root is chosen.
- Main session uses `AskUserQuestion`.
- `.pace/artifact-root` contains `local`.
- Root artifacts are lazily created in `/mnt/k/AI/paceflowv6test`.
- `artifact-writer` creates `changes/chg-*.md` plus matching `task.md` / `implementation_plan.md` wikilinks.
- Main session should ask for or infer C-stage approval before code edit; if you approve execution, it should use `approve-and-start`, not separate approve + start operations.

Verify:

```bash
cd /mnt/k/AI/paceflowv6test
test "$(tr -d '\r\n' < .pace/artifact-root)" = "local"
test -d changes
test -f task.md
test -f implementation_plan.md
find changes -maxdepth 1 -type f -name 'chg-*.md' -print
rg 'chg-[0-9]{8}-[0-9]{2}' task.md implementation_plan.md
rg 'schema-version: "6.0"|verified-date: null|<!-- APPROVED -->|status: in-progress' changes/chg-*.md
```

## Smoke 2: Code Edit + Verification + close-chg

In Claude Code, approve execution if not already done:

```text
我确认这个方案可以执行。完成代码修改，运行测试；如果测试通过，就按 v6 收尾归档这个 CHG。
```

Expected:

- Code files are edited.
- Bash validation runs and output is read.
- After validation passes, main session dispatches one `close-chg complete-open-tasks:true` operation.
- `close-chg` writes `<!-- VERIFIED -->`, non-null `verified-date`, `status: archived`, non-null `archived-date`, updates walkthrough, and moves task/impl index rows below `<!-- ARCHIVE -->`.

Verify:

```bash
cd /mnt/k/AI/paceflowv6test
npm test
rg 'multiply' calc.js calc.test.js
rg '<!-- VERIFIED -->|verified-date: [0-9].*\+08:00|status: archived|archived-date: [0-9].*\+08:00' changes/chg-*.md
awk '/<!-- ARCHIVE -->/{p=1; next} p && /chg-[0-9]{8}-[0-9]{2}/{print}' task.md
awk '/<!-- ARCHIVE -->/{p=1; next} p && /chg-[0-9]{8}-[0-9]{2}/{print}' implementation_plan.md
rg "$(date +%F)" walkthrough.md
```

## Smoke 3: Vault Artifact Root

Use a second clean project:

```bash
rm -rf /mnt/k/AI/paceflowv6vaulttest
rm -rf "/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflowv6vaulttest"
mkdir -p /mnt/k/AI/paceflowv6vaulttest
cd /mnt/k/AI/paceflowv6vaulttest
printf 'console.log("vault smoke")\n' > index.js
printf 'console.log("test ok")\n' > test.js
printf 'notes\n' > README.md
```

Start Claude Code in `/mnt/k/AI/paceflowv6vaulttest`.

Prompt:

```text
按 PACEflow v6 为这个项目创建一个小变更：把 index.js 的输出改成 "vault smoke ok"，并运行 node index.js 验证。
```

Choose:

```text
Obsidian vault project
```

Expected:

- `.pace/artifact-root` contains `vault`.
- Artifact files are created under `$PACE_VAULT_PATH/projects/paceflowv6vaulttest`.
- Local project root should not contain `task.md` or `changes/`.
- `artifact-writer` prompt must include the vault artifact directory; wrong local/doc subdir should be denied by hook.

Verify:

```bash
cd /mnt/k/AI/paceflowv6vaulttest
test "$(tr -d '\r\n' < .pace/artifact-root)" = "vault"
test ! -e task.md
test ! -d changes
VAULT_PROJECT="/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflowv6vaulttest"
test -d "$VAULT_PROJECT/changes"
rg 'chg-[0-9]{8}-[0-9]{2}' "$VAULT_PROJECT/task.md" "$VAULT_PROJECT/implementation_plan.md"
```

## Smoke 4: v5 Migration Guard

Create a legacy-looking v5 project with root artifact files but no `changes/`:

```bash
rm -rf /mnt/k/AI/paceflow-v5-legacy-smoke
mkdir -p /mnt/k/AI/paceflow-v5-legacy-smoke
cd /mnt/k/AI/paceflow-v5-legacy-smoke
cat > task.md <<'EOF'
# 项目任务追踪

## 活跃任务

- [/] Legacy v5 task

<!-- ARCHIVE -->
EOF
printf 'console.log("legacy")\n' > a.js
printf 'console.log("legacy")\n' > b.js
printf 'console.log("legacy")\n' > c.js
```

Start Claude Code in `/mnt/k/AI/paceflow-v5-legacy-smoke`.

Prompt:

```text
把 a.js 的输出改成 legacy ok，按 PACEflow 执行。
```

Expected:

- Hook should not ask artifact-root first.
- Hook should detect legacy v5 artifact and ask for migration/bridge decision.
- Before user confirms migration, no `changes/` should be created.
- `artifact-writer create-chg` must not be allowed to mix v6 details into legacy root files.

Verify:

```bash
cd /mnt/k/AI/paceflow-v5-legacy-smoke
test ! -d changes
rg 'Legacy v5 task' task.md
```

## Smoke 5: Worktree Routing + Artifact Writer Lock

Use a git-backed project after Smoke 1 or create a fresh repo:

```bash
cd /mnt/k/AI/paceflowv6test
git init
git add calc.js calc.test.js package.json task.md implementation_plan.md walkthrough.md findings.md corrections.md changes
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m "smoke base" || \
  git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit --allow-empty -m "smoke base"
git worktree remove ../paceflowv6test-wt --force 2>/dev/null || true
git branch -D smoke-wt 2>/dev/null || true
git worktree add ../paceflowv6test-wt -b smoke-wt
```

Start two Claude Code sessions:

- Session A cwd: `/mnt/k/AI/paceflowv6test`
- Session B cwd: `/mnt/k/AI/paceflowv6test-wt`

In Session A, start an artifact-heavy operation:

```text
记录一个较长的 PACEflow finding，标题是 worktree lock smoke，正文写 20 条编号观察，用 record-finding。
```

Immediately in Session B:

```text
同时创建另一个小 CHG：在 README.md 追加一行 worktree smoke。
```

Expected:

- Worktree resolves to the host project artifact root, not a separate worktree artifact directory.
- If Session A still holds `artifact-writer.lock`, Session B artifact-writer dispatch is denied with "已有 artifact-writer 正在写入".
- When Session A finishes or fails, `SubagentStop` / `PostToolUseFailure:Agent` releases the lock.

Verify:

```bash
HOST=/mnt/k/AI/paceflowv6test
WT=/mnt/k/AI/paceflowv6test-wt
test -f "$HOST/.pace/artifact-root"
test ! -f "$WT/.pace/artifact-root" || cat "$WT/.pace/artifact-root"
test ! -f "$HOST/.pace/artifact-writer.lock" || cat "$HOST/.pace/artifact-writer.lock"
tail -n 120 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'ARTIFACT_LOCK|DENY_ARTIFACT_LOCK|RELEASE_ARTIFACT_LOCK|sid:'
```

If both operations finish too quickly to overlap, this smoke still verifies routing. The lock-deny path is already covered by E2E; rerun with a longer finding body if you need a production overlap.

## Pass Criteria

Production smoke is acceptable when:

- Idle SessionStart does not create artifact files or Obsidian empty project folders.
- First real write asks artifact root exactly once and persists `.pace/artifact-root`.
- Local choice writes artifacts in project root; vault choice writes under `$PACE_VAULT_PATH/projects/<project>`.
- `create-chg`, `approve-and-start`, code edit, validation, and `close-chg` complete without manual artifact edits.
- `close-chg` produces verified + archived detail and archives task/impl index rows.
- Legacy v5 project triggers migration guard before any v6 `changes/` creation.
- Worktree does not split artifacts; concurrent artifact-writer dispatch is serialized or denied.
- Hook log includes useful `sid:` fields for deny/pass/release events.
