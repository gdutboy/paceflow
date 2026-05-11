# PACEflow v6.0.51 Production Smoke

> Focus: verify the installed marketplace plugin after the `pre-tool-use.js` guard split.
> This is a focused smoke for runtime packaging and the two highest-value flows: local create/close and worktree concurrent create.
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

- Installed version is `6.0.51`.
- `PACE_VERSION` is `v6.0.51`.
- Runtime root contains plugin runtime assets only:

```bash
find "$PLUGIN_DIR" -maxdepth 1 -mindepth 1 -printf '%f\n' | sort
test ! -d "$PLUGIN_DIR/docs"
test ! -d "$PLUGIN_DIR/tests"
test ! -d "$PLUGIN_DIR/internal"
```

## Smoke 0: PreToolUse Helper Packaging

This checks the v6.0.51-specific refactor risk: `pre-tool-use.js` now requires helper modules under `hooks/pre-tool-use/`.

```bash
test -f "$PLUGIN_DIR/hooks/pre-tool-use.js"
test -f "$PLUGIN_DIR/hooks/pre-tool-use/bash-guard.js"
test -f "$PLUGIN_DIR/hooks/pre-tool-use/agent-lifecycle-guard.js"
test -f "$PLUGIN_DIR/hooks/pre-tool-use/marker-guard.js"

node --check "$PLUGIN_DIR/hooks/pre-tool-use.js"
node --check "$PLUGIN_DIR/hooks/pre-tool-use/bash-guard.js"
node --check "$PLUGIN_DIR/hooks/pre-tool-use/agent-lifecycle-guard.js"
node --check "$PLUGIN_DIR/hooks/pre-tool-use/marker-guard.js"

PLUGIN_DIR="$PLUGIN_DIR" node - <<'NODE'
const fs = require('fs');
const path = process.env.PLUGIN_DIR;
const src = fs.readFileSync(`${path}/hooks/pre-tool-use.js`, 'utf8');
for (const rel of ['./pre-tool-use/bash-guard', './pre-tool-use/agent-lifecycle-guard', './pre-tool-use/marker-guard']) {
  if (!src.includes(`require('${rel}')`)) throw new Error(`missing require ${rel}`);
}
console.log('pre-tool-use helper packaging ok');
NODE
```

Expected:

- All four `node --check` commands pass.
- Helper directory exists in the installed cache, not just in the source repo.
- No `Cannot find module './pre-tool-use/...` error appears when a PreToolUse hook runs.

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
- Main session creates a CHG and approves/starts it before editing code.
- Preferred path: main session runs the reserve helper first and dispatches `create-chg` with `reserved-id` / `reserved-file`.
- Acceptable fallback: first `create-chg` Agent dispatch without `reserved-id` is denied once, then immediately re-dispatched with the exact reserved fields from the hook message.
- Code is edited only after the CHG is created and approved/started.
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
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'PASS_AGENT_ARTIFACT_BASE|DENY_AGENT_RESERVED_PROMPT_REQUIRED|PASS_V6|close-chg|sid='
```

Failure signals:

- PreToolUse hook throws `Cannot find module './pre-tool-use/...`.
- Code is edited before CHG creation and `approve-and-start`.
- Active `task.md` / `implementation_plan.md` entries remain after close.
- CHG detail lacks `APPROVED`, `VERIFIED`, `verified-date`, or `status: archived`.

## Smoke 2: Direct Artifact Write Protection

In the same project, ask Claude Code:

```text
尝试直接修改 task.md：先用 Bash echo test >> task.md；如果被拦，再尝试 Write 和 Edit。不要派 artifact-writer，目标是确认 hook 是否拦截主 session 直接改流程 artifact。
```

Expected:

- Bash write is denied.
- Write/Edit/MultiEdit to artifact-writer-managed files are denied for main session and non-artifact-writer agents.
- `spec.md` remains the known exception: it is not artifact-writer managed and may be edited with `Edit`.
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

Expected:

- Both sessions resolve to the host project artifact root.
- `PreToolUse:Agent` must not deny merely because another artifact-writer agent is running.
- CHG IDs are unique; gaps are acceptable.
- Detail files for different CHGs can be written concurrently.
- Shared index writes may briefly serialize through `index:changes`.
- Resource locks, sequence locks, reservations, and index transactions are cleaned after completion.
- Non-artifact file placement is decided by the main session/user path context; PaceFlow should not redirect ordinary project files as if they were artifacts.

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
- Session B receives old project-level `DENY_AGENT_ARTIFACT_LOCK` merely because Session A has an agent running.
- Fresh `.pace/artifact-writer.lock` remains or is recreated by v6.0.51 runtime.

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

Use a copy, not a real vault:

```bash
rm -rf /mnt/k/AI/paceflow-smoke-v5
mkdir -p /mnt/k/AI/paceflow-smoke-v5
cd /mnt/k/AI/paceflow-smoke-v5

cat > task.md <<'EOF'
# Task

- [ ] legacy v5 active item
EOF

cat > implementation_plan.md <<'EOF'
# Implementation Plan

- [ ] legacy v5 active item
EOF

printf 'console.log("legacy")\n' > index.js
printf 'console.log("helper")\n' > helper.js
printf 'console.log("test")\n' > test.js
```

Prompt:

```text
按 PACEflow v6 修改 index.js，让输出变成 legacy migrated smoke。若检测到 v5 artifact，请先按提示处理，不要手动 mkdir changes。
```

Expected:

- Hook detects legacy v5 artifact before lazy-creating `changes/`.
- Main session asks whether to migrate or bridge; it must not manually create `changes/` with Bash.
- If migration is chosen, dry-run is shown first; after migration, the original code task is retried.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-v5
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'V5_MIGRATION|DENY_LEGACY|batch-archive-v5'
```

## Smoke 6: Native Plan Bridge Sync

Start Claude Code in a clean project and use native `/plan`.

Prompt after plan approval:

```text
按刚批准的 native plan 桥接到 PACEflow v6：创建最小 CHG，批准并开始，做一个可验证的小改动，验证后 close-chg 归档，并确认 plan sync helper 已写入 .pace/synced-plans。
```

Expected:

- Main session calls `Skill(paceflow:pace-bridge)`.
- CHG creation uses explicit `artifact_dir` and reserved ID.
- After bridge, `hooks/sync-plan.js --plan <plan path>` records the plan basename in host `.pace/synced-plans`.
- Re-opening the session should not repeatedly demand bridging for the same plan.

Verify:

```bash
cd <project>
test -f .pace/synced-plans
cat .pace/synced-plans
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'PlanSync|SYNCED|ALREADY_SYNCED|DENY_NATIVE_PLAN'
```

## Pass Criteria

The focused v6.0.51 smoke passes when:

- Smoke 0 confirms helper modules are present and loadable from the installed plugin cache.
- Smoke 1 creates, approves/starts, edits, validates, closes, and archives one local CHG.
- Smoke 2 blocks direct writes to managed flow artifacts.
- Smoke 3 completes two concurrent worktree CHGs without project-level agent lock contention or ID collision.
- Smoke 4 routes artifacts to the Obsidian vault when selected.
- Smoke 5 detects v5 legacy state before any v6 lazy creation.
- Smoke 6 records native plan bridge sync with `hooks/sync-plan.js`.
- Hook logs contain `sid=` on relevant entries and no `Cannot find module './pre-tool-use/...` errors.
