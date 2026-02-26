// TaskCompleted hook：任务完成时检查 walkthrough/VERIFIED/findings
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, readActive } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();

try {
  const paceSignal = isPaceProject(cwd);
  if (!paceSignal) process.exit(0);

  const warnings = [];

  // 1. walkthrough.md 今日日期记录
  const walkActive = readActive(cwd, 'walkthrough.md');
  if (walkActive) {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const timeMatch = walkActive.match(/\*\*(?:追加)?时间\*\*:\s*(\d{4}-\d{2}-\d{2})/);
    const lastDate = timeMatch ? timeMatch[1] : null;
    if (!lastDate || lastDate !== today) {
      warnings.push(`walkthrough.md 未记录今天(${today})的工作`);
    }
  } else if (!fs.existsSync(path.join(cwd, 'walkthrough.md'))) {
    warnings.push('walkthrough.md 不存在');
  }

  // 2. task.md 有 [x] 但无 <!-- VERIFIED -->
  const taskActive = readActive(cwd, 'task.md');
  if (taskActive) {
    const xCount = (taskActive.match(/^- \[x\]/gm) || []).length;
    if (xCount > 0 && !/^<!-- VERIFIED -->$/m.test(taskActive)) {
      warnings.push(`task.md 有 ${xCount} 个已完成任务但未添加 <!-- VERIFIED --> 标记`);
    }
  }

  // 3. findings.md 有 ⚠️
  const findingsActive = readActive(cwd, 'findings.md');
  if (findingsActive) {
    const unresolved = (findingsActive.match(/⚠️/g) || []).length;
    if (unresolved > 0) {
      warnings.push(`findings.md 有 ${unresolved} 个未解决问题（⚠️）`);
    }
  }

  if (warnings.length > 0) {
    const stderrMsg = `PACE 任务完成检查未通过: ${warnings.join('; ')}`;
    process.stderr.write(stderrMsg + '\n');
    log(`[${ts()}] TaskCompleted | cwd: ${cwd}\n  action: BLOCK | checks: ${warnings.join('; ')}\n`);
    process.exit(2);
  }
  // PASS: 不记录日志
} catch(e) {
  try { log(`[${ts()}] TaskCompleted | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
}
