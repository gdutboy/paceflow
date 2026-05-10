# PACEflow v6.0.48 Production Smoke

> Focus: verify the installed marketplace plugin after the artifact-writer resource-lock rewrite and reserved-id re-dispatch fix.
> This is a focused smoke, not a replacement for unit tests or agent baselines.
> Run in real Claude Code sessions after installing/updating PaceFlow from marketplace and running `/reload plugin`.

## Preconditions

Find the installed runtime:

```bash
PLUGIN_DIR="$(find "$HOME/.claude/plugins/cache/paceaitian-paceflow/paceflow" -maxdepth 1 -mindepth 1 -type d | sort -V | tail -1)"
echo "$PLUGIN_DIR"
test -f "$PLUGIN_DIR/.claude-plugin/plugin.json"
node -e 'const p=require(process.argv[1]); console.log(p.version)' "$PLUGIN_DIR/.claude-plugin/plugin.json"
rg 'PACE_VERSION' "$PLUGIN_DIR/hooks/pace-utils.js"
```

Expected:

- Installed version is the current marketplace version.
- `PACE_VERSION` in `hooks/pace-utils.js` matches.
- Runtime root contains only plugin runtime assets, not repo development files:

```bash
find "$PLUGIN_DIR" -maxdepth 1 -mindepth 1 -printf '%f\n' | sort
test ! -d "$PLUGIN_DIR/docs"
test ! -d "$PLUGIN_DIR/tests"
test ! -d "$PLUGIN_DIR/internal"
```

Useful evidence:

```bash
tail -n 200 "$PLUGIN_DIR/hooks/pace-hooks.log"
find "$HOME/.claude/projects" -type f -name '*.jsonl' -mmin -180 | sort
```

## Smoke 1: Local Create + Close

Create a clean local project:

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

cat > smoke-helper.js <<'EOF'
export const smokeHelper = true;
EOF

cat > package.json <<'EOF'
{"type":"module","scripts":{"test":"node calc.test.js"}}
EOF
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-local`.

Prompt:

```text
按 PACEflow v6 执行一个小改动：给 calc.js 增加 multiply(a,b)，并给 calc.test.js 增加测试。artifact 选择本地项目目录。完成后运行 npm test；如果测试通过，就按 v6 收尾归档这个 CHG。
```

Expected:

- First real write asks artifact-root once; choose local.
- `.pace/artifact-root` contains `local`.
- After choosing local, code writes are not retried directly; main session first creates a CHG and then approves/starts it.
- First `create-chg` Agent dispatch without `reserved-id` is denied with `DENY_AGENT_RESERVED_PROMPT_REQUIRED`; main session must re-dispatch with the exact `reserved-id` and `reserved-file` from the hook message.
- `artifact-writer` creates one CHG detail and matching `task.md` / `implementation_plan.md` links.
- Main session edits code only after CHG is created and approved/started.
- Validation output is read before close.
- `close-chg complete-open-tasks:true` verifies and archives the CHG.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-local
npm test
test "$(tr -d '\r\n' < .pace/artifact-root)" = "local"
test -d changes
rg 'multiply' calc.js calc.test.js
rg 'chg-[0-9]{8}-[0-9]{2}' task.md implementation_plan.md
rg '<!-- VERIFIED -->|verified-date: [0-9].*\+08:00|status: archived|archived-date: [0-9].*\+08:00' changes/chg-*.md
awk '/<!-- ARCHIVE -->/{p=1; next} p && /chg-[0-9]{8}-[0-9]{2}/{print}' task.md
awk '/<!-- ARCHIVE -->/{p=1; next} p && /chg-[0-9]{8}-[0-9]{2}/{print}' implementation_plan.md
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'DENY_AGENT_RESERVED_PROMPT_REQUIRED|PASS_AGENT_ARTIFACT_BASE|DENY_AGENT_LIFECYCLE_PROMPT|close-chg'
```

## Smoke 2: Direct Artifact Write Protection

In the same project, ask Claude Code:

```text
尝试直接修改 task.md：先用 Bash echo test >> task.md；如果被拦，再尝试 Write 和 Edit。不要派 artifact-writer，目标是确认 hook 是否拦截主 session 直接改流程 artifact。
```

Expected:

- Bash write is denied.
- Write/Edit/MultiEdit to artifact-writer-managed files are denied for main session and non-artifact-writer agents.
- Denial tells the model to dispatch `paceflow:artifact-writer`; it must not suggest using Edit as the main-session recovery path.
- `task.md` remains unchanged.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-local
tail -n 200 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'DENY_BASH_ARTIFACT|DENY_DIRECT_ARTIFACT_(WRITE|EDIT)|task.md'
```

## Smoke 3: Worktree Concurrent Create

Prepare a git worktree from the local smoke project:

```bash
cd /mnt/k/AI/paceflow-smoke-local
git init
mkdir -p .pace
printf '*\n!.gitignore\n' > .pace/.gitignore
git rm --cached -r .pace 2>/dev/null || true
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

In Session A:

```text
按 PACEflow 创建一个 CHG：在 README.md 追加一行 host resource lock smoke，完成验证后归档。
```

Immediately in Session B:

```text
按 PACEflow 创建另一个 CHG：新增 branch-note.md，内容为 worktree resource lock smoke，完成验证后归档。
```

Expected for v6.0.48:

- Both sessions resolve to the host project artifact root.
- `PreToolUse:Agent` must not deny merely because another artifact-writer agent is running.
- Each first `create-chg` Agent dispatch may be denied once with a unique `reserved-id`; the retry with that exact `reserved-id` / `reserved-file` must pass.
- CHG IDs are unique; gaps are acceptable.
- Detail files for different CHGs can be written concurrently.
- Shared index writes may briefly serialize through `index:changes`.
- No fresh legacy `.pace/artifact-writer.lock` should be created.
- Resource locks, sequence locks, reservations, and index transactions are cleaned after completion.

Verify:

```bash
HOST=/mnt/k/AI/paceflow-smoke-local
WT=/mnt/k/AI/paceflow-smoke-local-wt
cd "$HOST"

test -f "$HOST/.pace/artifact-root"
test ! -f "$HOST/.pace/artifact-writer.lock"

find "$HOST/changes" -maxdepth 1 -type f -name 'chg-*.md' | sort
rg 'host resource lock smoke|worktree resource lock smoke' "$HOST/task.md" "$HOST/implementation_plan.md" "$HOST/changes"

test -z "$(find "$HOST/.pace/locks" -type f 2>/dev/null)"
test -z "$(find "$HOST/.pace/reservations" -type f 2>/dev/null)"
test -z "$(find "$HOST/.pace/index-transactions" -type f 2>/dev/null)"

tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'RESERVE|RESOURCE_LOCK|index:changes|RELEASE_ARTIFACT_RESOURCE_LOCK|sid='
```

Failure signals:

- Duplicate CHG IDs.
- Worktree writes local `task.md` / `changes/` instead of host artifact root.
- Session B receives old `DENY_AGENT_ARTIFACT_LOCK` just because Session A has an agent running.
- Fresh `.pace/artifact-writer.lock` remains or is recreated by v6.0.48 runtime.

## Smoke 4: Vault Route

Set vault env before starting Claude Code if needed:

```bash
export PACE_VAULT_PATH="/mnt/c/Users/Xiao/OneDrive/Documents/Obsidian"
rm -rf /mnt/k/AI/paceflow-smoke-vault
rm -rf "$PACE_VAULT_PATH/projects/paceflow-smoke-vault"
mkdir -p /mnt/k/AI/paceflow-smoke-vault
cd /mnt/k/AI/paceflow-smoke-vault
printf 'console.log("vault smoke")\n' > index.js
printf 'console.log("test ok")\n' > test.js
printf 'export const helper = true\n' > helper.js
```

Prompt:

```text
按 PACEflow v6 为这个项目创建一个小变更：把 index.js 的输出改成 "vault smoke ok"，artifact 选择 Obsidian vault project，并运行 node index.js 验证后归档。
```

Expected:

- `.pace/artifact-root` contains `vault`.
- Artifact files are created under `$PACE_VAULT_PATH/projects/paceflow-smoke-vault`.
- Local project root does not contain `task.md` or `changes/`.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-vault
test "$(tr -d '\r\n' < .pace/artifact-root)" = "vault"
test ! -e task.md
test ! -d changes
VAULT_PROJECT="$PACE_VAULT_PATH/projects/paceflow-smoke-vault"
test -d "$VAULT_PROJECT/changes"
rg 'chg-[0-9]{8}-[0-9]{2}' "$VAULT_PROJECT/task.md" "$VAULT_PROJECT/implementation_plan.md"
```

## Smoke 5: v5 Migration Guard

Create a legacy-looking v5 project:

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

Prompt:

```text
把 a.js 的输出改成 legacy ok，按 PACEflow 执行。
```

Expected:

- Hook detects legacy v5 before artifact-root choice.
- First code edit is denied before `a.js` changes.
- No `changes/` is created before user confirms migration.
- Main session should propose dry-run migration first and ask again before real migration.

Verify before confirming migration:

```bash
cd /mnt/k/AI/paceflow-smoke-v5
test ! -d changes
rg 'Legacy v5 task' task.md
rg 'legacy a' a.js
```

## Smoke 6: Native `/plan` Bridge Sync

This verifies the v6.0.45 fix for `.pace/synced-plans`.

Start a fresh Claude Code session in `/mnt/k/AI/paceflow-smoke-local` and use native `/plan` for a small change. Example plan goal:

```text
新增 subtract(a,b) 并增加测试；运行 npm test；通过后归档。
```

Approve the native plan through Claude Code plan UX.

Expected:

- Main session bridges the approved native plan into PACEflow before editing code.
- `artifact-writer create-chg` is dispatched with the plan content.
- After bridge, the native plan basename is written to `.pace/synced-plans`.
- Subsequent SessionStart/PreToolUse should not repeatedly warn about the same plan.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-local
test -s .pace/synced-plans
cat .pace/synced-plans
rg 'subtract' task.md implementation_plan.md changes/*.md calc.js calc.test.js
npm test
```

## Pass Criteria

The focused v6.0.48 smoke passes when:

- Installed runtime version and cache contents are correct.
- First create-style artifact-writer dispatches that need a new ID are re-dispatched with hook-provided reserved fields; subagents never scan indexes to allocate IDs.
- Local create/approve/code/validate/close path succeeds without manual artifact edits.
- Direct artifact mutation by main session is blocked.
- Worktree sessions share the host artifact root, allocate unique CHG IDs, and do not use the old global `artifact-writer.lock` path.
- Resource locks/reservations are cleaned after success or failure.
- Vault route writes artifacts only under the vault project.
- v5 legacy projects trigger migration guard before any v6 `changes/` creation.
- Native `/plan` bridge records `.pace/synced-plans` after bridge.
