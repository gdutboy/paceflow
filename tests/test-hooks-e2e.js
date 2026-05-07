// PACEflow Hook E2E 测试（v6-only）
// 覆盖 v6 项目信号 changes/、详情文件任务权威、APPROVED/VERIFIED 详情位置。

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
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
  fs.writeFileSync(path.join(dir, 'walkthrough.md'), `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n${opts.walkToday === false ? '' : `| ${today()} | smoke | CHG-20260504-01 |\n`}\n<!-- ARCHIVE -->\n`, 'utf8');
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
    fs.writeFileSync(path.join(dir, 'walkthrough.md'), `# 工作记录\n\n## 最近工作\n\n| 日期 | 完成内容 | 关联变更 |\n| --- | --- | --- |\n| ${today()} | smoke | CHG-20260504-01 |\n<!-- ARCHIVE -->\n`, 'utf8');
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
  assert.ok(r.stdout.includes('待 close-chg/archive-chg'));
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
});

test('3a. SessionStart 清理每会话 .pace 运行态 flags', () => {
  const currentFindingsAgeFlag = `findings-age-${today()}`;
  const dir = makeV6Project('ss-session-flags', {
    paceRuntime: {
      'archive-reminded-chg-20260504-01': '1',
      'cli-refresh-done': '1',
      'task-list-used': '1',
      'findings-age-2000-01-01': '1',
      [currentFindingsAgeFlag]: '1',
    },
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'archive-reminded-chg-20260504-01')));
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

test('9. 主 session 直接写 VERIFIED → DENY verify action', () => {
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
  assert.ok(r.stdout.includes('action=verify'));
});

test('9m. MultiEdit 直接写 VERIFIED → DENY verify action', () => {
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
  assert.ok(r.stdout.includes('action=verify'));
});

test('9a. artifact-writer subagent 可写 APPROVED / VERIFIED 标志', () => {
  const dir = makeV6Project('ptu-marker-agent');
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const approve = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
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
  const delta = after.slice(before.length);
  assert.ok(delta.includes('act=DENY_V6_MARKER'));
  assert.ok(delta.includes('agent_id=agent-log-deny'));
  assert.ok(delta.includes('agent_type=code-reviewer'));
  assert.ok(delta.includes('act=PASS_V6_MARKER_AGENT'));
  assert.ok(delta.includes('agent_id=agent-log-pass'));
  assert.ok(delta.includes('agent_type=artifact-writer'));
});

test('9b. create-chg 写 verified-date null → 放行', () => {
  const dir = makeV6Project('ptu-create-null', { withIndex: false, detail: false });
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
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

test('9c. native plan 桥接提示走 artifact writer', () => {
  const dir = makeTmpDir('ptu-native-plan');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.writeFileSync(path.join(dir, '.pace', 'current-native-plan'), path.join(dir, 'plan.md'), 'utf8');
  fs.writeFileSync(path.join(dir, 'plan.md'), '# Native plan\n', 'utf8');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir), env: { PACE_VAULT_PATH: '' } });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('artifact-writer create-chg'));
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
  assert.ok(r.stdout.includes('artifact-root'));
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
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'local 选择应在本地懒创建 changes/');
  assert.ok(fs.existsSync(path.join(dir, 'task.md')), 'local 选择应在本地创建 task.md');
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), 'local 选择不应在 vault 创建 changes/');
});

test('9c3. SessionStart 首次启用不输出选择提示、不自动创建模板', () => {
  const dir = makeTmpDir('ss-artifact-root-choice');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHookDetailed('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('Artifact 目录选择'), 'SessionStart 不应在闲聊前主动打扰');
  assert.ok(!r.stdout.includes('AskUserQuestion'), '选择应推迟到 PreToolUse 阶段');
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

test('9c3a. artifact-root=local 的 SessionStart 不创建 Obsidian 空项目目录', () => {
  const dir = makeTmpDir('ss-artifact-root-local-no-vault-dir');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHookDetailed('session-start.js', { cwd: dir, stdin: { type: 'startup' } });
  assert.strictEqual(r.code, 0);
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

test('9d. legacy v5 活跃项目只提示迁移或桥接', () => {
  const dir = makeLegacyProject('ptu-legacy');
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin: codeEditStdin(dir), env: { PACE_VAULT_PATH: '' } });
  assert.ok(r.stdout.includes('deny'));
  assert.ok(r.stdout.includes('legacy task.md'));
  assert.ok(r.stdout.includes('migrate/batch-archive-v5.js'));
  assert.ok(r.stdout.includes('artifact-writer create-chg'));
  assert.ok(!r.stdout.includes('补齐实施详情'));
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

test('9g. worktree 写 vault 中的详情路径 → 放行', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('redirect-vault-pass');
  const fp = path.join(vaultDir, 'changes', 'chg-20260504-02.md');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: { tool_name: 'Write', tool_input: { file_path: fp, content: '# vault detail\n' } },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
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

test('9haa. 首次 artifact-writer Agent 派遣前要求选择 artifact root', () => {
  const dir = makeTmpDir('agent-artifact-root-choice');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
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

test('9hab. artifact-root=local 后首次 artifact-writer Agent 放行前创建本地模板', () => {
  const dir = makeTmpDir('agent-artifact-root-local');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'local\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const r = runHook('pre-tool-use.js', {
    cwd: dir,
    stdin: {
      tool_name: 'Agent',
      tool_input: {
        subagent_type: 'paceflow:artifact-writer',
        description: 'Create CHG',
        prompt: `artifact_dir: ${dir.replace(/\\/g, '/')}\n使用 create-chg 流程创建一个新的变更记录。`,
      },
    },
  });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
  assert.ok(r.stdout.includes('Artifact 基础模板'));
  assert.ok(fs.existsSync(path.join(dir, 'changes')), 'local agent 放行前应创建 changes/');
  assert.ok(fs.existsSync(path.join(dir, 'task.md')), 'local agent 放行前应创建 task.md');
  assert.ok(fs.existsSync(path.join(dir, 'implementation_plan.md')), 'local agent 放行前应创建 implementation_plan.md');
  assert.ok(!fs.existsSync(path.join(vaultDir, 'changes')), 'local 选择不应在 vault 创建 changes/');
});

test('9hac. artifact-root=vault 后首次 artifact-writer Agent 带 artifact_dir 会在 vault 创建模板', () => {
  const dir = makeTmpDir('agent-artifact-root-vault');
  fs.writeFileSync(path.join(dir, '.pace-enabled'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'artifact-root'), 'vault\n', 'utf8');
  const vaultDir = path.join(_vaultTmpDir, 'projects', projectNameForDir(dir));
  const prompt = `artifact_dir: ${vaultDir.replace(/\\/g, '/')}/\n使用 create-chg 流程创建一个新的变更记录。`;
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
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
  assert.ok(r.stdout.includes('Artifact 基础模板'));
  assert.ok(fs.existsSync(path.join(vaultDir, 'changes')), 'vault agent 放行前应创建 changes/');
  assert.ok(fs.existsSync(path.join(vaultDir, 'task.md')), 'vault agent 放行前应创建 task.md');
  assert.ok(fs.existsSync(path.join(vaultDir, 'implementation_plan.md')), 'vault agent 放行前应创建 implementation_plan.md');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), 'vault 选择不应在本地项目创建 changes/');
});

test('9hb. artifact-writer Agent 未带 vault artifact_dir → DENY 重派', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('agent-artdir-deny');
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
    stdin: {
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

test('9hc. artifact-writer Agent 带 vault artifact_dir → 放行', () => {
  const { worktree, vaultDir } = makeVaultBackedWorktree('agent-artdir-pass');
  const prompt = `artifact_dir: ${vaultDir.replace(/\\/g, '/')}/\n使用 create-chg 流程创建一个新的变更记录。`;
  const r = runHook('pre-tool-use.js', {
    cwd: worktree,
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
  assert.ok(!r.stdout.includes('"deny"'));
  assert.ok(r.stdout.includes('ARTIFACT_DIR 已确认'));
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

test('12. v6 completed + verified 仍活跃 → close-chg/archive-chg 阻止', () => {
  const dir = makeV6Project('stop-archive', {
    indexMark: '[x]',
    detail: chgDetail({ status: 'completed', task: '[x]', approved: true, verified: true }),
  });
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2);
  assert.ok(r.stderr.includes('close-chg'));
  assert.ok(r.stderr.includes('archive-chg'));
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
  assert.ok(r.stderr.includes('legacy task.md'));
  assert.ok(r.stderr.includes('migrate/batch-archive-v5.js'));
  assert.ok(r.stderr.includes('artifact-writer create-chg'));
  assert.ok(!r.stderr.includes('补齐实施详情'));
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

console.log('\n--- post-tool-use.js ---');

test('15. v6 schema 缺 verified-date → warning', () => {
  const detail = chgDetail().replace('verified-date: null\n', '');
  const dir = makeV6Project('post-schema', { detail });
  const fp = path.join(dir, 'changes', 'chg-20260504-01.md');
  const r = runHook('post-tool-use.js', { cwd: dir, stdin: { tool_name: 'Edit', tool_input: { file_path: fp, old_string: 'a', new_string: 'b' } } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('verified-date'));
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
  assert.ok(r.stdout.includes('artifact-writer create-chg'));
  assert.ok(r.stdout.includes('不再校验或修复 v5'));
});

console.log('\n--- task-list / pre-compact / config ---');

test('18. TodoWrite 按详情未完成任务数提示', () => {
  const dir = makeV6Project('tw-v6');
  const r = runHook('task-list-sync.js', { cwd: dir, stdin: { tool_name: 'TodoWrite', tool_input: { todos: [{ content: 'x' }, { content: 'y' }, { content: 'z' }, { content: 'w' }, { content: 'q' }] } } });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('changes/<id>.md') || r.stdout.includes('未完成 T-NNN'));
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

test('19. PreCompact 写 activeChanges 快照', () => {
  const dir = makeV6Project('pc-v6');
  const r = runHook('pre-compact.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
  const snap = JSON.parse(fs.readFileSync(path.join(dir, '.pace', 'pre-compact-state.json'), 'utf8'));
  assert.ok(Array.isArray(snap.activeChanges));
  assert.strictEqual(snap.activeChanges[0].id, 'CHG-20260504-01');
});

test('20. ConfigGuard PACE 项目 disableAllHooks 警告', () => {
  const dir = makeV6Project('cg-v6');
  const r = runHook('config-guard.js', { cwd: dir, stdin: { tool_input: { disableAllHooks: true } } });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('严重警告'));
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

cleanupAll();

const total = t.passed + t.failed;
console.log(`\n${t.failed === 0 ? '\u2705' : '\u274c'} ${t.passed}/${total} tests passed`);
if (t.failed > 0) process.exit(1);
