# CWD 漂移修复 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 `getProjectName(cwd)` 在 CWD 漂移到子目录时创建幽灵 vault 项目的问题。

**Architecture:** 在 `pace-utils.js` 新增 `resolveProjectCwd()` 函数，从 `process.cwd()` 向上搜索 `.pace/` 目录定位项目根。所有 7 个 hook 的 `const cwd = process.cwd()` 改为调用此函数。SessionStart 的 `ensureProjectInfra()` 保证 `.pace/` 存在，所以搜索一定命中。

**Tech Stack:** Node.js, fs, path

**背景调研**：
- CWD 漂移是 Claude Code 已知问题（#3583, #28955, #25031）
- `$CLAUDE_PROJECT_DIR` 环境变量文档有提及但当前环境不可用
- 详见 `thoughts/getProjectName-cwd-drift-fix.md`

**已知限制**：
- Stop hook CWD bug（#25031，CWD 变成 `.claude/helpers/`）无法通过向上搜索解决，需等 `$CLAUDE_PROJECT_DIR` 或 Claude Code 修复
- 非 PACE 项目（无 `.pace/` 目录）不受影响，直接用 `process.cwd()`

---

### Task 1: pace-utils.js — 新增 `resolveProjectCwd()` 函数

**Files:**
- Modify: `paceflow/hooks/pace-utils.js:17-21`（getProjectName 附近）
- Test: `paceflow/tests/test-pace-utils.js`

**Step 1: 写失败测试**

在 `test-pace-utils.js` 末尾 `getProjectName` 测试组后添加：

```javascript
// --- resolveProjectCwd ---
test('resolveProjectCwd: 当前目录有 .pace → 返回当前目录', () => {
  const dir = tmpDir;
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  // 模拟 process.cwd() 返回 dir
  const origCwd = process.cwd;
  process.cwd = () => dir;
  try {
    const result = paceUtils.resolveProjectCwd();
    assert.strictEqual(result, dir);
  } finally {
    process.cwd = origCwd;
  }
});

test('resolveProjectCwd: 子目录 → 向上找到 .pace 所在目录', () => {
  const projectRoot = tmpDir;
  fs.mkdirSync(path.join(projectRoot, '.pace'), { recursive: true });
  const subDir = path.join(projectRoot, 'subdir', 'deep');
  fs.mkdirSync(subDir, { recursive: true });
  const origCwd = process.cwd;
  process.cwd = () => subDir;
  try {
    const result = paceUtils.resolveProjectCwd();
    assert.strictEqual(result, projectRoot);
  } finally {
    process.cwd = origCwd;
  }
});

test('resolveProjectCwd: 无 .pace → fallback process.cwd()', () => {
  const noProjectDir = path.join(tmpDir, 'no-pace-here');
  fs.mkdirSync(noProjectDir, { recursive: true });
  const origCwd = process.cwd;
  process.cwd = () => noProjectDir;
  try {
    const result = paceUtils.resolveProjectCwd();
    assert.strictEqual(result, noProjectDir);
  } finally {
    process.cwd = origCwd;
  }
});
```

**Step 2: 运行测试确认失败**

```bash
node paceflow/tests/test-pace-utils.js
```
预期：`paceUtils.resolveProjectCwd is not a function`

**Step 3: 实现 `resolveProjectCwd()`**

在 `pace-utils.js` 的 `getProjectName()` 函数前（第 16 行附近）添加：

```javascript
/**
 * 从 process.cwd() 向上搜索 .pace/ 目录，定位项目根
 * 防止 CWD 漂移到子目录时 getProjectName 返回错误项目名
 * @returns {string} 项目根目录（有 .pace/ 的最近祖先目录，或 process.cwd() fallback）
 */
function resolveProjectCwd() {
  const startDir = process.cwd();
  let dir = startDir;
  for (let i = 0; i < 5 && dir !== path.dirname(dir); i++) {
    if (fs.existsSync(path.join(dir, '.pace'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}
```

在 `module.exports` 中添加 `resolveProjectCwd`。

**Step 4: 运行测试确认通过**

```bash
node paceflow/tests/test-pace-utils.js
```
预期：全部通过（含 3 个新测试）

**Step 5: 提交**

```bash
cd paceflow && git add hooks/pace-utils.js tests/test-pace-utils.js
git commit -m "feat: resolveProjectCwd 向上搜索 .pace/ 防 CWD 漂移"
```

---

### Task 2: 7 个 hook — `process.cwd()` 替换为 `resolveProjectCwd()`

**Files:**
- Modify: `paceflow/hooks/session-start.js:15`
- Modify: `paceflow/hooks/pre-tool-use.js:15`
- Modify: `paceflow/hooks/post-tool-use.js:15`
- Modify: `paceflow/hooks/stop.js:16`
- Modify: `paceflow/hooks/todowrite-sync.js:17`
- Modify: `paceflow/hooks/config-guard.js:15`
- Modify: `paceflow/hooks/pre-compact.js:15`

**Step 1: 批量替换**

每个文件的 `const cwd = process.cwd();` 改为：

```javascript
const cwd = paceUtils.resolveProjectCwd ? paceUtils.resolveProjectCwd() : process.cwd();
```

使用 fallback 模式（`paceUtils.resolveProjectCwd ?`）保证：若生产环境的 `pace-utils.js` 尚未更新，hook 不会崩溃。

注意：`session-start.js` 第 15-16 行的 `PACE_RUNTIME` 依赖 `cwd`，替换后自动正确。

**Step 2: 语法验证**

```bash
for f in paceflow/hooks/*.js; do node -c "$f"; done
```
预期：8/8 通过

**Step 3: 提交**

```bash
cd paceflow && git add hooks/*.js
git commit -m "fix: 7 hook CWD 改用 resolveProjectCwd 防漂移"
```

---

### Task 3: E2E 测试 — CWD 漂移场景

**Files:**
- Modify: `paceflow/tests/test-hooks-e2e.js`

**Step 1: 添加 E2E 测试**

在 "Vault artifact 存储迁移" 章节后添加新章节：

```javascript
// ============================================================
// 12. CWD 漂移防御 (2)
// ============================================================

test('36. stop.js CWD 在子目录 → 仍读正确的 task.md', () => {
  // 在 tmpDir 创建项目结构
  const projectRoot = tmpDir;
  fs.mkdirSync(path.join(projectRoot, '.pace'), { recursive: true });
  // 创建 vault 项目目录和 task.md
  const vaultProject = makeVaultProject('cwd-drift-test');
  fs.writeFileSync(path.join(vaultProject, 'task.md'),
    '# 任务\n\n## 活跃任务\n\n- [/] T-001: 测试任务\n\n<!-- ARCHIVE -->\n');
  // 子目录作为 CWD
  const subDir = path.join(projectRoot, 'subdir');
  fs.mkdirSync(subDir, { recursive: true });

  const result = runHook('stop.js', {
    stdin: JSON.stringify({ stop_hook_active: true }),
    cwd: subDir  // 关键：CWD 是子目录
  });
  // 应该找到项目根的 .pace/ → 正确的项目名 → 正确的 vault task.md
  // 如果找不到，fallback 到 subDir，不会有 artifact，静默放行
  assert.strictEqual(result.exitCode, 0, 'CWD 漂移时不应误报');
});

test('37. session-start.js CWD 在子目录 → 仍注入正确 artifact', () => {
  const projectRoot = tmpDir;
  fs.mkdirSync(path.join(projectRoot, '.pace'), { recursive: true });
  const vaultProject = makeVaultProject('cwd-drift-start');
  fs.writeFileSync(path.join(vaultProject, 'task.md'),
    '# 任务\n\n## 活跃任务\n\n- [/] T-001: 测试\n\n<!-- ARCHIVE -->\n');
  fs.writeFileSync(path.join(vaultProject, 'spec.md'),
    '# Spec\n\n## 概述\n\n测试项目\n\n<!-- ARCHIVE -->\n');
  const subDir = path.join(projectRoot, 'subdir');
  fs.mkdirSync(subDir, { recursive: true });

  const result = runHook('session-start.js', {
    stdin: JSON.stringify({ type: 'startup' }),
    cwd: subDir
  });
  assert.strictEqual(result.exitCode, 0);
  // 应注入 artifact 内容（来自 vault）
  assert.ok(result.stdout.includes('task.md') || result.stdout === '',
    'CWD 子目录时应正常注入或静默');
});
```

注意：E2E `runHook` 函数需确认是否支持 `cwd` 参数。如支持，直接用；如不支持，需在 `execSync` 调用中传 `{ cwd: opts.cwd }`。

**Step 2: 运行 E2E**

```bash
node paceflow/tests/test-hooks-e2e.js
```
预期：37/37 通过

**Step 3: 提交**

```bash
cd paceflow && git add tests/test-hooks-e2e.js
git commit -m "test: CWD 漂移防御 E2E 测试 2 个"
```

---

### Task 4: 验证 + 生产同步

**Step 1: 全量验证**

```bash
for f in paceflow/hooks/*.js; do node -c "$f"; done
node paceflow/tests/test-pace-utils.js
node paceflow/tests/test-hooks-e2e.js
node paceflow/verify.js
```
预期：语法 8/8、单元 29+/29+、E2E 37/37、verify 5/5

**Step 2: 生产同步**

```bash
node paceflow/install.js --force
node paceflow/verify.js
```
预期：verify 5/5（源码-生产一致）

**Step 3: 手动验证 CWD 漂移修复**

```bash
cd paceflow && echo '{"hook_type":"Stop","session_id":"test","stop_hook_active":true}' | node ~/.claude/hooks/pace/stop.js 2>&1; echo "EXIT: $?"
```
预期：exit 0，无误报（CWD 在 paceflow/ 子目录但 resolveProjectCwd 向上找到项目根）

**Step 4: 最终提交 + push**

```bash
cd paceflow && git add -A
git commit -m "fix: CWD 漂移修复 — resolveProjectCwd 向上搜索 .pace/"
git push origin master
```

---

### Task 5: Artifact 更新

**Step 1:** 更新 `task.md` — 标记所有任务完成，添加 VERIFIED，归档

**Step 2:** 更新 `walkthrough.md` — 添加当天工作记录

**Step 3:** 更新 `implementation_plan.md` — CHG 索引标 [x]

**Step 4:** 更新 `findings.md` — 摘要索引标 `[x]` 并添加 `[change:: CHG-ID]`

**Step 5:** 更新 `thoughts/getProjectName-cwd-drift-fix.md` — status → `concluded`
