# PACEflow v6.0.55 Production Smoke

> Focus: verify v6.0.55 follow-ups from Smoke3/Smoke4: root-choice helper command visibility, helper argument fail-fast wording, current-owner non-code C/E gate, worktree foreign-owner boundary, SubagentStop owner cleanup, and the later deferred Stop reminder semantics.
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

Goal: first-time enablement exposes the current artifact-root and reserve helper commands and does not make the model search old plugin cache versions or pass unsupported helper arguments.

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

- SessionStart/root-choice hint includes the current runtime `set-artifact-root.js` and `reserve-artifact-id.js` absolute commands.
- Main session runs `set-artifact-root.js --choice vault` before running the reserve helper.
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
- The session hand-writes `.pace/artifact-root` instead of running `set-artifact-root.js`.
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

- Session A uses `set-artifact-root.js --choice local`; it does not hand-write `$WT/.pace/artifact-root`.
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
rg 'worktree owner running|\[worktree::|\[branch::' task.md implementation_plan.md changes
test "$(tr -d '\r\n' < "$HOST/.pace/artifact-root")" = "local"
test ! -f "$WT/.pace/artifact-root"
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'FOREIGN_CHANGE_OWNER|PASS_V6_NON_CODE|DENY_AGENT_CHANGE_OWNER|CHANGE_OWNER'
```

Optional structural check:

- Manually remove the CHG detail file or create a task/implementation index mismatch, then try a normal non-code write from another session.
- Expected: structure damage is still blocked globally with detail-missing or index-mismatch messaging.

Failure signals:

- Session A writes `$WT/.pace/artifact-root` in the worktree branch directory.
- Session A searches `~/.claude/plugins/cache` to locate helpers after loading the PaceFlow skills.

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

## Smoke 5: Ready Deferred Stop Reminder

Goal: approving a CHG without starting it leaves the CHG in `ready/deferred`. Stop must allow exit, but the user must see a Stop `systemMessage`. `APPROVED` alone must not permit project file writes.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-ready
mkdir paceflow-smoke-655-ready
cd paceflow-smoke-655-ready
printf 'console.log("ready smoke")\n' > index.js
printf '# ready smoke\n' > README.md
printf 'module.exports = 1\n' > helper.js
printf 'console.log("test ok")\n' > test.js
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-655-ready`.

Prompt:

```text
做 PACEflow deferred smoke：
artifact 选择本地项目目录。
创建一个 CHG，目标是把 README.md 追加一行 "ready deferred should not write yet"。
只批准这个 CHG，不要 approve-and-start，不要修改 README.md。
批准后直接停止，让 Stop hook 展示提醒。
```

Optional follow-up in a new session in the same cwd:

```text
不要开始 CHG，直接尝试把 README.md 追加一行 "ready write attempt"。观察 hook 是否阻止。
```

Expected:

- The CHG detail contains `<!-- APPROVED -->`.
- Root indexes remain `[ ]`; detail frontmatter remains `status: planned`.
- Stop exits successfully and the TUI shows a visible message containing `PACEflow: 仍有 deferred CHG` and `ready`.
- The optional README write is denied with an E phase message until the CHG enters `[/]`.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-655-ready
rg '<!-- APPROVED -->|status: planned' changes/chg-*.md
rg '^- \[ \] \[\[chg-' task.md implementation_plan.md
! rg 'ready deferred should not write yet|ready write attempt' README.md
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'SOFT_DEFERRED_CHANGE|SOFT_DEFERRED_PASS|DENY_V6_E_PHASE|CHANGE_OWNER_SET'
```

Failure signals:

- Stop blocks instead of showing a soft visible reminder.
- Stop silently exits with no visible reminder in TUI.
- README is modified while the CHG is only `planned + APPROVED`.
- `approve` writes owner state as `active` instead of `ready`.

## Smoke 6: Backlog Deferred Stop Reminder

Goal: a created but unapproved CHG is `backlog/deferred`. Stop must allow exit with visible reminder and must not consume or poison the hard-block downgrade counter.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-backlog
mkdir paceflow-smoke-655-backlog
cd paceflow-smoke-655-backlog
printf 'console.log("backlog smoke")\n' > index.js
printf '# backlog smoke\n' > README.md
printf 'module.exports = 1\n' > helper.js
printf 'console.log("test ok")\n' > test.js
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-655-backlog`.

Prompt:

```text
做 PACEflow deferred backlog smoke：
artifact 选择本地项目目录。
创建一个 CHG，目标是把 README.md 追加一行 "backlog deferred later"。
创建后不要批准、不要开始、不要修改 README.md，直接停止。
```

Expected:

- Root indexes contain one `[ ] [[chg-...]]` active line.
- Detail frontmatter is `status: planned`.
- Detail does not contain `<!-- APPROVED -->`.
- Stop exits successfully and the TUI shows a visible message containing `PACEflow: 仍有 deferred CHG` and `backlog`.
- `.pace/stop-block-count` is absent or reset to `0`.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-655-backlog
rg '^- \[ \] \[\[chg-' task.md implementation_plan.md
rg 'status: planned' changes/chg-*.md
! rg '<!-- APPROVED -->' changes/chg-*.md
test ! -f .pace/stop-block-count || test "$(cat .pace/stop-block-count)" = "0"
tail -n 300 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'SOFT_DEFERRED_CHANGE|SOFT_DEFERRED_PASS'
```

Failure signals:

- Stop hard-blocks only because the CHG is backlog.
- Stop exits silently without the visible deferred reminder.
- The hard-block counter increments for a deferred-only Stop.

## Smoke 7: Blocked Deferred Stop And Resume Gate

Goal: `[!]` is the pause/blocked state. It allows Stop with a visible deferred reminder, but it is not a write permission and not an invitation for another worktree to take over.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-blocked
mkdir paceflow-smoke-655-blocked
cd paceflow-smoke-655-blocked
printf 'console.log("blocked smoke")\n' > index.js
printf '# blocked smoke\n' > README.md
printf 'module.exports = 1\n' > helper.js
printf 'console.log("test ok")\n' > test.js
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-655-blocked`.

Prompt:

```text
做 PACEflow blocked deferred smoke：
artifact 选择本地项目目录。
创建一个 CHG，目标是把 README.md 追加一行 "blocked resume gate ok"。
approve-and-start 后不要修改 README.md，立刻暂停这个任务，原因是“用户要求稍后继续”。
暂停后直接停止。
```

Follow-up in a new session in the same cwd:

```text
不要恢复 CHG，直接尝试把 README.md 追加一行 "blocked write attempt"。观察 hook 是否阻止。
```

Then resume and finish:

```text
现在恢复这个 CHG，把暂停的任务重新标为进行中，然后追加 README.md 行 "blocked resume gate ok"。
用 grep README.md 验证，通过后 close-chg 归档。
```

Expected:

- Pause uses `update-chg action=update-status new-status=[!]` with a reason field.
- Root indexes become `[!]`; detail task becomes `[!]`.
- Owner state becomes `blocked`.
- Stop exits successfully and the TUI shows a deferred/blocked reminder.
- Direct README write while blocked is denied with E phase messaging.
- After restoring the task to `[/]`, README write is allowed and close-chg archives the CHG.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-655-blocked
rg '^- \[!\] \[\[chg-' task.md implementation_plan.md || true
rg '\[!\] T-001|用户要求稍后继续' changes/chg-*.md || true
find .pace/change-owners -maxdepth 1 -type f -print -exec cat {} \;
tail -n 500 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'CHANGE_OWNER_SET.*blocked|SOFT_DEFERRED_PASS|DENY_V6_E_PHASE|close-chg'
```

Final verify after resume/close:

```bash
cd /mnt/k/AI/paceflow-smoke-655-blocked
rg 'blocked resume gate ok' README.md
rg 'status: archived|<!-- VERIFIED -->|archived-date: [0-9]' changes/chg-*.md
find .pace/change-owners -maxdepth 1 -type f -exec rg '"state": "closed"' {} \;
```

Failure signals:

- `[!]` can be set without `status-reason`, `block-reason`, or `pause-reason`.
- Stop hard-blocks only because the CHG is blocked.
- README is modified while the CHG is blocked.
- Another worktree/session is encouraged to take over a fresh blocked owner without explicit user instruction.

## Smoke 8: Same Worktree Reopen Owner Continuity

Goal: owner is worktree-affine. Reopening Claude Code in the same `cwd/worktree/branch` must not turn the CHG into a foreign owner or require owner takeover.

Setup:

```bash
cd /mnt/k/AI
rm -rf paceflow-smoke-655-reopen
mkdir paceflow-smoke-655-reopen
cd paceflow-smoke-655-reopen
git init
printf 'console.log("reopen smoke")\n' > index.js
printf '# reopen smoke\n' > README.md
printf 'module.exports = 1\n' > helper.js
printf 'console.log("test ok")\n' > test.js
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Session A, cwd `/mnt/k/AI/paceflow-smoke-655-reopen`:

```text
做 PACEflow same-worktree reopen smoke：
artifact 选择本地项目目录。
创建一个 CHG，目标是把 README.md 追加一行 "same worktree reopen ok"。
只批准这个 CHG，不要开始，不要修改 README.md，然后停止。
```

Session B, same cwd `/mnt/k/AI/paceflow-smoke-655-reopen`:

```text
继续刚才同一个 worktree 的 ready CHG。
不要 owner takeover；直接 approve-and-start 或恢复到进行中，然后修改 README.md，grep 验证，通过后 close-chg 归档。
```

Expected:

- Session B treats the CHG as `current-worktree`, not `foreign-fresh`.
- Session B is not asked for `owner-takeover-confirmed`.
- Owner JSON session id may refresh to Session B after the update/close path.
- Final owner state is `closed`.

Verify:

```bash
cd /mnt/k/AI/paceflow-smoke-655-reopen
rg 'same worktree reopen ok' README.md
rg 'status: archived|<!-- VERIFIED -->|archived-date: [0-9]' changes/chg-*.md
find .pace/change-owners -maxdepth 1 -type f -print -exec cat {} \;
find .pace/change-owners -maxdepth 1 -type f -exec rg '"state": "closed"' {} \;
tail -n 500 "$PLUGIN_DIR/hooks/pace-hooks.log" | rg 'current-worktree|CHANGE_OWNER_SET|DENY_AGENT_CHANGE_OWNER|close-chg'
```

Failure signals:

- Session B is blocked as `foreign-fresh`.
- Session B must provide `owner-takeover-confirmed` even though cwd/worktree/branch are unchanged.
- Stop or SessionStart loses the CHG after reopening the same worktree.

## Deferred Smoke Priority

After Smoke 1-4 pass, run the deferred-focused set in this order:

1. Smoke 5: ready/deferred Stop visible reminder and write gate.
2. Smoke 6: backlog/deferred Stop visible reminder and hard-block counter reset.
3. Smoke 7: blocked/deferred Stop, write denial, then resume and close.
4. Smoke 8: same worktree reopen owner continuity.

Optional cross-worktree check: leave a deferred or running CHG in worktree A, then in host/worktree B modify an unrelated ordinary project file. Expected: foreign progress/deferred CHG does not block ordinary current-session work, but artifact structure damage still blocks globally.

## Post-84b7d7a Minimum Regression

Use this set after changes that touch deferred Stop handling or artifact-writer prompt gates. It is intentionally smaller than the full Smoke 1-8 set.

Required automated checks from the repo root:

```bash
git diff --check
node tests/test-hooks-e2e.js
node tests/test-pace-utils.js
```

Required runtime smoke:

1. Run Smoke 7 through the first Stop after marking the CHG `[!]`.
   - Expected: Stop does not hard-block, even if the assistant says the setup is complete.
   - Expected: TUI shows `PACEflow: 仍有 deferred CHG 可后续处理` with `blocked`.
   - Expected: no double punctuation such as `。。`.
2. Continue Smoke 7 in a new same-cwd session.
   - Expected: direct project-file write while `[!]` is denied.
   - Expected: after restoring T-001 to `[/]`, the README write is allowed and `close-chg` archives cleanly.
3. Run Smoke 8.
   - Expected: same cwd/worktree reopen is treated as `current-worktree`, not `foreign-fresh`.
   - Expected: no `owner-takeover-confirmed` is required.
   - Expected: final owner state is `closed`.

Optional runtime checks:

- Run Smoke 5 if Stop `systemMessage` visibility or ready/deferred wording changed.
- Run Smoke 6 if backlog/deferred wording, Stop block counter, or `.pace/stop-block-count` handling changed.
- If a model still omits artifact-writer fields during Smoke 7/8, verify the first hook rejection includes `Skill(paceflow:pace-workflow)` and that shorthand lifecycle prompts missing `task-id`, `verify-summary`, or `walkthrough-summary` are rejected before a long-running agent attempt.

Failure signals:

- A deferred-only CHG increments hard-block counters or requires repeated Stop attempts.
- `verify-summary` is interpreted as `action=verify`.
- `approve-and-start ...` without `task-id` reaches a running artifact-writer agent instead of immediate PreToolUse deny.
- `close-chg ...` without `verify-summary` / `walkthrough-summary` reaches a running artifact-writer agent instead of immediate PreToolUse deny.
