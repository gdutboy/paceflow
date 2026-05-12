// PACEflow Hook E2E 测试（v6-only）
// 覆盖 v6 项目信号 changes/、详情文件任务权威、APPROVED/VERIFIED 详情位置。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'plugin', 'hooks');
const MIGRATE_SCRIPT = path.join(__dirname, '..', 'plugin', 'migrate', 'batch-archive-v5.js');
const RESERVE_HELPER = path.join(HOOKS_DIR, 'reserve-artifact-id.js');
const SYNC_PLAN_HELPER = path.join(HOOKS_DIR, 'sync-plan.js');
const { createTestRunner } = require('./test-utils');
const t = createTestRunner('pace-e2e');
const { test, makeTmpDir } = t;

const _origVaultPath = process.env.PACE_VAULT_PATH;
const _vaultTmpDir = path.join(os.tmpdir(), `pace-e2e-vault-${Date.now()}`);
fs.mkdirSync(path.join(_vaultTmpDir, 'projects'), { recursive: true });
process.env.PACE_VAULT_PATH = _vaultTmpDir;

function cleanupAll() {
  if (_origVaultPath === undefined) delete process.env.PACE_VAULT_PATH;
  else process.env.PACE_VAULT_PATH = _origVaultPath;
  try { fs.rmSync(_vaultTmpDir, { recursive: true, force: true }); } catch(e) {}
  t.cleanup();
}

function runHook(hookName, { cwd, stdin = {}, env = {} }) {
  const hookPath = path.resolve(HOOKS_DIR, hookName);
  try {
    const stdout = execFileSync('node', [hookPath], {
      cwd,
      input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
    });
    return { code: 0, stdout, stderr: '' };
  } catch(e) {
    return { code: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function runHookDetailed(hookName, { cwd, stdin = {}, env = {} }) {
  const hookPath = path.resolve(HOOKS_DIR, hookName);
  const r = spawnSync('node', [hookPath], {
    cwd,
    input: typeof stdin === 'string' ? stdin : JSON.stringify(stdin),
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
  return { code: r.status || 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runReserveHelper({ cwd, args = [], env = {} }) {
  const r = spawnSync('node', [RESERVE_HELPER, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
  return { code: r.status || 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runSyncPlanHelper({ cwd, args = [], env = {} }) {
  const r = spawnSync('node', [SYNC_PLAN_HELPER, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, ...env },
  });
  return { code: r.status || 0, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function slugFromId(id) {
  const lower = id.toLowerCase();
  if (lower.startsWith('chg-') || lower.startsWith('hotfix-')) return lower;
  if (id.startsWith('CHG-')) return `chg-${id.slice(4).toLowerCase()}`;
  if (id.startsWith('HOTFIX-')) return `hotfix-${id.slice(7).toLowerCase()}`;
  return lower;
}

function displayDirForAssert(dir, { normalized = false } = {}) {
  let value = String(dir || '').replace(/\\/g, '/').replace(/\/?$/, '/');
  if (normalized && process.platform === 'win32') value = value.toLowerCase();
  return value;
}

function reservedFromStdout(stdout) {
  let text = String(stdout || '');
  try {
    const parsed = JSON.parse(text);
    text = [
      parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecisionReason,
      parsed && parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext,
    ].filter(Boolean).join('\n');
  } catch(e) {}
  const id = (text.match(/reserved-id:\s*([A-Z]+-\d{8}-\d{2}|CORRECTION-\d{4}-\d{2}-\d{2}-\d{2})/) || [])[1] || '';
  const file = (text.match(/reserved-file:\s*([^\s；]+)/) || [])[1] || '';
  const prefix = (text.match(/reserved-file-prefix:\s*([^\s；<]+)(?:<slug>\.md)?/) || [])[1] || '';
  return { id, file, prefix };
}

function projectNameForDir(dir) {
  return path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function chgDetail({ id = 'CHG-20260504-01', status = 'in-progress', task = '[/]', tasks = null, approved = true, verified = false } = {}) {
  const completedDate = status === 'completed' || status === 'archived' ? `${today()}T12:00:00+08:00` : 'null';
  const verifiedDate = verified ? `${today()}T12:30:00+08:00` : 'null';
  const taskLines = tasks || [`- ${task} T-001 测试任务`];
  return [
    '---',
    `chg-id: ${id}`,
    `status: ${status}`,
    'date: 2026-05-04',
    'type: change',
    'parent-tasks: ["[[task]]"]',
    'parent-impl: ["[[implementation_plan]]"]',
    'related-finding: null',
    'aliases: []',
    'tags: []',
    'schema-version: "6.0"',
    `completed-date: ${completedDate}`,
    `verified-date: ${verifiedDate}`,
    'archived-date: null',
    '---',
    '',
    '# 测试变更',
    '',
    '## 任务清单',
    '',
    ...taskLines,
    '',
    approved ? '<!-- APPROVED -->' : '',
    verified ? '<!-- VERIFIED -->' : '',
    '',
    '## 实施详情',
    '',
    '**背景（Why）**：E2E 测试',
    '',
    '## 工作记录',
    '',
    '| 日期 | 完成内容 |',
    '| --- | --- |',
    '',
  ].filter((line, idx, arr) => line !== '' || arr[idx - 1] !== '').join('\n');
}

function makeV6Project(label, opts = {}) {
  const dir = makeTmpDir(label);
  fs.mkdirSync(path.join(dir, 'changes', 'findings'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'changes', 'corrections'), { recursive: true });
  const mark = opts.indexMark || '[/]';
  const index = opts.withIndex === false ? '' : `- ${mark} [[chg-20260504-01]] 测试变更 #change [tasks:: T-001]\n`;
  fs.writeFileSync(path.join(dir, 'task.md'), `# 项目任务追踪\n\n## 活跃任务\n\n${index}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), `# 实施计划\n\n## 变更索引\n\n${opts.implIndex === undefined ? index : opts.implIndex}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'walkthrough.md'), `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n${opts.walkToday === false ? '' : `| ${today()} | [[chg-20260504-01]] smoke | CHG-20260504-01 |\n`}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'findings.md'), '# 调研记录\n\n## 摘要索引\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'corrections.md'), '# Corrections 记录\n\n## 索引\n\n<!-- ARCHIVE -->\n', 'utf8');
  if (opts.detail !== false) {
    fs.writeFileSync(path.join(dir, 'changes', 'chg-20260504-01.md'), opts.detail || chgDetail(), 'utf8');
  }
  if (opts.paceRuntime) {
    fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
    for (const [name, content] of Object.entries(opts.paceRuntime)) {
      fs.writeFileSync(path.join(dir, '.pace', name), content, 'utf8');
    }
  }
  return dir;
}

function seedArtifactWriterLock(dir, sessionId = 'sid-artifact-writer-test') {
  const paceDir = path.join(dir, '.pace');
  fs.mkdirSync(paceDir, { recursive: true });
  fs.writeFileSync(path.join(paceDir, 'artifact-writer.lock'), JSON.stringify({
    sessionId,
    agentId: 'agent-test',
    artifactDir: dir,
    cwd: dir,
    operation: 'test',
    createdAt: new Date().toISOString(),
    timestampMs: Date.now(),
  }, null, 2) + '\n', 'utf8');
  return sessionId;
}

function safeLockName(value) {
  return encodeURIComponent(String(value || 'unknown')).replace(/%/g, '_');
}

function seedArtifactResourceLock(dir, resource, { sessionId = 'sid-resource-owner', agentId = 'agent-resource-owner', file = '' } = {}) {
  const lockDir = path.join(dir, '.pace', 'locks', 'artifacts');
  fs.mkdirSync(lockDir, { recursive: true });
  const lockPath = path.join(lockDir, `${safeLockName(resource)}.lock`);
  fs.writeFileSync(lockPath, JSON.stringify({
    version: 'resource-v1',
    resource,
    sessionId,
    agentId,
    ownerKey: agentId ? `agent:${agentId}` : `session:${sessionId}`,
    artifactDir: dir,
    cwd: dir,
    file,
    operation: 'test',
    createdAt: new Date().toISOString(),
    timestampMs: Date.now(),
  }, null, 2) + '\n', 'utf8');
  return lockPath;
}

function seedChangeOwner(dir, changeId, {
  sessionId = 'sid-other-owner',
  agentId = 'agent-other-owner',
  state = 'active',
  worktree = 'worktree-a',
  branch = 'branch-a',
  timestampMs = Date.now(),
} = {}) {
  const ownerDir = path.join(dir, '.pace', 'change-owners');
  fs.mkdirSync(ownerDir, { recursive: true });
  const fp = path.join(ownerDir, `${slugFromId(changeId)}.json`);
  fs.writeFileSync(fp, JSON.stringify({
    version: 'change-owner-v1',
    changeId,
    sessionId,
    agentId,
    ownerKey: agentId ? `agent:${agentId}` : `session:${sessionId}`,
    state,
    worktree,
    branch,
    timestampMs,
    updatedAt: new Date(timestampMs).toISOString(),
  }, null, 2) + '\n', 'utf8');
  return fp;
}

function makeVaultBackedWorktree(label) {
  const root = makeTmpDir(`${label}-root`);
  const projectName = `pace-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const host = path.join(root, projectName);
  const worktree = path.join(host, 'worktrees', 'smoke');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectName);
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'smoke')}\n`, 'utf8');
  fs.mkdirSync(path.join(vaultDir, 'changes', 'findings'), { recursive: true });
  fs.mkdirSync(path.join(vaultDir, 'changes', 'corrections'), { recursive: true });

  const index = '- [/] [[chg-20260504-01]] 测试变更 #change [tasks:: T-001]\n';
  fs.writeFileSync(path.join(vaultDir, 'task.md'), `# 项目任务追踪\n\n## 活跃任务\n\n${index}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(vaultDir, 'implementation_plan.md'), `# 实施计划\n\n## 变更索引\n\n${index}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(vaultDir, 'walkthrough.md'), '# 工作记录\n\n## 最近工作\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(vaultDir, 'findings.md'), '# 调研记录\n\n## 摘要索引\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(vaultDir, 'corrections.md'), '# Corrections 记录\n\n## 索引\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(vaultDir, 'changes', 'chg-20260504-01.md'), chgDetail(), 'utf8');
  return { worktree, vaultDir, projectName };
}

function makeV6ProjectWithChanges(label, changes, opts = {}) {
  const dir = makeV6Project(label, { withIndex: false, detail: false, walkToday: opts.walkToday });
  const lines = changes.map(c => {
    const id = c.id || 'CHG-20260504-01';
    const mark = c.indexMark || '[ ]';
    return `- ${mark} [[${slugFromId(id)}]] ${c.title || `变更 ${id}`} #change [tasks:: T-001]`;
  }).join('\n');
  const indexBlock = lines ? `${lines}\n` : '';
  fs.writeFileSync(path.join(dir, 'task.md'), `# 项目任务追踪\n\n## 活跃任务\n\n${indexBlock}\n<!-- ARCHIVE -->\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), `# 实施计划\n\n## 变更索引\n\n${indexBlock}\n<!-- ARCHIVE -->\n`, 'utf8');
  if (opts.walkToday !== false) {
    fs.writeFileSync(path.join(dir, 'walkthrough.md'), `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n| ${today()} | [[chg-20260504-01]] smoke | CHG-20260504-01 |\n<!-- ARCHIVE -->\n`, 'utf8');
  }
  for (const c of changes) {
    const id = c.id || 'CHG-20260504-01';
    fs.writeFileSync(
      path.join(dir, 'changes', `${slugFromId(id)}.md`),
      chgDetail({
        id,
        status: c.status || 'planned',
        task: c.task || '[ ]',
        tasks: c.tasks || null,
        approved: c.approved || false,
        verified: c.verified || false,
      }),
      'utf8'
    );
  }
  return dir;
}

function codeEditStdin(dir) {
  return { tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'src.js'), old_string: 'a', new_string: 'b' } };
}

function makeLegacyProject(label) {
  const dir = makeTmpDir(label);
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [ ] Legacy task\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'a.js'), 'console.log(1)\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.js'), 'console.log(2)\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'c.js'), 'console.log(3)\n', 'utf8');
  return dir;
}

console.log('\n--- session-start.js ---');

test('1. 非 PACE 项目静默放行', () => {
  const dir = makeTmpDir('ss-empty');
  const r = runHook('session-start.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('=== task.md ==='));
  assert.ok(!fs.existsSync(path.join(dir, '.pace')), '非 PACE 项目不应被 SessionStart 创建 .pace');
});

test('2. v6 artifact 注入 + 活跃 CHG 摘要', () => {
  const dir = makeV6Project('ss-v6');
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('=== task.md ==='));
  assert.ok(r.stdout.includes('=== corrections.md ==='));
  assert.ok(r.stdout.includes('=== 活跃 CHG 摘要 ==='));
  assert.ok(r.stdout.includes('CHG-20260504-01'));
});

test('2a. SessionStart 任务列表同步按详情 pending T-NNN 提示', () => {
  const dir = makeV6Project('ss-v6-detail-pending', {
    indexMark: '[/]',
    detail: chgDetail({ status: 'in-progress', task: '[/]', approved: true }),
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('当前执行中的 CHG 有 1 个未完成 T-NNN'));
});

test('2b. SessionStart 仅索引活跃但详情无 pending 时不夸大任务列表', () => {
  const dir = makeV6Project('ss-v6-index-only', {
    indexMark: '[x]',
    detail: chgDetail({ status: 'completed', task: '[x]', approved: true, verified: true }),
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('待 close-chg'));
  assert.ok(!r.stdout.includes('请为当前活跃 CHG 的未完成 T-NNN'));
});

test('2c. SessionStart 不把 planned backlog 任务计入当前任务列表', () => {
  const dir = makeV6ProjectWithChanges('ss-v6-backlog-only', [
    { id: 'CHG-20260504-01', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
    { id: 'CHG-20260504-02', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
  ]);
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('category=backlog'));
  assert.ok(!r.stdout.includes('当前执行中的 CHG 有 2 个未完成 T-NNN'));
  assert.ok(r.stdout.includes('当前没有执行中的未完成 T-NNN'));
});

test('2d. SessionStart 超大注入会在 50KB 前截断并给路径化提示', () => {
  const dir = makeV6Project('ss-output-guard');
  const huge = Array.from({ length: 1200 }, (_, i) => `- [ ] [[chg-20260504-99]] 超长任务 ${i} ${'x'.repeat(90)}`).join('\n');
  fs.writeFileSync(path.join(dir, 'task.md'), `# 项目任务追踪\n\n## 活跃任务\n\n${huge}\n<!-- ARCHIVE -->\n`, 'utf8');
  const r = runHookDetailed('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(Buffer.byteLength(r.stdout, 'utf8') < 50000, 'SessionStart 输出应低于 Claude Code 50KB 持久化阈值');
  assert.ok(r.stdout.includes('=== Artifact 目录 ==='), '关键 artifact_dir 路由应在大文件内容前注入');
  assert.ok(r.stdout.includes('SessionStart 输出截断'));
  assert.ok(r.stdout.includes('请按需 Read artifact 文件'));
});

test('2e. SessionStart walkthrough 截断保留最近日期记录', () => {
  const dir = makeV6Project('ss-walkthrough-recent', { walkToday: false });
  const rows = Array.from({ length: 12 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return `| 2026-05-${day} | smoke ${day} | CHG-20260504-01 |`;
  }).join('\n');
  fs.writeFileSync(path.join(dir, 'walkthrough.md'), `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n${rows}\n<!-- ARCHIVE -->\n`, 'utf8');
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('| 2026-05-12 | smoke 12 | CHG-20260504-01 |'));
  assert.ok(r.stdout.includes('| 2026-05-03 | smoke 03 | CHG-20260504-01 |'));
  assert.ok(!r.stdout.includes('| 2026-05-01 | smoke 01 | CHG-20260504-01 |'));
  assert.ok(!r.stdout.includes('| 2026-05-02 | smoke 02 | CHG-20260504-01 |'));
  assert.ok(r.stdout.indexOf('2026-05-12') < r.stdout.indexOf('2026-05-11'));
});

test('2f. SessionStart owner-aware：foreign running CHG 不计入当前任务列表', () => {
  const dir = makeV6ProjectWithChanges('ss-owner-aware-foreign-running', [{
    id: 'CHG-20260504-02',
    title: '外部 worktree 任务标题',
    indexMark: '[/]',
    status: 'in-progress',
    task: '[/]',
    approved: true,
  }]);
  seedChangeOwner(dir, 'CHG-20260504-02', {
    sessionId: 'sid-other-session',
    state: 'active',
    worktree: 'wt-a',
    branch: 'feature-a',
  });
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), fs.readFileSync(path.join(dir, 'implementation_plan.md'), 'utf8').replace(
    '<!-- ARCHIVE -->',
    '## 活跃变更详情\n\n### [[chg-20260504-02|外部详情别名]]\n\nforeign detail body\n\n<!-- ARCHIVE -->'
  ), 'utf8');
  const r = runHook('session-start.js', {
    cwd: dir,
    stdin: { type: 'startup', session_id: 'sid-current-session' },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('owner=foreign-fresh'));
  assert.ok(r.stdout.includes('其他 worktree/session 活跃 CHG'));
  assert.ok(r.stdout.includes('CHG-20260504-02'));
  assert.ok(r.stdout.includes('已折叠 1 个其他 worktree/session owner 的 CHG'));
  assert.ok(!r.stdout.includes('外部 worktree 任务标题'));
  assert.ok(!r.stdout.includes('foreign detail body'));
  assert.ok(!r.stdout.includes('当前执行中的 CHG 有 1 个未完成 T-NNN'));
});

test('3. compact 恢复显示 activeChanges', () => {
  const dir = makeV6Project('ss-compact', {
    paceRuntime: {
      'pre-compact-state.json': JSON.stringify({
        timestamp: '2026-05-04T10:00:00.000Z',
        artifacts: {},
        activeChanges: [{ id: 'CHG-20260504-01', status: 'in-progress', pending: 1, approved: true, verified: false }],
        runtime: { degraded: false },
      }),
    },
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'compact' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('Compact 恢复'));
  assert.ok(r.stdout.includes('活跃 CHG'));
  assert.ok(r.stdout.includes('CHG 完成检查'));
  assert.ok(r.stdout.includes('close-chg'));
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'pre-compact-state.json')), 'compact 恢复后应消费快照');
});

test('3a. SessionStart 清理每会话 .pace 运行态 flags', () => {
  const currentFindingsAgeFlag = `findings-age-${today()}`;
  const dir = makeV6Project('ss-session-flags', {
    paceRuntime: {
      'archive-reminded-chg-20260504-01': '1',
      'status-mismatch-chg-20260504-01': '1',
      'verify-missing-chg-20260504-01': '1',
      'blocked-tasks-chg-20260504-01': '1',
      'cli-refresh-done': '1',
      'task-list-used': '1',
      'findings-age-2000-01-01': '1',
      [currentFindingsAgeFlag]: '1',
    },
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'archive-reminded-chg-20260504-01')));
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'status-mismatch-chg-20260504-01')));
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'verify-missing-chg-20260504-01')));
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'blocked-tasks-chg-20260504-01')));
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'cli-refresh-done')));
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'task-list-used')));
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'findings-age-2000-01-01')), '历史 findings 去重 flag 应按日期清理');
  assert.ok(fs.existsSync(path.join(dir, '.pace', currentFindingsAgeFlag)), '当日 findings 去重 flag 不应按 session 清理');
});

console.log('\n--- pre-tool-use.js ---');

test('4. 非 PACE 项目放行', () => {
  const dir = makeTmpDir('ptu-empty');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('deny'));
});

test('5. v6 无活跃 CHG → DENY', () => {
  const dir = makeV6Project('ptu-no-active', { withIndex: false, detail: false });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('create-chg'));
  assert.ok(r.stdout.includes(`artifact_dir: ${dir.replace(/\\/g, '/')}/`));
  assert.ok(r.stdout.includes('operation: create-chg'));
});

test('6. v6 未批准 → DENY approve-and-start', () => {
  const dir = makeV6Project('ptu-unapproved', {
    indexMark: '[ ]',
    detail: chgDetail({ status: 'planned', task: '[ ]', approved: false }),
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('approve-and-start'));
});

test('7. v6 已批准但未 in-progress → DENY update-status', () => {
  const dir = makeV6Project('ptu-approved-planned', {
    indexMark: '[ ]',
    detail: chgDetail({ status: 'planned', task: '[ ]', approved: true }),
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('update-status'));
  assert.ok(r.stdout.includes('approve-and-start'));
});

test('8. v6 in-progress → additionalContext 放行', () => {
  const dir = makeV6Project('ptu-pass');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('additionalContext'));
  assert.ok(!r.stdout.includes('"deny"'));
});

test('8a. 当前 session owner 的非代码写入也必须先通过 C 阶段', () => {
  const dir = makeV6Project('ptu-current-owner-non-code-unapproved', {
    indexMark: '[ ]',
    detail: chgDetail({ status: 'planned', task: '[ ]', approved: false }),
  });
  seedChangeOwner(dir, 'CHG-20260504-01', {
    sessionId: 'sid-current-non-code',
    agentId: 'agent-current-non-code',
    state: 'active',
  });
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-current-non-code',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'README.md'),
        content: 'docs\n',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('C 阶段未完成'));
});

test('8b. 当前 session owner 的 in-progress 非代码写入放行并注入 CHG 摘要', () => {
  const dir = makeV6Project('ptu-current-owner-non-code-pass');
  seedChangeOwner(dir, 'CHG-20260504-01', {
    sessionId: 'sid-current-non-code-pass',
    agentId: 'agent-current-non-code-pass',
    state: 'active',
  });
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-current-non-code-pass',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'README.md'),
        content: 'docs\n',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('当前 v6 活跃变更'));
});

test('8c. foreign fresh owner 不阻断当前 session 普通非代码写入', () => {
  const dir = makeV6Project('ptu-foreign-owner-non-code-pass', {
    indexMark: '[ ]',
    detail: chgDetail({ status: 'planned', task: '[ ]', approved: false }),
  });
  seedChangeOwner(dir, 'CHG-20260504-01', {
    sessionId: 'sid-foreign-owner',
    agentId: 'agent-foreign-owner',
    state: 'active',
  });
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-current-other',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'README.md'),
        content: 'docs\n',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

test('8d. foreign owner 的结构损坏仍全局阻断非代码写入', () => {
  const dir = makeV6Project('ptu-foreign-owner-non-code-structure-deny', {
    detail: false,
  });
  seedChangeOwner(dir, 'CHG-20260504-01', {
    sessionId: 'sid-foreign-structure',
    agentId: 'agent-foreign-structure',
    state: 'active',
  });
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-current-structure',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'README.md'),
        content: 'docs\n',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('详情文件缺失'));
});

test('9. 主 session 直接写 VERIFIED → DENY artifact-writer 操作', () => {
  const dir = makeV6Project('ptu-marker');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '<!-- APPROVED -->',
        new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->',
      },
    },
  });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('对应批准或验证/收尾操作'));
});

test('9m. MultiEdit 直接写 VERIFIED → DENY artifact-writer 操作', () => {
  const dir = makeV6Project('ptu-marker-multiedit');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: fp,
        edits: [
          {
            old_string: '<!-- APPROVED -->',
            new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->',
          },
        ],
      },
    },
  });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('对应批准或验证/收尾操作'));
});

test('9m2. 非 artifact changes/ 路径写 C/V 字符串不触发 marker gate', () => {
  const dir = makeV6Project('ptu-marker-non-artifact-changes');
  const fp = path.join(dir, 'src', 'changes', 'chg-20260508-01.md');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, 'note\n', 'utf8');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: 'note',
        new_string: 'note\n<!-- VERIFIED -->',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(!r.stdout.includes('action=verify'));
});

test('9a. artifact-writer subagent 可写 APPROVED / VERIFIED 标志', () => {
  const dir = makeV6Project('ptu-marker-agent');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const sessionId = seedArtifactWriterLock(dir, 'sid-marker-agent');
  const approve = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: sessionId,
      agent_id: 'agent-test',
      agent_type: 'artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '## 实施详情',
        new_string: '<!-- APPROVED -->\n\n## 实施详情',
      },
    },
  });
  assert.strictEqual(approve.code, 0);
  assert.ok(!approve.stdout.includes('"deny"'));

  const verify = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: sessionId,
      agent_id: 'agent-test',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '<!-- APPROVED -->',
        new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->\nverified-date: 2026-05-06T12:00:00+08:00',
      },
    },
  });
  assert.strictEqual(verify.code, 0);
  assert.ok(!verify.stdout.includes('"deny"'));
});

test('9aa. 未知 subagent 仍不能写 APPROVED / VERIFIED 标志', () => {
  const dir = makeV6Project('ptu-marker-unknown-agent');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-other',
      agent_type: 'code-reviewer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '<!-- APPROVED -->',
        new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('artifact-writer'));
});

test('9ab. marker 日志包含 agent_id / agent_type', () => {
  const dir = makeV6Project('ptu-marker-agent-log');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const logFile = path.join(HOOKS_DIR, 'pace-hooks.log');
  const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';

  runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-marker-deny',
      agent_id: 'agent-log-deny',
      agent_type: 'code-reviewer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '<!-- APPROVED -->',
        new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->',
      },
    },
  });
  runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-marker-log',
      agent_id: 'agent-log-pass',
      agent_type: 'artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '<!-- APPROVED -->',
        new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->',
      },
    },
  });

  const after = fs.readFileSync(logFile, 'utf8');
  const projectLogLines = after.split('\n').filter(line => line.includes(path.basename(dir))).join('\n');
  const delta = projectLogLines || after.slice(before.length);
  assert.ok(delta.includes('act=DENY_V6_MARKER'));
  assert.ok(delta.includes('agent_id=agent-log-deny'));
  assert.ok(delta.includes('agent_type=code-reviewer'));
  assert.ok(delta.includes('act=PASS_V6_MARKER_AGENT'));
  assert.ok(delta.includes('agent_id=agent-log-pass'));
  assert.ok(delta.includes('agent_type=artifact-writer'));
});

test('9b. create-chg 首次预留编号后重派，写 verified-date null → 放行', () => {
  const dir = makeV6Project('ptu-create-null', { withIndex: false, detail: false });
  const prompt = `artifact_dir: ${dir.replace(/\\/g, '/')}/\noperation: create-chg\n使用 create-chg 流程创建一个新的变更记录。`;
  const first = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-create-null',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('"deny"'));
  const reserved = reservedFromStdout(first.stdout);
  assert.ok(reserved.id && reserved.file);

  const pre = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-create-null',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `${prompt}\nreserved-id: ${reserved.id}\nreserved-file: ${reserved.file}`,
      },
    },
  });
  assert.strictEqual(pre.code, 0);
  assert.ok(!pre.stdout.includes('"deny"'));
  const fp = path.join(dir, reserved.file);
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-create-null',
      agent_id: 'agent-create-null',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Write',
      tool_input: {
        file_path: fp,
        content: chgDetail({ status: 'planned', task: '[ ]', approved: false }),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

test('9b1. create-chg 写入非法 CHG status=open → DENY', () => {
  const dir = makeV6Project('ptu-create-invalid-status', { withIndex: false, detail: false });
  const prompt = `artifact_dir: ${dir.replace(/\\/g, '/')}/\noperation: create-chg\n使用 create-chg 流程创建一个新的变更记录。`;
  const first = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-create-invalid-status',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  const reserved = reservedFromStdout(first.stdout);
  assert.ok(reserved.id && reserved.file);
  const pre = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-create-invalid-status',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `${prompt}\nreserved-id: ${reserved.id}\nreserved-file: ${reserved.file}`,
      },
    },
  });
  assert.strictEqual(pre.code, 0);
  assert.ok(!pre.stdout.includes('"deny"'));
  const invalid = chgDetail({ status: 'planned', task: '[ ]', approved: false }).replace('status: planned', 'status: open');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-create-invalid-status',
      agent_id: 'agent-create-invalid-status',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, reserved.file),
        content: invalid,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('status 非法'));
});

test('9b2. artifact-writer 不得在根索引缺 ARCHIVE 时先归档详情', () => {
  const dir = makeV6Project('ptu-archive-marker-precheck');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [x] [[chg-20260504-01]] 测试变更 #change [tasks:: T-001]\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), '# Implementation Plan\n\n- [x] [[chg-20260504-01]] 测试变更 #change [tasks:: T-001]\n', 'utf8');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-archive-marker-precheck',
      agent_id: 'agent-archive-marker-precheck',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: 'status: completed',
        new_string: 'status: archived',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('缺少 ARCHIVE 标记'));
});

test('9c. native plan 桥接提示走 artifact writer', () => {
  const dir = makeTmpDir('ptu-native-plan');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.writeFileSync(path.join(dir, '.pace', 'current-native-plan'), path.join(dir, 'plan.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Native plan\n', 'utf8');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir), env: { PACE_VAULT_PATH: '' } });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('Skill(paceflow:pace-bridge)'));
  assert.ok(r.stdout.includes('同步标记'));
  assert.ok(!r.stdout.includes('Edit task.md'));
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'native plan deny 前应创建 v6 changes/ 基础目录');
});

test('9c1. 首次启用且 vault/local 都无 artifact → DENY 要求选择 artifact root', () => {
  const dir = makeTmpDir('ptu-artifact-root-choice');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('AskUserQuestion'));
  assert.ok(r.stdout.includes('Skill(paceflow:pace-workflow)'));
  assert.ok(r.stdout.includes('artifact-root'));
  assert.ok(r.stdout.includes('配置文件'), '应把 .pace/artifact-root 描述为配置文件');
  assert.ok(r.stdout.includes('不是 artifact 根目录'), '应明确配置文件不是 artifact 根目录');
  assert.ok(r.stdout.includes('不要直接重试代码写入'), '代码写入被拦后应先 create-chg + approve-and-start');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), '选择前不应在本地懒创建 changes/');
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), '选择前不应在 vault 懒创建 changes/');
});

test('9c2. artifact-root=local 后首次 DENY 会在本地懒创建模板', () => {
  const dir = makeTmpDir('ptu-artifact-root-local');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('已自动创建 Artifact 模板'));
  assert.ok(r.stdout.includes(`Artifact 根目录：${dir.replace(/\\/g, '/')}/`));
  assert.ok(r.stdout.includes('reserve-artifact-id.js'));
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'local 选择应在本地懒创建 changes/');
  assert.ok(fs.existsSync(path.join(dir, 'task.md')), 'local 选择应在本地创建 task.md');
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), 'local 选择不应在 vault 创建 changes/');
});

test('9c2a. PreToolUse 关键路径日志包含 artifact_dir 与 choice', () => {
  const dir = makeTmpDir('ptu-artifact-root-log');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const logFile = path.join(HOOKS_DIR, 'pace-hooks.log');
  const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('"deny"'));
  const after = fs.readFileSync(logFile, 'utf8');
  const delta = after.length >= before.length ? after.slice(before.length) : after;
  const routeLine = after.split('\n').find(line =>
    line.includes('PreToolUse') &&
    line.includes('act=ROUTE') &&
    line.includes(`artifact_dir=${dir.replace(/\\/g, '/')}/`) &&
    line.includes('choice=local')
  );
  assert.ok(routeLine, `应写入本次 artifact_dir route 日志；delta=${delta}`);
  assert.ok(routeLine.startsWith('['), '结构化日志字段不应因多行 reason 断裂');
});

test('9c3. SessionStart 首次启用只提示 skill，不询问、不自动创建模板', () => {
  const dir = makeTmpDir('ss-artifact-root-choice');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHookDetailed('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('Artifact 目录选择'), 'SessionStart 不应主动要求选择 artifact root');
	  assert.ok(!r.stdout.includes('AskUserQuestion'), '选择应推迟到 PreToolUse 阶段');
	  assert.ok(r.stdout.includes('Skill(paceflow:pace-workflow)'), 'SessionStart 应提示主 session 先读取 Paceflow workflow skill');
	  assert.ok(r.stdout.includes('reserve-artifact-id.js'), '首次 root-choice 提示也应给出当前版本 reserve helper 绝对路径');
	  assert.ok(r.stdout.includes('不要搜索 plugin cache'), '首次 root-choice 不应让模型搜索旧 plugin cache 猜版本');
	  assert.strictEqual(r.stderr, '', '非 git 项目不应泄漏 git fatal stderr');
  assert.ok(!fs.existsSync(path.join(dir, '.pace')), '选择前 SessionStart 不应创建 .pace 运行态目录');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), '选择前不应在本地懒创建 changes/');
  assert.ok(!fs.existsSync(vaultDir), '选择前不应在 Obsidian projects 下创建空项目目录');
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), '选择前不应在 vault 懒创建 changes/');
});

test('9c3b. code-count SessionStart 选择前不创建 .pace 或 Obsidian 空目录', () => {
  const dir = makeTmpDir('ss-code-count-root-choice');
  fs.writeFileSync(path.join(dir, 'a.js'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.js'), 'b\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'c.js'), 'c\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHookDetailed('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.pace')), 'code-count 首次 SessionStart 不应创建 .pace');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'code-count 首次 SessionStart 不应本地建模板');
  assert.ok(!fs.existsSync(vaultDir), 'code-count 首次 SessionStart 不应创建 Obsidian 空项目目录');
});

test('9c3c. worktree 继承宿主 local artifact-root 时 SessionStart 显示本地模式', () => {
  const root = makeTmpDir('ss-worktree-local-mode-root');
  const host = path.join(root, 'project-a');
  const worktree = path.join(root, 'project-a-wt');
  fs.mkdirSync(path.join(host, '.git', 'worktrees', 'project-a-wt'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'project-a-wt')}\n`, 'utf8');
  fs.mkdirSync(path.join(host, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(host, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.mkdirSync(path.join(host, 'changes', 'findings'), { recursive: true });
  fs.mkdirSync(path.join(host, 'changes', 'corrections'), { recursive: true });
  fs.writeFileSync(path.join(host, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(host, 'implementation_plan.md'), '# 实施计划\n\n## 变更索引\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(host, 'walkthrough.md'), '# 工作记录\n\n## 最近工作\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(host, 'findings.md'), '# 调研记录\n\n## 摘要索引\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(host, 'corrections.md'), '# Corrections 记录\n\n## 索引\n\n<!-- ARCHIVE -->\n', 'utf8');

  const r = runHookDetailed('session-start.js', { cwd: worktree, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes(`路径: ${host.replace(/\\/g, '/')}/`));
  assert.ok(r.stdout.includes('模式: 本地项目根目录'));
  assert.ok(!r.stdout.includes('模式: Obsidian vault project'));
  assert.ok(fs.existsSync(path.join(host, '.pace', 'stop-block-count')), 'SessionStart 运行态应写入宿主 .pace');
  assert.ok(!fs.existsSync(path.join(worktree, '.pace')), 'worktree 不应创建独立 .pace 运行态目录');
});

test('9c3a. artifact-root=local 的 SessionStart 不创建 Obsidian 空项目目录', () => {
  const dir = makeTmpDir('ss-artifact-root-local-no-vault-dir');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHookDetailed('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
	  assert.strictEqual(r.code, 0);
	  assert.ok(r.stdout.includes('=== PACEflow 工作流入口 ==='), 'artifact signal SessionStart 应靠前提示 workflow skill');
	  assert.ok(r.stdout.includes('=== Artifact 目录 ==='), 'local 模式也应注入 artifact 根目录');
  assert.ok(r.stdout.includes(`路径: ${dir.replace(/\\/g, '/')}/`));
  assert.ok(r.stdout.includes('仅用于 PaceFlow artifacts'));
  assert.ok(r.stdout.includes('sync-plan.js'), 'SessionStart 应提供 plan 同步 helper 绝对路径');
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'local 选择后 SessionStart 可在本地补齐模板');
  assert.ok(fs.existsSync(path.join(dir, 'task.md')), 'local 选择后 SessionStart 可在本地补齐 task.md');
  assert.ok(!fs.existsSync(vaultDir), 'local 选择不应创建 Obsidian 空项目目录');
});

test('9c4. code-count 首次触发也先要求选择 artifact root', () => {
  const dir = makeTmpDir('ptu-artifact-root-code-count');
  fs.writeFileSync(path.join(dir, 'a.js'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.js'), 'b\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: { tool_name: 'Write', tool_input: { file_path: path.join(dir, 'c.js'), content: 'c\n' } },
  });
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('AskUserQuestion'));
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), '选择前不应在本地懒创建 changes/');
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), '选择前不应在 vault 懒创建 changes/');
});

test('9c5. PACE_ARTIFACT_ROOT=local 自动化环境跳过询问并本地懒创建', () => {
  const dir = makeTmpDir('ptu-artifact-root-env-local');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: codeEditStdin(dir),
    env: { PACE_ARTIFACT_ROOT: 'local' },
  });
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(!r.stdout.includes('AskUserQuestion'));
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'env local 应在本地懒创建 changes/');
});

test('9c6. env scrub 场景仍可用项目级 artifact-root=local 恢复本地路由', () => {
  const dir = makeTmpDir('ss-env-scrub-local-choice');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const r = runHookDetailed('session-start.js', {
    cwd: dir,
    stdin: { type: 'startup' },
    env: { PACE_VAULT_PATH: '', CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('=== Artifact 目录 ==='));
  assert.ok(r.stdout.includes(`路径: ${dir.replace(/\\/g, '/')}/`));
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'scrub 环境下项目级 local 选择仍应创建本地 changes/');
});

test('9c7. artifact-root=vault 但 vault env 缺失时 fail-closed，不落本地模板', () => {
  const dir = makeTmpDir('ptu-vault-choice-missing-env');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');

  const start = runHookDetailed('session-start.js', {
    cwd: dir,
    stdin: { type: 'startup' },
    env: { PACE_VAULT_PATH: '' },
  });
  assert.strictEqual(start.code, 0);
  assert.ok(start.stdout.includes('PACEflow 配置错误'));
  assert.ok(!fs.existsSync(path.join(dir, 'task.md')), 'SessionStart 不应 fallback 到本地 artifact');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'SessionStart 不应本地建 changes/');

  const edit = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: codeEditStdin(dir),
    env: { PACE_VAULT_PATH: '' },
  });
  assert.strictEqual(edit.code, 0);
  assert.ok(edit.stdout.includes('"deny"'));
  assert.ok(edit.stdout.includes('PACE_VAULT_PATH'));
  assert.ok(!fs.existsSync(path.join(dir, 'task.md')), 'PreToolUse 不应 fallback 到本地 artifact');
});

test('9d. legacy v5 活跃项目只提示迁移或桥接', () => {
  const dir = makeLegacyProject('ptu-legacy');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir), env: { PACE_VAULT_PATH: '' } });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('v5 PACE artifact'));
  assert.ok(r.stdout.includes('PaceFlow artifact 根目录'));
  assert.ok(r.stdout.includes('migrate/batch-archive-v5.js'));
  assert.ok(r.stdout.includes('AskUserQuestion'));
  assert.ok(r.stdout.includes('--dry-run'));
  assert.ok(r.stdout.includes('请先用 AskUserQuestion 询问用户是否迁移'));
  assert.ok(r.stdout.includes('重试被阻止的原始工具调用'));
  assert.ok(r.stdout.includes('artifact-writer create-chg'));
  assert.ok(!r.stdout.includes('补齐实施详情'));
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'legacy v5 阶段不应懒创建 changes/');
});

test('9d1. vault 中 legacy v5 artifact 优先进入迁移提示，不先询问 artifact root', () => {
  const dir = makeTmpDir('ptu-legacy-vault');
  const projectName = projectNameForDir(dir);
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# Task\n\n- [ ] Legacy vault task\n\n<!-- ARCHIVE -->\n', 'utf8');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes(vaultDir.replace(/\\/g, '/')));
  assert.ok(r.stdout.includes('PaceFlow artifact 根目录'));
  assert.ok(r.stdout.includes('v5 PACE artifact'));
  assert.ok(r.stdout.includes('--dry-run'));
  assert.ok(r.stdout.includes('请先用 AskUserQuestion 询问用户是否迁移'));
  assert.ok(r.stdout.includes('必须再次使用 AskUserQuestion'));
  assert.ok(!r.stdout.includes('PACEflow 首次启用需要选择 artifact 存放位置'));
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), '迁移确认前不应在 vault 创建 changes/');
});

test('9d2. legacy v5 不允许用 Bash 手动创建 changes/ 绕过迁移', () => {
  const dir = makeTmpDir('ptu-legacy-vault-mkdir');
  const projectName = projectNameForDir(dir);
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# Task\n\n- [ ] Legacy vault task\n\n<!-- ARCHIVE -->\n', 'utf8');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Bash',
      tool_input: { command: `mkdir -p "${path.join(vaultDir, 'changes')}"` },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('PaceFlow artifact 根目录'));
  assert.ok(r.stdout.includes('禁止在用户确认前创建 changes/'));
  assert.ok(r.stdout.includes('--dry-run'));
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), '手动 mkdir changes/ 必须在 PreToolUse 被拦截');
});

test('9e. worktree 本地 CHG 详情写入 → DENY 并重定向到 vault', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('redirect-chg');
  const localFp = path.join(worktree, 'changes', 'chg-20260504-02.md');
  const expected = path.join(vaultDir, 'changes', 'chg-20260504-02.md').replace(/\\/g, '/');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: { tool_name: 'Write', tool_input: { file_path: localFp, content: '# local detail\n' } },
  });
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes(expected));
});

test('9f. worktree 本地 finding/correction 详情写入 → DENY 并重定向到 vault', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('redirect-subdetails');
  for (const rel of [
    'changes/findings/finding-2026-05-06-test.md',
    'changes/corrections/correction-2026-05-06-01-test.md',
  ]) {
    const localFp = path.join(worktree, rel);
    const expected = path.join(vaultDir, rel).replace(/\\/g, '/');
    const r = runHook('pre-tool-use.js', {
      cwd: worktree,
      stdin: { tool_name: 'Write', tool_input: { file_path: localFp, content: '# local detail\n' } },
    });
    assert.ok(r.stdout.includes('"deny"'), `${rel} should be denied`);
    assert.ok(r.stdout.includes(expected), `${rel} should point at vault`);
  }
});

test('9g. 主 session 写 vault 中的详情路径 → DENY artifact-writer-only', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('redirect-vault-pass');
  const fp = path.join(vaultDir, 'changes', 'chg-20260504-02.md');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: { tool_name: 'Write', tool_input: { file_path: fp, content: '# vault detail\n' } },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('禁止主 session/非 artifact-writer'));
});

test('9h. worktree 普通代码文件不触发 artifact 重定向', () => {
  const { worktree } = makeVaultBackedWorktree('redirect-code-pass');
  const r = runHook('pre-tool-use.js', { cwd: worktree, stdin: codeEditStdin(worktree) });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('DENY_REDIRECT'));
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('additionalContext'));
});

test('9ha. worktree 普通代码文件 MultiEdit 不触发 artifact 重定向', () => {
  const { worktree } = makeVaultBackedWorktree('redirect-code-multiedit-pass');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: path.join(worktree, 'src.js'),
        edits: [{ old_string: 'a', new_string: 'b' }],
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('DENY_REDIRECT'));
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('additionalContext'));
});

test('9ha1. worktree 中写宿主普通文件 → DENY，避免 artifact_dir 被当项目根', () => {
  const root = makeTmpDir('worktree-host-normal-write-root');
  const host = path.join(root, 'project-a');
  const worktree = path.join(root, 'project-a-wt');
  fs.mkdirSync(path.join(host, '.git', 'worktrees', 'project-a-wt'), { recursive: true });
  fs.mkdirSync(path.join(host, '.pace'), { recursive: true });
  fs.mkdirSync(path.join(host, 'changes'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(host, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'project-a-wt')}\n`, 'utf8');
  for (const file of ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md', 'corrections.md']) {
    fs.writeFileSync(path.join(host, file), `# ${file}\n\n<!-- ARCHIVE -->\n`, 'utf8');
  }
  const hostFile = path.join(host, 'branch-note.md');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: { tool_name: 'Write', tool_input: { file_path: hostFile, content: 'wrong checkout\n' } },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('DENY_WORKTREE_HOST_NON_ARTIFACT_WRITE') || r.stdout.includes('当前 cwd 是 worktree'));
  assert.ok(r.stdout.includes(path.join(worktree, 'branch-note.md').replace(/\\/g, '/')));
});

test('9haa. 首次 artifact-writer Agent 派遣前要求选择 artifact root', () => {
  const dir = makeTmpDir('agent-artifact-root-choice');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-agent-local-template',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: '使用 create-chg 流程创建一个新的变更记录。',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('AskUserQuestion'));
  assert.ok(r.stdout.includes('artifact-root'));
});

test('9haa1. legacy v5 存在时 artifact-writer 不得触发 v6 懒创建', () => {
  const dir = makeLegacyProject('agent-legacy-v5');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-agent-vault-template',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `artifact_dir: ${dir.replace(/\\/g, '/')}\n使用 create-chg 流程创建一个新的变更记录。`,
      },
    },
    env: { PACE_VAULT_PATH: '' },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('v5 PACE artifact'));
  assert.ok(r.stdout.includes('AskUserQuestion'));
  assert.ok(r.stdout.includes('重试被阻止的原始工具调用'));
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'legacy v5 上不得由 Agent path 懒创建 changes/');
});

test('9hab. artifact-root=local 后首次 create-chg Agent 创建模板并要求带 reserved-id 重派', () => {
  const dir = makeTmpDir('agent-artifact-root-local');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-agent-local-template',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `artifact_dir: ${dir.replace(/\\/g, '/')}\n使用 create-chg 流程创建一个新的变更记录。`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('reserved-id'));
  assert.ok(r.stdout.includes('Skill(paceflow:pace-workflow)'));
  assert.ok(r.stdout.includes('重派 artifact-writer'));
  assert.ok(r.stdout.includes('reserve-artifact-id.js'));
  assert.ok(r.stdout.includes(`artifact_dir: ${dir.replace(/\\/g, '/')}/`));
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'local agent 放行前应创建 changes/');
  assert.ok(fs.existsSync(path.join(dir, 'task.md')), 'local agent 放行前应创建 task.md');
  assert.ok(fs.existsSync(path.join(dir, 'implementation_plan.md')), 'local agent 放行前应创建 implementation_plan.md');
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), 'local 选择不应在 vault 创建 changes/');
});

test('9hab2. artifact-root=local 但 Agent prompt 写到 docs 子目录 → DENY', () => {
  const dir = makeTmpDir('agent-artifact-root-local-wrong-subdir');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-agent-vault-template',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `artifact_dir: ${dir.replace(/\\/g, '/')}/docs\n使用 create-chg 流程创建一个新的变更记录。`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('写错当前 artifact_dir'));
  assert.ok(r.stdout.includes(`artifact_dir: ${dir.replace(/\\/g, '/')}/`));
  assert.ok(r.stdout.includes(displayDirForAssert(path.join(dir, 'docs'), { normalized: true })));
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), '错误 artifact_dir 时不应先创建本地模板');
});

test('9hac. artifact-root=vault 后首次 create-chg Agent 创建 vault 模板并要求带 reserved-id 重派', () => {
  const dir = makeTmpDir('agent-artifact-root-vault');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const prompt = `artifact_dir: ${vaultDir.replace(/\\/g, '/')}/\n使用 create-chg 流程创建一个新的变更记录。`;
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-agent-vault-template',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('reserved-id'));
  assert.ok(r.stdout.includes('重派 artifact-writer'));
  assert.ok(r.stdout.includes(`artifact_dir: ${vaultDir.replace(/\\/g, '/')}/`));
  assert.ok(fs.existsSync(path.join(vaultDir, 'changes')), 'vault agent 放行前应创建 changes/');
  assert.ok(fs.existsSync(path.join(vaultDir, 'task.md')), 'vault agent 放行前应创建 task.md');
  assert.ok(fs.existsSync(path.join(vaultDir, 'implementation_plan.md')), 'vault agent 放行前应创建 implementation_plan.md');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'vault 选择不应在本地项目创建 changes/');
});

test('9hac2. artifact-root=vault 但 Agent prompt 写到 vault 子目录 → DENY', () => {
  const dir = makeTmpDir('agent-artifact-root-vault-wrong-subdir');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const prompt = `artifact_dir: ${vaultDir.replace(/\\/g, '/')}/docs\n使用 create-chg 流程创建一个新的变更记录。`;
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('写错当前 artifact_dir'));
  assert.ok(r.stdout.includes(`artifact_dir: ${vaultDir.replace(/\\/g, '/')}/`));
  assert.ok(r.stdout.includes(displayDirForAssert(path.join(vaultDir, 'docs'), { normalized: true })));
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), '错误 artifact_dir 时不应先创建 vault 模板');
});

test('9hb. artifact-writer Agent 未带 vault artifact_dir → DENY 重派', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('agent-artdir-deny');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: {
      session_id: 'sid-agent-artdir-pass',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: '使用 create-chg 流程创建一个新的变更记录，请创建 changes/<id>.md。',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('artifact_dir'));
  assert.ok(r.stdout.includes(vaultDir.replace(/\\/g, '/')));
});

test('9hc. artifact-writer create-chg 带 vault artifact_dir + reserved-id → 放行', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('agent-artdir-pass');
  const prompt = `artifact_dir: ${vaultDir.replace(/\\/g, '/')}/\n使用 create-chg 流程创建一个新的变更记录。`;
  const first = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: {
      session_id: 'sid-agent-artdir-pass',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('"deny"'));
  const reserved = reservedFromStdout(first.stdout);
  assert.ok(reserved.id && reserved.file);

  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: {
      session_id: 'sid-agent-artdir-pass',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `${prompt}\nreserved-id: ${reserved.id}\nreserved-file: ${reserved.file}`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
});

test('9hc-helper. reserve-artifact-id helper 预留 create-chg 后 Agent 首派即放行', () => {
  const dir = makeTmpDir('agent-reserve-helper-local');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const helper = runReserveHelper({
    cwd: dir,
    args: ['--operation', 'create-chg'],
    env: { CLAUDE_CODE_SESSION_ID: 'sid-helper-create' },
  });
  assert.strictEqual(helper.code, 0);
  assert.ok(helper.stdout.includes(`artifact_dir: ${dir.replace(/\\/g, '/')}/`));
  assert.ok(helper.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-01`));
  assert.ok(helper.stdout.includes(`reserved-file: changes/chg-${today().replace(/-/g, '')}-01.md`));
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'helper 应在 root 已选择后懒创建 changes/');
  assert.ok(fs.existsSync(path.join(dir, 'task.md')), 'helper 应在 root 已选择后懒创建 task.md');

  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-helper-create',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `${helper.stdout}\ntitle: helper smoke\ntasks:\n- T-001: do it`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
  assert.ok(r.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-01`));
  assert.ok(helper.stdout.includes('execution-context:'), 'helper 应输出 execution-context');
});

test('9hc-helper1a. reserve-artifact-id helper 遇到未知参数 fail-fast', () => {
  const dir = makeV6Project('agent-reserve-helper-unknown-arg', { withIndex: false, detail: false });
  const helper = runReserveHelper({
    cwd: dir,
    args: ['--operation', 'create-chg', '--project-dir', dir, '--artifact-root', 'local'],
    env: { CLAUDE_CODE_SESSION_ID: 'sid-helper-unknown-arg' },
  });
  assert.strictEqual(helper.code, 2);
  assert.ok(helper.stdout.includes('不支持参数：--project-dir, --artifact-root'));
  assert.ok(helper.stdout.includes('不要传 --artifact-dir / --artifact-root / --project-dir'));
  assert.ok(helper.stdout.includes('只可用 --cwd'));
});

test('9hc-helper1b. reserve-artifact-id helper 在最小 v5 fixture 中不创建 changes', () => {
  const dir = makeTmpDir('agent-reserve-helper-v5-minimal');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [ ] legacy item\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), '# Implementation Plan\n\n- [ ] legacy impl\n', 'utf8');
  const helper = runReserveHelper({
    cwd: dir,
    args: ['--operation', 'create-chg'],
    env: { CLAUDE_CODE_SESSION_ID: 'sid-helper-v5-minimal' },
  });
  assert.strictEqual(helper.code, 2);
  assert.ok(helper.stdout.includes('旧 v5 PACE artifact'));
  assert.strictEqual(fs.existsSync(path.join(dir, 'changes')), false);
});

test('9hc-helper2. reserve-artifact-id helper 默认复用未消费 reservation，--new 才分配新编号', () => {
  const dir = makeV6Project('agent-reserve-helper-reuse', { withIndex: false, detail: false });
  const env = { CLAUDE_CODE_SESSION_ID: 'sid-helper-reuse' };
  const first = runReserveHelper({ cwd: dir, args: ['--operation', 'create-chg'], env });
  const second = runReserveHelper({ cwd: dir, args: ['--operation', 'create-chg'], env });
  const third = runReserveHelper({ cwd: dir, args: ['--operation', 'create-chg', '--new'], env });
  assert.strictEqual(first.code, 0);
  assert.strictEqual(second.code, 0);
  assert.strictEqual(third.code, 0);
  assert.ok(first.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-01`));
  assert.ok(second.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-01`));
  assert.ok(second.stdout.includes('已复用当前 session 尚未消费的 reservation'));
  assert.ok(third.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-02`));
});

test('9hc-helper3. reserve-artifact-id helper 支持 record-correction prefix', () => {
  const dir = makeV6Project('agent-reserve-helper-correction', { withIndex: false, detail: false });
  const helper = runReserveHelper({
    cwd: dir,
    args: ['--operation', 'record-correction'],
    env: { CLAUDE_CODE_SESSION_ID: 'sid-helper-correction' },
  });
  assert.strictEqual(helper.code, 0);
  assert.ok(helper.stdout.includes(`reserved-id: CORRECTION-${today()}-01`));
  assert.ok(helper.stdout.includes(`reserved-file-prefix: changes/corrections/correction-${today()}-01-<slug>.md`));
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-helper-correction',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Record correction',
        prompt: `${helper.stdout}\ntrigger-quote: test\nwrong-behavior: wrong behavior details are long enough\ncorrect-behavior: correct behavior details are long enough\ntrigger-scenario: helper\nroot-cause: helper\nproject-scope: project-only`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

test('9hc-helper4. reserve-artifact-id helper 在 root 未选择时只提示选择，不落项目运行态', () => {
  const dir = makeTmpDir('agent-reserve-helper-root-choice');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  const helper = runReserveHelper({
    cwd: dir,
    args: ['--operation', 'create-chg'],
    env: { CLAUDE_CODE_SESSION_ID: 'sid-helper-choice' },
  });
  assert.strictEqual(helper.code, 2);
  assert.ok(helper.stdout.includes('PACEflow 首次启用需要选择 artifact 存放位置'));
  assert.ok(helper.stdout.includes('AskUserQuestion'));
  assert.ok(!fs.existsSync(path.join(dir, '.pace')), 'root 选择前 helper 不应创建项目 .pace/');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'root 选择前 helper 不应懒创建 changes/');
});

test('9hc-helper5. sync-plan helper 幂等写入单个 plan basename', () => {
  const dir = makeTmpDir('plan-sync-helper');
  const plan = path.join(dir, 'docs', 'plans', '2026-05-11-helper-smoke.md');
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, '# helper smoke\n', 'utf8');

  const help = runSyncPlanHelper({ cwd: dir, args: ['--help'] });
  assert.strictEqual(help.code, 0);
  assert.ok(help.stdout.includes(SYNC_PLAN_HELPER.replace(/\\/g, '/')), 'help 应展示可直接运行的绝对 helper 路径');

  const first = runSyncPlanHelper({ cwd: dir, args: ['--plan', plan] });
  const second = runSyncPlanHelper({ cwd: dir, args: ['--plan', plan] });
  assert.strictEqual(first.code, 0);
  assert.strictEqual(second.code, 0);
  assert.ok(first.stdout.includes('synced-plan: 2026-05-11-helper-smoke.md'));
  assert.ok(second.stdout.includes('plan 已经标记为同步'));

  const syncedPath = path.join(dir, '.pace', 'synced-plans');
  const lines = fs.readFileSync(syncedPath, 'utf8').trim().split('\n');
  assert.deepStrictEqual(lines, ['2026-05-11-helper-smoke.md']);
});

test('9hc-helper6. sync-plan helper 在 git worktree 写宿主 .pace/synced-plans', () => {
  const root = makeTmpDir('plan-sync-helper-worktree-root');
  const host = path.join(root, 'project-a');
  const worktree = path.join(root, 'project-a-wt');
  fs.mkdirSync(path.join(host, '.git', 'worktrees', 'project-a-wt'), { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'project-a-wt')}\n`, 'utf8');
  const plan = path.join(host, 'docs', 'plans', '2026-05-11-worktree-plan.md');
  fs.mkdirSync(path.dirname(plan), { recursive: true });
  fs.writeFileSync(plan, '# worktree plan\n', 'utf8');

  const r = runSyncPlanHelper({ cwd: worktree, args: ['--plan', plan] });
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(path.join(host, '.pace', 'synced-plans')), '应写宿主项目 runtime');
  assert.strictEqual(fs.readFileSync(path.join(host, '.pace', 'synced-plans'), 'utf8'), '2026-05-11-worktree-plan.md\n');
  assert.ok(!fs.existsSync(path.join(worktree, '.pace', 'synced-plans')), '不应写 worktree 自己的 runtime');
});

test('9hc-mismatch. create-chg 显式 reserved-id 与 hook reservation 不匹配 → DENY', () => {
  const dir = makeV6Project('agent-reserved-mismatch');
  const prompt = `artifact_dir: ${dir.replace(/\\/g, '/')}/\noperation: create-chg\n使用 create-chg 流程创建一个新的变更记录。`;
  const first = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-reserved-mismatch',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('"deny"'));
  assert.ok(first.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-01`));

  const staleId = `CHG-${today().replace(/-/g, '')}-99`;
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-reserved-mismatch',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `${prompt}\nreserved-id: ${staleId}\nreserved-file: changes/${staleId.toLowerCase()}.md`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('没有匹配的 hook reservation'));
  assert.ok(r.stdout.includes('不要手写或复用旧 session 的 reserved-id'));
});

test('9hc-correction. record-correction 首次预留 prefix 后重派 → 放行并允许写详情', () => {
  const dir = makeV6Project('agent-correction-reserved');
  const prompt = [
    `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
    'operation: record-correction',
    'trigger-quote: 用户纠正了实现',
    'wrong-behavior: 错误行为说明',
    'correct-behavior: 正确行为说明',
    'trigger-scenario: smoke',
    'root-cause: test',
    'project-scope: project-only',
  ].join('\n');
  const first = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-correction-reserved',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Record correction',
        prompt,
      },
    },
  });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('"deny"'));
  const reserved = reservedFromStdout(first.stdout);
  assert.ok(reserved.id && reserved.prefix);

  const pre = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-correction-reserved',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Record correction',
        prompt: `${prompt}\nreserved-id: ${reserved.id}\nreserved-file-prefix: ${reserved.prefix}<slug>.md`,
      },
    },
  });
  assert.strictEqual(pre.code, 0);
  assert.ok(!pre.stdout.includes('"deny"'));

  const write = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-correction-reserved',
      agent_id: 'agent-correction-reserved',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, `${reserved.prefix}smoke.md`),
        content: '# Correction: smoke\n',
      },
    },
  });
  assert.strictEqual(write.code, 0);
  assert.ok(!write.stdout.includes('"deny"'));
});

test('9hc0. artifact-writer Agent 首次派遣预留唯一 ID、要求重派且不持项目级锁', () => {
  const dir = makeV6Project('agent-artifact-lock');
  const prompt = `artifact_dir: ${dir.replace(/\\/g, '/')}/\noperation: create-chg\n使用 create-chg 流程创建一个新的变更记录。`;
  const first = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-lock-1',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('"deny"'));
  assert.ok(first.stdout.includes('重派 artifact-writer'));
  assert.ok(first.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-01`));
  const lockPath = path.join(dir, '.pace', 'artifact-writer.lock');
  assert.ok(!fs.existsSync(lockPath), '新版本 Agent 派遣不再创建项目级 artifact-writer.lock');

  const second = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-lock-2',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(second.code, 0);
  assert.ok(second.stdout.includes('"deny"'));
  assert.ok(second.stdout.includes('重派 artifact-writer'));
  assert.ok(second.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-02`));
});

test('9hc0w. 真实 git worktree 共享宿主 reservation/sequence 且并发派遣不互斥', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('agent-artifact-lock-worktree');
  const host = path.dirname(path.dirname(worktree));
  const sibling = path.join(host, 'worktrees', 'smoke-2');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, '.git'), `gitdir: ${path.join(host, '.git', 'worktrees', 'smoke-2')}\n`, 'utf8');
  const prompt = `artifact_dir: ${vaultDir.replace(/\\/g, '/')}/\noperation: create-chg\n使用 create-chg 流程创建一个新的变更记录。`;

  const first = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: {
      session_id: 'sid-wt-1',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('"deny"'));
  assert.ok(first.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-01`));
  assert.ok(!fs.existsSync(path.join(host, '.pace', 'artifact-writer.lock')), 'worktree 不再创建项目级 artifact-writer.lock');
  assert.ok(fs.existsSync(path.join(host, '.pace', 'sequences', safeLockName(`chg-${today().replace(/-/g, '')}`) + '.counter')), 'sequence counter 应落在宿主 .pace');

  const second = runHook('pre-tool-use.js', {
    cwd: sibling,
    stdin: {
      session_id: 'sid-wt-2',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(second.code, 0);
  assert.ok(second.stdout.includes('"deny"'));
  assert.ok(second.stdout.includes(`reserved-id: CHG-${today().replace(/-/g, '')}-02`));
});

test('9hc0a. SubagentStop 清理 artifact-writer 残留 resource lock/reservation', () => {
  const dir = makeV6Project('agent-artifact-lock-release');
  const lockPath = seedArtifactResourceLock(dir, 'detail:changes/chg-20260504-01.md', {
    sessionId: 'sid-release-1',
    agentId: 'agent-release-1',
    file: path.join(dir, 'changes', 'chg-20260504-01.md'),
  });
  fs.mkdirSync(path.join(dir, '.pace', 'reservations'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'reservations', `${safeLockName('agent:agent-release-1')}.json`), '{}\n', 'utf8');
  assert.ok(fs.existsSync(lockPath));

  const stop = runHook('subagent-stop.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-release-1',
      agent_id: 'agent-release-1',
      agent_type: 'paceflow:artifact-writer',
      last_assistant_message: '## artifact-writer 报告\n\n**状态**：SUCCESS\n',
    },
  });
  assert.strictEqual(stop.code, 0);
  assert.strictEqual(stop.stdout, '');
  assert.ok(!fs.existsSync(lockPath), 'SubagentStop 应释放同 owner 的 resource lock');
});

test('9hc0a2. PostToolUseFailure:Agent 清理 artifact-writer resource lock', () => {
  const dir = makeV6Project('agent-artifact-lock-agent-failure');
  const lockPath = seedArtifactResourceLock(dir, 'detail:changes/chg-20260504-01.md', {
    sessionId: 'sid-agent-failure',
    agentId: 'agent-failure-1',
    file: path.join(dir, 'changes', 'chg-20260504-01.md'),
  });
  assert.ok(fs.existsSync(lockPath), '测试前应存在 resource lock');

  const failure = runHook('post-tool-use-failure.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-agent-failure',
      agent_id: 'agent-failure-1',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: 'operation: create-chg',
      },
      error: 'Agent tool failed before subagent stop',
    },
  });
  assert.strictEqual(failure.code, 0);
  const out = JSON.parse(failure.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('Agent 执行失败'));
  assert.ok(!fs.existsSync(lockPath), 'Agent 工具失败时应清理 resource lock');
});

test('9hc0b. artifact-writer 新建 CHG 详情必须使用 hook 预留编号', () => {
  const dir = makeV6Project('agent-artifact-lock-write-deny');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-no-lock',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'changes', `chg-${today().replace(/-/g, '')}-01.md`),
        content: '# new detail\n',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('没有 hook 预留编号'));
});

test('9hc0b1. 主 session 不得用 Edit/MultiEdit 直接修改 artifact', () => {
  const dir = makeV6Project('direct-artifact-edit-deny');
  const cases = [
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, 'task.md'),
        old_string: '<!-- ARCHIVE -->',
        new_string: 'test\n<!-- ARCHIVE -->',
      },
    },
    {
      tool_name: 'MultiEdit',
      tool_input: {
        file_path: path.join(dir, 'implementation_plan.md'),
        edits: [
          {
            old_string: '<!-- ARCHIVE -->',
            new_string: 'test\n<!-- ARCHIVE -->',
          },
        ],
      },
    },
  ];

  for (const stdin of cases) {
    const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('"deny"'), `${stdin.tool_name} should be denied`);
    assert.ok(r.stdout.includes('禁止主 session/非 artifact-writer'), `${stdin.tool_name} should explain artifact-writer-only`);
    assert.ok(r.stdout.includes('Artifact 根目录'), `${stdin.tool_name} should include artifact root`);
  }
});

test('9hc0b1a. spec.md 不是 artifact-writer 管理对象，主 session 可 Edit', () => {
  const dir = makeV6Project('direct-spec-edit-pass');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, 'spec.md'),
        old_string: '[项目名称]',
        new_string: 'Smoke Project',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

test('9hc0b2. Bash 不得删除或重定向写入 artifact-writer.lock', () => {
  const dir = makeV6Project('agent-artifact-lock-bash-protect');
  const lockPath = path.join(dir, '.pace', 'artifact-writer.lock');
  seedArtifactWriterLock(dir, 'sid-lock-owner');

  const commands = [
    `rm -f "${lockPath}"`,
    'rm .pace//artifact-writer.lock',
    `echo "$$" > "${lockPath}"`,
    `node -e "require('fs').writeFileSync('${lockPath.replace(/\\/g, '/')}', 'bad')"`,
  ];
  for (const command of commands) {
    const r = runHook('pre-tool-use.js', {
      cwd: dir,
      stdin: {
        session_id: 'sid-other',
        tool_name: 'Bash',
        tool_input: { command },
      },
    });
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('"deny"'), `应阻止命令: ${command}`);
    assert.ok(r.stdout.includes('artifact 写入控制运行态'), `应说明 runtime 保护: ${command}`);
    assert.strictEqual(JSON.parse(fs.readFileSync(lockPath, 'utf8')).sessionId, 'sid-lock-owner');
  }
});

test('9hc0b3. Write/Edit 不得修改 artifact 写入控制运行态', () => {
  const dir = makeV6Project('agent-artifact-runtime-control-write-deny');
  const targets = [
    {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, '.pace', 'locks', 'artifacts', 'x.lock'),
        content: '{}\n',
      },
    },
    {
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, '.pace', 'reservations', 'session.json'),
        old_string: '{}',
        new_string: '{"bad":true}',
      },
    },
  ];
  fs.mkdirSync(path.join(dir, '.pace', 'reservations'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'reservations', 'session.json'), '{}', 'utf8');
  for (const stdin of targets) {
    const r = runHook('pre-tool-use.js', {
      cwd: dir,
      stdin: {
        session_id: 'sid-runtime-control',
        ...stdin,
      },
    });
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('"deny"'));
    assert.ok(r.stdout.includes('artifact 写入控制运行态'));
  }
});

test('9hc0c. artifact-writer 持有写锁时可新建 changes 详情，已有详情仍禁止 Write 覆盖', () => {
  const dir = makeV6Project('agent-artifact-lock-write-pass');
  const prompt = `artifact_dir: ${dir.replace(/\\/g, '/')}/\noperation: create-chg\n使用 create-chg 流程创建一个新的变更记录。`;
  const first = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-write-pass',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt,
      },
    },
  });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('"deny"'));
  const reserved = reservedFromStdout(first.stdout);
  assert.ok(reserved.id && reserved.file);

  const pre = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-write-pass',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `${prompt}\nreserved-id: ${reserved.id}\nreserved-file: ${reserved.file}`,
      },
    },
  });
  assert.strictEqual(pre.code, 0);
  assert.ok(!pre.stdout.includes('"deny"'));

  const writeNew = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-write-pass',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, reserved.file),
        content: '# new detail\n',
      },
    },
  });
  assert.strictEqual(writeNew.code, 0);
  assert.ok(!writeNew.stdout.includes('"deny"'));

  const overwriteExisting = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-write-pass',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, 'changes', 'chg-20260504-01.md'),
        content: '# overwrite\n',
      },
    },
  });
  assert.strictEqual(overwriteExisting.code, 0);
  assert.ok(overwriteExisting.stdout.includes('"deny"'));
  assert.ok(overwriteExisting.stdout.includes('禁止使用 Write 覆盖已有 artifact'));
});

test('9hc0d. artifact-writer 持有写锁时可 Edit 索引 artifact', () => {
  const dir = makeV6Project('agent-artifact-lock-edit-pass');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-edit-pass',
      agent_id: 'agent-edit-pass',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, 'task.md'),
        old_string: '测试变更',
        new_string: '测试变更',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

test('9hc1. approve-and-start 缺 approval-confirmed → DENY', () => {
  const dir = makeV6Project('agent-approve-confirm-missing');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Approve and start',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: update-chg',
          'target: CHG-20260504-01',
          'action: approve-and-start',
          'task-id: T-001',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('Skill(paceflow:pace-workflow)'));
  assert.ok(r.stdout.includes('approval-confirmed: true'));
});

test('9hc1a. approve-and-start 带确认字段 → 放行', () => {
  const dir = makeV6Project('agent-approve-confirm-ok');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Approve and start',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: update-chg',
          'target: CHG-20260504-01',
          'action: approve-and-start',
          'task-id: T-001',
          'approval-confirmed: true',
          'approval-source: user-directive',
          'approval-evidence: 用户说“开始执行这个方案”',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
});

test('9hc1a2. lifecycle prompt 字段支持等号与中文逗号分隔', () => {
  const dir = makeV6Project('agent-approve-confirm-equals');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Approve and start',
        prompt: [
          `artifact_dir=${dir.replace(/\\/g, '/')}/`,
          'operation=update-chg',
          'target=CHG-20260504-01',
          'action=approve-and-start，task-id=T-001',
          'approval-confirmed=true，approval-source=user-directive，approval-evidence=用户说开始执行',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
});

test('9hc1b. approve 缺 approval-confirmed/source/evidence → DENY', () => {
  const dir = makeV6Project('agent-approve-confirm-missing');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Approve only',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: update-chg',
          'target: CHG-20260504-01',
          'action: approve',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('approval-source'));
  assert.ok(r.stdout.includes('approval-evidence'));
});

test('9hc1c. approve 带开始语义 → DENY 要求 approve-and-start', () => {
  const dir = makeV6Project('agent-approve-start-intent');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Approve but start',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: update-chg',
          'target: CHG-20260504-01',
          'action: approve',
          'approval-confirmed: true',
          'approval-source: user-directive',
          'approval-evidence: 用户说“开始执行”',
          '写入 APPROVED，并将 status 改为 in-progress。',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('approve-and-start'));
});

test('9hc1d. approve 纯批准且带确认证据 → 放行', () => {
  const dir = makeV6Project('agent-approve-confirm-ok');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Approve only',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: update-chg',
          'target: CHG-20260504-01',
          'action: approve',
          'approval-confirmed: true',
          'approval-source: accepted-plan',
          'approval-evidence: 用户已确认方案，但要求稍后再开始。',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
});

test('9hc2. update-status 与 verify 串联 → DENY', () => {
  const dir = makeV6Project('agent-update-status-verify-chain');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Complete and verify',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: update-chg',
          'target: CHG-20260504-01',
          'action: update-status',
          'task-id: T-001',
          'new-status: x',
          '然后执行 verify 操作',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('不要把 update-status'));
  assert.ok(r.stdout.includes('close-chg complete-open-tasks: true'));
});

test('9hc3. close-chg 缺验证摘要字段 → DENY', () => {
  const dir = makeV6Project('agent-close-missing-fields');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Close CHG',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: close-chg',
          'target: CHG-20260504-01',
          'verification-confirmed: true',
          'verify-summary: node hello.js PASS',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('Skill(paceflow:pace-workflow)'));
  assert.ok(r.stdout.includes('walkthrough-summary'));
});

test('9hc3a. close-chg 缺 complete-open-tasks → DENY', () => {
  const dir = makeV6Project('agent-close-missing-complete-open');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Close CHG',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: close-chg',
          'target: CHG-20260504-01',
          'verification-confirmed: true',
          'verify-summary: node hello.js PASS',
          'walkthrough-summary: 创建 hello.js 并验证通过',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('complete-open-tasks: true'));
});

test('9hc4. close-chg 完整收尾 prompt → 放行', () => {
  const dir = makeV6Project('agent-close-complete');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Close CHG',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: close-chg',
          'target: CHG-20260504-01',
          'verification-confirmed: true',
          'complete-open-tasks: true',
          'verify-summary: node hello.js 输出 Hello World，PASS',
          'walkthrough-summary: 创建 hello.js 并验证通过',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
});

test('9hc4a. artifact-writer 不得接手其他 fresh session owner 的 CHG', () => {
  const dir = makeV6Project('agent-close-foreign-owner');
  seedChangeOwner(dir, 'CHG-20260504-01');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-current-owner',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Close CHG',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: close-chg',
          'target: CHG-20260504-01',
          'verification-confirmed: true',
          'complete-open-tasks: true',
          'verify-summary: node hello.js 输出 Hello World，PASS',
          'walkthrough-summary: 创建 hello.js 并验证通过',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('另一个 Claude Code session'));
});

test('9hc4b. update/close/archive 必须显式 target，不能从正文 CHG-ID 推断 owner', () => {
  const dir = makeV6Project('agent-target-required');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-target-required',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Update CHG without target',
        prompt: [
          `artifact_dir: ${dir.replace(/\\/g, '/')}/`,
          'operation: update-chg',
          'action: update-status',
          'task-id: T-001',
          'status: in-progress',
          'notes: 这里提到 CHG-20260504-01，但没有 target 字段。',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('缺少明确 target'));
});

test('9hc4c. 代码阶段工具调用刷新当前 session change owner heartbeat', () => {
  const dir = makeV6Project('owner-heartbeat-code-tool');
  const ownerPath = seedChangeOwner(dir, 'CHG-20260504-01', {
    sessionId: 'sid-heartbeat-code',
    agentId: 'agent-heartbeat-code',
    timestampMs: Date.now() - 60 * 60 * 1000,
  });
  const before = JSON.parse(fs.readFileSync(ownerPath, 'utf8')).timestampMs;
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-heartbeat-code',
      tool_name: 'Edit',
      tool_input: {
        file_path: path.join(dir, 'src.js'),
        old_string: 'a',
        new_string: 'b',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  const after = JSON.parse(fs.readFileSync(ownerPath, 'utf8')).timestampMs;
  assert.ok(after > before, 'owner timestamp should be refreshed by code-stage tool activity');
});

test('9hd. 非 artifact-writer Agent 不受 artifact_dir 约束', () => {
  const { worktree } = makeVaultBackedWorktree('agent-other-pass');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'code-reviewer',
        description: 'Review',
        prompt: '检查代码。',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

test('9he. Edit artifact 前自动把 CRLF 归一化为 LF', () => {
  const dir = makeV6Project('ptu-crlf-normalize');
  const fp = path.join(dir, 'walkthrough.md');
  const sessionId = seedArtifactWriterLock(dir, 'sid-crlf-normalize');
  fs.writeFileSync(fp, [
    '# 工作记录',
    '',
    '## 最近工作',
    '',
    '| 日期 | 完成内容 | 关联变更 |',
    '| --- | --- | --- |',
    '',
    '<!-- ARCHIVE -->',
    '',
  ].join('\r\n'), 'utf8');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: sessionId,
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '| --- | --- | --- |\n',
        new_string: `| --- | --- | --- |\n| ${today()} | [[chg-20260504-01]] smoke | CHG-20260504-01 |\n`,
      },
      agent_id: 'agent-1',
      agent_type: 'artifact-writer',
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  const after = fs.readFileSync(fp, 'utf8');
  assert.ok(!after.includes('\r'), 'artifact 应被归一化为 LF');
  assert.ok(after.includes('| --- | --- | --- |\n'), 'LF old_string 应能匹配归一化后的文件');
});

test('9hf. Bash 只读 artifact 放行', () => {
  const dir = makeV6Project('ptu-bash-read-artifact');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Bash',
      tool_input: {
        command: `grep -c "^<!-- ARCHIVE -->$" ${path.join(dir, 'walkthrough.md')}`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

test('9hfa. Bash 读取 artifact 并重定向到非 artifact 放行', () => {
  const dir = makeV6Project('ptu-bash-read-artifact-redirect');
  const commands = [
    `grep -c "ARCHIVE" ${path.join(dir, 'walkthrough.md')} > /tmp/paceflow-grep-count.txt`,
    `bash -c 'grep -c "ARCHIVE" task.md > /tmp/paceflow-grep-count.txt'`,
  ];
  for (const command of commands) {
    const r = runHook('pre-tool-use.js', {
      cwd: dir,
      stdin: {
        tool_name: 'Bash',
        tool_input: { command },
      },
    });
    assert.strictEqual(r.code, 0);
    assert.ok(!r.stdout.includes('"deny"'), `只读 artifact 命令应放行: ${command}`);
  }
});

test('9hg. Bash 修改 artifact 被拒绝', () => {
  const dir = makeV6Project('ptu-bash-write-artifact');
  const fp = path.join(dir, 'walkthrough.md');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Bash',
      tool_input: {
        command: `sed -i 's/\\r$//' ${fp}`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('禁止使用 Bash 修改 artifact'));
  assert.ok(r.stdout.includes('Artifact 根目录'));
});

test('9hga. Bash 重定向写 artifact 被拒绝', () => {
  const dir = makeV6Project('ptu-bash-redirect-artifact');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Bash',
      tool_input: {
        command: 'echo "# overwritten" > task.md',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('禁止使用 Bash 修改 artifact'));
  assert.ok(r.stdout.includes('Artifact 根目录'));
});

test('9hgb. Bash 修改 artifact 的等价路径也被拒绝', () => {
  const dir = makeV6Project('ptu-bash-write-artifact-normalized-path');
  const commands = [
    'rm .//task.md',
    'sed -i s/x/y/ .//task.md',
    'rm ./changes/../task.md',
  ];
  for (const command of commands) {
    const r = runHook('pre-tool-use.js', {
      cwd: dir,
      stdin: {
        tool_name: 'Bash',
        tool_input: { command },
      },
    });
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('"deny"'), `应阻止命令: ${command}`);
    assert.ok(r.stdout.includes('禁止使用 Bash 修改 artifact'));
  }
});

test('9hgc. Bash shell wrapper / package runner 修改 artifact 被拒绝', () => {
  const dir = makeV6Project('ptu-bash-wrapper-artifact');
  const commands = [
    `bash -c 'node -e "require(\\"fs\\").writeFileSync(\\"task.md\\",\\"x\\")"'`,
    `bash -c 'cat > task.md <<EOF\nx\nEOF'`,
    'npx prettier --write task.md',
    'npm run fix -- task.md',
  ];
  for (const command of commands) {
    const r = runHook('pre-tool-use.js', {
      cwd: dir,
      stdin: {
        tool_name: 'Bash',
        tool_input: { command },
      },
    });
    assert.strictEqual(r.code, 0);
    assert.ok(r.stdout.includes('"deny"'), `应阻止命令: ${command}`);
    assert.ok(r.stdout.includes('禁止使用 Bash 修改 artifact'));
  }
});

test('9hh. 懒创建模板写入 LF', () => {
  const dir = makeTmpDir('ptu-template-lf');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir) });
  assert.ok(r.stdout.includes('"deny"'));
  for (const file of ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md', 'corrections.md']) {
    const content = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!content.includes('\r'), `${file} 应为 LF`);
  }
});

test('9i. PACE 项目 malformed stdin → fail-closed deny', () => {
  const dir = makeV6Project('ptu-bad-stdin');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: 'not json {{{' });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('无法解析'));
});

test('9j. PACE 项目缺 file_path → fail-closed deny', () => {
  const dir = makeV6Project('ptu-missing-file-path');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: { tool_name: 'Write', tool_input: { content: 'x' } } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('file_path'));
});

test('9k. 非 PACE 项目 malformed stdin 保持低干扰', () => {
  const dir = makeTmpDir('ptu-bad-stdin-nonpace');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: 'not json {{{' });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
});

console.log('\n--- stop.js ---');

test('10. v6 未完成详情任务 → exit 2', () => {
  const dir = makeV6Project('stop-pending');
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('未完成任务'));
});

test('10a. 多任务 CHG 部分完成 → 继续执行，不提示 verify/close/archive', () => {
  const dir = makeV6Project('stop-partial-multitask', {
    walkToday: false,
    detail: chgDetail({
      status: 'in-progress',
      approved: true,
      tasks: [
        '- [x] T-001 已完成',
        '- [ ] T-002 待完成',
        '- [ ] T-003 待完成',
      ],
    }),
  });
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('还有 2 个未完成任务'));
  assert.ok(!r.stderr.includes('update-chg action=verify'));
  assert.ok(!r.stderr.includes('close-chg'));
  assert.ok(!r.stderr.includes('archive-chg'));
  assert.ok(!r.stderr.includes('walkthrough.md 缺少'), '执行中且仍有 pending task 时不应提前要求 walkthrough');
});

test('11. v6 completed 但未 verified → exit 2', () => {
  const dir = makeV6Project('stop-unverified', {
    indexMark: '[x]',
    detail: chgDetail({ status: 'completed', task: '[x]', approved: true, verified: false }),
  });
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('verify') || r.stderr.includes('VERIFIED') || r.stderr.includes('验证'));
  assert.ok(r.stderr.includes('close-chg'));
});

test('12. v6 completed + verified 仍活跃 → close-chg 优先阻止', () => {
  const dir = makeV6Project('stop-archive', {
    indexMark: '[x]',
    detail: chgDetail({ status: 'completed', task: '[x]', approved: true, verified: true }),
  });
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('close-chg'));
  assert.ok(r.stderr.includes('archive-chg'));
});

test('12a. Stop 跳过其他 fresh session owner 的待归档 CHG', () => {
  const dir = makeV6ProjectWithChanges('stop-foreign-owner-closing', [{
    id: 'CHG-20260504-02',
    indexMark: '[x]',
    status: 'completed',
    task: '[x]',
    approved: true,
    verified: true,
  }], { walkToday: false });
  seedChangeOwner(dir, 'CHG-20260504-02', { state: 'closing' });
  const r = runHook('stop.js', {
    cwd: dir,
    stdin: { session_id: 'sid-current-owner-check' },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stderr.includes('CHG-20260504-02'));
});

test('12b. Stop 对其他 stale session owner 的 running CHG 也不硬阻断当前 session', () => {
  const dir = makeV6ProjectWithChanges('stop-foreign-stale-running', [{
    id: 'CHG-20260504-03',
    indexMark: '[/]',
    status: 'in-progress',
    task: '[/]',
    approved: true,
  }], { walkToday: false });
  seedChangeOwner(dir, 'CHG-20260504-03', {
    state: 'active',
    timestampMs: Date.now() - 60 * 60 * 1000,
  });
  const r = runHook('stop.js', {
    cwd: dir,
    stdin: { session_id: 'sid-current-owner-check' },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stderr.includes('CHG-20260504-03'));
});

test('12c. Stop 不跳过其他 owner 的结构不一致 CHG', () => {
  const dir = makeV6ProjectWithChanges('stop-foreign-inconsistent', [{
    id: 'CHG-20260504-04',
    indexMark: '[/]',
    status: 'archived',
    task: '[x]',
    approved: true,
    verified: true,
  }], { walkToday: false });
  seedChangeOwner(dir, 'CHG-20260504-04', { state: 'active' });
  const r = runHook('stop.js', {
    cwd: dir,
    stdin: { session_id: 'sid-current-owner-check' },
  });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('CHG-20260504-04'));
  assert.ok(r.stderr.includes('索引仍在活跃区'));
});

test('13. v6 索引不一致 → exit 2', () => {
  const dir = makeV6Project('stop-mismatch', { implIndex: '' });
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('不一致'));
});

test('14. .pace/disabled → exit 0', () => {
  const dir = makeV6Project('stop-disabled', { paceRuntime: { disabled: '1' } });
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
});

test('14b. legacy v5 Stop 只提示迁移或桥接', () => {
  const dir = makeLegacyProject('stop-legacy');
  const r = runHook('stop.js', { cwd: dir, stdin: { stop_hook_active: false }, env: { PACE_VAULT_PATH: '' } });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('旧 v5 PACE artifact'));
  assert.ok(r.stderr.includes('PaceFlow artifact 根目录'));
  assert.ok(r.stderr.includes('Artifact 根目录'));
  assert.ok(r.stderr.includes('AskUserQuestion'));
  assert.ok(r.stderr.includes('migrate/batch-archive-v5.js'));
  assert.ok(r.stderr.includes('artifact-writer create-chg'));
  assert.ok(r.stderr.includes('重试被阻止的原始工具调用'));
  assert.ok(!r.stderr.includes('补齐实施详情'));
});

test('14b2. code-count 项目 idle Stop 不阻止 artifact-root 选择', () => {
  const dir = makeTmpDir('stop-code-count-idle');
  fs.writeFileSync(path.join(dir, 'a.js'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.js'), 'b\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'c.js'), 'c\n', 'utf8');
  const r = runHook('stop.js', { cwd: dir, stdin: { stop_hook_active: false, last_assistant_message: '你好' } });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stderr, '');
  assert.ok(!fs.existsSync(path.join(dir, '.pace')), 'idle Stop 不应创建 .pace 运行态目录');
});

test('14b3. Stop 连续阻止时即使 .pace 缺失也能累计并降级', () => {
  const dir = makeV6Project('stop-downgrade-without-runtime');
  let last;
  for (let i = 0; i < 4; i++) {
    last = runHook('stop.js', { cwd: dir, stdin: { stop_hook_active: false, last_assistant_message: '任务完成' } });
  }
  assert.strictEqual(last.code, 0, '第 4 次应降级放行');
  assert.ok(fs.existsSync(path.join(dir, '.pace', 'degraded')), '降级时应写 degraded 标记');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.pace', 'stop-block-count'), 'utf8'), '0');
});

test('14c. 多 CHG backlog 不阻止 Stop', () => {
  const dir = makeV6ProjectWithChanges('stop-backlog-only', [
    { id: 'CHG-20260504-01', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
    { id: 'CHG-20260504-02', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
    { id: 'CHG-20260504-03', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
});

test('14d. 多 CHG 中仅 running 阻止，planned backlog 不阻止', () => {
  const dir = makeV6ProjectWithChanges('stop-running-with-backlog', [
    { id: 'CHG-20260504-01', indexMark: '[/]', status: 'in-progress', task: '[/]', approved: true },
    { id: 'CHG-20260504-02', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
    { id: 'CHG-20260504-03', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('CHG-20260504-01'));
  assert.ok(!r.stderr.includes('CHG-20260504-02'));
  assert.ok(!r.stderr.includes('CHG-20260504-03'));
});

test('14e. 多 CHG 中 completed 必须 close/archive，planned backlog 不阻止', () => {
  const dir = makeV6ProjectWithChanges('stop-completed-with-backlog', [
    { id: 'CHG-20260504-01', indexMark: '[x]', status: 'completed', task: '[x]', approved: true, verified: true },
    { id: 'CHG-20260504-02', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
    { id: 'CHG-20260504-03', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('CHG-20260504-01'));
  assert.ok(r.stderr.includes('close-chg'));
  assert.ok(!r.stderr.includes('CHG-20260504-02'));
  assert.ok(!r.stderr.includes('CHG-20260504-03'));
});

test('14f. approved planned backlog 不阻止 Stop', () => {
  const dir = makeV6ProjectWithChanges('stop-ready-backlog', [
    { id: 'CHG-20260504-01', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: true },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
});

test('14g. 索引 [x] 但 status in-progress → inconsistent 阻止修复', () => {
  const dir = makeV6ProjectWithChanges('stop-x-status-mismatch', [
    { id: 'CHG-20260504-01', indexMark: '[x]', status: 'in-progress', task: '[x]', approved: true },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('索引已是 [x]'));
  assert.ok(r.stderr.includes('status=in-progress'));
});

test('14h. status archived 但索引仍在活跃区 → inconsistent 阻止修复', () => {
  const dir = makeV6ProjectWithChanges('stop-active-archived', [
    { id: 'CHG-20260504-01', indexMark: '[x]', status: 'archived', task: '[x]', approved: true, verified: true },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('已 archived'));
  assert.ok(r.stderr.includes('仍在活跃区'));
  assert.ok(r.stderr.includes('close-chg'));
});

test('14i. [-] 或 cancelled 仍在活跃区 → inconsistent 阻止修复', () => {
  const dir = makeV6ProjectWithChanges('stop-active-cancelled', [
    { id: 'CHG-20260504-01', indexMark: '[-]', status: 'cancelled', task: '[-]', approved: true },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('已取消'));
  assert.ok(r.stderr.includes('仍在活跃区'));
});

test('14j. in-progress 详情没有 T-NNN 任务行 → inconsistent 阻止修复', () => {
  const dir = makeV6ProjectWithChanges('stop-empty-task-list', [
    { id: 'CHG-20260504-01', indexMark: '[/]', status: 'in-progress', tasks: ['- [ ] 不是 T 编号任务'], approved: true },
  ]);
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('没有可识别的 T-NNN'));
});

test('14k. Stop 机械检查 walkthrough wikilink 指向详情文件', () => {
  const dir = makeV6Project('stop-walkthrough-bad-link', { withIndex: false });
  fs.writeFileSync(path.join(dir, 'walkthrough.md'), [
    '# 工作记录',
    '',
    '## 最近工作',
    '',
    '| 日期 | 完成内容 | 关联变更 |',
    '| --- | --- | --- |',
    `| ${today()} | [[title-slug]] smoke | CHG-20260504-01 |`,
    '<!-- ARCHIVE -->',
    '',
  ].join('\n'), 'utf8');
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('wikilink 应为 [[chg-20260504-01]]'));
});

test('14k1. Stop 机械检查 walkthrough 行必须含详情 wikilink', () => {
  const dir = makeV6Project('stop-walkthrough-missing-link', { withIndex: false });
  fs.writeFileSync(path.join(dir, 'walkthrough.md'), [
    '# 工作记录',
    '',
    '## 最近工作',
    '',
    '| 日期 | 完成内容 | 关联变更 |',
    '| --- | --- | --- |',
    `| ${today()} | smoke without link | CHG-20260504-01 |`,
    '<!-- ARCHIVE -->',
    '',
  ].join('\n'), 'utf8');
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('缺少 wikilink，应为 [[chg-20260504-01]]'));
});

test('14k2. Stop 机械检查 walkthrough 同步 worktree/branch 上下文', () => {
  const dir = makeV6Project('stop-walkthrough-missing-context', { withIndex: false });
  const indexRow = '- [x] [[chg-20260504-01]] 测试变更 #change [tasks:: T-001] [worktree:: smoke] [branch:: feature-x]';
  fs.writeFileSync(path.join(dir, 'task.md'), `# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n${indexRow}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), `# 实施计划\n\n## 变更索引\n\n<!-- ARCHIVE -->\n${indexRow}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'walkthrough.md'), [
    '# 工作记录',
    '',
    '## 最近工作',
    '',
    '| 日期 | 完成内容 | 关联变更 |',
    '| --- | --- | --- |',
    `| ${today()} | [[chg-20260504-01]] smoke | CHG-20260504-01 |`,
    '<!-- ARCHIVE -->',
    '',
  ].join('\n'), 'utf8');
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('缺少执行上下文 [worktree:: smoke] [branch:: feature-x]'));
});

console.log('\n--- post-tool-use.js ---');

test('15. v6 schema 缺 verified-date → warning', () => {
  const detail = chgDetail().replace('verified-date: null\n', '');
  const dir = makeV6Project('post-schema', { detail });
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('post-tool-use.js', { cwd: dir, stdin: { tool_name: 'Edit', tool_input: { file_path: fp, old_string: 'a', new_string: 'b' } } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('verified-date'));
});

test('15a. PostToolUse 对 artifact-writer 合法 C/V 标志写入不报直接写入', () => {
  const dir = makeV6Project('post-marker-agent');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-post-marker',
      agent_type: 'paceaitian-paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '<!-- APPROVED -->',
        new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->\nverified-date: 2026-05-06T12:00:00+08:00',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('C/V 阶段标志被直接写入'));
});

test('15b. PostToolUse 对非 artifact-writer C/V 标志写入仍提醒', () => {
  const dir = makeV6Project('post-marker-direct');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-post-other',
      agent_type: 'code-reviewer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '<!-- APPROVED -->',
        new_string: '<!-- APPROVED -->\n<!-- VERIFIED -->',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('C/V 阶段标志被直接写入'));
  assert.ok(r.stdout.includes('artifact-writer'));
});

test('15c. artifact-writer 顺序编辑索引时不提示瞬时不一致', () => {
  const dir = makeV6Project('post-index-transient', { implIndex: '' });
  const fp = path.join(dir, 'task.md');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-post-index',
      agent_type: 'paceaitian-paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '## 活跃任务',
        new_string: '## 活跃任务',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('索引不一致'));
});

test('15d. 非 artifact-writer 索引不一致仍提示', () => {
  const dir = makeV6Project('post-index-mismatch-direct', { implIndex: '' });
  const fp = path.join(dir, 'task.md');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-post-index-other',
      agent_type: 'code-reviewer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '## 活跃任务',
        new_string: '## 活跃任务',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('索引不一致'));
});

test('15e. 写入 .pace/artifact-root 不触发无任务流程提醒', () => {
  const dir = makeTmpDir('post-runtime-config-artifact-root');
  fs.writeFileSync(path.join(dir, 'a.js'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.js'), 'b\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'c.js'), 'c\n', 'utf8');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Write',
      tool_input: {
        file_path: path.join(dir, '.pace', 'artifact-root'),
        content: 'local\n',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

test('15e1. Superpowers plan 存在但普通 docs/audits Edit 不触发 PostToolUse 创建 artifact 提醒', () => {
  const dir = makeTmpDir('post-superpowers-doc-edit-silent');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'audits'), { recursive: true });
  const fp = path.join(dir, 'docs', 'audits', 'audit.md');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-05-11-plan.md'), '# Plan\n', 'utf8');
  fs.writeFileSync(fp, '# Audit\n', 'utf8');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '# Audit',
        new_string: '# Audit\n\nUpdated',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

test('15f. PostToolUse 同一 CHG 状态提醒每会话只提示一次', () => {
  const dir = makeV6Project('post-entry-warning-once', {
    indexMark: '[x]',
    detail: chgDetail({ status: 'completed', task: '[x]', approved: true, verified: false }),
  });
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const stdin = {
    tool_name: 'Edit',
    tool_input: {
      file_path: fp,
      old_string: '## 工作记录',
      new_string: '## 工作记录',
    },
  };
  const first = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(first.code, 0);
  assert.ok(first.stdout.includes('缺少 verified-date'));

  const second = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(second.code, 0);
  assert.ok(!second.stdout.includes('缺少 verified-date'));
});

test('15f1. artifact-writer 多步收尾中间态不输出状态类 warning', () => {
  const dir = makeV6Project('post-entry-warning-agent-silent', {
    indexMark: '[x]',
    detail: chgDetail({ status: 'completed', task: '[x]', approved: true, verified: false }),
  });
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-close-midstate',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: '## 工作记录',
        new_string: '## 工作记录',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('缺少 verified-date'));
});

test('15f2. PostToolUse:Agent close/archive 只有目标已离开活跃索引才标记 owner closed', () => {
  const dir = makeV6Project('post-agent-close-owner-still-active', {
    indexMark: '[x]',
    detail: chgDetail({ status: 'completed', task: '[x]', approved: true, verified: true }),
  });
  const ownerPath = seedChangeOwner(dir, 'CHG-20260504-01', {
    sessionId: 'sid-close-owner',
    agentId: 'agent-close-owner',
    state: 'closing',
  });
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-close-owner',
      agent_id: 'agent-close-owner',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        prompt: [
          'operation: close-chg',
          'target: CHG-20260504-01',
          'verification-confirmed: true',
          'complete-open-tasks: true',
          'verify-summary: pass',
          'walkthrough-summary: done',
        ].join('\n'),
      },
    },
  });
  assert.strictEqual(r.code, 0);
  const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  assert.strictEqual(owner.state, 'closing');
});

test('15g. walkthrough wikilink 必须指向 CHG/HOTFIX 详情 slug', () => {
  const dir = makeV6Project('post-walkthrough-bad-link', { withIndex: false });
  const fp = path.join(dir, 'walkthrough.md');
  fs.writeFileSync(fp, [
    '# 工作记录',
    '',
    '## 最近工作',
    '',
    '| 日期 | 完成内容 | 关联变更 |',
    '| --- | --- | --- |',
    `| ${today()} | [[title-slug]] smoke | CHG-20260504-01 |`,
    '<!-- ARCHIVE -->',
    '',
  ].join('\n'), 'utf8');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-walkthrough',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: 'smoke',
        new_string: 'smoke',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('wikilink 应为 [[chg-20260504-01]]'));
});

test('15g1. walkthrough 行缺少 wikilink 时 PostToolUse 提醒', () => {
  const dir = makeV6Project('post-walkthrough-missing-link', { withIndex: false });
  const fp = path.join(dir, 'walkthrough.md');
  fs.writeFileSync(fp, [
    '# 工作记录',
    '',
    '## 最近工作',
    '',
    '| 日期 | 完成内容 | 关联变更 |',
    '| --- | --- | --- |',
    `| ${today()} | smoke without link | CHG-20260504-01 |`,
    '<!-- ARCHIVE -->',
    '',
  ].join('\n'), 'utf8');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-walkthrough',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: 'smoke',
        new_string: 'smoke',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('缺少 wikilink，应为 [[chg-20260504-01]]'));
});

test('15g2. walkthrough 缺少 worktree/branch 上下文时 PostToolUse 提醒', () => {
  const dir = makeV6Project('post-walkthrough-missing-context', { withIndex: false });
  const indexRow = '- [x] [[chg-20260504-01]] 测试变更 #change [tasks:: T-001] [worktree:: smoke] [branch:: feature-x]';
  fs.writeFileSync(path.join(dir, 'task.md'), `# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n${indexRow}\n`, 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), `# 实施计划\n\n## 变更索引\n\n<!-- ARCHIVE -->\n${indexRow}\n`, 'utf8');
  const fp = path.join(dir, 'walkthrough.md');
  fs.writeFileSync(fp, [
    '# 工作记录',
    '',
    '## 最近工作',
    '',
    '| 日期 | 完成内容 | 关联变更 |',
    '| --- | --- | --- |',
    `| ${today()} | [[chg-20260504-01]] smoke | CHG-20260504-01 |`,
    '<!-- ARCHIVE -->',
    '',
  ].join('\n'), 'utf8');
  const r = runHook('post-tool-use.js', {
    cwd: dir,
    stdin: {
      agent_id: 'agent-walkthrough',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: {
        file_path: fp,
        old_string: 'smoke',
        new_string: 'smoke',
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('缺少执行上下文 [worktree:: smoke] [branch:: feature-x]'));
});

test('16. correction 详情变更 → knowledge 提醒', () => {
  const dir = makeV6Project('post-correction');
  const fp = path.join(dir, 'changes', 'corrections', 'correction-20260504-test.md');
  fs.writeFileSync(fp, '---\nschema-version: "6.0"\n---\n# Correction\n', 'utf8');
  const r = runHook('post-tool-use.js', { cwd: dir, stdin: { tool_name: 'Edit', tool_input: { file_path: fp, old_string: 'a', new_string: 'b' } } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('knowledge'));
});

test('17. vault 内 changes 详情编辑 → cli-refresh flag', () => {
  const cwd = makeTmpDir('post-vault-cwd');
  const projectName = path.basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectName);
  fs.mkdirSync(path.join(vaultDir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n');
  fs.writeFileSync(path.join(vaultDir, 'implementation_plan.md'), '# 实施计划\n\n## 变更索引\n\n<!-- ARCHIVE -->\n');
  const fp = path.join(vaultDir, 'changes', 'chg-20260504-01.md');
  fs.writeFileSync(fp, chgDetail(), 'utf8');
  fs.mkdirSync(path.join(cwd, '.pace'), { recursive: true });
  const r = runHook('post-tool-use.js', { cwd, stdin: { tool_name: 'Edit', tool_input: { file_path: fp, old_string: 'a', new_string: 'b' } } });
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(path.join(cwd, '.pace', 'cli-refresh-done')));
});

test('17b. legacy v5 PostToolUse 只提示迁移或桥接', () => {
  const dir = makeLegacyProject('post-legacy');
  const r = runHook('post-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir), env: { PACE_VAULT_PATH: '' } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('additionalContext'));
  assert.ok(r.stdout.includes('legacy task.md'));
  assert.ok(r.stdout.includes('Artifact 根目录'));
  assert.ok(r.stdout.includes('artifact-writer create-chg'));
  assert.ok(r.stdout.includes('不再校验或修复 v5'));
  assert.ok(r.stdout.includes('不要把迁移本身报告为代码任务完成'));
});

console.log('\n--- v5 migration helper ---');

test('17c. migrate dry-run 不创建 changes，正式执行创建备份和 v6 子目录', () => {
  const dir = makeLegacyProject('migrate-v5-dry-run');
  const dry = execFileSync('node', [MIGRATE_SCRIPT, dir, '--dry-run'], { encoding: 'utf8' });
  assert.ok(dry.includes('[DRY-RUN] 子目录 changes：将创建'));
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'dry-run 不应创建 changes/');

  const out = execFileSync('node', [MIGRATE_SCRIPT, dir], { encoding: 'utf8' });
  assert.ok(out.includes('[DONE] 子目录 changes：已创建'));
  assert.ok(fs.existsSync(path.join(dir, 'changes', 'findings')));
  assert.ok(fs.existsSync(path.join(dir, 'task.md.v5-backup')));
  const migratedTask = fs.readFileSync(path.join(dir, 'task.md'), 'utf8');
  assert.ok(migratedTask.includes('## v5 历史归档'));
  assert.ok(migratedTask.includes('## (v5 历史) Task'));
});

test('17d. migrate 默认拒绝重复执行', () => {
  const dir = makeLegacyProject('migrate-v5-repeat');
  execFileSync('node', [MIGRATE_SCRIPT, dir], { encoding: 'utf8' });
  assert.throws(
    () => execFileSync('node', [MIGRATE_SCRIPT, dir], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }),
    /changes\/ 已存在|Command failed/
  );
});

test('17e. migrate 接受 legacy 文件内多个 ARCHIVE 历史边界', () => {
  const dir = makeLegacyProject('migrate-v5-multi-archive');
  fs.writeFileSync(
    path.join(dir, 'task.md'),
    [
      '# Task',
      '',
      '- [/] Active legacy task',
      '',
      '<!-- ARCHIVE -->',
      '',
      '- [x] Archived legacy task 1',
      '',
      '<!-- ARCHIVE -->',
      '',
      '- [x] Archived legacy task 2',
      '',
      '<!-- ARCHIVE -->',
      '',
    ].join('\n'),
    'utf8'
  );

  const out = execFileSync('node', [MIGRATE_SCRIPT, dir], { encoding: 'utf8' });
  assert.ok(out.includes('[DONE] task.md'));
  const migrated = fs.readFileSync(path.join(dir, 'task.md'), 'utf8');
  const archiveCount = (migrated.match(/^<!-- ARCHIVE -->$/gm) || []).length;
  const historyBoundaryCount = (migrated.match(/^<!-- v5 历史 active\/archive 边界 -->$/gm) || []).length;
  assert.strictEqual(archiveCount, 1);
  assert.strictEqual(historyBoundaryCount, 3);
  assert.ok(migrated.includes('- [/] Active legacy task'));
  assert.ok(migrated.includes('- [x] Archived legacy task 2'));
});

test('17f. migrate 兼容 CRLF legacy ARCHIVE 标记', () => {
  const dir = makeLegacyProject('migrate-v5-crlf-archive');
  fs.writeFileSync(
    path.join(dir, 'task.md'),
    '# Task\r\n\r\n- [ ] Legacy task\r\n\r\n<!-- ARCHIVE -->\r\n\r\n- [x] Old task\r\n',
    'utf8'
  );

  execFileSync('node', [MIGRATE_SCRIPT, dir], { encoding: 'utf8' });
  const migrated = fs.readFileSync(path.join(dir, 'task.md'), 'utf8');
  const archiveCount = (migrated.match(/^<!-- ARCHIVE -->$/gm) || []).length;
  assert.strictEqual(archiveCount, 1);
  assert.ok(migrated.includes('<!-- v5 历史 active/archive 边界 -->'));
  assert.ok(!migrated.includes('\r'));
});

test('17g. migrate 将 legacy frontmatter 转成历史代码块', () => {
  const dir = makeLegacyProject('migrate-v5-frontmatter');
  fs.writeFileSync(
    path.join(dir, 'implementation_plan.md'),
    [
      '---',
      'title: Old Plan',
      'tags:',
      '  - legacy',
      '---',
      '',
      '# Old Plan',
      '',
      '- [x] Done',
      '<!-- ARCHIVE -->',
      '',
    ].join('\n'),
    'utf8'
  );

  execFileSync('node', [MIGRATE_SCRIPT, dir], { encoding: 'utf8' });
  const migrated = fs.readFileSync(path.join(dir, 'implementation_plan.md'), 'utf8');
  const archiveCount = (migrated.match(/^<!-- ARCHIVE -->$/gm) || []).length;
  const archived = migrated.split(/^<!-- ARCHIVE -->$/m).slice(1).join('\n');
  assert.strictEqual(archiveCount, 1);
  assert.ok(archived.includes('## v5 历史归档'));
  assert.ok(archived.includes('### v5 原始 frontmatter'));
  assert.ok(archived.includes('```yaml\ntitle: Old Plan\ntags:\n  - legacy\n```'));
  assert.ok(archived.includes('## (v5 历史) Old Plan'));
  assert.ok(!archived.includes('\n---\ntitle: Old Plan'));
});

test('17h. migrate --force 使用已有 v5 backup 且不覆盖备份', () => {
  const dir = makeLegacyProject('migrate-v5-force-backup');
  execFileSync('node', [MIGRATE_SCRIPT, dir], { encoding: 'utf8' });
  const backupPath = path.join(dir, 'task.md.v5-backup');
  const originalBackup = fs.readFileSync(backupPath, 'utf8');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Corrupted migrated file\n', 'utf8');

  const out = execFileSync('node', [MIGRATE_SCRIPT, dir, '--force'], { encoding: 'utf8' });
  const backupAfter = fs.readFileSync(backupPath, 'utf8');
  const migrated = fs.readFileSync(path.join(dir, 'task.md'), 'utf8');
  assert.ok(out.includes('使用已有 task.md.v5-backup 作为源，不覆盖备份'));
  assert.strictEqual(backupAfter, originalBackup);
  assert.ok(migrated.includes('## (v5 历史) Task'));
  assert.ok(!migrated.includes('Corrupted migrated file'));
});

console.log('\n--- task-list / pre-compact / lifecycle observers ---');

test('18. TodoWrite 按详情未完成任务数提示', () => {
  const dir = makeV6Project('tw-v6');
  const r = runHook('task-list-sync.js', { cwd: dir, stdin: { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'x' }, { content: 'y' }, { content: 'z' }, { content: 'w' }, { content: 'q' }] } } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('changes/<id>.md') || r.stdout.includes('未完成 T-NNN'));
  assert.ok(r.stdout.includes('Artifact 根目录'));
});

test('18c. TodoWrite 不把 planned backlog 计入当前任务数', () => {
  const dir = makeV6ProjectWithChanges('tw-backlog-only', [
    { id: 'CHG-20260504-01', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
    { id: 'CHG-20260504-02', indexMark: '[ ]', status: 'planned', task: '[ ]', approved: false },
  ]);
  const r = runHook('task-list-sync.js', {
    cwd: dir,
    stdin: { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'future task' }] } },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('当前执行中的 CHG 有 2 个未完成 T-NNN'));
});

test('18a. TaskCreate 走 Claude 任务列表同步提示', () => {
  const dir = makeV6Project('taskcreate-v6');
  const r = runHook('task-list-sync.js', {
    cwd: dir,
    stdin: {
      tool_name: 'TaskCreate',
      tool_input: { subject: 'T-901 验证 TaskCreate hook matcher', description: '覆盖交互式任务创建工具' }
    }
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('Claude 任务列表同步校验'));
  assert.ok(r.stdout.includes('未完成 T-NNN'));
  assert.ok(fs.existsSync(path.join(dir, '.pace', 'task-list-used')));
});

test('18b. TaskUpdate 走 Claude 任务列表同步提示', () => {
  const dir = makeV6Project('taskupdate-v6');
  const r = runHook('task-list-sync.js', {
    cwd: dir,
    stdin: {
      tool_name: 'TaskUpdate',
      tool_input: { task_id: 'task-001', status: 'in_progress' }
    }
  });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('Claude 任务列表同步校验'));
  assert.ok(r.stdout.includes('未完成 T-NNN'));
  assert.ok(fs.existsSync(path.join(dir, '.pace', 'task-list-used')));
});

test('18d. Superpowers plan 存在但 task.md 不存在时 TaskCreate 只提示不 deny', () => {
  const dir = makeTmpDir('taskcreate-superpowers-no-task');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-05-11-plan.md'), '# Plan\n', 'utf8');
  const r = runHook('task-list-sync.js', {
    cwd: dir,
    stdin: {
      tool_name: 'TaskCreate',
      tool_input: { subject: '先建立任务清单', description: '仅作为 Claude 工作记忆' },
    },
  });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.ok(!out.hookSpecificOutput.permissionDecision, 'TaskCreate 不应被 hard deny');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('Claude 任务列表可继续作为工作记忆'));
});

test('19. PreCompact 写 activeChanges 快照', () => {
  const dir = makeV6Project('pc-v6');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'stop-block-count'), '2', 'utf8');
  seedChangeOwner(dir, 'CHG-20260504-01', { sessionId: 'sid-precompact', agentId: 'agent-precompact' });
  fs.writeFileSync(
    path.join(dir, 'findings.md'),
    '# 调研记录\n\n## 摘要索引\n\n- [ ] [[finding-2026-05-07-test]] — open finding [date:: 2026-05-07] [impact:: P1]\n\n<!-- ARCHIVE -->\n',
    'utf8'
  );
  const r = runHook('pre-compact.js', { cwd: dir, stdin: { session_id: 'sid-precompact' } });
  assert.strictEqual(r.code, 0);
  const snap = JSON.parse(fs.readFileSync(path.join(dir, '.pace', 'pre-compact-state.json'), 'utf8'));
  assert.ok(Array.isArray(snap.activeChanges));
  assert.strictEqual(snap.activeChanges[0].id, 'CHG-20260504-01');
  assert.strictEqual(snap.activeChanges[0].ownerDisposition, 'current');
  assert.strictEqual(snap.runtime.blockCount, 2);
  assert.strictEqual(snap.findings.openCount, 1);
  assert.strictEqual(snap.walkthrough.hasTodayEntry, true);
});

test('19a. PreCompact 在 root 选择前保持零写入', () => {
  const dir = makeTmpDir('pc-root-choice-pending');
  fs.writeFileSync(path.join(dir, 'a.js'), 'a\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'b.js'), 'b\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'c.js'), 'c\n', 'utf8');
  const r = runHook('pre-compact.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.pace')), 'root 选择前 PreCompact 不应创建 .pace');
});

test('19b. PreCompact 只记录匹配当前项目的 native plan', () => {
  const dir = makeV6Project('pc-native-plan-filter');
  const home = makeTmpDir('pc-native-plan-home');
  const plansDir = path.join(home, '.claude', 'plans');
  fs.mkdirSync(plansDir, { recursive: true });

  const foreignPlan = path.join(plansDir, 'foreign.md');
  fs.writeFileSync(foreignPlan, '# ccauth unrelated plan\n\n不属于当前项目。\n', 'utf8');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'current-native-plan'), foreignPlan, 'utf8');
  let r = runHook('pre-compact.js', { cwd: dir, env: { HOME: home } });
  assert.strictEqual(r.code, 0);
  let snap = JSON.parse(fs.readFileSync(path.join(dir, '.pace', 'pre-compact-state.json'), 'utf8'));
  assert.ok(!snap.nativePlans, '无关 native plan 不应进入当前项目快照');
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'current-native-plan')), '已有无关 current-native-plan 应被清理');

  const matchingPlan = path.join(plansDir, 'matching.md');
  fs.writeFileSync(matchingPlan, `# ${projectNameForDir(dir)} native plan\n\n用于当前项目。\n`, 'utf8');
  r = runHook('pre-compact.js', { cwd: dir, env: { HOME: home } });
  assert.strictEqual(r.code, 0);
  snap = JSON.parse(fs.readFileSync(path.join(dir, '.pace', 'pre-compact-state.json'), 'utf8'));
  assert.deepStrictEqual(snap.nativePlans, [matchingPlan.replace(/\\/g, '/')]);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.pace', 'current-native-plan'), 'utf8'), matchingPlan.replace(/\\/g, '/'));
});

test('21. StopFailure PACE 项目记录日志', () => {
  const dir = makeV6Project('sf-v6');
  const logFile = path.join(HOOKS_DIR, 'pace-hooks.log');
  const before = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  const r = runHook('stop-failure.js', { cwd: dir, stdin: { error_type: 'rate_limit', stop_reason: 'api_error' } });
  assert.strictEqual(r.code, 0);
  const after = fs.readFileSync(logFile, 'utf8');
  const delta = after.slice(before.length);
  assert.ok(delta.includes('StopFailure'));
  assert.ok(delta.includes('rate_limit'));
});

test('22. PostToolUseFailure artifact/code 写入失败注入恢复提示', () => {
  const dir = makeV6Project('ptuf-v6');
  const r = runHook('post-tool-use-failure.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Write',
      tool_input: { file_path: path.join(dir, 'task.md') },
      error: 'EACCES: permission denied',
      duration_ms: 1234,
    },
  });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('工具失败恢复'));
  assert.ok(out.hookSpecificOutput.additionalContext.includes('Artifact 根目录'));
  assert.ok(out.hookSpecificOutput.additionalContext.includes('不要把失败工具调用视为完成'));
  assert.ok(out.hookSpecificOutput.additionalContext.includes('artifact 写入失败'));
});

test('22d. PostToolUseFailure 普通只读 Bash 失败只记录日志不注入 PACE 恢复提示', () => {
  const dir = makeV6Project('ptuf-bash-readonly-noise');
  const r = runHook('post-tool-use-failure.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Bash',
      tool_input: { command: 'ls docs/audits/missing.md' },
      error: 'No such file or directory',
    },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

test('22e. PostToolUseFailure Bash 验证失败仍注入验证恢复提示', () => {
  const dir = makeV6Project('ptuf-bash-validation');
  const r = runHook('post-tool-use-failure.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      error: 'tests failed',
    },
  });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('确认验证通过前不要派 verify/close-chg'));
});

test('22e1. PostToolUseFailure 自定义 Bash 验证脚本失败仍注入验证恢复提示', () => {
  const dir = makeV6Project('ptuf-bash-custom-validation');
  for (const command of ['bash scripts/test.sh', './run-tests.sh', 'python -m pytest tests/unit']) {
    const r = runHook('post-tool-use-failure.js', {
      cwd: dir,
      stdin: {
        tool_name: 'Bash',
        tool_input: { command },
        error: 'tests failed',
      },
    });
    assert.strictEqual(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.ok(out.hookSpecificOutput.additionalContext.includes('确认验证通过前不要派 verify/close-chg'), command);
  }
});

test('22c. PostToolUseFailure 保留未完成 index:changes 事务锁', () => {
  const dir = makeV6Project('ptuf-index-tx-open');
  const lockPath = seedArtifactResourceLock(dir, 'index:changes', {
    sessionId: 'sid-index-fail',
    agentId: 'agent-index-fail',
    file: path.join(dir, 'task.md'),
  });
  const txDir = path.join(dir, '.pace', 'index-transactions');
  fs.mkdirSync(txDir, { recursive: true });
  fs.writeFileSync(path.join(txDir, `${safeLockName('agent:agent-index-fail')}.json`), JSON.stringify({
    sessionId: 'sid-index-fail',
    agentId: 'agent-index-fail',
    ownerKey: 'agent:agent-index-fail',
    touched: ['task.md'],
    timestampMs: Date.now(),
  }, null, 2) + '\n', 'utf8');

  const beforeLog = fs.existsSync(path.join(HOOKS_DIR, 'pace-hooks.log')) ? fs.readFileSync(path.join(HOOKS_DIR, 'pace-hooks.log'), 'utf8') : '';
  const r = runHook('post-tool-use-failure.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-index-fail',
      agent_id: 'agent-index-fail',
      agent_type: 'paceflow:artifact-writer',
      tool_name: 'Edit',
      tool_input: { file_path: path.join(dir, 'implementation_plan.md') },
      error: 'Edit failed',
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(lockPath), 'index:changes 半事务失败时应保留锁，等待同 agent 重试或 SubagentStop 清理');
  const afterLog = fs.readFileSync(path.join(HOOKS_DIR, 'pace-hooks.log'), 'utf8');
  const delta = afterLog.slice(beforeLog.length);
  assert.ok(delta.includes('KEEP_ARTIFACT_RESOURCE_LOCK'));
  assert.ok(delta.includes('index-transaction-open-after-failure'));
});

test('22a. PostToolUseFailure 用户中断只记录日志不注入恢复提示', () => {
  const dir = makeV6Project('ptuf-interrupt');
  const r = runHook('post-tool-use-failure.js', {
    cwd: dir,
    stdin: { tool_name: 'Bash', is_interrupt: true, error: 'User aborted' },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

test('22b. hooks.json 为 PostToolUseFailure 注册 Agent matcher', () => {
  const hooksConfig = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf8'));
  const entries = hooksConfig.hooks.PostToolUseFailure || [];
  assert.ok(
    entries.some(e => String(e.matcher || '').split('|').includes('Agent')),
    'PostToolUseFailure matcher 必须包含 Agent，否则 Agent 失败不能触发锁释放'
  );
});

test('23. SubagentStop artifact-writer 合规报告记录 transcript 且不注入提示', () => {
  const dir = makeV6Project('sas-valid');
  const r = runHook('subagent-stop.js', {
    cwd: dir,
    stdin: {
      agent_type: 'paceflow:artifact-writer',
      agent_transcript_path: '/tmp/pace-agent.jsonl',
      last_assistant_message: '## artifact-writer 报告\n\n**状态**：SUCCESS\n',
    },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(fs.readFileSync(path.join(dir, '.pace', 'last-artifact-writer-transcript'), 'utf8'), '/tmp/pace-agent.jsonl');
});

test('23c. SubagentStop 在 close/archive 已离开活跃索引后兜底标记 owner closed', () => {
  const dir = makeV6Project('sas-close-owner-fallback', {
    withIndex: false,
    detail: chgDetail({ status: 'archived', task: '[x]', approved: true, verified: true }),
    walkToday: false,
  });
  const ownerPath = seedChangeOwner(dir, 'CHG-20260504-01', {
    sessionId: 'sid-sas-close',
    agentId: 'agent-sas-close',
    state: 'closing',
  });
  const transcriptPath = path.join(dir, 'agent-close.jsonl');
  fs.writeFileSync(transcriptPath, JSON.stringify({
    type: 'user',
    message: {
      content: [
        'operation: close-chg',
        'target: CHG-20260504-01',
        'verification-confirmed: true',
      ].join('\n'),
    },
  }) + '\n', 'utf8');
  const r = runHook('subagent-stop.js', {
    cwd: dir,
    stdin: {
      session_id: 'sid-sas-close',
      agent_id: 'agent-sas-close',
      agent_type: 'paceflow:artifact-writer',
      agent_transcript_path: transcriptPath,
      last_assistant_message: '## artifact-writer 报告\n\n**状态**：SUCCESS\n',
    },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
  const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
  assert.strictEqual(owner.state, 'closed');
  assert.strictEqual(owner.operation, 'close-chg');
});

test('23a. SubagentStop artifact-writer 缺报告标题时注入格式提醒', () => {
  const dir = makeV6Project('sas-missing-title');
  const r = runHook('subagent-stop.js', {
    cwd: dir,
    stdin: {
      subagent_type: 'artifact-writer',
      last_assistant_message: '## 报告\n\n**状态**：SUCCESS\n',
    },
  });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SubagentStop');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('报告未能解析'));
  assert.ok(out.hookSpecificOutput.additionalContext.includes('Artifact 根目录'));
});

test('23b. SubagentStop 允许全局时间戳前缀但记录为日志 warning', () => {
  const dir = makeV6Project('sas-timestamp-prefix');
  const r = runHook('subagent-stop.js', {
    cwd: dir,
    stdin: {
      agent_type: 'artifact-writer',
      last_assistant_message: '[2026-05-07 08:51:56]\n## artifact-writer 报告\n\n**状态**：FAILED\n',
    },
  });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '');
});

cleanupAll();

const total = t.passed + t.failed;
console.log(`\n${t.failed === 0 ? '\u2705' : '\u274c'} ${t.passed}/${total} tests passed`);
if (t.failed > 0) process.exit(1);
