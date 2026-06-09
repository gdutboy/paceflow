# PACEflow 激活 UX 重构 Implementation Plan

> 状态：实现计划（pre-implementation，2026-06-09）。依据设计文档 `docs/superpowers/specs/2026-06-09-paceflow-activation-ux-design.md`。
> 关联 finding：`changes/findings/finding-2026-06-09-code-count-sessionstart-silent-lock-no-escape.md`（P0）。

## For agentic workers

逐 task 执行，每个 task 是一次 TDD 闭环：先写失败测试 → 跑测试看红 → 写最小实现 → 跑测试看绿 → commit。**禁止跳过红灯步骤**（先看测试失败再实现，证明测试真的在测东西）。每个改代码的 step 都给了完整代码块，直接用，不要臆造。所有路径是仓库根 `/mnt/k/AI/paceflow-hooks/paceflow` 下的相对路径。

验证命令（本仓库真实命令）：
```bash
node tests/test-pace-utils.js      # 纯函数单测（isPaceProject / detectSoftSignal）
node tests/test-hooks-e2e.js       # hook e2e（SessionStart / pre-tool-use / helper 子进程）
claude plugin validate ./plugin    # 校验 plugin manifest（含新增 commands）
git diff --check                   # 行尾/冲突标记检查
```

commit 后再开始下一个 task。一个 CHG 内的 task 串行依赖（A1→A2→A3...），跨 CHG 依赖见 spec §10（B/C/D 依赖 A，D 依赖 B）。

## Goal

把 PACEflow 从「自动检测即激活」改为「显式启用为主、软信号只提示」。野外项目（3+ 代码文件或 dated-plan 文件名）不再被弱信号静默锁定 + 无逃生口写代码 deny。弱信号降级为「提示 AI 主动询问用户」，真正激活靠用户 `/paceflow enable` 或既有 `changes/`。漏提示 = 不激活 = 野外安全。

## Architecture

两层正交（spec §3）：

| 层 | 函数 | 认什么 | 后果 |
|---|---|---|---|
| 激活层 | `isPaceProject`（收紧） | 强信号：`changes/` / artifact-root 配置 / `.pace-enabled` / legacy v5 | 激活门控（deny 等） |
| 软信号层 | `detectSoftSignal`（新） | code-count(3+) / dated-plan（文件名匹配） | 只提示，不激活不门控 |

状态机 3 态（spec §5），单一 `.pace/disabled` 标记：
```
新项目(软信号命中,无disabled,未enabled) ─AskUserQuestion─┬─启用→ /paceflow enable → enabled
                                                       └─暂不→ set-activation --disable → disabled
enabled  ──/paceflow disable──> disabled        (artifact 全保留)
disabled ──/paceflow enable───> 恢复(既有changes/→继承 / 无→首次选root)
disabled ──下次session───────> 静默(detectSoftSignal见标记→不提问)
```

数据流（spec §6）：SessionStart core hook `detectSoftSignal`→命中 → 注入「指示 AI 用 AskUserQuestion 问是否启用」（additionalContext，用户不可见，只能指示 AI）→ W11 不再对软信号建 `changes/`。

## Tech Stack

- Node.js（CommonJS）hooks，零运行时依赖。
- 自定义 test runner：`tests/test-utils.js` 的 `createTestRunner(prefix)` → `{ test, makeTmpDir, cleanup }`，断言用 Node 内置 `assert`。
- 单测直接 `require('../plugin/hooks/pace-utils')` 调纯函数；e2e 用 `child_process.execFileSync/spawnSync` 跑 hook/helper 子进程，`makeTmpDir` 造隔离 fixture，`CLAUDE_PROJECT_DIR` 指 cwd。
- Plugin command：`plugin/commands/*.md`（frontmatter `description`/`argument-hint`/`allowed-tools` + `$ARGUMENTS`），manifest 经 `plugin/.claude-plugin/plugin.json` 的 `"commands"` 数组声明。

---

## File Structure

### 新建文件

| 文件 | 职责 |
|---|---|
| `plugin/hooks/set-activation.js` | 状态 helper：`--enable`（删 `.pace/disabled` + 报告恢复/首次选 root）/ `--disable`（写 `.pace/disabled`）/ `--status`（输出当前状态机态）。照 `set-project-root.js` 模式：argv 解析 / 写 `.pace/` / 输出格式 / fail-safe。写入 Project Root 的 runtime（`getProjectRuntimeDir`）。 |
| `plugin/commands/paceflow.md` | 用户可见 slash command `/paceflow enable\|disable\|status`。frontmatter + 正文引导 AI：按 `$ARGUMENTS` 调 `set-activation.js` helper，enable 且无既有 changes/ 时引导选 artifact-root。 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `plugin/hooks/pace-utils.js` | A1：`isPaceProject` 移除 `code-count`（610 行）与 `superpowers`/dated-plan（606 行）两个 return（检测函数 `countCodeFiles`/`hasBridgeCandidatePlanFiles` 保留供复用）。A2：新增 `detectSoftSignal(cwd)` + 加入 `module.exports`。 |
| `plugin/hooks/session-start/runtime-effects.js` | A3：W11 `createTemplates` 守卫由「`paceSignal !== 'artifact'`」收紧为「强信号才建」（软信号信号已不进 `paceSignal`，但补充防御性注释 + 守卫）。实质：code-count/dated-plan 已 `paceSignal=false`，W11 整块不进，本改动锁定该行为不回归。 |
| `plugin/hooks/pre-tool-use.js` | A3b：移除 1593-1614 的 code-count-lookahead deny+createTemplates 块（第二个 code-count 激活路径，与 spec 冲突）；1616 软提醒块保留但去掉建议建 CHG 的措辞改为中性（可选，见 A3b）。D1：所有 PACE deny 文案末尾加逃生口。 |
| `plugin/hooks/session-start/collect-state.js` | C1：core group 计算 `state.softSignal`（`!paceSignal && !rootChoicePending` 时调 `detectSoftSignal`）。 |
| `plugin/hooks/session-start/layers.js` | C1：新增 `renderSoftSignalPrompt(state)` section，core 块 push 到 `l1head`。 |
| `plugin/.claude-plugin/plugin.json` | B2：加 `"commands": ["./commands/paceflow.md"]`。 |
| `tests/test-pace-utils.js` | A1/A2/A4：isPaceProject 收紧 + detectSoftSignal + 兼容回归单测。 |
| `tests/test-hooks-e2e.js` | A3/B1/C1/D1：W11 不建 changes/ e2e、set-activation helper 三子命令 e2e、软信号注入提问 e2e、deny 逃生口 e2e。 |

---

## CHG-A 激活信号收紧 + W11 病理根除

独立根治 P0/F2 静默锁定。验证：软信号不激活 + W11 不建 changes/ + 兼容回归。无依赖。

### A1. `isPaceProject` 移除 code-count 与 dated-plan 两个 return

**Files**：`tests/test-pace-utils.js`（isPaceProject 段，~30-90 行后追加）、`plugin/hooks/pace-utils.js:604-610`

#### ① 写失败测试

在 `tests/test-pace-utils.js` 的 `--- isPaceProject ---` 段（约 28 行起）末尾、`test('普通 task.md 无 PACE 签名 → 不误判 legacy', ...)` 之后追加：

```js
// CHG-A A1：isPaceProject 收紧——code-count / dated-plan 不再返回激活信号
test('3+ 代码文件但无强信号 → false（A1 收紧，原 code-count 不再激活）', () => {
  const dir = makeTmpDir('code-count-no-activate');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  assert.strictEqual(isPaceProject(dir), false);
});

test('docs/plans/<date>-*.md 但无强信号 → false（A1 收紧，原 superpowers/dated-plan 不再激活）', () => {
  const dir = makeTmpDir('dated-plan-no-activate');
  const planDir = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, '2026-06-09-some-feature.md'), '# 计划\n\n本计划引用 ' + path.basename(dir) + ' 项目。\n');
  assert.strictEqual(isPaceProject(dir), false);
});
```

#### ② 跑测试看失败

```bash
node tests/test-pace-utils.js
```
预期：两条新测试 `FAIL`（当前 `isPaceProject` 对 3 文件返回 `'code-count'`、对 dated-plan 返回 `'superpowers'`，断言 `=== false` 不成立）。其余既有测试仍 PASS。

#### ③ 最小实现

编辑 `plugin/hooks/pace-utils.js`，把 604-610 行（dated-plan 的 `superpowers` 分支 + code-count 兜底）整块删除，并更新函数 JSDoc 返回类型。

`isPaceProject` 函数体末尾原为：
```js
    if (getLegacyV5ArtifactDir(cwd)) return 'legacy';
    // A stored artifact-root choice is an explicit PACE entry signal even
    // before templates/changes have been lazily initialized.
    if (configuredDir || storedArtifactRootChoice) return 'manual';
    // 信号 2（强）：当前/近期/显式选中的 Superpowers plan 文件。
    // 旧 plan 只作为历史 backlog，不再让普通会话长期进入 superpowers 信号。
    if (hasBridgeCandidatePlanFiles(cwd)) return 'superpowers';
    // 信号 3（强）：手动激活标记
    if (fs.existsSync(path.join(getProjectStateDir(cwd), '.pace-enabled'))) return 'manual';
    // 信号 4（弱/兜底）：3+ 代码文件（原有逻辑）
    if (countCodeFiles(cwd) >= 3) return 'code-count';
  } catch(e) {}
  return false;
}
```

改为（删 dated-plan 的 `superpowers` return + code-count 的 `code-count` return；保留 `.pace-enabled` 的 `manual`）：
```js
    if (getLegacyV5ArtifactDir(cwd)) return 'legacy';
    // A stored artifact-root choice is an explicit PACE entry signal even
    // before templates/changes have been lazily initialized.
    if (configuredDir || storedArtifactRootChoice) return 'manual';
    // 强信号：手动激活标记（用户显式 enable 或既有 .pace-enabled）。
    if (fs.existsSync(path.join(getProjectStateDir(cwd), '.pace-enabled'))) return 'manual';
    // CHG-A A1：原 dated-plan（superpowers）与 code-count（3+ 文件）两个弱信号 return 已移除。
    //   它们信号强度与后果倒挂（最弱信号触发静默建 artifact + 永久锁定 + 写代码 deny），
    //   现降级到 detectSoftSignal——只提示 AI 主动询问用户，不再激活任何门控。
    //   countCodeFiles / hasBridgeCandidatePlanFiles 检测逻辑保留，供 detectSoftSignal 复用。
  } catch(e) {}
  return false;
}
```

并把函数上方 JSDoc 的 `@returns` 行：
```js
 * @returns {'artifact'|'superpowers'|'manual'|'code-count'|false}
```
改为：
```js
 * @returns {'artifact'|'manual'|'legacy'|false} 仅强信号激活；弱信号（code-count/dated-plan）见 detectSoftSignal
```

#### ④ 跑测试看通过

```bash
node tests/test-pace-utils.js
```
预期：两条新测试 PASS。既有 `有 changes/ → artifact` / `旧 v5 → legacy` / `空目录 → false` 等全 PASS（强信号不受影响）。

> 注：本仓库自身有 `changes/` → 仍 `artifact`，dogfood 不受影响。若既有测试里存在断言 code-count/superpowers 返回值的用例（如 `=== 'code-count'`），一并改为新语义或迁到 A4 的 detectSoftSignal 测试。执行前先 `grep -n "'code-count'\|'superpowers'" tests/test-pace-utils.js` 核对。

#### ⑤ commit

```bash
git add plugin/hooks/pace-utils.js tests/test-pace-utils.js
git commit -m "feat(activation): A1 isPaceProject 收紧——移除 code-count/dated-plan 弱信号 return（CHG-A）"
```

---

### A2. 新增 `detectSoftSignal(cwd)`

**Files**：`tests/test-pace-utils.js`（新增 `--- detectSoftSignal ---` 段）、`plugin/hooks/pace-utils.js`（`isPaceProject` 之后 ~613 行）、`plugin/hooks/pace-utils.js`（`module.exports` ~909 行）

#### ① 写失败测试

`tests/test-pace-utils.js` 顶部 import 行加入 `detectSoftSignal`：把
```js
const { isPaceProject, daysSinceISODate, ...
```
里加上 `detectSoftSignal`（与 `isPaceProject` 同列即可），即解构追加 `, detectSoftSignal`。

在 isPaceProject 测试段之后新增：
```js
// ============================================================
// detectSoftSignal()
// ============================================================
console.log('\n--- detectSoftSignal ---');

test('空目录 → false', () => {
  const dir = makeTmpDir('soft-empty');
  assert.strictEqual(detectSoftSignal(dir), false);
});

test('3+ 代码文件 → "code-count"', () => {
  const dir = makeTmpDir('soft-code-count');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.go'), '// c');
  assert.strictEqual(detectSoftSignal(dir), 'code-count');
});

test('1-2 代码文件 → false（未达 code-count 阈值，无 plan）', () => {
  const dir = makeTmpDir('soft-below-threshold');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  assert.strictEqual(detectSoftSignal(dir), false);
});

test('docs/plans/<date>-*.md（新鲜）→ "dated-plan"', () => {
  const dir = makeTmpDir('soft-dated-plan');
  const planDir = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(planDir, { recursive: true });
  // bridge-candidate 需新鲜（14 天内）或当前 plan；新建文件 mtime=now 满足 isFresh，
  // 且内容含项目名（nativePlanMatchesProject 的候选名匹配，但 bridge 候选不需 native 标记，仅 mtime 新鲜即可）。
  fs.writeFileSync(path.join(planDir, '2026-06-09-feature.md'), '# 计划\n');
  assert.strictEqual(detectSoftSignal(dir), 'dated-plan');
});

test('有 .pace/disabled → false（用户已禁用，不提示）', () => {
  const dir = makeTmpDir('soft-disabled');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'disabled'), '');
  assert.strictEqual(detectSoftSignal(dir), false);
});

test('已激活（有 changes/）→ false（已 enabled，不再软提示）', () => {
  const dir = makeTmpDir('soft-already-active');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  assert.strictEqual(detectSoftSignal(dir), false);
});

test('code-count 优先于 dated-plan（两者都命中返回 code-count）', () => {
  const dir = makeTmpDir('soft-both');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  const planDir = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(planDir, { recursive: true });
  fs.writeFileSync(path.join(planDir, '2026-06-09-x.md'), '# x\n');
  assert.strictEqual(detectSoftSignal(dir), 'code-count');
});
```

#### ② 跑测试看失败

```bash
node tests/test-pace-utils.js
```
预期：新段全 `FAIL`（`detectSoftSignal is not a function` 或 undefined）。

#### ③ 最小实现

在 `plugin/hooks/pace-utils.js` 的 `isPaceProject` 函数之后（约 613 行 `}` 之下）新增：
```js
/**
 * 软信号检测（CHG-A A2）：与 isPaceProject 激活层正交——只用于提示 AI 主动询问用户，
 *   不触发任何门控（deny / 建 artifact / 锁定）。
 *   规则：有 .pace/disabled（用户已禁用）或已激活（isPaceProject 真值，已 enabled）→ false（不提示）；
 *   否则 code-count（3+ 代码文件）优先于 dated-plan（docs/plans/<date>-*.md 文件名匹配，新鲜/当前）。
 *   读文件失败一律返回 false（fail-safe，与 hook fail-open 一致，spec §8）。
 * @param {string} cwd - 当前工作目录
 * @returns {'code-count'|'dated-plan'|false}
 */
function detectSoftSignal(cwd) {
  try {
    // 已禁用 → 不提示（与 isPaceProject 的 disabled 守卫同源：.pace/disabled 或 runtime/disabled）。
    const disabledPaths = [
      path.join(cwd, '.pace', 'disabled'),
      path.join(getProjectRuntimeDir(cwd), 'disabled'),
    ];
    if (disabledPaths.some(fp => fs.existsSync(fp))) return false;
    // 已激活（强信号）→ 不再软提示（已 enabled / 既有 changes/ / 配置 / legacy）。
    if (isPaceProject(cwd)) return false;
    // code-count 优先于 dated-plan（更直接的「这是代码项目」信号）。
    if (countCodeFiles(cwd) >= 3) return 'code-count';
    // dated-plan：复用 hasBridgeCandidatePlanFiles（docs/plans|docs/superpowers/plans 下
    //   <date>-*.md，新鲜 14 天内或当前 native plan）——即原 superpowers 信号被降级的同一判据。
    if (hasBridgeCandidatePlanFiles(cwd)) return 'dated-plan';
  } catch (e) {}
  return false;
}
```

在 `module.exports = {` 块里（约 909 行，`countCodeFiles` 同行或附近）加入 `detectSoftSignal`：把
```js
  resolveProjectCwd, ts, todayISO, daysSinceISODate, countCodeFiles, getProjectName, ...
```
追加 `detectSoftSignal`，例如改成
```js
  resolveProjectCwd, ts, todayISO, daysSinceISODate, countCodeFiles, detectSoftSignal, getProjectName, ...
```

#### ④ 跑测试看通过

```bash
node tests/test-pace-utils.js
```
预期：detectSoftSignal 段全 PASS。

> dated-plan 判据说明：spec §3 写「仅匹配文件名不验内容」。`hasBridgeCandidatePlanFiles` 在文件名匹配 `<date>-*.md` 基础上额外要求「新鲜（14 天内）或当前 plan」——这正是原 `superpowers` return 用的判据，1:1 降级最忠实（避免把半年前的旧 plan 也当软信号反复提示）。若主 session 决定要「任何 dated-plan 文件都提示」，改用 `hasPlanFiles(cwd)`（已 export，无新鲜度过滤）。本计划默认用 bridge-candidate（与被移除的 superpowers 信号同语义）。

#### ⑤ commit

```bash
git add plugin/hooks/pace-utils.js tests/test-pace-utils.js
git commit -m "feat(activation): A2 新增 detectSoftSignal——软信号层与激活层正交（CHG-A）"
```

---

### A3. W11 守卫确认不对软信号建 `changes/` + 移除 pre-tool-use code-count-lookahead

**Files**：`plugin/hooks/session-start/runtime-effects.js:90-105`（W11 core）、`plugin/hooks/session-start/runtime-effects.js:135-150`（W11 artifact）、`plugin/hooks/pre-tool-use.js:1593-1614`、`tests/test-hooks-e2e.js`（新增 W11 不建 changes/ e2e）

A1 移除 code-count return 后，code-count/dated-plan 项目 `isPaceProject → false` → `paceSignal=false`，W11 守卫 `paceSignal && paceSignal !== 'artifact'` 的 `paceSignal` 为假 → W11 整块不进。本 task **锁定该行为**（e2e）并铲除 pre-tool-use 里第二个独立的 code-count 激活路径（1593-1614），它在 `!paceSignal` 时仍 deny + createTemplates，是与 spec 冲突的残留病理。

#### ① 写失败测试

`tests/test-hooks-e2e.js` 末尾（cleanupAll 调用之前、其他 test 之后）追加。先确认顶部已有 `runHook`/`runHookDetailed` 辅助（约 34-63 行，已读到）。SessionStart 的 e2e 用法见现有 `runHook('session-start.js', { cwd, args: ['--group', 'core'], ... })`。

```js
// CHG-A A3：野外 code-count 项目（无 vault，无 disabled，无 changes/）SessionStart 不建 changes/
test('A3：SessionStart core 对 code-count 项目不建 changes/（W11 病理根除）', () => {
  const dir = makeTmpDir('a3-w11-no-changes');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  // 关键：无 PACE_VAULT_PATH，模拟野外（覆盖 e2e 顶部设的 _vaultTmpDir）。
  runHook('session-start.js', { cwd: dir, args: ['--group', 'core'], env: { PACE_VAULT_PATH: '' } });
  runHook('session-start.js', { cwd: dir, args: ['--group', 'artifact'], env: { PACE_VAULT_PATH: '' } });
  assert.strictEqual(fs.existsSync(path.join(dir, 'changes')), false, '不应静默创建 changes/');
  assert.strictEqual(fs.existsSync(path.join(dir, 'task.md')), false, '不应静默创建 task.md');
});

// CHG-A A3b：pre-tool-use 对野外 code-count 项目（Write 第 3 个文件）不再 deny、不再建模板
test('A3b：pre-tool-use Write 达 code-count 阈值不再 deny（lookahead 病理根除）', () => {
  const dir = makeTmpDir('a3-lookahead-no-deny');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  const target = path.join(dir, 'c.py');
  const r = runHookDetailed('pre-tool-use.js', {
    cwd: dir,
    stdin: { tool_name: 'Write', tool_input: { file_path: target, content: '# c' } },
    env: { PACE_VAULT_PATH: '' },
  });
  // 不应 deny（stdout 无 permissionDecision: deny）。软提醒（additionalContext）可接受。
  const out = r.stdout || '';
  if (out.trim()) {
    let parsed = null;
    try { parsed = JSON.parse(out); } catch (e) {}
    const decision = parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision;
    assert.notStrictEqual(decision, 'deny', 'code-count Write 不应被 deny');
  }
  assert.strictEqual(fs.existsSync(path.join(dir, 'task.md')), false, '不应建 task.md 模板');
});
```

> stdin 字段名核对：本仓库 hook 经 `paceUtils.withStdinParsed` 解析，e2e 现有用例用的 stdin 形态决定字段名（`tool_name`/`tool_input.file_path` 还是 `toolName`/`filePath`）。执行前 `grep -n "tool_name\|toolName\|tool_input\|file_path" tests/test-hooks-e2e.js | head` 对齐现有 Write/Edit e2e 的 stdin 写法，按现有惯例改字段名。

#### ② 跑测试看失败

```bash
node tests/test-hooks-e2e.js
```
预期：A3 PASS 或 FAIL（取决于 W11 当前是否真建——A1 改后 `paceSignal=false` 应已不建，A3 可能直接 PASS，作为回归锁定）；**A3b FAIL**（当前 1593-1614 lookahead 对 Write 第 3 文件 deny + createTemplates）。

#### ③ 最小实现

**(a) pre-tool-use.js 移除 code-count-lookahead 块。** 删除 1593-1614 行整块（从 `// T-079: 第二级` 注释到该 `if` 闭合 `}`）：

删除：
```js
    // T-079: 第二级 — off-by-one 前瞻判断（无强信号但 Write 新文件将达到阈值）
    if (!paceSignal && toolName === 'Write' && !fs.existsSync(filePath)) {
      const futureCount = codeCount + 1;
      if (futureCount >= 3) {
        if (needsArtifactRootChoice) {
          const output = denyOrHint(artifactRootChoiceReason);
          process.stdout.write(JSON.stringify(output));
          log(projectLogEntry('PreToolUse', `DENY_ARTIFACT_ROOT_CHOICE${teammateTag}`, { proj, signal: `code-count-lookahead(${futureCount})`, tool: toolName, file: filePath, dur: Date.now() - t0 }));
          return;
        }
        let createdFiles = [];
        try { createdFiles = createTemplates(cwd); } catch(e) {}
        const createdMsg = createdFiles.length > 0
          ? `已自动创建 Artifact 模板于 ${displayDir(artDir)}（${createdFiles.join(', ')}）。${artifactRootHint}。`
          : `${artifactRootHint}。`;
        const reason = `${createdMsg}即将写入第 ${futureCount} 个代码文件，达到 PACE 激活阈值。请先创建 v6 CHG；若用户已批准并准备开始，派 artifact-writer approve-and-start 后再写代码。字段格式见 Skill(paceflow:artifact-management)。\n${artifactWriterCreateChgHint(artDir)}\n${FORMAT_SNIPPETS.skillRef}`;
        const output = denyOrHint(reason);
        process.stdout.write(JSON.stringify(output));
        log(projectLogEntry('PreToolUse', `DENY${teammateTag}`, { proj, signal: `code-count-lookahead(${futureCount})`, tool: toolName, file: filePath, created: createdFiles.join(', '), reason, dur: Date.now() - t0 }));
        return;
      }
    }
```

替换为一行注释保留语义记录：
```js
    // CHG-A A3b：原 code-count-lookahead（Write 第 3 文件达阈值即 deny + 建模板）已移除——
    //   它是 isPaceProject 之外的第二个 code-count 激活路径，与「弱信号不门控」冲突（spec §3/§10）。
    //   code-count 现仅由 detectSoftSignal 在 SessionStart 提示 AI 询问用户，不在 pre-tool-use 拦截。
```

**(b) 软提醒块（1616-1631）措辞中性化（可选但建议）。** 该块在 `codeCount >= 1` 时注入 additionalContext，原文鼓励「建议先派 artifact-writer create-chg」。spec §2 转向「显式启用为主」，应改为指向 `/paceflow enable`，避免与新提问层措辞冲突。把：
```js
      const ctx = `提醒：这是项目中的第 ${displayCountForHint} 个代码文件，如果这是正式项目，建议先派 artifact-writer create-chg 建立 v6 CHG 后再继续写代码。`;
```
改为：
```js
      const ctx = `提醒：这是项目中的第 ${displayCountForHint} 个代码文件。如需用 PACEflow 管理本项目的任务/变更/验证，运行 /paceflow enable。`;
```

**(c) runtime-effects.js W11 守卫防御性注释。** A1 后 code-count/dated-plan 已不进 `paceSignal`，W11 已天然不建。补注释锁定意图，core（90-94 行）的 W11 守卫上方注释追加一句，并保持守卫表达式不变（守卫已正确：`paceSignal !== 'artifact'` 现在只剩 `manual`/`legacy` 这类强信号会进，软信号 `paceSignal=false` 整块短路）：

把 core 的 W11 注释（约 90-91 行）：
```js
  // === W11：createTemplates（重构前 282-313 的 else-if，both 无 eventType 守卫）===
  //   rootChoicePending 分支本身无写盘（只注入提示 + log，注入文本由 layers 生成、log 由编排层 flush）。
```
改为：
```js
  // === W11：createTemplates（重构前 282-313 的 else-if，both 无 eventType 守卫）===
  //   rootChoicePending 分支本身无写盘（只注入提示 + log，注入文本由 layers 生成、log 由编排层 flush）。
  //   CHG-A A3：code-count/dated-plan 弱信号已从 isPaceProject 移除 → paceSignal=false → 守卫整块短路，
  //   不再对软信号项目静默建 changes/。仅强信号（manual/legacy，paceSignal!=='artifact' 且非空）走懒建模板。
```
artifact 副本（135-136 行）同理追加一句相同语义注释（保持两处守卫一字不差的既有约束）。

> 守卫表达式本身不改：现有 `&& paceSignal && paceSignal !== 'artifact'` 在 `paceSignal=false` 时短路，已满足「不对软信号建」。无需改逻辑，只锁定注释 + 靠 A3 e2e 防回归。

#### ④ 跑测试看通过

```bash
node tests/test-hooks-e2e.js
node tests/test-pace-utils.js
```
预期：A3 + A3b PASS。既有 e2e（强信号 artifact 项目仍建模板 / deny 等）全 PASS。

#### ⑤ commit

```bash
git add plugin/hooks/pre-tool-use.js plugin/hooks/session-start/runtime-effects.js tests/test-hooks-e2e.js
git commit -m "feat(activation): A3 W11+pre-tool-use 不再对软信号建 changes/——根除静默锁定（CHG-A）"
```

---

### A4. 向后兼容回归测试

**Files**：`tests/test-pace-utils.js`（isPaceProject 段）

#### ① 写失败测试

追加（验证强信号项目零影响，即使同时有 3+ 代码文件 / dated-plan 也仍 `artifact`）：
```js
// CHG-A A4：向后兼容——已有 changes/ 的项目仍激活（强信号不受收紧影响），
//   即便同时满足 code-count（会污染旧 code-count 返回）也以 artifact 强信号为准。
test('A4：有 changes/ + 3 代码文件 → 仍 artifact（强信号优先，兼容回归）', () => {
  const dir = makeTmpDir('a4-compat');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  assert.strictEqual(isPaceProject(dir), 'artifact');
});

test('A4：.pace-enabled 标记 → manual（强信号保留）', () => {
  const dir = makeTmpDir('a4-manual');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', '.pace-enabled'), '');
  assert.strictEqual(isPaceProject(dir), 'manual');
});
```

> `.pace-enabled` 路径核对：`isPaceProject` 检查 `path.join(getProjectStateDir(cwd), '.pace-enabled')`。`getProjectStateDir(cwd)` 对独立 cwd 通常是 cwd 本身（非 `.pace/` 子目录）——执行前 `grep -n "function getProjectStateDir" plugin/hooks/pace-utils.js` 确认其返回值，按实际把 fixture 的标记写到正确目录（若 stateDir===cwd，则写 `path.join(dir, '.pace-enabled')` 而非 `.pace/` 下）。

#### ② 跑测试看失败 / ③ 实现

A4 是回归测试，若 A1 实现正确则**直接 PASS**（无需新实现代码）。先按 ① 写、跑一遍确认 PASS（验证强信号未被 A1 误伤）。若 `.pace-enabled` 路径写错导致 FAIL，按上述 note 修正 fixture 路径（这是测试 bug 不是实现 bug）。

#### ④ 跑测试看通过

```bash
node tests/test-pace-utils.js
```
预期：A4 两条 PASS。

#### ⑤ commit

```bash
git add tests/test-pace-utils.js
git commit -m "test(activation): A4 向后兼容回归——强信号项目不受 A1 收紧影响（CHG-A）"
```

---

## CHG-B 状态 helper + slash command

依赖 CHG-A。验证：三子命令行为 + 状态机转换。

### B1. `set-activation.js` helper（--enable / --disable / --status）

**Files**：`plugin/hooks/set-activation.js`（新建）、`tests/test-hooks-e2e.js`（新增 helper runner + 子命令 e2e）

照 `set-project-root.js` 模式（argv 解析 / `fail()` / 写 `.pace/` + `.gitignore` / stdout 格式 / `process.exitCode`）。写入 Project Root 的 runtime（`getProjectRuntimeDir`，与 disabled 守卫读取的 `path.join(getProjectRuntimeDir(cwd), 'disabled')` 一致）。

#### ① 写失败测试

`tests/test-hooks-e2e.js` 顶部 helper 常量区（约 11-15 行 `SET_PROJECT_ROOT_HELPER` 之后）加：
```js
const SET_ACTIVATION_HELPER = path.join(HOOKS_DIR, 'set-activation.js');
```
并在 runner 区（约 85 行 `runSetArtifactRootHelper` 附近）加一个 runner：
```js
function runSetActivationHelper({ cwd, args = [], env = {} }) {
  const r = spawnSync('node', [SET_ACTIVATION_HELPER, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
  return { code: r.status || 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}
```

测试段（末尾追加）：
```js
// CHG-B B1：set-activation.js 三子命令
test('B1：--disable 写 .pace/disabled + isPaceProject 后续 false', () => {
  const dir = makeTmpDir('b1-disable');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true }); // 先有强信号
  assert.strictEqual(require('../plugin/hooks/pace-utils').isPaceProject(dir), 'artifact');
  const r = runSetActivationHelper({ cwd: dir, args: ['--disable'] });
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.pace', 'disabled')), 'disabled 标记应写入');
  // disabled 守卫读 getProjectRuntimeDir(cwd)/disabled 或 .pace/disabled——任一存在即 false。
  // 清缓存后重判（isPaceProject 内 disabled 守卫优先级最高）。
  delete require.cache[require.resolve('../plugin/hooks/pace-utils')];
  const fresh = require('../plugin/hooks/pace-utils');
  assert.strictEqual(fresh.isPaceProject(dir), false, 'disable 后 isPaceProject 应 false');
});

test('B1：--enable 删 disabled 标记 + 既有 changes/ 自动恢复 artifact', () => {
  const dir = makeTmpDir('b1-enable-restore');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  runSetActivationHelper({ cwd: dir, args: ['--disable'] });
  assert.ok(fs.existsSync(path.join(dir, '.pace', 'disabled')));
  const r = runSetActivationHelper({ cwd: dir, args: ['--enable'] });
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  assert.strictEqual(fs.existsSync(path.join(dir, '.pace', 'disabled')), false, 'enable 应删 disabled 标记');
  delete require.cache[require.resolve('../plugin/hooks/pace-utils')];
  assert.strictEqual(require('../plugin/hooks/pace-utils').isPaceProject(dir), 'artifact', '删标记后既有 changes/ 自动恢复');
});

test('B1：--enable 无既有 changes/ → 输出提示选 artifact-root（首次启用）', () => {
  const dir = makeTmpDir('b1-enable-fresh');
  const r = runSetActivationHelper({ cwd: dir, args: ['--enable'] });
  assert.strictEqual(r.code, 0, r.stdout + r.stderr);
  // 首次启用：写 .pace-enabled 强信号 + 引导选 artifact-root。
  assert.match(r.stdout, /artifact-root|set-artifact-root|选择/, '首次 enable 应引导选 artifact-root');
});

test('B1：--status 输出当前状态机态', () => {
  const dir = makeTmpDir('b1-status');
  let r = runSetActivationHelper({ cwd: dir, args: ['--status'] });
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /disabled|enabled|未启用|inactive/, 'status 应报告一种状态');
});

test('B1：--disable 幂等（已 disabled 再 disable 不报错）', () => {
  const dir = makeTmpDir('b1-disable-idempotent');
  runSetActivationHelper({ cwd: dir, args: ['--disable'] });
  const r = runSetActivationHelper({ cwd: dir, args: ['--disable'] });
  assert.strictEqual(r.code, 0, '重复 disable 应幂等成功');
});

test('B1：未知参数 → 非零退出 + usage', () => {
  const dir = makeTmpDir('b1-bad-arg');
  const r = runSetActivationHelper({ cwd: dir, args: ['--bogus'] });
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stdout, /Usage|--enable|--disable|--status/);
});
```

> 注：上面用 `delete require.cache` + 重 require 来规避 pace-utils 的 `_codeCountCache` / artifact-dir 模块级缓存对同进程多次 isPaceProject 的干扰。若 e2e 已有同模式可复用；否则保留此写法（隔离 fixture 不同目录，disabled 守卫本身不缓存，主要是确保读到新写的标记）。

#### ② 跑测试看失败

```bash
node tests/test-hooks-e2e.js
```
预期：B1 全 FAIL（`set-activation.js` 不存在，spawn 报错 code≠0 / stdout 空）。

#### ③ 最小实现

新建 `plugin/hooks/set-activation.js`：
```js
#!/usr/bin/env node
// PACEflow 激活状态 helper：--enable / --disable / --status。
// 统一写入 Project Root 的 runtime（.pace/）：disabled 标记控制 detectSoftSignal/isPaceProject 的禁用守卫；
// enable 删 disabled 标记（既有 changes/ 自动恢复），首次启用额外写 .pace-enabled 强信号并引导选 artifact-root。
// 照 set-project-root.js 模式：argv 解析 / fail() / 写 .pace + .gitignore / stdout 报告 / process.exitCode。

const fs = require('fs');
const path = require('path');
const paceUtils = require('./pace-utils');

const LOG_PATH = path.join(__dirname, 'pace-hooks.log');
const log = paceUtils.createLogger(LOG_PATH);

function parseArgs(argv) {
  const args = { action: '', cwd: '', help: false, unknown: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--enable') {
      args.action = 'enable';
    } else if (arg === '--disable') {
      args.action = 'disable';
    } else if (arg === '--status') {
      args.action = 'status';
    } else if (arg === '--cwd') {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) { args.unknown.push(arg); }
      else { args.cwd = String(argv[++i]); }
    } else if (arg.startsWith('-')) {
      args.unknown.push(arg);
    }
  }
  args.cwd = args.cwd ? path.resolve(args.cwd) : paceUtils.resolveProjectCwd();
  return args;
}

function usage() {
  return [
    'Usage:',
    `  node "${path.resolve(__dirname, 'set-activation.js').replace(/\\/g, '/')}" --enable  [--cwd <project-cwd>]`,
    `  node "${path.resolve(__dirname, 'set-activation.js').replace(/\\/g, '/')}" --disable [--cwd <project-cwd>]`,
    `  node "${path.resolve(__dirname, 'set-activation.js').replace(/\\/g, '/')}" --status  [--cwd <project-cwd>]`,
    '',
    '--enable  启用 PACEflow（删除 disabled 标记；既有 changes/ 自动恢复，否则首次启用并引导选 artifact-root）。',
    '--disable 禁用 PACEflow（写 .pace/disabled 标记；不删除任何 artifact，可随时 --enable 恢复）。',
    '--status  输出当前激活状态。',
  ].join('\n');
}

function runtimeDir(cwd) {
  return paceUtils.getProjectRuntimeDir(cwd);
}
function disabledPath(cwd) {
  return path.join(runtimeDir(cwd), 'disabled');
}
function paceEnabledPath(cwd) {
  return path.join(paceUtils.getProjectStateDir(cwd), '.pace-enabled');
}

function ensureRuntimeDir(cwd) {
  const dir = runtimeDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  const gitignore = path.join(dir, '.gitignore');
  if (!fs.existsSync(gitignore)) fs.writeFileSync(gitignore, '*\n', 'utf8');
  return dir;
}

function fail(cwd, action, message, fields = {}) {
  log(paceUtils.logEntry('SetActivation', action, { proj: paceUtils.getProjectName(cwd), ...fields }));
  process.stdout.write(`${message}\n`);
  process.exitCode = 2;
}

// 当前激活态：disabled 标记存在 → 'disabled'；否则按 isPaceProject 真值 → 'enabled'，false → 'inactive'。
function currentState(cwd) {
  if (fs.existsSync(disabledPath(cwd)) || fs.existsSync(path.join(cwd, '.pace', 'disabled'))) return 'disabled';
  const signal = paceUtils.isPaceProject(cwd);
  return signal ? 'enabled' : 'inactive';
}

function doDisable(cwd) {
  try {
    ensureRuntimeDir(cwd);
    fs.writeFileSync(disabledPath(cwd), 'disabled\n', 'utf8');
  } catch (e) {
    fail(cwd, 'DENY_WRITE_FAILED', `无法写入 disabled 标记：${disabledPath(cwd).replace(/\\/g, '/')}\n底层错误：${e.message || String(e)}\n可手动创建该文件（内容任意）以禁用 PACEflow。`, { path: disabledPath(cwd) });
    return;
  }
  log(paceUtils.logEntry('SetActivation', 'DISABLE', { proj: paceUtils.getProjectName(cwd), path: disabledPath(cwd) }));
  process.stdout.write([
    'PACEflow 已禁用（disabled）。',
    `disabled-marker: ${disabledPath(cwd).replace(/\\/g, '/')}`,
    '本操作只写禁用标记，不删除任何 artifact（changes/ 等全部保留）。',
    '随时可运行 /paceflow enable 或 set-activation --enable 恢复。',
  ].join('\n') + '\n');
}

function doEnable(cwd) {
  // 删 disabled 标记（两个可能位置都删）。
  for (const fp of [disabledPath(cwd), path.join(cwd, '.pace', 'disabled')]) {
    try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
  }
  // 既有强信号（changes/ / 配置 / legacy）→ 删标记即自动恢复，无需写 .pace-enabled。
  const signalAfter = paceUtils.isPaceProject(cwd);
  if (signalAfter) {
    log(paceUtils.logEntry('SetActivation', 'ENABLE_RESTORE', { proj: paceUtils.getProjectName(cwd), signal: signalAfter }));
    process.stdout.write([
      'PACEflow 已启用（恢复既有项目）。',
      `signal: ${signalAfter}`,
      '既有 changes/ / 配置已自动恢复，可继续按 PACE 流程工作。',
      '下一步：调用 Skill(paceflow:pace-workflow) 继续创建/恢复 CHG。',
    ].join('\n') + '\n');
    return;
  }
  // 无强信号 → 首次启用：写 .pace-enabled（manual 强信号）+ 引导选 artifact-root。
  try {
    fs.mkdirSync(path.dirname(paceEnabledPath(cwd)), { recursive: true });
    fs.writeFileSync(paceEnabledPath(cwd), 'enabled\n', 'utf8');
  } catch (e) {
    fail(cwd, 'DENY_WRITE_FAILED', `无法写入 .pace-enabled 标记：${paceEnabledPath(cwd).replace(/\\/g, '/')}\n底层错误：${e.message || String(e)}`, { path: paceEnabledPath(cwd) });
    return;
  }
  log(paceUtils.logEntry('SetActivation', 'ENABLE_FIRST', { proj: paceUtils.getProjectName(cwd), path: paceEnabledPath(cwd) }));
  process.stdout.write([
    'PACEflow 已启用（首次）。',
    `enabled-marker: ${paceEnabledPath(cwd).replace(/\\/g, '/')}`,
    '下一步：选择 artifact 存放位置（用户选择后运行其一）：',
    `  node "${paceUtils.SET_ARTIFACT_ROOT_SCRIPT}" --choice local --cwd "${cwd.replace(/\\/g, '/')}"`,
    `  node "${paceUtils.SET_ARTIFACT_ROOT_SCRIPT}" --choice vault --cwd "${cwd.replace(/\\/g, '/')}"`,
    '选择完成后调用 Skill(paceflow:pace-workflow) 创建首个 CHG。',
    '如需撤销启用，运行 /paceflow disable。',
  ].join('\n') + '\n');
}

function doStatus(cwd) {
  const state = currentState(cwd);
  const soft = (() => { try { return paceUtils.detectSoftSignal(cwd); } catch (e) { return false; } })();
  log(paceUtils.logEntry('SetActivation', 'STATUS', { proj: paceUtils.getProjectName(cwd), state, soft: soft || 'none' }));
  const lines = [
    `PACEflow 激活状态: ${state}`,
    `current-cwd: ${cwd.replace(/\\/g, '/')}`,
  ];
  if (state === 'disabled') lines.push(`disabled-marker: ${disabledPath(cwd).replace(/\\/g, '/')}`, '运行 /paceflow enable 恢复。');
  else if (state === 'enabled') lines.push('PACEflow 正在管理本项目；运行 /paceflow disable 可禁用。');
  else lines.push(soft ? `检测到软信号（${soft}）但未启用；运行 /paceflow enable 启用。` : '未检测到激活信号；运行 /paceflow enable 可手动启用。');
  process.stdout.write(lines.join('\n') + '\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write(`${usage()}\n`); return; }
  if (args.unknown.length > 0) {
    fail(args.cwd, 'DENY_UNKNOWN_OPTION', `set-activation 不支持参数：${args.unknown.join(', ')}。\n只支持 --enable / --disable / --status / --cwd。\n\n${usage()}`, { options: args.unknown.join(',') });
    return;
  }
  if (!args.action) {
    fail(args.cwd, 'DENY_MISSING_ACTION', `缺少操作。\n\n${usage()}`);
    return;
  }
  if (args.action === 'enable') doEnable(args.cwd);
  else if (args.action === 'disable') doDisable(args.cwd);
  else doStatus(args.cwd);
}

main();
```

> 实现前核对两处真实 export（已确认存在）：`paceUtils.createLogger`、`paceUtils.logEntry`、`paceUtils.getProjectName`、`paceUtils.getProjectRuntimeDir`、`paceUtils.getProjectStateDir`、`paceUtils.resolveProjectCwd`、`paceUtils.SET_ARTIFACT_ROOT_SCRIPT`、`paceUtils.isPaceProject`、`paceUtils.detectSoftSignal`（A2 新增）。`getProjectStateDir(cwd)` 返回 Project Root 目录（独立项目即 cwd），`.pace-enabled` 与 isPaceProject 检查路径 `path.join(getProjectStateDir(cwd), '.pace-enabled')` 一致——核对 A4 note 后保证两边对齐。

#### ④ 跑测试看通过

```bash
node tests/test-hooks-e2e.js
```
预期：B1 全 PASS。

#### ⑤ commit

```bash
git add plugin/hooks/set-activation.js tests/test-hooks-e2e.js
git commit -m "feat(activation): B1 set-activation helper——enable/disable/status 状态机 helper（CHG-B）"
```

---

### B2. slash command `/paceflow enable|disable|status`

**Files**：`plugin/commands/paceflow.md`（新建）、`plugin/.claude-plugin/plugin.json`（加 `commands`）、`tests/test-hooks-e2e.js`（manifest 结构断言，可选）

机制确认（已查证安装的 claude-hud / commit-commands / feature-dev 三个插件）：plugin command = `plugin/commands/<name>.md`（frontmatter `description` / `argument-hint` / `allowed-tools` + 正文是给 AI 的指令，`$ARGUMENTS` 注入用户参数），manifest 用 `plugin.json` 的 `"commands": ["./commands/<name>.md"]` 声明。文件名 `paceflow.md` → slash `/paceflow`。

#### ① 写失败测试

`tests/test-hooks-e2e.js` 末尾追加 manifest + command 文件存在性断言（轻量结构校验；命令语义靠 `claude plugin validate` 与人工 dogfood）：
```js
// CHG-B B2：plugin manifest 声明 paceflow command + 命令文件存在
test('B2：plugin.json 声明 commands 含 ./commands/paceflow.md', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(Array.isArray(manifest.commands), 'plugin.json 应有 commands 数组');
  assert.ok(manifest.commands.includes('./commands/paceflow.md'), 'commands 应含 paceflow.md');
});

test('B2：commands/paceflow.md 存在且声明 enable/disable/status 与 set-activation', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'commands', 'paceflow.md'), 'utf8');
  assert.match(md, /set-activation\.js/, '应引用 set-activation helper');
  assert.match(md, /enable/);
  assert.match(md, /disable/);
  assert.match(md, /status/);
  assert.match(md, /\$ARGUMENTS|\$1/, '应消费用户参数');
});
```

#### ② 跑测试看失败

```bash
node tests/test-hooks-e2e.js
```
预期：B2 两条 FAIL（manifest 无 commands / 文件不存在）。

#### ③ 最小实现

新建 `plugin/commands/paceflow.md`：
```markdown
---
description: 启用 / 禁用 / 查询 PACEflow 在本项目的激活状态
argument-hint: enable | disable | status
allowed-tools: Bash, AskUserQuestion, Read
---

# /paceflow

用户运行了 `/paceflow $ARGUMENTS`。根据参数管理 PACEflow 在当前项目的激活状态。helper 脚本位于 `${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js`。

## 按 `$ARGUMENTS` 分派

- `enable` → 运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --enable --cwd "<当前项目 cwd 绝对路径>"`
  - 若 helper 输出「首次启用」并要求选 artifact-root：用 AskUserQuestion 让用户选「Obsidian vault project」或「本地项目目录」（至少两个选项），再按用户选择运行 helper 输出里给的对应 `set-artifact-root.js --choice local|vault` 命令。
  - 若 helper 输出「恢复既有项目」：无需选 root，直接按提示调用 `Skill(paceflow:pace-workflow)` 继续。
- `disable` → 运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --disable --cwd "<当前项目 cwd 绝对路径>"`。向用户确认 PACEflow 已禁用、artifact 未被删除、随时可 `/paceflow enable` 恢复。
- `status`（或参数为空）→ 运行 Bash：`node "${CLAUDE_PLUGIN_ROOT}/hooks/set-activation.js" --status --cwd "<当前项目 cwd 绝对路径>"`，把状态原样转述给用户。
- 其他参数 → 运行 `--status` 并提示有效参数为 `enable` / `disable` / `status`。

## 规则

- `--cwd` 必须传当前项目根的绝对路径（避免 shell cd 漂移把状态写错 runtime）。
- helper 是确定性写盘；不要手写 `.pace/disabled` 或 `.pace-enabled`，一律经 helper。
- 把 helper 的 stdout 原样作为依据向用户报告，不要臆测状态。
- **disable 是用户退出权，不是 AI 绕过门控的手段（spec §5.1 不变量 2）**：本 command 由用户主动运行（用户已表达停用意图），直接执行即可。但在**其他场景**你（AI）被 PACE deny 拦住时，**不得为绕过单次 deny 自行运行 `set-activation --disable`**——正确做法是走 PACE 流程（建 CHG / approve-and-start）。只有用户**明确表达「不想用 PACEflow」**时才停用；若判断用户可能想停用但用户没明说，先用 AskUserQuestion 确认，不自作主张。
```

编辑 `plugin/.claude-plugin/plugin.json`，在 `"agents"` 行后加 `"commands"`：
```json
{
  "name": "paceflow",
  "description": "PACE workflow enforcement system — Plan-Artifact-Check-Execute-Verify-Review protocol with hooks",
  "version": "6.5.1",
  "author": {
    "name": "paceaitian"
  },
  "homepage": "https://github.com/paceaitian/paceflow",
  "repository": "https://github.com/paceaitian/paceflow",
  "license": "MIT",
  "keywords": ["workflow", "pace", "hooks", "planning", "artifacts"],
  "agents": ["./agents/artifact-writer.md"],
  "commands": ["./commands/paceflow.md"]
}
```

#### ④ 跑测试看通过

```bash
node tests/test-hooks-e2e.js
claude plugin validate ./plugin
```
预期：B2 两条 PASS；`claude plugin validate` 通过（commands 数组被 manifest schema 接受，文件路径有效）。

#### ⑤ commit

```bash
git add plugin/commands/paceflow.md plugin/.claude-plugin/plugin.json tests/test-hooks-e2e.js
git commit -m "feat(activation): B2 /paceflow enable|disable|status slash command（CHG-B）"
```

---

### B3. disable 防滥用约束（pace-workflow skill）+ 无条件可达测试

**Files**：`plugin/skills/pace-workflow/SKILL.md`（加 disable 防滥用约束）、`tests/test-hooks-e2e.js`（disable 无条件可达 e2e）

落实 spec §5.1 不变量 2 的「AI 行为约束」到 pace-workflow skill（command 已写一份，skill 是 AI 被 deny 时读的主入口），并用 e2e 锁定不变量 1（disable 不被门控拦）。

#### ① 写测试（回归锁定 + 不变量）

`tests/test-hooks-e2e.js` 末尾追加（spec §9 第 7 项：已激活+无活跃任务项目，Bash 跑 disable helper 不被 pre-tool-use 拦）：
```js
// CHG-B B3：disable 无条件可达——已激活+无活跃任务项目 Bash 跑 set-activation --disable 不被门控拦（spec §5.1 不变量1）
test('B3：已激活+无活跃任务 Bash 跑 set-activation --disable 不被 pre-tool-use deny', () => {
  const dir = makeTmpDir('b3-disable-unconditional');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true }); // artifact 强信号
  fs.writeFileSync(path.join(dir, 'task.md'), '# 任务\n\n<!-- ARCHIVE -->\n'); // 无活跃任务
  const cmd = `node "${SET_ACTIVATION_HELPER}" --disable --cwd "${dir}"`;
  const r = runHookDetailed('pre-tool-use.js', {
    cwd: dir,
    stdin: { tool_name: 'Bash', tool_input: { command: cmd } },
    env: { PACE_VAULT_PATH: '' },
  });
  if (r.stdout.trim()) {
    let parsed = null; try { parsed = JSON.parse(r.stdout); } catch (e) {}
    const decision = parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecision;
    assert.notStrictEqual(decision, 'deny', 'disable 命令不应被 pre-tool-use 拦（逃生口完整性，spec §5.1 不变量1）');
  }
});
```

#### ② 跑测试

```bash
node tests/test-hooks-e2e.js
```
预期：B3 **PASS**（bash-guard mutation gate 不保护 `.pace/disabled`，审计发现 4 已确证）——本测试是**回归锁定**，防未来改 bash-guard 误伤逃生路。**执行时核对**：`grep -n "disabled\|set-activation" plugin/hooks/bash-guard.js`，确认 bash-guard 不把 set-activation 命令或 `.pace/disabled` 纳入 mutation gate；若意外 FAIL，说明 bash-guard 已/将保护它，需在 bash-guard 显式豁免 `set-activation.js` / `.pace/disabled`（逃生口必须无条件可达）。stdin 字段名同 D1（按现有 Bash e2e 惯例对齐 `tool_name`/`tool_input.command`）。

#### ③ pace-workflow skill 加约束

编辑 `plugin/skills/pace-workflow/SKILL.md`，在 C 阶段（批准门）或激活判定附近加一段（spec §5.1 不变量 2）：
```markdown
### disable 是用户退出权，非 AI 绕过手段

被 PACE deny 拦住时，正确做法是走 PACE 流程（建 CHG / approve-and-start），**不是 disable 绕过**。`/paceflow disable` 停用整个项目的 PACEflow，只在用户**明确表达「不想用 PACE 管理本项目」**时执行；AI **不得为绕过单次 deny 自主 disable**。若判断用户可能想停用但用户未明说，先用 AskUserQuestion 确认，不自作主张。
```

#### ④ 跑测试看通过

```bash
node tests/test-hooks-e2e.js
claude plugin validate ./plugin
```
预期：B3 PASS，plugin validate 通过。

#### ⑤ commit

```bash
git add plugin/skills/pace-workflow/SKILL.md tests/test-hooks-e2e.js
git commit -m "feat(activation): B3 disable 防滥用约束（skill）+ 无条件可达回归测试（CHG-B / spec §5.1）"
```

---

## CHG-C 提问层

依赖 CHG-A。验证：软信号命中注入提问指示、有标记不注入。

### C1. SessionStart 软信号命中 → 注入提问指示文案

**Files**：`plugin/hooks/session-start/collect-state.js`（core 算 `state.softSignal`）、`plugin/hooks/session-start/layers.js`（`renderSoftSignalPrompt` + core push l1head）、`tests/test-hooks-e2e.js`（注入 e2e）

注入是 additionalContext（用户不可见），只能**指示 AI** 用 AskUserQuestion 问用户（spec §2/§7）。条件：`detectSoftSignal` 命中 ∧ 未 enabled（`!paceSignal`）∧ 无 disabled。`detectSoftSignal` 内部已含 disabled / 已激活 → false，故只要 `state.softSignal` 真值即满足全部条件。

#### ① 写失败测试

`tests/test-hooks-e2e.js` 末尾追加（断言 SessionStart core stdout 注入提问指示，且 disabled 项目不注入）：
```js
// CHG-C C1：软信号命中 → SessionStart core 注入「指示 AI 用 AskUserQuestion 问启用」
test('C1：code-count 项目 SessionStart core 注入提问指示', () => {
  const dir = makeTmpDir('c1-prompt-inject');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  const r = runHook('session-start.js', { cwd: dir, args: ['--group', 'core'], env: { PACE_VAULT_PATH: '' } });
  assert.match(r.stdout, /AskUserQuestion/, '应指示 AI 用 AskUserQuestion');
  assert.match(r.stdout, /\/paceflow enable/, '应指向 /paceflow enable');
  // spec §7：不写「N 个代码文件」机制细节。
  assert.doesNotMatch(r.stdout, /\d+\s*个代码文件/, '不应暴露 code-count 机制细节');
});

test('C1：有 .pace/disabled 的 code-count 项目 → 不注入提问指示', () => {
  const dir = makeTmpDir('c1-disabled-no-prompt');
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'disabled'), '');
  const r = runHook('session-start.js', { cwd: dir, args: ['--group', 'core'], env: { PACE_VAULT_PATH: '' } });
  assert.doesNotMatch(r.stdout, /AskUserQuestion.*启用|启用.*AskUserQuestion/, 'disabled 项目不应注入提问指示');
});

test('C1：已激活（changes/）项目 → 不注入软信号提问指示', () => {
  const dir = makeTmpDir('c1-active-no-prompt');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.js'), '// a');
  fs.writeFileSync(path.join(dir, 'b.ts'), '// b');
  fs.writeFileSync(path.join(dir, 'c.py'), '# c');
  const r = runHook('session-start.js', { cwd: dir, args: ['--group', 'core'], env: { PACE_VAULT_PATH: _vaultTmpDir } });
  assert.doesNotMatch(r.stdout, /检测到本项目可纳入 PACEflow 管理但未启用/, '已激活项目不出软信号提问');
});
```

#### ② 跑测试看失败

```bash
node tests/test-hooks-e2e.js
```
预期：第 1 条 FAIL（当前无软信号注入）；第 2、3 条可能 PASS（当前本就不注入，作为回归锁定）。

#### ③ 最小实现

**(a) collect-state.js 算 `state.softSignal`。** 在 `collectState` 解构 paceUtils 处（约 29-33 行）加入 `detectSoftSignal`：
```js
  const {
    ARTIFACT_FILES, readFull, summarizeActiveChanges, changeOwnerStatus,
    getNativePlanPath, formatBridgeHint, scanRelatedNotes, getProjectName,
    resolveEffectiveProjectRoot, getArtifactDir, detectSoftSignal,
  } = paceUtils;
```
在 `return { ... }` 之前（约 137 行，`if (isCore) { for (const s of activeChangeSummaries)...` 之后）加：
```js
  // --- 软信号（CHG-C C1）---
  // 仅 core 算：软信号提问指示在 core group 注入。detectSoftSignal 内部已含
  //   disabled / 已激活 → false，故此处仅需 paceSignal 为假时才询问（已激活不再提示）。
  //   rootChoicePending（首次 artifact-root 选择）时不抢戏——那已是激活流程，软信号让位。
  let softSignal = false;
  if (isCore && !paceSignal && !rootChoicePending) {
    try { softSignal = detectSoftSignal(cwd); } catch (e) { softSignal = false; }
  }
```
在返回对象里加字段（约 168 行 `relatedNotes,` 之后）：
```js
    // 相关讨论
    relatedNotes,
    // 软信号提问（CHG-C）
    softSignal,
```

**(b) layers.js 渲染 `renderSoftSignalPrompt` 并 push l1head。** 在 `buildLayers` 的 `isCore` 块、项目上下文/工作流入口之前（约 122 行 `if (isCore) {` 之内最前面，让提问指示靠前不被截）加：
```js
    // === 0. 软信号提问指示（CHG-C C1）===
    //   软信号命中（code-count/dated-plan）且未激活 → 指示 AI 在响应用户前用 AskUserQuestion 问是否启用。
    //   additionalContext 用户不可见，只能指示 AI 提问，不能直接问用户（spec §2）。放 l1head 最前（head 永不截）。
    const softPrompt = renderSoftSignalPrompt(state);
    if (softPrompt) l1head.push(softPrompt);
```
在文件的 section 渲染函数区（如 `renderProjectContext` 之前，约 216 行）加纯函数：
```js
/** 软信号提问指示 section（CHG-C C1 / spec §7）。泛化措辞：讲价值不讲机制，不写「N 个代码文件」。 */
function renderSoftSignalPrompt(state) {
  if (!state.softSignal) return '';
  return [
    '=== PACEflow 启用询问 ===',
    '检测到本项目可纳入 PACEflow 管理但未启用。在响应用户前，用 AskUserQuestion 询问是否启用：',
    '问题：「PACEflow 可以管理这个项目的开发流程（任务追踪 / 变更记录 / 验证审计）。是否启用？」',
    '选项「启用」→ 引导运行 /paceflow enable（首次会让用户选 artifact 存放位置）。',
    '选项「暂不」→ 运行 /paceflow disable（本项目不再主动询问，随时可 /paceflow enable 开启）。',
    '在用户回答前不要创建 changes/、不要派 artifact-writer、不要按 PACE 流程拦截写代码。',
    '',
  ].join('\n') + '\n';
}
```

> 措辞对齐 spec §7：注入指示 AI 文案不出现「N 个代码文件」（dated-plan 触发时本就无代码文件，写了会自相矛盾）。AI 问用户的话术固定为「PACEflow 可以管理这个项目的开发流程（任务追踪 / 变更记录 / 验证审计）。是否启用？」，选项「启用 / 暂不」，与 spec §7 一字对齐。测试 C1 第 1 条已断言含 `AskUserQuestion` + `/paceflow enable` 且不含「N 个代码文件」。

#### ④ 跑测试看通过

```bash
node tests/test-hooks-e2e.js
node tests/test-pace-utils.js
```
预期：C1 三条全 PASS。既有 SessionStart e2e（artifact 项目注入工作流入口等）不受影响（softSignal 仅在 `!paceSignal` 时真值）。

#### ⑤ commit

```bash
git add plugin/hooks/session-start/collect-state.js plugin/hooks/session-start/layers.js tests/test-hooks-e2e.js
git commit -m "feat(activation): C1 SessionStart 软信号命中注入 AskUserQuestion 提问指示（CHG-C）"
```

---

## CHG-D deny 逃生口

依赖 CHG-B（逃生口指向 `/paceflow disable`，需 B 的命令已存在）。验证：deny reason 含逃生口。

### D1. 所有 PACE deny 文案末尾加逃生口

**Files**：`plugin/hooks/pre-tool-use.js`（`denyOrHint` ~196 / `hardDeny` ~209 统一注入点）、`tests/test-hooks-e2e.js`（deny 逃生口断言）

最 DRY 的做法：在 `denyOrHint` 与 `hardDeny` 两个集中出口给 `reason` 追加逃生口尾行，覆盖所有 PACE deny（artifact-root / native-plan / 无活跃任务 / v5 迁移 / hardDeny 等），无需逐处改文案。

#### ① 写失败测试

`tests/test-hooks-e2e.js` 末尾追加（造一个强信号 artifact 项目、无活跃任务，触发 deny，断言 reason 含逃生口）：
```js
// CHG-D D1：PACE deny 文案末尾含逃生口 /paceflow disable
test('D1：无活跃任务 deny 文案含 /paceflow disable 逃生口', () => {
  const dir = makeTmpDir('d1-deny-escape');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true }); // artifact 强信号
  fs.writeFileSync(path.join(dir, 'task.md'), '# 任务\n\n<!-- ARCHIVE -->\n'); // 无活跃任务
  const target = path.join(dir, 'feature.js');
  const r = runHookDetailed('pre-tool-use.js', {
    cwd: dir,
    stdin: { tool_name: 'Write', tool_input: { file_path: target, content: '// x' } },
    env: { PACE_VAULT_PATH: '' },
  });
  let parsed = null;
  try { parsed = JSON.parse(r.stdout); } catch (e) {}
  assert.ok(parsed && parsed.hookSpecificOutput, 'deny 应产出 hookSpecificOutput: ' + r.stdout);
  const reason = parsed.hookSpecificOutput.permissionDecisionReason || '';
  assert.strictEqual(parsed.hookSpecificOutput.permissionDecision, 'deny', '应为 deny');
  assert.match(reason, /\/paceflow disable/, 'deny 文案应含逃生口 /paceflow disable');
});
```

> stdin 字段名同 A3b：执行前按现有 e2e 惯例对齐（`tool_name`/`tool_input` vs `toolName`/`filePath`）。

#### ② 跑测试看失败

```bash
node tests/test-hooks-e2e.js
```
预期：D1 FAIL（当前 deny reason 无 `/paceflow disable`）。

#### ③ 最小实现

编辑 `plugin/hooks/pre-tool-use.js`。在 `denyOrHint` 函数内（约 197 行 `const enrichedReason = paceUtils.appendArtifactDirHint(cwd, reason);` 之后），把逃生口拼到 `enrichedReason`：

原：
```js
  function denyOrHint(reason, { hardInTeammate = false } = {}) {
    const enrichedReason = paceUtils.appendArtifactDirHint(cwd, reason);
```
改为：
```js
  // CHG-D D1：所有 PACE deny 文案统一追加逃生口（指向 /paceflow disable）。
  const PACE_ESCAPE_HATCH = '若你（用户）不需要 PACEflow 管理本项目，可运行 /paceflow disable 停用。';
  function withEscapeHatch(reason) {
    const r = String(reason || '');
    return r.includes('/paceflow disable') ? r : `${r}\n${PACE_ESCAPE_HATCH}`;
  }
  function denyOrHint(reason, { hardInTeammate = false } = {}) {
    const enrichedReason = withEscapeHatch(paceUtils.appendArtifactDirHint(cwd, reason));
```

在 `hardDeny` 函数内（约 209-214 行）给 `reason` 同样包裹：
原：
```js
  function hardDeny(reason, action, fields = {}) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason
      }
    };
```
改为：
```js
  function hardDeny(reason, action, fields = {}) {
    const output = {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: withEscapeHatch(reason)
      }
    };
```

> 逃生口只加在 `permissionDecision: "deny"` 路径。`denyOrHint` 在 teammate 软化分支返回的是 `additionalContext`（提醒非 deny）——那条也经 `enrichedReason`，会带上逃生口，可接受（teammate 看到逃生口无害）。若要严格只在 deny 出现，可把 teammate 软化分支改回用未包裹的 `paceUtils.appendArtifactDirHint(cwd, reason)`；本计划默认统一带（更简单，且 spec §7「所有 PACE deny 末尾加」以 deny 为主，提醒带上不违背意图）。`withEscapeHatch` 的幂等守卫（已含则不重复加）防止 reason 本身已提逃生口时叠加。

#### ④ 跑测试看通过

```bash
node tests/test-hooks-e2e.js
node tests/test-pace-utils.js
claude plugin validate ./plugin
git diff --check
```
预期：D1 PASS。全量两个测试套件 + plugin validate 全绿。

#### ⑤ commit

```bash
git add plugin/hooks/pre-tool-use.js tests/test-hooks-e2e.js
git commit -m "feat(activation): D1 PACE deny 文案统一追加 /paceflow disable 逃生口（CHG-D）"
```

---

## 收尾验证（全 CHG 完成后）

```bash
node tests/test-pace-utils.js          # A1/A2/A4 单测全绿
node tests/test-hooks-e2e.js           # A3/B1/B2/C1/D1 e2e 全绿
node tests/test-agent-tests-helpers.js # 既有 agent helper 测试不回归
claude plugin validate ./plugin        # manifest（含 commands）通过
git diff --check                       # 无行尾/冲突标记问题
```

按 G-9/G-10：先读完验证结果，再做 R 对抗审计（重点核 detectSoftSignal 的 fail-safe、code-count-lookahead 移除后无 under-block 回归——即强信号 artifact 项目仍正常 deny、软信号项目确实不再被任何路径拦截），findings 按 severity 路由。dogfood 注意：plugin command 与 set-activation helper 经 cache 版生效需 push 后 reload，无法同 session live 验证 slash 触发——列入 push 后跟进项，e2e 已覆盖 helper 子进程行为与 manifest 结构。
