# PACEflow v6.0.55 Production Smoke

> Focus: verify v6.0.55 follow-ups from Smoke3/Smoke4: root-choice helper command visibility, helper argument fail-fast wording, current-owner non-code C/E gate, worktree foreign-owner boundary, and SubagentStop owner cleanup.
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

- Installed version is `6.0.55`.
- `PACE_VERSION` is `v6.0.55`.
- Claude Code session has reloaded the plugin after install/update.

## Smoke 1: Root-Choice Helper Command

Goal: first-time enablement exposes the current reserve helper command and does not make the model search old plugin cache versions or pass unsupported helper arguments.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-root
mkdir paceflow-smoke-655-root
cd paceflow-smoke-655-root
printf 'console.log("root smoke")\n' > index.js
printf 'export function helper(){ return 1 }\n' > helper.js
printf 'console.log("test")\n' > test.js
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-655-root`.

Prompt:

```text
做一个 PACEflow smoke：把 index.js 输出从 "root smoke" 改成 "root smoke ok"。
artifact 选择 Obsidian vault project。
运行 node index.js 验证，通过后归档。
```

Expected:

- SessionStart/root-choice hint includes the current runtime `reserve-artifact-id.js` absolute command.
- Main session writes `.pace/artifact-root` as `vault` before running the helper.
- Main session does not search `~/.claude/plugins/cache` to guess a helper path.
- Main session does not pass `--project-dir`, `--artifact-root`, or `--artifact-dir`.
- Final artifacts are in the vault project, not the local project root.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-655-root
test "$(tr -d '\r\n' < .pace/artifact-root)" = "vault"
test ! -d changes
node index.js | rg '^root smoke ok$'
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'ReserveID|PASS_AGENT_ARTIFACT_BASE|close-chg|DENY_UNKNOWN_OPTION'
```

Failure signals:

- The session runs `find ~/.claude/plugins/cache/... -name reserve-artifact-id*`.
- The session runs helper with `--project-dir`, `--artifact-root`, or `--artifact-dir`.
- Local `changes/` or root artifact files are created despite choosing vault.
- Any `DENY_V6_INDEX_MISMATCH` appears during create-chg or close-chg. This smoke should not require index repair.
- The model tries to repair artifacts with Bash, `/tmp/*.js`, Obsidian CLI, or direct main-session Write/Edit after a PaceFlow artifact deny.

## Smoke 2: Non-Code C/E Gate

Goal: once the current session owns an actionable CHG, ordinary project files such as `README.md` still must pass C/E before writing. This must not turn PaceFlow into a generic path arbiter.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-noncode
mkdir paceflow-smoke-655-noncode
cd paceflow-smoke-655-noncode
printf 'console.log("noncode smoke")\n' > index.js
printf '# smoke\n' > README.md
printf 'module.exports = 1\n' > helper.js
printf 'console.log("test ok")\n' > test.js
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-655-noncode`.

Prompt:

```text
做 PACEflow smoke：
创建一个 CHG，目标是把 README.md 追加一行 "noncode gate ok"。
artifact 选择本地项目目录。
注意：创建 CHG 后先不要批准，直接尝试修改 README.md，观察 hook 是否阻止。
被阻止后再按流程 approve-and-start，然后修改 README.md，最后无需测试，用 grep README.md 验证并 close-chg 归档。
```

Expected:

- Before `approve-and-start`, writing `README.md` is denied with a C phase message.
- After `approve-and-start`, writing `README.md` is allowed.
- `close-chg complete-open-tasks:true` archives the CHG.
- No `DENY_V6_INDEX_MISMATCH` appears. If it does, the smoke has hit index half-write repair, not the intended C/E gate check.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-655-noncode
rg 'noncode gate ok' README.md
rg 'status: archived|<!-- VERIFIED -->|archived-date: [0-9]' changes/chg-*.md
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'DENY_V6_C_PHASE|PASS_V6|PASS_V6_NON_CODE|close-chg'
```

Failure signals:

- The first README write is denied by index mismatch or missing detail instead of C phase.
- `README.md` is modified before the CHG is approved/started.
- The hook treats `README.md` as a PaceFlow artifact path or redirects it to `artifact_dir`.
- The model repairs artifacts with Bash, `/tmp/*.js`, Obsidian CLI, or direct main-session Write/Edit instead of dispatching artifact-writer.

## Smoke 3: Worktree Foreign Owner Boundary

Goal: a fresh owner in another worktree/session does not block ordinary non-code writes in the current session. Structural artifact inconsistency remains global and may still block.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-wt paceflow-smoke-655-wt-branch
mkdir paceflow-smoke-655-wt
cd paceflow-smoke-655-wt
git init
printf 'console.log("host")\n' > index.js
printf '# host\n' > README.md
printf 'module.exports = 1\n' > helper.js
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
git worktree add ../paceflow-smoke-655-wt-branch -b smoke-branch
```

Session A, cwd `/mnt/k/AI/paceflow-smoke-655-wt-branch`:

```text
做 PACEflow worktree smoke：
artifact 选择本地项目目录。
创建并 approve-and-start 一个 CHG，目标是在 branch-note.md 写入 "worktree owner running"。
先完成创建和批准，然后暂停，不要 close-chg。
```

Session B, cwd `/mnt/k/AI/paceflow-smoke-655-wt`:

```text
当前只是 host session 普通非代码写入 smoke。
在 README.md 追加 "host write while worktree owner fresh"。
不要接手 worktree 的 CHG。
```

Expected:

- Session B is not blocked merely because Session A owns a fresh worktree CHG.
- Session B does not try to close or update Session A's CHG.
- SessionStart/Stop may summarize the foreign CHG, but it should not count it as current session work.
- Artifact index lines include `[worktree:: ...] [branch:: ...]`.

Verify:

```bash
HOST=/mnt/k/AI/paceflow-smoke-655-wt
WT=/mnt/k/AI/paceflow-smoke-655-wt-branch
cd "$HOST"

rg 'host write while worktree owner fresh' README.md
rg 'worktree owner running|\\[worktree::|\\[branch::' task.md implementation_plan.md changes
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'FOREIGN_CHANGE_OWNER|PASS_V6_NON_CODE|DENY_AGENT_CHANGE_OWNER|CHANGE_OWNER'
```

Optional structural check:

- Manually remove the CHG detail file or create a task/implementation index mismatch, then try a normal non-code write from another session.
- Expected: structure damage is still blocked globally with detail-missing or index-mismatch messaging.

## Smoke 4: Close Owner Cleanup

Goal: after close/archive, `.pace/change-owners/<chg>.json` should not remain stuck in `closing`.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-owner
mkdir paceflow-smoke-655-owner
cd paceflow-smoke-655-owner
printf 'console.log("owner smoke")\n' > index.js
printf 'module.exports = 1\n' > helper.js
printf 'console.log("test ok")\n' > test.js
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-655-owner`.

Prompt:

```text
做 PACEflow owner cleanup smoke：
artifact 选择本地项目目录。
创建一个 CHG：把 index.js 输出改成 "owner smoke ok"。
approve-and-start 后修改代码，运行 node index.js 验证，通过后 close-chg 归档。
完成后检查 .pace/change-owners 里对应 CHG 的 json，确认 state 是 closed，不是 closing。
```

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-655-owner
node index.js | rg '^owner smoke ok$'
find .pace/change-owners -maxdepth 1 -type f -print -exec cat {} \;
find .pace/change-owners -maxdepth 1 -type f -exec rg '"state": "closed"' {} \;
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'SubagentStop.*CHANGE_OWNER_CLOSED|PostToolUse.*CHANGE_OWNER_CLOSED|close-chg'
```

Expected:

- The corresponding change owner JSON has `"state": "closed"`.
- It does not remain `"state": "closing"` after the CHG has left active indexes.

Failure signals:

- Stop passes but `.pace/change-owners/<chg>.json` still says `closing`.
- The CHG is archived in detail but remains in active `task.md` / `implementation_plan.md`.

## Priority

Run in this order:

1. Smoke 1: root-choice helper command
2. Smoke 2: non-code C/E gate
3. Smoke 4: close owner cleanup
4. Smoke 3: worktree foreign owner boundary

Smoke 3 is the widest worktree regression and is best run after the first three pass.
