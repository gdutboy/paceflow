/**
 * subagent-runner.js
 *
 * 协调器：负责加载 YAML 用例 → 准备 fixture → 生成 agent prompt → 接收主 session 派遣的 agent 报告 → 验证 → 写报告。
 *
 * 注：Claude Code Agent tool 仅在主 session 内可调用，本 runner 不直接派遣 agent。
 * 主 session 用法：
 *   const runner = require('./helpers/subagent-runner');
 *   const ctx = runner.prepare('cases/phase-a/tc-a1-create-chg.yaml');
 *   // 主 session 用 Agent tool 派遣 paceflow-artifact-writer，prompt = ctx.agentPrompt
 *   // 收到 agent 报告后：
 *   const result = runner.verifyAndReport(ctx, agentReport);
 *   runner.teardown(ctx);
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const setupHelper = require('./fixture-setup');
const teardownHelper = require('./fixture-teardown');
const verifyHelper = require('./verify-output');

const ROOT = path.join(__dirname, '..');
const RESULTS_ROOT = path.join(ROOT, 'results');

function loadYaml(yamlPath) {
  // 用 python3 -c 解析 YAML 并输出 JSON（项目无 npm 依赖）
  const json = execSync(
    `python3 -c "import sys, json, yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))" "${yamlPath}"`,
    { encoding: 'utf8' },
  );
  return JSON.parse(json);
}

function buildAgentPrompt(testCase, ctx) {
  const op = testCase.input.operation;
  const fields = testCase.input.fields || {};

  // 渲染字段中的变量
  const renderedFields = {};
  for (const [k, v] of Object.entries(fields)) {
    renderedFields[k] = typeof v === 'string'
      ? setupHelper.renderVariables(v, ctx.variables)
      : v;
  }

  const fieldsJson = JSON.stringify(renderedFields, null, 2);

  return `执行 paceflow-artifact-writer 指令：${op}

项目路径（ARTIFACT_DIR）：${ctx.targetDir}

输入字段（JSON）：
\`\`\`json
${fieldsJson}
\`\`\`

操作要求：
- 严格按 ${op} 规范执行
- 操作完成后按报告格式（spec §强制报告格式）输出
- 不做超出 ${op} 范围的额外修改`;
}

function prepare(yamlRelOrAbsPath) {
  const yamlPath = path.isAbsolute(yamlRelOrAbsPath)
    ? yamlRelOrAbsPath
    : path.join(ROOT, yamlRelOrAbsPath);

  const testCase = loadYaml(yamlPath);

  const targetDir = (testCase.setup.variables && testCase.setup.variables.project_path)
    || `/tmp/test-vault/${testCase.setup.fixture}`;

  // 渲染 pre_files 中的变量需先 setup（变量来自 setup.buildVariables）
  const preFiles = testCase.setup.pre_files || [];
  const { variables } = setupHelper.setup(
    testCase.setup.fixture,
    targetDir,
    preFiles,
    {},
    testCase.setup.variables || {},
  );

  const ctx = { testCase, yamlPath, targetDir, variables };
  ctx.agentPrompt = buildAgentPrompt(testCase, ctx);
  return ctx;
}

function verifyAndReport(ctx, agentReport) {
  const result = verifyHelper.verify(ctx.testCase, ctx.targetDir, ctx.variables, agentReport);

  // 写报告到 results/<date>/tc-xxx.report.md
  const dateStr = ctx.variables.ISO_DATE;
  const resultsDir = path.join(RESULTS_ROOT, dateStr);
  fs.mkdirSync(resultsDir, { recursive: true });

  const reportPath = path.join(resultsDir, `${ctx.testCase.id.toLowerCase()}.report.md`);
  const lines = [
    `# ${ctx.testCase.id} 报告`,
    '',
    `- **用例**：${ctx.testCase.indication}`,
    `- **结果**：${result.passed ? '✅ PASS' : '❌ FAIL'}`,
    `- **运行时间**：${dateStr}`,
    `- **vault**：${ctx.targetDir}`,
    '',
    '## Agent 报告',
    '',
    '```',
    agentReport && agentReport.raw ? agentReport.raw : '(未提供 raw)',
    '```',
    '',
    '## 验证项',
    '',
    ...result.validations.map((v) =>
      `- ${v.ok ? '✅' : '❌'} ${v.name}${v.reason ? ` — ${v.reason}` : ''}${v.actual !== undefined ? ` (actual=${v.actual} limit=${v.limit ?? '-'})` : ''}`,
    ),
    '',
  ];

  if (result.diffs.length > 0) {
    lines.push('## 差异');
    lines.push('');
    for (const d of result.diffs) lines.push(`- ${JSON.stringify(d)}`);
    lines.push('');
  }

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  return { ...result, reportPath };
}

function teardown(ctx) {
  if (ctx && ctx.testCase && ctx.testCase.teardown && ctx.testCase.teardown.cleanup) {
    teardownHelper.teardown(ctx.targetDir);
  }
}

function appendManifest(date, entry) {
  const dir = path.join(RESULTS_ROOT, date);
  fs.mkdirSync(dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  let manifest = { date, entries: [] };
  if (fs.existsSync(manifestPath)) {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  }
  manifest.entries.push(entry);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
}

module.exports = { loadYaml, prepare, verifyAndReport, teardown, appendManifest, buildAgentPrompt };
