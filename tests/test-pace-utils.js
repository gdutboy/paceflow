// pace-utils.js 纯函数单元测试
// 零依赖：仅使用 Node.js 内置 assert + fs + os.tmpdir()
// 覆盖：isPaceProject / countByStatus / readActive / checkArchiveFormat

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const paceUtils = require('../plugin/hooks/pace-utils');
const cmdRecognition = require('../plugin/hooks/pre-tool-use/command-recognition');
const bashGuard = require('../plugin/hooks/pre-tool-use/bash-guard');
const powershellGuard = require('../plugin/hooks/pre-tool-use/powershell-guard');
const lifecycleGuard = require('../plugin/hooks/pre-tool-use/agent-lifecycle-guard');
const subagentStop = require('../plugin/hooks/subagent-stop');
const batchArchiveV5 = require('../plugin/migrate/batch-archive-v5');
const createPlanUtils = require('../plugin/hooks/pace-utils/plans');
const createLockUtils = require('../plugin/hooks/pace-utils/locks');
const { isPaceProject, daysSinceISODate, countByStatus, readActive, checkArchiveFormat, MIGRATABLE_ARTIFACT_FILES, RESERVE_ARTIFACT_ID_SCRIPT, SYNC_PLAN_SCRIPT, SET_ARTIFACT_ROOT_SCRIPT, SET_PROJECT_ROOT_SCRIPT, getArtifactDir, _clearArtifactDirCache, getProjectName, getProjectNameCandidates, resolveEffectiveProjectRoot, resolveToolFilePath, isArtifactRelativePath, artifactRelativePathForFile, executionContextForCwd, getProjectStateDir, getProjectRuntimeDir, getArtifactRootChoicePath, readArtifactRootChoice, getConfiguredArtifactDir, artifactRootChoiceNeeded, artifactRootChoiceMessage, getV5MigrationInfo, v5MigrationPromptMessage, parseHookStdin, logEntry, normalizeChangeId, detailPathForId, slugForChangeId, readArtifactWriterLock, artifactWriterLockMatches, getArtifactWriterLockPath, artifactResourceForRel, getArtifactResourceLockPath, acquireArtifactResourceLock, readArtifactResourceLock, releaseArtifactResourceLock, markIndexChangesTouchedAndMaybeRelease, reserveArtifactId, readArtifactReservation, findArtifactReservationForRel, clearArtifactReservationForRel, isArtifactRuntimeControlPath, createTemplates, writeChangeOwner, readChangeOwner, touchChangeOwnersForSession, changeOwnerStatus, hasBridgeCandidatePlanFiles, listBridgeCandidatePlanFiles, parseFrontmatter } = paceUtils;

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

test('changes 为同名文件（非目录）→ 不误判 artifact（PU-002）', () => {
  // hasChangesDir / isPaceProject 原用 existsSync，对同名文件 changes（非目录）误判为 PACE 项目
  const dir = makeTmpDir('changes-is-file');
  fs.writeFileSync(path.join(dir, 'changes'), 'not a directory');
  assert.strictEqual(isPaceProject(dir), false);
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

test('checkArchiveFormat: 应有 ARCHIVE 的双区文件完全缺失标记 → 返回缺失警告（findings.md，层1）', () => {
  const dir = makeTmpDir('caf-missing-archive');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true }); // 建 changes/ → dir 成为本地 artifact root，getArtifactDir(dir)=dir
  // findings.md 属 ARCHIVE_REQUIRED_FILES，但既无 <!-- ARCHIVE --> 也无 ## ARCHIVE
  fs.writeFileSync(path.join(dir, 'findings.md'), '# 调研记录\n\n## 未解决问题\n\n- [ ] something\n');
  const result = checkArchiveFormat(dir, 'findings.md');
  assert.ok(result !== null, '应返回缺失警告（防 session-start 全文注入）');
  assert.ok(/缺少|ARCHIVE/.test(result), `消息应提示 ARCHIVE 缺失: ${result}`);
});

test('checkArchiveFormat: spec.md 无 ARCHIVE → null（spec 无双区，不误报，层1关键）', () => {
  const dir = makeTmpDir('caf-spec-noarchive');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'spec.md'), '# 规格\n\n技术栈说明\n');
  assert.strictEqual(checkArchiveFormat(dir, 'spec.md'), null, 'spec.md 不在 ARCHIVE_REQUIRED_FILES，缺失不应报错');
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

// PU-001：绝对路径含 `.`/`..` 段必须折叠后再判定，否则 `<proj>/./changes/x.md`
// 绕过 marker-guard 等全部 artifact 写保护，并可注入 `<!-- APPROVED -->` 伪造批准门。
test('resolveToolFilePath: 绝对路径折叠 `.` 段（PU-001）', () => {
  assert.strictEqual(resolveToolFilePath('/tmp/project', '/tmp/project/./changes/chg-x.md'), '/tmp/project/changes/chg-x.md');
});

test('resolveToolFilePath: 绝对路径折叠 `..` 段（PU-001）', () => {
  assert.strictEqual(resolveToolFilePath('/tmp/project', '/tmp/project/sub/../changes/chg-x.md'), '/tmp/project/changes/chg-x.md');
});

test('resolveToolFilePath: 折叠不破坏 Windows 盘符路径（PU-001）', () => {
  // path.posix.normalize 纯字符串折叠，保留 `C:/`；若误用 path.resolve 会在非 win32 上把盘符当相对路径破坏
  assert.strictEqual(resolveToolFilePath('C:/proj', 'C:/proj/./changes/chg-x.md'), 'C:/proj/changes/chg-x.md');
});

test('isArtifactRelativePath: `.` 段形态仍判定为 artifact（PU-001 纵深防御）', () => {
  assert.strictEqual(isArtifactRelativePath('./changes/chg-x.md'), true);
  assert.strictEqual(isArtifactRelativePath('changes/./chg-x.md'), true);
  assert.strictEqual(isArtifactRelativePath('./task.md'), true);
  assert.strictEqual(isArtifactRelativePath('../outside/changes/x.md'), false);
});

test('artifactRelativePathForFile: `.`/`..` 段绝对路径不绕过 artifact 判定（PU-001）', () => {
  const dir = makeTmpDir('arff-dot-segment');
  // 字符串拼接构造含 `.` 的绝对路径（path.join 会自动折叠，无法复现绕过）
  assert.strictEqual(artifactRelativePathForFile(dir, dir + '/./changes/chg-x.md'), 'changes/chg-x.md');
  assert.strictEqual(artifactRelativePathForFile(dir, dir + '/sub/../changes/chg-x.md'), 'changes/chg-x.md');
  // control：无 `.` 段仍正常解析
  assert.strictEqual(artifactRelativePathForFile(dir, dir + '/changes/chg-x.md'), 'changes/chg-x.md');
});

// ============================================================
// command-recognition 共享识别原语（CHG-20260604-01）
// ============================================================
console.log('\n--- command-recognition ---');

const { segmentAnchorPrefix, scanRedirectTargets, commandRunsScriptEngine, BASH_WRAPPERS } = cmdRecognition;

test('segmentAnchorPrefix: 换行/分号/&&/管道/分组后的动词都被段首锚定', () => {
  const re = new RegExp(segmentAnchorPrefix({ extraChars: '\\n;&|(){}', wrappers: BASH_WRAPPERS }) + 'rm\\b', 'i');
  assert.ok(re.test('echo hi\nrm task.md'), '换行');
  assert.ok(re.test('echo hi; rm task.md'), '分号');
  assert.ok(re.test('echo hi && rm task.md'), '&&');
  assert.ok(re.test('echo hi | rm task.md'), '管道');
  assert.ok(re.test('{ rm task.md; }'), '花括号分组');
  assert.ok(re.test('(rm task.md)'), '圆括号分组');
  assert.ok(re.test('rm task.md'), '裸命令');
});

test('segmentAnchorPrefix: wrapper 与 for…do 前缀剥离后锚定动词', () => {
  const re = new RegExp(segmentAnchorPrefix({ extraChars: '\\n;&|(){}', wrappers: BASH_WRAPPERS, allowLoops: true }) + 'rm\\b', 'i');
  assert.ok(re.test('env rm task.md'), 'env');
  assert.ok(re.test('env FOO=1 rm task.md'), 'env 赋值');
  assert.ok(re.test('sudo rm task.md'), 'sudo');
  assert.ok(re.test('sudo -n rm task.md'), 'sudo flag');
  assert.ok(re.test('nohup rm task.md'), 'nohup');
  assert.ok(re.test('for f in .pace/locks/*; do rm "$f"; done'), 'for…do');
  assert.ok(re.test('ls | xargs rm task.md'), 'xargs 管道剥离（RES-GUARD）');
});

test('segmentAnchorPrefix: 不把动词作为单词一部分误锚定', () => {
  const re = new RegExp(segmentAnchorPrefix({ extraChars: '\\n;&|(){}', wrappers: BASH_WRAPPERS }) + 'rm\\b', 'i');
  assert.ok(!re.test('confirm task.md'), 'confirm 不含段首 rm');
});

test('scanRedirectTargets: 提取重定向目标，单引号内反斜杠字面不吞引号（BG-03）', () => {
  assert.deepStrictEqual(scanRedirectTargets('echo x > task.md', '\\'), ['task.md']);
  assert.deepStrictEqual(scanRedirectTargets('echo x >> changes/y.md', '\\'), ['changes/y.md']);
  assert.ok(scanRedirectTargets("echo 'C:\\' > task.md", '\\').includes('task.md'), '单引号字面后的 redirect 不漏检');
});

test('scanRedirectTargets: 引号内的 > 不算重定向', () => {
  assert.deepStrictEqual(scanRedirectTargets('echo "a > b"', '\\'), []);
  assert.deepStrictEqual(scanRedirectTargets("echo 'a > b'", '\\'), []);
});

test('commandRunsScriptEngine: 裸/路径前缀/env 包装的 node/python 都识别（BG-04）', () => {
  assert.strictEqual(commandRunsScriptEngine('node x.js'), true, '裸 node');
  assert.strictEqual(commandRunsScriptEngine('/usr/bin/node x.js'), true, '路径前缀');
  assert.strictEqual(commandRunsScriptEngine('env node x.js'), true, 'env 包装');
  assert.strictEqual(commandRunsScriptEngine('env FOO=1 python3 x.py'), true, 'env 赋值 + python3');
  assert.strictEqual(commandRunsScriptEngine('echo hi\nnode x.js'), true, '换行后');
  assert.strictEqual(commandRunsScriptEngine('cat x.js'), false, 'cat 不是引擎');
  assert.strictEqual(commandRunsScriptEngine('grep node x'), false, 'node 作搜索词不算');
});

// ============================================================
// bash-guard 识别层修复（CHG-20260604-01 T-002：BG-01~04）
// ============================================================
console.log('\n--- bash-guard BG-01~04 ---');

test('bash-guard BG-01: 换行/分组/wrapper/for…do/&& 分隔的 mutating 动词都识别', () => {
  const m = bashGuard.bashCommandLooksMutating;
  assert.ok(m('echo hi\nrm x.md'), '换行 rm');
  assert.ok(m('for f in a b; do rm "$f"; done'), 'for…do rm');
  assert.ok(m('{ rm x.md; }'), '花括号分组');
  assert.ok(m('(rm x.md)'), '圆括号分组');
  assert.ok(m('env rm x.md'), 'env wrapper');
  assert.ok(m('sudo -n rm x.md'), 'sudo wrapper');
  assert.ok(m('echo ok && rm x.md'), '&& 链式');
  assert.ok(m('rm x.md'), '裸 rm（回归）');
  assert.ok(m('echo hi; rm x.md'), '分号（回归）');
});

test('bash-guard BG-02: in-place 编辑器扩展识别', () => {
  const m = bashGuard.bashCommandLooksMutating;
  assert.ok(m('sed --in-place s/a/b/ x.md'), 'sed --in-place');
  assert.ok(m('sed -i s/a/b/ x.md'), 'sed -i（回归）');
  assert.ok(m('perl -i -pe s/a/b/ x.md'), 'perl -i -pe 拆分选项');
  assert.ok(m('perl -pi -e s/a/b/ x.md'), 'perl -pi 连写（回归）');
  assert.ok(m('sponge x.md'), 'sponge');
  assert.ok(m('gawk -i inplace {print} x.md'), 'gawk -i inplace');
});

test('bash-guard: 只读命令不误判 mutating（防 over-block）', () => {
  const m = bashGuard.bashCommandLooksMutating;
  assert.ok(!m('cat x.md'), 'cat');
  assert.ok(!m('grep foo x.md'), 'grep');
  assert.ok(!m('wc -l x.md'), 'wc');
});

test('bash-guard BG-05: python/node open() 仅写模式判 mutating，read-only open 不 over-block', () => {
  const m = bashGuard.bashCommandLooksMutating;
  assert.ok(!m("python -c \"open('x.md').read()\""), 'read-only open(f) 单参');
  assert.ok(!m("python -c \"open('x.md', 'r').read()\""), "open(f,'r') 读模式");
  assert.ok(!m("python3 -c \"data = open('x.md', 'rb').read()\""), "open(f,'rb') 读二进制");
  assert.ok(m("python -c \"open('x.md', 'w').write('z')\""), "open(f,'w') 写");
  assert.ok(m("python -c \"open('x.md', 'a').write('z')\""), "open(f,'a') 追加");
  assert.ok(m("python -c \"open('x.md', 'r+').write('z')\""), "open(f,'r+') 读写");
});

test('bash-guard BG-06: 替代引擎 deno/bun/ts-node/ruby/php 内联写 artifact 被检测', () => {
  const m = bashGuard.bashCommandLooksMutating;
  assert.ok(m("deno eval \"Deno.writeFileSync('x.md', d)\""), 'deno writeFileSync');
  assert.ok(m("bun -e \"require('fs').writeFileSync('x.md', d)\""), 'bun writeFileSync');
  assert.ok(m("ts-node -e \"require('fs').writeFileSync('x.md', d)\""), 'ts-node writeFileSync');
  assert.ok(m("ruby -e \"File.write('x.md', 'z')\""), 'ruby File.write');
  assert.ok(m("php -r \"file_put_contents('x.md', 'z');\""), 'php file_put_contents');
  assert.ok(m("php -r \"fopen('x.md', 'w');\""), 'php fopen 写模式');
  // 只读不误判（防 over-block）
  assert.ok(!m("ruby -e \"File.read('x.md')\""), 'ruby File.read 只读');
  assert.ok(!m("php -r \"file_get_contents('x.md');\""), 'php file_get_contents 只读');
});

test('bash-guard RES-GUARD: xargs 包装的 mutating 动词识别 + 只读不误判（审计 xargs 两轮点名残留）', () => {
  const m = bashGuard.bashCommandLooksMutating;
  assert.ok(m('ls | xargs rm task.md'), 'xargs rm');
  assert.ok(m('find . -name "*.md" | xargs rm'), 'find | xargs rm');
  assert.ok(m('cat list | xargs -n1 rm'), 'xargs -n1 选项剥离');
  assert.ok(!m('ls | xargs cat'), 'xargs cat 只读不误判（防 over-block）');
  assert.ok(!m('ls | xargs grep foo'), 'xargs grep 只读不误判');
});

test('bash-guard BG-01: runtime-control 锁经 for…do/分组/wrapper/换行删除均拦截', () => {
  const dir = makeTmpDir('bg-runtime');
  const mut = (cmd) => bashGuard.bashCommandMutatesArtifactRuntimeControl(cmd, dir);
  assert.ok(mut('rm .pace/locks/x'), '裸 rm 锁（回归）');
  assert.ok(mut('for f in .pace/locks/*; do rm "$f"; done'), 'for…do 删锁');
  assert.ok(mut('{ rm .pace/artifact-writer.lock; }'), '分组删锁');
  assert.ok(mut('env rm .pace/artifact-writer.lock'), 'env 删锁');
  assert.ok(mut('echo hi\nrm .pace/locks/x'), '换行删锁');
});

test('bash-guard BG-03: 单引号字面后的重定向到 artifact 不漏检', () => {
  const dir = makeTmpDir('bg-redirect');
  assert.ok(bashGuard.bashCommandRedirectsToArtifact("echo 'C:\\' > task.md", dir, dir), '单引号字面后 redirect 不漏');
  assert.ok(bashGuard.bashCommandRedirectsToArtifact('echo x > task.md', dir, dir), '普通 redirect（回归）');
});

// ============================================================
// powershell-guard 识别层修复（CHG-20260604-01 T-003：PSG-01~04 + A08）
// ============================================================
console.log('\n--- powershell-guard PSG/A08 ---');

test('powershell-guard PSG-01/02: 语句前缀 &/&&/分组/管道 ForEach 的 mutating 都识别', () => {
  const m = powershellGuard.powershellCommandLooksMutating;
  assert.ok(m('& Remove-Item x.md'), '& 调用操作符');
  assert.ok(m('Get-Date && Remove-Item x.md'), '&& 链式');
  assert.ok(m('$null=(Remove-Item x.md)'), '分组 (...)');
  assert.ok(m('gci | % { Remove-Item $_.FullName }'), '管道 ForEach { }');
  assert.ok(m('Remove-Item x.md'), '裸（回归）');
  assert.ok(m('Get-Date; Remove-Item x.md'), '分号（回归）');
});

test('powershell-guard A08: 默认别名 ri/rni/cpi/mi/clc 与 git 还原识别', () => {
  const m = powershellGuard.powershellCommandLooksMutating;
  assert.ok(m('ri x.md'), 'ri (Remove-Item)');
  assert.ok(m('rni a b'), 'rni (Rename-Item)');
  assert.ok(m('cpi a b'), 'cpi (Copy-Item)');
  assert.ok(m('mi a b'), 'mi (Move-Item)');
  assert.ok(m('clc x.md'), 'clc (Clear-Content)');
  assert.ok(m('git checkout x.md'), 'git checkout（与 bash 对称）');
});

test('powershell-guard A08: ri 别名删 runtime-control 锁被拦截', () => {
  const dir = makeTmpDir('ps-runtime');
  const mut = (cmd) => powershellGuard.powershellCommandMutatesArtifactRuntimeControl(cmd, dir);
  assert.ok(mut('Remove-Item .pace/artifact-writer.lock'), 'Remove-Item 锁（回归）');
  assert.ok(mut('ri .pace/artifact-writer.lock'), 'ri 删锁（A08）');
  assert.ok(mut('& Remove-Item .pace/locks/x'), '& 前缀删锁（PSG-01）');
});

test('powershell-guard PSG-03: 反引号转义路径仍匹配 artifact', () => {
  const dir = makeTmpDir('ps-backtick');
  assert.ok(powershellGuard.powershellCommandReferencesArtifact('Set-Content ta`sk.md x', dir, dir), '反引号转义路径 ta`sk.md');
});

test('powershell-guard PSG-04/A02: 只读命令含 writeFileSync token 不 over-block', () => {
  const dir = makeTmpDir('ps-overblock');
  assert.ok(!powershellGuard.powershellCommandEmbedsArtifactWriteScript('Get-Content task.md | Select-String writeFileSync', dir, dir), '只读 Select-String token 放行');
  assert.ok(powershellGuard.powershellCommandEmbedsArtifactWriteScript("node -e \"require('fs').writeFileSync('task.md','x')\"", dir, dir), 'node 引擎写 artifact 仍拦');
});

test('powershell-guard RES-GUARD: `n/`r 语句分隔后的 mutating 识别（PSG-03 反噬修正）', () => {
  const m = powershellGuard.powershellCommandLooksMutating;
  // PowerShell `n 是单行多语句最地道写法，应当语句分隔符识别——不被剥成字面 n 而失锚
  assert.ok(m('Write-Host hi`nRemove-Item task.md'), '`n 分隔的 Remove-Item');
  assert.ok(m('Write-Host hi`r`nRemove-Item task.md'), '`r`n 分隔（CRLF）');
  // 只读不误判：`n 分隔的纯读命令不算 mutating（防 over-block）
  assert.ok(!m('Write-Host hi`nGet-Content task.md'), '`n 分隔 Get-Content 只读不误判');
  // 回归护栏：`s 等非分隔转义仍剥成字面（ta`sk.md → task.md，PSG-03 原行为）
  const dir = makeTmpDir('ps-backtick-regress');
  assert.ok(powershellGuard.powershellCommandReferencesArtifact('Set-Content ta`sk.md x', dir, dir), 'ta`sk.md 仍匹配 task.md');
});

test('powershell-guard RES-GUARD: `n 分隔删 runtime-control 锁被拦截', () => {
  const dir = makeTmpDir('ps-backtick-n-lock');
  const mut = (cmd) => powershellGuard.powershellCommandMutatesArtifactRuntimeControl(cmd, dir);
  assert.ok(mut('Write-Host x`nRemove-Item .pace/artifact-writer.lock'), '`n 分隔删锁');
});

test('powershell-guard HOTFIX-01: 双引号字面内 `n 不当语句分隔（over-block 防护，CHG-08 T-003 回归）', () => {
  const m = powershellGuard.powershellCommandLooksMutating;
  // 双引号字符串字面内的 `n 是输出文本换行、非命令分隔——字面内以 mutating cmdlet 开头的行不应被误判 mutating
  assert.ok(!m('Write-Output "task.md`nRemove-Item temp`ndone"'), '字面内 `n + Remove-Item 行首不误判（over-block）');
  assert.ok(!m('Write-Output "Updated task.md`nNew-Item logs created"'), '字面内 `n + New-Item 行首不误判');
  assert.ok(!m('Write-Host "See task.md`nMove-Item backup saved"'), '字面内 `n + Move-Item 行首不误判');
  // 回归护栏：引号【外】的 `n 仍当语句分隔——T-003 多语句绕过检测保住
  assert.ok(m('Write-Host hi`nRemove-Item task.md'), '引号外 `n 多语句仍检测（T-003 不退）');
  assert.ok(m('Write-Host hi`r`nRemove-Item task.md'), '引号外 `r`n 仍检测');
});

test('bash-guard HCR-01: open() mode= 关键字参数写模式识别（BG-05 收窄反噬修正）', () => {
  const m = bashGuard.bashCommandLooksMutating;
  assert.ok(m("python -c \"open('task.md', mode='w')\""), 'mode= 关键字（第二参）');
  assert.ok(m("python -c \"open(file='task.md', mode='w')\""), 'file=/mode= 全关键字');
  assert.ok(m("python3 -c \"open('task.md', encoding='utf8', mode='w')\""), 'mode= 在第三参');
  // 位置参回归 + 只读不误判（防 over-block）
  assert.ok(m("python -c \"open('task.md', 'w')\""), '位置参 w（回归）');
  assert.ok(!m("python -c \"open('task.md', mode='r')\""), 'mode=r 只读不误判');
  assert.ok(!m("python -c \"open('task.md').read()\""), '无模式只读（回归）');
});

test('powershell-guard HCR-01: open() mode= 识别 + 只读不 over-block（与 bash BG-05 对称）', () => {
  const m = powershellGuard.powershellCommandLooksMutating;
  assert.ok(m("python -c \"open('task.md', mode='w')\""), 'ps open mode=w');
  assert.ok(m("python -c \"open('task.md', 'w')\""), 'ps open 位置参 w');
  // 修 bash↔ps 不对称：ps:118 裸 open\\s*\\( 此前 over-block 只读
  assert.ok(!m("python -c \"open('task.md').read()\""), 'ps 只读 open 不 over-block');
  assert.ok(!m("python -c \"open('task.md', 'r')\""), 'ps open 读模式不误判');
});

// ============================================================
// CHG-B 解析/生命周期正确性（A05/A06/A07）
// ============================================================
console.log('\n--- CHG-B parse/lifecycle ---');

test('A05: agent-lifecycle-guard operation/action 行带尾随文字仍强制必填字段', () => {
  const deny = lifecycleGuard.agentLifecyclePromptDenyReason;
  assert.ok(deny('operation: close-chg 顺便归档\ntarget: CHG-20260101-01').includes('缺少必填字段'), 'close-chg 尾随文字缺字段应 deny');
  assert.ok(deny('operation: update-chg 立刻\naction: approve-and-start\ntarget: CHG-20260101-01').includes('缺少必填字段'), 'update-chg 尾随 + approve-and-start 缺字段应 deny');
  assert.ok(deny('operation: close-chg\ntarget: CHG-20260101-01').includes('缺少必填字段'), '干净 close-chg 缺字段 deny（回归）');
  assert.strictEqual(deny('operation: close-chg\ntarget: CHG-20260101-01\nverification-confirmed: true\ncomplete-open-tasks: true\nverify-summary: ok\nreview-confirmed: true\nreview-source: manual\nreview-findings: 0\nwalkthrough-summary: done'), '', '完整 close-chg 放行（回归）');
});

test('A06: v5 ignored 后 v5MigrationPromptMessage 抑制（修 Stop 死锁）', () => {
  const dir = makeTmpDir('a06-v5-ignored');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [ ] Legacy v5 item\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), '# Implementation Plan\n\n- [ ] Legacy v5 impl\n', 'utf8');
  assert.ok(paceUtils.v5MigrationPromptMessage(dir), 'v5 detected + needsPrompt 应返回迁移提示');
  const statePath = paceUtils.getV5MigrationInfo(dir).statePath;
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, 'ignored\n', 'utf8');
  assert.strictEqual(paceUtils.v5MigrationPromptMessage(dir), '', 'ignored 后抑制提示');
});

test('A07: 大写 [X] 索引行不污染 classifyChange', () => {
  const dir = makeTmpDir('a07-uppercase-checkbox');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'changes', 'chg-20260101-01.md'),
    '---\nchg-id: CHG-20260101-01\nstatus: completed\ntype: change\nschema-version: "6.0"\nverified-date: null\n---\n\n## 任务清单\n\n- [x] T-001 done\n\n<!-- APPROVED -->\n\n## 实施详情\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'task.md'), '# t\n\n## 活跃任务\n\n- [X] [[chg-20260101-01]] 测试 #change [tasks:: T-001]\n\n<!-- ARCHIVE -->\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), '# i\n\n## 变更索引\n\n- [x] [[chg-20260101-01]] 测试 #change [tasks:: T-001]\n\n<!-- ARCHIVE -->\n', 'utf8');
  const e = paceUtils.getActiveChangeEntries(dir).find(x => x.id === 'CHG-20260101-01');
  assert.ok(e, '应解析到 CHG-20260101-01');
  const cls = paceUtils.classifyChange(e);
  assert.notStrictEqual(cls.reason, 'index-mismatch', '大写 [X] 不应误报 index-mismatch');
  assert.strictEqual(cls.category, 'closing-required', '应判 closing-required');
});

test('PSP-02: inferCloseTarget operation/target 同源（不跨 candidate 借 target）', () => {
  const ict = subagentStop.inferCloseTarget;
  // 同源：同一 candidate 同时有 operation + 显式 target → 正常返回
  const same = ict({ toolInput: { prompt: 'operation: close-chg\ntarget: CHG-20260101-01' }, raw: {} });
  assert.strictEqual(same.operation, 'close-chg');
  assert.strictEqual(same.target, 'CHG-20260101-01');
  // 不同源：operation 在 prompt（无 target），CHG id 只在 lastMessage → missing-target（不借）
  const diff = ict({ toolInput: { prompt: 'operation: close-chg' }, lastMessage: '处理了 CHG-20260202-02 相关讨论', raw: {} });
  assert.strictEqual(diff.operation, 'close-chg');
  assert.strictEqual(diff.target, '', '不同源不借 target');
  assert.strictEqual(diff.reason, 'missing-target');
  // 无 close/archive operation → missing-operation
  assert.strictEqual(ict({ lastMessage: 'CHG-20260202-02 完成', raw: {} }).reason, 'missing-operation');
});

// ============================================================
// CHG-C v5 迁移闭环（MIGV5-03/TM-01 transformV5Body）
// ============================================================
console.log('\n--- CHG-C transformV5Body ---');

test('MIGV5-03/TM-01: transformV5Body frontmatter 检测排除 block scalar 缩进与主题分隔线', () => {
  const tv = batchArchiveV5.transformV5Body;
  // TM-01：frontmatter 内 block scalar 缩进的 --- 不应被误判为 frontmatter 结束
  const blockScalar = '---\nsummary: |\n  line1\n  ---\n  line2\nkey: val\n---\n\n# 标题\n正文\n';
  const out1 = tv(blockScalar);
  assert.ok(out1.includes('## (v5 历史) 标题'), 'block scalar 缩进 --- 不应截断 frontmatter（标题应在正文区降级）');
  // MIGV5-03：开头主题分隔线 ---（无 YAML key）不应被当 frontmatter
  const hrule = '---\n\n# 真正的标题\n正文内容\n---\n更多\n';
  const out2 = tv(hrule);
  assert.ok(!out2.includes('### v5 原始 frontmatter'), '开头主题分隔线不应被当 frontmatter');
  // 回归：正常 frontmatter 正确识别
  const normal = '---\nsummary: x\nstatus: active\n---\n\n# 任务\n内容\n';
  const out3 = tv(normal);
  assert.ok(out3.includes('### v5 原始 frontmatter'), '正常 frontmatter 应识别');
  assert.ok(out3.includes('summary: x'), 'frontmatter 内容保留');
  assert.ok(out3.includes('## (v5 历史) 任务'), 'H1 降级');
});

test('MIGV5-01: --force 无 backup 且目标已 v6 时拒绝迁移，防销毁原始数据', () => {
  const dir = makeTmpDir('migv5-force-protect');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  // 模拟已迁移的 v6 task.md（含 v5 历史归档标志），且无 .v5-backup
  fs.writeFileSync(path.join(dir, 'task.md'), '# 项目任务追踪\n\n## 活跃任务\n\n\n<!-- ARCHIVE -->\n\n## v5 历史归档\n旧内容\n', 'utf8');
  assert.throws(() => batchArchiveV5.archiveV5(dir, false, true), /已是迁移后的 v6|销毁/);
});

test('MIGV5-02: 阶段一失败时零写盘（两阶段原子性）', () => {
  const dir = makeTmpDir('migv5-stage1-atomic');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [ ] item\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'findings.md'), '# 调研记录\n\n- [ ] f\n', 'utf8');
  // findings.md.v5-backup 是目录 + force → 阶段一 readFileSync(目录) 抛错，整体中止
  fs.mkdirSync(path.join(dir, 'findings.md.v5-backup'), { recursive: true });
  assert.throws(() => batchArchiveV5.archiveV5(dir, false, true));
  // 阶段一失败 → 未写任何 backup、未建 changes/（零写盘）
  assert.ok(!fs.existsSync(path.join(dir, 'task.md.v5-backup')), '阶段一失败不应已写 task.md backup');
  assert.ok(!fs.existsSync(path.join(dir, 'changes')), '阶段一失败不应已建 changes/');
});

test('MIGV5-02-REG: force+hasBackup 阶段二失败回滚还原【调用前真实状态】而非原始 v5 备份', () => {
  const dir = makeTmpDir('migv5-02-reg');
  // 每个 migratable artifact：当前内容=调用前真实状态（CURRENT），.v5-backup=原始 v5（ORIGINAL）——二者不同是本回归关键
  const v5Files = ['task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
  for (const f of v5Files) {
    fs.writeFileSync(path.join(dir, f), `# ${f}\n\n调用前真实状态 CURRENT_${f}\n`, 'utf8');
    fs.writeFileSync(path.join(dir, `${f}.v5-backup`), `# ${f}\n\n原始 v5 备份 ORIGINAL_${f}\n`, 'utf8');
  }
  // 注入阶段二写失败：findings.md（plan 末位）改成目录 → 阶段二 writeFileSync(目录) 抛 EISDIR，触发回滚前面已写的 task/impl/walkthrough
  fs.rmSync(path.join(dir, 'findings.md'));
  fs.mkdirSync(path.join(dir, 'findings.md'));
  assert.throws(() => batchArchiveV5.archiveV5(dir, false, true), /回滚|失败/);
  // force+hasBackup 时 sourcePath=backup，p.original 是原始 v5；回滚 before 若用 p.original 会把 task.md 写成原始 v5（保真度回归）
  const taskAfter = fs.readFileSync(path.join(dir, 'task.md'), 'utf8');
  assert.ok(taskAfter.includes('CURRENT_task.md'), '回滚应还原 task.md 调用前真实状态');
  assert.ok(!taskAfter.includes('ORIGINAL_task.md'), 'force+hasBackup 回滚不应还原成原始 v5 备份内容');
});

test('A03: 迁移成功写 migrated state，回滚后 v5 可被重新检测', () => {
  const dir = makeTmpDir('migv5-a03-state');
  fs.writeFileSync(path.join(dir, 'task.md'), '# Task\n\n- [ ] item\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'implementation_plan.md'), '# Implementation Plan\n\n- [ ] impl\n', 'utf8');
  batchArchiveV5.archiveV5(dir, false, false);
  const info = paceUtils.getV5MigrationInfo(dir);
  assert.strictEqual(info.state, 'migrated', '迁移成功应写 migrated state');
  // 模拟按回滚指引回滚：恢复文件 + 删 changes/ + 删 state
  for (const f of ['task.md', 'implementation_plan.md']) {
    const bp = path.join(dir, `${f}.v5-backup`);
    if (fs.existsSync(bp)) fs.copyFileSync(bp, path.join(dir, f));
  }
  fs.rmSync(path.join(dir, 'changes'), { recursive: true, force: true });
  fs.rmSync(info.statePath, { force: true });
  assert.strictEqual(paceUtils.getV5MigrationInfo(dir).detected, true, '回滚后 v5 应可被重新检测（不再落入盲区）');
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
// 5c. session id + runtime locks
// ============================================================
console.log('\n--- session id + runtime locks ---');

test('parseHookStdin 解析 session_id 且 logEntry 自动带 sid', () => {
  // currentSessionId() 优先读 env.CLAUDE_CODE_SESSION_ID，会覆盖 parseHookStdin 记录的值；
  // 真实 Claude Code 会话内该 env 非空，故测试前临时清除以验证 stdin→logEntry 链路，finally 恢复避免污染后续用例。
  const savedSid = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  try {
    const parsed = parseHookStdin(JSON.stringify({ session_id: 'session-test-1', tool_name: 'Bash' }));
    assert.strictEqual(parsed.sessionId, 'session-test-1');
    assert.ok(logEntry('UnitHook', 'TEST', { proj: 'demo' }).includes('sid=session-test-1'));
  } finally {
    if (savedSid === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = savedSid;
  }
});

test('legacy artifact-writer lock 只作为兼容阻断信号读取', () => {
  const dir = makeTmpDir('legacy-awl-read');
  const lockPath = getArtifactWriterLockPath(dir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    sessionId: 'sid-legacy',
    agentId: 'agent-legacy',
    artifactDir: dir,
    timestampMs: Date.now(),
  }), 'utf8');
  assert.strictEqual(readArtifactWriterLock(dir).sessionId, 'sid-legacy');
  assert.strictEqual(artifactWriterLockMatches(dir, 'sid-legacy').ok, true);
  assert.strictEqual(artifactWriterLockMatches(dir, 'sid-other').ok, false);
});

test('legacy artifact-writer stale lock 读取时清理，不再重建项目级锁', () => {
  const dir = makeTmpDir('legacy-awl-stale');
  const lockPath = getArtifactWriterLockPath(dir);
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    sessionId: 'sid-stale',
    artifactDir: dir,
    timestampMs: 1,
  }), 'utf8');
  const match = artifactWriterLockMatches(dir, 'sid-stale');
  assert.strictEqual(match.ok, false);
  assert.strictEqual(match.reason, 'stale-cleared');
  assert.strictEqual(fs.existsSync(lockPath), false);
});

test('json lock 默认允许同 owner 重入，序列锁可显式关闭重入', () => {
  const dir = makeTmpDir('json-lock-reentrant-option');
  const lockUtils = createLockUtils({
    getProjectRuntimeDir: d => path.join(d, '.pace'),
    displayDir: d => `${String(d || '').replace(/\\/g, '/')}/`,
    normalizeSessionId: s => String(s || '').trim(),
    currentSessionId: () => 'sid-json-lock',
    executionContextForCwd: () => ({ text: '[worktree:: main] [branch:: main]' }),
    normalizePath: p => String(p || '').replace(/\\/g, '/'),
    getArtifactDir: d => d,
    todayISO: () => '2026-05-30',
    CHANGE_OWNER_TTL_MS: paceUtils.CHANGE_OWNER_TTL_MS,
    PROJECT_ROOT_FILE: paceUtils.PROJECT_ROOT_FILE,
  });
  const lockPath = path.join(dir, '.pace', 'locks', 'sequences', 'chg.lock');
  const payload = { sessionId: 'sid-json-lock', ownerKey: 'session:sid-json-lock', resource: 'sequence:chg' };
  const first = lockUtils.acquireJsonLock(lockPath, payload, { ttlMs: 30000, waitMs: 1 });
  const exclusive = lockUtils.acquireJsonLock(lockPath, payload, { ttlMs: 30000, waitMs: 1, reentrant: false });
  const reentrant = lockUtils.acquireJsonLock(lockPath, payload, { ttlMs: 30000, waitMs: 1 });
  assert.strictEqual(first.acquired, true);
  assert.strictEqual(exclusive.acquired, false);
  assert.strictEqual(exclusive.reason, 'locked');
  assert.strictEqual(reentrant.acquired, true);
  assert.strictEqual(reentrant.reentrant, true);
});

test('acquireJsonLock: in-flight 空锁文件（mtime 新）不被判 stale 抢占（ROB-02）', () => {
  const dir = makeTmpDir('json-lock-inflight-empty');
  const lockUtils = createLockUtils({
    getProjectRuntimeDir: d => path.join(d, '.pace'),
    displayDir: d => `${String(d || '').replace(/\\/g, '/')}/`,
    normalizeSessionId: s => String(s || '').trim(),
    currentSessionId: () => 'sid-inflight',
    executionContextForCwd: () => ({ text: '[worktree:: main] [branch:: main]' }),
    normalizePath: p => String(p || '').replace(/\\/g, '/'),
    getArtifactDir: d => d,
    todayISO: () => '2026-06-04',
    CHANGE_OWNER_TTL_MS: paceUtils.CHANGE_OWNER_TTL_MS,
    PROJECT_ROOT_FILE: paceUtils.PROJECT_ROOT_FILE,
  });
  const lockPath = path.join(dir, '.pace', 'locks', 'sequences', 'chg.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  // 模拟另一进程 openSync(wx) 已建锁但尚未写 body 的 in-flight 空文件窗口
  fs.writeFileSync(lockPath, '');
  const r = lockUtils.acquireJsonLock(lockPath, { sessionId: 'sid-other', ownerKey: 'session:sid-other', resource: 'sequence:chg' }, { ttlMs: 30000, waitMs: 5, reentrant: false });
  assert.strictEqual(r.acquired, false, 'in-flight 空锁（mtime 新）不应被判 stale 抢占');
  assert.ok(fs.existsSync(lockPath), 'in-flight 空锁文件不应被 unlink');
});

test('reserveArtifactId 遇同 session sequence lock 不重入分配重复编号', () => {
  const dir = makeTmpDir('reservation-sequence-no-reentrant');
  fs.mkdirSync(path.join(dir, 'changes'), { recursive: true });
  const origSid = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = 'sid-sequence-lock';
  try {
    const compact = paceUtils.todayISO().replace(/-/g, '');
    const lockPath = path.join(dir, '.pace', 'locks', 'sequences', `chg-${compact}.lock`);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify({
      version: 'sequence-v1',
      resource: `sequence:chg-${compact}`,
      sessionId: 'sid-sequence-lock',
      ownerKey: 'session:sid-sequence-lock',
      timestampMs: Date.now(),
    }), 'utf8');
    const result = reserveArtifactId(dir, {
      sessionId: 'sid-sequence-lock',
      artifactDir: dir,
      operation: 'create-chg',
      prompt: 'operation: create-chg',
    });
    assert.strictEqual(result.reserved, false);
    assert.strictEqual(result.reason, 'sequence-locked');
  } finally {
    if (origSid === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = origSid;
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
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'locks')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'locks', 'artifacts', 'x.lock')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'sequences', 'chg.counter')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'reservations', 'session.json')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'index-transactions', 'session.json')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'change-owners')), true);
  assert.strictEqual(isArtifactRuntimeControlPath(dir, path.join(dir, '.pace', 'change-owners', 'chg-20260504-01.json')), true);
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

test('changeOwnerStatus: sid 无法确定（缺 session_id + env 空）时 foreign owner 判 unknown 不 foreign（STOP-03）', () => {
  const dir = makeTmpDir('owner-stop03');
  const lockUtils = createLockUtils({
    getProjectRuntimeDir: d => path.join(d, '.pace'),
    displayDir: d => `${String(d || '').replace(/\\/g, '/')}/`,
    normalizeSessionId: s => String(s || '').trim(),
    currentSessionId: () => '',
    executionContextForCwd: d => ({ cwd: d, stateDir: d, worktree: 'wt-current', branch: 'br-current', text: '[worktree:: wt-current] [branch:: br-current]' }),
    normalizePath: p => String(p || '').replace(/\\/g, '/'),
    getArtifactDir: d => d,
    todayISO: () => '2026-06-05',
    CHANGE_OWNER_TTL_MS: paceUtils.CHANGE_OWNER_TTL_MS,
    PROJECT_ROOT_FILE: paceUtils.PROJECT_ROOT_FILE,
  });
  const written = lockUtils.writeChangeOwner(dir, 'CHG-20260605-91', { sessionId: 'sid-other', operation: 'create-chg', state: 'active' });
  // 改为别的 worktree（foreign），且 timestamp 保持 fresh
  const owner = JSON.parse(fs.readFileSync(written.path, 'utf8'));
  owner.cwd = path.join(dir, 'other'); owner.stateDir = path.join(dir, 'other'); owner.worktree = 'wt-other'; owner.branch = 'br-other';
  fs.writeFileSync(written.path, `${JSON.stringify(owner, null, 2)}\n`, 'utf8');
  // stdin 缺 session_id（''）+ currentSessionId 也空 → sid 无法确定，不应判 foreign（否则 Stop 漏检 running CHG）
  const status = lockUtils.changeOwnerStatus(dir, 'CHG-20260605-91', '');
  assert.strictEqual(status.disposition, 'unknown', 'sid 空时不应判 foreign-fresh');
});

test('sweepStaleRuntimeOwners: 清理超 TTL 的 change-owner/reservation 保留 fresh（RSL-01/02）', () => {
  const dir = makeTmpDir('rsl-sweep');
  const lockUtils = createLockUtils({
    getProjectRuntimeDir: d => path.join(d, '.pace'),
    displayDir: d => `${String(d || '').replace(/\\/g, '/')}/`,
    normalizeSessionId: s => String(s || '').trim(),
    currentSessionId: () => 'sid-sweep',
    executionContextForCwd: d => ({ cwd: d, stateDir: d, worktree: 'main', branch: 'main', text: '[worktree:: main] [branch:: main]' }),
    normalizePath: p => String(p || '').replace(/\\/g, '/'),
    getArtifactDir: d => d,
    todayISO: () => '2026-06-05',
    CHANGE_OWNER_TTL_MS: paceUtils.CHANGE_OWNER_TTL_MS,
    PROJECT_ROOT_FILE: paceUtils.PROJECT_ROOT_FILE,
  });
  const fresh = lockUtils.writeChangeOwner(dir, 'CHG-20260605-81', { sessionId: 'sid-sweep', operation: 'create-chg', state: 'active' });
  const stale = lockUtils.writeChangeOwner(dir, 'CHG-20260605-82', { sessionId: 'sid-old', operation: 'create-chg', state: 'active' });
  // 把 stale owner 的 mtime 改到 2 小时前（超 30min TTL）
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale.path, old, old);
  const swept = lockUtils.sweepStaleRuntimeOwners(dir);
  assert.ok(!fs.existsSync(stale.path), 'stale change-owner（2h，超 TTL）被清理，遏制无界增长');
  assert.ok(fs.existsSync(fresh.path), 'fresh change-owner 保留');
  assert.ok(Array.isArray(swept) && swept.length >= 1, '返回被清理文件列表');
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

// ------------------------------------------------------------
// M5: wiki article 注入（CHG-20260608-12 T-001）
// 在真实 VAULT_PATH 建唯一命名临时文件，用完 unlink（同既有策略）。
// ------------------------------------------------------------

test('WIKI-1. 有 wiki/ 时 article 优先注入 + 同名 raw 被 basename 去重', () => {
  const uniq = 'pace-wiki-test-' + Date.now();
  const artDir = path.join(paceUtils.VAULT_PATH, 'wiki', 'ai-workflow');
  fs.mkdirSync(artDir, { recursive: true });
  const articleFile = path.join(artDir, `_test-${uniq}.md`);
  fs.writeFileSync(articleFile, ['---','type: wiki-article','status: confirmed',
    'tags:','  - test-tag','summary: "wiki 提炼摘要"',
    'sources:',`  - "${uniq} CHG-X 描述, 2026-06-08"`,'---','# Article'].join('\n'));
  const kDir = path.join(paceUtils.VAULT_PATH, 'knowledge');
  fs.mkdirSync(kDir, { recursive: true });
  const rawSame = path.join(kDir, `_test-${uniq}.md`); // 同名 → 应被去重
  fs.writeFileSync(rawSame, ['---','status: concluded',`projects: [${uniq}]`,'summary: "raw 原始"','---','# Raw'].join('\n'));
  try {
    const r = paceUtils.scanRelatedNotes(uniq);
    const art = r.find(x => x.title === `_test-${uniq}` && x.kind === 'wiki');
    assert.ok(art, 'article 应匹配（sources 前缀）');
    assert.strictEqual(art.summary, 'wiki 提炼摘要');
    assert.strictEqual(r.filter(x => x.title === `_test-${uniq}`).length, 1, '同名 raw 被去重，只剩 article');
    assert.strictEqual(r[0].kind, 'wiki', 'article 优先排前');
  } finally { fs.unlinkSync(articleFile); fs.unlinkSync(rawSame); }
});

test('WIKI-1b. 仅 tags 含项目名（无 sources 前缀）的 article 也匹配（并集）', () => {
  const uniq = 'pace-wiki-tag-' + Date.now();
  const artDir = path.join(paceUtils.VAULT_PATH, 'wiki', 'tools');
  fs.mkdirSync(artDir, { recursive: true });
  const f = path.join(artDir, `_test-${uniq}.md`);
  fs.writeFileSync(f, ['---','type: wiki-article','status: likely',
    'tags:',`  - ${uniq}`,'summary: "仅 tags 匹配"',
    'sources:','  - "other-project CHG-Y, 2026-06-08"','---','# A'].join('\n'));
  try {
    const r = paceUtils.scanRelatedNotes(uniq);
    assert.ok(r.find(x => x.title === `_test-${uniq}` && x.kind === 'wiki'), 'tags 含项目名应匹配（并集）');
  } finally { fs.unlinkSync(f); }
});

test('WIKI-2. 无匹配 wiki article 时返回 knowledge raw（kind=knowledge，CHG-04 拆 kind）', () => {
  const uniq = 'pace-wiki-none-' + Date.now();
  const kDir = path.join(paceUtils.VAULT_PATH, 'knowledge');
  fs.mkdirSync(kDir, { recursive: true });
  const raw = path.join(kDir, `_test-${uniq}.md`);
  fs.writeFileSync(raw, ['---','status: concluded',`projects: [${uniq}]`,'summary: "只有 knowledge"','---','# Raw'].join('\n'));
  try {
    const r = paceUtils.scanRelatedNotes(uniq);
    assert.ok(r.find(x => x.title === `_test-${uniq}` && x.kind === 'knowledge'), 'knowledge raw kind=knowledge 正常返回');
  } finally { fs.unlinkSync(raw); }
});

test('WIKI-3. wiki article 按 status 排序（confirmed 排 likely 前，不依赖 walk 序）', () => {
  const uniq = 'pace-wiki-sort-' + Date.now();
  const aDir = path.join(paceUtils.VAULT_PATH, 'wiki', 'ai-workflow');
  fs.mkdirSync(aDir, { recursive: true });
  // likely 文件名排前（_a- → walk 序在前）、confirmed 排后——验证排序后 confirmed 仍在前。
  const fL = path.join(aDir, `_a-likely-${uniq}.md`);
  const fC = path.join(aDir, `_b-confirmed-${uniq}.md`);
  fs.writeFileSync(fL, ['---','type: wiki-article','status: likely','tags:',`  - ${uniq}`,'summary: "likely 项"','---','# L'].join('\n'));
  fs.writeFileSync(fC, ['---','type: wiki-article','status: confirmed','tags:',`  - ${uniq}`,'summary: "confirmed 项"','---','# C'].join('\n'));
  try {
    const wiki = paceUtils.scanRelatedNotes(uniq).filter(x => x.kind === 'wiki');
    const ci = wiki.findIndex(x => x.title === `_b-confirmed-${uniq}`);
    const li = wiki.findIndex(x => x.title === `_a-likely-${uniq}`);
    assert.ok(ci >= 0 && li >= 0 && ci < li, `confirmed 排在 likely 之前（实际 c=${ci} l=${li}）`);
  } finally { fs.unlinkSync(fL); fs.unlinkSync(fC); }
});

test('WIKI-4. knowledge 与 thoughts 分到不同 kind（CHG-04）', () => {
  const uniq = 'pace-wiki-kt-' + Date.now();
  const kDir = path.join(paceUtils.VAULT_PATH, 'knowledge');
  const tDir = path.join(paceUtils.VAULT_PATH, 'thoughts');
  fs.mkdirSync(kDir, { recursive: true });
  fs.mkdirSync(tDir, { recursive: true });
  const kf = path.join(kDir, `_k-${uniq}.md`);
  const tf = path.join(tDir, `_t-${uniq}.md`);
  fs.writeFileSync(kf, ['---','status: concluded',`projects: [${uniq}]`,'summary: "已沉淀"','---','# K'].join('\n'));
  fs.writeFileSync(tf, ['---','status: discussing',`projects: [${uniq}]`,'summary: "想法"','---','# T'].join('\n'));
  try {
    const r = paceUtils.scanRelatedNotes(uniq);
    assert.ok(r.find(x => x.title === `_k-${uniq}` && x.kind === 'knowledge'), 'knowledge raw kind=knowledge');
    assert.ok(r.find(x => x.title === `_t-${uniq}` && x.kind === 'thoughts'), 'thoughts raw kind=thoughts');
  } finally { fs.unlinkSync(kf); fs.unlinkSync(tf); }
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

test('listUnsyncedPlanFiles: synced-plans 含 CRLF 时已同步 plan 仍正确识别（PL-01）', () => {
  // PL-01：读取侧未规整 CRLF，synced name 残留尾随 \r 与无 \r 的 p.name 不相等，
  // 已 bridge 的 plan 被误判未同步 → 重复 bridge over-block。
  const dir = makeTmpDir('usp-crlf');
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-01-feature-a.md'), '');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', '2026-03-08-feature-b.md'), '');
  fs.mkdirSync(path.join(dir, '.pace'), { recursive: true });
  // synced-plans 以 CRLF 入库（Windows 编辑器 / git autocrlf）
  fs.writeFileSync(path.join(dir, '.pace', 'synced-plans'), '2026-03-01-feature-a.md\r\n2026-03-08-feature-b.md\r\n');
  const unsynced = paceUtils.listUnsyncedPlanFiles(dir);
  assert.strictEqual(unsynced.length, 0, 'CRLF synced-plans 下两个 plan 都应识别为已同步');
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

function writeV6ChangeFixture(dir, { id = 'CHG-20260507-01', status = 'in-progress', checkbox = '/', tasks = ['- [/] T-001 测试任务'], approved = true, verified = false, reviewed = false, changeSet = null, changeSetSeq = null } = {}) {
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
    ...(changeSet !== null ? [`change-set: ${changeSet}`] : []),
    ...(changeSetSeq !== null ? [`change-set-seq: ${changeSetSeq}`] : []),
    'parent-tasks: ["[[task]]"]',
    'parent-impl: ["[[implementation_plan]]"]',
    'related-finding: null',
    'aliases: []',
    'tags: []',
    'schema-version: "6.0"',
    'completed-date: null',
    `verified-date: ${verified ? '2026-05-07T12:00:00+08:00' : 'null'}`,
    `reviewed-date: ${reviewed ? '2026-05-07T13:00:00+08:00' : 'null'}`,
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
    reviewed ? '<!-- REVIEWED -->' : '',
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

test('isChangeReviewed — reviewed-date + REVIEWED 标记同时存在才算 reviewed', () => {
  const dir = makeTmpDir('v6-reviewed-true');
  writeV6ChangeFixture(dir, { status: 'completed', checkbox: 'x', tasks: ['- [x] T-001 测试任务'], verified: true, reviewed: true });
  const entry = paceUtils.getActiveChangeEntries(dir)[0];
  assert.strictEqual(paceUtils.isChangeReviewed(entry.detail), true);
  assert.strictEqual(paceUtils.classifyChange(entry).reviewed, true);
  // SessionStart / pre-compact 摘要行的 reviewed 维度来源：summarizeActiveChanges 必须回传 reviewed 字段
  assert.strictEqual(paceUtils.summarizeActiveChanges(dir)[0].reviewed, true);
});
test('isChangeReviewed — 缺 <!-- REVIEWED --> 标记不算 reviewed', () => {
  const dir = makeTmpDir('v6-reviewed-nomarker');
  writeV6ChangeFixture(dir, { status: 'completed', checkbox: 'x', tasks: ['- [x] T-001 测试任务'], verified: true, reviewed: true });
  const p = path.join(dir, 'changes', 'chg-20260507-01.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/\n<!-- REVIEWED -->/, ''), 'utf8');
  assert.strictEqual(paceUtils.isChangeReviewed(paceUtils.getActiveChangeEntries(dir)[0].detail), false);
});
test('isChangeReviewed — reviewed-date 带引号 null 不算 reviewed', () => {
  const dir = makeTmpDir('v6-reviewed-quoted-null');
  writeV6ChangeFixture(dir, { status: 'completed', checkbox: 'x', tasks: ['- [x] T-001 测试任务'], verified: true, reviewed: true });
  const p = path.join(dir, 'changes', 'chg-20260507-01.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/^reviewed-date: .+$/m, 'reviewed-date: "null"'), 'utf8');
  assert.strictEqual(paceUtils.isChangeReviewed(paceUtils.getActiveChangeEntries(dir)[0].detail), false);
});
test('classifyChange — completed+verified 未 reviewed 时 reviewed=false', () => {
  const dir = makeTmpDir('v6-reviewed-false');
  writeV6ChangeFixture(dir, { status: 'completed', checkbox: 'x', tasks: ['- [x] T-001 测试任务'], verified: true });
  const cls = paceUtils.classifyChange(paceUtils.getActiveChangeEntries(dir)[0]);
  assert.strictEqual(cls.reviewed, false);
  assert.strictEqual(cls.category, 'closing-required');
});

test('CS-1. classifyChange / summarizeActiveChanges 解析 change-set / change-set-seq', () => {
  const dir = makeTmpDir('v6-change-set');
  writeV6ChangeFixture(dir, { changeSet: 'review-gate', changeSetSeq: '2/4' });
  const e = paceUtils.getActiveChangeEntries(dir).find(x => x.id === 'CHG-20260507-01');
  const cls = paceUtils.classifyChange(e);
  assert.strictEqual(cls.changeSet, 'review-gate');
  assert.strictEqual(cls.changeSetSeq, '2/4');
  const sum = paceUtils.summarizeActiveChanges(dir)[0];
  assert.strictEqual(sum.changeSet, 'review-gate');
  assert.strictEqual(sum.changeSetSeq, '2/4');
});

test('CS-2. 无 change-set 字段 → changeSet/changeSetSeq null（回归）', () => {
  const dir = makeTmpDir('v6-no-change-set');
  writeV6ChangeFixture(dir);
  const cls = paceUtils.classifyChange(paceUtils.getActiveChangeEntries(dir)[0]);
  assert.strictEqual(cls.changeSet, null);
  assert.strictEqual(cls.changeSetSeq, null);
  assert.strictEqual(paceUtils.summarizeActiveChanges(dir)[0].changeSet, null);
});

test('CS-3. change-set: null 字面量归一为 JS null（非字符串 "null"）', () => {
  const dir = makeTmpDir('v6-change-set-literal-null');
  writeV6ChangeFixture(dir, { changeSet: 'null', changeSetSeq: '"null"' });
  const cls = paceUtils.classifyChange(paceUtils.getActiveChangeEntries(dir)[0]);
  assert.strictEqual(cls.changeSet, null, '字面 null 应归一为 JS null');
  assert.strictEqual(cls.changeSetSeq, null, '带引号 null 也应归一为 JS null');
});

test('AIBA-1. findActiveIndexBelowArchive 检出 ARCHIVE 下方的活跃状态索引行', () => {
  const content = [
    '# 项目任务追踪', '', '## 活跃任务', '', '<!-- ARCHIVE -->', '',
    '- [/] [[chg-20260607-02]] 误插的活跃 CHG #change [tasks:: T-001]',
    '- [x] [[chg-20260607-01]] 正常归档 #change [tasks:: T-001]',
  ].join('\n');
  assert.deepStrictEqual(paceUtils.findActiveIndexBelowArchive(content), ['chg-20260607-02']);
});

test('AIBA-2. 活跃行在 ARCHIVE 上方 + 归档行均终态 → 无误报（回归）', () => {
  const content = [
    '## 活跃任务', '', '- [/] [[chg-20260607-02]] 正常活跃 #change', '', '<!-- ARCHIVE -->', '',
    '- [x] [[chg-20260607-01]] 归档 #change', '- [-] [[chg-20260606-09]] 取消 #change',
  ].join('\n');
  assert.deepStrictEqual(paceUtils.findActiveIndexBelowArchive(content), []);
});

test('AIBA-3. 无 ARCHIVE 标记 → 空数组（不崩）', () => {
  assert.deepStrictEqual(paceUtils.findActiveIndexBelowArchive('# t\n\n- [/] [[chg-20260607-02]] x'), []);
});

test('AIBA-4. ARCHIVE 下方多个活跃状态行（[ ]/[/]/[!]）全部检出', () => {
  const content = [
    '## 活跃任务', '', '<!-- ARCHIVE -->', '',
    '- [ ] [[chg-20260607-03]] planned 误插 #change',
    '- [!] [[hotfix-20260607-01]] blocked 误插 #hotfix',
    '- [x] [[chg-20260607-01]] 正常归档 #change',
  ].join('\n');
  assert.deepStrictEqual(paceUtils.findActiveIndexBelowArchive(content), ['chg-20260607-03', 'hotfix-20260607-01']);
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

test('parseHookStdin — JSON 字面量 null/数组/数字归一为安全空对象不抛（PUC-02/ROB-01）', () => {
  // JSON.parse('null') 返回 null（不抛、ok=true），后续 parsed.session_id 访问 null 抛 TypeError，
  // withStdinParsed 无 try/catch → 进程崩溃 fail-open；数组/数字/false/字符串虽不抛但非对象，应一并归一。
  for (const raw of ['null', '[]', '123', 'false', '"str"']) {
    const r = paceUtils.parseHookStdin(raw);
    assert.strictEqual(r.ok, false, `${raw} 应归一为 ok:false`);
    assert.strictEqual(r.toolName, '');
    assert.strictEqual(r.filePath, '');
    assert.deepStrictEqual(r.toolInput, {});
  }
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
// 18. release sanity — 16 个测试
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

test('skills 在无 hook 注入时给出 skill-root helper fallback', () => {
  const repoRoot = path.join(__dirname, '..');
  const files = {
    'plugin/skills/pace-workflow/SKILL.md': ['set-artifact-root.js', 'reserve-artifact-id.js'],
    'plugin/skills/artifact-management/SKILL.md': ['set-artifact-root.js', 'reserve-artifact-id.js'],
    'plugin/skills/pace-bridge/SKILL.md': ['set-artifact-root.js', 'reserve-artifact-id.js', 'sync-plan.js'],
    'plugin/skills/artifact-management/references/change-lifecycle.md': ['reserve-artifact-id.js'],
  };
  for (const [rel, helpers] of Object.entries(files)) {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    assert.ok(!text.includes('<运行 hook 提供的'), `${rel} 不应保留不可执行 helper 占位命令`);
    assert.ok(!/find\s+.*~\/\.claude\/plugins\/cache/.test(text), `${rel} 不应引导搜索 plugin cache`);
    assert.ok(text.includes('<skill-root>/../../hooks/'), `${rel} 应给出 skill-root fallback`);
    if (rel.endsWith('SKILL.md')) {
      assert.ok(text.includes('这不是顺序执行清单'), `${rel} 应避免把 helper 模板误读为顺序脚本`);
    }
    for (const helper of helpers) {
      assert.ok(text.includes(`<skill-root>/../../hooks/${helper}`), `${rel} 应给出 ${helper} fallback`);
    }
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
  assert.ok(workflow.includes('继续、恢复或收口已有 CHG 前'), 'workflow skill 应提醒先读取 CHG 详情');
  assert.ok(workflow.includes('SessionStart 摘要只用于定位，不替代 CHG 详情'), 'workflow skill 应说明摘要不替代详情');

  const artifactManagement = fs.readFileSync(path.join(repoRoot, 'plugin/skills/artifact-management/SKILL.md'), 'utf8');
  assert.ok(artifactManagement.includes('继续、恢复或收口已有 CHG/HOTFIX 前'), 'artifact-management skill 应提醒先读取详情文件');
  assert.ok(artifactManagement.includes('SessionStart 摘要只用于定位，不替代详情文件'), 'artifact-management skill 应说明摘要不替代详情');

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
  assert.ok(createChg.includes('新增索引行与上一行注释、标题或正文之间保留空行隔开'), 'create-chg 指令应正向覆盖行边界要求');
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
