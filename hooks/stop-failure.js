// stop-failure.js — StopFailure hook：API 错误中断时记录事件日志（logging-only）
// CC v2.1.78 新增事件，文档缺失(#35620)，仅做日志记录不依赖关键路径
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, getProjectName, resolveProjectCwd, ts, createLogger, logEntry } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const log = createLogger(LOG);
const cwd = resolveProjectCwd();
const proj = getProjectName(cwd);

// 非 PACE 项目跳过
if (!isPaceProject(cwd)) {
  process.exit(0);
}

try {
  const t0 = Date.now();
  const stdin = paceUtils.parseStdinSync();

  // 记录 API 错误事件到日志
  const errorType = stdin.raw.error_type || stdin.raw.error || 'unknown';
  const stopReason = stdin.raw.stop_reason || stdin.raw.stopReason || '';

  log(logEntry('StopFailure', 'ENTRY', {
    proj,
    error: errorType,
    reason: stopReason,
    dur: Date.now() - t0
  }));
} catch(e) {
  try { log(logEntry('StopFailure', 'ERROR', { proj, error: e.message })); } catch(e2) {}
}
