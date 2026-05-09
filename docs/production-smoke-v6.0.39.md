# PACEflow v6.0.39 Production Smoke

> Purpose: verify the installed marketplace plugin in real Claude Code main sessions.
> This is different from fixture baselines and hook unit tests.
> Run these after installing PaceFlow from marketplace.
> Claude Code native builds may not expose `Glob` / `Grep` as standalone tools; if a main session reports `No such tool available: Glob`, treat Bash `find` / `rg` / `grep` fallback as expected behavior, not a PaceFlow failure.

## Preconditions

Use a fresh Claude Code session after installing PaceFlow from marketplace.

Expected plugin:

```text
paceflow @ paceaitian-paceflow
Version: 6.0.39
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
PLUGIN_DIR="$HOME/.claude/plugins/cache/paceaitian-paceflow/paceflow/6.0.39"
test -d "$PLUGIN_DIR"
tail -n 80 "$PLUGIN_DIR/hooks/pace-hooks.log"
```

If the cache path differs, find it with:

```bash
find "$HOME/.claude/plugins" -path '*paceaitian-paceflow*paceflow*6.0.39*' -type d | head
```

Useful evidence to capture after each smoke:

```bash
tail -n 200 "$PLUGIN_DIR/hooks/pace-hooks.log"
ls -la
find . -maxdepth 3 -type f | sort
```

Claude Code conversation logs are usually under:

```bash
find "$HOME/.claude/projects" -type f -name '*.jsonl' -mmin -120 | sort
```

## Smoke 0: Clean Project Idle Start

Create a small local project:

```bash
rm -rf /mnt/k/AI/paceflow-smoke-local
mkdir -p /mnt/k/AI/paceflow-smoke-local
cd /mnt/k/AI/paceflow-smoke-local

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

Start Claude Code in `/mnt/k/AI/paceflow-smoke-local`.

First message:

```text
hi
```

Expected:

- No `AskUserQuestion` yet.
- No local `task.md`, `implementation_plan.md`, or `changes/`.
- No Obsidian `projects/paceflow-smoke-local` folder created just by SessionStart.
- No `.pace/` created just by idle SessionStart.

Verify outside Claude Code:

```bash
cd /mnt/k/AI/paceflow-smoke-local
test ! -e task.md
test ! -d changes
test ! -d .pace
```

## Smoke 1: Local Artifact Root + Create CHG

In Claude Code:

```text
按 PACEflow v6 执行一个小改动：给 calc.js 增加 multiply(a,b)，并给 calc.test.js 增加测试。
```

When PaceFlow asks where to store artifacts, choose:

```text
本地项目目录
```

Expected:

- PreToolUse blocks the first code edit until artifact root is chosen.
- Main session uses `AskUserQuestion`.
- `.pace/artifact-root` contains `local`.
- Root artifacts are lazily created in `/mnt/k/AI/paceflow-smoke-local`.
- `artifact-writer` creates `changes/chg-*.md` plus matching `task.md` / `implementation_plan.md` wikilinks.
- Main session should ask for or infer C-stage approval before code edit; if you approve execution, it should use `approve-and-start`, not separate approve + start operations.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-local
test "$(tr -d '\r\n' < .pace/artifact-root)" = "local"
test -d changes
test -f task.md
test -f implementation_plan.md
find changes -maxdepth 1 -type f -name 'chg-*.md' -print
rg 'chg-[0-9]{8}-[0-9]{2}' task.md implementation_plan.md
rg 'schema-version: "6.0"|verified-date: null|<!-- APPROVED -->|status: in-progress' changes/chg-*.md
```

## Smoke 2: Code Edit + Validation + close-chg

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
cd /mnt/k/AI/paceflow-smoke-local
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
rm -rf /mnt/k/AI/paceflow-smoke-vault
rm -rf "/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-smoke-vault"
mkdir -p /mnt/k/AI/paceflow-smoke-vault
cd /mnt/k/AI/paceflow-smoke-vault
printf 'console.log("vault smoke")\n' > index.js
printf 'console.log("test ok")\n' > test.js
printf 'notes\n' > README.md
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-vault`.

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
- Artifact files are created under `$PACE_VAULT_PATH/projects/paceflow-smoke-vault`.
- Local project root should not contain `task.md` or `changes/`.
- `artifact-writer` prompt must include the vault artifact directory; wrong local/doc subdir should be denied by hook.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-vault
test "$(tr -d '\r\n' < .pace/artifact-root)" = "vault"
test ! -e task.md
test ! -d changes

VAULT_PROJECT="/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian/projects/paceflow-smoke-vault"
test -d "$VAULT_PROJECT/changes"
rg 'chg-[0-9]{8}-[0-9]{2}' "$VAULT_PROJECT/task.md" "$VAULT_PROJECT/implementation_plan.md"
```

## Smoke 4: v5 Migration Guard

Create a legacy-looking v5 project with root artifact files but no `changes/`:

```bash
rm -rf /mnt/k/AI/paceflow-smoke-v5
mkdir -p /mnt/k/AI/paceflow-smoke-v5
cd /mnt/k/AI/paceflow-smoke-v5

cat > task.md <<'EOF'
# 项目任务追踪

## 活跃任务

- [/] Legacy v5 task

<!-- ARCHIVE -->
EOF

printf 'console.log("legacy a")\n' > a.js
printf 'console.log("legacy b")\n' > b.js
printf 'console.log("legacy c")\n' > c.js
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-v5`.

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
cd /mnt/k/AI/paceflow-smoke-v5
test ! -d changes
rg 'Legacy v5 task' task.md
```

## Smoke 5: Worktree Routing + Artifact Writer Lock

Use the git-backed project from Smoke 1/2:

```bash
cd /mnt/k/AI/paceflow-smoke-local
git init
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m "smoke base" || \
  git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit --allow-empty -m "smoke base"

git worktree remove ../paceflow-smoke-local-wt --force 2>/dev/null || true
git branch -D smoke-wt 2>/dev/null || true
git worktree add ../paceflow-smoke-local-wt -b smoke-wt
```

Start two Claude Code sessions:

- Session A cwd: `/mnt/k/AI/paceflow-smoke-local`
- Session B cwd: `/mnt/k/AI/paceflow-smoke-local-wt`

In Session A, start an artifact-heavy operation:

```text
记录一个较长的 PACEflow finding，标题是 worktree lock smoke，正文写 30 条编号观察，用 record-finding。
```

Immediately in Session B:

```text
同时创建另一个小 CHG：在 README.md 追加一行 worktree smoke。
```

Expected:

- Worktree resolves to the host project artifact root, not a separate worktree artifact directory.
- If Session A still holds `artifact-writer.lock`, Session B artifact-writer dispatch is denied with "已有 artifact-writer 正在写入".
- Session B must wait/retry; it must not delete or rewrite `.pace/artifact-writer.lock`.
- When Session A finishes or fails, `SubagentStop` / `PostToolUseFailure:Agent` releases the lock.

Verify:

```bash
HOST=/mnt/k/AI/paceflow-smoke-local
WT=/mnt/k/AI/paceflow-smoke-local-wt
test -f "$HOST/.pace/artifact-root"
test ! -f "$WT/.pace/artifact-root" || cat "$WT/.pace/artifact-root"
test ! -f "$HOST/.pace/artifact-writer.lock" || cat "$HOST/.pace/artifact-writer.lock"
tail -n 200 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'ARTIFACT_LOCK|DENY_ARTIFACT_LOCK|RELEASE_ARTIFACT_LOCK|sid='
```

If both operations finish too quickly to overlap, this smoke still verifies routing. The lock-deny path is covered by E2E; rerun with a longer finding body if you need production overlap.

## Smoke 6: Bash Artifact Write Protection

Run in `/mnt/k/AI/paceflow-smoke-local`.

Prompt:

```text
尝试用 Bash 命令直接修改 task.md，比如 echo test >> task.md，看看 PACEflow 是否会阻止。不要绕过 hook。
```

Expected:

- PreToolUse denies the Bash write.
- `task.md` is not modified by Bash.
- The model must not use Bash to edit artifacts.

Then prompt:

```text
尝试用 Bash 删除 .pace/artifact-writer.lock，确认 hook 是否阻止。不要绕过 hook。
```

Expected:

- Any Bash mutation targeting `.pace/artifact-writer.lock` is denied.
- The model must not suggest deleting or rewriting the lock.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-local
tail -n 200 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'DENY_BASH|artifact-writer.lock|task.md'
```

## Smoke 7: Plan Bridge Reminder

This checks project-local plan bridging. Native global `/plan` files under `~/.claude/plans/` are version-dependent; this project-local smoke is the stable route.

Create a project-local plan in the local smoke project:

```bash
cd /mnt/k/AI/paceflow-smoke-local
mkdir -p docs/superpowers/plans
cat > docs/superpowers/plans/2026-05-09-bridge-smoke.md <<'EOF'
# Bridge smoke plan

Project: paceflow-smoke-local

## Goal

Add a divide(a,b) helper and a minimal test.

## Tasks

- Add divide(a,b) to calc.js.
- Add divide test to calc.test.js.
- Run npm test.
EOF
```

Start a fresh Claude Code session in `/mnt/k/AI/paceflow-smoke-local`.

Prompt:

```text
根据 docs/superpowers/plans/2026-05-09-bridge-smoke.md 执行这个计划。
```

Expected:

- The session should use `paceflow:pace-bridge` or follow the bridge hint.
- It should Read the plan and dispatch `artifact-writer create-chg`.
- If the plan is treated as already confirmed and ready to execute, it may then dispatch `approve-and-start` with approval evidence.
- It must not directly edit code before the plan is bridged into `changes/<id>.md`.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-local
rg 'divide|bridge smoke' task.md implementation_plan.md changes/*.md
rg '2026-05-09-bridge-smoke.md|docs/superpowers/plans' .pace/synced-plans 2>/dev/null || true
```

## Optional: Native Plan Project Filtering

This checks the v6.0.37+ guard that prevents global `~/.claude/plans` files from another project being bridged into the current project.

Prepare two recent native-like plan files:

```bash
mkdir -p "$HOME/.claude/plans"
cat > "$HOME/.claude/plans/foreign-project-smoke.md" <<'EOF'
# Foreign Project Smoke

This plan belongs to /mnt/k/AI/some-other-project and should not match paceflow-smoke-local.
EOF

cat > "$HOME/.claude/plans/paceflow-smoke-local-native.md" <<'EOF'
# paceflow-smoke-local Native Plan

This plan belongs to /mnt/k/AI/paceflow-smoke-local.
EOF
touch "$HOME/.claude/plans/foreign-project-smoke.md" "$HOME/.claude/plans/paceflow-smoke-local-native.md"
```

In Claude Code under `/mnt/k/AI/paceflow-smoke-local`, trigger compact or continue a session until PreCompact runs.

Expected:

- The foreign plan is ignored.
- Only a plan that matches the current project path/name may become `.pace/current-native-plan`.
- Hook log may contain `NATIVE_PLAN_SKIP_FOREIGN` for non-matching candidates.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-local
test ! -f .pace/current-native-plan || cat .pace/current-native-plan
tail -n 200 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'NATIVE_PLAN|current-native-plan|PreCompact'
```

## Pass Criteria

Production smoke is acceptable when:

- Idle SessionStart does not create artifact files or Obsidian empty project folders.
- First real write asks artifact root exactly once and persists `.pace/artifact-root`.
- Local choice writes artifacts in project root; vault choice writes under `$PACE_VAULT_PATH/projects/<project>`.
- `create-chg`, `approve-and-start`, code edit, validation, and `close-chg` complete without manual artifact edits.
- `close-chg` produces verified + archived detail and archives task/impl index rows.
- Legacy v5 project triggers migration guard before any v6 `changes/` creation.
- Worktree does not split artifacts; concurrent artifact-writer dispatch is serialized or denied.
- Bash cannot directly or indirectly mutate artifacts or `.pace/artifact-writer.lock`.
- Plan bridge does not allow code edits before a plan is represented as v6 artifacts.
- Hook log includes useful `sid=` fields for deny/pass/release events.
