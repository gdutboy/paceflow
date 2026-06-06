// pace-utils.js — PACE hooks 公共工具函数
// v6 项目识别 + 懒创建模板 + changes/ 详情解析 + .pace/disabled 豁免
const fs = require('fs');
const path = require('path');

// pace-utils.js 是兼容门面；子模块保持可审计边界，外部仍只 require('./pace-utils')。
// Hook 测试与 env-scrub 场景会在同一 Node 进程内切换环境变量，因此门面重载时
// 也要刷新会读取 process.env 的子模块缓存。
for (const rel of [
  './pace-utils/constants',
  './pace-utils/line-endings',
  './pace-utils/session',
  './pace-utils/path-utils',
  './pace-utils/logger',
  './pace-utils/plans',
  './pace-utils/change-id',
  './pace-utils/change-analysis',
  './pace-utils/locks',
]) {
  delete require.cache[require.resolve(rel)];
}

const {
  PACE_VERSION,
  CODE_EXTS,
  ARTIFACT_FILES,
  MIGRATABLE_ARTIFACT_FILES,
  ARCHIVE_REQUIRED_FILES,
  ARCHIVE_MISSING_INJECT_LIMIT,
  VAULT_PATH,
  ARTIFACT_ROOT_CHOICE_FILE,
  PROJECT_ROOT_FILE,
  V5_MIGRATION_STATE_FILE,
  ARTIFACT_WRITER_LOCK_FILE,
  ARTIFACT_WRITER_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_WAIT_MS,
  ARTIFACT_SEQUENCE_LOCK_TTL_MS,
  ARTIFACT_SEQUENCE_LOCK_WAIT_MS,
  PLAN_SYNC_LOCK_TTL_MS,
  PLAN_SYNC_LOCK_WAIT_MS,
  CHANGE_OWNER_TTL_MS,
  ARTIFACT_ROOT_CHOICE_MAX_CHARS,
  RESERVE_ARTIFACT_ID_SCRIPT,
  SYNC_PLAN_SCRIPT,
  SET_ARTIFACT_ROOT_SCRIPT,
  SET_PROJECT_ROOT_SCRIPT,
  PACE_ARTIFACT_ROOT_CONTENT,
  ARCHIVE_MARKER,
  ARCHIVE_PATTERN,
  COMPLETION_PHRASES,
  SKILL_DIRS,
  FORMAT_SNIPPETS,
  SESSION_SCOPED_FLAGS,
  SESSION_SCOPED_FLAG_PREFIXES,
  PLAN_DIRS,
} = require('./pace-utils/constants');

const {
  normalizeLineEndings,
  hasNonNullVerifiedDate,
  hasNonNullReviewedDate,
} = require('./pace-utils/line-endings');

const {
  isTeammate,
  isArtifactWriterAgentType,
  normalizeSessionId,
  currentSessionId,
  parseHookStdin,
  withStdinParsed,
  parseStdinSync,
} = require('./pace-utils/session');

const {
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
  resolveEffectiveProjectRoot,
  rawProjectNameCandidates,
  getProjectNameCandidates,
  getProjectName,
  getProjectStateDir,
  getProjectRuntimeDir,
  executionContextForCwd,
} = require('./pace-utils/path-utils');

const {
  createLogger,
  logEntry,
} = require('./pace-utils/logger');

const {
  normalizeChangeId,
  detailPathForId,
  slugForChangeId,
} = require('./pace-utils/change-id');

const {
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
} = require('./pace-utils/change-analysis')({
  readActive,
  readFull,
  getArtifactDir,
  escapeRegex,
});

const {
  getArtifactWriterLockPath,
  readArtifactWriterLock,
  artifactWriterLockMatches,
  operationFromAgentPrompt,
  changeIdFromAgentPrompt,
  explicitChangeTargetFromAgentPrompt,
  artifactResourceForRel,
  getArtifactResourceLockPath,
  readArtifactResourceLock,
  acquireArtifactResourceLock,
  releaseArtifactResourceLock,
  releaseArtifactResourcesForOwner,
  sweepStaleRuntimeOwners,
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
} = require('./pace-utils/locks')({
  getProjectRuntimeDir,
  displayDir,
  normalizeSessionId,
  currentSessionId,
  executionContextForCwd,
  normalizePath,
  getArtifactDir,
  todayISO,
  CHANGE_OWNER_TTL_MS,
  PROJECT_ROOT_FILE,
});

const {
  listPlanFiles,
  hasPlanFiles,
  hasUnsyncedPlanFiles,
  listUnsyncedPlanFiles,
  hasBridgeCandidatePlanFiles,
  listBridgeCandidatePlanFiles,
  syncPlanFile,
  getNativePlanPath,
  nativePlanMatchesProject,
  formatBridgeHint,
} = require('./pace-utils/plans')({
  getProjectRuntimeDir,
  getProjectStateDir,
  acquireJsonLock,
  normalizePath,
  getProjectNameCandidates,
  escapeRegex,
});

function getArtifactRootChoicePath(cwd) {
  return path.join(getProjectRuntimeDir(cwd), ARTIFACT_ROOT_CHOICE_FILE);
}

function getProjectRootMarkerPath(cwd) {
  return path.join(path.resolve(cwd || process.cwd()), '.pace', PROJECT_ROOT_FILE);
}

function isLocalArtifactRootChoicePath(cwd, filePath) {
  if (!cwd || !filePath) return false;
  const target = normalizePath(path.resolve(filePath));
  const localChoicePath = normalizePath(path.join(path.resolve(cwd), '.pace', ARTIFACT_ROOT_CHOICE_FILE));
  const authoritativeChoicePath = normalizePath(getArtifactRootChoicePath(cwd));
  return target === localChoicePath && target !== authoritativeChoicePath;
}

function isProjectRootMarkerPath(cwd, filePath) {
  if (!filePath) return false;
  const target = normalizePath(path.resolve(filePath));
  return target.endsWith(`/.pace/${PROJECT_ROOT_FILE}`);
}

function localArtifactRootChoiceDenyReason(cwd, extra = '') {
  const context = executionContextForCwd(cwd);
  const choicePath = getArtifactRootChoicePath(cwd).replace(/\\/g, '/');
  const projectRoot = getProjectStateDir(cwd).replace(/\\/g, '/');
  const lines = [
    '当前 cwd 继承了外层 PaceFlow Project Root，artifact-root 配置必须写入该 Project Root 的共享 runtime，不写当前子目录的 .pace/artifact-root。',
    `当前 cwd: ${path.resolve(cwd || process.cwd()).replace(/\\/g, '/')}`,
    `Project Root: ${projectRoot}`,
    `配置文件: ${choicePath}`,
    `execution-context: ${context.text}`,
    `请运行 artifact-root helper：node "${SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault`,
    'helper 会写入正确的共享 runtime 配置位置；若当前子目录确实是独立项目，先运行 Project Root helper 声明 independent。'
  ];
  if (extra) lines.push(extra);
  return lines.join('\n');
}

function projectRootMarkerDenyReason(cwd, extra = '') {
  const context = executionContextForCwd(cwd);
  const markerPath = getProjectRootMarkerPath(cwd).replace(/\\/g, '/');
  const projectRoot = getProjectStateDir(cwd).replace(/\\/g, '/');
  const lines = [
    '禁止手写 .pace/project-root。Project Root 独立声明必须通过 helper 完成，避免绕过 worktree 拒绝、父级继承和后续 artifact-root 引导。',
    `当前 cwd: ${path.resolve(cwd || process.cwd()).replace(/\\/g, '/')}`,
    `当前 Project Root: ${projectRoot}`,
    `当前 cwd marker: ${markerPath}`,
    `execution-context: ${context.text}`,
    `请运行 Project Root helper：node "${SET_PROJECT_ROOT_SCRIPT}" --mode independent`,
    'helper 会校验当前 cwd 是否为真实 git worktree；声明成功后再运行 artifact-root helper 选择 local 或 vault。'
  ];
  if (extra) lines.push(extra);
  return lines.join('\n');
}

function getV5MigrationStatePath(cwd) {
  return path.join(getProjectRuntimeDir(cwd), V5_MIGRATION_STATE_FILE);
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
  // PU-002：用 isDirectory 区分目录与同名文件，避免同名文件 changes（非目录）被误判为 PACE 项目
  try { return !!dir && fs.statSync(path.join(dir, 'changes')).isDirectory(); } catch(e) { return false; }
}

function legacyV5FilesInDir(dir) {
  if (!dir || hasChangesDir(dir)) return [];
  const signatures = {
    'task.md': /<!-- ARCHIVE -->|#\s*项目任务追踪|##\s*活跃任务|###\s*(?:CHG|HOTFIX)-/i,
    'implementation_plan.md': /<!-- ARCHIVE -->|#\s*实施计划|##\s*变更索引|##\s*活跃变更详情|###\s*(?:CHG|HOTFIX)-/i,
    'walkthrough.md': /<!-- ARCHIVE -->|#\s*工作记录|##\s*最近工作/i,
    'findings.md': /<!-- ARCHIVE -->|#\s*调研记录|##\s*未解决问题|##\s*Corrections\s*记录/i,
  };
  const contents = {};
  const detected = Object.entries(signatures).filter(([file, re]) => {
    try {
      const fp = path.join(dir, file);
      if (!fs.existsSync(fp)) return false;
      const head = fs.readFileSync(fp, 'utf8').slice(0, 20000);
      contents[file] = head;
      return re.test(head);
    } catch(e) {
      return false;
    }
  }).map(([file]) => file);
  if (detected.length > 0) return detected;

  // Minimal v5 fixtures seen in production can be English-only root files with
  // active checkbox rows and no v6 changes/ directory. Require both roots so a
  // generic task.md todo list does not become a false positive.
  try {
    for (const file of ['task.md', 'implementation_plan.md']) {
      if (!contents[file]) {
        const fp = path.join(dir, file);
        if (fs.existsSync(fp)) contents[file] = fs.readFileSync(fp, 'utf8').slice(0, 20000);
      }
    }
    const task = contents['task.md'] || '';
    const impl = contents['implementation_plan.md'] || '';
    const hasTaskRoot = /^#\s*(?:Task|Tasks|项目任务|项目任务追踪)\s*$/im.test(task);
    const hasImplRoot = /^#\s*(?:Implementation\s+Plan|Plan|实施计划)\s*$/im.test(impl);
    const hasTaskCheckbox = /^- \[[ x\/!\-]\]\s+\S/m.test(task);
    const hasImplCheckbox = /^- \[[ x\/!\-]\]\s+\S/m.test(impl);
    if (hasTaskRoot && hasImplRoot && hasTaskCheckbox && hasImplCheckbox) {
      return ['task.md', 'implementation_plan.md'];
    }
  } catch(e) {}
  return [];
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
  // A06：仅 detected 不足以提示——ignored/declined/migrated（needsPrompt=false）必须抑制，
  // 否则用户选 ignored 后 detected 仍 true，Stop 每次硬阻断死锁。
  if (!info.detected || !info.needsPrompt) return '';
  const script = info.scriptPath.replace(/\\/g, '/');
  const artifactDir = info.dir.replace(/\\/g, '/');
  return [
    '检测到旧 v5 PACE artifact，但当前 artifact 根目录没有 changes/ v6 详情目录。',
    `PaceFlow artifact 根目录（legacy v5）: ${displayDir(info.dir)}`,
    `检测到文件: ${info.files.join(', ')}`,
    '请先用 AskUserQuestion 询问用户是否迁移、忽略旧 artifact，或取消本次操作；若前一个工具调用被 hook 阻止，目标文件尚未修改。',
    '推荐迁移流程：先 dry-run，展示摘要并再次确认后再正式迁移。',
    'dry-run 命令：',
    `node "${script}" "${artifactDir}" --dry-run`,
    'dry-run 完成后，必须再次使用 AskUserQuestion 展示摘要并取得用户确认。',
    '确认后正式迁移命令：',
    `node "${script}" "${artifactDir}"`,
    `忽略旧 artifact 时写入 ${getV5MigrationStatePath(cwd)}，内容为纯文本 ignored。`,
    '禁止在用户确认前创建 changes/、懒创建 v6 模板或派 artifact-writer create-chg。',
    '处理完成后重新走 v6 P-A-C（必要时派 artifact-writer create-chg），并重试被阻止的原始工具调用；不要把迁移本身当作原始任务完成。'
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
  const rootInfo = resolveEffectiveProjectRoot(cwd);
  const vaultDir = VAULT_PATH ? path.join(VAULT_PATH, 'projects', projectName) : '';
  const choicePath = getArtifactRootChoicePath(cwd);
  return [
    'PACEflow 首次启用需要选择 artifact 存放位置。',
    FORMAT_SNIPPETS.skillRef,
    `Project Root: ${stateDir.replace(/\\/g, '/')}（当前 cwd: ${path.resolve(cwd || process.cwd()).replace(/\\/g, '/')}；mode=${rootInfo.mode}）`,
    `如果当前子目录应作为独立 PaceFlow 项目，先运行 Project Root helper：node "${SET_PROJECT_ROOT_SCRIPT}" --mode independent`,
    `Obsidian vault artifact 根目录: ${displayDir(vaultDir)}`,
    `本地项目 artifact 根目录: ${displayDir(stateDir)}`,
    '请用 AskUserQuestion 询问用户选择 "Obsidian vault project" 或 "本地项目目录"（至少两个选项）。',
    `用户选择后，运行 artifact-root helper 写入配置：node "${SET_ARTIFACT_ROOT_SCRIPT}" --choice local 或 --choice vault`,
    `配置文件: ${choicePath}`,
    '该配置文件不是 artifact 根目录。',
    `artifact_dir 只用于 PaceFlow artifacts：${PACE_ARTIFACT_ROOT_CONTENT}。`,
    `配置写入后再从目标项目 cwd 运行 reserve helper：node "${RESERVE_ARTIFACT_ID_SCRIPT}" --operation create-chg`,
    'reserve helper 不接受 --artifact-dir / --artifact-root / --project-dir；自动化只可用 --cwd。',
    '写入配置后，不要直接重试代码写入；先创建/批准 CHG，再重试被阻止的代码写入。若被阻止的是 artifact-writer Agent，则按提示重派同一操作。'
  ].join('\n');
}

function artifactDirRuntimeHint(cwd) {
  const artDir = getArtifactDir(cwd);
  const stateDir = getProjectStateDir(cwd);
  const rootInfo = resolveEffectiveProjectRoot(cwd);
  const choice = readArtifactRootChoice(cwd) || 'auto';
  const choicePath = getArtifactRootChoicePath(cwd);
  return `Artifact 根目录：${displayDir(artDir)}（选择=${choice}；配置文件=${choicePath}；Project Root=${stateDir.replace(/\\/g, '/')}；mode=${rootInfo.mode}；仅用于 ${PACE_ARTIFACT_ROOT_CONTENT}）`;
}

function appendArtifactDirHint(cwd, message) {
  const text = String(message || '');
  if (!text) return artifactDirRuntimeHint(cwd);
  if (text.includes('Artifact 根目录') || text.includes('artifact 根目录')) return text;
  return `${text}\n${artifactDirRuntimeHint(cwd)}`;
}

// T-281: 模块级缓存，避免同一 hook 进程内重复 existsSync（同 cwd 最多 11 次→1 次）
let _artifactDirCache = { cwd: null, dir: null };

function _clearArtifactDirCache() {
  _artifactDirCache = { cwd: null, dir: null };
}

/**
 * 获取 artifact 文件的实际存储目录
 * 优先级：显式 artifact-root → vault 有 v6 → CWD 有 v6 → legacy v5 → 新项目默认 vault/CWD
 * @param {string} cwd - 当前工作目录
 * @returns {string} artifact 目录路径
 */
function getArtifactDir(cwd) {
  if (_artifactDirCache.cwd === cwd) return _artifactDirCache.dir;
  const stateDir = getProjectStateDir(cwd);
  let result = stateDir;
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
  // Project Root 有 changes/ → Project Root
  if (fs.existsSync(path.join(stateDir, 'changes'))) {
    _artifactDirCache = { cwd, dir: stateDir };
    return stateDir;
  }
  const legacyDir = getLegacyV5ArtifactDir(cwd);
  if (legacyDir) {
    _artifactDirCache = { cwd, dir: legacyDir };
    return legacyDir;
  }
  // 新项目 → vault（有 VAULT_PATH 时）或 CWD（无 VAULT_PATH）
  result = VAULT_PATH ? path.join(VAULT_PATH, 'projects', projectCandidates[0]) : stateDir;
  _artifactDirCache = { cwd, dir: result };
  return result;
}

function projectLogFields(cwd, artifactDir = '') {
  const rootInfo = resolveEffectiveProjectRoot(cwd);
  let artDir = artifactDir;
  try {
    if (!artDir) artDir = getArtifactDir(cwd);
  } catch(e) {}
  return {
    cwd: path.resolve(cwd || process.cwd()).replace(/\\/g, '/'),
    project_root: rootInfo.projectRoot.replace(/\\/g, '/'),
    artifact_dir: artDir ? displayDir(artDir) : '',
    mode: rootInfo.mode,
  };
}

function projectLogEntry(cwd, hook, action, fields = {}, artifactDir = '') {
  return logEntry(hook, action, {
    ...projectLogFields(cwd, artifactDir),
    ...fields,
  });
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
    const storedArtifactRootChoice = (() => {
      try { return fs.existsSync(getArtifactRootChoicePath(cwd)) ? readArtifactRootChoice(cwd) : ''; } catch(e) { return ''; }
    })();
    const configuredDir = getConfiguredArtifactDir(cwd);
    if (configuredDir) {
      if (hasChangesDir(configuredDir)) return 'artifact';
    } else {
      const stateDir = getProjectStateDir(cwd);
      // 信号 1（最强）：v6 项目必须有 changes/ 目录（PU-002：isDirectory 区分同名文件）
      if (hasChangesDir(stateDir)) return 'artifact';
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
    // A stored artifact-root choice is an explicit PACE entry signal even
    // before templates/changes have been lazily initialized.
    if (configuredDir || storedArtifactRootChoice) return 'manual';
    // 信号 2（强）：当前/近期/显式选中的 Superpowers plan 文件。
    // 旧 plan 只作为历史 backlog，不再让普通会话长期进入 superpowers 信号。
    if (hasBridgeCandidatePlanFiles(cwd)) return 'superpowers';
    // 信号 3（强）：手动激活标记
    if (fs.existsSync(path.join(getProjectStateDir(cwd), '.pace-enabled'))) return 'manual';
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
  // 层1：应保持双区结构的文件（ARCHIVE_REQUIRED_FILES，排除无双区的 spec.md）完全缺失 ARCHIVE 标记时报警——
  // session-start 注入依赖该标记切分活跃区，缺失会导致整个文件全文注入 context（findings/walkthrough 可达 10 万字符）。
  if (!hasCorrect && ARCHIVE_REQUIRED_FILES.includes(filename)) {
    return `${filename} 缺少 <!-- ARCHIVE --> 标记。session-start 注入依赖该标记切分活跃区，缺失会导致整个文件全文注入 context。请派 artifact-writer 修复双区结构。`;
  }
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
  const migrationInfo = getV5MigrationInfo(cwd);
  if (migrationInfo.needsPrompt) {
    throw new Error(v5MigrationPromptMessage(cwd));
  }
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

// I-04: 多行格式按功能分组，便于 diff 审阅
module.exports = {
  // 常量
  PACE_VERSION, CODE_EXTS, ARTIFACT_FILES, MIGRATABLE_ARTIFACT_FILES, VAULT_PATH, ARTIFACT_ROOT_CHOICE_FILE, PROJECT_ROOT_FILE, V5_MIGRATION_STATE_FILE,
  ARTIFACT_WRITER_LOCK_FILE, ARTIFACT_WRITER_LOCK_TTL_MS,
  ARTIFACT_RESOURCE_LOCK_TTL_MS, ARTIFACT_RESOURCE_LOCK_WAIT_MS, CHANGE_OWNER_TTL_MS,
  ARTIFACT_SEQUENCE_LOCK_TTL_MS, ARTIFACT_SEQUENCE_LOCK_WAIT_MS, PLAN_SYNC_LOCK_TTL_MS, PLAN_SYNC_LOCK_WAIT_MS,
  RESERVE_ARTIFACT_ID_SCRIPT, SYNC_PLAN_SCRIPT, SET_ARTIFACT_ROOT_SCRIPT, SET_PROJECT_ROOT_SCRIPT, PACE_ARTIFACT_ROOT_CONTENT,
  ARCHIVE_MARKER, ARCHIVE_PATTERN, ARCHIVE_REQUIRED_FILES, ARCHIVE_MISSING_INJECT_LIMIT, COMPLETION_PHRASES,
  SKILL_DIRS, SESSION_SCOPED_FLAGS, SESSION_SCOPED_FLAG_PREFIXES, FORMAT_SNIPPETS, PLAN_DIRS,
  // 基础工具
  resolveProjectCwd, ts, todayISO, daysSinceISODate, countCodeFiles, getProjectName, getProjectNameCandidates, rawProjectNameCandidates, normalizePath, displayDir,
  resolveToolFilePath, isArtifactRelativePath, artifactRelativePathForFile, executionContextForCwd,
  projectLogFields, projectLogEntry,
  // 项目检测与路径
  isPaceProject, isTeammate, isArtifactWriterAgentType, normalizeSessionId, currentSessionId,
  getArtifactDir, _clearArtifactDirCache, resolveEffectiveProjectRoot, getProjectStateDir, getProjectRuntimeDir,
  getArtifactRootChoicePath, getProjectRootMarkerPath, normalizeArtifactRootChoice, readArtifactRootChoice, getConfiguredArtifactDir,
  isLocalArtifactRootChoicePath, localArtifactRootChoiceDenyReason, isProjectRootMarkerPath, projectRootMarkerDenyReason,
  getV5MigrationStatePath, readV5MigrationState, getLegacyV5ArtifactDir, getV5MigrationInfo, v5MigrationPromptMessage,
  getArtifactWriterLockPath, readArtifactWriterLock,
  artifactWriterLockMatches,
  artifactResourceForRel, getArtifactResourceLockPath, readArtifactResourceLock,
  acquireArtifactResourceLock, releaseArtifactResourceLock, releaseArtifactResourcesForOwner,
  sweepStaleRuntimeOwners,
  markIndexChangesTouchedAndMaybeRelease, readArtifactIndexTransaction, formatArtifactResourceLock,
  reserveArtifactId, readArtifactReservation, findArtifactReservationForRel, clearArtifactReservation, clearArtifactReservationForRel, reservationMatchesArtifactRel,
  isArtifactRuntimeControlPath, operationFromAgentPrompt, changeIdFromAgentPrompt, explicitChangeTargetFromAgentPrompt,
  getChangeOwnerPath, readChangeOwner, writeChangeOwner, markChangeOwnerClosed, touchChangeOwnersForSession, changeOwnerStatus, ownerTakeoverConfirmed,
  artifactRootConfigError, artifactRootChoiceNeeded, artifactRootChoiceMessage, artifactDirRuntimeHint, appendArtifactDirHint, ensureProjectInfra,
  // 文件读写
  readActive, readFull, checkArchiveFormat, createTemplates, normalizeLineEndings, hasNonNullVerifiedDate, hasNonNullReviewedDate,
  // 计划文件
  hasPlanFiles, listPlanFiles, hasUnsyncedPlanFiles, listUnsyncedPlanFiles, hasBridgeCandidatePlanFiles, listBridgeCandidatePlanFiles, syncPlanFile,
  // 统计与检查
  countByStatus, extractOpenKeys, normalizeFindingKey, detectLegacyImplFormat,
  normalizeFrontmatterStatus,
  parseFrontmatter, normalizeChangeId, detailPathForId, slugForChangeId, validateWalkthroughLinks, parseChangeIndex, readChangeDetail, extractTaskSection,
  countDetailTasks, classifyChange, getActiveChangeEntries, isChangeApproved, isChangeVerified, isChangeReviewed, summarizeActiveChanges,
  // 外部集成
  scanRelatedNotes, getNativePlanPath, nativePlanMatchesProject, createLogger, logEntry, formatBridgeHint,
  // stdin 解析
  parseHookStdin, withStdinParsed, parseStdinSync,
};
