// SessionStart hook v4.3.8：重置 Stop 计数器 + 多信号 PACE 检测创建模板 + 注入活跃区 + 跳过任务提醒 + TodoWrite 同步
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, ARTIFACT_FILES, readFull, createTemplates } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();
const PACE_RUNTIME = path.join(cwd, '.pace');
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');

// v4: 重置 Stop 防无限循环计数器 + 清除降级标记 + 确保 .pace/ 目录存在
try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
try { fs.writeFileSync(COUNTER_FILE, '0', 'utf8'); } catch(e) {}
try { const df = path.join(PACE_RUNTIME, 'degraded'); if (fs.existsSync(df)) fs.unlinkSync(df); } catch(e) {}
try { const tw = path.join(PACE_RUNTIME, 'todowrite-used'); if (fs.existsSync(tw)) fs.unlinkSync(tw); } catch(e) {}

// v4.3: 多信号 PACE 检测（替换原有 codeFileCount >= 3）
const paceSignal = isPaceProject(cwd);
const files = ARTIFACT_FILES;

// T-077: 非 false 且非 'artifact'（已有文件不需重复创建）+ 无 task.md → 复用公共函数创建模板
if (paceSignal && paceSignal !== 'artifact' && !fs.existsSync(path.join(cwd, 'task.md'))) {
  const created = createTemplates(cwd);
  if (created.length > 0) {
    log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: CREATE_TEMPLATES | signal: ${paceSignal} | files: ${created.join(', ')}\n`);
  }
}

// 提取活跃区注入上下文（缓存 task.md 全文供后续复用）
const found = [];
let taskFullCached = null;

for (const file of files) {
  const fp = path.join(cwd, file);
  if (!fs.existsSync(fp)) continue;

  // v4.3.4: 单次读取消除双重 I/O
  const full = readFull(cwd, file);
  if (!full) continue;

  // 缓存 task.md 全文
  if (file === 'task.md') taskFullCached = full;

  process.stdout.write(`=== ${file} ===\n`);
  const archiveMatch = full.match(/^<!-- ARCHIVE -->$/m);
  const output = archiveMatch
    ? full.slice(0, archiveMatch.index) + '<!-- ARCHIVE -->\n'
    : full;
  process.stdout.write(output);
  process.stdout.write('\n\n');
  found.push(`${file}(${output.length})`);
}

// v4.3.1: 跨会话提醒 — 检测归档区中跳过的任务（复用缓存）
const taskFp = path.join(cwd, 'task.md');
if (!taskFullCached && fs.existsSync(taskFp)) {
  try { taskFullCached = fs.readFileSync(taskFp, 'utf8'); } catch(e) {}
}
if (taskFullCached) {
  try {
    // 提前计算 ARCHIVE 分割点（W3 跳过扫描 + 方案 A 共用）
    const archMatch = taskFullCached.match(/^<!-- ARCHIVE -->$/m);
    const active = archMatch ? taskFullCached.slice(0, archMatch.index) : taskFullCached;

    // W3: 只扫描活跃区的跳过任务（避免已归档的历史 [-] 项永久计入提醒）
    const skipped = active.match(/- \[-\] .+/g) || [];
    if (skipped.length > 0) {
      process.stdout.write(`\n=== 跨会话提醒 ===\ntask.md 有 ${skipped.length} 个跳过的任务（[-]），请检查是否已完成需更新为 [x]：\n`);
      skipped.slice(-3).forEach(t => process.stdout.write(`  ${t}\n`));
      process.stdout.write('\n');
      log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: SKIPPED_REMINDER | count: ${skipped.length}\n`);
    }

    // v4.3.6 方案 A：TodoWrite 同步指令注入（复用 active）
    const hasPending = /- \[[ \/!]\]/.test(active);
    const hasCompleted = /- \[[x\-]\]/.test(active);
    if (hasPending) {
      process.stdout.write(`\n=== TodoWrite 同步 ===\n⚠️ task.md 是任务权威来源。TodoWrite 与 task.md 冲突时，以 task.md 为准。\n请用 TodoWrite 创建与 task.md 活跃任务对应的 todo 项。\n\n`);
      log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: TODOWRITE_SYNC | 有活跃任务，提醒同步 TodoWrite\n`);
    } else if (hasCompleted) {
      process.stdout.write(`\n=== TodoWrite 同步 ===\ntask.md 活跃区有已完成/跳过任务待归档，无进行中任务。归档后再清空 TodoWrite。\n\n`);
      log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: TODOWRITE_SYNC | 有完成未归档，提醒归档后清空\n`);
    } else {
      process.stdout.write(`\n=== TodoWrite 同步 ===\ntask.md 无活跃任务。如 TodoWrite 仍有残留项，请清空。\n\n`);
      log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: TODOWRITE_SYNC | 无活跃任务，提醒清空 TodoWrite\n`);
    }
  } catch(e) {}
}

log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: INJECT | files: ${found.length ? found.join(', ') : '无 Artifact 文件'}\n  output→AI: (原始文本注入，共 ${found.length} 个文件)\n`);
