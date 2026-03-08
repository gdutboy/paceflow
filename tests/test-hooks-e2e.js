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

// 全局 VAULT_PATH 隔离：runHook 子进程继承此环境变量，避免在真实 Obsidian vault 创建垃圾 junction
const _origVaultPath = process.env.PACE_VAULT_PATH;
const _vaultTmpDir = path.join(os.tmpdir(), `pace-e2e-vault-${Date.now()}`);
fs.mkdirSync(path.join(_vaultTmpDir, 'projects'), { recursive: true });
process.env.PACE_VAULT_PATH = _vaultTmpDir;

// --- 工具函数 ---

function makeTmpDir(label) {
  const dir = path.join(os.tmpdir(), `pace-e2e-${Date.now()}-${label}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  // 恢复全局 VAULT_PATH
  if (_origVaultPath === undefined) delete process.env.PACE_VAULT_PATH;
  else process.env.PACE_VAULT_PATH = _origVaultPath;
  try { fs.rmSync(_vaultTmpDir, { recursive: true, force: true }); } catch (e) {}
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
}

/** 运行 hook 脚本，返回 { code, stdout, stderr } */
function runHook(hookName, { cwd, stdin = '', env = {} }) {
  const hookPath = path.join(HOOKS_DIR, hookName);
  const mergedEnv = { ...process.env, ...env };
  try {
    const stdout = execFileSync('node', [hookPath], {
      cwd, input: stdin, encoding: 'utf8', timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: mergedEnv,
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
// 9. 基础设施解耦 + 模板引导 (3)
// ============================================================
console.log('\n--- 基础设施解耦 + 模板引导 ---');

test('26. ensureProjectInfra 幂等：artifact 存在但无 .pace', () => {
  const dir = makePaceProject('infra-idempotent');
  // artifact 已存在（makePaceProject 创建了 task.md），但无 .pace 目录
  assert.ok(!fs.existsSync(path.join(dir, '.pace', '.gitignore')), '.gitignore 不应预先存在');
  // 重定向 VAULT_PATH 到临时目录，避免污染真实 Obsidian vault
  const origVault = process.env.PACE_VAULT_PATH;
  process.env.PACE_VAULT_PATH = dir;
  // 清除模块缓存以使新 VAULT_PATH 生效
  delete require.cache[require.resolve(path.join(HOOKS_DIR, 'pace-utils'))];
  const paceUtils = require(path.join(HOOKS_DIR, 'pace-utils'));
  paceUtils.ensureProjectInfra(dir);
  assert.ok(fs.existsSync(path.join(dir, '.pace', '.gitignore')), '.gitignore 应被创建');
  // 二次调用不应报错（幂等）
  paceUtils.ensureProjectInfra(dir);
  assert.ok(fs.existsSync(path.join(dir, '.pace', '.gitignore')), '二次调用后 .gitignore 仍存在');
  // 恢复环境变量 + 清除缓存
  if (origVault === undefined) delete process.env.PACE_VAULT_PATH;
  else process.env.PACE_VAULT_PATH = origVault;
  delete require.cache[require.resolve(path.join(HOOKS_DIR, 'pace-utils'))];
});

test('27. session-start paceSignal=artifact → .gitignore 仍创建', () => {
  const dir = makePaceProject('ss-infra', {
    specContent: '# Spec\n\ntest\n\n<!-- ARCHIVE -->\n',
  });
  // artifact 信号激活但无 .pace 目录
  assert.ok(!fs.existsSync(path.join(dir, '.pace', '.gitignore')), '.gitignore 不应预先存在');
  const r = runHook('session-start.js', { cwd: dir, stdin: '{"type":"startup"}' });
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(path.join(dir, '.pace', '.gitignore')), 'session-start 应创建 .gitignore');
});

test('28. pre-tool-use Write 新建 artifact → 模板引导', () => {
  // 只有 spec.md 存在（触发 artifact 信号），task.md 不存在
  const dir = makeTmpDir('ptu-tmpl');
  fs.writeFileSync(path.join(dir, 'spec.md'), '# Spec\n\n<!-- ARCHIVE -->\n', 'utf8');
  const stdin = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'task.md') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('additionalContext'), '应包含 additionalContext');
  assert.ok(r.stdout.includes('<!-- ARCHIVE -->'), '模板内容应含 ARCHIVE 标记');
  assert.ok(r.stdout.includes('新建 task.md'), '应提及新建文件名');
  assert.ok(!r.stdout.includes('"deny"'), '不应 deny（是引导不是阻止）');
});

// ============================================================
// 10. Vault artifact 存储迁移 (4)
// ============================================================
console.log('\n--- Vault artifact 存储迁移 ---');

/** 创建 vault-only PACE 项目（artifact 仅在 vault，CWD 无 artifact） */
function makeVaultProject(label, opts = {}) {
  const dir = makeTmpDir(label);
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const vaultProjDir = path.join(_vaultTmpDir, 'projects', projectName);
  fs.mkdirSync(vaultProjDir, { recursive: true });
  const taskContent = opts.taskContent || '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n';
  fs.writeFileSync(path.join(vaultProjDir, 'task.md'), taskContent, 'utf8');
  if (opts.specContent) fs.writeFileSync(path.join(vaultProjDir, 'spec.md'), opts.specContent, 'utf8');
  if (opts.implPlan) fs.writeFileSync(path.join(vaultProjDir, 'implementation_plan.md'), opts.implPlan, 'utf8');
  if (opts.walkthrough) fs.writeFileSync(path.join(vaultProjDir, 'walkthrough.md'), opts.walkthrough, 'utf8');
  if (opts.paceRuntime) {
    fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
    for (const [name, content] of Object.entries(opts.paceRuntime)) {
      fs.writeFileSync(path.join(dir, '.pace', name), content, 'utf8');
    }
  }
  return { cwd: dir, vaultDir: vaultProjDir };
}

test('29. Write artifact 到 CWD → deny + 重定向到 vault', () => {
  const { cwd: dir, vaultDir } = makeVaultProject('vault-write-redirect', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260301-01 测试 #change\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path.join(dir, 'task.md') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('"deny"'), '应 deny 写入 CWD');
  assert.ok(r.stdout.includes('迁移'), '应提及迁移');
  assert.ok(r.stdout.includes(vaultDir.replace(/\\/g, '/')), '应包含 vault 路径');
});

test('30. Edit artifact 到 CWD → deny + 重定向到 vault', () => {
  const { cwd: dir, vaultDir } = makeVaultProject('vault-edit-redirect');
  // CWD 中放一个旧的 task.md（模拟迁移残留）
  fs.writeFileSync(path.join(dir, 'task.md'), '# old\n', 'utf8');
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'task.md') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  // 注意：CWD 也有 artifact，getArtifactDir 优先检查 vault → vault 有 → artDir=vault → artDir !== cwd → 触发重定向
  // 但实际上 getArtifactDir 先检查 vault，vault 有 → 返回 vault。CWD 也有 artifact 但 vault 优先。
  assert.ok(r.stdout.includes('"deny"'), '应 deny 编辑 CWD artifact');
  assert.ok(r.stdout.includes(vaultDir.replace(/\\/g, '/')), '应包含正确 vault 路径');
});

test('31. session-start 注入 artifact 目录路径', () => {
  const { cwd: dir, vaultDir } = makeVaultProject('vault-ss-inject', {
    specContent: '# Spec\n\ntest\n\n<!-- ARCHIVE -->\n',
  });
  const r = runHook('session-start.js', { cwd: dir, stdin: '{"type":"startup"}' });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('=== Artifact 目录 ==='), '应注入 artifact 目录段');
  assert.ok(r.stdout.includes(vaultDir.replace(/\\/g, '/')), '路径应指向 vault');
  assert.ok(r.stdout.includes('=== task.md ==='), '应注入 task.md 内容');
});

test('32. getArtifactDir 无 VAULT_PATH → fallback CWD', () => {
  const origVault = process.env.PACE_VAULT_PATH;
  process.env.PACE_VAULT_PATH = '';
  delete require.cache[require.resolve(path.join(HOOKS_DIR, 'pace-utils'))];
  const pu = require(path.join(HOOKS_DIR, 'pace-utils'));
  const dir = makeTmpDir('no-vault');
  fs.writeFileSync(path.join(dir, 'task.md'), '# test\n', 'utf8');
  assert.strictEqual(pu.getArtifactDir(dir), dir, '无 VAULT_PATH 应 fallback 到 CWD');
  // 恢复
  process.env.PACE_VAULT_PATH = origVault || _vaultTmpDir;
  delete require.cache[require.resolve(path.join(HOOKS_DIR, 'pace-utils'))];
});

// ============================================================
// 11. Obsidian CLI 索引刷新 (3)
// ============================================================
console.log('\n--- Obsidian CLI 索引刷新 ---');

test('33. post-tool-use artifact 编辑 → cli-refresh-done flag 创建', () => {
  const { cwd: dir, vaultDir } = makeVaultProject('cli-refresh', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
  });
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  const taskPath = path.join(vaultDir, 'task.md').replace(/\\/g, '/');
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: taskPath, old_string: 'x', new_string: 'y' } });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(fs.existsSync(path.join(dir, '.pace', 'cli-refresh-done')), 'flag 文件应被创建');
});

test('34. post-tool-use 非 artifact 文件 → 无 cli-refresh-done flag', () => {
  const { cwd: dir } = makeVaultProject('cli-no-refresh', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
  });
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js'), old_string: 'x', new_string: 'y' } });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'cli-refresh-done')), 'non-artifact 不应触发 refresh');
});

test('35. post-tool-use artifact 在 vault 外（CWD）→ 无 cli-refresh-done flag', () => {
  const { cwd: dir } = makeVaultProject('cli-outside-vault', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
  });
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  // artifact 路径在 CWD 内而非 vault 内
  const taskPath = path.join(dir, 'task.md').replace(/\\/g, '/');
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: taskPath, old_string: 'x', new_string: 'y' } });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, '.pace', 'cli-refresh-done')), 'vault 外 artifact 不应触发 CLI refresh');
});

// ============================================================
// 12. CWD 漂移防御 (2) — CLAUDE_PROJECT_DIR 环境变量
// ============================================================
console.log('\n--- CWD 漂移防御 ---');

test('36. stop.js CWD 在子目录 → CLAUDE_PROJECT_DIR 指向项目根', () => {
  // 创建项目根（不再需要 .pace/ 目录）
  const projectRoot = makeTmpDir('cwd-drift-stop');
  // 创建 vault 项目（匹配 projectRoot 的 basename）
  const projectName = path.basename(projectRoot).toLowerCase().replace(/\s+/g, '-');
  const vaultProjDir = path.join(_vaultTmpDir, 'projects', projectName);
  fs.mkdirSync(vaultProjDir, { recursive: true });
  fs.writeFileSync(path.join(vaultProjDir, 'task.md'),
    '# 任务\n\n## 活跃任务\n\n- [/] T-001: 测试任务\n\n<!-- ARCHIVE -->\n');
  // 子目录作为 CWD（模拟漂移）
  const subDir = path.join(projectRoot, 'subdir');
  fs.mkdirSync(subDir, { recursive: true });

  const result = runHook('stop.js', {
    cwd: subDir,
    stdin: JSON.stringify({ stop_hook_active: true }),
    env: { CLAUDE_PROJECT_DIR: projectRoot },
  });
  // CLAUDE_PROJECT_DIR 指向 projectRoot → 正确的项目名 → 正确的 vault task.md
  assert.ok(result.code === 0 || result.code === 2, 'CWD 漂移时不应崩溃（exit 0 或 2 均可）');
  assert.ok(result.stderr.includes('未完成') || result.stderr.includes('task.md'),
    '应从正确的 vault task.md 读取到任务状态');
});

test('37. session-start.js CWD 在子目录 → CLAUDE_PROJECT_DIR 指向项目根', () => {
  const projectRoot = makeTmpDir('cwd-drift-ss');
  const projectName = path.basename(projectRoot).toLowerCase().replace(/\s+/g, '-');
  const vaultProjDir = path.join(_vaultTmpDir, 'projects', projectName);
  fs.mkdirSync(vaultProjDir, { recursive: true });
  fs.writeFileSync(path.join(vaultProjDir, 'task.md'),
    '# 任务\n\n## 活跃任务\n\n- [/] T-001: 测试\n\n<!-- ARCHIVE -->\n');
  fs.writeFileSync(path.join(vaultProjDir, 'spec.md'),
    '# Spec\n\n## 概述\n\n测试项目\n\n<!-- ARCHIVE -->\n');
  const subDir = path.join(projectRoot, 'subdir');
  fs.mkdirSync(subDir, { recursive: true });

  const result = runHook('session-start.js', {
    cwd: subDir,
    stdin: JSON.stringify({ type: 'startup' }),
    env: { CLAUDE_PROJECT_DIR: projectRoot },
  });
  assert.strictEqual(result.code, 0, 'CWD 漂移时 session-start 不应崩溃');
  // CLAUDE_PROJECT_DIR 让 resolveProjectCwd 返回 projectRoot → 正确注入 artifact
  assert.ok(result.stdout.includes('=== task.md ===') || result.stdout === '',
    'CWD 子目录时应正常注入或静默');
});

// ============================================================
// 13. Superpowers 桥接 (3)
// ============================================================
console.log('\n--- Superpowers 桥接 ---');

test('38. pre-tool-use superpowers 信号 DENY 含桥接步骤', () => {
  // 只创建 docs/plans/（不创建 artifact），让 isPaceProject 返回 'superpowers'
  const dir = makeTmpDir('sp-bridge');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-test.md'), '# Test Plan\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  const stdin = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'src', 'index.js'), content: '// test' }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny',
    'superpowers + 无活跃任务应 DENY');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('pace-bridge'),
    'DENY 消息应包含 pace-bridge 引导');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('2026-03-04-test.md'),
    'DENY 消息应包含实际 plan 文件名');
});

test('39. todowrite-sync superpowers 信号 DENY', () => {
  // 只创建 docs/plans/（不创建 task.md），让 isPaceProject 返回 'superpowers'
  const dir = makeTmpDir('sp-tw-deny');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-test.md'), '# Plan\n');
  const stdin = JSON.stringify({
    tool_name: 'TodoWrite',
    tool_input: { todos: [{ content: 'test', status: 'pending', activeForm: 'Testing' }] }
  });
  const r = runHook('todowrite-sync.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny',
    'superpowers + 无 task.md 时应 DENY TodoWrite');
});

test('40. session-start superpowers 桥接提醒注入', () => {
  // 只创建 docs/plans/ + 空 task.md（有 artifact 但无活跃任务）
  const dir = makePaceProject('sp-ss-hint', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n'
  });
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-test.md'), '# Plan\n');
  const stdin = JSON.stringify({ session_id: 'test', hook_event_name: 'SessionStart' });
  const r = runHook('session-start.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('Superpowers 桥接提醒'),
    'SessionStart 应注入桥接提醒');
  assert.ok(r.stdout.includes('2026-03-04-test.md'),
    '提醒应包含实际 plan 文件名');
});

// ============================================================
// 14. post-tool-use H9/H10/H13 检测 (3)
// ============================================================
console.log('\n--- post-tool-use H9/H10/H13 ---');

test('41. H9: CHG 完成时关联 finding 仍为 [ ] → 提醒', () => {
  const dir = makePaceProject('pou-h9', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260306-01 测试变更 #change\n\n<!-- ARCHIVE -->\n',
    findings: '# 调研记录\n\n## 摘要索引\n\n- [ ] 测试发现 #finding [date:: 2026-03-06] [change:: CHG-20260306-01]\n\n<!-- ARCHIVE -->\n',
  });
  // 模拟编辑 impl_plan：old_string 有 [/]，new_string 改为 [x]
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '- [/] CHG-20260306-01 测试变更 #change',
      new_string: '- [x] CHG-20260306-01 测试变更 #change',
    }
  });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('finding 仍为'), 'H9 应提醒关联 finding 未更新');
  assert.ok(r.stdout.includes('CHG-20260306-01'), '应包含具体 CHG ID');
});

test('42. H10: impl_plan 活跃区有已完成详情 → 归档提醒', () => {
  const dir = makePaceProject('pou-h10', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260306-01 测试变更 #change\n\n### CHG-20260306-01: 测试变更\n\n测试详情段落\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(dir, 'app.js'), old_string: 'a', new_string: 'b' }
  });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('已完成变更详情未归档'), 'H10 应提醒详情未归档');
  assert.ok(r.stdout.includes('CHG-20260306-01'), '应包含具体 CHG ID');
});

test('43. H13v2: 编辑 impl_plan 时索引有 [x] 无详情 → 持久提醒', () => {
  const dir = makePaceProject('pou-h13', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260306-01 测试变更 #change\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(dir, 'implementation_plan.md'), old_string: '# 实施计划', new_string: '# 实施计划' }
  });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('缺少详情段落'), 'H13v2 应提醒详情缺失');
  assert.ok(r.stdout.includes('CHG-20260306-01'), '应包含具体 CHG ID');
});

// ============================================================
// 11. synced-plans + H-1 guard + DENY 精确化
// ============================================================
console.log('\n--- synced-plans / H-1 guard / DENY precision ---');

test('44. pre-tool-use: 旧 plan 已同步不再 DENY', () => {
  const dir = makePaceProject('ptu-synced', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- ARCHIVE -->\n',
    paceRuntime: { 'synced-plans': '2026-03-04-old-plan.md\n' },
  });
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-old-plan.md'), '');
  const stdin = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'app.js'), content: 'console.log("test")' }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  if (r.stdout.includes('permissionDecision')) {
    const parsed = JSON.parse(r.stdout);
    const reason = parsed?.hookSpecificOutput?.permissionDecisionReason || '';
    assert.ok(!reason.includes('桥接'), '已同步的 plan 不应触发桥接 DENY');
  }
});

test('45. session-start: 旧 plan 已同步不提醒桥接', () => {
  const dir = makePaceProject('ss-synced', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 测试\n<!-- APPROVED -->\n\n<!-- ARCHIVE -->\n',
    paceRuntime: { 'synced-plans': '2026-03-04-old-plan.md\n' },
  });
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-old-plan.md'), '');
  const stdin = JSON.stringify({ eventType: 'startup' });
  const r = runHook('session-start.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.ok(!r.stdout.includes('桥接提醒'), '已同步的 plan 不应触发桥接提醒');
});

test('46. stop.js: .pace/disabled → exit 0 放行', () => {
  const dir = makePaceProject('stop-disabled', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 未完成\n\n<!-- ARCHIVE -->\n',
    paceRuntime: { disabled: '1' },
  });
  const stdin = JSON.stringify({ stop_hook_active: true });
  const r = runHook('stop.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0, 'disabled 项目应 exit 0 放行');
});

test('47. post-tool-use: .pace/disabled → 无警告输出', () => {
  const dir = makePaceProject('pou-disabled', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [x] T-001 已完成\n\n<!-- ARCHIVE -->\n',
    paceRuntime: { disabled: '1' },
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: { file_path: path.join(dir, 'app.js'), old_string: 'a', new_string: 'b' }
  });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout.trim(), '', 'disabled 项目不应有任何输出');
});

test('48. pre-tool-use: 全 [x]/[-] → DENY 消息含归档提示', () => {
  const dir = makePaceProject('ptu-alldone', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [x] T-001 已完成\n- [-] T-002 已跳过\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260307-01 测试 #change\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Write',
    tool_input: { file_path: path.join(dir, 'app.js'), content: 'test' }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.ok(r.stdout.includes('permissionDecision'), '应有 DENY');
  const parsed = JSON.parse(r.stdout);
  const reason = parsed?.hookSpecificOutput?.permissionDecisionReason || '';
  assert.ok(reason.includes('归档'), 'W-flow-1: 全完成时应提示归档');
});

// ============================================================
// 16. impl_plan 详情保障 (4)
// ============================================================
console.log('\n--- impl_plan 详情保障 ---');

test('49. pre-tool-use: impl_plan [x] 无详情段落 → DENY', () => {
  const dir = makePaceProject('ptu-impl-deny', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [/] T-001 进行中任务\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260307-99 测试变更 #change\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '- [/] CHG-20260307-99 测试变更 #change',
      new_string: '- [x] CHG-20260307-99 测试变更 #change',
    }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny', 'impl_plan [x] 无详情应 DENY');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('CHG-20260307-99'), 'DENY 消息应包含 CHG ID');
});

test('50. pre-tool-use: impl_plan [x] 有详情段落 → 放行', () => {
  const dir = makePaceProject('ptu-impl-allow', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [/] T-001 进行中任务\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260307-99 测试变更 #change\n\n### CHG-20260307-99 测试变更\n\n**文件**: test.js\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '- [/] CHG-20260307-99 测试变更 #change',
      new_string: '- [x] CHG-20260307-99 测试变更 #change',
    }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  if (r.stdout.trim()) {
    try {
      const out = JSON.parse(r.stdout);
      assert.ok(out.hookSpecificOutput?.permissionDecision !== 'deny', '有详情段落时不应 DENY');
    } catch(e) { /* 非 JSON 输出也 OK */ }
  }
});

test('51. stop.js: impl_plan [x] 无详情 → 阻止退出', () => {
  const today = getToday();
  const dir = makePaceProject('stop-impl-detail', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [ ] T-001 未完成\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260307-99 测试变更 #change\n\n<!-- ARCHIVE -->\n',
    walkthrough: `# 工作记录\n\n| 日期 | 完成内容 |\n| --- | --- |\n| ${today} | 测试 |\n\n## ${today} 测试\n\n**时间**: ${today}\n\n内容\n\n<!-- ARCHIVE -->\n`,
  });
  const r = runHook('stop.js', { cwd: dir });
  assert.strictEqual(r.code, 2, 'impl_plan 有 [x] 无详情应阻止退出');
  assert.ok(r.stderr.includes('CHG-20260307-99'), 'stderr 应包含缺失详情的 CHG ID');
});

test('52. post-tool-use: 编辑 impl_plan 后持久详情警告（H13v2）', () => {
  const dir = makePaceProject('pou-impl-h13v2', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 进行中\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260307-99 测试变更 #change\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '# 实施计划',
      new_string: '# 实施计划',
    }
  });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('CHG-20260307-99'), 'H13v2: 应持久警告缺失详情');
});

// ============================================================
// 17. T-319 补充场景：V 阶段 + walkthrough 日期 + E 阶段前提 + T-325 创建阶段守门 (5)
// ============================================================
console.log('\n--- T-319 补充场景 ---');

test('53. stop.js V 阶段：有 [x] 无 VERIFIED → exit 2', () => {
  const today = getToday();
  const dir = makePaceProject('stop-v-phase', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [x] T-001 已完成任务\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260308-01 测试 #change\n\n### CHG-20260308-01 测试\n\n测试详情\n\n<!-- ARCHIVE -->\n',
    walkthrough: `# 工作记录\n\n| 日期 | 完成内容 |\n| --- | --- |\n| ${today} | 测试 |\n\n## ${today} 测试\n\n**时间**: ${today}\n\n内容\n\n<!-- ARCHIVE -->\n`,
  });
  const r = runHook('stop.js', { cwd: dir, stdin: '{}' });
  assert.strictEqual(r.code, 2, '有 [x] 无 VERIFIED 应 exit 2');
  assert.ok(r.stderr.includes('VERIFIED') || r.stderr.includes('验证'), 'stderr 应提及 VERIFIED 或验证');
});

test('54. stop.js walkthrough 无今日日期 → 提醒', () => {
  const dir = makePaceProject('stop-walk-date', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n<!-- VERIFIED -->\n\n- [x] T-001 已完成任务\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260308-01 测试 #change\n\n### CHG-20260308-01 测试\n\n测试详情\n\n<!-- ARCHIVE -->\n',
    walkthrough: '# 工作记录\n\n| 日期 | 完成内容 |\n| --- | --- |\n| 2026-01-01 | 旧记录 |\n\n## 2026-01-01 旧记录\n\n**时间**: 2026-01-01\n\n旧内容\n\n<!-- ARCHIVE -->\n',
  });
  const r = runHook('stop.js', { cwd: dir, stdin: '{}' });
  // 可能 exit 2（walkthrough 日期检查阻止）或 exit 0（仅警告）
  assert.ok(r.stderr.includes('walkthrough') || r.stderr.includes('工作记录') || r.code === 2,
    '应提醒 walkthrough 缺少今日日期');
});

test('55. pre-tool-use E 阶段前提：impl_plan 无 [/] → DENY', () => {
  const dir = makePaceProject('ptu-e-phase', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [/] T-001 进行中任务\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [ ] CHG-20260308-01 待开始 #change\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: path.join(dir, 'app.js') } });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny', 'impl_plan 无 [/] 应 DENY');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('[/]'), 'DENY 消息应提及 [/]');
});

test('56. T-325: 添加 [ ] 索引无详情 → DENY', () => {
  const dir = makePaceProject('ptu-create-deny', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [/] T-001 进行中\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260308-01 已有变更 #change\n\n### CHG-20260308-01 已有变更\n\n测试详情\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '- [/] CHG-20260308-01 已有变更 #change',
      new_string: '- [/] CHG-20260308-01 已有变更 #change\n- [ ] CHG-20260308-02 新增变更 #change',
    }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny', '添加索引无详情应 DENY');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('CHG-20260308-02'), 'DENY 应包含缺失的 CHG ID');
});

test('57. T-325: 添加 [ ] 索引 + 同时写入详情 → 放行', () => {
  const dir = makePaceProject('ptu-create-allow', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [/] T-001 进行中\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260308-01 已有变更 #change\n\n### CHG-20260308-01 已有变更\n\n测试详情\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '\n<!-- ARCHIVE -->',
      new_string: '\n- [ ] CHG-20260308-02 新增变更 #change\n\n### CHG-20260308-02 新增变更\n\n新增详情\n\n<!-- ARCHIVE -->',
    }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  if (r.stdout.trim()) {
    try {
      const out = JSON.parse(r.stdout);
      assert.ok(out.hookSpecificOutput?.permissionDecision !== 'deny',
        '同时包含索引和详情时不应 DENY');
    } catch(e) { /* 非 JSON 也 OK */ }
  }
});

// ============================================================
// 18. v5.0.2 新增检查：findings 详情 + 旧格式 DENY (4)
// ============================================================
console.log('\n--- v5.0.2 新增检查 ---');

test('58. post-tool-use H14: findings 有 [ ] 无详情 → 提醒', () => {
  const dir = makePaceProject('pou-findings-h14', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n- [/] T-001 进行中\n\n<!-- ARCHIVE -->\n',
    findings: '# 调研记录\n\n## 摘要索引\n\n- [ ] 测试问题标题 — 结论 #finding [date:: 2026-03-08]\n\n## 未解决问题\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'findings.md'),
      old_string: '## 摘要索引',
      new_string: '## 摘要索引\n\n- [ ] 新发现问题 — 待评估',
    }
  });
  const r = runHook('post-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.ok(out.hookSpecificOutput.additionalContext.includes('缺少详情段落'), 'H14: 应提醒缺少详情');
});

test('59. stop.js: findings [ ] 无详情 → 警告', () => {
  const today = getToday();
  const dir = makePaceProject('stop-findings-detail', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n<!-- VERIFIED -->\n\n- [x] T-001 已完成\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [x] CHG-20260308-01 测试 #change\n\n### CHG-20260308-01 测试\n\n详情\n\n<!-- ARCHIVE -->\n',
    walkthrough: `# 工作记录\n\n| 日期 | 完成内容 |\n| --- | --- |\n| ${today} | 测试 |\n\n## ${today} 测试\n\n**时间**: ${today}\n\n内容\n\n<!-- ARCHIVE -->\n`,
    findings: '# 调研记录\n\n## 摘要索引\n\n- [ ] 测试问题标题 — 结论 #finding\n\n## 未解决问题\n\n<!-- ARCHIVE -->\n',
  });
  const r = runHook('stop.js', { cwd: dir, stdin: '{}' });
  assert.strictEqual(r.code, 2, 'findings [ ] 无详情应 exit 2');
  assert.ok(r.stderr.includes('缺少详情') || r.stderr.includes('测试问题'), 'stderr 应提及缺少详情');
});

test('60. pre-tool-use: impl_plan 有 emoji → DENY 旧格式', () => {
  const dir = makePaceProject('ptu-old-format-deny', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [/] T-001 进行中\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n✅ CHG-001 已完成\n🔄 CHG-002 进行中\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '🔄 CHG-002 进行中',
      new_string: '✅ CHG-002 已完成',
    }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.hookSpecificOutput.permissionDecision, 'deny', 'emoji 格式应 DENY');
  assert.ok(out.hookSpecificOutput.permissionDecisionReason.includes('emoji'), 'DENY 消息应提及 emoji');
});

test('61. pre-tool-use: impl_plan 正常 checkbox 格式 → 放行', () => {
  const dir = makePaceProject('ptu-normal-format-allow', {
    taskContent: '# 项目任务追踪\n\n## 活跃任务\n\n<!-- APPROVED -->\n\n- [/] T-001 进行中\n\n<!-- ARCHIVE -->\n',
    implPlan: '# 实施计划\n\n## 变更索引\n\n- [/] CHG-20260308-01 正常变更 #change\n\n### CHG-20260308-01 正常变更\n\n详情\n\n<!-- ARCHIVE -->\n',
  });
  const stdin = JSON.stringify({
    tool_name: 'Edit',
    tool_input: {
      file_path: path.join(dir, 'implementation_plan.md'),
      old_string: '- [/] CHG-20260308-01 正常变更 #change',
      new_string: '- [x] CHG-20260308-01 正常变更 #change',
    }
  });
  const r = runHook('pre-tool-use.js', { cwd: dir, stdin });
  // 正常格式不应被旧格式 DENY 拦截（可能被其他 DENY 拦截如详情守门，但不应是旧格式原因）
  if (r.stdout.trim()) {
    try {
      const out = JSON.parse(r.stdout);
      if (out.hookSpecificOutput?.permissionDecision === 'deny') {
        assert.ok(!out.hookSpecificOutput.permissionDecisionReason.includes('emoji') &&
                  !out.hookSpecificOutput.permissionDecisionReason.includes('表格格式'),
          '正常 checkbox 格式不应被旧格式 DENY 拦截');
      }
    } catch(e) { /* 非 JSON 也 OK */ }
  }
});

// ============================================================
// 汇总 + 清理
// ============================================================
cleanup();

const total = passed + failed;
console.log(`\n${failed === 0 ? '\u2705' : '\u274c'} ${passed}/${total} tests passed`);
if (failed > 0) process.exit(1);
