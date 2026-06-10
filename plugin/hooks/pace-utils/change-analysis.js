const fs = require('fs');
const {
  normalizeChangeId,
  detailPathForId,
  slugForChangeId,
} = require('./change-id');

const COUNT_RE_PENDING = /- \[[ \/!]\]/g;
const COUNT_RE_PENDING_TOP = /^- \[[ \/!]\]/gm;
const COUNT_RE_DONE = /- \[[x-]\]/g;
const COUNT_RE_DONE_TOP = /^- \[[x-]\]/gm;

module.exports = function createChangeAnalysis(ctx) {
  function countByStatus(text, { topLevelOnly = false } = {}) {
    const pending = (text.match(topLevelOnly ? COUNT_RE_PENDING_TOP : COUNT_RE_PENDING) || []).length;
    const done = (text.match(topLevelOnly ? COUNT_RE_DONE_TOP : COUNT_RE_DONE) || []).length;
    return { pending, done, total: pending + done };
  }

  function extractOpenKeys(text) {
    const keys = [];
    (text.match(/^- \[ \] ([^—\n]+)/gm) || []).forEach(line => {
      keys.push(normalizeFindingKey(line.replace(/^- \[ \] /, '').trim()));
    });
    return keys;
  }

  function normalizeFindingKey(value) {
    let text = String(value || '').trim();
    const wikilink = text.match(/\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/);
    if (wikilink) text = (wikilink[2] || wikilink[1]).trim();
    return text.replace(/\s+/g, ' ').toLowerCase();
  }

  function detectLegacyImplFormat(text) {
    const hasEmoji = /^- \[.\].*[✅❌📋🔄⏳]/m.test(text);
    const hasTable = /^\|.+\|$/m.test(text) && !/^- \[.\]/m.test(text);
    return { hasEmoji, hasTable };
  }

  function parseFrontmatter(content) {
    const match = content && content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    const out = {};
    for (const line of match[1].split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
    return out;
  }

  function contextMarkerSpecsFromLine(line) {
    const specs = [];
    const seen = new Set();
    const re = /\[(worktree|branch)\s*::\s*([^\]\r\n]+?)\s*\]/gi;
    let m;
    while ((m = re.exec(String(line || ''))) !== null) {
      const kind = String(m[1] || '').toLowerCase();
      const value = String(m[2] || '').trim().replace(/\s+/g, ' ');
      if (!kind || !value || seen.has(kind)) continue;
      seen.add(kind);
      specs.push({ kind, value, marker: `[${kind}:: ${value}]` });
    }
    return specs.sort((a, b) => ['worktree', 'branch'].indexOf(a.kind) - ['worktree', 'branch'].indexOf(b.kind));
  }

  function lineReferencesChangeId(line, id, slug) {
    const text = String(line || '');
    const expectedId = normalizeChangeId(id);
    const expectedSlug = String(slug || slugForChangeId(expectedId)).toLowerCase();
    if (!expectedId || !expectedSlug) return false;
    const slugRe = new RegExp(`\\[\\[${ctx.escapeRegex(expectedSlug)}(?:\\|[^\\]]+)?\\]\\]`, 'i');
    const idRe = new RegExp(`\\b${ctx.escapeRegex(expectedId)}\\b`, 'i');
    return slugRe.test(text) || idRe.test(text);
  }

  function walkthroughContextForChange(cwd, id) {
    const expectedId = normalizeChangeId(id);
    const expectedSlug = slugForChangeId(expectedId);
    if (!expectedId || !expectedSlug) return [];
    const byKind = new Map();
    for (const file of ['task.md', 'implementation_plan.md']) {
      const full = ctx.readFull(cwd, file) || '';
      for (const line of String(full || '').split(/\r?\n/)) {
        if (!lineReferencesChangeId(line, expectedId, expectedSlug)) continue;
        for (const spec of contextMarkerSpecsFromLine(line)) {
          if (!byKind.has(spec.kind)) byKind.set(spec.kind, spec);
        }
      }
    }
    return ['worktree', 'branch'].map(kind => byKind.get(kind)).filter(Boolean);
  }

  function textHasContextMarker(text, spec) {
    if (!spec || !spec.kind || !spec.value) return true;
    const valuePattern = ctx.escapeRegex(spec.value).replace(/\\ /g, '\\s+');
    const re = new RegExp(`\\[${ctx.escapeRegex(spec.kind)}\\s*::\\s*${valuePattern}\\s*\\]`, 'i');
    return re.test(String(text || ''));
  }

  function validateWalkthroughLinks(cwd) {
    const artDir = ctx.getArtifactDir(cwd);
    const active = ctx.readActive(cwd, 'walkthrough.md');
    if (active === null) return [];
    const issues = [];
    for (const line of String(active || '').split(/\r?\n/)) {
      if (!/^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line)) continue;
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
      if (cells.length < 3) continue;
      const summaryCell = cells[1] || '';
      const id = (cells[2] || '').match(/\b(CHG|HOTFIX)-\d{8}-\d{2}\b/i);
      if (!id) continue;
      const expectedId = id[0].toUpperCase();
      const expectedSlug = slugForChangeId(expectedId);
      const link = summaryCell.match(/\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]+)?\]\]/);
      let linkMatchesExpected = false;
      if (!link) {
        issues.push(`walkthrough.md 行 ${expectedId} 缺少 wikilink，应为 [[${expectedSlug}]]。`);
      } else {
        const target = String(link[1] || '').trim().toLowerCase();
        if (target !== expectedSlug) {
          issues.push(`walkthrough.md 行 ${expectedId} 的 wikilink 应为 [[${expectedSlug}]]，当前为 [[${target}]]。`);
        } else {
          linkMatchesExpected = true;
        }
      }
      const detailPath = detailPathForId(artDir, expectedId);
      if (detailPath && !fs.existsSync(detailPath)) {
        const linkHint = linkMatchesExpected ? `指向 [[${expectedSlug}]]，但` : `应指向 [[${expectedSlug}]]，且`;
        issues.push(`walkthrough.md 行 ${expectedId} ${linkHint}详情文件不存在：changes/${expectedSlug}.md（或带 slug 的 ${expectedSlug}-*.md）。`);
      }
      const expectedContext = walkthroughContextForChange(cwd, expectedId);
      const missingContext = expectedContext.filter(spec => !textHasContextMarker(summaryCell, spec));
      if (missingContext.length > 0) {
        issues.push(`walkthrough.md 行 ${expectedId} 缺少执行上下文 ${missingContext.map(spec => spec.marker).join(' ')}，应与 task.md / implementation_plan.md 索引行一致；请派 artifact-writer close-chg 或 archive-chg 补齐。`);
      }
    }
    return issues;
  }

  function parseChangeIndex(activeText) {
    const entries = [];
    // HOTFIX-20260610-01：wikilink 支持带 slug 全名（chg-yyyymmdd-nn-<slug>）+ 可选 |别名。
    //   组 2 捕获纯 ID 部分（id 推导用），组 3 捕获可选 slug 段（slug 字段拼出文件 stem 全名，
    //   供 task/impl 跨索引 join 与 changes/<slug>.md 路径提示）。旧纯 ID 形态（无 slug 段）继续兼容。
    const lineRe = /^- \[([ x\/!\-])\]\s+\[\[((?:chg|hotfix)-\d{8}-\d{2})(-[a-z0-9][a-z0-9-]*)?(?:\|[^\]]+)?\]\]\s*(.*)$/i;
    const malformedRe = /^(.+)- \[([ x\/!\-])\]\s+\[\[((?:chg|hotfix)-\d{8}-\d{2})(-[a-z0-9][a-z0-9-]*)?(?:\|[^\]]+)?\]\]\s*(.*)$/i;
    for (const line of String(activeText || '').split(/\r?\n/)) {
      let checkbox, idPart, slugPart, rest, malformed;
      const m = line.match(lineRe);
      if (m) {
        [, checkbox, idPart, slugPart, rest] = m;
        malformed = false;
      } else {
        const embedded = line.match(malformedRe);
        if (!embedded) continue;
        [, , checkbox, idPart, slugPart, rest] = embedded;
        malformed = true;
      }
      const idLower = idPart.toLowerCase();
      const slug = `${idLower}${(slugPart || '').toLowerCase()}`;
      const id = idLower.startsWith('chg-')
        ? `CHG-${idLower.slice(4).toUpperCase()}`
        : `HOTFIX-${idLower.slice(7).toUpperCase()}`;
      entries.push({ checkbox: checkbox.toLowerCase(), slug, id, rest: (rest || '').trim(), line, malformed });
    }
    return entries;
  }

  function readChangeDetail(cwd, idOrSlug) {
    const artDir = ctx.getArtifactDir(cwd);
    const fp = detailPathForId(artDir, idOrSlug);
    if (!fp) return null;
    try {
      const content = fs.readFileSync(fp, 'utf8');
      return { path: fp, content, frontmatter: parseFrontmatter(content) };
    } catch(e) {
      return { path: fp, missing: true, content: '', frontmatter: {} };
    }
  }

  function extractTaskSection(content) {
    const text = content || '';
    const header = text.match(/^## 任务清单\r?\n/m);
    if (!header) return '';
    const start = header.index + header[0].length;
    const rest = text.slice(start);
    const next = rest.search(/^## /m);
    return next >= 0 ? rest.slice(0, next) : rest;
  }

  function countDetailTasks(content) {
    const section = extractTaskSection(content);
    const pending = (section.match(/^- \[[ \/!]\]\s+T-\d{3}\b/gm) || []).length;
    const done = (section.match(/^- \[(?:x|-)\]\s+T-\d{3}\b/gm) || []).length;
    const inProgress = (section.match(/^- \[\/\]\s+T-\d{3}\b/gm) || []).length;
    const blocked = (section.match(/^- \[!\]\s+T-\d{3}\b/gm) || []).length;
    return { pending, done, total: pending + done, inProgress, blocked };
  }

  function normalizeFrontmatterStatus(value) {
    return String(value || '').replace(/^["']|["']$/g, '').trim();
  }

  // 可空 frontmatter 字段（如 change-set / change-set-seq）：去引号后，字面 null/空串归一为 JS null，
  // 其余返回去引号字符串。与 verified-date/reviewed-date 的 'null' 判定一致，保证向后兼容。
  function frontmatterNullable(value) {
    const v = normalizeFrontmatterStatus(value);
    return v && v.toLowerCase() !== 'null' ? v : null;
  }

  function classifyChange(entry) {
    const detail = entry && entry.detail;
    const fm = (detail && detail.frontmatter) || {};
    const status = normalizeFrontmatterStatus(detail && detail.frontmatter && detail.frontmatter.status);
    const tasks = detail && !detail.missing ? countDetailTasks(detail.content) : { pending: 0, done: 0, total: 0, inProgress: 0, blocked: 0 };
    const approved = isChangeApproved(detail);
    const verified = isChangeVerified(detail);
    const reviewed = isChangeReviewed(detail);
    const taskCheckbox = entry && entry.taskCheckbox;
    const implCheckbox = entry && entry.implCheckbox;
    const base = {
      id: entry && entry.id,
      slug: entry && entry.slug,
      status,
      tasks,
      approved,
      verified,
      reviewed,
      changeSet: frontmatterNullable(fm['change-set']),
      changeSetSeq: frontmatterNullable(fm['change-set-seq']),
      taskCheckbox,
      implCheckbox,
      detail,
      category: 'backlog',
      reason: '',
    };

    if (!entry || !entry.task || !entry.impl) {
      return { ...base, category: 'inconsistent', reason: 'index-missing' };
    }
    if (entry.taskMalformed || entry.implMalformed) {
      return { ...base, category: 'inconsistent', reason: 'index-malformed' };
    }
    if (!detail || detail.missing) {
      return { ...base, category: 'inconsistent', reason: 'detail-missing' };
    }
    if (taskCheckbox && implCheckbox && taskCheckbox !== implCheckbox) {
      return { ...base, category: 'inconsistent', reason: 'index-mismatch' };
    }
    if ((taskCheckbox === 'x' || implCheckbox === 'x') && tasks.pending > 0) {
      return { ...base, category: 'inconsistent', reason: 'index-completed-with-pending-tasks' };
    }
    if ((taskCheckbox === 'x' || implCheckbox === 'x') && !['completed', 'archived'].includes(status)) {
      return { ...base, category: 'inconsistent', reason: 'index-completed-status-mismatch' };
    }
    if ((['in-progress', 'completed'].includes(status) || taskCheckbox === '/' || implCheckbox === '/') && tasks.total === 0) {
      return { ...base, category: 'inconsistent', reason: 'task-list-empty' };
    }

    if (status === 'archived') return { ...base, category: 'inconsistent', reason: 'active-archived' };
    if (status === 'cancelled' || taskCheckbox === '-' || implCheckbox === '-') return { ...base, category: 'inconsistent', reason: 'active-cancelled' };
    if (taskCheckbox === '!' || implCheckbox === '!' || tasks.blocked > 0) return { ...base, category: 'blocked' };
    if (status === 'completed' || taskCheckbox === 'x' || implCheckbox === 'x') return { ...base, category: 'closing-required' };
    if (status === 'in-progress' || taskCheckbox === '/' || implCheckbox === '/') return { ...base, category: 'running' };
    if (status === 'planned' && approved) return { ...base, category: 'ready' };
    if (status === 'planned' || status === '') return { ...base, category: 'backlog' };
    return { ...base, category: 'inconsistent', reason: 'unknown-status' };
  }

  function getActiveChangeEntries(cwd) {
    const taskEntries = parseChangeIndex(ctx.readActive(cwd, 'task.md') || '');
    const implEntries = parseChangeIndex(ctx.readActive(cwd, 'implementation_plan.md') || '');
    const taskBySlug = new Map(taskEntries.map(e => [e.slug, e]));
    const implBySlug = new Map(implEntries.map(e => [e.slug, e]));
    const slugs = new Set([...taskBySlug.keys(), ...implBySlug.keys()]);
    const entries = [];
    for (const slug of slugs) {
      const task = taskBySlug.get(slug) || null;
      const impl = implBySlug.get(slug) || null;
      const base = task || impl;
      const detail = readChangeDetail(cwd, slug);
      entries.push({
        slug,
        id: base.id,
        task,
        impl,
        taskCheckbox: task && task.checkbox,
        implCheckbox: impl && impl.checkbox,
        taskMalformed: Boolean(task && task.malformed),
        implMalformed: Boolean(impl && impl.malformed),
        detail,
      });
    }
    return entries;
  }

  function isChangeApproved(detail) {
    if (!detail || detail.missing) return false;
    return /<!-- APPROVED -->/.test(detail.content);
  }

  function isChangeVerified(detail) {
    if (!detail || detail.missing) return false;
    const verifiedDate = normalizeFrontmatterStatus(detail.frontmatter['verified-date']).toLowerCase();
    return Boolean(verifiedDate && verifiedDate !== 'null' && /<!-- VERIFIED -->/.test(detail.content));
  }

  function isChangeReviewed(detail) {
    if (!detail || detail.missing) return false;
    const reviewedDate = normalizeFrontmatterStatus(detail.frontmatter['reviewed-date']).toLowerCase();
    return Boolean(reviewedDate && reviewedDate !== 'null' && /<!-- REVIEWED -->/.test(detail.content));
  }

  function summarizeActiveChanges(cwd) {
    return getActiveChangeEntries(cwd).map(entry => {
      const fm = entry.detail && entry.detail.frontmatter || {};
      const classified = classifyChange(entry);
      const tasks = entry.detail && !entry.detail.missing ? classified.tasks : null;
      // 透出 ## 任务清单段原文（复用 entry.detail.content，零额外 IO）：供 SessionStart core
      //   把任务行加工成注入本体（collect-state.js 按相关度分级）。读失败/无该段时为 ''，下游降级不崩。
      const taskSectionRaw = entry.detail && !entry.detail.missing ? extractTaskSection(entry.detail.content) : '';
      return {
        id: entry.id,
        slug: entry.slug,
        taskSectionRaw,
        taskCheckbox: entry.taskCheckbox || null,
        implCheckbox: entry.implCheckbox || null,
        status: fm.status || (entry.detail && entry.detail.missing ? 'missing-detail' : 'unknown'),
        category: classified.category,
        approved: isChangeApproved(entry.detail),
        verified: isChangeVerified(entry.detail),
        reviewed: isChangeReviewed(entry.detail),
        changeSet: frontmatterNullable(fm['change-set']),
        changeSetSeq: frontmatterNullable(fm['change-set-seq']),
        pending: tasks ? tasks.pending : null,
        done: tasks ? tasks.done : null,
        blocked: tasks ? tasks.blocked : null,
        path: entry.detail && entry.detail.path,
      };
    });
  }

  // 检测落在 <!-- ARCHIVE --> 下方（归档区）的活跃状态索引行（[ ]/[/]/[!]）。
  // 归档区应只含终态 [x]/[-]；活跃状态行出现在归档区 = create-chg 把新索引插错区
  // （见 finding-2026-06-07-create-chg-empty-active-archive-insert）。返回错位的 slug 列表。
  function findActiveIndexBelowArchive(content) {
    const text = String(content || '');
    const marker = text.match(/^<!-- ARCHIVE -->[ \t]*$/m);
    if (!marker) return [];
    const below = text.slice(marker.index + marker[0].length);
    const bad = [];
    for (const line of below.split(/\r?\n/)) {
      // HOTFIX-20260610-01：兼容带 slug 全名 + 可选 |别名形态；报告仍用纯 ID（人读定位）。
      const m = line.match(/^- \[([ /!])\] \[\[((?:chg|hotfix)-\d{8}-\d{2})(?:-[a-z0-9][a-z0-9-]*)?(?:\|[^\]]+)?\]\]/i);
      if (m) bad.push(m[2].toLowerCase());
    }
    return bad;
  }

  return {
    countByStatus,
    extractOpenKeys,
    normalizeFindingKey,
    normalizeFrontmatterStatus,
    detectLegacyImplFormat,
    parseFrontmatter,
    validateWalkthroughLinks,
    parseChangeIndex,
    readChangeDetail,
    extractTaskSection,
    countDetailTasks,
    classifyChange,
    getActiveChangeEntries,
    isChangeApproved,
    isChangeVerified,
    isChangeReviewed,
    summarizeActiveChanges,
    findActiveIndexBelowArchive,
  };
};
