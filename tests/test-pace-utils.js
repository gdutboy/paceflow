// pace-utils.js 纯函数单元测试
// 零依赖：仅使用 Node.js 内置 assert + fs + os.tmpdir()
// 覆盖：isPaceProject / countByStatus / readActive / checkArchiveFormat

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const paceUtils = require('../hooks/pace-utils');
const { isPaceProject, countByStatus, readActive, checkArchiveFormat, ARTIFACT_FILES, getArtifactDir, getProjectName, getProjectNameCandidates, resolveToolFilePath, isArtifactRelativePath, artifactRelativePathForFile, getProjectStateDir, getArtifactRootChoicePath, readArtifactRootChoice, getConfiguredArtifactDir, artifactRootChoiceNeeded, artifactRootChoiceMessage } = paceUtils;

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
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# test\n');
  t.tmpDirs.push(vaultDir); // 清理
  assert.strictEqual(getArtifactDir(dir), vaultDir);
});

test('vault 和 CWD 都有 → vault 优先', () => {
  const dir = makeTmpDir('gad-both');
  fs.writeFileSync(path.join(dir, 'task.md'), '# cwd\n');
  const projectName = path.basename(dir).toLowerCase().replace(/\s+/g, '-');
  const vaultDir = path.join(paceUtils.VAULT_PATH, 'projects', projectName);
  fs.mkdirSync(vaultDir, { recursive: true });
  fs.writeFileSync(path.join(vaultDir, 'task.md'), '# vault\n');
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

test('首次启用且 vault/local 都无 changes → 需要选择 artifact root', () => {
  const dir = makeTmpDir('gad-choice-needed');
  assert.strictEqual(artifactRootChoiceNeeded(dir), true);
  const msg = artifactRootChoiceMessage(dir);
  assert.ok(msg.includes('AskUserQuestion'));
  assert.ok(msg.includes(getArtifactRootChoicePath(dir)));
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
  assert.strictEqual(getArtifactRootChoicePath(worktree), path.join(host, '.pace', 'artifact-root'));
  assert.strictEqual(getArtifactDir(worktree), host);
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
  assert.ok(result.bridgeSteps.includes('task.md'), 'bridgeSteps 应提到 task.md');
  assert.ok(result.bridgeSteps.includes('artifact-writer create-chg'), 'bridgeSteps 应走 artifact writer');
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

// ============================================================
// 16. extractOpenKeys() — 4 个测试
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
  assert.strictEqual(keys[0], 'PACEflow 非常长的标题应该被截断');
});

// ============================================================
// 17. ARCHIVE_MARKER / ARCHIVE_PATTERN — 3 个测试
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

test('ARCHIVE_PATTERN 不匹配行内嵌入的标记', () => {
  const text = 'some text <!-- ARCHIVE --> more text';
  assert.ok(!paceUtils.ARCHIVE_PATTERN.test(text), '行内嵌入不应匹配');
});

// ============================================================
// 汇总 + 清理
// ============================================================
t.cleanup();

const total = t.passed + t.failed;
console.log(`\n${t.failed === 0 ? '\u2705' : '\u274c'} ${t.passed}/${total} tests passed`);
if (t.failed > 0) process.exit(1);
