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
// 汇总 + 清理
// ============================================================
cleanup();

const total = passed + failed;
console.log(`\n${failed === 0 ? '\u2705' : '\u274c'} ${passed}/${total} tests passed`);
if (failed > 0) process.exit(1);
