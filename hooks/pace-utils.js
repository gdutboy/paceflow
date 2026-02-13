// pace-utils.js — PACE hooks 公共工具函数（v4.3.4）
// 多信号激活判断，解决空项目 Superpowers 流程中 PACE 无法激活的问题
const fs = require('fs');
const path = require('path');

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

module.exports = { CODE_EXTS, ARTIFACT_FILES, countCodeFiles, hasPlanFiles, isPaceProject, readActive, readFull, checkArchiveFormat };
