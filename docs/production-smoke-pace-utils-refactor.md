# PACEflow pace-utils Refactor Production Smoke

> Focus: verify the `plugin/hooks/pace-utils.js` compatibility facade after splitting helpers into `plugin/hooks/pace-utils/*.js`. This smoke targets runtime module loading, unchanged public exports, local/vault artifact routing, worktree owner boundaries, and non-code C/E gating.
>
> Related commit: `79fe764 refactor pace utils modules`.

## Automatic Baseline

Run from the repository root:

```bash
node tests/test-pace-utils.js
node tests/test-hooks-e2e.js
node tests/test-install.js
for f in plugin/hooks/*.js plugin/hooks/pre-tool-use/*.js plugin/hooks/pace-utils/*.js; do node -c "$f" || exit 1; done
```

Expected:

- `test-pace-utils.js`: all tests pass.
- `test-hooks-e2e.js`: all tests pass.
- `test-install.js`: all tests pass.
- No `node -c` syntax failure.

## Smoke 0: Runtime Module Loading

Goal: installed Claude Code plugin cache includes the new `hooks/pace-utils/` subdirectory and all hook entrypoints can still load `hooks/pace-utils.js`.

Start a fresh Claude Code session in any project with the installed plugin active.

Prompt:

```text
你当前加载的 paceflow runtime 路径是什么？检查 hooks/pace-utils/ 是否存在，并运行 reserve helper --help。
```

Expected:

- Runtime path points to the installed plugin cache/version being tested.
- `hooks/pace-utils/` exists and contains files such as `constants.js`, `locks.js`, and `change-analysis.js`.
- `reserve-artifact-id.js --help` runs normally.
- No `Cannot find module './pace-utils/...'` or equivalent module loading error.

## Smoke 1: Local Artifact Root Full Flow

Goal: local artifact root plus create -> approve-and-start -> edit code -> verify -> close works with the split utility modules.

Setup:

```bash
rm -rf /mnt/k/AI/paceflow-smoke-utils-local
mkdir -p /mnt/k/AI/paceflow-smoke-utils-local
cd /mnt/k/AI/paceflow-smoke-utils-local
printf 'function add(a,b){return a+b}\nmodule.exports={add}\n' > calc.js
printf 'const {add}=require("./calc"); if(add(1,2)!==3) process.exit(1)\n' > calc.test.js
printf 'console.log("helper")\n' > helper.js
git init
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-utils-local`.

Prompt:

```text
这是 paceflow smoke。选择本地项目目录作为 artifact root。
创建一个最小 CHG：在 calc.js 增加 multiply(a,b)，在 calc.test.js 增加 multiply 测试，运行 node calc.test.js 验证，通过后 close-chg 归档。
```

Expected:

- Main session calls PACEflow skills before artifact operations.
- `set-artifact-root --choice local` is used, or equivalent hook-provided helper flow is followed.
- Reserve helper runs without module loading errors.
- `artifact-writer` create / approve-and-start / close does not fail because of missing utility modules.
- `node calc.test.js` passes.
- `task.md` and `implementation_plan.md` active sections do not retain a completed, verified CHG after close.

Verification:

```bash
cd /mnt/k/AI/paceflow-smoke-utils-local
node calc.test.js
rg 'multiply|CHG-|HOTFIX-' task.md implementation_plan.md changes
```

Failure signals:

- `Cannot find module`.
- Helper path points to an old plugin cache unexpectedly.
- `close-chg` requires unrelated approval fields or misidentifies operation.
- Active index still contains completed verified CHG after close.

## Smoke 2: Worktree Owner Boundary

Goal: a fresh owner in another worktree/session does not block ordinary non-code writes in the host session, while worktree runtime state still belongs to the host project.

Setup:

```bash
rm -rf /mnt/k/AI/paceflow-smoke-utils-wt /mnt/k/AI/paceflow-smoke-utils-wt-branch
mkdir -p /mnt/k/AI/paceflow-smoke-utils-wt
cd /mnt/k/AI/paceflow-smoke-utils-wt
printf '# smoke\n' > README.md
printf 'console.log("main")\n' > index.js
printf 'console.log("a")\n' > a.js
printf 'console.log("b")\n' > b.js
git init
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
git worktree add ../paceflow-smoke-utils-wt-branch -b smoke-branch
```

Session A cwd: `/mnt/k/AI/paceflow-smoke-utils-wt-branch`.

Prompt:

```text
选择本地项目目录作为 artifact root。
创建并 approve-and-start 一个 CHG：写入 branch-note.md，内容为 "worktree owner running"。
开始后先不要 close，也不要归档。
```

Session B cwd: `/mnt/k/AI/paceflow-smoke-utils-wt`.

Prompt:

```text
在 README.md 追加一行 "main session ok"，然后结束会话。
不要接手 worktree 的 CHG。
```

Expected:

- Session A does not write `$WT/.pace/artifact-root` inside the worktree branch directory.
- Artifact-root configuration is written to the host/shared runtime.
- Session B README edit is not blocked just because Session A owns a fresh running CHG.
- Session B Stop is not blocked by Session A's fresh running CHG.
- Artifact index lines include execution context markers such as `[worktree:: ...] [branch:: ...]`.

Verification:

```bash
HOST=/mnt/k/AI/paceflow-smoke-utils-wt
WT=/mnt/k/AI/paceflow-smoke-utils-wt-branch
cd "$HOST"
rg 'main session ok' README.md
test ! -f "$WT/.pace/artifact-root"
rg 'worktree owner running|\[worktree::|\[branch::' task.md implementation_plan.md changes
```

Failure signals:

- Host session Stop demands close/archive for the worktree-owned running CHG.
- Worktree writes its own `.pace/artifact-root`.
- Worktree CHG lacks worktree/branch context in artifact indexes.
- Module loading error from split utility modules.

## Smoke 3: Vault Artifact Full Flow

Goal: vault artifact routing still works after the split, and helper paths remain deterministic.

Setup:

```bash
rm -rf /mnt/k/AI/paceflow-smoke-utils-vault
mkdir -p /mnt/k/AI/paceflow-smoke-utils-vault
cd /mnt/k/AI/paceflow-smoke-utils-vault
printf 'console.log("vault smoke")\n' > index.js
printf 'console.log("a")\n' > a.js
printf 'console.log("b")\n' > b.js
git init
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-utils-vault`.

Prompt:

```text
这是 paceflow vault smoke。artifact 选择 Obsidian vault project。
创建一个小 CHG：把 index.js 输出改成 "vault smoke ok"，运行 node index.js 验证，通过后 close-chg 归档。
```

Expected:

- `set-artifact-root --choice vault` or equivalent helper flow is used.
- Main session does not search old plugin cache versions to find helpers.
- Artifact files are created under the vault project, not local project root.
- `node index.js` outputs `vault smoke ok`.
- `close-chg` succeeds without field-mismatch retries.

Verification:

```bash
cd /mnt/k/AI/paceflow-smoke-utils-vault
node index.js | rg '^vault smoke ok$'
VAULT_PROJECT="$PACE_VAULT_PATH/projects/paceflow-smoke-utils-vault"
test -d "$VAULT_PROJECT/changes"
rg 'vault smoke ok|CHG-|HOTFIX-' "$VAULT_PROJECT/task.md" "$VAULT_PROJECT/implementation_plan.md" "$VAULT_PROJECT/changes"
```

Failure signals:

- Artifact files appear in the local project when vault was selected.
- Model searches multiple old plugin cache versions for helper scripts.
- `Cannot find module` from any hook/helper.
- close operation is mistaken for approve, or approve is mistaken for close.

## Smoke 4: Non-Code C/E Gate

Goal: current-session owner cannot bypass C/E gate by writing ordinary non-code files, while approved in-progress non-code writes are allowed.

Setup:

```bash
rm -rf /mnt/k/AI/paceflow-smoke-utils-noncode
mkdir -p /mnt/k/AI/paceflow-smoke-utils-noncode
cd /mnt/k/AI/paceflow-smoke-utils-noncode
printf '# smoke\n' > README.md
printf 'console.log("noncode")\n' > index.js
printf 'console.log("a")\n' > a.js
printf 'console.log("b")\n' > b.js
git init
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Start Claude Code in `/mnt/k/AI/paceflow-smoke-utils-noncode`.

Prompt:

```text
创建一个 CHG：在 README.md 追加 "noncode gate ok"。
先创建 CHG，但不要 approve-and-start，直接尝试修改 README.md，观察 hook 是否阻止。
然后按正确流程 approve-and-start，再修改 README.md，grep 验证后 close-chg。
```

Expected:

- Before approve-and-start, README write is blocked by current-session C/E gate.
- After approve-and-start, README write is allowed.
- `grep`/`rg` verification reads the expected line.
- `close-chg` does not get operation mismatch prompts.

Verification:

```bash
cd /mnt/k/AI/paceflow-smoke-utils-noncode
rg 'noncode gate ok' README.md
rg 'noncode gate ok|CHG-|HOTFIX-' task.md implementation_plan.md changes
```

Failure signals:

- README write succeeds before approval.
- README write is still blocked after approve-and-start.
- close operation is blocked with approve-only required fields.

## Recommended Order

1. Smoke 0: runtime module loading.
2. Smoke 1: local full flow.
3. Smoke 4: non-code C/E gate.
4. Smoke 3: vault full flow.
5. Smoke 2: worktree owner boundary.

Smoke 2 is the widest regression test and is best run after the simpler flows pass.
