# PACEflow v6.0.58 Production Smoke

Focus: Project Root inheritance. These smokes verify that a Claude Code session opened in a child directory inherits the nearest parent PACEflow Project Root, while an explicitly independent child project gets its own artifact/runtime boundary.

Prerequisites:

- Claude Code has the installed `paceflow` plugin version `6.0.58`.
- `PACE_VAULT_PATH` is set if testing vault mode.
- Run each Claude Code session from the cwd specified in the scenario.

## Smoke 17A: Parent Project Inheritance

Prepare a parent project with vault artifacts, then open Claude Code in a child directory.

```bash
rm -rf /mnt/k/AI/paceflow-smoke-project-root
rm -rf "$PACE_VAULT_PATH/projects/paceflow-smoke-project-root"
mkdir -p /mnt/k/AI/paceflow-smoke-project-root/plugin
cd /mnt/k/AI/paceflow-smoke-project-root
git init
printf 'console.log("parent")\n' > index.js
printf 'console.log("child")\n' > plugin/child.js
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Start Claude Code in:

```text
/mnt/k/AI/paceflow-smoke-project-root
```

Prompt:

```text
这是 PACEflow Project Root smoke。artifact 选择 Obsidian vault project。
创建一个小 CHG：把 index.js 输出改成 "parent ok"，运行 node index.js 验证，通过后 close-chg 归档。
```

Then start a new Claude Code session in:

```text
/mnt/k/AI/paceflow-smoke-project-root/plugin
```

Prompt:

```text
请告诉我 SessionStart 里 PACEflow 注入的 Project Root、Artifact Root 和当前 cwd。
然后创建一个小 CHG：把 child.js 输出改成 "child inherits ok"，运行 node child.js 验证，通过后 close-chg 归档。
```

Expected:

- SessionStart says Project Root is `/mnt/k/AI/paceflow-smoke-project-root`, not the `plugin/` child directory.
- Artifact Root is `$PACE_VAULT_PATH/projects/paceflow-smoke-project-root/`.
- `.pace/` runtime writes under `/mnt/k/AI/paceflow-smoke-project-root/.pace/`.
- No `/mnt/k/AI/paceflow-smoke-project-root/plugin/.pace/` is created.
- The child CHG appears in the parent project's vault `task.md`, `implementation_plan.md`, `walkthrough.md`, and `changes/`.

Verification:

```bash
ROOT=/mnt/k/AI/paceflow-smoke-project-root
VAULT_PROJECT="$PACE_VAULT_PATH/projects/paceflow-smoke-project-root"
test -d "$ROOT/.pace"
test ! -e "$ROOT/plugin/.pace"
rg 'child inherits ok|CHG-|HOTFIX-' "$VAULT_PROJECT/task.md" "$VAULT_PROJECT/implementation_plan.md" "$VAULT_PROJECT/walkthrough.md" "$VAULT_PROJECT/changes"
node "$ROOT/plugin/child.js" | rg '^child inherits ok$'
```

## Smoke 17B: Independent Child Project

Use the same parent project and child directory, but explicitly declare the child as a separate Project Root.

Start Claude Code in:

```text
/mnt/k/AI/paceflow-smoke-project-root/plugin
```

Prompt:

```text
这个 plugin 子目录现在是独立 PACEflow 项目。
请先声明 independent Project Root，然后选择本地项目目录作为 artifact root。
创建一个小 CHG：新增 independent-note.md，内容为 "independent child ok"。
用 grep 验证，通过后 close-chg 归档。
```

Expected:

- Claude runs `set-project-root.js --mode independent` before `set-artifact-root.js`.
- `plugin/.pace/project-root` contains `independent`.
- `plugin/.pace/artifact-root` contains `local`.
- Artifact files are created under `/mnt/k/AI/paceflow-smoke-project-root/plugin/`, not the parent vault project.
- Parent artifact files are not modified by the independent child CHG.

Verification:

```bash
ROOT=/mnt/k/AI/paceflow-smoke-project-root
CHILD="$ROOT/plugin"
test "$(cat "$CHILD/.pace/project-root")" = "independent"
test "$(cat "$CHILD/.pace/artifact-root")" = "local"
rg 'independent child ok|CHG-|HOTFIX-' "$CHILD/task.md" "$CHILD/implementation_plan.md" "$CHILD/walkthrough.md" "$CHILD/changes"
rg 'independent child ok' "$CHILD/independent-note.md"
```

## Smoke 17C: Local Artifact Root From Child Writes Parent Runtime

Prepare a fresh child-inherited project with no artifact-root yet, then ask from the child cwd to choose local.

```bash
rm -rf /mnt/k/AI/paceflow-smoke-project-root-local
mkdir -p /mnt/k/AI/paceflow-smoke-project-root-local/plugin
cd /mnt/k/AI/paceflow-smoke-project-root-local
git init
printf 'console.log("root local")\n' > index.js
printf 'console.log("child local")\n' > plugin/child.js
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Start Claude Code in:

```text
/mnt/k/AI/paceflow-smoke-project-root-local
```

Prompt:

```text
这是 Project Root local smoke。选择本地项目目录作为 artifact root。
创建一个小 CHG：把 index.js 输出改成 "root local ok"，运行 node index.js 验证，通过后 close-chg 归档。
```

Then start Claude Code in:

```text
/mnt/k/AI/paceflow-smoke-project-root-local/plugin
```

Prompt:

```text
不要声明 independent。创建一个小 CHG：把 child.js 输出改成 "child local inherits ok"，运行 node child.js 验证，通过后 close-chg 归档。
```

Expected:

- In the child session, Project Root remains `/mnt/k/AI/paceflow-smoke-project-root-local`.
- `local` artifact root is the parent Project Root, not `plugin/`.
- No child `.pace/artifact-root` is written.

Verification:

```bash
ROOT=/mnt/k/AI/paceflow-smoke-project-root-local
test "$(cat "$ROOT/.pace/artifact-root")" = "local"
test ! -e "$ROOT/plugin/.pace/artifact-root"
rg 'child local inherits ok|CHG-|HOTFIX-' "$ROOT/task.md" "$ROOT/implementation_plan.md" "$ROOT/walkthrough.md" "$ROOT/changes"
node "$ROOT/plugin/child.js" | rg '^child local inherits ok$'
```

## Smoke 17D: Nested Git Repo Inherits Until Independent

Use a parent PACEflow Project Root with vault artifacts, but turn the child into its own git repo before opening Claude Code there.

```bash
ROOT=/mnt/k/AI/paceflow-smoke-project-root
CHILD="$ROOT/nested-repo"
rm -rf "$CHILD"
mkdir -p "$CHILD"
cd "$CHILD"
git init
printf 'console.log("nested")\n' > nested.js
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Start Claude Code in `$CHILD`.

Prompt:

```text
先告诉我 SessionStart 注入的 Current CWD 和 Project Root。
不要声明 independent。创建一个小 CHG：把 nested.js 输出改成 "nested inherits ok"，运行 node nested.js 验证，通过后 close-chg 归档。
```

Expected:

- A nested git repo does not break inheritance by itself.
- Current CWD is `$CHILD`; Project Root remains `/mnt/k/AI/paceflow-smoke-project-root`.
- The CHG lands in the parent vault project, not `$CHILD/task.md`.

Then start a fresh session in `$CHILD`.

Prompt:

```text
现在这个 nested-repo 是独立 PACEflow 项目。先声明 independent Project Root，再选择本地项目目录作为 artifact root。
创建一个小 CHG：新增 nested-independent.md，内容为 "nested independent ok"；grep 验证后 close-chg 归档。
```

Verification:

```bash
test "$(cat "$CHILD/.pace/project-root")" = "independent"
test "$(cat "$CHILD/.pace/artifact-root")" = "local"
rg 'nested independent ok|CHG-|HOTFIX-' "$CHILD/task.md" "$CHILD/implementation_plan.md" "$CHILD/walkthrough.md" "$CHILD/changes"
```

## Smoke 17E: Worktree Still Uses Host Boundary

Prepare a real git worktree from a local-artifact Project Root.

```bash
ROOT=/mnt/k/AI/paceflow-smoke-project-root-local
WT=/mnt/k/AI/paceflow-smoke-project-root-local-wt
cd "$ROOT"
git worktree remove --force "$WT" 2>/dev/null || true
git worktree add -b project-root-wt-smoke "$WT"
mkdir -p "$WT/packages/api"
```

Start Claude Code in `$WT/packages/api`.

Prompt:

```text
先告诉我 SessionStart 注入的 Current CWD、Project Root、Artifact Root 和 Runtime Root。
尝试声明 independent Project Root；如果 helper 拒绝，保留拒绝信息。
在没有创建/批准 CHG 前，先尝试向 worktree checkout 根目录的 root-note.js 写入 "should be blocked"，确认 hook 阻止。
然后按宿主 Project Root 创建一个小 CHG：在当前 cwd 的 worktree-note.md 写入 "worktree host ok"，再向 ../web/sibling-note.js 写入 "worktree sibling ok"，grep 验证后 close-chg 归档。
```

Expected:

- `set-project-root --mode independent` is refused in a real git worktree.
- Project Root and Runtime Root remain the host checkout, not `$WT/.pace`.
- The reported worktree context uses the worktree checkout identity, not the child directory name `api`.
- The worktree CHG uses the host `task.md` / `implementation_plan.md` / `changes/`.
- From `$WT/packages/api`, writes to `$WT/root-note.js` or `$WT/packages/web/sibling-note.js` are treated as current worktree checkout files and must pass the same C/E gate; they are not mistaken for host-checkout writes.
- No `$WT/.pace/project-root` / `$WT/.pace/artifact-root` or child `.pace/project-root` is created.

Verification:

```bash
test ! -e "$WT/.pace/project-root"
test ! -e "$WT/.pace/artifact-root"
test ! -e "$WT/packages/api/.pace/project-root"
rg 'worktree host ok|CHG-|HOTFIX-' "$ROOT/task.md" "$ROOT/implementation_plan.md" "$ROOT/walkthrough.md" "$ROOT/changes"
rg 'worktree host ok' "$WT/packages/api/worktree-note.md"
rg 'worktree sibling ok' "$WT/packages/web/sibling-note.js"
test ! -e "$WT/root-note.js" || ! rg 'should be blocked' "$WT/root-note.js"
```

## Smoke 17F: Vault Alias From Child Keeps Parent Runtime

Use `PACE_PROJECT_NAME` when the vault project name does not match the parent directory name.

```bash
ROOT=/mnt/k/AI/paceflow-smoke-project-root-alias
ALIAS=paceflow-smoke-project-root-renamed
rm -rf "$ROOT" "$PACE_VAULT_PATH/projects/$ALIAS"
mkdir -p "$ROOT/packages/api"
cd "$ROOT"
git init
printf 'console.log("alias root")\n' > index.js
printf 'console.log("alias child")\n' > packages/api/child.js
git add .
git -c user.name="PACEflow Smoke" -c user.email="paceflow-smoke@example.local" commit -m init
```

Start Claude Code in `$ROOT` with `PACE_PROJECT_NAME=$ALIAS`, choose vault artifacts, create and close a small CHG. Then start Claude Code in `$ROOT/packages/api` with the same env override.

Child prompt:

```text
先告诉我 SessionStart 注入的 Current CWD、Project Root、Artifact Root 和 Runtime Root。
不要声明 independent。创建一个小 CHG：把 child.js 输出改成 "alias child ok"，运行 node child.js 验证，通过后 close-chg 归档。
```

Expected:

- Project Root remains `$ROOT`, not `$ROOT/packages/api`.
- Artifact Root is `$PACE_VAULT_PATH/projects/$ALIAS/`.
- Runtime files stay in `$ROOT/.pace/`; no child `.pace` runtime split appears.
- Repeating the child prompt from a nested git repo under `$ROOT` still keeps Project Root at `$ROOT` until `set-project-root --mode independent` is run there.

Production smoke passes when all six scenarios show the intended Project Root, Artifact Root, and `.pace` runtime location without duplicate child artifacts.
