// PACEflow Hook E2E 测试
// 零依赖：Node.js 内置 assert + fs + os + child_process
// 在隔离临时目录中运行每个 hook 脚本，验证 stdin/stdout/exit code 协议

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
let passed = 0;
let failed = 0;
let tmpDirs = [];

// --- 工具函数 ---

function makeTmpDir(label) {
  const dir = path.join(os.tmpdir(), `pace-e2e-${Date.now()}-${label}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

/** 运行 hook 脚本，返回 { code, stdout, stderr } */
function runHook(hookName, { cwd, stdin = '' }) {
  const hookPath = path.join(HOOKS_DIR, hookName);
  try {
    const stdout = execFileSync('node', [hookPath], {
      cwd, input: stdin, encoding: 'utf8', timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
  }
}

/** 创建基础 PACE 项目临时目录（默认含空活跃区 task.md） */
function makePaceProject(label, opts = {}) {
  const dir = makeTmpDir(label);
  const taskContent = opts.taskContent || '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n';
  fs.writeFileSync(path.join(dir, 'task.md'), taskContent, 'utf8');
  if (opts.specContent) fs.writeFileSync(path.join(dir, 'spec.md'), opts.specContent, 'utf8');
  if (opts.implPlan) fs.writeFileSync(path.join(dir, 'implementation_plan.md'), opts.implPlan, 'utf8');
  if (opts.walkthrough) fs.writeFileSync(path.join(dir, 'walkthrough.md'), opts.walkthrough, 'utf8');
  if (opts.findings) fs.writeFileSync(path.join(dir, 'findings.md'), opts.findings, 'utf8');
  if (opts.paceRuntime) {
    fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
    for (const [name, content] of Object.entries(opts.paceRuntime)) {
      fs.writeFileSync(path.join(dir, '.pace', name), content, 'utf8');
    }
  }
  return dir;
}

/** 获取今天日期（与 hooks 一致的 sv-SE 格式） */
function getToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

// ============================================================
// 1. session-start.js (3)
// ============================================================
console.log('\n--- session-start.js ---');

test('1. 非 PACE 项目静默放行', () => {
  const dir = makeTmpDir('ss-empty');
  const r = runHook('session-start.js', { cwd: dir, stdin: '{}' });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('=== task.md ==='), '不应注入 artifact');
});

test('2. 基本 artifact 注入', () => {
  const dir = makePaceProject('ss-inject', {
    specContent: '# Spec\n\ntest spec\n\n<!-- ARCHIVE -->\n',
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: '{"type":"startup"}' });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('=== task.md ==='), '应注入 task.md');
  assert.ok(r.stdout.includes('=== spec.md ==='), '应注入 spec.md');
});

test('3. compact 恢复快照', () => {
  const snapshot = JSON.stringify({
    timestamp: '2026-02-25T10:00:00.000Z',
    artifacts: { 'task.md': { pending: 1, done: 0, inProgress: ['- [/] T-001 进行中任务'] } },
    runtime: { degraded: false },
  });
  const dir = makePaceProject('ss-compact', {
    paceRuntime: { 'pre-compact-state.json': snapshot },
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: '{"type":"compact"}' });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('Compact 恢复'), '应输出 compact 恢复信息');
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'pre-compact-state.json')), '快照文件应已删除');
});

// ============================================================
// 2. pre-tool-use.js (5)
// ============================================================
console.log('\n--- pre-tool-use.js ---');

test('4. 非 PACE 项目放行', () => {
  const dir = makeTmpDir('ptu-empty');
  const stdin = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'app.js') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('deny'), '不应 deny');
});

test('5. Write artifact 拒绝', () => {
  const dir = makePaceProject('ptu-write-artifact');
  const stdin = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'task.md') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('deny'), '应包含 deny');
  assert.ok(r.stdout.includes('禁止'), '应包含禁止原因');
});

test('6. 无活跃任务 DENY', () => {
  const dir = makePaceProject('ptu-no-active');
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('deny'), '应 deny 无活跃任务');
});

test('7. C 阶段无批准 DENY', () => {
  const dir = makePaceProject('ptu-no-approval', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 测试任务\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('deny'), '应 deny');
  assert.ok(r.stdout.includes('APPROVED') || r.stdout.includes('批准'), '应提及 APPROVED');
});

test('8. 正常注入（通过）', () => {
  const dir = makePaceProject('ptu-pass', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试任务\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260225-01 测试变更 #change\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('additionalContext'), '应包含 additionalContext');
  assert.ok(!r.stdout.includes('"deny"'), '不应 deny');
});

// ============================================================
// 3. post-tool-use.js (3)
// ============================================================
console.log('\n--- post-tool-use.js ---');

test('9. 非 PACE 项目静默', () => {
  const dir = makeTmpDir('pou-empty');
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
});

test('10. 归档提醒', () => {
  const dir = makePaceProject('pou-archive', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [x] T-001 已完成任务\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'task.md') } });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('归档'), '应提醒归档');
});

test('11. findings [-] 理由不足', () => {
  const dir = makePaceProject('pou-findings', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 进行中\n\n<!-- ARCHIVE -->\n',
    findings: '# 调研记录\n\n## 摘要索引\n\n- [-] 测试 — 短\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'findings.md') } });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('理由不足'), '应提醒理由不足');
});

// ============================================================
// 4. stop.js (4)
// ============================================================
console.log('\n--- stop.js ---');

test('12. 非 PACE 项目放行', () => {
  const dir = makeTmpDir('stop-empty');
  const r = runHook('stop.js', { cwd: dir, stdin: '{}' });
  assert.strictEqual(r.code, 0);
});

test('13. 未完成任务阻止', () => {
  const dir = makePaceProject('stop-pending', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 待办任务\n\n<!-- ARCHIVE -->\n',
    walkthrough: `# 工作记录\n\n**时间**: ${getToday()}T10:00:00+08:00\n\n测试\n\n<!-- ARCHIVE -->\n`,
  });
  const r = runHook('stop.js', { cwd: dir, stdin: '{}' });
  assert.strictEqual(r.code, 2, '应 exit 2');
  assert.ok(r.stderr.includes('未完成'), 'stderr 应含"未完成"');
});

test('14. stdin 解析 + 未完成任务阻止', () => {
  const dir = makePaceProject('stop-stdin', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 待办任务\n\n<!-- ARCHIVE -->\n',
    walkthrough: `# 工作记录\n\n**时间**: ${getToday()}T10:00:00+08:00\n\n测试\n\n<!-- ARCHIVE -->\n`,
  });
  const stdin = JSON.stringify({ last_assistant_message: '任务完成' });
  const r = runHook('stop.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 2, '应 exit 2');
  assert.ok(r.stderr.length > 0, 'stderr 不应为空');
});

test('15. 防无限循环降级', () => {
  const dir = makePaceProject('stop-degrade', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 待办任务\n\n<!-- ARCHIVE -->\n',
    walkthrough: `# 工作记录\n\n**时间**: ${getToday()}T10:00:00+08:00\n\n测试\n\n<!-- ARCHIVE -->\n`,
    paceRuntime: { 'stop-block-count': '3' },
  });
  const r = runHook('stop.js', { cwd: dir, stdin: '{}' });
  assert.strictEqual(r.code, 0, '应降级为 exit 0');
  assert.ok(fs.existsSync(path.join(dir, '.pace', 'degraded')), '.pace/degraded 应存在');
});

// ============================================================
// 5. todowrite-sync.js (2)
// ============================================================
console.log('\n--- todowrite-sync.js ---');

test('16. 非 PACE 项目放行', () => {
  const dir = makeTmpDir('tw-empty');
  const stdin = JSON.stringify({ tool_name: 'TaskCreate', tool_input: { subject: 'test' } });
  const r = runHook('todowrite-sync.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '', 'stdout 应为空');
});

test('17. 有活跃任务 HINT', () => {
  const dir = makePaceProject('tw-hint', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 待办任务\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'TaskCreate', tool_input: { subject: 'test task' } });
  const r = runHook('todowrite-sync.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('task.md'), '应提及 task.md');
});

// ============================================================
// 6. pre-compact.js (2)
// ============================================================
console.log('\n--- pre-compact.js ---');

test('18. 非 PACE 项目跳过', () => {
  const dir = makeTmpDir('pc-empty');
  const r = runHook('pre-compact.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'pre-compact-state.json')), '不应创建快照');
});

test('19. 快照创建', () => {
  const dir = makePaceProject('pc-snapshot', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 进行中任务\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260225-01 测试变更\n\n<!-- ARCHIVE -->\n',
  });
  const r = runHook('pre-compact.js', { cwd: dir });
  assert.strictEqual(r.code, 0);
  const snapPath = path.join(dir, '.pace', 'pre-compact-state.json');
  assert.ok(fs.existsSync(snapPath), '快照文件应存在');
  const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
  assert.ok(snap.timestamp, '应有 timestamp');
  assert.ok(snap.artifacts['task.md'], '应有 task.md 状态');
  assert.ok(snap.artifacts['task.md'].inProgress.length > 0, '应有进行中任务');
});

// ============================================================
// 7. config-guard.js (3)
// ============================================================
console.log('\n--- config-guard.js ---');

test('20. 非 PACE 项目放行', () => {
  const dir = makeTmpDir('cg-empty');
  const stdin = JSON.stringify({ disableAllHooks: true });
  const r = runHook('config-guard.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
});

test('21. disableAllHooks 警告（additionalContext）', () => {
  const dir = makePaceProject('cg-disable');
  const stdin = JSON.stringify({ tool_input: { "disableAllHooks": true } });
  const r = runHook('config-guard.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0, 'ConfigChange 不支持 exit 2，应 exit 0');
  const out = JSON.parse(r.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('严重警告'), 'additionalContext 应含"严重警告"');
});

test('22. 正常配置通过', () => {
  const dir = makePaceProject('cg-normal');
  const stdin = JSON.stringify({ theme: 'dark' });
  const r = runHook('config-guard.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
});

// ============================================================
// 8. teammate 降级测试 (3)
// ============================================================
console.log('\n--- teammate 降级 ---');

test('23. pre-tool-use teammate 降级为 additionalContext', () => {
  const dir = makePaceProject('tm-ptu', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  // 设置 CLAUDE_CODE_TEAM_NAME 模拟 teammate
  const origTeam = process.env.CLAUDE_CODE_TEAM_NAME;
  process.env.CLAUDE_CODE_TEAM_NAME = 'test-team';
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  if (origTeam === undefined) delete process.env.CLAUDE_CODE_TEAM_NAME;
  else process.env.CLAUDE_CODE_TEAM_NAME = origTeam;
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('additionalContext'), '应包含 additionalContext');
  assert.ok(!r.stdout.includes('"deny"'), 'teammate 不应 deny');
  assert.ok(r.stdout.includes('teammate'), '应提及 teammate');
});

test('24. stop.js teammate 降级为 exit 0', () => {
  const dir = makePaceProject('tm-stop', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 待办任务\n\n<!-- ARCHIVE -->\n',
    walkthrough: `# 工作记录\n\n**时间**: ${getToday()}T10:00:00+08:00\n\n测试\n\n<!-- ARCHIVE -->\n`,
  });
  const origTeam = process.env.CLAUDE_CODE_TEAM_NAME;
  process.env.CLAUDE_CODE_TEAM_NAME = 'test-team';
  const r = runHook('stop.js', { cwd: dir, stdin: '{}' });
  if (origTeam === undefined) delete process.env.CLAUDE_CODE_TEAM_NAME;
  else process.env.CLAUDE_CODE_TEAM_NAME = origTeam;
  assert.strictEqual(r.code, 0, 'teammate 应 exit 0（不阻止）');
  assert.ok(r.stdout.includes('additionalContext'), '应包含 additionalContext');
  assert.ok(r.stdout.includes('teammate'), '应提及 teammate');
});

test('25. todowrite-sync teammate 静默', () => {
  const dir = makePaceProject('tm-tw', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 待办任务\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'TaskCreate', tool_input: { subject: 'team task' } });
  const origTeam = process.env.CLAUDE_CODE_TEAM_NAME;
  process.env.CLAUDE_CODE_TEAM_NAME = 'test-team';
  const r = runHook('todowrite-sync.js', { cwd: dir, stdin });
  if (origTeam === undefined) delete process.env.CLAUDE_CODE_TEAM_NAME;
  else process.env.CLAUDE_CODE_TEAM_NAME = origTeam;
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, '', 'teammate 应静默无输出');
});

// ============================================================
// 汇总 + 清理
// ============================================================
cleanup();

const total = passed + failed;
console.log(`\n${failed === 0 ? '\u2705' : '\u274c'} ${passed}/${total} tests passed`);
if (failed > 0) process.exit(1);
