const fs = require('fs');
const path = require('path');
const {
  PLAN_DIRS,
  PLAN_SYNC_LOCK_TTL_MS,
  PLAN_SYNC_LOCK_WAIT_MS,
  SYNC_PLAN_SCRIPT,
} = require('./constants');
const { normalizeLineEndings } = require('./line-endings');

module.exports = function createPlanUtils(ctx) {
  let _planFilesCache = { cwd: null, result: [] };

  function listPlanFiles(cwd) {
    if (_planFilesCache.cwd === cwd) return _planFilesCache.result;
    const results = [];
    const seen = new Set();
    for (const rel of PLAN_DIRS) {
      const dir = path.join(cwd, rel);
      try {
        for (const f of fs.readdirSync(dir)) {
          if (/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f) && !seen.has(f)) {
            seen.add(f);
            results.push({ name: f, dir: rel });
          }
        }
      } catch(e) {}
    }
    const sorted = results.sort((a, b) => b.name.localeCompare(a.name));
    _planFilesCache = { cwd, result: sorted };
    return sorted;
  }

  function hasPlanFiles(cwd) {
    return listPlanFiles(cwd).length > 0;
  }

  function hasUnsyncedPlanFiles(cwd) {
    return listUnsyncedPlanFiles(cwd).length > 0;
  }

  function listUnsyncedPlanFiles(cwd) {
    const plans = listPlanFiles(cwd);
    if (plans.length === 0) return [];
    const syncedPath = path.join(ctx.getProjectRuntimeDir(cwd), 'synced-plans');
    let synced = [];
    try { synced = fs.readFileSync(syncedPath, 'utf8').split('\n').filter(Boolean); } catch(e) {}
    const syncedSet = new Set(synced);
    for (const f of synced) {
      syncedSet.add(f.replace(/\.md$/, '-design.md'));
    }
    return plans.filter(p => !syncedSet.has(p.name));
  }

  function expandHomePath(value) {
    const raw = String(value || '').trim();
    if (raw === '~') return process.env.HOME || raw;
    if (raw.startsWith('~/') || raw.startsWith('~\\')) {
      const home = process.env.HOME || '';
      return home ? path.join(home, raw.slice(2)) : raw;
    }
    return raw;
  }

  function normalizePlanSyncTarget(cwd, planPath) {
    const raw = String(planPath || '').trim();
    if (!raw) return { ok: false, reason: 'missing-plan' };
    const resolved = path.resolve(cwd || process.cwd(), expandHomePath(raw));
    const name = path.basename(resolved);
    if (!/\.md$/i.test(name)) return { ok: false, reason: 'plan-not-markdown', planPath: resolved, name };
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return { ok: false, reason: 'plan-not-file', planPath: resolved, name };
    } catch(e) {
      return { ok: false, reason: 'plan-not-found', planPath: resolved, name, error: e.message || String(e) };
    }
    return { ok: true, planPath: resolved, name };
  }

  function syncPlanFile(cwd, planPath) {
    const target = normalizePlanSyncTarget(cwd, planPath);
    if (!target.ok) return { ok: false, ...target };

    const runtimeDir = ctx.getProjectRuntimeDir(cwd);
    const syncedPath = path.join(runtimeDir, 'synced-plans');
    const lockPath = path.join(runtimeDir, 'locks', 'synced-plans.lock');
    const lock = ctx.acquireJsonLock(lockPath, {
      version: 'plan-sync-v1',
      resource: 'synced-plans',
      cwd: String(cwd || ''),
      file: syncedPath,
      operation: 'sync-plan',
    }, { ttlMs: PLAN_SYNC_LOCK_TTL_MS, waitMs: PLAN_SYNC_LOCK_WAIT_MS });
    if (!lock.acquired) {
      return {
        ok: false,
        reason: 'synced-plans-locked',
        lock: lock.lock,
        waitedMs: lock.waitedMs,
        planPath: target.planPath,
        name: target.name,
        syncedPath,
        runtimeDir,
      };
    }

    try {
      fs.mkdirSync(runtimeDir, { recursive: true });
      let content = '';
      try { content = fs.readFileSync(syncedPath, 'utf8'); } catch(e) {}
      const normalized = normalizeLineEndings(content);
      const names = normalized.split('\n').map(line => line.trim()).filter(Boolean);
      if (names.includes(target.name)) {
        return { ok: true, already: true, planPath: target.planPath, name: target.name, syncedPath, runtimeDir };
      }
      const prefix = normalized && !normalized.endsWith('\n') ? '\n' : '';
      fs.appendFileSync(syncedPath, `${prefix}${target.name}\n`, 'utf8');
      return { ok: true, already: false, planPath: target.planPath, name: target.name, syncedPath, runtimeDir };
    } finally {
      try { fs.unlinkSync(lockPath); } catch(e) {}
    }
  }

  function getNativePlanPath(cwd) {
    const fp = path.join(ctx.getProjectRuntimeDir(cwd), 'current-native-plan');
    try {
      const planPath = fs.readFileSync(fp, 'utf8').trim();
      if (!planPath || !nativePlanMatchesProject(planPath, cwd)) return null;
      return planPath;
    } catch(e) { return null; }
  }

  function nativePlanMatchesProject(planPath, cwd) {
    const normalizedPlanPath = ctx.normalizePath(path.resolve(cwd || process.cwd(), String(planPath || '')));
    const normalizedCwd = ctx.normalizePath(path.resolve(cwd || process.cwd()));
    const cwdWithSlash = normalizedCwd.endsWith('/') ? normalizedCwd : normalizedCwd + '/';
    if (normalizedPlanPath.startsWith(cwdWithSlash)) return true;

    let content = '';
    try { content = fs.readFileSync(normalizedPlanPath, 'utf8').slice(0, 65536); } catch(e) { return false; }
    const normalizedContent = content.replace(/\\/g, '/').toLowerCase();
    if (normalizedContent.includes(normalizedCwd.toLowerCase())) return true;

    const candidates = new Set(ctx.getProjectNameCandidates(cwd)
      .map(name => String(name || '').toLowerCase())
      .filter(name => name.length >= 3));
    for (const name of candidates) {
      const re = new RegExp(`(^|[^a-z0-9_-])${ctx.escapeRegex(name)}([^a-z0-9_-]|$)`, 'i');
      if (re.test(normalizedContent)) return true;
    }
    return false;
  }

  function formatBridgeHint(cwd, artDir) {
    const planFiles = listUnsyncedPlanFiles(cwd);
    if (planFiles.length === 0) return null;
    const fileList = planFiles.slice(0, 3).map(p => `${p.dir}/${p.name}`).join(', ');
    const bridgeSteps = `调用 Skill(paceflow:pace-bridge)，按该 skill 读取计划、创建 v6 CHG、必要时 approve-and-start；bridge 成功后运行 plan 同步 helper：node "${SYNC_PLAN_SCRIPT}" --plan "<已桥接 plan 绝对路径>"。`;
    return { fileList, bridgeSteps };
  }

  return {
    listPlanFiles,
    hasPlanFiles,
    hasUnsyncedPlanFiles,
    listUnsyncedPlanFiles,
    syncPlanFile,
    getNativePlanPath,
    nativePlanMatchesProject,
    formatBridgeHint,
  };
};
