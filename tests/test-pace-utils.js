// pace-utils.js 纯函数单元测试
// 零依赖：仅使用 Node.js 内置 assert + fs + os.tmpdir()
// 覆盖：isPaceProject / countByStatus / readActive / checkArchiveFormat

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const paceUtils = require('../plugin/hooks/pace-utils');
const createPlanUtils = require('../plugin/hooks/pace-utils/plans');
const { isPaceProject, daysSinceISODate, countByStatus, readActive, checkArchiveFormat, ARTIFACT_FILES, MIGRATABLE_ARTIFACT_FILES, RESERVE_ARTIFACT_ID_SCRIPT, SYNC_PLAN_SCRIPT, SET_ARTIFACT_ROOT_SCRIPT, SET_PROJECT_ROOT_SCRIPT, getArtifactDir, _clearArtifactDirCache, getProjectName, getProjectNameCandidates, resolveEffectiveProjectRoot, resolveToolFilePath, isArtifactRelativePath, artifactRelativePathForFile, executionContextForCwd, getProjectStateDir, getProjectRuntimeDir, getArtifactRootChoicePath, readArtifactRootChoice, getConfiguredArtifactDir, artifactRootConfigError, artifactRootChoiceNeeded, artifactRootChoiceMessage, getV5MigrationInfo, v5MigrationPromptMessage, parseHookStdin, logEntry, normalizeChangeId, detailPathForId, slugForChangeId, acquireArtifactWriterLock, readArtifactWriterLock, artifactWriterLockMatches, releaseArtifactWriterLock, getArtifactWriterLockPath, artifactResourceForRel, getArtifactResourceLockPath, acquireArtifactResourceLock, readArtifactResourceLock, releaseArtifactResourceLock, markIndexChangesTouchedAndMaybeRelease, reserveArtifactId, readArtifactReservation, findArtifactReservationForRel, clearArtifactReservationForRel, isArtifactRuntimeControlPath, createTemplates, writeChangeOwner, readChangeOwner, touchChangeOwnersForSession, changeOwnerStatus, hasBridgeCandidatePlanFiles, listBridgeCandidatePlanFiles, parseFrontmatter } = paceUtils;

// I-23: 公共测试工具（消除重复的 test/makeTmpDir/cleanup 定义）
const { createTestRunner } = require('./test-utils');
const t = createTestRunner('pace-test');
const { test, makeTmpDir } = t;

// ============================================================
// 1. isPaceProject()
// ============================================================
console.log('\n--- isPaceProject ---');

test('空目录 → false', () => {
  const dir = makeTmpDir('empty');
  assert.strictEqual(isPaceProject(dir), false);
});

test('有 changes/ → artifact', () => {
  const dir = makeTmpDir('artifact');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  assert.strictEqual(isPaceProject(dir), 'artifact');
});

test('旧 v5 artifact 根文件但无 changes/ → legacy', () => {
  const dir = makeTmpDir('legacy-v5-signal');
  fs.writeFileSync(path.join(dir, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] Legacy task\n\n<!-- ARCHIVE -->\n');
  assert.strictEqual(isPaceProject(dir), 'legacy');
});

test('普通 task.md 无 PACE 签名 → 不误判 legacy', () => {
  const dir = makeTmpDir('plain-task-md');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task list\n\n- buy milk\n');
  assert.strictEqual(isPaceProject(dir), false);
});

test('英文最小 v5 task+implementation checkbox → legacy', () => {
  const dir = makeTmpDir('legacy-v5-minimal');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [ ] Legacy v5 active item\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), '# Implementation Plan\n\n- [ ] Legacy v5 implementation item\n', 'utf8');
  assert.strictEqual(isPaceProject(dir), 'legacy');
  const info = getV5MigrationInfo(dir);
  assert.strictEqual(info.detected, true);
  assert.strictEqual(info.needsPrompt, true);
  assert.deepStrictEqual(info.files, ['task.md', 'implementation_plan.md']);
});

test('createTemplates 在可能 legacy v5 目录中 fail-closed 且不创建 changes', () => {
  const dir = makeTmpDir('legacy-v5-template-deny');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [ ] Legacy v5 active item\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), '# Implementation Plan\n\n- [ ] Legacy v5 implementation item\n', 'utf8');
  assert.throws(() => createTemplates(dir), /旧 v5 PACE artifact|legacy v5/i);
  assert.strictEqual(fs.existsSync(path.join(dir, 'changes')), false);
});

test('有 .pace/disabled + task.md → false（豁免优先）', () => {
  const dir = makeTmpDir('disabled');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Tasks\n');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'disabled'), '');
  assert.strictEqual(isPaceProject(dir), false);
});

test('有 .pace-enabled → manual', () => {
  const dir = makeTmpDir('manual');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  assert.strictEqual(isPaceProject(dir), 'manual');
});

test('只有 artifact-root 选择且尚无 changes → manual', () => {
  const dir = makeTmpDir('artifact-root-choice-signal');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  assert.strictEqual(isPaceProject(dir), 'manual');
});

test('只有运行态 .pace/ 目录 → false（不等于启用信号）', () => {
  const dir = makeTmpDir('runtime-pace-dir');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', '.gitignore'), '*\n');
  assert.strictEqual(isPaceProject(dir), false);
});

test('有 docs/plans/2026-01-01-test.md → superpowers', () => {
  const dir = makeTmpDir('superpowers');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-01-01-test.md'), '# Plan\n');
  assert.strictEqual(isPaceProject(dir), 'superpowers');
});

test('3+ 代码文件（.js） → code-count', () => {
  const dir = makeTmpDir('code-count');
  fs.writeFileSync(path.join(dir, 'a.js'), '');
  fs.writeFileSync(path.join(dir, 'b.js'), '');
  fs.writeFileSync(path.join(dir, 'c.js'), '');
  assert.strictEqual(isPaceProject(dir), 'code-count');
});

test('优先级：artifact 存在时忽略 code-count', () => {
  const dir = makeTmpDir('priority');
  // 同时有 changes/（v6 artifact 信号）和 3 个 .js 文件（code-count 信号）
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.js'), '');
  fs.writeFileSync(path.join(dir, 'b.js'), '');
  fs.writeFileSync(path.join(dir, 'c.js'), '');
  assert.strictEqual(isPaceProject(dir), 'artifact');
});

console.log('\n--- date helpers ---');

test('daysSinceISODate 使用日历日差，避免 UTC 解析偏差', () => {
  assert.strictEqual(daysSinceISODate('2026-04-25', '2026-05-09'), 14);
  assert.strictEqual(daysSinceISODate('"2026-04-25"', '2026-05-09'), 14);
  assert.strictEqual(daysSinceISODate('2026-04-25T23:30:00+08:00', '2026-05-09'), 14);
  assert.strictEqual(daysSinceISODate('not-a-date', '2026-05-09'), null);
});

// ============================================================
// 2. countByStatus() — 3 个测试
// ============================================================
console.log('\n--- countByStatus ---');

test('空文本 → {pending:0, done:0, total:0}', () => {
  assert.deepStrictEqual(countByStatus(''), { pending: 0, done: 0, total: 0 });
});

test('混合状态 → {pending:2, done:2, total:4}', () => {
  const text = '- [ ] a\n- [x] b\n- [-] c\n- [/] d';
  assert.deepStrictEqual(countByStatus(text), { pending: 2, done: 2, total: 4 });
});

test('topLevelOnly=true 时子任务不计入', () => {
  const text = '- [ ] a\n  - [ ] sub';
  const result = countByStatus(text, { topLevelOnly: true });
  assert.strictEqual(result.pending, 1);
  assert.strictEqual(result.total, 1);
});

// ============================================================
// 3. readActive() — 3 个测试
// ============================================================
console.log('\n--- readActive ---');

test('无 ARCHIVE 标记 → 返回全文', () => {
  const dir = makeTmpDir('ra-noarchive');
  fs.writeFileSync(path.join(dir, 'test.md'), 'line1\nline2\n');
  assert.strictEqual(readActive(dir, 'test.md'), 'line1\nline2\n');
});

test('有 <!-- ARCHIVE --> → 返回标记前内容', () => {
  const dir = makeTmpDir('ra-archive');
  const content = 'active part\n<!-- ARCHIVE -->\nold stuff\n';
  fs.writeFileSync(path.join(dir, 'test.md'), content);
  assert.strictEqual(readActive(dir, 'test.md'), 'active part\n');
});

test('文件不存在 → null', () => {
  const dir = makeTmpDir('ra-missing');
  assert.strictEqual(readActive(dir, 'nonexistent.md'), null);
});

// ============================================================
// 4. checkArchiveFormat() — 3 个测试
// ============================================================
console.log('\n--- checkArchiveFormat ---');

test('正确格式 <!-- ARCHIVE --> → null', () => {
  const dir = makeTmpDir('caf-correct');
  fs.writeFileSync(path.join(dir, 'test.md'), 'content\n<!-- ARCHIVE -->\nold\n');
  assert.strictEqual(checkArchiveFormat(dir, 'test.md'), null);
});

test('错误格式 ## ARCHIVE → 返回错误消息', () => {
  const dir = makeTmpDir('caf-wrong');
  fs.writeFileSync(path.join(dir, 'test.md'), 'content\n## ARCHIVE\nold\n');
  const result = checkArchiveFormat(dir, 'test.md');
  assert.ok(result !== null, '应返回错误消息');
  assert.ok(result.includes('错误的 ARCHIVE 标记格式'), `消息内容不符: ${result}`);
});

test('文件不存在 → null', () => {
  const dir = makeTmpDir('caf-missing');
  assert.strictEqual(checkArchiveFormat(dir, 'nonexistent.md'), null);
});

// ============================================================
// 5. getProjectName()
// ============================================================
console.log('\n--- getProjectName ---');

test('正常目录名 → 小写连字符', () => {
  assert.strictEqual(getProjectName('/foo/My Project'), 'my-project');
});

test('已小写无空格 → 原样返回', () => {
  assert.strictEqual(getProjectName('/foo/paceflow-hooks'), 'paceflow-hooks');
});

test('普通 worktrees/<name> 路径无 git 信号 → 不误判宿主项目', () => {
  assert.strictEqual(getProjectName('/foo/paceflow-hooks/worktrees/smoke-test'), 'smoke-test');
});

test('.claude/worktrees/<name> 路径 → .claude 父级项目名', () => {
  assert.strictEqual(getProjectName('/foo/paceflow/.claude/worktrees/smoke-test'), 'paceflow');
});

test('真实 git worktree .git 文件 → 宿主项目名', () => {
  const root = makeTmpDir('gpn-git-worktree');
  const host = path.join(root, 'paceflow-hooks');
  const worktree = path.join(host, 'worktrees', 'smoke-test');
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'smoke-test')}\n`, 'utf8');
  assert.strictEqual(getProjectName(worktree), 'paceflow-hooks');
});

// ============================================================
// 5b. artifact path helpers
// ============================================================
console.log('\n--- artifact path helpers ---');

test('resolveToolFilePath: 相对路径基于 cwd 解析', () => {
  const dir = makeTmpDir('rtfp-relative');
  assert.strictEqual(resolveToolFilePath(dir, 'changes/chg-20260506-01.md'), path.join(dir, 'changes', 'chg-20260506-01.md').replace(/\\/g, '/'));
});

test('resolveToolFilePath: 绝对路径保持原样', () => {
  assert.strictEqual(resolveToolFilePath('/tmp/project', '/tmp/project/task.md'), '/tmp/project/task.md');
});

test('isArtifactRelativePath: 根索引和 changes 详情为 artifact', () => {
  assert.strictEqual(isArtifactRelativePath('task.md'), true);
  assert.strictEqual(isArtifactRelativePath('changes/chg-20260506-01.md'), true);
  assert.strictEqual(isArtifactRelativePath('changes/findings/finding-2026-05-06-test.md'), true);
  assert.strictEqual(isArtifactRelativePath('src/task.md'), false);
});

test('artifactRelativePathForFile: 返回 cwd 内 artifact 相对路径', () => {
  const dir = makeTmpDir('arff-artifact');
  assert.strictEqual(artifactRelativePathForFile(dir, path.join(dir, 'changes', 'corrections', 'correction-2026-05-06-01-test.md')), 'changes/corrections/correction-2026-05-06-01-test.md');
});

test('artifactRelativePathForFile: 普通代码文件返回 null', () => {
  const dir = makeTmpDir('arff-code');
  assert.strictEqual(artifactRelativePathForFile(dir, path.join(dir, 'src', 'task.md')), null);
  assert.strictEqual(artifactRelativePathForFile(dir, path.join(dir, 'src.js')), null);
});

test('change-id helpers: CHG/HOTFIX 归一与非法值拒绝', () => {
  const dir = makeTmpDir('change-id-helpers');
  assert.strictEqual(normalizeChangeId(' chg-20260514-01 '), 'CHG-20260514-01');
  assert.strictEqual(normalizeChangeId('hotfix-20260514-02'), 'HOTFIX-20260514-02');
  assert.strictEqual(normalizeChangeId('chg-20260514-1'), '');
  assert.strictEqual(slugForChangeId('CHG-20260514-01'), 'chg-20260514-01');
  assert.strictEqual(slugForChangeId('HOTFIX-20260514-02'), 'hotfix-20260514-02');
  assert.strictEqual(slugForChangeId('chg-not-a-date'), '');
  assert.strictEqual(detailPathForId(dir, 'CHG-20260514-01'), path.join(dir, 'changes', 'chg-20260514-01.md'));
  assert.strictEqual(detailPathForId(dir, 'HOTFIX-20260514-02'), path.join(dir, 'changes', 'hotfix-20260514-02.md'));
  assert.strictEqual(detailPathForId(dir, 'CHG-20260514-1'), null);
});

// ============================================================
// 5c. session id + artifact writer lock
// ============================================================
console.log('\n--- session id + artifact writer lock ---');

test('parseHookStdin 解析 session_id 且 logEntry 自动带 sid', () => {
  const parsed = parseHookStdin(JSON.stringify({ session_id: 'session-test-1', tool_name: 'Bash' }));
  assert.strictEqual(parsed.sessionId, 'session-test-1');
  assert.ok(logEntry('UnitHook', 'TEST', { proj: 'demo' }).includes('sid=session-test-1'));
});

test('artifact-writer lock 原子获取、拒绝第二会话、同会话释放', () => {
  const dir = makeTmpDir('awl-basic');
  const first = acquireArtifactWriterLock(dir, {
    sessionId: 'sid-1',
    agentId: 'agent-1',
    artifactDir: dir,
    operation: 'create-chg',
  });
  assert.strictEqual(first.acquired, true);
  assert.ok(fs.existsSync(getArtifactWriterLockPath(dir)));
  assert.strictEqual(readArtifactWriterLock(dir).sessionId, 'sid-1');
  assert.ok(!('pid' in readArtifactWriterLock(dir).raw), 'lock payload 不应暴露短生命周期 hook pid');

  const second = acquireArtifactWriterLock(dir, {
    sessionId: 'sid-2',
    agentId: 'agent-2',
    artifactDir: dir,
    operation: 'create-chg',
  });
  assert.strictEqual(second.acquired, false);
  assert.strictEqual(second.lock.sessionId, 'sid-1');
  assert.strictEqual(artifactWriterLockMatches(dir, 'sid-1').ok, true);
  assert.strictEqual(artifactWriterLockMatches(dir, 'sid-2').ok, false);

  const wrongRelease = releaseArtifactWriterLock(dir, { sessionId: 'sid-2' });
  assert.strictEqual(wrongRelease.released, false);
  assert.ok(fs.existsSync(getArtifactWriterLockPath(dir)));

  const release = releaseArtifactWriterLock(dir, { sessionId: 'sid-1' });
  assert.strictEqual(release.released, true);
  assert.ok(!fs.existsSync(getArtifactWriterLockPath(dir)));
});

test('artifact-writer lock 遇到损坏锁文件会自愈重建', () => {
  const dir = makeTmpDir('awl-corrupt');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(getArtifactWriterLockPath(dir), '{not json', 'utf8');
  const acquired = acquireArtifactWriterLock(dir, {
    sessionId: 'sid-corrupt',
    artifactDir: dir,
    operation: 'create-chg',
  });
  assert.strictEqual(acquired.acquired, true);
  assert.strictEqual(readArtifactWriterLock(dir).sessionId, 'sid-corrupt');
});

test('artifact-writer stale lock 被其他进程删除时继续重试获取', () => {
  const dir = makeTmpDir('awl-stale-enoent');
  const lockPath = getArtifactWriterLockPath(dir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    sessionId: 'sid-stale',
    artifactDir: dir,
    timestampMs: 1,
  }), 'utf8');

  const originalUnlinkSync = fs.unlinkSync;
  let injected = false;
  fs.unlinkSync = (target) => {
    if (!injected && target === lockPath) {
      injected = true;
      originalUnlinkSync(target);
      const err = new Error('ENOENT: simulated concurrent stale lock cleanup');
      err.code = 'ENOENT';
      throw err;
    }
    return originalUnlinkSync(target);
  };
  try {
    const acquired = acquireArtifactWriterLock(dir, {
      sessionId: 'sid-retry',
      artifactDir: dir,
      operation: 'create-chg',
    });
    assert.strictEqual(acquired.acquired, true);
    assert.strictEqual(readArtifactWriterLock(dir).sessionId, 'sid-retry');
  } finally {
    fs.unlinkSync = originalUnlinkSync;
  }
});

test('artifact resource lock 按文件资源互斥，不同资源可并发', () => {
  const dir = makeTmpDir('arl-basic');
  const detailA = 'detail:changes/chg-20260510-01.md';
  const detailB = 'detail:changes/chg-20260510-02.md';
  const first = acquireArtifactResourceLock(dir, detailA, { sessionId: 'sid-a', agentId: 'agent-a', file: 'changes/chg-20260510-01.md' });
  assert.strictEqual(first.acquired, true);
  assert.strictEqual(readArtifactResourceLock(dir, detailA).sessionId, 'sid-a');

  const sameResource = acquireArtifactResourceLock(dir, detailA, { sessionId: 'sid-b', agentId: 'agent-b', file: 'changes/chg-20260510-01.md' });
  assert.strictEqual(sameResource.acquired, false);
  assert.strictEqual(sameResource.lock.sessionId, 'sid-a');

  const otherResource = acquireArtifactResourceLock(dir, detailB, { sessionId: 'sid-b', agentId: 'agent-b', file: 'changes/chg-20260510-02.md' });
  assert.strictEqual(otherResource.acquired, true);
  assert.strictEqual(releaseArtifactResourceLock(dir, detailA, { sessionId: 'sid-a', agentId: 'agent-a' }).released, true);
  assert.strictEqual(releaseArtifactResourceLock(dir, detailB, { sessionId: 'sid-b', agentId: 'agent-b' }).released, true);
});

test('artifact resource stale lock 被其他进程删除时继续重试获取', () => {
  const dir = makeTmpDir('arl-stale-enoent');
  const resource = 'detail:changes/chg-20260510-01.md';
  const lockPath = getArtifactResourceLockPath(dir, resource);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    version: 'resource-v1',
    resource,
    sessionId: 'sid-stale',
    ownerKey: 'session:sid-stale',
    timestampMs: 1,
  }), 'utf8');

  const originalUnlinkSync = fs.unlinkSync;
  let injected = false;
  fs.unlinkSync = (target) => {
    if (!injected && target === lockPath) {
      injected = true;
      originalUnlinkSync(target);
      const err = new Error('ENOENT: simulated concurrent stale resource cleanup');
      err.code = 'ENOENT';
      throw err;
    }
    return originalUnlinkSync(target);
  };
  try {
    const acquired = acquireArtifactResourceLock(dir, resource, {
      sessionId: 'sid-resource-retry',
      file: 'changes/chg-20260510-01.md',
    });
    assert.strictEqual(acquired.acquired, true);
    assert.strictEqual(readArtifactResourceLock(dir, resource).sessionId, 'sid-resource-retry');
  } finally {
    fs.unlinkSync = originalUnlinkSync;
  }
});

test('artifact resource read path 自动清理 stale lock', () => {
  const dir = makeTmpDir('arl-read-stale-self-heal');
  const resource = 'detail:changes/chg-20260510-01.md';
  const lockPath = getArtifactResourceLockPath(dir, resource);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    version: 'resource-v1',
    resource,
    sessionId: 'sid-stale-read',
    ownerKey: 'session:sid-stale-read',
    timestampMs: 1,
  }), 'utf8');

  const lock = readArtifactResourceLock(dir, resource);
  assert.strictEqual(lock.ok, false);
  assert.strictEqual(lock.stale, true);
  assert.strictEqual(fs.existsSync(lockPath), false);
});

test('artifact resource read path 对缺失锁保持普通 ok:false', () => {
  const dir = makeTmpDir('arl-read-missing');
  const resource = 'detail:changes/chg-20260510-01.md';
  const lock = readArtifactResourceLock(dir, resource);
  assert.strictEqual(lock.ok, false);
  assert.strictEqual(lock.code, 'ENOENT');
  assert.strictEqual(lock.stale, undefined);
});

test('index:changes 在 task.md 与 implementation_plan.md 都触碰后释放', () => {
  const dir = makeTmpDir('arl-index');
  const resource = artifactResourceForRel('task.md');
  assert.strictEqual(resource, 'index:changes');
  const lock = acquireArtifactResourceLock(dir, resource, { sessionId: 'sid-index', agentId: 'agent-index', file: 'task.md' });
  assert.strictEqual(lock.acquired, true);
  const first = markIndexChangesTouchedAndMaybeRelease(dir, 'task.md', { sessionId: 'sid-index', agentId: 'agent-index' });
  assert.strictEqual(first.released, false);
  assert.strictEqual(readArtifactResourceLock(dir, resource).ok, true);
  const second = markIndexChangesTouchedAndMaybeRelease(dir, 'implementation_plan.md', { sessionId: 'sid-index', agentId: 'agent-index' });
  assert.strictEqual(second.released, true);
  assert.strictEqual(readArtifactResourceLock(dir, resource).ok, false);
});

test('reserveArtifactId 为 create-chg 原子分配 CHG 编号并写 reservation', () => {
  const dir = makeTmpDir('reservation-chg');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  const first = reserveArtifactId(dir, {
    sessionId: 'sid-reserve',
    artifactDir: dir,
    operation: 'create-chg',
    prompt: 'operation: create-chg',
  });
  assert.strictEqual(first.reserved, true);
  assert.ok(/^CHG-\d{8}-01$/.test(first.id));
  assert.strictEqual(readArtifactReservation(dir, { sessionId: 'sid-reserve' }).fileRel, first.fileRel);
  const second = reserveArtifactId(dir, {
    sessionId: 'sid-reserve-2',
    artifactDir: dir,
    operation: 'create-chg',
    prompt: 'operation: create-chg',
  });
  assert.strictEqual(second.reserved, true);
  assert.ok(second.id.endsWith('-02'));
});

test('同一 session 多个 reservation 可按目标文件精确匹配', () => {
  const dir = makeTmpDir('reservation-same-session');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  const first = reserveArtifactId(dir, {
    sessionId: 'sid-same',
    artifactDir: dir,
    operation: 'create-chg',
    prompt: 'operation: create-chg',
  });
  const second = reserveArtifactId(dir, {
    sessionId: 'sid-same',
    artifactDir: dir,
    operation: 'create-chg',
    prompt: 'operation: create-chg',
  });
  assert.strictEqual(first.reserved, true);
  assert.strictEqual(second.reserved, true);
  assert.notStrictEqual(first.fileRel, second.fileRel);
  assert.strictEqual(findArtifactReservationForRel(dir, { sessionId: 'sid-same', agentId: 'agent-late' }, first.fileRel).fileRel, first.fileRel);
  assert.strictEqual(findArtifactReservationForRel(dir, { sessionId: 'sid-same', agentId: 'agent-late' }, second.fileRel).fileRel, second.fileRel);
  assert.strictEqual(clearArtifactReservationForRel(dir, { sessionId: 'sid-same', agentId: 'agent-late' }, first.fileRel), true);
  assert.strictEqual(findArtifactReservationForRel(dir, { sessionId: 'sid-same', agentId: 'agent-late' }, first.fileRel), null);
  assert.strictEqual(findArtifactReservationForRel(dir, { sessionId: 'sid-same', agentId: 'agent-late' }, second.fileRel).fileRel, second.fileRel);
});

test('isArtifactRuntimeControlPath 识别锁/sequence/reservation 控制面', () => {
  const dir = makeTmpDir('runtime-control');
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'locks', 'artifacts', 'x.lock')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'sequences', 'chg.counter')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'reservations', 'session.json')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'index-transactions', 'session.json')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'artifact-root')), false);
});

// ============================================================
// 6. getArtifactDir()
// ============================================================
console.log('\n--- getArtifactDir ---');

test('CWD 有 artifact → 返回 CWD', () => {
  const dir = makeTmpDir('gad-cwd');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  // getArtifactDir 先检查 vault，vault 无 changes/ → 检查 CWD → 有 → 返回 CWD
  assert.strictEqual(getArtifactDir(dir), dir);
});

test('vault 有 artifact → 返回 vault', () => {
  const dir = makeTmpDir('gad-vault');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n');
  t.tmpDirs.push(vaultDir); // 清理
  assert.strictEqual(getArtifactDir(dir), vaultDir);
});

test('vault 和 CWD 都有 → vault 优先', () => {
  const dir = makeTmpDir('gad-both');
  fs.writeFileSync(path.join(dir, 'task.md'), '# cwd\n');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n');
  t.tmpDirs.push(vaultDir);
  assert.strictEqual(getArtifactDir(dir), vaultDir);
});

test('新项目（无 artifact）→ vault 目录', () => {
  const dir = makeTmpDir('gad-new');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const expected = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  assert.strictEqual(getArtifactDir(dir), expected);
});

test('artifact-root=local → 返回项目本地目录', () => {
  const dir = makeTmpDir('gad-choice-local');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  assert.strictEqual(readArtifactRootChoice(dir), 'local');
  assert.strictEqual(getConfiguredArtifactDir(dir), dir);
  assert.strictEqual(getArtifactDir(dir), dir);
});

test('artifact-root=vault → 返回 vault 项目目录', () => {
  const dir = makeTmpDir('gad-choice-vault');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const expected = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  assert.strictEqual(getArtifactDir(dir), expected);
});

test('_clearArtifactDirCache 刷新同进程 artifact-root 变更', () => {
  const dir = makeTmpDir('gad-cache-clear');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  assert.strictEqual(getArtifactDir(dir), dir);
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');
  assert.strictEqual(getArtifactDir(dir), dir, '未清缓存前应保持同进程缓存值');
  _clearArtifactDirCache();
  const expected = path.join(paceUtils.VAULT_PATH, 'projects', path.basename(dir).toLowerCase().replace(/\s+/g, '-'));
  assert.strictEqual(getArtifactDir(dir), expected);
});

test('artifact-root 带引号/大小写 → 仍按关键词解析', () => {
  const dir = makeTmpDir('gad-choice-quoted-local');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), '"LOCAL"\n', 'utf8');
  assert.strictEqual(readArtifactRootChoice(dir), 'LOCAL');
  assert.strictEqual(getArtifactDir(dir), dir);
  assert.ok(!fs.existsSync(path.join(dir, '"LOCAL"')), '不应把带引号关键词当作相对目录名');
});

test('PACE_ARTIFACT_ROOT=local → 自动化环境跳过询问', () => {
  const dir = makeTmpDir('gad-choice-env-local');
  const prev = process.env.PACE_ARTIFACT_ROOT;
  process.env.PACE_ARTIFACT_ROOT = 'local';
  try {
    assert.strictEqual(readArtifactRootChoice(dir), 'local');
    assert.strictEqual(artifactRootChoiceNeeded(dir), false);
    assert.strictEqual(getArtifactDir(dir), dir);
  } finally {
    if (prev === undefined) delete process.env.PACE_ARTIFACT_ROOT;
    else process.env.PACE_ARTIFACT_ROOT = prev;
  }
});

test('PACE_ARTIFACT_ROOT 超长值会截断后再解析', () => {
  const dir = makeTmpDir('gad-choice-env-long');
  const prev = process.env.PACE_ARTIFACT_ROOT;
  process.env.PACE_ARTIFACT_ROOT = 'x'.repeat(5000);
  try {
    assert.strictEqual(readArtifactRootChoice(dir).length, 4096);
  } finally {
    if (prev === undefined) delete process.env.PACE_ARTIFACT_ROOT;
    else process.env.PACE_ARTIFACT_ROOT = prev;
  }
});

test('首次启用且 vault/local 都无 changes → 需要选择 artifact root', () => {
  const dir = makeTmpDir('gad-choice-needed');
  assert.strictEqual(artifactRootChoiceNeeded(dir), true);
  const msg = artifactRootChoiceMessage(dir);
  assert.ok(msg.includes('AskUserQuestion'));
  assert.ok(msg.includes(getArtifactRootChoicePath(dir)));
  assert.ok(msg.includes('配置文件'), '应明确 artifact-root 是配置文件');
  assert.ok(msg.includes('不是 artifact 根目录'), '应明确配置文件不是 artifact 根目录');
	  assert.ok(msg.includes('只用于 PaceFlow artifacts'), '应明确 artifact_dir 的边界');
  assert.ok(msg.includes('set-artifact-root.js'), '应给出 artifact-root helper 路径');
	  assert.ok(msg.includes('reserve-artifact-id.js'), '应给出当前 helper 路径');
  assert.ok(msg.includes('不接受 --artifact-dir / --artifact-root / --project-dir'), '应明确 helper 不接受自造 artifact/root/project 参数');
});

test('helper 脚本常量使用绝对当前 runtime 路径', () => {
  assert.ok(path.isAbsolute(SET_ARTIFACT_ROOT_SCRIPT));
  assert.ok(path.isAbsolute(SET_PROJECT_ROOT_SCRIPT));
  assert.ok(path.isAbsolute(RESERVE_ARTIFACT_ID_SCRIPT));
  assert.ok(path.isAbsolute(SYNC_PLAN_SCRIPT));
  assert.ok(SET_ARTIFACT_ROOT_SCRIPT.endsWith('/plugin/hooks/set-artifact-root.js'));
  assert.ok(SET_PROJECT_ROOT_SCRIPT.endsWith('/plugin/hooks/set-project-root.js'));
  assert.ok(RESERVE_ARTIFACT_ID_SCRIPT.endsWith('/plugin/hooks/reserve-artifact-id.js'));
  assert.ok(SYNC_PLAN_SCRIPT.endsWith('/plugin/hooks/sync-plan.js'));
});

test('检测到 legacy v5 artifact → 不先询问 artifact root，而是迁移提示', () => {
  const dir = makeTmpDir('gad-legacy-migration');
  fs.writeFileSync(path.join(dir, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] Legacy task\n\n<!-- ARCHIVE -->\n');
  assert.strictEqual(artifactRootChoiceNeeded(dir), false);
  assert.strictEqual(getArtifactDir(dir), dir);
  const info = getV5MigrationInfo(dir);
  assert.strictEqual(info.detected, true);
  assert.strictEqual(info.needsPrompt, true);
  assert.deepStrictEqual(info.files, ['task.md']);
  const msg = v5MigrationPromptMessage(dir);
  assert.ok(msg.includes('AskUserQuestion'));
  assert.ok(msg.includes('--dry-run'));
  assert.ok(msg.includes('请先用 AskUserQuestion 询问用户是否迁移'));
  assert.ok(msg.includes('必须再次使用 AskUserQuestion'));
  assert.ok(msg.includes('重试被阻止的原始工具调用'));
  assert.ok(msg.includes('v5-migration-state'));
});

test('v5-migration-state=ignored → 检测 legacy 但不重复要求迁移选择', () => {
  const dir = makeTmpDir('gad-legacy-ignored');
  fs.writeFileSync(path.join(dir, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] Legacy task\n\n<!-- ARCHIVE -->\n');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'v5-migration-state'), 'ignored\n', 'utf8');
  const info = getV5MigrationInfo(dir);
  assert.strictEqual(info.detected, true);
  assert.strictEqual(info.needsPrompt, false);
  assert.strictEqual(info.state, 'ignored');
});

test('已有 changes 或已有选择 → 不需要 artifact root 选择', () => {
  const withChanges = makeTmpDir('gad-choice-existing');
  fs.mkdirSync(path.join(withChanges, 'changes'), { recursive: true });
  assert.strictEqual(artifactRootChoiceNeeded(withChanges), false);

  const withChoice = makeTmpDir('gad-choice-existing-choice');
  fs.mkdirSync(path.join(withChoice, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(withChoice, '.pace', 'artifact-root'), 'local\n', 'utf8');
  assert.strictEqual(artifactRootChoiceNeeded(withChoice), false);
});

test('子目录继承父级 PaceFlow Project Root 与 vault artifact', () => {
  const root = makeTmpDir('project-root-parent');
  const child = path.join(root, 'packages', 'api');
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(path.join(child, '.git'), { recursive: true });
  const projectName = path.basename(root).toLowerCase().replace(/\s+/g, '-');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(path.join(vaultDir, 'changes'), { recursive: true });
  t.tmpDirs.push(vaultDir);

  const rootInfo = resolveEffectiveProjectRoot(child);
  assert.strictEqual(rootInfo.projectRoot, root);
  assert.strictEqual(rootInfo.mode, 'inherited');
  assert.strictEqual(rootInfo.inheritedFrom, root);
  assert.strictEqual(getProjectStateDir(child), root);
  assert.strictEqual(getProjectRuntimeDir(child), path.join(root, '.pace'));
  assert.strictEqual(getProjectName(child), projectName);
  assert.strictEqual(getArtifactDir(child), vaultDir);
  assert.strictEqual(isPaceProject(child), 'artifact');
  const ctx = executionContextForCwd(child);
  assert.strictEqual(ctx.isWorktree, false);
  assert.strictEqual(ctx.inheritedProjectRoot, true);
});

test('PACE_ARTIFACT_ROOT 只选择 artifact，不切断子目录 Project Root 继承', () => {
  const root = makeTmpDir('project-root-env-parent');
  const child = path.join(root, 'packages', 'worker');
  fs.mkdirSync(path.join(root, '.pace'), { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(root, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const prev = process.env.PACE_ARTIFACT_ROOT;
  process.env.PACE_ARTIFACT_ROOT = 'local';
  _clearArtifactDirCache();
  try {
    const rootInfo = resolveEffectiveProjectRoot(child);
    assert.strictEqual(rootInfo.projectRoot, root);
    assert.strictEqual(rootInfo.mode, 'inherited');
    assert.strictEqual(getArtifactDir(child), root);
  } finally {
    if (prev === undefined) delete process.env.PACE_ARTIFACT_ROOT;
    else process.env.PACE_ARTIFACT_ROOT = prev;
    _clearArtifactDirCache();
  }
});

test('子目录继承父级 artifact-root-only 项目且触发 PACE 信号', () => {
  const root = makeTmpDir('project-root-choice-only-parent');
  const child = path.join(root, 'packages', 'api');
  fs.mkdirSync(path.join(root, '.pace'), { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(root, '.pace', 'artifact-root'), 'local\n', 'utf8');

  const rootInfo = resolveEffectiveProjectRoot(child);
  assert.strictEqual(rootInfo.projectRoot, root);
  assert.strictEqual(rootInfo.mode, 'inherited');
  assert.strictEqual(rootInfo.reason, 'artifact-root-choice');
  assert.strictEqual(getProjectStateDir(child), root);
  assert.strictEqual(getArtifactDir(child), root);
  assert.strictEqual(isPaceProject(child), 'manual');
  assert.strictEqual(artifactRootChoiceNeeded(child), false);
});

test('PACE_PROJECT_NAME 不把 vault ancestor scan 收窄到最近子目录', () => {
  const root = makeTmpDir('project-root-name-env-parent');
  const child = path.join(root, 'packages', 'api');
  const projectName = path.basename(root).toLowerCase().replace(/\s+/g, '-');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(path.join(vaultDir, 'changes'), { recursive: true });
  t.tmpDirs.push(vaultDir);
  const prev = process.env.PACE_PROJECT_NAME;
  process.env.PACE_PROJECT_NAME = projectName;
  _clearArtifactDirCache();
  try {
    const rootInfo = resolveEffectiveProjectRoot(child);
    assert.strictEqual(rootInfo.projectRoot, root);
    assert.strictEqual(rootInfo.mode, 'inherited');
    assert.strictEqual(getProjectRuntimeDir(child), path.join(root, '.pace'));
    assert.strictEqual(getArtifactDir(child), vaultDir);
  } finally {
    if (prev === undefined) delete process.env.PACE_PROJECT_NAME;
    else process.env.PACE_PROJECT_NAME = prev;
    _clearArtifactDirCache();
  }
});

test('PACE_PROJECT_NAME vault alias 从 git 父 root 继承而不分裂 child runtime', () => {
  const root = makeTmpDir('project-root-name-alias-parent');
  const child = path.join(root, 'packages', 'api');
  const alias = `project-root-alias-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', alias);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(path.join(vaultDir, 'changes'), { recursive: true });
  t.tmpDirs.push(vaultDir);
  const prev = process.env.PACE_PROJECT_NAME;
  process.env.PACE_PROJECT_NAME = alias;
  _clearArtifactDirCache();
  try {
    const rootInfo = resolveEffectiveProjectRoot(child);
    assert.strictEqual(rootInfo.projectRoot, root);
    assert.strictEqual(rootInfo.mode, 'inherited');
    assert.strictEqual(getProjectRuntimeDir(child), path.join(root, '.pace'));
    assert.strictEqual(getArtifactDir(child), vaultDir);
  } finally {
    if (prev === undefined) delete process.env.PACE_PROJECT_NAME;
    else process.env.PACE_PROJECT_NAME = prev;
    _clearArtifactDirCache();
  }
});

test('PACE_PROJECT_NAME vault alias 不让 nested git repo 抢父 Project Root', () => {
  const root = makeTmpDir('project-root-name-alias-nested-parent');
  const nested = path.join(root, 'nested-repo');
  const child = path.join(nested, 'packages', 'api');
  const alias = `project-root-nested-alias-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', alias);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  fs.mkdirSync(path.join(vaultDir, 'changes'), { recursive: true });
  t.tmpDirs.push(vaultDir);
  const prev = process.env.PACE_PROJECT_NAME;
  process.env.PACE_PROJECT_NAME = alias;
  _clearArtifactDirCache();
  try {
    assert.strictEqual(resolveEffectiveProjectRoot(nested).projectRoot, root);
    const rootInfo = resolveEffectiveProjectRoot(child);
    assert.strictEqual(rootInfo.projectRoot, root);
    assert.strictEqual(rootInfo.mode, 'inherited');
    assert.strictEqual(getProjectRuntimeDir(child), path.join(root, '.pace'));
    assert.strictEqual(getArtifactDir(child), vaultDir);
  } finally {
    if (prev === undefined) delete process.env.PACE_PROJECT_NAME;
    else process.env.PACE_PROJECT_NAME = prev;
    _clearArtifactDirCache();
  }
});

test('最近父级 PaceFlow root 胜出，避免继承更外层项目', () => {
  const outer = makeTmpDir('project-root-outer');
  const inner = path.join(outer, 'sub-project');
  const child = path.join(inner, 'src');
  fs.mkdirSync(child, { recursive: true });
  const outerVault = path.join(paceUtils.VAULT_PATH, 'projects', path.basename(outer).toLowerCase().replace(/\s+/g, '-'));
  const innerVault = path.join(paceUtils.VAULT_PATH, 'projects', 'sub-project');
  fs.mkdirSync(path.join(outerVault, 'changes'), { recursive: true });
  fs.mkdirSync(path.join(innerVault, 'changes'), { recursive: true });
  t.tmpDirs.push(outerVault, innerVault);

  assert.strictEqual(getProjectStateDir(child), inner);
  assert.strictEqual(getArtifactDir(child), innerVault);
  assert.strictEqual(getProjectName(child), 'sub-project');
});

test('子目录 project-root=independent 阻断父级继承', () => {
  const root = makeTmpDir('project-root-independent-parent');
  const child = path.join(root, 'experiments', 'new-direction');
  fs.mkdirSync(path.join(child, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(child, '.pace', 'project-root'), 'independent\n', 'utf8');
  const parentVault = path.join(paceUtils.VAULT_PATH, 'projects', path.basename(root).toLowerCase().replace(/\s+/g, '-'));
  fs.mkdirSync(path.join(parentVault, 'changes'), { recursive: true });
  t.tmpDirs.push(parentVault);

  const rootInfo = resolveEffectiveProjectRoot(child);
  assert.strictEqual(rootInfo.projectRoot, child);
  assert.strictEqual(rootInfo.mode, 'independent');
  assert.strictEqual(getProjectStateDir(child), child);
  assert.strictEqual(isPaceProject(child), false);
  assert.strictEqual(getArtifactDir(child), path.join(paceUtils.VAULT_PATH, 'projects', 'new-direction'));
});

test('中间父级 .pace/disabled 阻断继续继承更外层 Project Root', () => {
  const outer = makeTmpDir('project-root-disabled-outer');
  const disabled = path.join(outer, 'disabled-subtree');
  const child = path.join(disabled, 'pkg');
  fs.mkdirSync(path.join(disabled, '.pace'), { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(disabled, '.pace', 'disabled'), '', 'utf8');
  fs.writeFileSync(path.join(child, 'a.js'), '');
  fs.writeFileSync(path.join(child, 'b.js'), '');
  fs.writeFileSync(path.join(child, 'c.js'), '');
  const outerVault = path.join(paceUtils.VAULT_PATH, 'projects', path.basename(outer).toLowerCase().replace(/\s+/g, '-'));
  fs.mkdirSync(path.join(outerVault, 'changes'), { recursive: true });
  t.tmpDirs.push(outerVault);

  const rootInfo = resolveEffectiveProjectRoot(child);
  assert.strictEqual(rootInfo.projectRoot, disabled);
  assert.strictEqual(rootInfo.mode, 'disabled');
  assert.strictEqual(rootInfo.reason, 'ancestor-disabled');
  assert.strictEqual(isPaceProject(child), false);
});

test('父级 legacy v5 artifact 让子目录继承 Project Root 并触发迁移提示', () => {
  const root = makeTmpDir('project-root-legacy-parent');
  const child = path.join(root, 'packages', 'api');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(root, 'task.md'), '# Task\n\n- [ ] Legacy parent task\n', 'utf8');
  fs.writeFileSync(path.join(root, 'implementation_plan.md'), '# Implementation Plan\n\n- [ ] Legacy parent plan\n', 'utf8');

  const rootInfo = resolveEffectiveProjectRoot(child);
  assert.strictEqual(rootInfo.projectRoot, root);
  assert.strictEqual(rootInfo.mode, 'inherited');
  assert.strictEqual(rootInfo.reason, 'legacy');
  assert.strictEqual(isPaceProject(child), 'legacy');
  const migration = getV5MigrationInfo(child);
  assert.strictEqual(migration.detected, true);
  assert.strictEqual(migration.dir, root);
});

test('父级残留 .pace/.gitignore 不会被当成 Project Root', () => {
  const root = makeTmpDir('project-root-runtime-only');
  const child = path.join(root, 'pkg');
  fs.mkdirSync(path.join(root, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(root, '.pace', '.gitignore'), '*\n', 'utf8');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'a.js'), '');
  fs.writeFileSync(path.join(child, 'b.js'), '');
  fs.writeFileSync(path.join(child, 'c.js'), '');

  assert.strictEqual(getProjectStateDir(child), child);
  assert.strictEqual(isPaceProject(child), 'code-count');
});

test('子目录本地 artifact-root 显式声明当前目录为 Project Root', () => {
  const root = makeTmpDir('project-root-child-choice-parent');
  const child = path.join(root, 'tool');
  fs.mkdirSync(path.join(child, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(child, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const parentVault = path.join(paceUtils.VAULT_PATH, 'projects', path.basename(root).toLowerCase().replace(/\s+/g, '-'));
  fs.mkdirSync(path.join(parentVault, 'changes'), { recursive: true });
  t.tmpDirs.push(parentVault);

  assert.strictEqual(getProjectStateDir(child), child);
  assert.strictEqual(getArtifactRootChoicePath(child), path.join(child, '.pace', 'artifact-root'));
  assert.strictEqual(getArtifactDir(child), child);
  assert.strictEqual(artifactRootChoiceNeeded(child), false);
});

test('worktree 有本地 changes 时仍优先沿用宿主 vault artifact', () => {
  const projectName = `pace-worktree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const root = makeTmpDir('gad-worktree-root');
  const host = path.join(root, projectName);
  const worktree = path.join(host, 'worktrees', 'smoke');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(path.join(worktree, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'smoke')}\n`, 'utf8');
  fs.mkdirSync(path.join(vaultDir, 'changes'), { recursive: true });
  t.tmpDirs.push(vaultDir);

  assert.deepStrictEqual(getProjectNameCandidates(worktree).slice(0, 2), [projectName, 'smoke']);
  assert.strictEqual(getArtifactDir(worktree), vaultDir);
});

test('worktree 读取宿主 artifact-root=local → 返回宿主项目目录', () => {
  const projectName = `pace-worktree-choice-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const root = makeTmpDir('gad-worktree-choice-root');
  const host = path.join(root, projectName);
  const worktree = path.join(host, 'worktrees', 'smoke');
  fs.mkdirSync(path.join(host, '.pace'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(host, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'smoke')}\n`, 'utf8');

  assert.strictEqual(getProjectStateDir(worktree), host);
  assert.strictEqual(getProjectRuntimeDir(worktree), path.join(host, '.pace'));
  assert.strictEqual(getArtifactRootChoicePath(worktree), path.join(host, '.pace', 'artifact-root'));
  assert.strictEqual(getArtifactDir(worktree), host);
});

test('worktree 宿主 .pace/disabled 对 worktree 生效', () => {
  const projectName = `pace-worktree-disabled-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const root = makeTmpDir('disabled-worktree-root');
  const host = path.join(root, projectName);
  const worktree = path.join(host, 'worktrees', 'smoke');
  fs.mkdirSync(path.join(host, '.pace'), { recursive: true });
  fs.mkdirSync(path.join(host, 'changes'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(host, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.writeFileSync(path.join(host, '.pace', 'disabled'), '', 'utf8');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'smoke')}\n`, 'utf8');

  assert.strictEqual(isPaceProject(worktree), false);
});

test('executionContextForCwd: git worktree 标记 worktree 名称并写宿主 stateDir', () => {
  const root = makeTmpDir('exec-context-root');
  const host = path.join(root, 'host');
  const worktree = path.join(root, 'worktrees', 'feature-a');
  const child = path.join(worktree, 'packages', 'api');
  fs.mkdirSync(path.join(host, '.git', 'worktrees', 'feature-a'), { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'feature-a')}\n`, 'utf8');
  const ctx = executionContextForCwd(worktree);
  assert.strictEqual(ctx.isWorktree, true);
  assert.strictEqual(ctx.worktree, 'feature-a');
  assert.strictEqual(ctx.stateDir, host);
  assert.strictEqual(ctx.checkoutDir, worktree);
  assert.ok(ctx.text.includes('[worktree:: feature-a]'));
  const childCtx = executionContextForCwd(child);
  assert.strictEqual(childCtx.isWorktree, true);
  assert.strictEqual(childCtx.worktree, 'feature-a');
  assert.strictEqual(childCtx.stateDir, host);
  assert.strictEqual(childCtx.checkoutDir, worktree);

  const written = writeChangeOwner(worktree, 'CHG-20260522-01', {
    sessionId: 'sid-worktree-root',
    agentId: 'agent-worktree-root',
    operation: 'update-chg',
    state: 'active',
  });
  assert.strictEqual(written.ok, true);
  assert.strictEqual(changeOwnerStatus(child, 'CHG-20260522-01', 'sid-worktree-child').disposition, 'current-worktree');
});

test('git worktree 内 nested .git 目录仍向上继承宿主 Project Root', () => {
  const root = makeTmpDir('worktree-nested-git-dir-root');
  const host = path.join(root, 'host');
  const worktree = path.join(root, 'worktrees', 'feature-nested-dir');
  const nested = path.join(worktree, 'vendor', 'lib');
  fs.mkdirSync(path.join(host, '.git', 'worktrees', 'feature-nested-dir'), { recursive: true });
  fs.mkdirSync(path.join(host, '.pace'), { recursive: true });
  fs.mkdirSync(path.join(nested, '.git'), { recursive: true });
  fs.writeFileSync(path.join(host, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'feature-nested-dir')}\n`, 'utf8');

  const rootInfo = resolveEffectiveProjectRoot(nested);
  assert.strictEqual(rootInfo.mode, 'worktree');
  assert.strictEqual(rootInfo.projectRoot, host);
  assert.strictEqual(getProjectStateDir(nested), host);
  assert.strictEqual(getProjectRuntimeDir(nested), path.join(host, '.pace'));
  assert.strictEqual(getArtifactDir(nested), host);
  const ctx = executionContextForCwd(nested);
  assert.strictEqual(ctx.isWorktree, true);
  assert.strictEqual(ctx.worktree, 'feature-nested-dir');
  assert.strictEqual(ctx.checkoutDir, worktree);
});

test('git worktree 内 nested 普通 .git 文件仍向上继承宿主 Project Root', () => {
  const root = makeTmpDir('worktree-nested-git-file-root');
  const host = path.join(root, 'host');
  const worktree = path.join(root, 'worktrees', 'feature-nested-file');
  const nested = path.join(worktree, 'vendor', 'submodule');
  fs.mkdirSync(path.join(host, '.git', 'worktrees', 'feature-nested-file'), { recursive: true });
  fs.mkdirSync(path.join(host, '.pace'), { recursive: true });
  fs.mkdirSync(path.join(nested, '.gitdir'), { recursive: true });
  fs.writeFileSync(path.join(host, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'feature-nested-file')}\n`, 'utf8');
  fs.writeFileSync(path.join(nested, '.git'), `gitdir: ${path.join(nested, '.gitdir')}\n`, 'utf8');

  const rootInfo = resolveEffectiveProjectRoot(nested);
  assert.strictEqual(rootInfo.mode, 'worktree');
  assert.strictEqual(rootInfo.projectRoot, host);
  assert.strictEqual(getProjectStateDir(nested), host);
  assert.strictEqual(getProjectRuntimeDir(nested), path.join(host, '.pace'));
  assert.strictEqual(getArtifactDir(nested), host);
  const ctx = executionContextForCwd(nested);
  assert.strictEqual(ctx.isWorktree, true);
  assert.strictEqual(ctx.worktree, 'feature-nested-file');
  assert.strictEqual(ctx.checkoutDir, worktree);
});

test('change owner runtime: 当前 session / foreign fresh 可区分', () => {
  const dir = makeTmpDir('change-owner');
  const written = writeChangeOwner(dir, 'CHG-20260512-01', {
    sessionId: 'sid-owner',
    agentId: 'agent-owner',
    operation: 'create-chg',
    state: 'active',
  });
  assert.strictEqual(written.ok, true);
  const owner = readChangeOwner(dir, 'CHG-20260512-01');
  assert.strictEqual(owner.ok, true);
  assert.strictEqual(owner.sessionId, 'sid-owner');
  assert.strictEqual(changeOwnerStatus(dir, 'CHG-20260512-01', 'sid-owner').disposition, 'current');
  assert.strictEqual(changeOwnerStatus(dir, 'CHG-20260512-01', 'sid-other').disposition, 'current-worktree');
  const foreign = JSON.parse(fs.readFileSync(written.path, 'utf8'));
  foreign.cwd = path.join(dir, 'other-checkout');
  foreign.stateDir = path.join(dir, 'other-checkout');
  foreign.worktree = 'other-checkout';
  foreign.branch = 'other-branch';
  fs.writeFileSync(written.path, `${JSON.stringify(foreign, null, 2)}\n`, 'utf8');
  assert.strictEqual(changeOwnerStatus(dir, 'CHG-20260512-01', 'sid-other').disposition, 'foreign-fresh');
});

test('change owner heartbeat: 当前 session 工具活动刷新 owner timestamp', () => {
  const dir = makeTmpDir('change-owner-heartbeat');
  const written = writeChangeOwner(dir, 'CHG-20260512-02', {
    sessionId: 'sid-heartbeat',
    agentId: 'agent-heartbeat',
    operation: 'update-chg',
    state: 'active',
  });
  assert.strictEqual(written.ok, true);
  const fp = written.path;
  const old = JSON.parse(fs.readFileSync(fp, 'utf8'));
  old.cwd = path.join(dir, 'other-checkout');
  old.stateDir = path.join(dir, 'other-checkout');
  old.worktree = 'other-checkout';
  old.branch = 'other-branch';
  old.timestampMs = Date.now() - 60 * 60 * 1000;
  old.updatedAt = new Date(old.timestampMs).toISOString();
  fs.writeFileSync(fp, `${JSON.stringify(old, null, 2)}\n`, 'utf8');
  assert.strictEqual(changeOwnerStatus(dir, 'CHG-20260512-02', 'sid-other').disposition, 'foreign-stale');
  const touched = touchChangeOwnersForSession(dir, { sessionId: 'sid-heartbeat' });
  assert.deepStrictEqual(touched, ['CHG-20260512-02']);
  assert.strictEqual(changeOwnerStatus(dir, 'CHG-20260512-02', 'sid-other').disposition, 'current-worktree');
});

test('artifact-root=vault 且 vault env 缺失时返回配置错误', () => {
  const dir = makeTmpDir('vault-choice-missing-env-utils');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');
  const originalVaultPath = process.env.PACE_VAULT_PATH;
  process.env.PACE_VAULT_PATH = '';
  delete require.cache[require.resolve('../plugin/hooks/pace-utils')];
  const fresh = require('../plugin/hooks/pace-utils');
  try {
    const err = fresh.artifactRootConfigError(dir);
    assert.ok(err);
    assert.strictEqual(err.code, 'vault-env-missing');
    assert.ok(err.message.includes('PACE_VAULT_PATH'));
  } finally {
    if (originalVaultPath === undefined) delete process.env.PACE_VAULT_PATH;
    else process.env.PACE_VAULT_PATH = originalVaultPath;
    delete require.cache[require.resolve('../plugin/hooks/pace-utils')];
    require('../plugin/hooks/pace-utils');
  }
});

test('worktree 无本地 artifact 但宿主 vault 有 changes → artifact', () => {
  const projectName = `pace-worktree-signal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const root = makeTmpDir('signal-worktree-root');
  const host = path.join(root, projectName);
  const worktree = path.join(host, 'worktrees', 'smoke');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'smoke')}\n`, 'utf8');
  fs.mkdirSync(path.join(vaultDir, 'changes'), { recursive: true });
  t.tmpDirs.push(vaultDir);

  assert.strictEqual(isPaceProject(worktree), 'artifact');
});

// ============================================================
// scanRelatedNotes (H-10)
// 注意：VAULT_PATH 是 const，无法在测试中替换。
// 采用与 getArtifactDir 相同策略：在真实 VAULT_PATH 创建唯一命名的临时文件。
// ============================================================

test('scanRelatedNotes: 正常匹配（projects 含项目名）', () => {
  const uniqueProject = 'pace-scan-test-' + Date.now();
  const thoughtsDir = path.join(paceUtils.VAULT_PATH, 'thoughts');
  fs.mkdirSync(thoughtsDir, { recursive: true });
  const noteFile = path.join(thoughtsDir, `_test-${uniqueProject}.md`);
  fs.writeFileSync(noteFile, [
    '---',
    'status: discussing',
    `projects: [${uniqueProject}, other]`,
    'summary: "测试摘要"',
    '---',
    '# Test',
  ].join('\n'));

  try {
    const results = paceUtils.scanRelatedNotes(uniqueProject);
    assert.ok(results.length >= 1, '应至少匹配 1 条');
    const found = results.find(r => r.title === `_test-${uniqueProject}`);
    assert.ok(found, '应找到测试笔记');
    assert.strictEqual(found.summary, '测试摘要');
    assert.strictEqual(found.status, 'discussing');
  } finally {
    try { fs.unlinkSync(noteFile); } catch(e) {}
  }
});

test('scanRelatedNotes: 无匹配项目名 → 空数组', () => {
  const uniqueProject = 'pace-scan-nomatch-' + Date.now();
  // 不创建任何笔记，直接查询不存在的项目名
  const results = paceUtils.scanRelatedNotes(uniqueProject);
  assert.strictEqual(results.length, 0, '不应匹配不相关项目');
});

test('scanRelatedNotes: status=archived 被过滤', () => {
  const uniqueProject = 'pace-scan-archived-' + Date.now();
  const knowledgeDir = path.join(paceUtils.VAULT_PATH, 'knowledge');
  fs.mkdirSync(knowledgeDir, { recursive: true });
  const noteFile = path.join(knowledgeDir, `_test-${uniqueProject}.md`);
  fs.writeFileSync(noteFile, [
    '---',
    'status: archived',
    `projects: [${uniqueProject}]`,
    'summary: "已归档"',
    '---',
    '# Archived',
  ].join('\n'));

  try {
    const results = paceUtils.scanRelatedNotes(uniqueProject);
    const found = results.find(r => r.title === `_test-${uniqueProject}`);
    assert.ok(!found, 'archived 笔记不应返回');
  } finally {
    try { fs.unlinkSync(noteFile); } catch(e) {}
  }
});

test('scanRelatedNotes: VAULT_PATH 空值 → 空数组不报错', () => {
  // W-1 防御：直接调用不可能触发（VAULT_PATH 是 const），
  // 但验证函数对完全不存在的项目名也不报错
  const results = paceUtils.scanRelatedNotes('nonexistent-project-' + Date.now());
  assert.ok(Array.isArray(results), '应返回数组');
});

// ============================================================
// 7. resolveProjectCwd() — 3 个测试（CLAUDE_PROJECT_DIR 环境变量）
// ============================================================
console.log('\n--- resolveProjectCwd ---');

test('resolveProjectCwd: CLAUDE_PROJECT_DIR 设置 → 返回规范化路径', () => {
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = 'C:/Users/test/project';
  try {
    const result = paceUtils.resolveProjectCwd();
    assert.strictEqual(result, path.resolve('C:/Users/test/project'));
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = origEnv;
  }
});

test('resolveProjectCwd: CLAUDE_PROJECT_DIR 未设置 → fallback process.cwd()', () => {
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
  try {
    const result = paceUtils.resolveProjectCwd();
    assert.strictEqual(result, process.cwd());
  } finally {
    if (origEnv !== undefined) process.env.CLAUDE_PROJECT_DIR = origEnv;
  }
});

test('resolveProjectCwd: CLAUDE_PROJECT_DIR 空字符串 → fallback process.cwd()', () => {
  const origEnv = process.env.CLAUDE_PROJECT_DIR;
  process.env.CLAUDE_PROJECT_DIR = '';
  try {
    const result = paceUtils.resolveProjectCwd();
    assert.strictEqual(result, process.cwd());
  } finally {
    if (origEnv === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = origEnv;
  }
});

// ============================================================
// 8. listPlanFiles() — 5 个测试（含双路径）
// ============================================================
console.log('\n--- listPlanFiles ---');

test('listPlanFiles: 无 docs/plans/ 返回空数组', () => {
  const dir = makeTmpDir('lp-empty');
  assert.deepStrictEqual(paceUtils.listPlanFiles(dir), []);
});

test('listPlanFiles: docs/plans/ 有 plan 文件按日期降序', () => {
  const dir = makeTmpDir('lp-sort');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-feature-a.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-feature-b.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'README.md'), '');
  const result = paceUtils.listPlanFiles(dir);
  assert.deepStrictEqual(result, [
    { name: '2026-03-04-feature-b.md', dir: 'docs/plans' },
    { name: '2026-03-01-feature-a.md', dir: 'docs/plans' },
  ]);
});

test('listPlanFiles: 非日期格式文件被过滤', () => {
  const dir = makeTmpDir('lp-filter');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'random-notes.md'), '');
  assert.deepStrictEqual(paceUtils.listPlanFiles(dir), []);
});

test('listPlanFiles: docs/superpowers/plans/ 新路径扫描', () => {
  const dir = makeTmpDir('lp-superpowers');
  fs.mkdirSync(path.join(dir, 'docs', 'superpowers', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-03-19-new-feature.md'), '');
  const result = paceUtils.listPlanFiles(dir);
  assert.deepStrictEqual(result, [
    { name: '2026-03-19-new-feature.md', dir: 'docs/superpowers/plans' },
  ]);
});

test('listPlanFiles: 双路径合并去重按日期降序', () => {
  const dir = makeTmpDir('lp-dual');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'superpowers', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-old.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-03-19-new.md'), '');
  // 同名文件在两个目录（旧路径优先，去重）
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-10-dup.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'superpowers', 'plans', '2026-03-10-dup.md'), '');
  const result = paceUtils.listPlanFiles(dir);
  assert.strictEqual(result.length, 3, '去重后应有 3 个');
  assert.strictEqual(result[0].name, '2026-03-19-new.md');
  assert.strictEqual(result[0].dir, 'docs/superpowers/plans');
  assert.strictEqual(result[1].name, '2026-03-10-dup.md');
  assert.strictEqual(result[1].dir, 'docs/plans'); // 旧路径先扫描
  assert.strictEqual(result[2].name, '2026-03-01-old.md');
});

test('getNativePlanPath: 过滤不属于当前项目的 current-native-plan', () => {
  const dir = makeTmpDir('native-plan-filter-project');
  const runtime = getProjectRuntimeDir(dir);
  fs.mkdirSync(runtime, { recursive: true });
  const foreign = path.join(makeTmpDir('native-plan-foreign'), 'plan.md');
  fs.writeFileSync(foreign, '# unrelated project\n\nccauth task\n', 'utf8');
  fs.writeFileSync(path.join(runtime, 'current-native-plan'), foreign, 'utf8');
  assert.strictEqual(paceUtils.getNativePlanPath(dir), null);

  const local = path.join(dir, 'docs', 'plan.md');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.writeFileSync(local, '# local plan\n', 'utf8');
  fs.writeFileSync(path.join(runtime, 'current-native-plan'), local, 'utf8');
  assert.strictEqual(paceUtils.getNativePlanPath(dir), local.replace(/\\/g, '/'));
});

test('getNativePlanPath: 返回显示路径不复用 Windows 小写 normalizer', () => {
  const base = makeTmpDir('native-plan-display-case');
  const dir = path.join(base, 'MixedCaseProject');
  const runtime = path.join(dir, '.pace');
  const local = path.join(dir, 'Docs', 'Plan.md');
  fs.mkdirSync(path.dirname(local), { recursive: true });
  fs.mkdirSync(runtime, { recursive: true });
  fs.writeFileSync(local, '# local plan\n', 'utf8');
  fs.writeFileSync(path.join(runtime, 'current-native-plan'), local, 'utf8');

  const utils = createPlanUtils({
    ...paceUtils,
    getProjectRuntimeDir: () => runtime,
    normalizePath: value => String(value || '').replace(/\\/g, '/').toLowerCase(),
  });
  assert.strictEqual(utils.getNativePlanPath(dir), local.replace(/\\/g, '/'));
});

// ============================================================
// 9. hasUnsyncedPlanFiles() / listUnsyncedPlanFiles() — 4 个测试
// ============================================================
console.log('\n--- hasUnsyncedPlanFiles / listUnsyncedPlanFiles ---');

test('hasUnsyncedPlanFiles: 无 docs/plans/ → false', () => {
  const dir = makeTmpDir('usp-empty');
  assert.strictEqual(paceUtils.hasUnsyncedPlanFiles(dir), false);
});

test('hasUnsyncedPlanFiles: 全部已同步 → false', () => {
  const dir = makeTmpDir('usp-allsynced');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-feature-a.md'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'synced-plans'), '2026-03-01-feature-a.md\n');
  assert.strictEqual(paceUtils.hasUnsyncedPlanFiles(dir), false);
});

test('hasUnsyncedPlanFiles: 部分未同步 → true + listUnsyncedPlanFiles 仅返回未同步', () => {
  const dir = makeTmpDir('usp-partial');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-feature-a.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-feature-b.md'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'synced-plans'), '2026-03-01-feature-a.md\n');
  assert.strictEqual(paceUtils.hasUnsyncedPlanFiles(dir), true);
  const unsynced = paceUtils.listUnsyncedPlanFiles(dir);
  assert.strictEqual(unsynced.length, 1);
  assert.strictEqual(unsynced[0].name, '2026-03-04-feature-b.md');
  assert.strictEqual(unsynced[0].dir, 'docs/plans');
});

test('hasUnsyncedPlanFiles: 无 synced-plans 文件 → 全部视为未同步', () => {
  const dir = makeTmpDir('usp-nosync');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-feature-a.md'), '');
  assert.strictEqual(paceUtils.hasUnsyncedPlanFiles(dir), true);
  const unsynced = paceUtils.listUnsyncedPlanFiles(dir);
  assert.strictEqual(unsynced.length, 1);
  assert.strictEqual(unsynced[0].name, '2026-03-01-feature-a.md');
});

test('listUnsyncedPlanFiles: 主文件已同步时 -design.md 伴随文件也视为已同步', () => {
  const dir = makeTmpDir('usp-design');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-08-feature.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-08-feature-design.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-08-other.md'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'synced-plans'), '2026-03-08-feature.md\n');
  const unsynced = paceUtils.listUnsyncedPlanFiles(dir);
  assert.strictEqual(unsynced.length, 1);
  assert.strictEqual(unsynced[0].name, '2026-03-08-other.md');
});

test('bridge candidate plans: 旧 plan 不作为当前 bridge 信号', () => {
  const dir = makeTmpDir('usp-stale-bridge');
  const planDir = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(planDir, { recursive: true });
  const plan = path.join(planDir, '2026-03-08-old-plan.md');
  fs.writeFileSync(plan, '# Old plan\n', 'utf8');
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  fs.utimesSync(plan, old, old);

  assert.strictEqual(paceUtils.hasUnsyncedPlanFiles(dir), true);
  assert.strictEqual(hasBridgeCandidatePlanFiles(dir), false);
  assert.deepStrictEqual(listBridgeCandidatePlanFiles(dir), []);
  assert.strictEqual(paceUtils.formatBridgeHint(dir, dir), null);
  assert.strictEqual(isPaceProject(dir), false);
});

test('bridge candidate plans: current-native-plan 即使较旧也保持桥接提示', () => {
  const dir = makeTmpDir('usp-current-native-bridge');
  const planDir = path.join(dir, 'docs', 'plans');
  fs.mkdirSync(planDir, { recursive: true });
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  const plan = path.join(planDir, '2026-03-08-current-plan.md');
  fs.writeFileSync(plan, '# Current plan\n', 'utf8');
  const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  fs.utimesSync(plan, old, old);
  fs.writeFileSync(path.join(dir, '.pace', 'current-native-plan'), plan, 'utf8');

  assert.strictEqual(hasBridgeCandidatePlanFiles(dir), true);
  const candidates = listBridgeCandidatePlanFiles(dir);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].name, '2026-03-08-current-plan.md');
  assert.ok(paceUtils.formatBridgeHint(dir, dir).fileList.includes('2026-03-08-current-plan.md'));
  assert.strictEqual(isPaceProject(dir), 'superpowers');
});

// ============================================================
// 10. v6 change parsing/classification
// ============================================================
console.log('\n--- v6 change parsing/classification ---');

function writeV6ChangeFixture(dir, { id = 'CHG-20260507-01', status = 'in-progress', checkbox = '/', tasks = ['- [/] T-001 测试任务'], approved = true, verified = false } = {}) {
  const slug = id.toLowerCase();
  const indexLine = `- [${checkbox}] [[${slug}]] 测试变更 #change [tasks:: T-001]\n`;
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'task.md'), `# 项目任务追踪\n\n## 活跃任务\n\n${indexLine}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), `# 实施计划\n\n## 变更索引\n\n${indexLine}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'changes', `${slug}.md`), [
    '---',
    `chg-id: ${id}`,
    `status: ${status}`,
    'date: 2026-05-07',
    'type: change',
    'parent-tasks: ["[[task]]"]',
    'parent-impl: ["[[implementation_plan]]"]',
    'related-finding: null',
    'aliases: []',
    'tags: []',
    'schema-version: "6.0"',
    'completed-date: null',
    `verified-date: ${verified ? '2026-05-07T12:00:00+08:00' : 'null'}`,
    'archived-date: null',
    '---',
    '',
    '# 测试变更',
    '',
    '## 任务清单',
    '',
    ...tasks,
    '',
    approved ? '<!-- APPROVED -->' : '',
    verified ? '<!-- VERIFIED -->' : '',
    '',
    '## 实施详情',
    '',
  ].filter((line, idx, arr) => line !== '' || arr[idx - 1] !== '').join('\n'));
}

test('getActiveChangeEntries + classifyChange — running', () => {
  const dir = makeTmpDir('v6-class-running');
  writeV6ChangeFixture(dir);
  const entries = paceUtils.getActiveChangeEntries(dir);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].id, 'CHG-20260507-01');
  const classified = paceUtils.classifyChange(entries[0]);
  assert.strictEqual(classified.category, 'running');
  assert.strictEqual(classified.tasks.pending, 1);
});

test('classifyChange — completed 未 verified 需要收尾', () => {
  const dir = makeTmpDir('v6-class-closing');
  writeV6ChangeFixture(dir, { status: 'completed', checkbox: 'x', tasks: ['- [x] T-001 测试任务'] });
  const classified = paceUtils.classifyChange(paceUtils.getActiveChangeEntries(dir)[0]);
  assert.strictEqual(classified.category, 'closing-required');
  assert.strictEqual(classified.verified, false);
});

test('isChangeVerified — verified-date 为带引号 null 时不算 verified', () => {
  const dir = makeTmpDir('v6-class-quoted-null-verified');
  writeV6ChangeFixture(dir, { status: 'completed', checkbox: 'x', tasks: ['- [x] T-001 测试任务'], verified: true });
  const detailPath = path.join(dir, 'changes', 'chg-20260507-01.md');
  const content = fs.readFileSync(detailPath, 'utf8').replace(/^verified-date: .+$/m, 'verified-date: "null"');
  fs.writeFileSync(detailPath, content, 'utf8');
  const entry = paceUtils.getActiveChangeEntries(dir)[0];
  assert.strictEqual(paceUtils.isChangeVerified(entry.detail), false);
  assert.strictEqual(paceUtils.classifyChange(entry).category, 'closing-required');
});

test('parseFrontmatter — 支持 UTF-8 BOM 前缀', () => {
  const content = '\uFEFF---\nchg-id: CHG-20260507-01\nstatus: in-progress\n---\n';
  assert.deepStrictEqual(parseFrontmatter(content), {
    'chg-id': 'CHG-20260507-01',
    status: 'in-progress',
  });
});

test('classifyChange — archived/cancelled 活跃区视为 inconsistent', () => {
  const dir = makeTmpDir('v6-class-terminal-active');
  writeV6ChangeFixture(dir, { status: 'archived', checkbox: 'x', tasks: ['- [x] T-001 测试任务'], verified: true });
  const classified = paceUtils.classifyChange(paceUtils.getActiveChangeEntries(dir)[0]);
  assert.strictEqual(classified.category, 'inconsistent');
  assert.strictEqual(classified.reason, 'active-archived');
});

test('countDetailTasks — 只识别 T-NNN 三位任务编号', () => {
  const content = [
    '## 任务清单',
    '',
    '- [/] T-001 正确编号',
    '- [x] T-002 正确编号',
    '- [ ] T-1 非规范编号',
    '',
    '## 实施详情',
  ].join('\n');
  assert.deepStrictEqual(paceUtils.countDetailTasks(content), {
    pending: 1,
    done: 1,
    total: 2,
    inProgress: 1,
    blocked: 0,
  });
});

// ============================================================
// 12. getProjectName() 特殊字符 — 3 个测试
// ============================================================
console.log('\n--- getProjectName 特殊字符 ---');

test('getProjectName — 中文目录名被过滤', () => {
  const name = getProjectName('/home/user/我的项目');
  assert.strictEqual(name, 'unknown-project');
});

test('getProjectName — @#符号被过滤', () => {
  const name = getProjectName('/home/user/@my-project#1');
  assert.strictEqual(name, 'my-project-1');
});

test('getProjectName — 混合字符保留合法部分', () => {
  const name = getProjectName('/home/user/My Project (v2)');
  assert.strictEqual(name, 'my-project-v2');
});

// ============================================================
// 13. formatBridgeHint() — 3 个测试
// ============================================================
console.log('\n--- formatBridgeHint ---');

test('formatBridgeHint — 无计划文件返回 null', () => {
  const dir = makeTmpDir('bridge-none');
  assert.strictEqual(paceUtils.formatBridgeHint(dir, dir), null);
});

test('formatBridgeHint — 有未同步计划文件返回提示', () => {
  const dir = makeTmpDir('bridge-has');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-09-feature.md'), '');
  const result = paceUtils.formatBridgeHint(dir, dir);
  assert.ok(result !== null, '应返回非 null');
  assert.ok(result.fileList.includes('docs/plans/2026-03-09-feature.md'), 'fileList 应含完整路径');
  assert.ok(result.bridgeSteps.includes('Skill(paceflow:pace-bridge)'), 'bridgeSteps 应指向 pace-bridge skill');
  assert.ok(result.bridgeSteps.includes('v6 CHG'), 'bridgeSteps 应要求桥接为 v6 CHG');
  assert.ok(result.bridgeSteps.includes('sync-plan.js'), 'bridgeSteps 应给出 plan 同步 helper');
  assert.ok(!result.bridgeSteps.includes('Edit '), 'bridgeSteps 不应引导主 session 直接 Edit artifact');
});

test('formatBridgeHint — 已同步文件不返回', () => {
  const dir = makeTmpDir('bridge-synced');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-09-feature.md'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'synced-plans'), '2026-03-09-feature.md\n');
  assert.strictEqual(paceUtils.formatBridgeHint(dir, dir), null);
});

// ============================================================
// 14. createLogger() — 3 个测试
// ============================================================
console.log('\n--- createLogger ---');

test('createLogger — 基本写入', () => {
  const dir = makeTmpDir('logger-basic');
  const logFile = path.join(dir, 'test.log');
  const log = paceUtils.createLogger(logFile);
  log('hello\n');
  log('world\n');
  const content = fs.readFileSync(logFile, 'utf8');
  assert.ok(content.includes('hello'), '应包含 hello');
  assert.ok(content.includes('world'), '应包含 world');
});

test('createLogger — 超过 1MB 触发轮转', () => {
  const dir = makeTmpDir('logger-rotate');
  const logFile = path.join(dir, 'test.log');
  // 写入 1025KB 数据（超过 1MB 阈值）
  const chunk = 'A'.repeat(1024) + '\n';
  fs.writeFileSync(logFile, chunk.repeat(1025));
  const sizeBefore = fs.statSync(logFile).size;
  assert.ok(sizeBefore > 1024 * 1024, '应超过 1MB');
  // 触发轮转
  const log = paceUtils.createLogger(logFile);
  log('trigger\n');
  const sizeAfter = fs.statSync(logFile).size;
  assert.ok(sizeAfter < sizeBefore, `轮转后应变小: ${sizeAfter} < ${sizeBefore}`);
});

test('createLogger — 轮转后对齐到换行符', () => {
  const dir = makeTmpDir('logger-align');
  const logFile = path.join(dir, 'test.log');
  // 写入带换行的大数据
  const lines = [];
  for (let i = 0; i < 600; i++) lines.push(`line-${i.toString().padStart(4, '0')}: ${'X'.repeat(900)}`);
  fs.writeFileSync(logFile, lines.join('\n') + '\n');
  const log = paceUtils.createLogger(logFile);
  log('after-rotate\n');
  const content = fs.readFileSync(logFile, 'utf8');
  // 第一个字符应该是 'l'（line- 开头），不应是截断的中间内容
  assert.ok(content.startsWith('line-'), `轮转后应从完整行开始，实际: ${content.slice(0, 20)}`);
  assert.ok(content.includes('after-rotate'), '应包含轮转后写入的内容');
});

test('logEntry — 字段单行化并截断长值', () => {
  const entry = paceUtils.logEntry('PreToolUse', 'DENY', {
    reason: 'line1\nline2|pipe',
    long: 'x'.repeat(1020),
  });
  const lines = entry.trimEnd().split('\n');
  assert.strictEqual(lines.length, 1, '日志字段中的换行不应打断结构化日志');
  assert.ok(entry.includes('reason=line1\\nline2/pipe'));
  assert.ok(entry.includes('long='));
  assert.ok(entry.includes('...'), '长字段应截断');
});

test('projectLogEntry — 补齐 cwd/project_root/artifact_dir/mode 上下文', () => {
  const root = makeTmpDir('project-log-root');
  const child = path.join(root, 'packages', 'api');
  fs.mkdirSync(path.join(root, 'changes'), { recursive: true });
  fs.mkdirSync(child, { recursive: true });
  const entry = paceUtils.projectLogEntry(child, 'Stop', 'ENTRY', { proj: 'demo' });
  assert.ok(entry.includes(`cwd=${child.replace(/\\/g, '/')}`));
  assert.ok(entry.includes(`project_root=${root.replace(/\\/g, '/')}`));
  assert.ok(entry.includes(`artifact_dir=${root.replace(/\\/g, '/')}/`));
  assert.ok(entry.includes('mode=inherited'));
});

// ============================================================
// 15. parseHookStdin() — 6 个测试
// ============================================================
console.log('\n--- parseHookStdin ---');

test('parseHookStdin — 完整字段正常解析', () => {
  const input = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: 'C:\\Users\\test\\file.js',
      old_string: 'old',
      new_string: 'new',
      content: 'full content'
    },
    type: 'startup',
    agent_id: 'agent-123',
    agent_type: 'artifact-writer',
    last_assistant_message: 'done'
  });
  const r = paceUtils.parseHookStdin(input);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.toolName, 'Edit');
  assert.strictEqual(r.filePath, 'C:/Users/test/file.js', 'filePath 应被 normalize');
  assert.strictEqual(r.oldString, 'old');
  assert.strictEqual(r.newString, 'new');
  assert.strictEqual(r.content, 'full content');
  assert.strictEqual(r.type, 'startup');
  assert.strictEqual(r.agentId, 'agent-123');
  assert.strictEqual(r.agentType, 'artifact-writer');
  assert.strictEqual(r.lastMessage, 'done');
});

test('parseHookStdin — 相对 file_path 保持相对且正斜杠规范化', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: 'docs\\plans\\test.md' }
  }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.filePath, 'docs/plans/test.md');
});

test('parseHookStdin — POSIX 绝对 file_path 保持原样', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({
    tool_name: 'Read',
    tool_input: { file_path: '/mnt/k/AI/Paceflow-hooks/paceflow/task.md' }
  }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.filePath, '/mnt/k/AI/Paceflow-hooks/paceflow/task.md');
});

test('parseHookStdin — 空字符串 → ok:false + 全空字段', () => {
  const r = paceUtils.parseHookStdin('');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.toolName, '');
  assert.strictEqual(r.filePath, '');
  assert.strictEqual(r.oldString, '');
  assert.strictEqual(r.newString, '');
  assert.strictEqual(r.content, '');
  assert.strictEqual(r.type, '');
  assert.strictEqual(r.agentId, '');
  assert.strictEqual(r.agentType, '');
  assert.strictEqual(r.lastMessage, '');
});

test('parseHookStdin — 非 JSON → ok:false + 全空字段', () => {
  const r = paceUtils.parseHookStdin('not json {{{');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.toolName, '');
});

test('parseHookStdin — 部分字段缺失 → 默认值', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({ tool_name: 'Write' }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.toolName, 'Write');
  assert.strictEqual(r.filePath, '');
  assert.strictEqual(r.oldString, '');
  assert.deepStrictEqual(r.toolInput, {});
});

test('parseHookStdin — content 独立于 newString', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({
    tool_input: { content: 'write-content', new_string: 'edit-new' }
  }));
  assert.strictEqual(r.content, 'write-content');
  assert.strictEqual(r.newString, 'edit-new');
});

test('parseHookStdin — ok:true 时 raw 保留原始对象', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({ tool_input: { custom: 123 } }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.raw.tool_input.custom, 123);
});

// HOTFIX-20260315-05: CC SessionStart stdin 用 source 字段
test('parseHookStdin — source 字段映射到 type（CC SessionStart compact 事件）', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({ source: 'compact', session_id: 'abc' }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.type, 'compact', 'source 字段应映射到 type');
});

test('parseHookStdin — source 优先于 type（两者都存在时）', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({ source: 'compact', type: 'startup' }));
  assert.strictEqual(r.type, 'compact', 'source 应优先于 type');
});

test('parseHookStdin — subagent fields fallback', () => {
  const r = paceUtils.parseHookStdin(JSON.stringify({
    subagent_id: 'agent-1',
    subagent_type: 'paceflow:artifact-writer',
    last_assistant_message: '## artifact-writer 报告',
    agent_transcript_path: '/tmp/agent.jsonl',
    duration_ms: 123,
  }));
  assert.strictEqual(r.agentId, 'agent-1');
  assert.strictEqual(r.agentType, 'paceflow:artifact-writer');
  assert.strictEqual(r.lastMessage, '## artifact-writer 报告');
  assert.strictEqual(r.agentTranscriptPath, '/tmp/agent.jsonl');
  assert.strictEqual(r.durationMs, 123);
});

test('isArtifactWriterAgentType — 识别本地与命名空间 agent 类型', () => {
  assert.strictEqual(paceUtils.isArtifactWriterAgentType('artifact-writer'), true);
  assert.strictEqual(paceUtils.isArtifactWriterAgentType('paceflow:artifact-writer'), true);
  assert.strictEqual(paceUtils.isArtifactWriterAgentType('paceaitian-paceflow:artifact-writer'), true);
  assert.strictEqual(paceUtils.isArtifactWriterAgentType('code-reviewer'), false);
  assert.strictEqual(paceUtils.isArtifactWriterAgentType(''), false);
});

// ============================================================
// 16. extractOpenKeys() / normalizeFindingKey() — 5 个测试
// ============================================================
console.log('\n--- extractOpenKeys ---');

test('extractOpenKeys — 空文本返回空数组', () => {
  assert.deepStrictEqual(paceUtils.extractOpenKeys(''), []);
});

test('extractOpenKeys — 无 [ ] 项返回空数组', () => {
  const text = '- [x] 已完成项 — 结论\n- [-] 已跳过项 — 原因\n- [/] 进行中 — 说明';
  assert.deepStrictEqual(paceUtils.extractOpenKeys(text), []);
});

test('extractOpenKeys — 多项提取', () => {
  const text = '- [ ] knowledge 注入问题 — 结论\n- [x] 已完成 — ok\n- [ ] 指引体系补遗 — 结论2';
  const keys = paceUtils.extractOpenKeys(text);
  assert.strictEqual(keys.length, 2);
  assert.strictEqual(keys[0], 'knowledge 注入问题');
  assert.strictEqual(keys[1], '指引体系补遗');
});

test('extractOpenKeys — 全标题提取（无截断）', () => {
  const text = '- [ ] PACEflow 非常长的标题应该被截断 — 结论';
  const keys = paceUtils.extractOpenKeys(text);
  assert.strictEqual(keys.length, 1);
  assert.strictEqual(keys[0], 'paceflow 非常长的标题应该被截断');
});

test('extractOpenKeys — wikilink alias 归一化为精确标题 key', () => {
  const text = '- [ ] [[finding-2026-05-07-login|登录优化]] — 结论';
  const keys = paceUtils.extractOpenKeys(text);
  assert.deepStrictEqual(keys, ['登录优化']);
  assert.strictEqual(paceUtils.normalizeFindingKey('登录优化二期'), '登录优化二期');
});

// ============================================================
// 17. ARCHIVE_MARKER / ARCHIVE_PATTERN — 4 个测试
// ============================================================
console.log('\n--- ARCHIVE_MARKER / ARCHIVE_PATTERN ---');

test('ARCHIVE_MARKER 字符串值正确', () => {
  assert.strictEqual(paceUtils.ARCHIVE_MARKER, '<!-- ARCHIVE -->');
});

test('ARCHIVE_PATTERN 匹配独占行的 <!-- ARCHIVE -->', () => {
  const text = 'content\n<!-- ARCHIVE -->\nold stuff';
  const match = text.match(paceUtils.ARCHIVE_PATTERN);
  assert.ok(match, '应匹配');
  assert.strictEqual(match[0], '<!-- ARCHIVE -->');
});

test('ARCHIVE_PATTERN 匹配 CRLF 独占行的 <!-- ARCHIVE -->', () => {
  const text = 'content\r\n<!-- ARCHIVE -->\r\nold stuff';
  const match = text.match(paceUtils.ARCHIVE_PATTERN);
  assert.ok(match, 'CRLF 应匹配');
  assert.strictEqual(match[0], '<!-- ARCHIVE -->\r');
});

test('ARCHIVE_PATTERN 不匹配行内嵌入的标记', () => {
  const text = 'some text <!-- ARCHIVE --> more text';
  assert.ok(!paceUtils.ARCHIVE_PATTERN.test(text), '行内嵌入不应匹配');
});

// ============================================================
// 18. release sanity — 15 个测试
// ============================================================
console.log('\n--- release sanity ---');

test('plugin manifest 与 marketplace version 一致', () => {
  const repoRoot = path.join(__dirname, '..');
  const pluginManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
  const marketplace = JSON.parse(fs.readFileSync(path.join(repoRoot, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.strictEqual(
    pluginManifest.version,
    marketplace.plugins[0].version,
    'plugin manifest 和 marketplace version 必须一致'
  );
});

test('plugin runtime root 不包含开发资料', () => {
  const repoRoot = path.join(__dirname, '..');
  const pluginRoot = path.join(repoRoot, 'plugin');
  const allowedTopLevel = new Set(['.claude-plugin', 'agent-references', 'agents', 'hooks', 'migrate', 'skills']);
  for (const name of fs.readdirSync(pluginRoot)) {
    assert.ok(allowedTopLevel.has(name), `plugin runtime 顶层不应包含 ${name}`);
  }

  const disallowed = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(pluginRoot, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        rel.startsWith('docs/') ||
        rel.startsWith('tests/') ||
        rel.startsWith('internal/') ||
        rel.startsWith('config/') ||
        /^ticket.*\.md$/.test(path.basename(rel)) ||
        /(^|\/)(HOOKS-TEST|MEMORY|migrate-artifacts\.js)$/.test(rel)
      ) {
        disallowed.push(rel);
      }
    }
  }
  walk(pluginRoot);
  assert.deepStrictEqual(disallowed.sort(), [], `plugin runtime 不应包含开发资料: ${disallowed.join(', ')}`);
});

test('plugin runtime 文档不保留 create-chg 扫描分配旧语义', () => {
  const repoRoot = path.join(__dirname, '..');
  const pluginRoot = path.join(repoRoot, 'plugin');
  const stale = [];
  const forbidden = [
    /ID\s+由\s+`?artifact-writer create-chg`?\s+扫描\s+`?changes\/`?\s+后生成/,
    /CHG\/HOTFIX[^。\n]*扫描\s+`?changes\/`?[^。\n]*生成/,
    /create-chg[^。\n]*扫描\s+`?changes\/`?[^。\n]*分配/,
  ];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        const text = fs.readFileSync(full, 'utf8');
        if (forbidden.some(re => re.test(text))) {
          stale.push(path.relative(pluginRoot, full).split(path.sep).join('/'));
        }
      }
    }
  }
  walk(pluginRoot);
  assert.deepStrictEqual(stale.sort(), [], `plugin runtime 文档仍含旧编号语义: ${stale.join(', ')}`);
});

test('skills 明确 HOTFIX reserve helper 用法与 --new 边界', () => {
  const repoRoot = path.join(__dirname, '..');
  const files = [
    'plugin/skills/pace-workflow/SKILL.md',
    'plugin/skills/artifact-management/SKILL.md',
    'plugin/skills/pace-bridge/SKILL.md',
    'plugin/skills/artifact-management/references/change-lifecycle.md',
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.ok(text.includes('--operation create-chg --type hotfix'), `${rel} 应明确 HOTFIX 预留命令`);
    assert.ok(text.includes('--type hotfix --new'), `${rel} 应明确 HOTFIX 新编号复用边界`);
  }
});

test('artifact-management skill 明确 record-correction reserve helper 用法', () => {
  const repoRoot = path.join(__dirname, '..');
  const text = fs.readFileSync(path.join(repoRoot, 'plugin/skills/artifact-management/SKILL.md'), 'utf8');
  assert.ok(text.includes('--operation record-correction'), 'artifact-management 应明确 correction 预留命令');
  assert.ok(text.includes('reserved-file-prefix'), 'artifact-management 应要求带 reserved-file-prefix');
});

test('skills lifecycle 示例不遗漏 target/task-id 且表格不断裂', () => {
  const repoRoot = path.join(__dirname, '..');
  const workflow = fs.readFileSync(path.join(repoRoot, 'plugin/skills/pace-workflow/SKILL.md'), 'utf8');
  assert.ok(!workflow.includes('update-chg section=work-record action=append'), 'work-record 示例必须带 target');
  assert.ok(!workflow.includes('skill base directory'), 'workflow skill 应统一使用中文“skill 根目录”');

  const lifecycle = fs.readFileSync(path.join(repoRoot, 'plugin/skills/artifact-management/references/change-lifecycle.md'), 'utf8');
  assert.ok(lifecycle.includes('update-chg target=CHG-... section=tasks action=update-status task-id=T-NNN new-status=[!]'), '[!] 示例必须带 target/section/task-id/new-status');
  assert.ok(lifecycle.indexOf('| 取消 |') < lifecycle.indexOf('[ ] planned'), 'deferred 说明不应插入生命周期表格中间');

  const bridge = fs.readFileSync(path.join(repoRoot, 'plugin/skills/pace-bridge/SKILL.md'), 'utf8');
  assert.ok(!bridge.includes('skill base directory'), 'bridge skill 应统一使用中文“skill 根目录”');
});

test('artifact-writer prompt surface 覆盖 owner takeover 与 correction 字符口径', () => {
  const repoRoot = path.join(__dirname, '..');
  const writer = fs.readFileSync(path.join(repoRoot, 'plugin/agents/artifact-writer.md'), 'utf8');
  assert.ok(writer.includes('owner-takeover-confirmed: true'), 'artifact-writer 应提供 owner takeover 正向模板');
  assert.ok(writer.includes('owner-takeover-source: user-directive'));
  assert.ok(writer.includes('owner-takeover-evidence:'));
  assert.ok(!writer.includes('至少 20 字>'), 'record-correction 模板应统一为 20 字符');
});

test('artifact-writer create-chg 明确索引行边界与低成本验证口径', () => {
  const repoRoot = path.join(__dirname, '..');
  const createChg = fs.readFileSync(path.join(repoRoot, 'plugin/agent-references/instructions/create-chg.md'), 'utf8');
  const spec = fs.readFileSync(path.join(repoRoot, 'plugin/agent-references/artifact-writer-spec.md'), 'utf8');
  assert.ok(createChg.includes('索引插入契约'), 'create-chg 指令应给出正向索引插入契约');
  assert.ok(createChg.includes('新增索引行不会粘到上一行注释'), 'create-chg 指令应覆盖行边界失败模式');
  assert.ok(createChg.includes('^- \\[[ x/!-]\\] \\[\\[(chg|hotfix)-YYYYMMDD-NN\\]\\]'), 'create-chg 验证应检查行首格式');
  assert.ok(spec.includes('索引行必须独占一行，并从行首 `- [` 开始'), '通用 spec 应明确机械索引格式');
});

test('pace-utils 子模块可直接 require 且导出关键符号', () => {
  const repoRoot = path.join(__dirname, '..');
  const modules = {
    constants: ['PACE_VERSION', 'ARTIFACT_FILES', 'FORMAT_SNIPPETS'],
    'line-endings': ['normalizeLineEndings', 'hasNonNullVerifiedDate'],
    session: ['parseHookStdin', 'currentSessionId', 'isArtifactWriterAgentType'],
    'path-utils': ['normalizePath', 'resolveToolFilePath', 'resolveEffectiveProjectRoot', 'getProjectRuntimeDir'],
    logger: ['createLogger', 'logEntry'],
    plans: [],
    'change-id': ['normalizeChangeId', 'detailPathForId', 'slugForChangeId'],
    'change-analysis': [],
    locks: [],
  };
  for (const [name, symbols] of Object.entries(modules)) {
    const mod = require(path.join(repoRoot, 'plugin', 'hooks', 'pace-utils', name));
    assert.ok(mod, `${name} should require`);
    for (const symbol of symbols) {
      assert.ok(Object.prototype.hasOwnProperty.call(mod, symbol), `${name} should export ${symbol}`);
    }
  }
});

test('record-finding type 枚举不混入 correction', () => {
  const repoRoot = path.join(__dirname, '..');
  const files = [
    'plugin/agent-references/artifact-writer-spec.md',
    'plugin/agent-references/instructions/record-finding.md',
    'plugin/skills/artifact-management/SKILL.md',
  ];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    const recordFindingSection = text;
    assert.ok(recordFindingSection.includes('research | observation | comparison | bug-report'), `${rel} 应列出 finding type 枚举`);
    assert.ok(!/research \| observation \| comparison \| bug-report \| correction/.test(recordFindingSection), `${rel} 不应把 correction 混入 record-finding type`);
  }
});

test('用户 skills 显式链接现有 references 文档', () => {
  const repoRoot = path.join(__dirname, '..');
  const expectations = {
    'plugin/skills/pace-workflow/SKILL.md': ['references/superpowers-integration.md'],
    'plugin/skills/artifact-management/SKILL.md': ['references/format-reference.md', 'references/change-lifecycle.md'],
  };
  for (const [rel, refs] of Object.entries(expectations)) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    for (const ref of refs) {
      assert.ok(text.includes(`](${ref})`), `${rel} 应显式链接 ${ref}`);
    }
  }
});

test('CLAUDE.md 不承载 PACEflow workflow 或个人回复风格', () => {
  const repoRoot = path.join(__dirname, '..');
  const inner = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
  const outerPath = path.join(repoRoot, '..', 'CLAUDE.md');
  const candidates = [['inner', inner]];
  if (fs.existsSync(outerPath)) {
    candidates.push(['outer', fs.readFileSync(outerPath, 'utf8')]);
  }
  for (const [label, text] of candidates) {
    assert.ok(!text.includes('🐱'), `${label} CLAUDE.md 不应包含个人固定结尾`);
    assert.ok(!text.includes('每条回复开头'), `${label} CLAUDE.md 不应包含个人时间戳规则`);
    assert.ok(!text.includes('v6.0.34'), `${label} CLAUDE.md 不应保留旧版本号`);
  }
  assert.ok(inner.includes('不承担 artifact 创建、批准、验证、归档'), 'inner CLAUDE.md 应说明 workflow 权威不在 CLAUDE.md');
  if (fs.existsSync(outerPath)) {
    assert.ok(fs.readFileSync(outerPath, 'utf8').includes('此父目录不定义 PACEflow 运行规则'), 'outer CLAUDE.md 应成为 redirect');
  }
});

test('plugin agents 显式列表有维护说明', () => {
  const repoRoot = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'plugin', '.claude-plugin', 'plugin.json'), 'utf8'));
  const contributing = fs.readFileSync(path.join(repoRoot, 'CONTRIBUTING.md'), 'utf8');
  assert.deepStrictEqual(manifest.agents, ['./agents/artifact-writer.md']);
  assert.ok(contributing.includes('plugin/.claude-plugin/plugin.json'), 'CONTRIBUTING 应提示新增 agent 同步 manifest');
});

test('artifact-management 不保留旧 implementation_plan 详情模板别名', () => {
  const repoRoot = path.join(__dirname, '..');
  assert.ok(!fs.existsSync(path.join(repoRoot, 'plugin/skills/artifact-management/templates/change-implementation_plan.md')));
});

test('spec.md project-summary 与 knowledge summary 语义分离', () => {
  const repoRoot = path.join(__dirname, '..');
  const specTemplate = fs.readFileSync(path.join(repoRoot, 'plugin/hooks/templates/spec.md'), 'utf8');
  const knowledge = fs.readFileSync(path.join(repoRoot, 'plugin/skills/pace-knowledge/SKILL.md'), 'utf8');
  assert.ok(specTemplate.includes('project-summary:'));
  assert.ok(!/^summary:/m.test(specTemplate));
  assert.ok(knowledge.includes('项目元描述'));
});

test('v5 migration script 使用共享 artifact 常量', () => {
  assert.deepStrictEqual(MIGRATABLE_ARTIFACT_FILES, ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md']);
  const repoRoot = path.join(__dirname, '..');
  const script = fs.readFileSync(path.join(repoRoot, 'plugin', 'migrate', 'batch-archive-v5.js'), 'utf8');
  assert.ok(script.includes('MIGRATABLE_ARTIFACT_FILES'), '迁移脚本应引用 pace-utils 导出的迁移文件列表');
  assert.ok(!/const\s+ARTIFACT_FILES\s*=\s*\[/.test(script), '迁移脚本不得硬编码 ARTIFACT_FILES 数组');
});

// ============================================================
// 汇总 + 清理
// ============================================================
t.cleanup();

const total = t.passed + t.failed;
console.log(`\n${t.failed === 0 ? '\u2705' : '\u274c'} ${t.passed}/${total} tests passed`);
if (t.failed > 0) process.exit(1);
