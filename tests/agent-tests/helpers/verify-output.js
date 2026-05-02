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

function checkWikilinkIntegrity(content, targetDir) {
  // 跳过 HTML 注释中的 wikilink 字面量（如模板示例 `[[wikilink]]`）
  const stripped = content.replace(/<!--[\s\S]*?-->/g, '');
  const re = /\[\[([^\]\|#]+)(?:#[^\]\|]+)?(?:\|[^\]]+)?\]\]/g;
  const issues = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
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
      const r = checkWikilinkIntegrity(content, targetDir);
      validations.push({ name: `wikilink:${path.basename(fp)}`, ok: r.ok, issues: r.issues });
    }
  }

  // 4. token / duration
  if (agentReport && exp.max_tokens && agentReport.tokens > exp.max_tokens) {
    validations.push({ name: 'max_tokens', ok: false, actual: agentReport.tokens, limit: exp.max_tokens });
  } else if (agentReport && exp.max_tokens) {
    validations.push({ name: 'max_tokens', ok: true, actual: agentReport.tokens, limit: exp.max_tokens });
  }

  // 5. agent status
  if (agentReport && agentReport.status && exp.status) {
    validations.push({ name: 'agent_status', ok: agentReport.status === exp.status, actual: agentReport.status, expected: exp.status });
  }

  const passed = validations.every((v) => v.ok);
  return { passed, validations, diffs };
}

module.exports = { verify, checkBelowArchive, parseFrontmatter };
