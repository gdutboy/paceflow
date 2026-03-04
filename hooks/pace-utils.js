// pace-utils.js — PACE hooks 公共工具函数
// 多信号激活判断 + 懒创建模板 + .pace/disabled 豁免 + 任务状态统计
const fs = require('fs');
const path = require('path');

const PACE_VERSION = 'v4.8.1';
const CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte'];
const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
const VAULT_PATH = process.env.PACE_VAULT_PATH || 'C:/Users/Xiao/OneDrive/Documents/Obsidian';

/** 检测当前进程是否为 Agent Teams teammate（环境变量 CLAUDE_CODE_TEAM_NAME 存在即为 teammate） */
function isTeammate() {
  return !!process.env.CLAUDE_CODE_TEAM_NAME;
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

/** 从 cwd 提取项目名（小写+连字符格式） */
function getProjectName(cwd) {
  // I-1: 空值/极端路径防御
  if (!cwd || cwd === '.' || cwd === '/' || cwd === '\\') return 'unknown-project';
  return path.basename(cwd).toLowerCase().replace(/\s+/g, '-');
}

/**
 * 获取 artifact 文件的实际存储目录
 * 优先级：vault 有 artifact → vault | CWD 有 artifact → CWD | 新项目 → vault（默认）| 无 vault → CWD
 * @param {string} cwd - 当前工作目录
 * @returns {string} artifact 目录路径
 */
function getArtifactDir(cwd) {
  if (!VAULT_PATH) return cwd;
  const vaultDir = path.join(VAULT_PATH, 'projects', getProjectName(cwd));
  try {
    // vault 有 artifact → vault（迁移后）
    if (fs.existsSync(vaultDir) &&
        ARTIFACT_FILES.some(f => fs.existsSync(path.join(vaultDir, f)))) {
      return vaultDir;
    }
  } catch(e) {}
  // CWD 有 artifact → CWD（未迁移项目，向后兼容）
  if (ARTIFACT_FILES.some(f => fs.existsSync(path.join(cwd, f)))) return cwd;
  // 新项目 → vault（默认目标）
  return vaultDir;
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
 * 检测 docs/plans/ 目录中是否有 Superpowers plan 文件
 * 匹配格式：YYYY-MM-DD-*.md（Superpowers 的命名约定）
 */
function hasPlanFiles(cwd) {
  const plansDir = path.join(cwd, 'docs', 'plans');
  try {
    if (!fs.existsSync(plansDir)) return false;
    return fs.readdirSync(plansDir).some(f => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f));
  } catch(e) { return false; }
}

/**
 * 列出 docs/plans/ 中的 Superpowers 计划文件（按日期降序）
 * @param {string} cwd - 项目根目录
 * @returns {string[]} 文件名列表（最新在前）
 */
function listPlanFiles(cwd) {
  const plansDir = path.join(cwd, 'docs', 'plans');
  try {
    if (!fs.existsSync(plansDir)) return [];
    return fs.readdirSync(plansDir)
      .filter(f => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f))
      .sort()
      .reverse();
  } catch(e) { return []; }
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
    // 信号 1（最强）：已有任何 PACE artifact 文件（CWD 或 vault）
    if (ARTIFACT_FILES.some(f => fs.existsSync(path.join(cwd, f)))) return 'artifact';
    if (VAULT_PATH) {
      const vaultDir = path.join(VAULT_PATH, 'projects', getProjectName(cwd));
      try {
        if (fs.existsSync(vaultDir) &&
            ARTIFACT_FILES.some(f => fs.existsSync(path.join(vaultDir, f)))) return 'artifact';
      } catch(e) {}
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

/** 读取文件活跃区（<!-- ARCHIVE --> 上方内容），artifact 文件自动解析 vault 目录 */
function readActive(cwd, filename) {
  const dir = ARTIFACT_FILES.includes(filename) ? getArtifactDir(cwd) : cwd;
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) return null;
  const content = fs.readFileSync(fp, 'utf8');
  const m = content.match(/^<!-- ARCHIVE -->$/m);
  return m ? content.slice(0, m.index) : content;
}

/** 读取文件全文，artifact 文件自动解析 vault 目录 */
function readFull(cwd, filename) {
  const dir = ARTIFACT_FILES.includes(filename) ? getArtifactDir(cwd) : cwd;
  const fp = path.join(dir, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf8');
}

/** 检查 ARCHIVE 标记格式，返回错误消息或 null */
function checkArchiveFormat(cwd, filename) {
  const content = readFull(cwd, filename);
  if (!content) return null;
  const hasCorrect = /^<!-- ARCHIVE -->$/m.test(content);
  // I-6: 匹配所有级别的错误标题格式（# ARCHIVE ~ ###### ARCHIVE）
  const hasWrong = /^#{1,6}\s+ARCHIVE/m.test(content);
  if (hasWrong && !hasCorrect) return `${filename} 使用了错误的 ARCHIVE 标记格式（应为 <!-- ARCHIVE -->）`;
  return null;
}

/**
 * 确保 PACE 项目基础设施就绪（幂等）
 * - .pace/.gitignore（运行时文件不入库）
 * - vault 项目目录存在（artifact 存储位置）
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
  // vault 项目目录
  if (!VAULT_PATH) return;
  try {
    const vaultDir = path.join(VAULT_PATH, 'projects', getProjectName(cwd));
    fs.mkdirSync(vaultDir, { recursive: true });
  } catch(e) {}
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
  const created = [];
  for (const file of ARTIFACT_FILES) {
    const target = path.join(artDir, file);
    const tmpl = path.join(TEMPLATES_DIR, file);
    if (!fs.existsSync(target) && fs.existsSync(tmpl)) {
      fs.copyFileSync(tmpl, target);
      created.push(file);
    }
  }
  return created;
}

/**
 * W2+O5: 统一任务状态统计（集中管理正则，消除跨文件不一致）
 * @param {string} text - 待统计的文本（通常是 task.md 活跃区）
 * @param {object} opts - 选项
 * @param {boolean} opts.topLevelOnly - true 时仅匹配行首顶层任务（^锚定），false 含子任务
 * @returns {{pending: number, done: number, total: number}}
 */
function countByStatus(text, { topLevelOnly = false } = {}) {
  const prefix = topLevelOnly ? '^' : '';
  const flags = topLevelOnly ? 'gm' : 'g';
  const pending = (text.match(new RegExp(`${prefix}- \\[[ /!]\\]`, flags)) || []).length;
  const done = (text.match(new RegExp(`${prefix}- \\[x\\]|${prefix}- \\[-\\]`, flags)) || []).length;
  return { pending, done, total: pending + done };
}

/**
 * 扫描 thoughts/ 和 knowledge/ 中与指定项目相关的笔记
 * 解析 frontmatter 的 projects/summary/status 字段，返回 L0 摘要
 * @param {string} projectName - 当前项目名（小写连字符格式，或由 getProjectName 生成）
 * @returns {Array<{title: string, summary: string, status: string}>}
 */
function scanRelatedNotes(projectName) {
  // W-1: VAULT_PATH 空值防御
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
          const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
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
          const summaryMatch = fm.match(/^summary:\s*"([^"]*)"/m);
          const summary = summaryMatch ? summaryMatch[1] : '';
          results.push({ title: file.replace(/\.md$/, ''), summary, status });
        } catch(e) { /* 单文件解析失败静默跳过 */ }
      }
    } catch(e) { /* 目录不可读静默跳过 */ }
  }
  return results;
}

const MAX_LOG_SIZE = 512 * 1024;
/**
 * 创建带日志轮转的 logger 函数（512KB 上限，超过截断保留后半）
 * @param {string} logPath - 日志文件路径
 * @returns {function(string): void}
 */
function createLogger(logPath) {
  return (msg) => {
    try {
      try {
        const stat = fs.statSync(logPath);
        if (stat.size > MAX_LOG_SIZE) {
          const content = fs.readFileSync(logPath, 'utf8');
          fs.writeFileSync(logPath, content.slice(content.length >> 1), 'utf8');
        }
      } catch(e) {}
      fs.appendFileSync(logPath, msg);
    } catch(e) {}
  };
}

module.exports = { PACE_VERSION, CODE_EXTS, ARTIFACT_FILES, VAULT_PATH, resolveProjectCwd, countCodeFiles, hasPlanFiles, listPlanFiles, isPaceProject, isTeammate, getProjectName, getArtifactDir, readActive, readFull, checkArchiveFormat, ensureProjectInfra, createTemplates, countByStatus, scanRelatedNotes, createLogger };
