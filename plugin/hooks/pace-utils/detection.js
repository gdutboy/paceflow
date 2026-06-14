// detection.js — v5/v6 项目布局检测原语（CHG-20260614-11）
//
// 把 hasChangesDir + legacyV5FilesInDir 从门面 pace-utils.js 与 pace-utils/path-utils.js
// 两份逐字重复实现下沉为单一来源，消除「改一侧忘改另一侧」致激活层（path-utils 驱动写码门）
// 与提示层（门面驱动 v5 布局提示）静默分叉的漂移风险。
// 纯 leaf 模块：只依赖 fs + path，无内部依赖，门面与 path-utils 均 require 此处共享同一份。
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 目录下是否存在 changes/ 子目录（v6 项目信号）。
 * @param {string} dir - 待检测目录
 * @returns {boolean}
 */
function hasChangesDir(dir) {
  // PU-002：用 isDirectory 区分目录与同名文件，避免同名文件 changes（非目录）被误判为 PACE 项目
  try { return !!dir && fs.statSync(path.join(dir, 'changes')).isDirectory(); } catch(e) { return false; }
}

/**
 * 检测 v5 时代布局（task.md 含活跃详情、无 changes/）的根文件清单。
 * 有 changes/ 子目录即非 v5（返回 []）。先按签名正则检测中文/带 ARCHIVE 的根文件；
 * 再对「英文双根 + checkbox 行」的极简 v5 fixture 做双根兜底（要求 task.md 与
 * implementation_plan.md 双根都命中，避免 generic todo 列表误判为 v5）。
 * @param {string} dir - 待检测目录
 * @returns {string[]} 命中的 v5 根文件名清单（空数组表示非 v5）
 */
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

module.exports = { hasChangesDir, legacyV5FilesInDir };
