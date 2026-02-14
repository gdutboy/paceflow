// pace-utils.js — PACE hooks 公共工具函数
// 多信号激活判断 + 懒创建模板 + .pace/disabled 豁免 + 任务状态统计
const fs = require('fs');
const path = require('path');

const PACE_VERSION = 'v4.4.0';
const CODE_EXTS = ['.ts', '.js', '.py', '.go', '.rs', '.java', '.tsx', '.jsx', '.vue', '.svelte'];
const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];

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

module.exports = { PACE_VERSION, CODE_EXTS, ARTIFACT_FILES, countCodeFiles, hasPlanFiles, isPaceProject, readActive, readFull, checkArchiveFormat, createTemplates, countByStatus };
