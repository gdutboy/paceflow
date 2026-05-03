/**
 * verify-output.js
 *
 * 输入：case.expected + 真实 vault 状态 + agent 报告（structured object）
 * 输出：{ passed: bool, validations: [...], diffs: [...] }
 *
 * 检查项：
 * 1. files_created 中的文件是否存在
 * 2. files_modified 中的文件是否被修改（与 fixture 对比，至少行数差异 > 0）
 * 3. validations 各项（frontmatter schema / wikilink / cross_index 等）
 * 4. agent 报告的 max_tokens / max_duration_ms 是否超限
 * 5. status 是否 SUCCESS
 */

const fs = require('fs');
const path = require('path');
const { renderVariables } = require('./fixture-setup');

const INDEX_FILES = new Set(['task', 'implementation_plan', 'walkthrough', 'findings', 'corrections']);

function isIndexFile(filePath) {
  const baseName = path.basename(filePath, '.md');
  return INDEX_FILES.has(baseName);
}

function isDetailFile(filePath) {
  const baseName = path.basename(filePath, '.md');
  return /^(chg|hotfix|finding|correction)-/.test(baseName);
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch { return false; }
}

function listMatchingFiles(targetDir, relPattern) {
  const fullPattern = path.join(targetDir, relPattern);
  if (!fullPattern.includes('*')) {
    return fileExists(fullPattern) ? [fullPattern] : [];
  }
  // 支持单层 * 通配（不递归）
  const dir = path.dirname(fullPattern);
  const base = path.basename(fullPattern);
  const regex = new RegExp('^' + base.replace(/\*/g, '.*') + '$');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => regex.test(f))
    .map((f) => path.join(dir, f));
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const out = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([a-zA-Z_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

function checkFrontmatterSchema(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm) return { ok: false, reason: 'no frontmatter' };
  if (!fm['schema-version']) return { ok: false, reason: 'missing schema-version' };
  return { ok: true, frontmatter: fm };
}

function checkWikilinkIntegrity(content, targetDir, scope = 'all') {
  // 跳过 HTML 注释中的 wikilink 字面量（如模板示例 `[[wikilink]]`）
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  // detail 文件仅检查 frontmatter 中的 wikilink（body 内 wikilink 是 markdown 内容，不是引用）
  let target = stripped;
  if (scope === 'frontmatter-only') {
    const m = stripped.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    target = m ? m[1] : '';
  }
  const re = /\[\[([^\]\|#]+)(?:#[^\]\|]+)?(?:\|[^\]]+)?\]\]/g;
  const issues = [];
  let m;
  while ((m = re.exec(target)) !== null) {
    const id = m[1].trim();
    if (id === 'task' || id === 'implementation_plan' || id === 'walkthrough' ||
        id === 'findings' || id === 'corrections') continue;
    const candidates = [
      path.join(targetDir, 'changes', `${id}.md`),
      path.join(targetDir, 'changes', 'findings', `${id}.md`),
      path.join(targetDir, 'changes', 'corrections', `${id}.md`),
    ];
    if (!candidates.some(fileExists)) {
      issues.push({ wikilink: id, candidates });
    }
  }
  return { ok: issues.length === 0, issues };
}

function checkBelowArchive(filePath, wikilinkId) {
  const content = fs.readFileSync(filePath, 'utf8');
  const archiveIdx = content.search(/^<!-- ARCHIVE -->$/m);
  if (archiveIdx < 0) return { ok: false, reason: 'no ARCHIVE marker' };
  const tail = content.slice(archiveIdx);
  return {
    ok: tail.includes(`[[${wikilinkId}]]`),
    reason: tail.includes(`[[${wikilinkId}]]`) ? '' : 'wikilink not below ARCHIVE',
  };
}

/**
 * @param {object} testCase   解析后的用例对象
 * @param {string} targetDir  临时 vault 路径
 * @param {object} variables  fixture-setup 返回的变量字典
 * @param {object} agentReport (optional) 主 session 收集的 agent 结构化报告
 * @returns {{ passed: bool, validations: array, diffs: array }}
 */
function verify(testCase, targetDir, variables, agentReport) {
  const validations = [];
  const diffs = [];
  const exp = testCase.expected || {};

  // 1. files_created
  for (const rel of (exp.files_created || [])) {
    const rendered = renderVariables(rel, variables);
    const matches = listMatchingFiles(targetDir, rendered);
    if (matches.length === 0) {
      validations.push({ name: `files_created:${rendered}`, ok: false, reason: 'not found' });
    } else {
      validations.push({ name: `files_created:${rendered}`, ok: true, found: matches });
    }
  }

  // 2. files_modified（仅检查存在 + 内容非空，不与 fixture 对比 byte）
  for (const rel of (exp.files_modified || [])) {
    const rendered = renderVariables(rel, variables);
    const full = path.join(targetDir, rendered);
    if (!fileExists(full)) {
      validations.push({ name: `files_modified:${rendered}`, ok: false, reason: 'not found' });
    } else {
      validations.push({ name: `files_modified:${rendered}`, ok: true });
    }
  }

  // 3. frontmatter / wikilink / cross-index 等（针对 created files）
  if ((exp.validations || {}).frontmatter_schema === 'pass') {
    for (const rel of (exp.files_created || [])) {
      const rendered = renderVariables(rel, variables);
      const matches = listMatchingFiles(targetDir, rendered);
      for (const fp of matches) {
        // 索引文件无 frontmatter（spec §5.6 模板），跳过
        if (isIndexFile(fp)) continue;
        const r = checkFrontmatterSchema(fp);
        validations.push({ name: `frontmatter_schema:${path.basename(fp)}`, ok: r.ok, reason: r.reason });
      }
    }
  }

  if ((exp.validations || {}).wikilink_integrity === 'pass') {
    const allFiles = [...(exp.files_created || []), ...(exp.files_modified || [])]
      .map((rel) => renderVariables(rel, variables))
      .flatMap((rel) => listMatchingFiles(targetDir, rel));
    for (const fp of allFiles) {
      const content = fs.readFileSync(fp, 'utf8');
      // detail 文件（changes/<...>.md）仅检查 frontmatter 内的 wikilink；body 是 markdown 内容
      const scope = isDetailFile(fp) ? 'frontmatter-only' : 'all';
      const r = checkWikilinkIntegrity(content, targetDir, scope);
      validations.push({ name: `wikilink:${path.basename(fp)}`, ok: r.ok, issues: r.issues });
    }
  }

  // 4. token / duration
  if (agentReport && exp.max_tokens && agentReport.tokens > exp.max_tokens) {
    validations.push({ name: 'max_tokens', ok: false, actual: agentReport.tokens, limit: exp.max_tokens });
  } else if (agentReport && exp.max_tokens) {
    validations.push({ name: 'max_tokens', ok: true, actual: agentReport.tokens, limit: exp.max_tokens });
  }

  // 4.1 report_title_strict（字面匹配 agent 报告 H2 标题）
  // 默认值：## paceflow-artifact-writer 报告（spec 输出契约）
  // yaml 显式设为 false 可禁用此检查
  const titleStrict = exp.report_title_strict === false
    ? null
    : (exp.report_title_strict || '## paceflow-artifact-writer 报告');
  if (agentReport && titleStrict && agentReport.raw) {
    const lines = agentReport.raw.split('\n');
    const ok = lines.some((line) => line.trim() === titleStrict);
    let actual = '<no h2 title>';
    if (ok) {
      actual = titleStrict;
    } else {
      const titleLine = lines.find((line) => /^##\s+/.test(line.trim()));
      if (titleLine) actual = titleLine.trim();
    }
    validations.push({
      name: 'report_title_strict',
      ok,
      actual,
      expected: titleStrict,
    });
  }

  // 4.2 failure_reason_pattern（regex 匹配 raw 报告中的失败码）
  if (agentReport && exp.failure_reason_pattern && agentReport.raw) {
    const re = new RegExp(exp.failure_reason_pattern, 'i');
    const ok = re.test(agentReport.raw);
    validations.push({
      name: 'failure_reason_pattern',
      ok,
      actual: ok ? 'matched' : 'not matched',
      expected: exp.failure_reason_pattern,
    });
  }

  // 5. agent status
  if (agentReport && agentReport.status && exp.status) {
    validations.push({ name: 'agent_status', ok: agentReport.status === exp.status, actual: agentReport.status, expected: exp.status });
  }

  const passed = validations.every((v) => v.ok);
  return { passed, validations, diffs };
}

module.exports = { verify, checkBelowArchive, parseFrontmatter };
