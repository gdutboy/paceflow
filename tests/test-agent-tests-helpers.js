// agent-tests helper 单元测试
// 覆盖 YAML 解析、输出转换与 verifier 框架自身，避免框架 bug 被 hook 主套件绿灯掩盖。

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const runner = require('./agent-tests/helpers/subagent-runner');
const setupHelper = require('./agent-tests/helpers/fixture-setup');
const verifyHelper = require('./agent-tests/helpers/verify-output');
const { convert } = require('./agent-tests/helpers/claude-output-to-report');
const { createTestRunner } = require('./test-utils');

const t = createTestRunner('pace-agent-helper');
const { test, makeTmpDir } = t;

console.log('\n--- agent-tests YAML parser ---');

test('parseSimpleYaml 保留 block scalar 中的 markdown 标题并剥离行尾注释', () => {
  const parsed = runner.parseSimpleYaml([
    'id: SAMPLE # inline comment',
    'body: |',
    '  # 背景',
    '',
    '  text # not a YAML comment inside block scalar',
    'list:',
    '  - "a # b" # list item comment',
    'inline: { task-id: T-901, expected_status: x } # object comment',
    '',
  ].join('\n'));

  assert.strictEqual(parsed.id, 'SAMPLE');
  assert.ok(parsed.body.includes('# 背景'));
  assert.ok(parsed.body.includes('text # not a YAML comment inside block scalar'));
  assert.deepStrictEqual(parsed.list, ['a # b']);
  assert.deepStrictEqual(parsed.inline, { 'task-id': 'T-901', expected_status: 'x' });
});

test('loadYaml 正确解析真实 record-finding 用例中的 block scalar 和注释标量', () => {
  const tc = runner.loadYaml(path.join(__dirname, 'agent-tests', 'cases', 'phase-a', 'tc-a4-record-finding.yaml'));
  assert.ok(tc.input.fields.body.includes('# 背景'));
  assert.ok(tc.input.fields.body.includes('# 发现'));
  assert.ok(tc.input.fields.body.includes('# 调研来源'));
  assert.strictEqual(tc.expected.filename_match, 'lenient');
  assert.strictEqual(tc.expected.max_tokens, 40000);
  assert.strictEqual(tc.expected.files_created[0], 'changes/findings/finding-{ISO_DATE}-tc-a4-phase-a.md');
});

test('所有 agent-tests YAML case 可解析并 prepare/teardown', () => {
  const casesRoot = path.join(__dirname, 'agent-tests', 'cases');
  let count = 0;
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (name.endsWith('.yaml')) {
        const rel = path.relative(path.join(__dirname, 'agent-tests'), full).replace(/\\/g, '/');
        const ctx = runner.prepare(rel);
        runner.teardown(ctx);
        count += 1;
      }
    }
  }
  walk(casesRoot);
  assert.strictEqual(count, 29);
});

console.log('\n--- agent-tests verifier ---');

function setupEmptyFixture(label) {
  const dir = makeTmpDir(label);
  const result = setupHelper.setup('empty-v6', dir);
  return { dir, variables: result.variables };
}

test('verify-output 对未知 expected / validations key fail-closed', () => {
  const { dir, variables } = setupEmptyFixture('verify-unknown-key');
  const result = verifyHelper.verify({
    setup: { fixture: 'empty-v6' },
    expected: {
      typo_key: true,
      validations: { not_a_validation: 'pass' },
    },
  }, dir, variables, { status: 'SUCCESS' });

  assert.strictEqual(result.passed, false);
  assert.ok(result.validations.some((v) => v.name === 'unknown_expected_key:typo_key' && !v.ok));
  assert.ok(result.validations.some((v) => v.name === 'unknown_validation_key:not_a_validation' && !v.ok));
});

test('verify-output files_modified 必须相对 fixture/pre_files 基线发生内容变化', () => {
  const unchanged = setupEmptyFixture('verify-unchanged');
  const testCase = {
    setup: { fixture: 'empty-v6' },
    expected: { files_modified: ['findings.md'] },
  };
  const unchangedResult = verifyHelper.verify(testCase, unchanged.dir, unchanged.variables, {});
  assert.strictEqual(unchangedResult.passed, false);
  assert.ok(unchangedResult.validations.some((v) => v.name === 'files_modified:findings.md' && v.reason === 'unchanged from fixture/pre_files baseline'));

  const changed = setupEmptyFixture('verify-changed');
  fs.appendFileSync(path.join(changed.dir, 'findings.md'), '\n- [ ] [[finding-test|Test]] [date:: 2026-05-31]\n', 'utf8');
  const changedResult = verifyHelper.verify(testCase, changed.dir, changed.variables, {});
  assert.strictEqual(changedResult.passed, true);
});

test('ATF-02. failure_reason_pattern 在 agent raw 为空时判 fail 而非静默跳过', () => {
  const { dir, variables } = setupEmptyFixture('verify-empty-raw-failpat');
  // 用例显式要求 failure_reason_pattern，但 agent raw 为空 → 当前 bug 跳过检查致负向用例 fail-open；应判 fail。
  const result = verifyHelper.verify({
    setup: { fixture: 'empty-v6' },
    expected: { failure_reason_pattern: 'missing-fields' },
  }, dir, variables, { status: 'FAILED' });
  assert.ok(result.validations.some((v) => v.name === 'failure_reason_pattern' && !v.ok), 'raw 空时 failure_reason_pattern 应判 fail');
});

test('ATF-02b. 显式 report_title_strict 与 raw_must_contain 在 agent raw 为空时判 fail', () => {
  const { dir, variables } = setupEmptyFixture('verify-empty-raw-title');
  const result = verifyHelper.verify({
    setup: { fixture: 'empty-v6' },
    expected: { report_title_strict: '## 自定义报告标题', raw_must_contain: 'SUCCESS' },
  }, dir, variables, { status: 'SUCCESS' });
  assert.ok(result.validations.some((v) => v.name === 'report_title_strict' && !v.ok), '显式 title-strict 在 raw 空时应判 fail');
  assert.ok(result.validations.some((v) => v.name === 'raw_must_contain' && !v.ok), 'raw_must_contain 在 raw 空时应判 fail');
});

console.log('\n--- claude-output-to-report ---');

test('claude-output-to-report convert 支持 JSON result usage 与 SUCCESS 状态', () => {
  const report = convert(JSON.stringify({
    type: 'result',
    result: '## artifact-writer 报告\n**状态**: SUCCESS\n',
    duration_ms: 42,
    usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2 },
  }));

  assert.strictEqual(report.status, 'SUCCESS');
  assert.strictEqual(report.tokens, 17);
  assert.strictEqual(report.duration_ms, 42);
  assert.ok(report.raw.includes('artifact-writer 报告'));
});

test('claude-output-to-report convert 支持 stream-json tool_use 计数与 FAILED 状态', () => {
  const stream = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }),
    JSON.stringify({ type: 'result', result: '状态: FAILED', duration_ms: 9, usage: { total_tokens: 11 } }),
  ].join('\n');
  const report = convert(stream);

  assert.strictEqual(report.status, 'FAILED');
  assert.strictEqual(report.tokens, 11);
  assert.strictEqual(report.tool_uses, 1);
  assert.strictEqual(report.duration_ms, 9);
});

process.on('exit', () => {
  t.cleanup();
  console.log(`\n✅ ${t.passed}/${t.passed + t.failed} tests passed`);
  if (t.failed > 0) process.exitCode = 1;
});
