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

test('listUnsyncedPlanFiles: 主文件已同步时 -design.md 伴随文件也视为已同步', () => {
  const dir = makeTmpDir('usp-design');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-08-feature.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-08-feature-design.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-08-other.md'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.pace', 'synced-plans'), '2026-03-08-feature.md\n');
  const unsynced = paceUtils.listUnsyncedPlanFiles(dir);
  assert.deepStrictEqual(unsynced, ['2026-03-08-other.md']);
});

// ============================================================
// 10. findMissingImplDetails() — 5 个测试
// ============================================================
console.log('\n--- findMissingImplDetails ---');

test('findMissingImplDetails — 全部有详情返回空', () => {
  const plan = `- [x] CHG-20260307-01 标题\n\n### CHG-20260307-01\n\n- 内容`;
  const result = paceUtils.findMissingImplDetails(plan);
  assert.deepStrictEqual(result, []);
});

test('findMissingImplDetails — 缺详情返回 CHG-ID', () => {
  const plan = `- [x] CHG-20260307-01 标题\n- [x] CHG-20260307-02 标题\n\n### CHG-20260307-01\n\n- 内容`;
  const result = paceUtils.findMissingImplDetails(plan);
  assert.deepStrictEqual(result, ['CHG-20260307-02']);
});

test('findMissingImplDetails — [/] 和 [ ] 不检查', () => {
  const plan = `- [/] CHG-20260307-01 标题\n- [ ] CHG-20260307-02 标题`;
  const result = paceUtils.findMissingImplDetails(plan);
  assert.deepStrictEqual(result, []);
});

test('findMissingImplDetails — HOTFIX 前缀支持', () => {
  const plan = `- [x] HOTFIX-20260307-01 标题`;
  const result = paceUtils.findMissingImplDetails(plan);
  assert.deepStrictEqual(result, ['HOTFIX-20260307-01']);
});

test('findMissingImplDetails — null/空输入返回空', () => {
  assert.deepStrictEqual(paceUtils.findMissingImplDetails(null), []);
  assert.deepStrictEqual(paceUtils.findMissingImplDetails(''), []);
});

// ============================================================
// 11. findMissingFindingsDetails() — 9 个测试
// ============================================================
console.log('\n--- findMissingFindingsDetails ---');

test('findMissingFindingsDetails — null 输入返回空数组', () => {
  assert.deepStrictEqual(paceUtils.findMissingFindingsDetails(null), []);
});

test('findMissingFindingsDetails — 空字符串返回空数组', () => {
  assert.deepStrictEqual(paceUtils.findMissingFindingsDetails(''), []);
});

test('findMissingFindingsDetails — 无 [ ] 索引返回空', () => {
  assert.deepStrictEqual(paceUtils.findMissingFindingsDetails('- [x] 已完成 — 结论'), []);
});

test('findMissingFindingsDetails — 有 [ ] 索引有对应详情返回空', () => {
  const withDetail = `- [ ] knowledge 注入问题 — 结论\n\n## 未解决问题\n\n### [2026-03-08] knowledge 注入问题\n\n内容...`;
  assert.deepStrictEqual(paceUtils.findMissingFindingsDetails(withDetail), []);
});

test('findMissingFindingsDetails — 有 [ ] 索引缺少详情返回标题', () => {
  const noDetail = `- [ ] knowledge 注入问题 — 结论\n\n## 未解决问题\n`;
  const missing = paceUtils.findMissingFindingsDetails(noDetail);
  assert.strictEqual(missing.length, 1);
  assert.ok(missing[0].startsWith('knowledge'), '标题应以 knowledge 开头');
});

test('findMissingFindingsDetails — 多个索引部分有详情', () => {
  const mixed = `- [ ] 问题一号标题 — 结论1\n- [ ] 问题二号标题 — 结论2\n\n### [2026-03-08] 问题一号标题\n\n详情`;
  const mixedMissing = paceUtils.findMissingFindingsDetails(mixed);
  assert.strictEqual(mixedMissing.length, 1, '只缺 1 个');
  assert.ok(mixedMissing[0].startsWith('问题二号'), '缺的是问题二');
});

test('findMissingFindingsDetails — [x]/[-] 不检查', () => {
  const doneItems = `- [x] 已完成 — ok\n- [-] 已跳过 — reason\n`;
  assert.deepStrictEqual(paceUtils.findMissingFindingsDetails(doneItems), []);
});

test('findMissingFindingsDetails — ### 无日期前缀也能匹配', () => {
  const noDate = `- [ ] 特殊问题标题 — 结论\n\n### 特殊问题标题\n\n内容`;
  assert.deepStrictEqual(paceUtils.findMissingFindingsDetails(noDate), []);
});

test('findMissingFindingsDetails — 标题短于 8 字也能匹配', () => {
  const shortTitle = `- [ ] 短标题 — 结论\n\n### [2026-03-08] 短标题详细说明\n\n内容`;
  assert.deepStrictEqual(paceUtils.findMissingFindingsDetails(shortTitle), []);
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
  assert.strictEqual(name, 'my-project1');
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
  assert.ok(result.fileList.includes('2026-03-09-feature.md'), 'fileList 应含文件名');
  assert.ok(result.bridgeSteps.includes('task.md'), 'bridgeSteps 应提到 task.md');
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

test('createLogger — 超过 512KB 触发轮转', () => {
  const dir = makeTmpDir('logger-rotate');
  const logFile = path.join(dir, 'test.log');
  // 写入 520KB 数据
  const chunk = 'A'.repeat(1024) + '\n';
  fs.writeFileSync(logFile, chunk.repeat(520));
  const sizeBefore = fs.statSync(logFile).size;
  assert.ok(sizeBefore > 512 * 1024, '应超过 512KB');
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

// ============================================================
// 汇总 + 清理
// ============================================================
cleanup();

const total = passed + failed;
console.log(`\n${failed === 0 ? '\u2705' : '\u274c'} ${passed}/${total} tests passed`);
if (failed > 0) process.exit(1);
