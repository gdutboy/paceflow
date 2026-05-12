const fs = require('fs');
const {
  normalizeChangeId,
  detailPathForId,
  slugForChangeId,
} = require('./change-id');

const COUNT_RE_PENDING = /- \[[ \/!]\]/g;
const COUNT_RE_PENDING_TOP = /^- \[[ \/!]\]/gm;
const COUNT_RE_DONE = /- \[x\]|- \[-\]/g;
const COUNT_RE_DONE_TOP = /^- \[x\]|^- \[-\]/gm;

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
    const match = content && content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
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
      if (!link) {
        issues.push(`walkthrough.md 行 ${expectedId} 缺少 wikilink，应为 [[${expectedSlug}]]。`);
        continue;
      }
      const target = String(link[1] || '').trim().toLowerCase();
      if (target !== expectedSlug) {
        issues.push(`walkthrough.md 行 ${expectedId} 的 wikilink 应为 [[${expectedSlug}]]，当前为 [[${target}]]。`);
        continue;
      }
      const detailPath = detailPathForId(artDir, expectedId);
      if (detailPath && !fs.existsSync(detailPath)) {
        issues.push(`walkthrough.md 行 ${expectedId} 指向 [[${expectedSlug}]]，但详情文件不存在：changes/${expectedSlug}.md。`);
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
    const re = /^- \[([ x\/!\-])\]\s+\[\[((?:chg|hotfix)-\d{8}-\d{2})(?:\|[^\]]+)?\]\]\s*(.*)$/gmi;
    let m;
    while ((m = re.exec(activeText || '')) !== null) {
      const slug = m[2].toLowerCase();
      const id = slug.startsWith('chg-')
        ? `CHG-${slug.slice(4).toUpperCase()}`
        : `HOTFIX-${slug.slice(7).toUpperCase()}`;
      entries.push({ checkbox: m[1], slug, id, rest: (m[3] || '').trim(), line: m[0] });
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

  function classifyChange(entry) {
    const detail = entry && entry.detail;
    const status = normalizeFrontmatterStatus(detail && detail.frontmatter && detail.frontmatter.status);
    const tasks = detail && !detail.missing ? countDetailTasks(detail.content) : { pending: 0, done: 0, total: 0, inProgress: 0, blocked: 0 };
    const approved = isChangeApproved(detail);
    const verified = isChangeVerified(detail);
    const taskCheckbox = entry && entry.taskCheckbox;
    const implCheckbox = entry && entry.implCheckbox;
    const base = {
      id: entry && entry.id,
      slug: entry && entry.slug,
      status,
      tasks,
      approved,
      verified,
      taskCheckbox,
      implCheckbox,
      detail,
      category: 'backlog',
      reason: '',
    };

    if (!entry || !entry.task || !entry.impl) {
      return { ...base, category: 'inconsistent', reason: 'index-missing' };
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
    const verifiedDate = (detail.frontmatter['verified-date'] || '').trim();
    return verifiedDate && verifiedDate !== 'null' && /<!-- VERIFIED -->/.test(detail.content);
  }

  function summarizeActiveChanges(cwd) {
    return getActiveChangeEntries(cwd).map(entry => {
      const fm = entry.detail && entry.detail.frontmatter || {};
      const classified = classifyChange(entry);
      const tasks = entry.detail && !entry.detail.missing ? classified.tasks : null;
      return {
        id: entry.id,
        slug: entry.slug,
        taskCheckbox: entry.taskCheckbox || null,
        implCheckbox: entry.implCheckbox || null,
        status: fm.status || (entry.detail && entry.detail.missing ? 'missing-detail' : 'unknown'),
        category: classified.category,
        approved: isChangeApproved(entry.detail),
        verified: isChangeVerified(entry.detail),
        pending: tasks ? tasks.pending : null,
        done: tasks ? tasks.done : null,
        path: entry.detail && entry.detail.path,
      };
    });
  }

  return {
    countByStatus,
    extractOpenKeys,
    normalizeFindingKey,
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
    summarizeActiveChanges,
  };
};
