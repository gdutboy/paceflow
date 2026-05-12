const fs = require('fs');
const path = require('path');
const { ARTIFACT_FILES } = require('./constants');

function resolveProjectCwd() {
  return process.env.CLAUDE_PROJECT_DIR
    ? path.resolve(process.env.CLAUDE_PROJECT_DIR)
    : process.cwd();
}

function ts() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

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

const isWin = process.platform === 'win32';

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

function getProjectName(cwd) {
  if (!cwd || cwd === '.' || cwd === '/' || cwd === '\\') return 'unknown-project';
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

function getProjectStateDir(cwd) {
  return worktreeBaseDir(cwd) || gitWorktreeHostDir(cwd) || cwd;
}

function getProjectRuntimeDir(cwd) {
  return path.join(getProjectStateDir(cwd), '.pace');
}

function gitBranchName(cwd) {
  try {
    const { execFileSync } = require('child_process');
    return String(execFileSync('git', ['-C', cwd || process.cwd(), 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    })).trim();
  } catch(e) {
    return '';
  }
}

function executionContextForCwd(cwd) {
  const resolved = path.resolve(cwd || process.cwd());
  const stateDir = getProjectStateDir(resolved);
  const isWorktree = normalizePath(stateDir) !== normalizePath(resolved);
  const worktree = isWorktree ? path.basename(resolved) : 'main';
  const branch = gitBranchName(resolved) || worktree || 'unknown';
  return {
    worktree,
    branch,
    cwd: resolved,
    stateDir,
    isWorktree,
    text: `[worktree:: ${worktree}] [branch:: ${branch}]`,
  };
}

module.exports = {
  resolveProjectCwd,
  ts,
  todayISO,
  daysSinceISODate,
  normalizePath,
  displayDir,
  isPortableAbsolutePath,
  resolveToolFilePath,
  isArtifactRelativePath,
  artifactRelativePathForFile,
  escapeRegex,
  getProjectNameCandidates,
  getProjectName,
  getProjectStateDir,
  getProjectRuntimeDir,
  executionContextForCwd,
};
