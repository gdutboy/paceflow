/**
 * verify-output.js
 *
 * 输入：case.expected + 真实 vault 状态 + agent 报告（structured object）
 * 输出：{ passed: bool, validations: [...], diffs: [...] }
 *
 * 检查项：
 * 1. files_created 中的文件是否存在
 * 2. files_modified 中的文件是否被修改（与 fixture/pre_files 基线做内容对比）
 * 3. validations 各项（frontmatter schema / wikilink / cross_index 等）
 * 4. agent 报告的 max_tokens / max_duration_ms 是否超限
 * 5. status 是否 SUCCESS
 */

const fs = require('fs');
const path = require('path');
const { renderVariables } = require('./fixture-setup');

const INDEX_FILES = new Set(['task', 'implementation_plan', 'walkthrough', 'findings', 'corrections']);
const FIXTURES_ROOT = path.join(__dirname, '..', 'fixtures');
const EXPECTED_KEYS = new Set([
  'status', 'files_created', 'files_modified', 'files_created_optional',
  'validations', 'filename_match', 'fixture_unchanged', 'body_completeness_check',
  'report_title_strict', 'report_title_prefix_allowed', 'failure_reason_pattern',
  'raw_must_contain', 'max_tokens', 'max_duration_ms', 'max_tool_uses', 'cleanup',
]);
const VALIDATION_KEYS = new Set([
  'frontmatter_schema', 'wikilink_integrity', 'cross_index_consistency',
  'chg_id_pattern', 'finding_id_pattern', 'correction_id_pattern',
  'frontmatter_status', 'finding_status', 'summary_length_le_200',
  'impact_in_index_row', 'correction_index_contains',
  'knowledge_link_null', 'knowledge_link_value', 'project_scope_value',
  'title_derived_from_wrong_behavior', 'approved_marker_set',
  'verified_marker_set', 'completed_date_set', 'verified_date_set',
  'archived_date_set', 'detail_task_status', 'task_marked',
  'task_md_index_checkbox', 'impl_plan_index_checkbox',
  'task_md_index_below_archive', 'impl_plan_index_below_archive',
  'walkthrough_row_added', 'work_record_contains',
]);

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

function toLenientSlugPattern(relPattern) {
  const dir = path.dirname(relPattern);
  const base = path.basename(relPattern);
  const match = base.match(/^(finding-\d{4}-\d{2}-\d{2}-|correction-\d{4}-\d{2}-\d{2}-\d{2}-).+\.md$/);
  if (!match) return null;
  return path.join(dir, `${match[1]}*.md`);
}

function resolveExpectedFiles(targetDir, rel, variables, exp) {
  const rendered = renderVariables(rel, variables);
  let matches = listMatchingFiles(targetDir, rendered);
  let matchedPattern = rendered;
  if (matches.length === 0 && exp.filename_match === 'lenient') {
    const lenientPattern = toLenientSlugPattern(rendered);
    if (lenientPattern) {
      matches = listMatchingFiles(targetDir, lenientPattern);
      matchedPattern = lenientPattern;
    }
  }
  return { rendered, matchedPattern, matches };
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

function normalizeFrontmatterScalar(value) {
  const s = String(value ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function expectedScalar(value, variables) {
  if (value === null) return 'null';
  if (typeof value === 'string') return renderVariables(value, variables);
  return String(value);
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

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slugFromTarget(testCase, variables) {
  const target = testCase.input && testCase.input.fields && testCase.input.fields.target;
  if (!target || typeof target !== 'string') return '';
  return renderVariables(target, variables).toLowerCase();
}

function detailPathForTarget(targetDir, slug) {
  if (!slug) return '';
  return path.join(targetDir, 'changes', `${slug}.md`);
}

function isNonNullValue(value) {
  const s = String(value || '').trim();
  return Boolean(s) && s !== 'null';
}

function normalizeCheckbox(value) {
  const s = String(value || '').trim();
  const bracketed = s.match(/^\[([^\]]*)\]$/);
  if (bracketed) return bracketed[1].trim();
  return s;
}

function taskStatus(content, taskId) {
  const re = new RegExp(`^- \\[([^\\]]*)\\]\\s+${escapeRegex(taskId)}\\b`, 'm');
  const m = String(content || '').match(re);
  return m ? m[1] : null;
}

function indexCheckbox(filePath, wikilinkId) {
  const content = fs.readFileSync(filePath, 'utf8');
  const re = new RegExp(`^- \\[([^\\]]*)\\]\\s+\\[\\[${escapeRegex(wikilinkId)}\\]\\]`, 'm');
  const m = content.match(re);
  return m ? m[1] : null;
}

function pushNumericLimit(validations, agentReport, field, limit, name, options = {}) {
  if (!limit) return;
  const warnOnly = Boolean(options.warnOnly);
  const push = (entry) => {
    if (warnOnly && !entry.ok) {
      validations.push({
        ...entry,
        ok: true,
        warning: true,
        reason: entry.reason || 'production prompt: resource budget recorded as warning',
      });
      return;
    }
    validations.push(entry);
  };
  if (!agentReport) {
    push({ name, ok: false, reason: 'agent report missing', limit });
    return;
  }
  const actual = Number(agentReport[field]);
  if (!Number.isFinite(actual)) {
    push({ name, ok: false, reason: `${field} missing`, actual: agentReport[field], limit });
    return;
  }
  push({ name, ok: actual <= limit, actual, limit });
}

function normalizeNewlines(s) {
  return String(s || '').replace(/\r\n/g, '\n');
}

function collectFileMap(rootDir) {
  const out = {};
  if (!fs.existsSync(rootDir)) return out;

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(rootDir, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        out[rel] = fs.readFileSync(full, 'utf8');
      }
    }
  }

  walk(rootDir);
  return out;
}

function buildExpectedFixtureMap(testCase, variables) {
  const fixtureName = testCase.setup && testCase.setup.fixture;
  const fixtureDir = path.join(FIXTURES_ROOT, fixtureName || '');
  const expected = collectFileMap(fixtureDir);
  for (const pf of ((testCase.setup && testCase.setup.pre_files) || [])) {
    const renderedPath = renderVariables(pf.path, variables).split(path.sep).join('/');
    expected[renderedPath] = renderVariables(pf.content, variables);
  }
  return expected;
}

function compareFileMaps(expected, actual) {
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  const missing = expectedKeys.filter((k) => !Object.prototype.hasOwnProperty.call(actual, k));
  const unexpected = actualKeys.filter((k) => !Object.prototype.hasOwnProperty.call(expected, k));
  const changed = expectedKeys
    .filter((k) => Object.prototype.hasOwnProperty.call(actual, k))
    .filter((k) => normalizeNewlines(expected[k]) !== normalizeNewlines(actual[k]));
  return { missing, unexpected, changed };
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
  const expectedFixtureMap = buildExpectedFixtureMap(testCase, variables);

  for (const key of Object.keys(exp)) {
    if (!EXPECTED_KEYS.has(key)) {
      validations.push({ name: `unknown_expected_key:${key}`, ok: false, reason: 'unknown expected key' });
    }
  }
  for (const key of Object.keys(exp.validations || {})) {
    if (!VALIDATION_KEYS.has(key)) {
      validations.push({ name: `unknown_validation_key:${key}`, ok: false, reason: 'unknown validation key' });
    }
  }

  // 1. files_created
  for (const rel of (exp.files_created || [])) {
    const { rendered, matchedPattern, matches } = resolveExpectedFiles(targetDir, rel, variables, exp);
    if (matches.length === 0) {
      validations.push({ name: `files_created:${rendered}`, ok: false, reason: 'not found' });
    } else {
      validations.push({
        name: `files_created:${rendered}`,
        ok: true,
        found: matches,
        matchedPattern: matchedPattern !== rendered ? matchedPattern : undefined,
      });
    }
  }

  // 2. files_modified（与 fixture/pre_files 基线做内容对比）
  for (const rel of (exp.files_modified || [])) {
    const rendered = renderVariables(rel, variables);
    const full = path.join(targetDir, rendered);
    if (!fileExists(full)) {
      validations.push({ name: `files_modified:${rendered}`, ok: false, reason: 'not found' });
    } else {
      const normalizedRel = rendered.split(path.sep).join('/');
      const before = expectedFixtureMap[normalizedRel];
      if (before === undefined) {
        validations.push({ name: `files_modified:${rendered}`, ok: false, reason: 'baseline missing' });
      } else {
        const after = fs.readFileSync(full, 'utf8');
        validations.push({
          name: `files_modified:${rendered}`,
          ok: normalizeNewlines(before) !== normalizeNewlines(after),
          reason: normalizeNewlines(before) === normalizeNewlines(after) ? 'unchanged from fixture/pre_files baseline' : undefined,
        });
      }
    }
  }

  // 2.1 files_created_optional：记录可选产物证据，不影响通过/失败。
  if (exp.files_created_optional) {
    const optionalPatterns = Array.isArray(exp.files_created_optional)
      ? exp.files_created_optional
      : [exp.files_created_optional];
    for (const rel of optionalPatterns) {
      const { rendered, matchedPattern, matches } = resolveExpectedFiles(targetDir, rel, variables, exp);
      validations.push({
        name: `files_created_optional:${rendered}`,
        ok: true,
        found: matches,
        matchedPattern: matchedPattern !== rendered ? matchedPattern : undefined,
        optional: true,
      });
    }
  }

  // 3. frontmatter / wikilink / cross-index 等（针对 created files）
  if ((exp.validations || {}).frontmatter_schema === 'pass') {
    for (const rel of (exp.files_created || [])) {
      const { matches } = resolveExpectedFiles(targetDir, rel, variables, exp);
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
      .flatMap((rel) => resolveExpectedFiles(targetDir, rel, variables, exp).matches);
    for (const fp of allFiles) {
      const content = fs.readFileSync(fp, 'utf8');
      // detail 文件（changes/<...>.md）仅检查 frontmatter 内的 wikilink；body 是 markdown 内容
      const scope = isDetailFile(fp) ? 'frontmatter-only' : 'all';
      const r = checkWikilinkIntegrity(content, targetDir, scope);
      validations.push({ name: `wikilink:${path.basename(fp)}`, ok: r.ok, issues: r.issues });
    }
  }

  const expectedValidations = exp.validations || {};
  const targetSlug = slugFromTarget(testCase, variables);
  const detailPath = detailPathForTarget(targetDir, targetSlug);
  let targetDetail = null;
  let targetFrontmatter = null;
  if (targetSlug && fileExists(detailPath)) {
    targetDetail = fs.readFileSync(detailPath, 'utf8');
    targetFrontmatter = parseFrontmatter(targetDetail);
  }

  const createdDetailFiles = (exp.files_created || [])
    .flatMap((rel) => resolveExpectedFiles(targetDir, rel, variables, exp).matches)
    .filter((fp) => isDetailFile(fp));
  const createdDetailByPrefix = (prefix) =>
    createdDetailFiles.find((fp) => path.basename(fp).startsWith(prefix));

  if (expectedValidations.chg_id_pattern) {
    const fp = createdDetailFiles.find((file) => /(?:^|\/)(?:chg|hotfix)-/i.test(file.split(path.sep).join('/')));
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const expectedPattern = renderVariables(expectedValidations.chg_id_pattern, variables);
    const actual = fm && normalizeFrontmatterScalar(fm['chg-id']);
    validations.push({
      name: 'chg_id_pattern',
      ok: actual === expectedPattern,
      actual,
      expected: expectedPattern,
      reason: fp ? undefined : 'change detail missing',
    });
  }

  if (expectedValidations.cross_index_consistency === 'pass') {
    const fp = createdDetailFiles.find((file) => /(?:^|\/)(?:chg|hotfix)-/i.test(file.split(path.sep).join('/')));
    const slug = fp ? path.basename(fp, '.md') : '';
    const taskContent = fileExists(path.join(targetDir, 'task.md')) ? fs.readFileSync(path.join(targetDir, 'task.md'), 'utf8') : '';
    const implContent = fileExists(path.join(targetDir, 'implementation_plan.md')) ? fs.readFileSync(path.join(targetDir, 'implementation_plan.md'), 'utf8') : '';
    const ok = Boolean(slug) && taskContent.includes(`[[${slug}]]`) && implContent.includes(`[[${slug}]]`);
    validations.push({
      name: 'cross_index_consistency',
      ok,
      actual: ok ? 'matched' : 'missing index link',
      expected: slug ? `[[${slug}]] in task.md and implementation_plan.md` : 'change detail',
    });
  }

  if (expectedValidations.frontmatter_status) {
    const actual = targetFrontmatter && targetFrontmatter.status;
    validations.push({
      name: 'frontmatter_status',
      ok: actual === expectedValidations.frontmatter_status,
      actual,
      expected: expectedValidations.frontmatter_status,
      reason: targetFrontmatter ? undefined : 'target detail frontmatter missing',
    });
  }

  for (const [key, field] of [
    ['completed_date_set', 'completed-date'],
    ['verified_date_set', 'verified-date'],
    ['archived_date_set', 'archived-date'],
  ]) {
    if (expectedValidations[key] !== undefined) {
      const actual = targetFrontmatter && targetFrontmatter[field];
      const ok = expectedValidations[key]
        ? isNonNullValue(actual)
        : !isNonNullValue(actual);
      validations.push({ name: key, ok, actual, expected: expectedValidations[key] });
    }
  }

  if (expectedValidations.verified_marker_set !== undefined) {
    const ok = Boolean(targetDetail) &&
      (expectedValidations.verified_marker_set
        ? /<!-- APPROVED -->\r?\n<!-- VERIFIED -->/.test(targetDetail)
        : !/<!-- VERIFIED -->/.test(targetDetail));
    validations.push({
      name: 'verified_marker_set',
      ok,
      expected: expectedValidations.verified_marker_set,
      reason: targetDetail ? undefined : 'target detail missing',
    });
  }

  if (expectedValidations.finding_id_pattern) {
    const fp = createdDetailByPrefix('finding-');
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const expectedPattern = renderVariables(expectedValidations.finding_id_pattern, variables);
    const actual = fm && normalizeFrontmatterScalar(fm['finding-id']);
    validations.push({
      name: 'finding_id_pattern',
      ok: Boolean(actual) && actual.startsWith(expectedPattern),
      actual,
      expected: expectedPattern,
      reason: fp ? undefined : 'finding detail missing',
    });
  }

  if (expectedValidations.finding_status) {
    const fp = createdDetailByPrefix('finding-');
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const actual = fm && normalizeFrontmatterScalar(fm.status);
    validations.push({
      name: 'finding_status',
      ok: actual === expectedValidations.finding_status,
      actual,
      expected: expectedValidations.finding_status,
      reason: fp ? undefined : 'finding detail missing',
    });
  }

  if (expectedValidations.summary_length_le_200 !== undefined) {
    const fp = createdDetailByPrefix('finding-');
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const actual = fm && normalizeFrontmatterScalar(fm.summary);
    const ok = Boolean(actual) && actual.length <= 200;
    validations.push({
      name: 'summary_length_le_200',
      ok: expectedValidations.summary_length_le_200 ? ok : !ok,
      actual: actual ? actual.length : null,
      expected: '<=200',
      reason: fp ? undefined : 'finding detail missing',
    });
  }

  if (expectedValidations.impact_in_index_row) {
    const content = fileExists(path.join(targetDir, 'findings.md'))
      ? fs.readFileSync(path.join(targetDir, 'findings.md'), 'utf8')
      : '';
    const expectedImpact = expectedScalar(expectedValidations.impact_in_index_row, variables);
    validations.push({
      name: 'impact_in_index_row',
      ok: content.includes(`[impact:: ${expectedImpact}]`),
      actual: content.includes('[impact::') ? 'impact metadata present' : 'missing impact metadata',
      expected: expectedImpact,
    });
  }

  if (expectedValidations.correction_id_pattern) {
    const fp = createdDetailByPrefix('correction-');
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const expectedPattern = renderVariables(expectedValidations.correction_id_pattern, variables);
    const actual = fm && normalizeFrontmatterScalar(fm['correction-id']);
    validations.push({
      name: 'correction_id_pattern',
      ok: Boolean(actual) && actual.startsWith(expectedPattern),
      actual,
      expected: expectedPattern,
      reason: fp ? undefined : 'correction detail missing',
    });
  }

  if (expectedValidations.knowledge_link_null !== undefined) {
    const fp = createdDetailByPrefix('correction-');
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const actual = fm && normalizeFrontmatterScalar(fm['knowledge-link']);
    const ok = actual === 'null';
    validations.push({
      name: 'knowledge_link_null',
      ok: expectedValidations.knowledge_link_null ? ok : !ok,
      actual,
      expected: 'null',
      reason: fp ? undefined : 'correction detail missing',
    });
  }

  if (expectedValidations.knowledge_link_value !== undefined) {
    const fp = createdDetailByPrefix('correction-');
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const actual = fm && normalizeFrontmatterScalar(fm['knowledge-link']);
    const expected = expectedScalar(expectedValidations.knowledge_link_value, variables);
    validations.push({
      name: 'knowledge_link_value',
      ok: actual === expected,
      actual,
      expected,
      reason: fp ? undefined : 'correction detail missing',
    });
  }

  if (expectedValidations.project_scope_value !== undefined) {
    const fp = createdDetailByPrefix('correction-');
    const fm = fp ? parseFrontmatter(fs.readFileSync(fp, 'utf8')) : null;
    const actual = fm && normalizeFrontmatterScalar(fm['project-scope']);
    const expected = expectedScalar(expectedValidations.project_scope_value, variables);
    validations.push({
      name: 'project_scope_value',
      ok: actual === expected,
      actual,
      expected,
      reason: fp ? undefined : 'correction detail missing',
    });
  }

  if (expectedValidations.correction_index_contains) {
    const content = fileExists(path.join(targetDir, 'corrections.md'))
      ? fs.readFileSync(path.join(targetDir, 'corrections.md'), 'utf8')
      : '';
    const expectedText = expectedScalar(expectedValidations.correction_index_contains, variables);
    validations.push({
      name: 'correction_index_contains',
      ok: content.includes(expectedText),
      actual: content.includes(expectedText) ? 'matched' : 'not matched',
      expected: expectedText,
    });
  }

  if (expectedValidations.title_derived_from_wrong_behavior !== undefined) {
    const fp = createdDetailByPrefix('correction-');
    const content = fp ? fs.readFileSync(fp, 'utf8') : '';
    const m = content.match(/^# Correction:\s*(.+)$/m);
    const title = m ? m[1].trim() : '';
    const wrongBehavior = testCase.input && testCase.input.fields && testCase.input.fields['wrong-behavior'];
    const renderedWrong = typeof wrongBehavior === 'string' ? renderVariables(wrongBehavior, variables).trim() : '';
    const ok = Boolean(title) && title.length <= 80 && title !== renderedWrong;
    validations.push({
      name: 'title_derived_from_wrong_behavior',
      ok: expectedValidations.title_derived_from_wrong_behavior ? ok : !ok,
      actual: title || '<missing>',
      expected: 'derived title, not verbatim wrong-behavior',
      reason: fp ? undefined : 'correction detail missing',
    });
  }

  if (expectedValidations.approved_marker_set !== undefined) {
    const hasMarker = Boolean(targetDetail) && /<!-- APPROVED -->/.test(targetDetail);
    validations.push({
      name: 'approved_marker_set',
      ok: expectedValidations.approved_marker_set ? hasMarker : !hasMarker,
      expected: expectedValidations.approved_marker_set,
      reason: targetDetail ? undefined : 'target detail missing',
    });
  }

  if (expectedValidations.detail_task_status) {
    for (const [taskId, expectedStatus] of Object.entries(expectedValidations.detail_task_status)) {
      const actualRaw = targetDetail ? taskStatus(targetDetail, taskId) : null;
      const actual = actualRaw === null ? null : normalizeCheckbox(actualRaw);
      const expected = normalizeCheckbox(expectedStatus);
      validations.push({
        name: `detail_task_status:${taskId}`,
        ok: actual === expected,
        actual,
        expected,
        reason: targetDetail ? undefined : 'target detail missing',
      });
    }
  }

  if (expectedValidations.task_marked) {
    const taskId = expectedValidations.task_marked['task-id'];
    const expected = normalizeCheckbox(expectedValidations.task_marked.expected_status);
    const actualRaw = targetDetail && taskId ? taskStatus(targetDetail, taskId) : null;
    const actual = actualRaw === null ? null : normalizeCheckbox(actualRaw);
    validations.push({
      name: `task_marked:${taskId || '(missing)'}`,
      ok: actual === expected,
      actual,
      expected,
      reason: targetDetail ? undefined : 'target detail missing',
    });
  }

  for (const [key, rel] of [
    ['task_md_index_checkbox', 'task.md'],
    ['impl_plan_index_checkbox', 'implementation_plan.md'],
  ]) {
    if (expectedValidations[key] !== undefined) {
      const full = path.join(targetDir, rel);
      const actualRaw = targetSlug && fileExists(full) ? indexCheckbox(full, targetSlug) : null;
      const actual = actualRaw === null ? null : normalizeCheckbox(actualRaw);
      const expected = normalizeCheckbox(expectedValidations[key]);
      validations.push({
        name: key,
        ok: actual === expected,
        actual,
        expected,
        reason: actual === null ? 'index row not found' : undefined,
      });
    }
  }

  for (const [key, rel] of [
    ['task_md_index_below_archive', 'task.md'],
    ['impl_plan_index_below_archive', 'implementation_plan.md'],
  ]) {
    if (expectedValidations[key] !== undefined) {
      const full = path.join(targetDir, rel);
      const r = targetSlug && fileExists(full)
        ? checkBelowArchive(full, targetSlug)
        : { ok: false, reason: 'index file or target missing' };
      validations.push({ name: key, ok: expectedValidations[key] ? r.ok : !r.ok, reason: r.reason });
    }
  }

  if (expectedValidations.walkthrough_row_added !== undefined) {
    const full = path.join(targetDir, 'walkthrough.md');
    const content = fileExists(full) ? fs.readFileSync(full, 'utf8') : '';
    const hasRow = targetSlug ? content.includes(`[[${targetSlug}]]`) : false;
    validations.push({
      name: 'walkthrough_row_added',
      ok: expectedValidations.walkthrough_row_added ? hasRow : !hasRow,
      expected: expectedValidations.walkthrough_row_added,
    });
  }

  if (expectedValidations.work_record_contains !== undefined) {
    const expectedText = renderVariables(expectedValidations.work_record_contains, variables);
    const ok = Boolean(targetDetail) && targetDetail.includes(expectedText);
    validations.push({
      name: 'work_record_contains',
      ok,
      actual: ok ? 'matched' : 'not matched',
      expected: expectedText,
      reason: targetDetail ? undefined : 'target detail missing',
    });
  }

  if (exp.body_completeness_check) {
    const expectedBody = normalizeNewlines(
      setupInputBody(testCase, variables),
    ).trim();
    const createdFiles = (exp.files_created || [])
      .flatMap((rel) => resolveExpectedFiles(targetDir, rel, variables, exp).matches)
      .filter((fp) => isDetailFile(fp));
    if (!expectedBody) {
      validations.push({ name: 'body_completeness_check', ok: false, reason: 'input.fields.body missing' });
    } else if (createdFiles.length === 0) {
      validations.push({ name: 'body_completeness_check', ok: false, reason: 'no created detail file found' });
    } else {
      const matchingFiles = createdFiles.filter((fp) =>
        normalizeNewlines(fs.readFileSync(fp, 'utf8')).includes(expectedBody),
      );
      validations.push({
        name: 'body_completeness_check',
        ok: matchingFiles.length > 0,
        expected_chars: expectedBody.length,
        checked_files: createdFiles.map((fp) => path.basename(fp)),
        matched_files: matchingFiles.map((fp) => path.basename(fp)),
        reason: matchingFiles.length > 0 ? undefined : 'body not found verbatim in created detail file',
      });
    }
  }

  if (exp.fixture_unchanged) {
    const actualMap = collectFileMap(targetDir);
    const comparison = compareFileMaps(expectedFixtureMap, actualMap);
    const ok = comparison.missing.length === 0 &&
      comparison.unexpected.length === 0 &&
      comparison.changed.length === 0;
    validations.push({
      name: 'fixture_unchanged',
      ok,
      missing: comparison.missing,
      unexpected: comparison.unexpected,
      changed: comparison.changed,
      reason: ok ? undefined : 'fixture changed',
    });
  }

  const isProductionPrompt = agentReport &&
    (agentReport.prompt_mode === 'production' || agentReport.promptMode === 'production');

  // 4. resource budgets
  pushNumericLimit(validations, agentReport, 'tokens', exp.max_tokens, 'max_tokens', { warnOnly: isProductionPrompt });
  pushNumericLimit(validations, agentReport, 'duration_ms', exp.max_duration_ms, 'max_duration_ms', { warnOnly: isProductionPrompt });
  pushNumericLimit(validations, agentReport, 'tool_uses', exp.max_tool_uses, 'max_tool_uses', { warnOnly: isProductionPrompt });

  // 4.1 report_title_strict（字面匹配 agent 报告第一行标题）
  // 默认值：## artifact-writer 报告（spec 输出契约）
  // yaml 显式设为 false 可禁用此检查
  const titleStrict = exp.report_title_strict === false
    ? null
    : (exp.report_title_strict || '## artifact-writer 报告');
  if (agentReport && titleStrict && agentReport.raw) {
    const lines = agentReport.raw.split(/\r?\n/);
    const firstLine = (lines[0] || '').trim();
    const ok = firstLine === titleStrict;
    const titleIndex = lines.findIndex((line) => line.trim() === titleStrict);
    const allowTitlePrefix = Boolean(exp.report_title_prefix_allowed) || isProductionPrompt;
    let actual = firstLine || '<empty first line>';
    if (!ok) {
      const titleLine = lines.find((line) => line.trim() === titleStrict) ||
        lines.find((line) => /^##\s+/.test(line.trim()));
      if (titleLine && titleLine.trim() !== actual) {
        actual = `${actual} (first h2: ${titleLine.trim()})`;
      }
    }
    if (allowTitlePrefix && !ok) {
      validations.push({
        name: 'report_title_present',
        ok: titleIndex >= 0,
        actual,
        expected: titleStrict,
        reason: titleIndex >= 0 ? undefined : 'required report title not found',
      });
      if (titleIndex >= 0) {
        validations.push({
          name: 'report_title_prefix_warning',
          ok: true,
          warning: true,
          actual,
          expected: titleStrict,
          reason: isProductionPrompt
            ? 'production prompt: title not first line; recorded as warning'
            : 'title not first line; recorded as warning',
        });
      }
    } else {
      validations.push({
        name: 'report_title_strict',
        ok,
        actual,
        expected: titleStrict,
      });
    }
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

  if (agentReport && exp.raw_must_contain && agentReport.raw) {
    const expectedRaw = renderVariables(exp.raw_must_contain, variables);
    const ok = agentReport.raw.includes(expectedRaw);
    validations.push({
      name: 'raw_must_contain',
      ok,
      actual: ok ? 'matched' : 'not matched',
      expected: expectedRaw,
    });
  }

  // 5. agent status
  if (agentReport && agentReport.status && exp.status) {
    validations.push({ name: 'agent_status', ok: agentReport.status === exp.status, actual: agentReport.status, expected: exp.status });
  }

  if (validations.length === 0) {
    validations.push({ name: 'validations_present', ok: false, reason: 'no validations executed' });
  }

  const passed = validations.every((v) => v.ok);
  return { passed, validations, diffs };
}

function setupInputBody(testCase, variables) {
  const body = testCase.input && testCase.input.fields && testCase.input.fields.body;
  return typeof body === 'string' ? renderVariables(body, variables) : '';
}

module.exports = { verify, checkBelowArchive, parseFrontmatter };
