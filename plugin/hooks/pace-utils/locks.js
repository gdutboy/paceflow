const fs = require('fs');
const path = require('path');
const {
  ARTIFACT_WRITER_LOCK_FILE,
  ARTIFACT_WRITER_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_WAIT_MS,
  ARTIFACT_SEQUENCE_LOCK_TTL_MS,
  ARTIFACT_SEQUENCE_LOCK_WAIT_MS,
} = require('./constants');
const {
  normalizeChangeId,
  slugForChangeId,
} = require('./change-id');

module.exports = function createLockUtils(ctx) {
  function getArtifactWriterLockPath(cwd) {
    return path.join(ctx.getProjectRuntimeDir(cwd), ARTIFACT_WRITER_LOCK_FILE);
  }

  function readArtifactWriterLock(cwd) {
    const lockPath = getArtifactWriterLockPath(cwd);
    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ok: true,
        path: lockPath,
        sessionId: ctx.normalizeSessionId(parsed.sessionId || parsed.session_id),
        agentId: String(parsed.agentId || parsed.agent_id || '').trim(),
        artifactDir: String(parsed.artifactDir || parsed.artifact_dir || ''),
        cwd: String(parsed.cwd || ''),
        operation: String(parsed.operation || ''),
        createdAt: String(parsed.createdAt || parsed.created_at || ''),
        timestampMs: Number(parsed.timestampMs || parsed.timestamp_ms || 0) || 0,
        raw: parsed,
      };
    } catch(e) {
      return { ok: false, path: lockPath, error: e.message };
    }
  }

  function isArtifactWriterLockStale(lock, now = Date.now()) {
    if (!lock) return false;
    if (!lock.ok) return true;
    if (!lock.timestampMs) return true;
    return now - lock.timestampMs > ARTIFACT_WRITER_LOCK_TTL_MS;
  }

  function formatArtifactWriterLock(lock) {
    if (!lock || !lock.ok) return 'unknown lock';
    const ageSec = lock.timestampMs ? Math.max(0, Math.round((Date.now() - lock.timestampMs) / 1000)) : '?';
    return `session=${lock.sessionId || '-'} agent=${lock.agentId || '-'} artifact_dir=${ctx.displayDir(lock.artifactDir)} age=${ageSec}s lock=${lock.path}`;
  }

  function operationFromAgentPrompt(prompt) {
    const text = String(prompt || '');
    const byField = text.match(/^\s*(?:operation|指令)\s*[:=]\s*([a-z0-9-]+)/mi);
    if (byField) return byField[1].toLowerCase();
    const known = text.match(/\b(create-chg|update-chg|archive-chg|close-chg|record-finding|record-correction)\b/i);
    if (known) return known[1].toLowerCase();
    if (/(?:^|[\s\n,，;；])(approve-and-start|approve|update-status|verify)(?=$|[\s\n,，;；:：])/i.test(text)) return 'update-chg';
    return '';
  }

  function changeIdFromAgentPrompt(prompt) {
    const text = String(prompt || '');
    const target = text.match(/^\s*(?:target|change-id|chg-id)\s*[:=]\s*["']?((?:CHG|HOTFIX)-\d{8}-\d{2})["']?\s*$/mi);
    if (target) return target[1].toUpperCase();
    const reserved = text.match(/^\s*reserved-id\s*[:=]\s*["']?((?:CHG|HOTFIX)-\d{8}-\d{2})["']?\s*$/mi);
    if (reserved) return reserved[1].toUpperCase();
    const any = text.match(/\b((?:CHG|HOTFIX)-\d{8}-\d{2})\b/i);
    return any ? any[1].toUpperCase() : '';
  }

  function explicitChangeTargetFromAgentPrompt(prompt) {
    const text = String(prompt || '');
    const target = text.match(/^\s*(?:target|change-id|chg-id)\s*[:=]\s*["']?((?:CHG|HOTFIX)-\d{8}-\d{2})["']?\s*$/mi);
    return target ? target[1].toUpperCase() : '';
  }

  function acquireArtifactWriterLock(cwd, info = {}) {
    const lockPath = getArtifactWriterLockPath(cwd);
    const runtimeDir = path.dirname(lockPath);
    const sessionId = ctx.normalizeSessionId(info.sessionId || ctx.currentSessionId());
    const now = Date.now();
    const payload = {
      sessionId,
      agentId: String(info.agentId || ''),
      artifactDir: String(info.artifactDir || ''),
      cwd: String(cwd || ''),
      operation: String(info.operation || ''),
      createdAt: new Date(now).toISOString(),
      timestampMs: now,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        fs.mkdirSync(runtimeDir, { recursive: true });
        const fd = fs.openSync(lockPath, 'wx');
        try { fs.writeFileSync(fd, `${JSON.stringify(payload, null, 2)}\n`, 'utf8'); }
        finally { fs.closeSync(fd); }
        return { acquired: true, path: lockPath, lock: { ok: true, path: lockPath, ...payload } };
      } catch(e) {
        if (e && e.code === 'EEXIST') {
          const existing = readArtifactWriterLock(cwd);
          if (isArtifactWriterLockStale(existing, now)) {
            try {
              fs.unlinkSync(lockPath);
            } catch(e2) {
              if (!e2 || e2.code !== 'ENOENT') {
                return { acquired: false, path: lockPath, lock: existing, reason: e2 && e2.message || String(e2) };
              }
            }
            continue;
          }
          return { acquired: false, path: lockPath, lock: existing, reason: 'locked' };
        }
        return { acquired: false, path: lockPath, lock: null, reason: e.message || String(e) };
      }
    }
    return { acquired: false, path: lockPath, lock: readArtifactWriterLock(cwd), reason: 'locked' };
  }

  function artifactWriterLockMatches(cwd, sessionId) {
    const lock = readArtifactWriterLock(cwd);
    if (!lock.ok) return { ok: false, lock, reason: 'missing' };
    if (isArtifactWriterLockStale(lock)) {
      try { fs.unlinkSync(lock.path); } catch(e) {}
      return { ok: false, lock, reason: 'stale-cleared' };
    }
    const sid = ctx.normalizeSessionId(sessionId || ctx.currentSessionId());
    if (!sid || !lock.sessionId || lock.sessionId !== sid) {
      return { ok: false, lock, reason: 'owner-mismatch' };
    }
    return { ok: true, lock, reason: '' };
  }

  function releaseArtifactWriterLock(cwd, info = {}) {
    const lock = readArtifactWriterLock(cwd);
    if (!lock.ok) return { released: false, lock, reason: 'missing' };
    const sessionId = ctx.normalizeSessionId(info.sessionId || ctx.currentSessionId());
    const agentId = String(info.agentId || '').trim();
    const sameSession = sessionId && lock.sessionId && sessionId === lock.sessionId;
    const sameAgent = agentId && lock.agentId && agentId === lock.agentId;
    if (!sameSession && !sameAgent && !isArtifactWriterLockStale(lock)) {
      return { released: false, lock, reason: 'owner-mismatch' };
    }
    try {
      fs.unlinkSync(lock.path);
      return { released: true, lock, reason: '' };
    } catch(e) {
      return { released: false, lock, reason: e.message || String(e) };
    }
  }

  function sleepSync(ms) {
    if (!ms || ms <= 0) return;
    const sab = new SharedArrayBuffer(4);
    Atomics.wait(new Int32Array(sab), 0, 0, Math.max(1, Math.floor(ms)));
  }

  function lockOwnerInfo(info = {}) {
    const sessionId = ctx.normalizeSessionId(info.sessionId || ctx.currentSessionId());
    const agentId = String(info.agentId || '').trim();
    const ownerKey = agentId ? `agent:${agentId}` : (sessionId ? `session:${sessionId}` : '');
    return { sessionId, agentId, ownerKey };
  }

  function lockMatchesOwner(lock, info = {}) {
    if (!lock || !lock.ok) return false;
    const owner = lockOwnerInfo(info);
    if (owner.agentId && lock.agentId) return owner.agentId === lock.agentId;
    if (owner.ownerKey && lock.ownerKey && owner.ownerKey === lock.ownerKey) return true;
    return !!owner.sessionId && !!lock.sessionId && owner.sessionId === lock.sessionId;
  }

  function safeLockName(value) {
    return encodeURIComponent(String(value || 'unknown')).replace(/%/g, '_');
  }

  function readJsonLock(lockPath) {
    try {
      const raw = fs.readFileSync(lockPath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        ok: true,
        path: lockPath,
        sessionId: ctx.normalizeSessionId(parsed.sessionId || parsed.session_id),
        agentId: String(parsed.agentId || parsed.agent_id || '').trim(),
        ownerKey: String(parsed.ownerKey || parsed.owner_key || '').trim(),
        resource: String(parsed.resource || ''),
        artifactDir: String(parsed.artifactDir || parsed.artifact_dir || ''),
        cwd: String(parsed.cwd || ''),
        file: String(parsed.file || ''),
        operation: String(parsed.operation || ''),
        createdAt: String(parsed.createdAt || parsed.created_at || ''),
        timestampMs: Number(parsed.timestampMs || parsed.timestamp_ms || 0) || 0,
        raw: parsed,
      };
    } catch(e) {
      return { ok: false, path: lockPath, error: e.message };
    }
  }

  function jsonLockIsStale(lock, ttlMs, now = Date.now()) {
    if (!lock) return false;
    if (!lock.ok) return true;
    if (!lock.timestampMs) return true;
    return now - lock.timestampMs > ttlMs;
  }

  function acquireJsonLock(lockPath, payload, { ttlMs, waitMs } = {}) {
    const started = Date.now();
    const deadline = started + Math.max(0, waitMs || 0);
    let delay = 50;
    for (;;) {
      const now = Date.now();
      try {
        fs.mkdirSync(path.dirname(lockPath), { recursive: true });
        const fd = fs.openSync(lockPath, 'wx');
        try { fs.writeFileSync(fd, `${JSON.stringify({ ...payload, timestampMs: now, createdAt: new Date(now).toISOString() }, null, 2)}\n`, 'utf8'); }
        finally { fs.closeSync(fd); }
        return { acquired: true, path: lockPath, lock: readJsonLock(lockPath), waitedMs: now - started };
      } catch(e) {
        if (e && e.code === 'EEXIST') {
          const existing = readJsonLock(lockPath);
          if (jsonLockIsStale(existing, ttlMs, now)) {
            try {
              fs.unlinkSync(lockPath);
            } catch(e2) {
              if (!e2 || e2.code !== 'ENOENT') {
                return { acquired: false, path: lockPath, lock: existing, reason: e2 && e2.message || String(e2), waitedMs: Date.now() - started };
              }
            }
            continue;
          }
          if (lockMatchesOwner(existing, payload)) {
            return { acquired: true, reentrant: true, path: lockPath, lock: existing, waitedMs: now - started };
          }
          if (now < deadline) {
            sleepSync(Math.min(delay, deadline - now));
            delay = Math.min(250, delay * 2);
            continue;
          }
          return { acquired: false, path: lockPath, lock: existing, reason: 'locked', waitedMs: now - started };
        }
        return { acquired: false, path: lockPath, lock: null, reason: e.message || String(e), waitedMs: Date.now() - started };
      }
    }
  }

  function releaseJsonLock(lockPath, info = {}, { ttlMs = ARTIFACT_RESOURCE_LOCK_TTL_MS } = {}) {
    const lock = readJsonLock(lockPath);
    if (!lock.ok) return { released: false, lock, reason: 'missing' };
    if (!lockMatchesOwner(lock, info) && !jsonLockIsStale(lock, ttlMs)) {
      return { released: false, lock, reason: 'owner-mismatch' };
    }
    try {
      fs.unlinkSync(lockPath);
      return { released: true, lock, reason: '' };
    } catch(e) {
      return { released: false, lock, reason: e.message || String(e) };
    }
  }

  function getArtifactResourceLockDir(cwd) {
    return path.join(ctx.getProjectRuntimeDir(cwd), 'locks', 'artifacts');
  }

  function getArtifactResourceLockPath(cwd, resource) {
    return path.join(getArtifactResourceLockDir(cwd), `${safeLockName(resource)}.lock`);
  }

  function readArtifactResourceLock(cwd, resource) {
    return readJsonLock(getArtifactResourceLockPath(cwd, resource));
  }

  function artifactResourceForRel(artifactRel) {
    const rel = String(artifactRel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || rel === 'spec.md') return '';
    if (rel === 'task.md' || rel === 'implementation_plan.md') return 'index:changes';
    if (rel === 'findings.md' || rel === 'corrections.md' || rel === 'walkthrough.md') return `index:${rel}`;
    if (/^changes\/.+\.md$/i.test(rel)) return `detail:${rel}`;
    return '';
  }

  function formatArtifactResourceLock(lock) {
    if (!lock || !lock.ok) return 'unknown lock';
    const ageSec = lock.timestampMs ? Math.max(0, Math.round((Date.now() - lock.timestampMs) / 1000)) : '?';
    return `resource=${lock.resource || '-'} session=${lock.sessionId || '-'} agent=${lock.agentId || '-'} file=${lock.file || '-'} age=${ageSec}s lock=${lock.path}`;
  }

  function acquireArtifactResourceLock(cwd, resource, info = {}) {
    if (!resource) return { acquired: true, path: '', lock: null, reason: 'no-resource' };
    const owner = lockOwnerInfo(info);
    const payload = {
      version: 'resource-v1',
      resource,
      sessionId: owner.sessionId,
      agentId: owner.agentId,
      ownerKey: owner.ownerKey,
      artifactDir: String(info.artifactDir || ''),
      cwd: String(cwd || ''),
      file: String(info.file || ''),
      operation: String(info.operation || ''),
      toolName: String(info.toolName || ''),
    };
    return acquireJsonLock(getArtifactResourceLockPath(cwd, resource), payload, {
      ttlMs: ARTIFACT_RESOURCE_LOCK_TTL_MS,
      waitMs: ARTIFACT_RESOURCE_LOCK_WAIT_MS,
    });
  }

  function releaseArtifactResourceLock(cwd, resource, info = {}) {
    if (!resource) return { released: false, lock: null, reason: 'no-resource' };
    return releaseJsonLock(getArtifactResourceLockPath(cwd, resource), info, { ttlMs: ARTIFACT_RESOURCE_LOCK_TTL_MS });
  }

  function ownerScopedPath(cwd, dirName, info = {}) {
    const owner = lockOwnerInfo(info);
    if (!owner.ownerKey) return '';
    return path.join(ctx.getProjectRuntimeDir(cwd), dirName, `${safeLockName(owner.ownerKey)}.json`);
  }

  function getArtifactReservationPath(cwd, info = {}) {
    return ownerScopedPath(cwd, 'reservations', info);
  }

  function getArtifactReservationDir(cwd) {
    return path.join(ctx.getProjectRuntimeDir(cwd), 'reservations');
  }

  function reservationMatchesOwner(reservation, info = {}) {
    if (!reservation) return false;
    const owner = lockOwnerInfo(info);
    if (owner.agentId && reservation.agentId) return owner.agentId === reservation.agentId;
    if (owner.ownerKey && reservation.ownerKey && owner.ownerKey === reservation.ownerKey) return true;
    return !!owner.sessionId && !!reservation.sessionId && owner.sessionId === reservation.sessionId;
  }

  function readArtifactReservation(cwd, info = {}) {
    const fp = getArtifactReservationPath(cwd, info);
    if (fp) {
      try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch(e) {}
    }
    if (info.agentId) {
      const fallback = getArtifactReservationPath(cwd, { ...info, agentId: '' });
      if (fallback && fallback !== fp) {
        try { return JSON.parse(fs.readFileSync(fallback, 'utf8')); } catch(e) {}
      }
    }
    return null;
  }

  function writeArtifactReservation(cwd, info = {}, reservation = {}) {
    const fp = getArtifactReservationPath(cwd, info);
    if (!fp) return { ok: false, reason: 'missing-owner' };
    try {
      const data = { ...reservation, ...lockOwnerInfo(info), createdAt: new Date().toISOString(), timestampMs: Date.now() };
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      const uniqueKey = reservation.id || reservation.fileRel || reservation.filePrefix || '';
      if (uniqueKey) {
        const uniquePath = path.join(getArtifactReservationDir(cwd), `${safeLockName(`${data.ownerKey}:${uniqueKey}`)}.json`);
        if (uniquePath !== fp) fs.writeFileSync(uniquePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      }
      return { ok: true, path: fp };
    } catch(e) {
      return { ok: false, reason: e.message || String(e) };
    }
  }

  function clearArtifactReservation(cwd, info = {}) {
    const fp = getArtifactReservationPath(cwd, info);
    let cleared = false;
    if (fp) {
      try { fs.unlinkSync(fp); cleared = true; } catch(e) {}
    }
    let files = [];
    try { files = fs.readdirSync(getArtifactReservationDir(cwd)); } catch(e) { files = []; }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const target = path.join(getArtifactReservationDir(cwd), file);
      let parsed = null;
      try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')); } catch(e) {}
      const shouldClear = info.agentId
        ? (String(parsed && parsed.agentId || '').trim() === String(info.agentId).trim())
        : reservationMatchesOwner(parsed, info);
      if (shouldClear) {
        try { fs.unlinkSync(target); cleared = true; } catch(e) {}
      }
    }
    return cleared;
  }

  function clearArtifactReservationForRel(cwd, info = {}, artifactRel = '') {
    const rel = String(artifactRel || '').replace(/\\/g, '/');
    if (!rel) return false;
    let cleared = false;
    let files = [];
    try { files = fs.readdirSync(getArtifactReservationDir(cwd)); } catch(e) { files = []; }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const target = path.join(getArtifactReservationDir(cwd), file);
      let parsed = null;
      try { parsed = JSON.parse(fs.readFileSync(target, 'utf8')); } catch(e) {}
      if (!reservationMatchesOwner(parsed, info)) continue;
      if (!reservationMatchesArtifactRel(parsed, rel).ok) continue;
      try { fs.unlinkSync(target); cleared = true; } catch(e) {}
    }
    return cleared;
  }

  function findArtifactReservationForRel(cwd, info = {}, artifactRel = '') {
    const candidates = [];
    const direct = readArtifactReservation(cwd, info);
    if (direct) candidates.push(direct);
    let files = [];
    try { files = fs.readdirSync(getArtifactReservationDir(cwd)); } catch(e) { files = []; }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try { candidates.push(JSON.parse(fs.readFileSync(path.join(getArtifactReservationDir(cwd), file), 'utf8'))); } catch(e) {}
    }
    const seen = new Set();
    for (const candidate of candidates) {
      const key = `${candidate && candidate.ownerKey}:${candidate && (candidate.fileRel || candidate.filePrefix || candidate.id)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (candidate && candidate.timestampMs && Date.now() - candidate.timestampMs > ARTIFACT_WRITER_LOCK_TTL_MS) continue;
      if (!reservationMatchesOwner(candidate, info)) continue;
      if (reservationMatchesArtifactRel(candidate, artifactRel).ok) return candidate;
    }
    return null;
  }

  function releaseArtifactResourcesForOwner(cwd, info = {}) {
    const owner = lockOwnerInfo(info);
    const released = [];
    const dirs = [
      getArtifactResourceLockDir(cwd),
      path.join(ctx.getProjectRuntimeDir(cwd), 'locks', 'sequences'),
    ];
    for (const dir of dirs) {
      let files = [];
      try { files = fs.readdirSync(dir); } catch(e) { continue; }
      for (const file of files) {
        if (!file.endsWith('.lock')) continue;
        const fp = path.join(dir, file);
        const lock = readJsonLock(fp);
        if (lockMatchesOwner(lock, owner) || jsonLockIsStale(lock, ARTIFACT_RESOURCE_LOCK_TTL_MS)) {
          try {
            fs.unlinkSync(fp);
            released.push(fp);
          } catch(e) {}
        }
      }
    }
    clearArtifactReservation(cwd, owner);
    const txPath = ownerScopedPath(cwd, 'index-transactions', owner);
    try { fs.unlinkSync(txPath); } catch(e) {}
    return released;
  }

  function getChangeOwnerDir(cwd) {
    return path.join(ctx.getProjectRuntimeDir(cwd), 'change-owners');
  }

  function getChangeOwnerPath(cwd, changeId) {
    const id = normalizeChangeId(changeId);
    if (!id) return '';
    return path.join(getChangeOwnerDir(cwd), `${slugForChangeId(id)}.json`);
  }

  function readChangeOwner(cwd, changeId) {
    const fp = getChangeOwnerPath(cwd, changeId);
    if (!fp) return { ok: false, path: '', reason: 'invalid-id' };
    try {
      const parsed = JSON.parse(fs.readFileSync(fp, 'utf8'));
      return {
        ok: true,
        path: fp,
        changeId: normalizeChangeId(parsed.changeId || parsed.change_id || changeId),
        sessionId: ctx.normalizeSessionId(parsed.sessionId || parsed.session_id),
        agentId: String(parsed.agentId || parsed.agent_id || '').trim(),
        ownerKey: String(parsed.ownerKey || parsed.owner_key || '').trim(),
        state: String(parsed.state || 'active'),
        cwd: String(parsed.cwd || ''),
        stateDir: String(parsed.stateDir || parsed.state_dir || ''),
        worktree: String(parsed.worktree || ''),
        branch: String(parsed.branch || ''),
        operation: String(parsed.operation || ''),
        createdAt: String(parsed.createdAt || parsed.created_at || ''),
        updatedAt: String(parsed.updatedAt || parsed.updated_at || ''),
        timestampMs: Number(parsed.timestampMs || parsed.timestamp_ms || 0) || 0,
        raw: parsed,
      };
    } catch(e) {
      return { ok: false, path: fp, reason: e.message || String(e) };
    }
  }

  function writeChangeOwner(cwd, changeId, info = {}) {
    const id = normalizeChangeId(changeId);
    const fp = getChangeOwnerPath(cwd, id);
    if (!id || !fp) return { ok: false, reason: 'invalid-id' };
    const owner = lockOwnerInfo(info);
    if (!owner.sessionId && !owner.agentId) return { ok: false, reason: 'missing-owner' };
    const existing = readChangeOwner(cwd, id);
    const context = ctx.executionContextForCwd(cwd);
    const now = Date.now();
    const payload = {
      version: 'change-owner-v1',
      changeId: id,
      sessionId: owner.sessionId,
      agentId: owner.agentId,
      ownerKey: owner.ownerKey,
      state: String(info.state || 'active'),
      cwd: context.cwd,
      stateDir: context.stateDir,
      worktree: context.worktree,
      branch: context.branch,
      executionContext: context.text,
      operation: String(info.operation || ''),
      createdAt: existing.ok && existing.createdAt ? existing.createdAt : new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      timestampMs: now,
    };
    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      return { ok: true, path: fp, owner: payload };
    } catch(e) {
      return { ok: false, path: fp, reason: e.message || String(e) };
    }
  }

  function markChangeOwnerClosed(cwd, changeId, info = {}) {
    const current = readChangeOwner(cwd, changeId);
    if (!current.ok) return { ok: false, reason: 'missing' };
    const owner = lockOwnerInfo(info);
    if (!lockMatchesOwner({ ok: true, ...current }, owner) && !jsonLockIsStale(current, ctx.CHANGE_OWNER_TTL_MS)) {
      return { ok: false, reason: 'owner-mismatch', owner: current };
    }
    return writeChangeOwner(cwd, changeId, { ...info, state: 'closed', operation: info.operation || current.operation || 'close' });
  }

  function touchChangeOwnersForSession(cwd, info = {}) {
    const sid = ctx.normalizeSessionId(info.sessionId || info.session_id || ctx.currentSessionId());
    if (!sid) return [];
    const states = Array.isArray(info.states) && info.states.length > 0 ? new Set(info.states) : null;
    const dir = getChangeOwnerDir(cwd);
    let files = [];
    try { files = fs.readdirSync(dir); } catch(e) { return []; }
    const context = ctx.executionContextForCwd(cwd);
    const now = Date.now();
    const touched = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const fp = path.join(dir, file);
      let parsed = null;
      try { parsed = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch(e) { continue; }
      const ownerSid = ctx.normalizeSessionId(parsed.sessionId || parsed.session_id);
      const state = String(parsed.state || 'active');
      if (ownerSid !== sid || state === 'closed') continue;
      if (states && !states.has(state)) continue;
      const next = {
        ...parsed,
        cwd: context.cwd,
        stateDir: context.stateDir,
        worktree: context.worktree,
        branch: context.branch,
        executionContext: context.text,
        updatedAt: new Date(now).toISOString(),
        timestampMs: now,
      };
      try {
        fs.writeFileSync(fp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
        touched.push(normalizeChangeId(parsed.changeId || parsed.change_id || file.replace(/\.json$/, '')) || file.replace(/\.json$/, ''));
      } catch(e) {}
    }
    return touched;
  }

  function changeOwnerStatus(cwd, changeId, sessionId = ctx.currentSessionId()) {
    const owner = readChangeOwner(cwd, changeId);
    if (!owner.ok) return { disposition: 'unknown', owner, current: false, fresh: false, stale: false };
    const sid = ctx.normalizeSessionId(sessionId || ctx.currentSessionId());
    const sameSession = !!sid && !!owner.sessionId && sid === owner.sessionId;
    const context = ctx.executionContextForCwd(cwd);
    const sameCwd = !!owner.cwd && ctx.normalizePath(path.resolve(owner.cwd)) === ctx.normalizePath(context.cwd);
    const sameStateDir = !!owner.stateDir && ctx.normalizePath(path.resolve(owner.stateDir)) === ctx.normalizePath(context.stateDir);
    const sameWorktreeName = !!owner.worktree && owner.worktree === context.worktree;
    const sameBranch = !!owner.branch && owner.branch === context.branch;
    const sameCheckout = sameCwd ||
      (sameStateDir && sameWorktreeName && sameBranch) ||
      (!owner.cwd && !owner.stateDir && sameWorktreeName && sameBranch);
    const stale = jsonLockIsStale(owner, ctx.CHANGE_OWNER_TTL_MS);
    const closed = owner.state === 'closed';
    if (sameSession) return { disposition: closed ? 'current-closed' : 'current', owner, current: true, sameSession: true, sameCheckout, fresh: true, stale: false };
    if (closed) return { disposition: 'closed', owner, current: false, fresh: true, stale: false };
    if (sameCheckout) return { disposition: 'current-worktree', owner, current: true, sameSession: false, sameCheckout: true, fresh: !stale, stale };
    if (stale) return { disposition: 'foreign-stale', owner, current: false, fresh: false, stale: true };
    return { disposition: 'foreign-fresh', owner, current: false, fresh: true, stale: false };
  }

  function ownerTakeoverConfirmed(prompt) {
    const text = String(prompt || '');
    return /^\s*owner-takeover-confirmed\s*[:=]\s*true\b/mi.test(text) &&
      /^\s*owner-takeover-source\s*[:=]\s*user-directive\b/mi.test(text) &&
      /^\s*owner-takeover-evidence\s*[:=]\s*\S+/mi.test(text);
  }

  function markIndexChangesTouchedAndMaybeRelease(cwd, artifactRel, info = {}) {
    const rel = String(artifactRel || '').replace(/\\/g, '/');
    if (rel !== 'task.md' && rel !== 'implementation_plan.md') {
      return releaseArtifactResourceLock(cwd, artifactResourceForRel(rel), info);
    }
    const txPath = ownerScopedPath(cwd, 'index-transactions', info);
    if (!txPath) return { released: false, reason: 'missing-owner' };
    let tx = { touched: [] };
    try { tx = JSON.parse(fs.readFileSync(txPath, 'utf8')); } catch(e) {}
    const touched = new Set(Array.isArray(tx.touched) ? tx.touched : []);
    touched.add(rel);
    tx = { ...lockOwnerInfo(info), touched: [...touched].sort(), updatedAt: new Date().toISOString(), timestampMs: Date.now() };
    try {
      fs.mkdirSync(path.dirname(txPath), { recursive: true });
      fs.writeFileSync(txPath, `${JSON.stringify(tx, null, 2)}\n`, 'utf8');
    } catch(e) {}
    if (touched.has('task.md') && touched.has('implementation_plan.md')) {
      const release = releaseArtifactResourceLock(cwd, 'index:changes', info);
      try { fs.unlinkSync(txPath); } catch(e) {}
      return release;
    }
    return { released: false, reason: 'index-transaction-open', touched: [...touched].sort() };
  }

  function readArtifactIndexTransaction(cwd, info = {}) {
    const txPath = ownerScopedPath(cwd, 'index-transactions', info);
    if (!txPath) return { ok: false, path: '', touched: [], reason: 'missing-owner' };
    try {
      const parsed = JSON.parse(fs.readFileSync(txPath, 'utf8'));
      const touched = Array.isArray(parsed.touched) ? parsed.touched : [];
      return { ok: true, path: txPath, touched, raw: parsed };
    } catch(e) {
      return { ok: false, path: txPath, touched: [], reason: e.message || String(e) };
    }
  }

  function scanMaxNumberInDir(dir, re) {
    let max = 0;
    let files = [];
    try { files = fs.readdirSync(dir); } catch(e) { return 0; }
    for (const file of files) {
      const m = String(file).match(re);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    }
    return max;
  }

  function nextSequenceNumber(cwd, sequenceName, existingMax) {
    const runtime = ctx.getProjectRuntimeDir(cwd);
    const lockPath = path.join(runtime, 'locks', 'sequences', `${safeLockName(sequenceName)}.lock`);
    const counterPath = path.join(runtime, 'sequences', `${safeLockName(sequenceName)}.counter`);
    const owner = lockOwnerInfo({ sessionId: ctx.currentSessionId() });
    const lock = acquireJsonLock(lockPath, {
      version: 'sequence-v1',
      resource: `sequence:${sequenceName}`,
      sessionId: owner.sessionId,
      ownerKey: owner.ownerKey,
    }, { ttlMs: ARTIFACT_SEQUENCE_LOCK_TTL_MS, waitMs: ARTIFACT_SEQUENCE_LOCK_WAIT_MS });
    if (!lock.acquired) return { ok: false, reason: 'sequence-locked', lock: lock.lock };
    try {
      let current = 0;
      try { current = Number(fs.readFileSync(counterPath, 'utf8').trim()) || 0; } catch(e) {}
      const next = Math.max(current, existingMax || 0) + 1;
      fs.mkdirSync(path.dirname(counterPath), { recursive: true });
      fs.writeFileSync(counterPath, `${next}\n`, 'utf8');
      return { ok: true, number: next, counterPath };
    } finally {
      try { fs.unlinkSync(lockPath); } catch(e) {}
    }
  }

  function inferChangeKindFromPrompt(prompt) {
    const text = String(prompt || '');
    if (/^\s*type\s*[:=]\s*["']?hotfix["']?\s*$/mi.test(text) || /["']type["']\s*:\s*["']hotfix["']/i.test(text)) {
      return 'HOTFIX';
    }
    return 'CHG';
  }

  function reserveArtifactId(cwd, info = {}) {
    const operation = String(info.operation || operationFromAgentPrompt(info.prompt)).toLowerCase();
    const artDir = info.artifactDir || ctx.getArtifactDir(cwd);
    const owner = lockOwnerInfo(info);
    if (!owner.ownerKey) return { reserved: false, reason: 'missing-owner' };

    if (operation === 'create-chg') {
      const kind = inferChangeKindFromPrompt(info.prompt);
      const dateCompact = ctx.todayISO().replace(/-/g, '');
      const lower = kind.toLowerCase();
      const existingMax = scanMaxNumberInDir(path.join(artDir, 'changes'), new RegExp(`^${lower}-${dateCompact}-(\\d{2})\\.md$`, 'i'));
      const seq = nextSequenceNumber(cwd, `${lower}-${dateCompact}`, existingMax);
      if (!seq.ok) return { reserved: false, reason: seq.reason, lock: seq.lock };
      const nn = String(seq.number).padStart(2, '0');
      const id = `${kind}-${dateCompact}-${nn}`;
      const fileRel = `changes/${lower}-${dateCompact}-${nn}.md`;
      const written = writeArtifactReservation(cwd, owner, { operation, kind, id, fileRel });
      return { reserved: true, operation, kind, id, fileRel, path: written.path };
    }

    if (operation === 'record-correction') {
      const date = ctx.todayISO();
      const existingMax = scanMaxNumberInDir(path.join(artDir, 'changes', 'corrections'), new RegExp(`^correction-${date}-(\\d{2})-.+\\.md$`, 'i'));
      const seq = nextSequenceNumber(cwd, `correction-${date}`, existingMax);
      if (!seq.ok) return { reserved: false, reason: seq.reason, lock: seq.lock };
      const nn = String(seq.number).padStart(2, '0');
      const id = `CORRECTION-${date}-${nn}`;
      const filePrefix = `changes/corrections/correction-${date}-${nn}-`;
      const written = writeArtifactReservation(cwd, owner, { operation, id, filePrefix });
      return { reserved: true, operation, id, filePrefix, path: written.path };
    }

    return { reserved: false, reason: 'operation-no-reservation', operation };
  }

  function reservationMatchesArtifactRel(reservation, artifactRel) {
    if (!reservation || !artifactRel) return { ok: true };
    const rel = String(artifactRel || '').replace(/\\/g, '/');
    if (reservation.fileRel && /^changes\/(?:chg|hotfix)-\d{8}-\d{2}\.md$/i.test(rel)) {
      return rel === reservation.fileRel
        ? { ok: true }
        : { ok: false, expected: reservation.fileRel, actual: rel };
    }
    if (reservation.filePrefix && /^changes\/corrections\/correction-\d{4}-\d{2}-\d{2}-\d{2}-.+\.md$/i.test(rel)) {
      return rel.startsWith(reservation.filePrefix) && rel.endsWith('.md')
        ? { ok: true }
        : { ok: false, expected: `${reservation.filePrefix}<slug>.md`, actual: rel };
    }
    return { ok: true };
  }

  function isArtifactRuntimeControlPath(cwd, targetPath) {
    const fp = ctx.normalizePath(path.resolve(String(targetPath || '')));
    const runtime = ctx.normalizePath(ctx.getProjectRuntimeDir(cwd));
    const runtimeSlash = runtime.endsWith('/') ? runtime : `${runtime}/`;
    const rel = fp.startsWith(runtimeSlash) ? fp.slice(runtimeSlash.length) : '';
    if (!rel) return false;
    return rel === ARTIFACT_WRITER_LOCK_FILE ||
      /^locks\//.test(rel) ||
      /^sequences\//.test(rel) ||
      /^reservations\//.test(rel) ||
      /^index-transactions\//.test(rel) ||
      /^change-owners\//.test(rel);
  }

  return {
    getArtifactWriterLockPath,
    readArtifactWriterLock,
    acquireArtifactWriterLock,
    artifactWriterLockMatches,
    releaseArtifactWriterLock,
    formatArtifactWriterLock,
    operationFromAgentPrompt,
    changeIdFromAgentPrompt,
    explicitChangeTargetFromAgentPrompt,
    artifactResourceForRel,
    getArtifactResourceLockPath,
    readArtifactResourceLock,
    acquireArtifactResourceLock,
    releaseArtifactResourceLock,
    releaseArtifactResourcesForOwner,
    markIndexChangesTouchedAndMaybeRelease,
    readArtifactIndexTransaction,
    formatArtifactResourceLock,
    reserveArtifactId,
    readArtifactReservation,
    findArtifactReservationForRel,
    clearArtifactReservation,
    clearArtifactReservationForRel,
    reservationMatchesArtifactRel,
    isArtifactRuntimeControlPath,
    getChangeOwnerPath,
    readChangeOwner,
    writeChangeOwner,
    markChangeOwnerClosed,
    touchChangeOwnersForSession,
    changeOwnerStatus,
    ownerTakeoverConfirmed,
    acquireJsonLock,
  };
};
