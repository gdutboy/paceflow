// pace-utils.js — PACE hooks 公共工具函数
// v6 项目识别 + 懒创建模板 + changes/ 详情解析 + .pace/disabled 豁免
const fs = require('fs');
const path = require('path');

const PACE_VERSION = 'v6.0.50';
const CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte'];
const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md', 'corrections.md'];
const MIGRATABLE_ARTIFACT_FILES = ARTIFACT_FILES.filter(file => file !== 'spec.md' && file !== 'corrections.md');
const VAULT_PATH = process.env.PACE_VAULT_PATH || '';
const ARTIFACT_ROOT_CHOICE_FILE = 'artifact-root';
const V5_MIGRATION_STATE_FILE = 'v5-migration-state';
const ARTIFACT_WRITER_LOCK_FILE = 'artifact-writer.lock';
const ARTIFACT_WRITER_LOCK_TTL_MS = Number(process.env.PACE_ARTIFACT_LOCK_TTL_MS || 30 * 60 * 1000);
const ARTIFACT_RESOURCE_LOCK_TTL_MS = Math.max(1000, Number(process.env.PACE_ARTIFACT_RESOURCE_LOCK_TTL_MS || 5 * 60 * 1000) || 5 * 60 * 1000);
const ARTIFACT_RESOURCE_LOCK_WAIT_MS = Math.max(0, Number(process.env.PACE_ARTIFACT_RESOURCE_LOCK_WAIT_MS || 2500) || 2500);
const ARTIFACT_SEQUENCE_LOCK_TTL_MS = Math.max(1000, Number(process.env.PACE_ARTIFACT_SEQUENCE_LOCK_TTL_MS || 30 * 1000) || 30 * 1000);
const ARTIFACT_SEQUENCE_LOCK_WAIT_MS = Math.max(0, Number(process.env.PACE_ARTIFACT_SEQUENCE_LOCK_WAIT_MS || 2500) || 2500);
const ARTIFACT_ROOT_CHOICE_MAX_CHARS = 4096;

// 归档标记常量——所有 hook 必须引用此常量，禁止硬编码字符串
const ARCHIVE_MARKER = '<!-- ARCHIVE -->';
const ARCHIVE_PATTERN = /^<!-- ARCHIVE -->\r?$/m;

function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
}

function hasNonNullVerifiedDate(text) {
  const match = normalizeLineEndings(text).match(/^verified-date:[ \t]*(.*)$/m);
  if (!match) return false;
  const value = match[1].trim().replace(/^["']|["']$/g, '');
  return value !== '' && value.toLowerCase() !== 'null';
}

// 交叉验证：AI 声称完成时匹配的中文短语
const COMPLETION_PHRASES = /(?:任务完成|已完成所有|全部完成|归档完毕)/;

// Claude 任务列表与详情任务数量差异阈值（超过此值触发提醒）
const TODO_DRIFT_THRESHOLD = 3;

// v5.0.0: skill 目录名列表（install.js + verify.js 共用）
const SKILL_DIRS = [
  'pace-workflow',
  'artifact-management',
  'pace-knowledge',
  'pace-bridge',
];

// v6 格式示例常量——供 DENY/Stop/HINT 消息内联引用，确定性最高+零 I/O
const FORMAT_SNIPPETS = {
  taskEntry: '- [ ] [[chg-YYYYMMDD-NN]] 变更标题 #change [tasks:: T-001~T-003]',
  taskGroup: '任务详情不写入 task.md。请派 artifact-writer create-chg 创建 changes/chg-YYYYMMDD-NN.md，并同步 task.md / implementation_plan.md 索引。',
  implIndex: '- [/] [[chg-YYYYMMDD-NN]] 变更标题 #change [tasks:: T-001~T-003]',
  implDetail: 'v6 详情文件在 changes/chg-YYYYMMDD-NN.md；implementation_plan.md 只保留 wikilink 索引。',
  approved: '<!-- APPROVED --> 位于 changes/<id>.md 的任务清单之后；approve/approve-and-start 都必须带 approval-confirmed、approval-source、approval-evidence',
  verified: '<!-- VERIFIED --> 紧邻 changes/<id>.md 内 <!-- APPROVED --> 下一行；主路径是验证结果已读取后 close-chg，暂不归档时才用 update-chg action=verify',
  // checkbox 状态说明
  statusHelp: '[ ] 未开始 | [/] 进行中 | [x] 完成 | [!] 阻塞 | [-] 跳过',
  // 变更状态说明（impl_plan 专用，与 statusHelp 是独立术语）
  changeStatusHelp: '[ ] 规划中 | [/] 进行中 | [x] 完成 | [-] 废弃 | [!] 暂停',
  // 格式要求（E 阶段 DENY 核心信息）
  formatRule: 'hook 检测格式为行首 "- [/] "（Markdown checkbox），表格或 emoji 格式无法识别',
  // 归档操作（T-441: 移动标记而非内容）
  approveAndStartOp: '批准并开始 = 派 artifact-writer update-chg action=approve-and-start：需 approval-confirmed: true、approval-source、approval-evidence 与 task-id',
  closeOp: '收尾 = 先运行并读取验证结果；通过后派 artifact-writer close-chg：需 verification-confirmed: true、complete-open-tasks: true、verify-summary、walkthrough-summary',
  reserveHelper: '预留编号 = 主 session 先运行 Bash: node "${CLAUDE_PLUGIN_ROOT}/hooks/reserve-artifact-id.js" --operation create-chg，并把输出原样放到 artifact-writer prompt 顶部',
  archiveOp: '归档 = 派 artifact-writer archive-chg：详情 status→archived，task.md / implementation_plan.md 的索引行移动到 ARCHIVE 下方',
  findingsFormat: '- [状态] [[finding-id|标题]] — 摘要 [date:: YYYY-MM-DD] [impact:: P0-P3]',
  findingsDetail: 'finding 详情写入 changes/findings/<id>.md；findings.md 只保留摘要索引。',
  walkthroughDetail: '| YYYY-MM-DD | [[chg-YYYYMMDD-NN]] 完成摘要 | CHG-YYYYMMDD-NN |',
  // Skill 引用
  skillRef: '流程参考：先调用 Skill(paceflow:pace-workflow)；artifact/CHG 字段格式参考 Skill(paceflow:artifact-management)',
};

// 会话级 flag 文件集中管理（session-start 重置用）
const SESSION_SCOPED_FLAGS = [
  'degraded',                    // stop.js 降级标记（3 次 block 后静默放行）
  'task-list-used',              // task-list-sync.js 标记（本会话已使用 Claude 任务列表工具）
  'todowrite-used',              // legacy 运行态 flag，保留清理以避免旧版本残留
  'archive-reminded',            // post-tool-use.js H3 legacy flag（task.md 归档提醒，每会话一次）
  'findings-reminded',           // post-tool-use.js H7（findings ⚠️ 提醒，每会话一次）
  'impl-archive-reminded',       // post-tool-use.js H10（impl_plan 归档提醒，每会话一次）
  'cli-refresh-done',            // post-tool-use.js H12（Obsidian CLI 索引刷新标记）
  'walkthrough-archive-reminded', // post-tool-use.js（walkthrough 详情>3 归档提醒）
  'findings-archive-reminded',   // post-tool-use.js（findings 已解决详情归档提醒）
];

const SESSION_SCOPED_FLAG_PREFIXES = [
  'archive-reminded-',           // post-tool-use.js：按 CHG slug 去重归档提醒
  'status-mismatch-',            // post-tool-use.js：按 CHG slug 去重索引/status 不一致提醒
  'verify-missing-',             // post-tool-use.js：按 CHG slug 去重 completed 未 verified 提醒
  'blocked-tasks-',              // post-tool-use.js：按 CHG slug 去重 blocked task 提醒
];

/** 检测当前进程是否为 Agent Teams teammate（环境变量 CLAUDE_CODE_TEAM_NAME 存在即为 teammate） */
function isTeammate() {
  return !!process.env.CLAUDE_CODE_TEAM_NAME;
}

function isArtifactWriterAgentType(agentType) {
  const type = String(agentType || '').toLowerCase();
  return type === 'artifact-writer' || type === 'paceflow:artifact-writer' || type.endsWith(':artifact-writer');
}

let _lastHookSessionId = '';

function normalizeSessionId(sessionId) {
  return String(sessionId || '').trim();
}

function currentSessionId() {
  return normalizeSessionId(process.env.CLAUDE_CODE_SESSION_ID || _lastHookSessionId);
}

/**
 * 获取项目根目录，优先使用 CLAUDE_PROJECT_DIR 环境变量（Claude Code hook 进程自动设置）
 * fallback 到 process.cwd()（非 hook 环境或环境变量缺失时）
 * @returns {string} 项目根目录
 */
function resolveProjectCwd() {
  return process.env.CLAUDE_PROJECT_DIR
    ? path.resolve(process.env.CLAUDE_PROJECT_DIR)
    : process.cwd();
}

/** 生成中国时区时间戳字符串 */
function ts() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

/** 返回今日 ISO 日期（YYYY-MM-DD），sv-SE locale 技巧避免手动拼接 */
function todayISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function isoDateDayNumber(value) {
  const m = String(value || '').trim().replace(/^["']|["']$/g, '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

function daysSinceISODate(value, todayValue = todayISO()) {
  const start = isoDateDayNumber(value);
  const end = isoDateDayNumber(todayValue);
  if (start === null || end === null) return null;
  return end - start;
}

// H-1: 跨平台路径规范化（Windows 大小写不敏感，Linux 大小写敏感）
const isWin = process.platform === 'win32';
/** 路径规范化：统一分隔符为 /，Windows 额外 toLowerCase */
function normalizePath(p) {
  const n = p.replace(/\\/g, '/');
  return isWin ? n.toLowerCase() : n;
}

function displayDir(dir) {
  return String(dir || '').replace(/\\/g, '/').replace(/\/?$/, '/');
}

function isPortableAbsolutePath(p) {
  const normalized = String(p || '').replace(/\\/g, '/');
  return path.isAbsolute(normalized) || /^[A-Za-z]:\//.test(normalized);
}

/** 将 Claude tool_input.file_path 解析成当前项目下的绝对路径；绝对路径保持原样 */
function resolveToolFilePath(cwd, filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (!normalized) return '';
  if (isPortableAbsolutePath(normalized)) return normalized;
  return path.resolve(cwd || process.cwd(), normalized).replace(/\\/g, '/');
}

function isArtifactRelativePath(relPath) {
  const rel = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (ARTIFACT_FILES.includes(rel)) return true;
  return /^changes\/.+\.md$/i.test(rel);
}

/**
 * 如果 filePath 指向 baseDir 内的 v6 artifact，返回 artifact 相对路径；否则返回 null。
 * 覆盖根索引文件和 changes/ 下的 markdown 详情文件。
 */
function artifactRelativePathForFile(baseDir, filePath) {
  if (!baseDir || !filePath) return null;
  const absFile = resolveToolFilePath(baseDir, filePath);
  const normalizedBase = normalizePath(path.resolve(baseDir));
  const normalizedFile = normalizePath(absFile);
  const baseWithSlash = normalizedBase.endsWith('/') ? normalizedBase : normalizedBase + '/';
  if (!normalizedFile.startsWith(baseWithSlash)) return null;
  const rel = normalizedFile.slice(baseWithSlash.length);
  return isArtifactRelativePath(rel) ? rel : null;
}

function sanitizeProjectName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function worktreeBaseDir(cwd) {
  const resolved = path.resolve(cwd || '');
  const parts = resolved.split(path.sep);
  for (let i = parts.length - 3; i >= 0; i--) {
    if (parts[i] !== '.claude' || parts[i + 1] !== 'worktrees') continue;
    const baseParts = parts.slice(0, i);
    if (baseParts.length === 0) return null;
    return baseParts.join(path.sep) || path.sep;
  }
  return null;
}

function addProjectCandidate(candidates, name) {
  const normalized = sanitizeProjectName(name);
  if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function gitWorktreeMainCheckoutDir(gitDir) {
  const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
  const idx = String(gitDir || '').indexOf(marker);
  if (idx < 0) return null;
  const mainGitDir = String(gitDir).slice(0, idx + `${path.sep}.git`.length);
  return path.dirname(mainGitDir);
}

function getProjectNameCandidates(cwd) {
  const candidates = [];
  const safeCwd = cwd || '';
  addProjectCandidate(candidates, process.env.PACE_PROJECT_NAME);
  addProjectCandidate(candidates, process.env.PACEFLOW_PROJECT_NAME);

  const wtBase = worktreeBaseDir(safeCwd);
  if (wtBase) addProjectCandidate(candidates, path.basename(wtBase));

  // Git worktree outside a conventional worktrees/ directory still exposes the
  // main checkout through .git -> gitdir: <main>/.git/worktrees/<name>.
  try {
    const gitFile = path.join(safeCwd, '.git');
    if (fs.existsSync(gitFile) && fs.statSync(gitFile).isFile()) {
      const content = fs.readFileSync(gitFile, 'utf8');
      const match = content.match(/^gitdir:\s*(.+?)\s*$/m);
      if (match) {
        const gitDir = path.resolve(safeCwd, match[1].trim());
        const hostDir = gitWorktreeMainCheckoutDir(gitDir);
        if (hostDir) addProjectCandidate(candidates, path.basename(hostDir));
      }
    }
  } catch(e) {}

  addProjectCandidate(candidates, path.basename(safeCwd));
  return candidates.length > 0 ? candidates : ['unknown-project'];
}

/** 从 cwd 提取项目名（小写+连字符格式）；worktree 路径归一到宿主项目名 */
function getProjectName(cwd) {
  // I-1: 空值/极端路径防御
  if (!cwd || cwd === '.' || cwd === '/' || cwd === '\\') return 'unknown-project';
  // W-code-3: Windows 盘符根路径守卫（path.basename('C:\\') 返回空字符串）
  if (/^[A-Z]:\\\\?$/i.test(cwd)) return 'unknown-project';
  return getProjectNameCandidates(cwd)[0] || 'unknown-project';
}

function gitWorktreeHostDir(cwd) {
  const safeCwd = cwd || '';
  try {
    const gitFile = path.join(safeCwd, '.git');
    if (!fs.existsSync(gitFile) || !fs.statSync(gitFile).isFile()) return null;
    const content = fs.readFileSync(gitFile, 'utf8');
    const match = content.match(/^gitdir:\s*(.+?)\s*$/m);
    if (!match) return null;
    const gitDir = path.resolve(safeCwd, match[1].trim());
    return gitWorktreeMainCheckoutDir(gitDir);
  } catch(e) {
    return null;
  }
}

/** 项目级运行态目录归属；worktree 读取宿主项目 .pace。 */
function getProjectStateDir(cwd) {
  return worktreeBaseDir(cwd) || gitWorktreeHostDir(cwd) || cwd;
}

function getProjectRuntimeDir(cwd) {
  return path.join(getProjectStateDir(cwd), '.pace');
}

function getArtifactRootChoicePath(cwd) {
  return path.join(getProjectRuntimeDir(cwd), ARTIFACT_ROOT_CHOICE_FILE);
}

function getV5MigrationStatePath(cwd) {
  return path.join(getProjectRuntimeDir(cwd), V5_MIGRATION_STATE_FILE);
}

function getArtifactWriterLockPath(cwd) {
  return path.join(getProjectRuntimeDir(cwd), ARTIFACT_WRITER_LOCK_FILE);
}

function readArtifactWriterLock(cwd) {
  const lockPath = getArtifactWriterLockPath(cwd);
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      path: lockPath,
      sessionId: normalizeSessionId(parsed.sessionId || parsed.session_id),
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
  return `session=${lock.sessionId || '-'} agent=${lock.agentId || '-'} artifact_dir=${displayDir(lock.artifactDir)} age=${ageSec}s lock=${lock.path}`;
}

function operationFromAgentPrompt(prompt) {
  const text = String(prompt || '');
  const byField = text.match(/^\s*(?:operation|指令)\s*[:=]\s*([a-z0-9-]+)/mi);
  if (byField) return byField[1].toLowerCase();
  const known = text.match(/\b(create-chg|update-chg|archive-chg|close-chg|record-finding|record-correction)\b/i);
  return known ? known[1].toLowerCase() : '';
}

function acquireArtifactWriterLock(cwd, info = {}) {
  const lockPath = getArtifactWriterLockPath(cwd);
  const runtimeDir = path.dirname(lockPath);
  const sessionId = normalizeSessionId(info.sessionId || currentSessionId());
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
  const sid = normalizeSessionId(sessionId || currentSessionId());
  if (!sid || !lock.sessionId || lock.sessionId !== sid) {
    return { ok: false, lock, reason: 'owner-mismatch' };
  }
  return { ok: true, lock, reason: '' };
}

function releaseArtifactWriterLock(cwd, info = {}) {
  const lock = readArtifactWriterLock(cwd);
  if (!lock.ok) return { released: false, lock, reason: 'missing' };
  const sessionId = normalizeSessionId(info.sessionId || currentSessionId());
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
  const sessionId = normalizeSessionId(info.sessionId || currentSessionId());
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
      sessionId: normalizeSessionId(parsed.sessionId || parsed.session_id),
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
  return path.join(getProjectRuntimeDir(cwd), 'locks', 'artifacts');
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
  return path.join(getProjectRuntimeDir(cwd), dirName, `${safeLockName(owner.ownerKey)}.json`);
}

function getArtifactReservationPath(cwd, info = {}) {
  return ownerScopedPath(cwd, 'reservations', info);
}

function getArtifactReservationDir(cwd) {
  return path.join(getProjectRuntimeDir(cwd), 'reservations');
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
    path.join(getProjectRuntimeDir(cwd), 'locks', 'sequences'),
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
  const runtime = getProjectRuntimeDir(cwd);
  const lockPath = path.join(runtime, 'locks', 'sequences', `${safeLockName(sequenceName)}.lock`);
  const counterPath = path.join(runtime, 'sequences', `${safeLockName(sequenceName)}.counter`);
  const owner = lockOwnerInfo({ sessionId: currentSessionId() });
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
    // 并发下编号允许跳号：counter 一旦分配不回滚，优先保证 artifact ID 不复用。
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
  const artDir = info.artifactDir || getArtifactDir(cwd);
  const owner = lockOwnerInfo(info);
  if (!owner.ownerKey) return { reserved: false, reason: 'missing-owner' };

  if (operation === 'create-chg') {
    const kind = inferChangeKindFromPrompt(info.prompt);
    const dateCompact = todayISO().replace(/-/g, '');
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
    const date = todayISO();
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
  const fp = normalizePath(path.resolve(String(targetPath || '')));
  const runtime = normalizePath(getProjectRuntimeDir(cwd));
  const runtimeSlash = runtime.endsWith('/') ? runtime : `${runtime}/`;
  const rel = fp.startsWith(runtimeSlash) ? fp.slice(runtimeSlash.length) : '';
  if (!rel) return false;
  return rel === ARTIFACT_WRITER_LOCK_FILE ||
    /^locks\//.test(rel) ||
    /^sequences\//.test(rel) ||
    /^reservations\//.test(rel) ||
    /^index-transactions\//.test(rel);
}

function normalizeArtifactRootChoice(choice) {
  let raw = String(choice || '').slice(0, ARTIFACT_ROOT_CHOICE_MAX_CHARS).trim();
  if (!raw) return '';
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
    raw = raw.slice(1, -1).trim();
  }
  return raw;
}

function readArtifactRootChoice(cwd) {
  const envChoice = process.env.PACE_ARTIFACT_ROOT || process.env.PACEFLOW_ARTIFACT_ROOT || '';
  if (String(envChoice).trim()) return normalizeArtifactRootChoice(envChoice);
  try { return normalizeArtifactRootChoice(fs.readFileSync(getArtifactRootChoicePath(cwd), 'utf8')); } catch(e) { return ''; }
}

function readV5MigrationState(cwd) {
  try { return String(fs.readFileSync(getV5MigrationStatePath(cwd), 'utf8')).trim().toLowerCase(); } catch(e) { return ''; }
}

function artifactDirFromChoice(cwd, choice) {
  const raw = normalizeArtifactRootChoice(choice);
  if (!raw) return null;
  const keyword = raw.toLowerCase();
  const stateDir = getProjectStateDir(cwd);
  if (keyword === 'local') return stateDir;
  if (keyword === 'vault') {
    if (!VAULT_PATH) return null;
    return path.join(VAULT_PATH, 'projects', getProjectNameCandidates(cwd)[0]);
  }
  if (isPortableAbsolutePath(raw)) return path.resolve(raw);
  return path.resolve(stateDir, raw);
}

function getConfiguredArtifactDir(cwd) {
  return artifactDirFromChoice(cwd, readArtifactRootChoice(cwd));
}

function artifactRootConfigError(cwd) {
  const choice = readArtifactRootChoice(cwd).toLowerCase();
  if (choice === 'vault' && !VAULT_PATH) {
    const choicePath = getArtifactRootChoicePath(cwd);
    return {
      code: 'vault-env-missing',
      choice,
      choicePath,
      message: [
        'PACEflow artifact-root 配置为 vault，但当前 hook 进程没有 PACE_VAULT_PATH，无法解析 Obsidian vault artifact 根目录。',
        `配置文件: ${choicePath}`,
        '为避免把 artifact 静默写到本地项目目录，本次操作已停止。',
        '请恢复 PACE_VAULT_PATH 后重试；或如果确实要改用本地 artifact，请将配置文件内容改为纯文本 local。'
      ].join('\n')
    };
  }
  return null;
}

function hasChangesDir(dir) {
  try { return !!dir && fs.existsSync(path.join(dir, 'changes')); } catch(e) { return false; }
}

function legacyV5FilesInDir(dir) {
  if (!dir || hasChangesDir(dir)) return [];
  const signatures = {
    'task.md': /<!-- ARCHIVE -->|#\s*项目任务追踪|##\s*活跃任务|###\s*(?:CHG|HOTFIX)-/i,
    'implementation_plan.md': /<!-- ARCHIVE -->|#\s*实施计划|##\s*变更索引|##\s*活跃变更详情|###\s*(?:CHG|HOTFIX)-/i,
    'walkthrough.md': /<!-- ARCHIVE -->|#\s*工作记录|##\s*最近工作/i,
    'findings.md': /<!-- ARCHIVE -->|#\s*调研记录|##\s*未解决问题|##\s*Corrections\s*记录/i,
  };
  return Object.entries(signatures).filter(([file, re]) => {
    try {
      const fp = path.join(dir, file);
      if (!fs.existsSync(fp)) return false;
      const head = fs.readFileSync(fp, 'utf8').slice(0, 20000);
      return re.test(head);
    } catch(e) {
      return false;
    }
  }).map(([file]) => file);
}

function hasLegacyV5ArtifactsDir(dir) {
  return legacyV5FilesInDir(dir).length > 0;
}

function getLegacyV5ArtifactDir(cwd) {
  const configuredDir = getConfiguredArtifactDir(cwd);
  if (configuredDir) return hasLegacyV5ArtifactsDir(configuredDir) ? configuredDir : null;

  if (VAULT_PATH) {
    for (const projectName of getProjectNameCandidates(cwd)) {
      const vaultDir = path.join(VAULT_PATH, 'projects', projectName);
      if (hasLegacyV5ArtifactsDir(vaultDir)) return vaultDir;
    }
  }

  const stateDir = getProjectStateDir(cwd);
  if (hasLegacyV5ArtifactsDir(stateDir)) return stateDir;
  if (stateDir !== cwd && hasLegacyV5ArtifactsDir(cwd)) return cwd;
  return null;
}

function getV5MigrationInfo(cwd) {
  const dir = getLegacyV5ArtifactDir(cwd);
  const state = readV5MigrationState(cwd);
  const files = dir ? legacyV5FilesInDir(dir) : [];
  const suppressed = ['ignored', 'declined', 'migrated'].includes(state);
  return {
    detected: !!dir,
    needsPrompt: !!dir && !suppressed,
    dir: dir || '',
    files,
    state,
    statePath: getV5MigrationStatePath(cwd),
    scriptPath: path.resolve(__dirname, '..', 'migrate', 'batch-archive-v5.js'),
  };
}

function v5MigrationPromptMessage(cwd) {
  const info = getV5MigrationInfo(cwd);
  if (!info.detected) return '';
  const script = info.scriptPath.replace(/\\/g, '/');
  const artifactDir = info.dir.replace(/\\/g, '/');
  return [
    '检测到旧 v5 PACE artifact，但当前 artifact 根目录没有 changes/ v6 详情目录。',
    `PaceFlow artifact 根目录（legacy v5）: ${displayDir(info.dir)}`,
    `检测到文件: ${info.files.join(', ')}`,
    '注意：触发本提示的当前工具调用已被 hook 阻止；目标代码/artifact 尚未被修改。不要声称本次写入已经完成。',
    'PACEflow v6 不会自动改写旧 vault/本地 artifact。请先用 AskUserQuestion 询问用户如何处理：',
    '1. 迁移旧 v5 artifact 到 v6（推荐）：先运行 dry-run，展示摘要后再次确认，再运行正式迁移。',
    '2. 暂不迁移，改用其它 artifact root：写入 .pace/artifact-root 为 local / vault / 绝对路径，并写入 .pace/v5-migration-state 为 ignored。',
    '3. 取消本次操作，保持旧内容不变。',
    '迁移命令（必须先 dry-run）：',
    `node "${script}" "${artifactDir}" --dry-run`,
    'dry-run 完成后，必须再次使用 AskUserQuestion 展示摘要并取得用户确认；不得把第一次选择当作正式迁移授权。',
    '用户确认 dry-run 摘要后再运行：',
    `node "${script}" "${artifactDir}"`,
    `如果用户明确决定忽略这份旧 v5 artifact，请写入 ${getV5MigrationStatePath(cwd)}，内容为纯文本 ignored；要重新提示则删除该文件。`,
    '禁止在用户确认前创建 changes/、懒创建 v6 模板或派 artifact-writer create-chg。',
    '迁移或忽略只处理 artifact 根目录状态，不完成原始代码任务；处理完成后必须按 P-A-C 创建/批准 v6 CHG，再重试被阻止的原始工具调用。'
  ].join('\n');
}

function artifactRootChoiceNeeded(cwd) {
  if (!VAULT_PATH) return false;
  if (getConfiguredArtifactDir(cwd)) return false;
  if (getLegacyV5ArtifactDir(cwd)) return false;
  if (hasChangesDir(getProjectStateDir(cwd))) return false;
  for (const projectName of getProjectNameCandidates(cwd)) {
    if (hasChangesDir(path.join(VAULT_PATH, 'projects', projectName))) return false;
  }
  return true;
}

function artifactRootChoiceMessage(cwd) {
  const projectName = getProjectName(cwd);
  const stateDir = getProjectStateDir(cwd);
  const vaultDir = VAULT_PATH ? path.join(VAULT_PATH, 'projects', projectName) : '';
  const choicePath = getArtifactRootChoicePath(cwd);
  return [
    'PACEflow 首次启用需要选择 artifact 存放位置。',
    FORMAT_SNIPPETS.skillRef,
    `Obsidian vault artifact 根目录: ${displayDir(vaultDir)}`,
    `本地项目 artifact 根目录: ${displayDir(stateDir)}`,
    '请用 AskUserQuestion 询问用户选择 "Obsidian vault project" 或 "本地项目目录"。',
    `用户选择后，只把选择结果写入配置文件 ${choicePath}：选择 vault 时写入纯文本 vault；选择本地时写入纯文本 local；不要包含引号。`,
    `注意：${displayDir(path.join(stateDir, '.pace'))} 只是 PaceFlow 配置/运行态目录，不是 artifact 根目录；不要把 task.md / implementation_plan.md / changes/** 写进 .pace/。`,
    `若选择本地项目目录，后续 artifact_dir 必须是 ${displayDir(stateDir)}；若选择 Obsidian vault，后续 artifact_dir 必须是 ${displayDir(vaultDir)}。`,
    '若本次被拦截的是代码 Write/Edit/MultiEdit：写入配置文件后不要直接重试代码写入；先派 artifact-writer create-chg，并在用户明确批准/要求执行后派 approve-and-start，再重试代码写入。',
    '若本次被拦截的是 artifact-writer Agent：写入配置文件后按 hook 提示重派同一个 Agent。hook 会在所选 artifact 根目录懒创建 task.md / implementation_plan.md / changes/**。'
  ].join('\n');
}

function artifactDirRuntimeHint(cwd) {
  const artDir = getArtifactDir(cwd);
  const stateDir = getProjectStateDir(cwd);
  const choice = readArtifactRootChoice(cwd) || 'auto';
  const choicePath = getArtifactRootChoicePath(cwd);
  return `Artifact 根目录：${displayDir(artDir)}（选择=${choice}；配置文件=${choicePath}；.pace/ 只保存配置/运行状态，不存 task.md / changes/**）`;
}

function appendArtifactDirHint(cwd, message) {
  const text = String(message || '');
  if (!text) return artifactDirRuntimeHint(cwd);
  if (text.includes('Artifact 根目录') || text.includes('artifact 根目录')) return text;
  return `${text}\n${artifactDirRuntimeHint(cwd)}`;
}

// T-281: 模块级缓存，避免同一 hook 进程内重复 existsSync（同 cwd 最多 11 次→1 次）
let _artifactDirCache = { cwd: null, dir: null };

/**
 * 获取 artifact 文件的实际存储目录
 * 优先级：显式 artifact-root → vault 有 v6 → CWD 有 v6 → legacy v5 → 新项目默认 vault/CWD
 * @param {string} cwd - 当前工作目录
 * @returns {string} artifact 目录路径
 */
function getArtifactDir(cwd) {
  if (_artifactDirCache.cwd === cwd) return _artifactDirCache.dir;
  let result = cwd;
  const configuredDir = getConfiguredArtifactDir(cwd);
  if (configuredDir) {
    _artifactDirCache = { cwd, dir: configuredDir };
    return configuredDir;
  }
  const projectCandidates = getProjectNameCandidates(cwd);
  // T-422: VAULT_PATH 空值守卫 — 无 vault 时跳过 vault 分支，直接走 CWD 路径
  if (VAULT_PATH) {
    for (const projectName of projectCandidates) {
      const vaultDir = path.join(VAULT_PATH, 'projects', projectName);
      try {
        // v6 项目信号：vault 项目目录存在 changes/
        if (fs.existsSync(path.join(vaultDir, 'changes'))) {
          result = vaultDir;
          _artifactDirCache = { cwd, dir: result };
          return result;
        }
      } catch(e) {}
    }
  }
  // CWD 有 changes/ → CWD
  if (fs.existsSync(path.join(cwd, 'changes'))) {
    _artifactDirCache = { cwd, dir: cwd };
    return cwd;
  }
  const legacyDir = getLegacyV5ArtifactDir(cwd);
  if (legacyDir) {
    _artifactDirCache = { cwd, dir: legacyDir };
    return legacyDir;
  }
  // 新项目 → vault（有 VAULT_PATH 时）或 CWD（无 VAULT_PATH）
  result = VAULT_PATH ? path.join(VAULT_PATH, 'projects', projectCandidates[0]) : cwd;
  _artifactDirCache = { cwd, dir: result };
  return result;
}

// W-6: 模块级缓存，避免 isPaceProject + 外部调用重复扫描目录
let _codeCountCache = { cwd: null, count: 0 };

/** 统计 cwd 根目录下的代码文件数量（同 cwd 自动缓存） */
function countCodeFiles(cwd) {
  if (_codeCountCache.cwd === cwd) return _codeCountCache.count;
  try {
    const count = fs.readdirSync(cwd).filter(f => CODE_EXTS.some(ext => f.endsWith(ext))).length;
    _codeCountCache = { cwd, count };
    return count;
  } catch(e) { return 0; }
}

// Superpowers 计划文件扫描目录（v4.x: docs/plans/, v5.0.0+: docs/superpowers/plans/）
const PLAN_DIRS = ['docs/plans', 'docs/superpowers/plans'];

// 模块级缓存，避免同一 hook 进程内重复 readdirSync（pre-tool-use 热路径最多 3 次调用）
let _planFilesCache = { cwd: null, result: [] };

/**
 * 列出所有 Superpowers 计划文件（按日期降序），扫描 PLAN_DIRS 双路径
 * @param {string} cwd - 项目根目录
 * @returns {{name: string, dir: string}[]} 文件信息列表（name=文件名, dir=所在相对目录路径，同名文件旧路径优先）
 */
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

/** W-dry-3: 检测是否有 plan 文件（复用 listPlanFiles 消除双重 readdirSync） */
function hasPlanFiles(cwd) {
  return listPlanFiles(cwd).length > 0;
}

/**
 * 检测是否有未同步到 task.md 的 plan 文件
 * 通过 .pace/synced-plans 状态文件追踪已桥接的 plan 文件名
 * @returns {boolean}
 */
function hasUnsyncedPlanFiles(cwd) {
  return listUnsyncedPlanFiles(cwd).length > 0;
}

/**
 * 列出未同步到 task.md 的 plan 文件（按日期降序）
 * @returns {{name: string, dir: string}[]} 未同步的文件信息列表
 */
function listUnsyncedPlanFiles(cwd) {
  const plans = listPlanFiles(cwd);
  if (plans.length === 0) return [];
  const syncedPath = path.join(getProjectRuntimeDir(cwd), 'synced-plans');
  let synced = [];
  try { synced = fs.readFileSync(syncedPath, 'utf8').split('\n').filter(Boolean); } catch(e) {}
  // Superpowers 固定产出主文件 + -design.md 伴随文件，主文件已同步时伴随文件也视为已同步
  const syncedSet = new Set(synced);
  for (const f of synced) {
    syncedSet.add(f.replace(/\.md$/, '-design.md'));
  }
  return plans.filter(p => !syncedSet.has(p.name));
}

/**
 * 多信号 PACE 激活判断
 * @param {string} cwd - 当前工作目录
 * @returns {'artifact'|'superpowers'|'manual'|'code-count'|false}
 */
function isPaceProject(cwd) {
  try {
    // T-080: 豁免信号（最高优先级）— 用户主动禁用 PACE（.pace/disabled）
    const disabledPaths = [
      path.join(cwd, '.pace', 'disabled'),
      path.join(getProjectRuntimeDir(cwd), 'disabled'),
    ];
    if (disabledPaths.some(fp => fs.existsSync(fp))) return false;
    const configuredDir = getConfiguredArtifactDir(cwd);
    if (configuredDir) {
      if (fs.existsSync(path.join(configuredDir, 'changes'))) return 'artifact';
    } else {
      // 信号 1（最强）：v6 项目必须有 changes/ 目录
      if (fs.existsSync(path.join(cwd, 'changes'))) return 'artifact';
      // T-422: VAULT_PATH 空值守卫 — 无 vault 时跳过 vault 信号检查
      if (VAULT_PATH) {
        for (const projectName of getProjectNameCandidates(cwd)) {
          const vaultDir = path.join(VAULT_PATH, 'projects', projectName);
          try {
            if (fs.existsSync(path.join(vaultDir, 'changes'))) return 'artifact';
          } catch(e) {}
        }
      }
    }
    if (getLegacyV5ArtifactDir(cwd)) return 'legacy';
    // 信号 2（强）：Superpowers plan 文件
    if (hasPlanFiles(cwd)) return 'superpowers';
    // 信号 3（强）：手动激活标记
    if (fs.existsSync(path.join(cwd, '.pace-enabled'))) return 'manual';
    // 信号 4（弱/兜底）：3+ 代码文件（原有逻辑）
    if (countCodeFiles(cwd) >= 3) return 'code-count';
  } catch(e) {}
  return false;
}

/** 读取文件活跃区（ARCHIVE_MARKER 上方内容），artifact 文件自动解析 vault 目录 */
function readActive(cwd, filename) {
  const dir = ARTIFACT_FILES.includes(filename) ? getArtifactDir(cwd) : cwd;
  const fp = path.join(dir, filename);
  // W-code-1: 直接 try readFileSync，消除 TOCTOU 竞态 + 减少 stat syscall
  try {
    const content = fs.readFileSync(fp, 'utf8');
    const m = content.match(ARCHIVE_PATTERN);
    return m ? content.slice(0, m.index) : content;
  } catch(e) { return null; }
}

/** 读取文件全文，artifact 文件自动解析 vault 目录 */
function readFull(cwd, filename) {
  const dir = ARTIFACT_FILES.includes(filename) ? getArtifactDir(cwd) : cwd;
  const fp = path.join(dir, filename);
  try { return fs.readFileSync(fp, 'utf8'); } catch(e) { return null; }
}

/** 检查 ARCHIVE 标记格式，返回错误消息或 null */
function checkArchiveFormat(cwd, filename) {
  const content = readFull(cwd, filename);
  if (!content) return null;
  const hasCorrect = ARCHIVE_PATTERN.test(content);
  // I-6: 匹配所有级别的错误标题格式（# ARCHIVE ~ ###### ARCHIVE）
  const hasWrong = /^#{1,6}\s+ARCHIVE/m.test(content);
  if (hasWrong && !hasCorrect) return `${filename} 使用了错误的 ARCHIVE 标记格式（应为 <!-- ARCHIVE -->）`;
  return null;
}

/**
 * 确保 PACE 项目基础设施就绪（幂等）
 * - .pace/.gitignore（运行时文件不入库）
 * - 仅在 vault 已被选择或已有 vault artifact 时确保 vault 项目目录存在
 * @param {string} cwd - 当前工作目录
 */
function ensureProjectInfra(cwd) {
  // .pace/.gitignore
  try {
    const paceDir = getProjectRuntimeDir(cwd);
    const gitignorePath = path.join(paceDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.mkdirSync(paceDir, { recursive: true });
      fs.writeFileSync(gitignorePath, '*\n', 'utf8');
    }
  } catch(e) {}
  // vault 项目目录：首次启用未选择 root 时不能在 Obsidian 创建空项目目录。
  if (VAULT_PATH) {
    try {
      const vaultDirs = getProjectNameCandidates(cwd).map(projectName => path.join(VAULT_PATH, 'projects', projectName));
      const configuredDir = getConfiguredArtifactDir(cwd);
      const configuredVaultDir = configuredDir
        ? vaultDirs.find(dir => normalizePath(dir) === normalizePath(configuredDir))
        : null;
      const existingVaultDir = vaultDirs.find(dir => fs.existsSync(path.join(dir, 'changes')));
      const target = configuredVaultDir || existingVaultDir;
      if (target) fs.mkdirSync(target, { recursive: true });
    } catch(e) {}
  }
}

/**
 * T-075: 从模板目录复制缺失的 artifact 文件到 artifact 目录（vault 或 cwd）
 * @param {string} cwd - 当前工作目录
 * @returns {string[]} 创建的文件名列表
 */
function createTemplates(cwd) {
  const configError = artifactRootConfigError(cwd);
  if (configError) throw new Error(configError.message);
  const TEMPLATES_DIR = path.join(__dirname, 'templates');
  const artDir = getArtifactDir(cwd);
  // 确保目标目录存在（vault 模式下可能尚未创建）
  try { fs.mkdirSync(artDir, { recursive: true }); } catch(e) {}
  for (const sub of ['changes', 'changes/findings', 'changes/corrections']) {
    try { fs.mkdirSync(path.join(artDir, sub), { recursive: true }); } catch(e) {}
  }
  const created = [];
  for (const file of ARTIFACT_FILES) {
    const target = path.join(artDir, file);
    const tmpl = path.join(TEMPLATES_DIR, file);
    if (!fs.existsSync(target) && fs.existsSync(tmpl)) {
      try {
        const content = normalizeLineEndings(fs.readFileSync(tmpl, 'utf8'));
        fs.writeFileSync(target, content, 'utf8');
        created.push(file);
      } catch(e) {}
    }
  }
  return created;
}

// I-opt-1: 预编译正则（避免每次调用重新编译）
const COUNT_RE_PENDING = /- \[[ \/!]\]/g;
const COUNT_RE_PENDING_TOP = /^- \[[ \/!]\]/gm;
const COUNT_RE_DONE = /- \[x\]|- \[-\]/g;
const COUNT_RE_DONE_TOP = /^- \[x\]|^- \[-\]/gm;

/**
 * W2+O5: 统一任务状态统计（集中管理正则，消除跨文件不一致）
 * @param {string} text - 待统计的文本（通常是 task.md 活跃区）
 * @param {object} opts - 选项
 * @param {boolean} opts.topLevelOnly - true 时仅匹配行首顶层任务（^锚定），false 含子任务
 * @returns {{pending: number, done: number, total: number}}
 */
function countByStatus(text, { topLevelOnly = false } = {}) {
  const pending = (text.match(topLevelOnly ? COUNT_RE_PENDING_TOP : COUNT_RE_PENDING) || []).length;
  const done = (text.match(topLevelOnly ? COUNT_RE_DONE_TOP : COUNT_RE_DONE) || []).length;
  return { pending, done, total: pending + done };
}

/**
 * 读取 AI 记录的 native plan 文件路径
 * @param {string} cwd - 项目根目录
 * @returns {string|null} plan 文件路径或 null
 */
function getNativePlanPath(cwd) {
  const fp = path.join(getProjectRuntimeDir(cwd), 'current-native-plan');
  try {
    const planPath = fs.readFileSync(fp, 'utf8').trim();
    if (!planPath || !nativePlanMatchesProject(planPath, cwd)) return null;
    return planPath;
  } catch(e) { return null; }
}

function nativePlanMatchesProject(planPath, cwd) {
  const normalizedPlanPath = normalizePath(path.resolve(cwd || process.cwd(), String(planPath || '')));
  const normalizedCwd = normalizePath(path.resolve(cwd || process.cwd()));
  const cwdWithSlash = normalizedCwd.endsWith('/') ? normalizedCwd : normalizedCwd + '/';
  if (normalizedPlanPath.startsWith(cwdWithSlash)) return true;

  let content = '';
  try { content = fs.readFileSync(normalizedPlanPath, 'utf8').slice(0, 65536); } catch(e) { return false; }
  const normalizedContent = content.replace(/\\/g, '/').toLowerCase();
  if (normalizedContent.includes(normalizedCwd.toLowerCase())) return true;

  const candidates = new Set(getProjectNameCandidates(cwd)
    .map(name => String(name || '').toLowerCase())
    .filter(name => name.length >= 3));
  for (const name of candidates) {
    const re = new RegExp(`(^|[^a-z0-9_-])${escapeRegex(name)}([^a-z0-9_-]|$)`, 'i');
    if (re.test(normalizedContent)) return true;
  }
  return false;
}

/**
 * 扫描 thoughts/ 和 knowledge/ 中与指定项目相关的笔记
 * 解析 frontmatter 的 projects/summary/status 字段，返回 L0 摘要
 * @param {string} projectName - 当前项目名（小写连字符格式，或由 getProjectName 生成）
 * @returns {Array<{title: string, summary: string, status: string}>}
 */
function scanRelatedNotes(projectName) {
  if (!VAULT_PATH) return [];
  const results = [];
  for (const dir of ['thoughts', 'knowledge']) {
    const dirPath = path.join(VAULT_PATH, dir);
    try {
      if (!fs.existsSync(dirPath)) continue;
      const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
          // I-7: 处理 BOM（UTF-8 BOM \uFEFF 可能出现在文件开头）
          const fmMatch = content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/);
          if (!fmMatch) continue;
          const fm = fmMatch[1];
          // 解析 projects 字段
          const projMatch = fm.match(/^projects:\s*\[([^\]]*)\]/m);
          if (!projMatch) continue;
          const projects = projMatch[1].split(',').map(p => p.trim().toLowerCase());
          if (!projects.includes(projectName.toLowerCase())) continue;
          // 解析 status（archived 不注入）
          const statusMatch = fm.match(/^status:\s*(.+)/m);
          const status = statusMatch ? statusMatch[1].trim() : 'unknown';
          if (status === 'archived') continue;
          // 解析 summary
          const summaryMatch = fm.match(/^summary:\s*(?:"([^"]*)"|'([^']*)'|(.+))/m);
          const summary = summaryMatch ? (summaryMatch[1] || summaryMatch[2] || summaryMatch[3] || '').trim() : '';
          results.push({ title: file.replace(/\.md$/, ''), summary, status });
        } catch(e) { /* 单文件解析失败静默跳过 */ }
      }
    } catch(e) { /* 目录不可读静默跳过 */ }
  }
  return results;
}

// 1MB：全覆盖日志（ENTRY+SKIP+PASS）后每 session ~50KB，1MB 可保留 ~20 session / 7-10 天
const MAX_LOG_SIZE = 1024 * 1024;
const LOGGER_LOCK_STALE_MS = 30 * 1000;
/**
 * 创建带日志轮转的 logger 函数（1MB 上限，超过截断保留后半）
 * @param {string} logPath - 日志文件路径
 * @returns {function(string): void}
 */
function createLogger(logPath) {
  return (msg) => {
    let lockFd = null;
    const lockPath = `${logPath}.lock`;
    try {
      try {
        lockFd = fs.openSync(lockPath, 'wx');
      } catch(e) {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOGGER_LOCK_STALE_MS) {
            fs.unlinkSync(lockPath);
            lockFd = fs.openSync(lockPath, 'wx');
          }
        } catch(e2) {}
      }
      if (lockFd === null) {
        fs.appendFileSync(logPath, msg);
        return;
      }
      try {
        const stat = fs.statSync(logPath);
        if (stat.size > MAX_LOG_SIZE) {
          // W-code-2: 使用 Buffer 直接操作字节，避免字节/字符混淆
          const buf = fs.readFileSync(logPath);
          // 截断保留后半部分，从第一个换行符之后开始（防止 UTF-8 多字节字符被截断）
          const half = buf.slice(buf.length >> 1);
          const nlIdx = half.indexOf(10); // 0x0A = \n
          fs.writeFileSync(logPath, nlIdx >= 0 ? half.slice(nlIdx + 1) : half);
        }
      } catch(e) {}
      fs.appendFileSync(logPath, msg);
    } catch(e) {
    } finally {
      if (lockFd !== null) {
        try { fs.closeSync(lockFd); } catch(e) {}
        try { fs.unlinkSync(lockPath); } catch(e) {}
      }
    }
  };
}

/**
 * 格式化结构化日志条目（act=/proj=/dur= 字段格式，便于 grep/awk 分析）
 * @param {string} hook - Hook 名称（自动 padEnd(11) 对齐）
 * @param {string} action - Action 名称（ENTRY/SKIP/PASS/DENY 等）
 * @param {Object} [fields={}] - 可选字段键值对（跳过 undefined/null/空字符串）
 * @returns {string} 格式化的日志行（含换行符）
 */
function logEntry(hook, action, fields = {}) {
  const parts = [`[${ts()}] ${hook.padEnd(11)} | act=${action}`];
  const merged = { sid: currentSessionId(), ...fields };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === '') continue;
    let value = String(v)
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, ' ')
      .replace(/\|/g, '/');
    if (value.length > 1000) value = value.slice(0, 997) + '...';
    parts.push(`${k}=${value}`);
  }
  return parts.join(' | ') + '\n';
}

/**
 * W-dry-2: 格式化 Superpowers 桥接提示（消除 4 处重复的 listPlanFiles + fileList 格式化）
 * @param {string} cwd - 项目根目录
 * @param {string} artDir - artifact 目录
 * @returns {{ fileList: string, bridgeSteps: string } | null} null 表示无计划文件
 */
function formatBridgeHint(cwd, artDir) {
  // 仅显示未同步的 plan 文件（已同步的不再提示桥接）
  const planFiles = listUnsyncedPlanFiles(cwd);
  if (planFiles.length === 0) return null;
  const fileList = planFiles.slice(0, 3).map(p => `${p.dir}/${p.name}`).join(', ');
  const artPath = (artDir || cwd).replace(/\\/g, '/');
  const syncedPath = path.join(getProjectRuntimeDir(cwd), 'synced-plans').replace(/\\/g, '/');
  const bridgeSteps = `Read plan → 派 artifact-writer create-chg 创建 ${artPath}/changes/<id>.md 与 task.md / implementation_plan.md wikilink 索引；若 plan 已获用户确认并准备开始，再派 update-chg action=approve-and-start（需 approval-confirmed/source/evidence/task-id）；最后必须把已桥接 plan 的 basename 幂等追加到 ${syncedPath}（worktree 也写宿主项目 .pace）。详见 /pace-bridge skill。`;
  return { fileList, bridgeSteps };
}

/**
 * 从 findings 活跃区提取开放项（[ ]）的完整标题，用于详情段落匹配
 * @param {string} text - findings.md 活跃区文本
 * @returns {string[]} key 数组，每个为索引标题全文（去空格）
 */
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

/** W-5: 检测 impl_plan 活跃区的旧格式（emoji 状态标记或纯表格格式） */
function detectLegacyImplFormat(text) {
  const hasEmoji = /^- \[.\].*[✅❌📋🔄⏳]/m.test(text);
  const hasTable = /^\|.+\|$/m.test(text) && !/^- \[.\]/m.test(text);
  return { hasEmoji, hasTable };
}

/** 解析 v6 frontmatter 为普通对象 */
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

/** 将 CHG/HOTFIX id 转成 v6 详情文件名 */
function detailPathForId(artDir, id) {
  if (!id) return null;
  const lower = id.toLowerCase();
  if (/^chg-\d{8}-\d{2}$/.test(lower) || /^hotfix-\d{8}-\d{2}$/.test(lower)) {
    return path.join(artDir, 'changes', `${lower}.md`);
  }
  return null;
}

/** 从 v6 索引活跃区提取 CHG/HOTFIX wikilink 行 */
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

/** 读取并解析 CHG/HOTFIX 详情文件 */
function readChangeDetail(cwd, idOrSlug) {
  const artDir = getArtifactDir(cwd);
  const fp = detailPathForId(artDir, idOrSlug);
  if (!fp) return null;
  try {
    const content = fs.readFileSync(fp, 'utf8');
    return { path: fp, content, frontmatter: parseFrontmatter(content) };
  } catch(e) {
    return { path: fp, missing: true, content: '', frontmatter: {} };
  }
}

/** 提取详情文件 ## 任务清单 段落 */
function extractTaskSection(content) {
  const text = content || '';
  const header = text.match(/^## 任务清单\r?\n/m);
  if (!header) return '';
  const start = header.index + header[0].length;
  const rest = text.slice(start);
  const next = rest.search(/^## /m);
  return next >= 0 ? rest.slice(0, next) : rest;
}

/** 统计详情任务状态 */
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

/**
 * 将 v6 CHG/HOTFIX 活跃项机械分类，供 Stop / SessionStart / Claude 任务列表同步复用。
 * 分类只基于索引 checkbox、frontmatter、APPROVED/VERIFIED 标记和任务清单状态。
 */
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

/** 返回 task.md 与 implementation_plan.md 活跃索引的交叉信息 */
function getActiveChangeEntries(cwd) {
  const taskEntries = parseChangeIndex(readActive(cwd, 'task.md') || '');
  const implEntries = parseChangeIndex(readActive(cwd, 'implementation_plan.md') || '');
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

/** v6 详情是否已批准 */
function isChangeApproved(detail) {
  if (!detail || detail.missing) return false;
  return /<!-- APPROVED -->/.test(detail.content);
}

/** v6 详情是否已验证 */
function isChangeVerified(detail) {
  if (!detail || detail.missing) return false;
  const verifiedDate = (detail.frontmatter['verified-date'] || '').trim();
  return verifiedDate && verifiedDate !== 'null' && /<!-- VERIFIED -->/.test(detail.content);
}

/** 生成 compact/session-start 用的活跃 CHG 摘要 */
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

// S-1: 统一 stdin 解析 — 替换 6 个 hook 的重复 JSON.parse 模板
/**
 * 解析 hook stdin 原始输入，返回统一结构（内部 try-catch，永不抛异常）
 * @param {string} rawInput - stdin 原始文本
 * @returns {{ ok: boolean, toolName: string, filePath: string, oldString: string, newString: string, content: string, toolInput: object, type: string, agentId: string, agentType: string, lastMessage: string, agentTranscriptPath: string, error: string, isInterrupt: boolean, durationMs: number, raw: object }}
 */
function parseHookStdin(rawInput) {
  let parsed = {};
  let ok = false;
  try { parsed = JSON.parse(rawInput); ok = true; } catch(e) {}
  const sessionId = normalizeSessionId(parsed.session_id || parsed.sessionId || process.env.CLAUDE_CODE_SESSION_ID || '');
  if (sessionId) _lastHookSessionId = sessionId;
  return {
    ok,
    sessionId,
    toolName: parsed.tool_name || '',
    filePath: (parsed.tool_input?.file_path || '').replace(/\\/g, '/'),
    oldString: parsed.tool_input?.old_string || '',
    newString: parsed.tool_input?.new_string || '',
    content: parsed.tool_input?.content || '',
    toolInput: parsed.tool_input || {},
    // HOTFIX-20260315-05: CC SessionStart stdin 用 `source` 字段（非 `type`）传递事件类型
    type: parsed.source || parsed.type || '',
    agentId: parsed.agent_id || parsed.subagent_id || '',
    agentType: parsed.agent_type || parsed.subagent_type || parsed.tool_input?.subagent_type || '',
    lastMessage: parsed.last_assistant_message || parsed.last_message || parsed.message || '',
    agentTranscriptPath: parsed.agent_transcript_path || parsed.transcript_path || '',
    error: parsed.error || parsed.error_type || '',
    isInterrupt: parsed.is_interrupt === true || parsed.is_interrupt === 'true' || parsed.isInterrupt === true,
    durationMs: Number(parsed.duration_ms || parsed.durationMs || 0) || 0,
    raw: parsed
  };
}

/**
 * 异步 stdin 解析 wrapper — 替代 4 个 hook 的 3 行流模板
 * @param {function} callback - (stdin, rawInput) => void
 */
function withStdinParsed(callback) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => { callback(parseHookStdin(input), input); });
}

/**
 * 同步 stdin 解析 — 替代 session-start/stop 的 readFileSync(0) 模板
 * @returns {{ ok: boolean, toolName: string, filePath: string, oldString: string, newString: string, content: string, toolInput: object, type: string, agentId: string, agentType: string, lastMessage: string, agentTranscriptPath: string, error: string, isInterrupt: boolean, durationMs: number, raw: object }}
 */
function parseStdinSync() {
  try { return parseHookStdin(fs.readFileSync(0, 'utf8')); }
  catch(e) { return parseHookStdin(''); }
}

// I-04: 多行格式按功能分组，便于 diff 审阅
module.exports = {
  // 常量
  PACE_VERSION, CODE_EXTS, ARTIFACT_FILES, MIGRATABLE_ARTIFACT_FILES, VAULT_PATH, ARTIFACT_ROOT_CHOICE_FILE, V5_MIGRATION_STATE_FILE,
  ARTIFACT_WRITER_LOCK_FILE, ARTIFACT_WRITER_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_TTL_MS, ARTIFACT_RESOURCE_LOCK_WAIT_MS,
  ARTIFACT_SEQUENCE_LOCK_TTL_MS, ARTIFACT_SEQUENCE_LOCK_WAIT_MS,
  ARCHIVE_MARKER, ARCHIVE_PATTERN, COMPLETION_PHRASES,
  TODO_DRIFT_THRESHOLD, SKILL_DIRS, SESSION_SCOPED_FLAGS, SESSION_SCOPED_FLAG_PREFIXES, FORMAT_SNIPPETS, PLAN_DIRS,
  // 基础工具
  resolveProjectCwd, ts, todayISO, daysSinceISODate, countCodeFiles, getProjectName, getProjectNameCandidates, normalizePath, displayDir,
  resolveToolFilePath, isArtifactRelativePath, artifactRelativePathForFile,
  // 项目检测与路径
  isPaceProject, isTeammate, isArtifactWriterAgentType, normalizeSessionId, currentSessionId,
  getArtifactDir, getProjectStateDir, getProjectRuntimeDir,
  getArtifactRootChoicePath, normalizeArtifactRootChoice, readArtifactRootChoice, getConfiguredArtifactDir,
  getV5MigrationStatePath, readV5MigrationState, getLegacyV5ArtifactDir, getV5MigrationInfo, v5MigrationPromptMessage,
  getArtifactWriterLockPath, readArtifactWriterLock, acquireArtifactWriterLock,
  artifactWriterLockMatches, releaseArtifactWriterLock, formatArtifactWriterLock,
  artifactResourceForRel, getArtifactResourceLockPath, readArtifactResourceLock,
  acquireArtifactResourceLock, releaseArtifactResourceLock, releaseArtifactResourcesForOwner,
  markIndexChangesTouchedAndMaybeRelease, readArtifactIndexTransaction, formatArtifactResourceLock,
  reserveArtifactId, readArtifactReservation, findArtifactReservationForRel, clearArtifactReservation, clearArtifactReservationForRel, reservationMatchesArtifactRel,
  isArtifactRuntimeControlPath, operationFromAgentPrompt,
  artifactRootConfigError, artifactRootChoiceNeeded, artifactRootChoiceMessage, artifactDirRuntimeHint, appendArtifactDirHint, ensureProjectInfra,
  // 文件读写
  readActive, readFull, checkArchiveFormat, createTemplates, normalizeLineEndings, hasNonNullVerifiedDate,
  // 计划文件
  hasPlanFiles, listPlanFiles, hasUnsyncedPlanFiles, listUnsyncedPlanFiles,
  // 统计与检查
  countByStatus, extractOpenKeys, normalizeFindingKey, detectLegacyImplFormat,
  parseFrontmatter, detailPathForId, parseChangeIndex, readChangeDetail, extractTaskSection,
  countDetailTasks, classifyChange, getActiveChangeEntries, isChangeApproved, isChangeVerified, summarizeActiveChanges,
  // 外部集成
  scanRelatedNotes, getNativePlanPath, nativePlanMatchesProject, createLogger, logEntry, formatBridgeHint,
  // stdin 解析
  parseHookStdin, withStdinParsed, parseStdinSync,
};
