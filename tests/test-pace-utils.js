// pace-utils.js 纯函数单元测试
// 零依赖：仅使用 Node.js 内置 assert + fs + os.tmpdir()
// 覆盖：isPaceProject / countByStatus / readActive / checkArchiveFormat

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const paceUtils = require('../hooks/pace-utils');
const { isPaceProject, countByStatus, readActive, checkArchiveFormat, ARTIFACT_FILES, getArtifactDir, getProjectName } = paceUtils;

let passed = 0;
let failed = 0;
let tmpDirs = [];

/** 创建隔离临时目录 */
function makeTmpDir(label) {
  const dir = path.join(os.tmpdir(), `pace-test-${Date.now()}-${label}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

/** 清理所有临时目录 */
function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

/** 运行单个测试 */
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

// ============================================================
// 1. isPaceProject() — 7 个测试
// ============================================================
console.log('\n--- isPaceProject ---');

test('空目录 → false', () => {
  const dir = makeTmpDir('empty');
  assert.strictEqual(isPaceProject(dir), false);
});

test('有 task.md → artifact', () => {
  const dir = makeTmpDir('artifact');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Tasks\n');
  assert.strictEqual(isPaceProject(dir), 'artifact');
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
  // 同时有 task.md（artifact 信号）和 3 个 .js 文件（code-count 信号）
  fs.writeFileSync(path.join(dir, 'task.md'), '# Tasks\n');
  fs.writeFileSync(path.join(dir, 'a.js'), '');
  fs.writeFileSync(path.join(dir, 'b.js'), '');
  fs.writeFileSync(path.join(dir, 'c.js'), '');
  assert.strictEqual(isPaceProject(dir), 'artifact');
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
// 5. getProjectName() — 2 个测试
// ============================================================
console.log('\n--- getProjectName ---');

test('正常目录名 → 小写连字符', () => {
  assert.strictEqual(getProjectName('/foo/My Project'), 'my-project');
});

test('已小写无空格 → 原样返回', () => {
  assert.strictEqual(getProjectName('/foo/paceflow-hooks'), 'paceflow-hooks');
});

// ============================================================
// 6. getArtifactDir() — 4 个测试
// ============================================================
console.log('\n--- getArtifactDir ---');

test('CWD 有 artifact → 返回 CWD', () => {
  const dir = makeTmpDir('gad-cwd');
  fs.writeFileSync(path.join(dir, 'task.md'), '# test\n');
  // getArtifactDir 先检查 vault，vault 无 artifact → 检查 CWD → 有 → 返回 CWD
  assert.strictEqual(getArtifactDir(dir), dir);
});

test('vault 有 artifact → 返回 vault', () => {
  const dir = makeTmpDir('gad-vault');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# test\n');
  tmpDirs.push(vaultDir); // 清理
  assert.strictEqual(getArtifactDir(dir), vaultDir);
});

test('vault 和 CWD 都有 → vault 优先', () => {
  const dir = makeTmpDir('gad-both');
  fs.writeFileSync(path.join(dir, 'task.md'), '# cwd\n');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# vault\n');
  tmpDirs.push(vaultDir);
  assert.strictEqual(getArtifactDir(dir), vaultDir);
});

test('新项目（无 artifact）→ vault 目录', () => {
  const dir = makeTmpDir('gad-new');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const expected = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  assert.strictEqual(getArtifactDir(dir), expected);
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
// 8. listPlanFiles() — 3 个测试
// ============================================================
console.log('\n--- listPlanFiles ---');

test('listPlanFiles: 无 docs/plans/ 返回空数组', () => {
  const dir = makeTmpDir('lp-empty');
  assert.deepStrictEqual(paceUtils.listPlanFiles(dir), []);
});

test('listPlanFiles: 有 plan 文件按日期降序', () => {
  const dir = makeTmpDir('lp-sort');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-feature-a.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-04-feature-b.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'README.md'), '');
  const result = paceUtils.listPlanFiles(dir);
  assert.deepStrictEqual(result, ['2026-03-04-feature-b.md', '2026-03-01-feature-a.md']);
});

test('listPlanFiles: 非日期格式文件被过滤', () => {
  const dir = makeTmpDir('lp-filter');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'random-notes.md'), '');
  assert.deepStrictEqual(paceUtils.listPlanFiles(dir), []);
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
  assert.deepStrictEqual(unsynced, ['2026-03-04-feature-b.md']);
});

test('hasUnsyncedPlanFiles: 无 synced-plans 文件 → 全部视为未同步', () => {
  const dir = makeTmpDir('usp-nosync');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-feature-a.md'), '');
  assert.strictEqual(paceUtils.hasUnsyncedPlanFiles(dir), true);
  assert.deepStrictEqual(paceUtils.listUnsyncedPlanFiles(dir), ['2026-03-01-feature-a.md']);
});

// ============================================================
// 汇总 + 清理
// ============================================================
cleanup();

const total = passed + failed;
console.log(`\n${failed === 0 ? '\u2705' : '\u274c'} ${passed}/${total} tests passed`);
if (failed > 0) process.exit(1);
