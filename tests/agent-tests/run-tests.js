#!/usr/bin/env node
/**
 * run-tests.js — Phase A-D 测试运行器
 *
 * 由于 Claude Code Agent tool 仅在主 session 内可用，本 runner 采用半自动模式：
 *   - prepare 子命令：setup fixture + 打印 agent prompt（主 session 拷贝去派遣）
 *   - verify 子命令：主 session 派遣完拿到 agent 报告后，喂给 runner 验证 + 生成报告
 *   - dummy 子命令：用 mock agent 报告跑通 verify 链路，自测框架本身
 *
 * 用法：
 *   node run-tests.js list [phase]                 # 列出用例（默认 phase-a）
 *   node run-tests.js prepare <yaml-path>          # setup + 打印 prompt
 *   node run-tests.js verify <yaml-path> [json]    # 验证（json 文件路径 或 stdin）
 *   node run-tests.js teardown <yaml-path>         # 清理 fixture
 *   node run-tests.js dummy                        # 自测框架
 */

const fs = require('fs');
const path = require('path');
const runner = require('./helpers/subagent-runner');

const ROOT = __dirname;
const CASES_DIR = path.join(ROOT, 'cases');

function listCases(phase) {
  const dir = phase ? path.join(CASES_DIR, phase) : path.join(CASES_DIR, 'phase-a');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => path.join(dir, f));
}

function cmdList(phase) {
  const cases = listCases(phase);
  if (cases.length === 0) {
    console.log(`(no cases under ${phase || 'phase-a'})`);
    return;
  }
  for (const c of cases) {
    const tc = runner.loadYaml(c);
    console.log(`${tc.id}\t${tc.indication}\t${path.relative(ROOT, c)}`);
  }
}

function cmdPrepare(yamlPath) {
  const ctx = runner.prepare(yamlPath);
  console.log('═'.repeat(70));
  console.log(`已准备：${ctx.testCase.id}  →  ${ctx.targetDir}`);
  console.log('═'.repeat(70));
  console.log('\n--- AGENT PROMPT（拷给主 session 派遣 paceflow-artifact-writer）---\n');
  console.log(ctx.agentPrompt);
  console.log('\n' + '═'.repeat(70));
  console.log('下一步：');
  console.log(`  1. 主 session 用 Agent tool 派 paceflow-artifact-writer，prompt 见上`);
  console.log(`  2. 收到 agent 报告后，存为 JSON：{"status":"SUCCESS","tokens":N,"raw":"..."}`);
  console.log(`  3. node run-tests.js verify ${path.relative(ROOT, yamlPath)} <report.json>`);
  console.log(`  4. 完成后清理：node run-tests.js teardown ${path.relative(ROOT, yamlPath)}`);
}

function readReport(reportPath) {
  if (!reportPath) {
    // 从 stdin 读
    const stdin = fs.readFileSync(0, 'utf8');
    return JSON.parse(stdin);
  }
  return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
}

function cmdVerify(yamlPath, reportPath) {
  const yamlAbs = path.isAbsolute(yamlPath) ? yamlPath : path.join(ROOT, yamlPath);
  const tc = runner.loadYaml(yamlAbs);
  const targetDir = (tc.setup.variables && tc.setup.variables.project_path)
    || `/tmp/test-vault/${tc.setup.fixture}`;
  const setupHelper = require('./helpers/fixture-setup');
  const variables = setupHelper.buildVariables();
  // 与 prepare 保持一致：渲染并合入 case.setup.variables
  for (const [k, v] of Object.entries(tc.setup.variables || {})) {
    variables[k] = typeof v === 'string' ? setupHelper.renderVariables(v, variables) : v;
  }
  const ctx = { testCase: tc, yamlPath: yamlAbs, targetDir, variables };

  const agentReport = readReport(reportPath);
  const result = runner.verifyAndReport(ctx, agentReport);

  runner.appendManifest(variables.ISO_DATE, {
    id: tc.id,
    passed: result.passed,
    reportPath: path.relative(ROOT, result.reportPath),
    timestamp: new Date().toISOString(),
  });

  console.log(`${tc.id}: ${result.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`报告：${result.reportPath}`);
  for (const v of result.validations) {
    console.log(`  ${v.ok ? '✓' : '✗'} ${v.name}${v.reason ? ' — ' + v.reason : ''}`);
  }
  process.exit(result.passed ? 0 : 1);
}

function cmdTeardown(yamlPath) {
  const yamlAbs = path.isAbsolute(yamlPath) ? yamlPath : path.join(ROOT, yamlPath);
  const tc = runner.loadYaml(yamlAbs);
  const targetDir = (tc.setup.variables && tc.setup.variables.project_path)
    || `/tmp/test-vault/${tc.setup.fixture}`;
  const teardownHelper = require('./helpers/fixture-teardown');
  teardownHelper.teardown(targetDir);
  console.log(`Cleaned: ${targetDir}`);
}

function cmdDummy() {
  // 自测：用 TC-A1 + mock agent 报告跑通 setup → verify → report → teardown
  const yamlPath = path.join(CASES_DIR, 'phase-a', 'tc-a1-create-chg.yaml');
  if (!fs.existsSync(yamlPath)) {
    console.error('Missing TC-A1 yaml:', yamlPath);
    process.exit(2);
  }

  console.log('=== Dummy 自测 ===');
  console.log('1. prepare（setup fixture）');
  const ctx = runner.prepare(yamlPath);
  console.log(`   targetDir: ${ctx.targetDir}`);

  // 模拟 agent 真的跑了 create-chg：手动写出 expected files
  console.log('2. mock agent 产出（手动 Write 模拟）');
  const date = ctx.variables.TODAY;
  const dateUpper = ctx.variables.DATE_UPPER;
  const isoDate = ctx.variables.ISO_DATE;
  const chgFile = path.join(ctx.targetDir, 'changes', `chg-${date}-01.md`);
  fs.mkdirSync(path.dirname(chgFile), { recursive: true });
  fs.writeFileSync(chgFile, [
    '---',
    `chg-id: CHG-${dateUpper}-01`,
    'status: planned',
    `date: ${isoDate}`,
    'type: change',
    'parent-tasks: ["[[task]]"]',
    'parent-impl: ["[[implementation_plan]]"]',
    'related-finding: null',
    'aliases: []',
    'tags: []',
    'schema-version: "6.0"',
    'completed-date: null',
    'archived-date: null',
    '---',
    '',
    '# Dummy CHG',
    '',
    '## 任务清单',
    '',
    '- [ ] T-901 dummy task',
    '',
  ].join('\n'), 'utf8');

  // 修改 task.md / impl_plan.md 加索引行
  const taskPath = path.join(ctx.targetDir, 'task.md');
  fs.writeFileSync(taskPath, fs.readFileSync(taskPath, 'utf8').replace(
    '## 活跃任务\n\n',
    `## 活跃任务\n\n- [ ] [[chg-${date}-01]] Dummy CHG #change [tasks:: T-901]\n\n`,
  ));
  const implPath = path.join(ctx.targetDir, 'implementation_plan.md');
  fs.writeFileSync(implPath, fs.readFileSync(implPath, 'utf8').replace(
    '## 变更索引\n\n',
    `## 变更索引\n\n- [ ] [[chg-${date}-01]] Dummy CHG #change [tasks:: T-901]\n\n`,
  ));

  console.log('3. verify');
  const mockReport = {
    status: 'SUCCESS',
    tokens: 5000,
    duration_ms: 12000,
    raw: '## paceflow-artifact-writer 报告\n**操作**：create-chg\n（mock 报告，dummy 自测用）',
  };
  const result = runner.verifyAndReport(ctx, mockReport);
  console.log(`   结果：${result.passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   报告：${path.relative(ROOT, result.reportPath)}`);
  for (const v of result.validations) {
    console.log(`   ${v.ok ? '✓' : '✗'} ${v.name}${v.reason ? ' — ' + v.reason : ''}`);
  }

  console.log('4. teardown');
  runner.teardown(ctx);
  console.log(`   清理：${ctx.targetDir}`);

  process.exit(result.passed ? 0 : 1);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'list': return cmdList(args[0]);
    case 'prepare': return cmdPrepare(args[0]);
    case 'verify': return cmdVerify(args[0], args[1]);
    case 'teardown': return cmdTeardown(args[0]);
    case 'dummy': return cmdDummy();
    default:
      console.error('Usage:');
      console.error('  node run-tests.js list [phase]');
      console.error('  node run-tests.js prepare <yaml-path>');
      console.error('  node run-tests.js verify <yaml-path> [report.json]');
      console.error('  node run-tests.js teardown <yaml-path>');
      console.error('  node run-tests.js dummy');
      process.exit(2);
  }
}

main();
