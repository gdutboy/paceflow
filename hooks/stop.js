// Stop hook v4.3.8：有未完成项时 exit 2 阻止 Claude 停止 + 多信号检测 + 防无限循环
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, countCodeFiles, ARTIFACT_FILES, readActive, readFull, checkArchiveFormat } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const MAX_BLOCKS = 3; // 连续阻止超过此数后降级为软提醒
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();
const PACE_RUNTIME = path.join(cwd, '.pace');
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');
const warnings = [];

// 防无限循环：读取连续阻止计数
function getBlockCount() {
  try {
    if (fs.existsSync(COUNTER_FILE)) {
      return parseInt(fs.readFileSync(COUNTER_FILE, 'utf8').trim(), 10) || 0;
    }
  } catch(e) {}
  return 0;
}
function setBlockCount(n) {
  try { fs.writeFileSync(COUNTER_FILE, String(n), 'utf8'); } catch(e) {}
}

try {
// 检查 artifact 文件是否存在
const artifactFiles = ARTIFACT_FILES;
const existing = artifactFiles.filter(f => fs.existsSync(path.join(cwd, f)));

const taskActive = readActive(cwd, 'task.md');

if (taskActive) {
  // 0. 检查 ARCHIVE 格式
  const archFmt1 = checkArchiveFormat(cwd, 'task.md');
  if (archFmt1) warnings.push(archFmt1);
  const archFmt2 = checkArchiveFormat(cwd, 'implementation_plan.md');
  if (archFmt2) warnings.push(archFmt2);

  // 1. 检查未完成任务
  const pendingCount = (taskActive.match(/- \[[ \/!]\]/g) || []).length;
  if (pendingCount > 0) {
    warnings.push(`task.md 还有 ${pendingCount} 个未完成任务`);
  }

  // 2. 检查活跃区已完成项（W1 正则统一 + W7 V/归档优先级）
  const doneCount = (taskActive.match(/- \[x\]|- \[-\]/g) || []).length;
  const xCount = (taskActive.match(/- \[x\]/g) || []).length;
  if (xCount > 0) {
    if (!/^<!-- VERIFIED -->$/m.test(taskActive)) {
      // W7: 未验证时只报验证，不报归档
      warnings.push(`task.md 有 ${xCount} 个已完成任务但未验证，请先执行 V 阶段验证后添加 <!-- VERIFIED --> 标记`);
    } else if (doneCount > 0) {
      // W7: 已验证时只报归档
      warnings.push(`task.md 活跃区有 ${doneCount} 个已完成项已验证，请归档到 ARCHIVE 下方`);
    }
  } else if (doneCount > 0) {
    // 只有 [-] 跳过项，直接提醒归档
    warnings.push(`task.md 活跃区有 ${doneCount} 个已完成项未归档`);
  }

  // 3. 检查 implementation_plan.md 状态一致性
  const planActive = readActive(cwd, 'implementation_plan.md');
  if (planActive && pendingCount === 0 && doneCount > 0 && planActive.includes('🔄')) {
    warnings.push(`implementation_plan.md 仍有 🔄 进行中，但任务已全部完成`);
  }

  // 4. 检查 walkthrough.md
  const walkActive = readActive(cwd, 'walkthrough.md');
  if (walkActive && (doneCount > 0 || pendingCount > 0)) {
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
    const timeMatch = walkActive.match(/\*\*(?:追加)?时间\*\*:\s*(\d{4}-\d{2}-\d{2})/);
    const lastDate = timeMatch ? timeMatch[1] : null;
    if (lastDate && lastDate !== today) {
      warnings.push(`walkthrough.md 最近更新是 ${lastDate}，今天的工作尚未记录`);
    }
  } else if (!fs.existsSync(path.join(cwd, 'walkthrough.md'))) {
    warnings.push(`walkthrough.md 不存在，缺少工作记录`);
  }

} else if (existing.length > 0) {
  // task.md 不存在，但有其他 artifact → 不完整
  warnings.push(`检测到 ${existing.join(', ')} 但缺少 task.md，Artifact 不完整`);
} else {
  // 无任何 artifact：v4.3.5 多信号检测
  const paceSignal = isPaceProject(cwd);
  if (paceSignal === 'superpowers' || paceSignal === 'manual') {
    // T-078 D2 修复：无 artifact 时仅记录日志，不加入 warnings（不阻止退出）
    // 用户可能改主意不走 PACE 流程，此时 exit 2 阻止退出体验极差
    log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: SOFT_WARN | signal: ${paceSignal} | 无 artifact，仅记录不阻止\n`);
  } else {
    const codeCount = countCodeFiles(cwd);
    if (codeCount >= 3) {
      warnings.push(`检测到 ${codeCount} 个代码文件但无 Artifact 文件，可能需要 PACE 流程`);
    }
  }
}

if (warnings.length > 0) {
  const blockCount = getBlockCount();
  const checksDetail = warnings.map((w, i) => `  [${i+1}] ${w}`).join('\n');
  if (blockCount >= MAX_BLOCKS) {
    // v4.3.3: 降级时写入标记文件，让 PostToolUse 提醒 AI
    try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
    try { fs.writeFileSync(path.join(PACE_RUNTIME, 'degraded'), `降级时间: ${ts()}\n未通过检查:\n${checksDetail}\n`, 'utf8'); } catch(e) {}
    log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: DOWNGRADE (${blockCount}/${MAX_BLOCKS})\n  checks:\n${checksDetail}\n  note: 已写入 .pace/degraded\n`);
    // exit 0：不阻止，仅记录
  } else {
    // v4：exit 2 阻止 Claude 停止，stderr 反馈给 Claude
    setBlockCount(blockCount + 1);
    const stderrMsg = `PACE 检查未通过，请先修复：${warnings.join('；')}`;
    process.stderr.write(stderrMsg + '\n');
    log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: BLOCK (${blockCount + 1}/${MAX_BLOCKS})\n  checks:\n${checksDetail}\n  stderr→AI: ${stderrMsg}\n`);
    process.exit(2);
  }
} else {
  // 检查全部通过，重置计数器 + 清除降级标记
  setBlockCount(0);
  const degradedFile = path.join(PACE_RUNTIME, 'degraded');
  try { if (fs.existsSync(degradedFile)) fs.unlinkSync(degradedFile); } catch(e) {}

  // TodoWrite 残留检测：本会话用过 TodoWrite 且 task.md 无活跃任务 → 提醒清理
  const twFlag = path.join(PACE_RUNTIME, 'todowrite-used');
  if (fs.existsSync(twFlag) && taskActive) {
    const pendingNow = (taskActive.match(/- \[[ \/!]\]/g) || []).length;
    const doneNow = (taskActive.match(/- \[x\]|- \[-\]/g) || []).length;
    if (pendingNow === 0 && doneNow === 0) {
      // 清除 flag 避免重复 block
      try { fs.unlinkSync(twFlag); } catch(e) {}
      process.stderr.write(`task.md 无活跃任务，请确认 TodoWrite 已清空（如有残留请清理）\n`);
      log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: BLOCK | reason: TodoWrite 残留检测\n`);
      setBlockCount(1);
      process.exit(2);
    }
  }

  log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: PASS | checks: 全部通过\n`);
}
} catch(e) {
  try { log(`[${ts()}] Stop        | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
}
