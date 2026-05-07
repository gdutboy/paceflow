// pace-utils.js — PACE hooks 公共工具函数
// v6 项目识别 + 懒创建模板 + changes/ 详情解析 + .pace/disabled 豁免
const fs = require('fs');
const path = require('path');

const PACE_VERSION = 'v6.0.27';
const CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte'];
const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md', 'corrections.md'];
const VAULT_PATH = process.env.PACE_VAULT_PATH || '';
const ARTIFACT_ROOT_CHOICE_FILE = 'artifact-root';

// 归档标记常量——所有 hook 必须引用此常量，禁止硬编码字符串
const ARCHIVE_MARKER = '<!-- ARCHIVE -->';
const ARCHIVE_PATTERN = /^<!-- ARCHIVE -->\r?$/m;

function normalizeLineEndings(content) {
  return String(content || '').replace(/\r\n?/g, '\n');
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
  'audit',
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
  archiveOp: '归档 = 派 artifact-writer archive-chg：详情 status→archived，task.md / implementation_plan.md 的索引行移动到 ARCHIVE 下方',
  findingsFormat: '- [状态] [[finding-id|标题]] — 摘要 [date:: YYYY-MM-DD] [impact:: P0-P3]',
  findingsDetail: 'finding 详情写入 changes/findings/<id>.md；findings.md 只保留摘要索引。',
  walkthroughDetail: '| YYYY-MM-DD | [[chg-YYYYMMDD-NN]] 完成摘要 | CHG-YYYYMMDD-NN |',
  // Skill 引用
  skillRef: '格式参考：paceflow:artifact-management skill',
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
];

/** 检测当前进程是否为 Agent Teams teammate（环境变量 CLAUDE_CODE_TEAM_NAME 存在即为 teammate） */
function isTeammate() {
  return !!process.env.CLAUDE_CODE_TEAM_NAME;
}

function isArtifactWriterAgentType(agentType) {
  const type = String(agentType || '').toLowerCase();
  return type === 'artifact-writer' || type === 'paceflow:artifact-writer' || type.endsWith(':artifact-writer');
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
        const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
        const idx = gitDir.indexOf(marker);
        if (idx >= 0) addProjectCandidate(candidates, path.basename(path.dirname(gitDir.slice(0, idx + 5))));
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
    const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
    const idx = gitDir.indexOf(marker);
    if (idx < 0) return null;
    return path.dirname(gitDir.slice(0, idx + 5));
  } catch(e) {
    return null;
  }
}

/** 项目级运行态目录归属；worktree 读取宿主项目 .pace。 */
function getProjectStateDir(cwd) {
  return worktreeBaseDir(cwd) || gitWorktreeHostDir(cwd) || cwd;
}

function getArtifactRootChoicePath(cwd) {
  return path.join(getProjectStateDir(cwd), '.pace', ARTIFACT_ROOT_CHOICE_FILE);
}

function normalizeArtifactRootChoice(choice) {
  let raw = String(choice || '').trim();
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

function hasChangesDir(dir) {
  try { return !!dir && fs.existsSync(path.join(dir, 'changes')); } catch(e) { return false; }
}

function artifactRootChoiceNeeded(cwd) {
  if (!VAULT_PATH) return false;
  if (getConfiguredArtifactDir(cwd)) return false;
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
    `Obsidian vault artifact 根目录: ${displayDir(vaultDir)}`,
    `本地项目 artifact 根目录: ${displayDir(stateDir)}`,
    '请用 AskUserQuestion 询问用户选择 "Obsidian vault project" 或 "本地项目目录"。',
    `用户选择后，只把选择结果写入配置文件 ${choicePath}：选择 vault 时写入纯文本 vault；选择本地时写入纯文本 local；不要包含引号。`,
    `注意：${displayDir(path.join(stateDir, '.pace'))} 只是 PaceFlow 配置/运行态目录，不是 artifact 根目录；不要把 task.md / implementation_plan.md / changes/** 写进 .pace/。`,
    `若选择本地项目目录，后续 artifact_dir 必须是 ${displayDir(stateDir)}；若选择 Obsidian vault，后续 artifact_dir 必须是 ${displayDir(vaultDir)}。`,
    '写入配置文件后重试本次操作，hook 会在所选 artifact 根目录懒创建 task.md / implementation_plan.md / changes/**。'
  ].join('\n');
}

function artifactDirRuntimeHint(cwd) {
  const artDir = getArtifactDir(cwd);
  const stateDir = getProjectStateDir(cwd);
  const choice = readArtifactRootChoice(cwd) || 'auto';
  const choicePath = getArtifactRootChoicePath(cwd);
  return `Artifact 根目录：${displayDir(artDir)}（选择=${choice}；配置文件=${choicePath}；.pace/ 只保存配置/运行状态，不存 task.md / changes/**）`;
}

// T-281: 模块级缓存，避免同一 hook 进程内重复 existsSync（同 cwd 最多 11 次→1 次）
let _artifactDirCache = { cwd: null, dir: null };

/**
 * 获取 artifact 文件的实际存储目录
 * 优先级：vault 有 artifact → vault | CWD 有 artifact → CWD | 新项目 → vault（默认）| 无 vault → CWD
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
  const syncedPath = path.join(cwd, '.pace', 'synced-plans');
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
    if (fs.existsSync(path.join(cwd, '.pace', 'disabled'))) return false;
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
    const paceDir = path.join(cwd, '.pace');
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
  const fp = path.join(cwd, '.pace', 'current-native-plan');
  try { return fs.readFileSync(fp, 'utf8').trim() || null; } catch(e) { return null; }
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
          if (Date.now() - stat.mtimeMs > 5000) {
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
  for (const [k, v] of Object.entries(fields)) {
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
  const bridgeSteps = `Read plan → 派 artifact-writer create-chg 创建 ${artPath}/changes/<id>.md 与 task.md / implementation_plan.md wikilink 索引；若 plan 已获用户确认并准备开始，再派 update-chg action=approve-and-start（需 approval-confirmed/source/evidence/task-id）。详见 /pace-bridge skill。`;
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
    keys.push(line.replace(/^- \[ \] /, '').trim());
  });
  return keys;
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
  return {
    ok,
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
    error: parsed.error || parsed.error_type || parsed.message || '',
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
  PACE_VERSION, CODE_EXTS, ARTIFACT_FILES, VAULT_PATH, ARTIFACT_ROOT_CHOICE_FILE,
  ARCHIVE_MARKER, ARCHIVE_PATTERN, COMPLETION_PHRASES,
  TODO_DRIFT_THRESHOLD, SKILL_DIRS, SESSION_SCOPED_FLAGS, SESSION_SCOPED_FLAG_PREFIXES, FORMAT_SNIPPETS, PLAN_DIRS,
  // 基础工具
  resolveProjectCwd, ts, todayISO, countCodeFiles, getProjectName, getProjectNameCandidates, normalizePath, displayDir,
  resolveToolFilePath, isArtifactRelativePath, artifactRelativePathForFile,
  // 项目检测与路径
  isPaceProject, isTeammate, isArtifactWriterAgentType, getArtifactDir, getProjectStateDir,
  getArtifactRootChoicePath, readArtifactRootChoice, getConfiguredArtifactDir,
  artifactRootChoiceNeeded, artifactRootChoiceMessage, artifactDirRuntimeHint, ensureProjectInfra,
  // 文件读写
  readActive, readFull, checkArchiveFormat, createTemplates, normalizeLineEndings,
  // 计划文件
  hasPlanFiles, listPlanFiles, hasUnsyncedPlanFiles, listUnsyncedPlanFiles,
  // 统计与检查
  countByStatus, extractOpenKeys, detectLegacyImplFormat,
  parseFrontmatter, detailPathForId, parseChangeIndex, readChangeDetail, extractTaskSection,
  countDetailTasks, classifyChange, getActiveChangeEntries, isChangeApproved, isChangeVerified, summarizeActiveChanges,
  // 外部集成
  scanRelatedNotes, getNativePlanPath, createLogger, logEntry, formatBridgeHint,
  // stdin 解析
  parseHookStdin, withStdinParsed, parseStdinSync,
};
