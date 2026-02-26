// pace-utils.js — PACE hooks 公共工具函数
// 多信号激活判断 + 懒创建模板 + .pace/disabled 豁免 + 任务状态统计
const fs = require('fs');
const path = require('path');

const PACE_VERSION = 'v4.6.0';
const CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte'];
const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
const VAULT_PATH = 'C:/Users/Xiao/OneDrive/Documents/Obsidian';

/** 统计 cwd 根目录下的代码文件数量 */
function countCodeFiles(cwd) {
  try {
    return fs.readdirSync(cwd).filter(f => CODE_EXTS.some(ext => f.endsWith(ext))).length;
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
 * 多信号 PACE 激活判断
 * @param {string} cwd - 当前工作目录
 * @returns {'artifact'|'superpowers'|'manual'|'code-count'|false}
 */
function isPaceProject(cwd) {
  try {
    // T-080: 豁免信号（最高优先级）— 用户主动禁用 PACE（.pace/disabled）
    if (fs.existsSync(path.join(cwd, '.pace', 'disabled'))) return false;
    // 信号 1（最强）：已有任何 PACE artifact 文件
    if (ARTIFACT_FILES.some(f => fs.existsSync(path.join(cwd, f)))) return 'artifact';
    // 信号 2（强）：Superpowers plan 文件
    if (hasPlanFiles(cwd)) return 'superpowers';
    // 信号 3（强）：手动激活标记
    if (fs.existsSync(path.join(cwd, '.pace-enabled'))) return 'manual';
    // 信号 4（弱/兜底）：3+ 代码文件（原有逻辑）
    if (countCodeFiles(cwd) >= 3) return 'code-count';
  } catch(e) {}
  return false;
}

/** 读取文件活跃区（<!-- ARCHIVE --> 上方内容） */
function readActive(cwd, filename) {
  const fp = path.join(cwd, filename);
  if (!fs.existsSync(fp)) return null;
  const content = fs.readFileSync(fp, 'utf8');
  const m = content.match(/^<!-- ARCHIVE -->$/m);
  return m ? content.slice(0, m.index) : content;
}

/** 读取文件全文 */
function readFull(cwd, filename) {
  const fp = path.join(cwd, filename);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, 'utf8');
}

/** 检查 ARCHIVE 标记格式，返回错误消息或 null */
function checkArchiveFormat(cwd, filename) {
  const content = readFull(cwd, filename);
  if (!content) return null;
  const hasCorrect = /^<!-- ARCHIVE -->$/m.test(content);
  const hasWrong = /^##\s*ARCHIVE/m.test(content) || /^#\s*ARCHIVE/m.test(content);
  if (hasWrong && !hasCorrect) return `${filename} 使用了错误的 ARCHIVE 标记格式（应为 <!-- ARCHIVE -->）`;
  return null;
}

/**
 * T-075: 从模板目录复制缺失的 artifact 文件到 cwd
 * @param {string} cwd - 当前工作目录
 * @returns {string[]} 创建的文件名列表
 */
function createTemplates(cwd) {
  const TEMPLATES_DIR = path.join(__dirname, 'templates');
  const created = [];
  for (const file of ARTIFACT_FILES) {
    const target = path.join(cwd, file);
    const tmpl = path.join(TEMPLATES_DIR, file);
    if (!fs.existsSync(target) && fs.existsSync(tmpl)) {
      fs.copyFileSync(tmpl, target);
      created.push(file);
    }
  }
  // 新项目自动创建 Obsidian Junction（模板首次创建时执行）
  if (created.length > 0 && VAULT_PATH) {
    try {
      const projectName = path.basename(cwd).toLowerCase().replace(/\s+/g, '-');
      const projectsDir = path.join(VAULT_PATH, 'projects');
      const junctionTarget = path.join(projectsDir, projectName);
      if (fs.existsSync(projectsDir) && !fs.existsSync(junctionTarget)) {
        require('child_process').execSync(`cmd /c mklink /J "${junctionTarget}" "${cwd}"`, { timeout: 5000 });
        created.push(`junction:projects/${projectName}`);
        // Home.md 追加项目入口
        const homePath = path.join(VAULT_PATH, 'Home.md');
        try {
          const home = fs.readFileSync(homePath, 'utf8');
          const displayName = path.basename(cwd);
          const entry = `- [[projects/${projectName}/spec|${displayName}]]`;
          if (!home.includes(`projects/${projectName}/`)) {
            const updated = home.replace(/\n## 酝酿中/, `${entry}\n\n## 酝酿中`);
            if (updated !== home) fs.writeFileSync(homePath, updated, 'utf8');
          }
        } catch(e2) {}
      }
    } catch(e) {}
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
 * @param {string} projectName - 当前项目名（小写连字符格式）
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
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
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

module.exports = { PACE_VERSION, CODE_EXTS, ARTIFACT_FILES, VAULT_PATH, countCodeFiles, hasPlanFiles, isPaceProject, readActive, readFull, checkArchiveFormat, createTemplates, countByStatus, scanRelatedNotes };
