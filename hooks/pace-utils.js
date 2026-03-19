// pace-utils.js — PACE hooks 公共工具函数
// 多信号激活判断 + 懒创建模板 + .pace/disabled 豁免 + 任务状态统计
const fs = require('fs');
const path = require('path');

const PACE_VERSION = 'v5.1.4';
const CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte'];
const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
const VAULT_PATH = process.env.PACE_VAULT_PATH || '';

// 归档标记常量——所有 hook 必须引用此常量，禁止硬编码字符串
const ARCHIVE_MARKER = '<!-- ARCHIVE -->';
const ARCHIVE_PATTERN = /^<!-- ARCHIVE -->$/m;

// 交叉验证：AI 声称完成时匹配的中文短语
const COMPLETION_PHRASES = /(?:任务完成|已完成所有|全部完成|归档完毕)/;

// TodoWrite 与 task.md 数量差异阈值（超过此值触发提醒）
const TODO_DRIFT_THRESHOLD = 3;

// v5.0.0: skill 目录名列表（install.js + verify.js 共用）
const SKILL_DIRS = [
  'pace-workflow',
  'artifact-management',
  'pace-knowledge',
  'pace-bridge',
  'paceflow-audit',
];

// T-328: 格式示例常量——供 DENY/Stop/HINT 消息内联引用，确定性最高+零 I/O
const FORMAT_SNIPPETS = {
  // task.md 任务条目格式
  taskEntry: '- [ ] T-NNN 任务标题',
  taskGroup: '### CHG-YYYYMMDD-NN: 变更标题\n\n<!-- APPROVED -->\n\n- [/] T-001 任务描述\n- [ ] T-002 任务描述',
  // impl_plan 索引条目格式（hook 检测正则：/^- \\[\\/\\]/m）
  implIndex: '- [/] CHG-YYYYMMDD-NN 标题 — 简要描述 #change [tasks:: T-NNN~T-NNN]',
  // T-426: impl_plan 详情 4 段结构（背景/范围/技术决策/任务分解）
  // T-438: 任务分解三要素（文件定位+改动意图+验收条件）
  // T-471: 追加位置前缀，消除"在哪里添加"的猜测
  implDetail: '在 ## 活跃变更详情 下方添加：\n### CHG-ID 标题\n\n**背景（Why）**：为什么做。\n**范围（What）**：~N 行，M 文件。\n**技术决策（How）**：方案选择及理由。\n\n**T-NNN 任务标题**：\n  - `file:line` — 当前行为 → 目标行为\n  - 验收：完成条件',
  // 标记位置
  approved: '<!-- APPROVED --> 放在 task.md 活跃区的 CHG 分组标题下方、任务列表上方',
  // T-471: 追加验证定义，防止 AI 自签不运行验证
  verified: '<!-- VERIFIED --> 放在 <!-- APPROVED --> 下方。V 阶段验证 = 通过 Terminal 运行测试或 Browser 确认功能正确且无报错后添加此标记',
  // checkbox 状态说明
  statusHelp: '[ ] 未开始 | [/] 进行中 | [x] 完成 | [!] 阻塞 | [-] 跳过',
  // 变更状态说明（impl_plan 专用，与 statusHelp 是独立术语）
  changeStatusHelp: '[ ] 规划中 | [/] 进行中 | [x] 完成 | [-] 废弃 | [!] 暂停',
  // 格式要求（E 阶段 DENY 核心信息）
  formatRule: 'hook 检测格式为行首 "- [/] "（Markdown checkbox），表格或 emoji 格式无法识别',
  // 归档操作（T-441: 移动标记而非内容）
  archiveOp: '归档 = 移动标记而非内容：Step 1 在待归档内容上方插入新 <!-- ARCHIVE -->，Step 2 删除旧 <!-- ARCHIVE -->',
  // findings/walkthrough 格式（compact 恢复注入用）
  findingsFormat: '- [状态] 标题 — 结论 #finding [date:: YYYY-MM-DD] [change:: CHG-ID] [knowledge:: slug]，索引+详情(### [日期] 标题)缺一不可',
  // T-480: 从 3 个词扩展为 4 必须要素（现象+根因+影响范围+建议方案），自动覆盖 B-10/W-14
  findingsDetail: '在 ## 未解决问题 下添加：\n### [YYYY-MM-DD] 标题\n\n> **发现时间**: YYYY-MM-DDTHH:mm:ss+08:00 | **影响**: P0-P3\n\n**现象**：哪个文件哪一行出了什么问题\n**根因**：问题代码是什么，为什么错\n**影响范围**：影响多大，是否阻塞\n**建议方案**：怎么修，改哪些文件',
  // T-471: 新增详情段落格式（7 处引用，P0 修复 walkthrough 遗漏）
  walkthroughDetail: '## YYYY-MM-DD CHG-ID 摘要\n**T-NNN 任务标题**\n- 改动：`file`:`line`，改动意图\n- 验证：Terminal/Browser 运行结果（通过/失败+原因）',
  // Skill 引用
  skillRef: '格式参考：paceflow:artifact-management skill',
};

// 会话级 flag 文件集中管理（session-start 重置用）
const SESSION_SCOPED_FLAGS = [
  'degraded',                    // stop.js 降级标记（3 次 block 后静默放行）
  'todowrite-used',              // todowrite-sync.js 标记（本会话已使用 TodoWrite）
  'archive-reminded',            // post-tool-use.js H3（task.md 归档提醒，每会话一次）
  'findings-reminded',           // post-tool-use.js H7（findings ⚠️ 提醒，每会话一次）
  'impl-archive-reminded',       // post-tool-use.js H10（impl_plan 归档提醒，每会话一次）
  'cli-refresh-done',            // post-tool-use.js H12（Obsidian CLI 索引刷新标记）
  'walkthrough-archive-reminded', // post-tool-use.js（walkthrough 详情>3 归档提醒）
  'findings-archive-reminded',   // post-tool-use.js（findings 已解决详情归档提醒）
];

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

/** 从 cwd 提取项目名（小写+连字符格式） */
function getProjectName(cwd) {
  // I-1: 空值/极端路径防御
  if (!cwd || cwd === '.' || cwd === '/' || cwd === '\\') return 'unknown-project';
  // W-code-3: Windows 盘符根路径守卫（path.basename('C:\\') 返回空字符串）
  if (/^[A-Z]:\\\\?$/i.test(cwd)) return 'unknown-project';
  const name = path.basename(cwd).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return name || 'unknown-project';
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
  // T-422: VAULT_PATH 空值守卫 — 无 vault 时跳过 vault 分支，直接走 CWD 路径
  if (VAULT_PATH) {
    const vaultDir = path.join(VAULT_PATH, 'projects', getProjectName(cwd));
    try {
      // vault 有 artifact → vault（迁移后）
      if (fs.existsSync(vaultDir) &&
          ARTIFACT_FILES.some(f => fs.existsSync(path.join(vaultDir, f)))) {
        result = vaultDir;
        _artifactDirCache = { cwd, dir: result };
        return result;
      }
    } catch(e) {}
  }
  // CWD 有 artifact → CWD（未迁移项目，向后兼容）
  if (ARTIFACT_FILES.some(f => fs.existsSync(path.join(cwd, f)))) {
    _artifactDirCache = { cwd, dir: cwd };
    return cwd;
  }
  // 新项目 → vault（有 VAULT_PATH 时）或 CWD（无 VAULT_PATH）
  result = VAULT_PATH ? path.join(VAULT_PATH, 'projects', getProjectName(cwd)) : cwd;
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

/**
 * 列出所有 Superpowers 计划文件（按日期降序），扫描 PLAN_DIRS 双路径
 * @param {string} cwd - 项目根目录
 * @returns {{name: string, dir: string}[]} 文件信息列表（name=文件名, dir=所在相对目录路径）
 */
function listPlanFiles(cwd) {
  const results = [];
  const seen = new Set();
  for (const rel of PLAN_DIRS) {
    const dir = path.join(cwd, ...rel.split('/'));
    try {
      for (const f of fs.readdirSync(dir)) {
        if (/^\d{4}-\d{2}-\d{2}-.+\.md$/.test(f) && !seen.has(f)) {
          seen.add(f);
          results.push({ name: f, dir: rel });
        }
      }
    } catch(e) {}
  }
  return results.sort((a, b) => b.name.localeCompare(a.name));
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
    // 信号 1（最强）：已有任何 PACE artifact 文件（CWD 或 vault）
    if (ARTIFACT_FILES.some(f => fs.existsSync(path.join(cwd, f)))) return 'artifact';
    // T-422: VAULT_PATH 空值守卫 — 无 vault 时跳过 vault 信号检查
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
  // vault 项目目录（T-422: 无 VAULT_PATH 时跳过）
  if (VAULT_PATH) {
    try {
      const vaultDir = path.join(VAULT_PATH, 'projects', getProjectName(cwd));
      fs.mkdirSync(vaultDir, { recursive: true });
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
  const created = [];
  for (const file of ARTIFACT_FILES) {
    const target = path.join(artDir, file);
    const tmpl = path.join(TEMPLATES_DIR, file);
    if (!fs.existsSync(target) && fs.existsSync(tmpl)) {
      try {
        fs.copyFileSync(tmpl, target);
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
 * 检查 impl_plan 全文中所有 [x] 索引是否有对应 ### CHG-ID 详情段落
 * @param {string} planFull - implementation_plan.md 全文
 * @returns {string[]} 缺少详情的 CHG/HOTFIX-ID 列表
 */
function findMissingImplDetails(planFull) {
  if (!planFull) return [];
  const doneIndex = planFull.match(/^- \[x\] ((?:CHG|HOTFIX)-\d{8}-\d{2})/gm) || [];
  if (doneIndex.length === 0) return [];
  return doneIndex
    .map(m => m.match(/((?:CHG|HOTFIX)-\d{8}-\d{2})/)[0])
    .filter(id => {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return !new RegExp(`^### ${escaped}`, 'm').test(planFull);
    });
}

/**
 * 检查 findings.md 全文中 [ ] 索引是否有对应 ### 详情段落
 * 匹配规则：索引标题全文在详情 ### 行中子串匹配
 * @param {string} findingsFull - findings.md 全文
 * @returns {string[]} 缺少详情的标题列表
 */
function findMissingFindingsDetails(findingsFull) {
  if (!findingsFull) return [];
  const unresolved = findingsFull.match(/^- \[ \] ([^—\n]+)/gm) || [];
  if (unresolved.length === 0) return [];
  const detailHeaders = (findingsFull.match(/^### .+$/gm) || [])
    .map(h => h.replace(/^### (\[\d{4}-\d{2}-\d{2}\] )?/, ''));
  const missing = [];
  for (const line of unresolved) {
    const title = line.replace(/^- \[ \] /, '').trim();
    if (!detailHeaders.some(dt => dt.includes(title))) {
      missing.push(title);
    }
  }
  return missing;
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
    try {
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
    } catch(e) {}
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
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${v}`);
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
  const bridgeSteps = `Read plan → Edit ${artPath}/task.md 添加任务 + APPROVED → Edit ${artPath}/implementation_plan.md 添加 CHG 索引。详见 /pace-bridge skill。`;
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

/** W-6: 从 Edit old/new string 中提取本次新标为 [x] 的 CHG/HOTFIX ID */
function extractNewlyCompletedChgs(oldString, newString) {
  const newDone = (newString.match(/^- \[x\] ((?:CHG|HOTFIX)-\d{8}-\d{2})/gm) || [])
    .map(m => m.match(/((?:CHG|HOTFIX)-\d{8}-\d{2})/)[0]);
  const oldDone = new Set((oldString.match(/^- \[x\] ((?:CHG|HOTFIX)-\d{8}-\d{2})/gm) || [])
    .map(m => m.match(/((?:CHG|HOTFIX)-\d{8}-\d{2})/)[0]));
  return newDone.filter(id => !oldDone.has(id));
}

// S-1: 统一 stdin 解析 — 替换 6 个 hook 的重复 JSON.parse 模板
/**
 * 解析 hook stdin 原始输入，返回统一结构（内部 try-catch，永不抛异常）
 * @param {string} rawInput - stdin 原始文本
 * @returns {{ ok: boolean, toolName: string, filePath: string, oldString: string, newString: string, content: string, toolInput: object, type: string, lastMessage: string, raw: object }}
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
    lastMessage: parsed.last_assistant_message || '',
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
 * @returns {{ ok: boolean, toolName: string, filePath: string, oldString: string, newString: string, content: string, toolInput: object, type: string, lastMessage: string, raw: object }}
 */
function parseStdinSync() {
  try { return parseHookStdin(fs.readFileSync(0, 'utf8')); }
  catch(e) { return parseHookStdin(''); }
}

// I-04: 多行格式按功能分组，便于 diff 审阅
module.exports = {
  // 常量
  PACE_VERSION, CODE_EXTS, ARTIFACT_FILES, VAULT_PATH,
  ARCHIVE_MARKER, ARCHIVE_PATTERN, COMPLETION_PHRASES,
  TODO_DRIFT_THRESHOLD, SKILL_DIRS, SESSION_SCOPED_FLAGS, FORMAT_SNIPPETS, PLAN_DIRS,
  // 基础工具
  resolveProjectCwd, ts, todayISO, countCodeFiles, getProjectName, normalizePath,
  // 项目检测与路径
  isPaceProject, isTeammate, getArtifactDir, ensureProjectInfra,
  // 文件读写
  readActive, readFull, checkArchiveFormat, createTemplates,
  // 计划文件
  hasPlanFiles, listPlanFiles, hasUnsyncedPlanFiles, listUnsyncedPlanFiles,
  // 统计与检查
  countByStatus, findMissingImplDetails, findMissingFindingsDetails, extractOpenKeys, detectLegacyImplFormat, extractNewlyCompletedChgs,
  // 外部集成
  scanRelatedNotes, getNativePlanPath, createLogger, logEntry, formatBridgeHint,
  // stdin 解析
  parseHookStdin, withStdinParsed, parseStdinSync,
};
