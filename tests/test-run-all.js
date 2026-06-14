// test-run-all.js — run-all 聚合 runner 自测（CHG-20260614-07 T-001）
// 黑盒：用 fake 子命令喂 runSuites，断言退出码透传与清单装配，
// 不实际跑 5 个核心套件（避免递归与耗时），只验证聚合器逻辑本身。

const assert = require('assert');
const { createTestRunner } = require('./test-utils');
const t = createTestRunner('run-all-test');
const { test } = t;

const FAKE_PASS = { name: 'fake-pass', cmd: process.execPath, args: ['-e', 'process.exit(0)'] };
const FAKE_FAIL = { name: 'fake-fail', cmd: process.execPath, args: ['-e', 'process.exit(1)'] };

test('RUN-1: 任一子套件失败 → 整体 exitCode 1 且失败项标记 ok=false', () => {
  const { runSuites } = require('./run-all');
  const { exitCode, results } = runSuites([FAKE_PASS, FAKE_FAIL], { quiet: true });
  assert.strictEqual(exitCode, 1, '有失败套件时 exitCode 必须为 1');
  assert.strictEqual(results.find(r => r.name === 'fake-fail').ok, false, '失败套件 ok=false');
  assert.strictEqual(results.find(r => r.name === 'fake-pass').ok, true, '通过套件 ok=true');
});

test('RUN-2: 全部子套件通过 → 整体 exitCode 0', () => {
  const { runSuites } = require('./run-all');
  const { exitCode } = runSuites([FAKE_PASS, { name: 'fake-pass-2', cmd: process.execPath, args: ['-e', '0'] }], { quiet: true });
  assert.strictEqual(exitCode, 0, '全通过时 exitCode 必须为 0');
});

test('RUN-3: SUITES 清单含 5 个核心套件 + plugin-validate + git-diff-check', () => {
  const { SUITES } = require('./run-all');
  const names = SUITES.map((s) => s.name);
  for (const core of ['pace-utils', 'hooks-e2e', 'session-layers', 'migrate-v7', 'agent-helpers']) {
    assert.ok(names.includes(core), `SUITES 应含核心套件 ${core}`);
  }
  assert.ok(names.includes('plugin-validate'), 'SUITES 应含 plugin-validate');
  assert.ok(names.includes('git-diff-check'), 'SUITES 应含 git-diff-check');
});

test('RUN-4: PACE_TEST_FILTER 按名子串筛选，空值返回全部', () => {
  const { filterSuites, SUITES } = require('./run-all');
  const filtered = filterSuites(SUITES, 'migrate');
  assert.strictEqual(filtered.length, 1, 'migrate 子串只匹配 migrate-v7');
  assert.strictEqual(filtered[0].name, 'migrate-v7');
  assert.strictEqual(filterSuites(SUITES, '').length, SUITES.length, '空 filter 返回全部套件');
});

test('RUN-5: runSuites 支持 run 函数条目（git-diff-check 区间检查改用 fn，CHG-20260614-16）', () => {
  const { runSuites } = require('./run-all');
  const { exitCode, results } = runSuites([
    { name: 'fn-pass', run: () => true },
    { name: 'fn-fail', run: () => false },
    { name: 'fn-throw', run: () => { throw new Error('whitespace error'); } },
  ], { quiet: true });
  assert.strictEqual(exitCode, 1, 'run 返回 false 或抛错应使整体非零');
  assert.strictEqual(results.find((r) => r.name === 'fn-pass').ok, true, 'run 返回 true → ok');
  assert.strictEqual(results.find((r) => r.name === 'fn-fail').ok, false, 'run 返回 false → ok=false');
  assert.strictEqual(results.find((r) => r.name === 'fn-throw').ok, false, 'run 抛错（whitespace 检查失败）→ ok=false');
});

t.cleanup();
const total = t.passed + t.failed;
console.log(`\n${t.failed === 0 ? '✅' : '❌'} ${t.passed}/${total} tests passed`);
if (t.failed > 0) process.exit(1);
