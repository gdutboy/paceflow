// SessionStart hook v4.3.4：重置 Stop 计数器 + 多信号 PACE 检测创建模板 + 注入活跃区 + 跳过任务提醒
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, ARTIFACT_FILES, readFull } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();
const PACE_RUNTIME = path.join(cwd, '.pace');
const COUNTER_FILE = path.join(PACE_RUNTIME, 'stop-block-count');

// v4: 重置 Stop 防无限循环计数器 + 清除降级标记 + 确保 .pace/ 目录存在
try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
try { fs.writeFileSync(COUNTER_FILE, '0', 'utf8'); } catch(e) {}
try { const df = path.join(PACE_RUNTIME, 'degraded'); if (fs.existsSync(df)) fs.unlinkSync(df); } catch(e) {}

// v4.3: 多信号 PACE 检测（替换原有 codeFileCount >= 3）
const paceSignal = isPaceProject(cwd);
const files = ARTIFACT_FILES;

// 非 false 且非 'artifact'（已有文件不需重复创建）+ 无 task.md → 创建模板
if (paceSignal && paceSignal !== 'artifact' && !fs.existsSync(path.join(cwd, 'task.md'))) {
  const created = [];
  for (const file of files) {
    const target = path.join(cwd, file);
    const tmpl = path.join(TEMPLATES_DIR, file);
    if (!fs.existsSync(target) && fs.existsSync(tmpl)) {
      fs.copyFileSync(tmpl, target);
      created.push(file);
    }
  }
  if (created.length > 0) {
    log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: CREATE_TEMPLATES | signal: ${paceSignal} | files: ${created.join(', ')}\n`);
  }
}

// 提取活跃区注入上下文
const found = [];

for (const file of files) {
  const fp = path.join(cwd, file);
  if (!fs.existsSync(fp)) continue;

  // v4.3.4: 单次读取消除双重 I/O
  const full = readFull(cwd, file);
  if (!full) continue;

  process.stdout.write(`=== ${file} ===\n`);
  const archiveMatch = full.match(/^<!-- ARCHIVE -->$/m);
  const output = archiveMatch
    ? full.slice(0, archiveMatch.index) + '<!-- ARCHIVE -->\n'
    : full;
  process.stdout.write(output);
  process.stdout.write('\n\n');
  found.push(`${file}(${output.length})`);
}

// v4.3.1: 跨会话提醒 — 检测归档区中跳过的任务
const taskFp = path.join(cwd, 'task.md');
if (fs.existsSync(taskFp)) {
  try {
    const taskFull = fs.readFileSync(taskFp, 'utf8');
    const skipped = taskFull.match(/- \[-\] .+/g) || [];
    if (skipped.length > 0) {
      process.stdout.write(`\n=== 跨会话提醒 ===\ntask.md 有 ${skipped.length} 个跳过的任务（[-]），请检查是否已完成需更新为 [x]：\n`);
      skipped.slice(-3).forEach(t => process.stdout.write(`  ${t}\n`));
      process.stdout.write('\n');
      log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: SKIPPED_REMINDER | count: ${skipped.length}\n`);
    }
  } catch(e) {}
}

log(`[${ts()}] SessionStart | cwd: ${cwd}\n  action: INJECT | files: ${found.length ? found.join(', ') : '无 Artifact 文件'}\n  output→AI: (原始文本注入，共 ${found.length} 个文件)\n`);
