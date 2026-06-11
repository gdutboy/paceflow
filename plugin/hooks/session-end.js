// SessionEnd hook（CHG-20260611-02）：session 正常结束时把本 session 持有的活跃 change-owner
// 记录降级 state: detached——重开 session 见 detached 即知原 session 已关闭、CHG 可接手；
// crash 不触发本 hook，由 CHANGE_OWNER_TTL_MS（30min）转 sibling-stale 兜底。不阻断、不输出。
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch (e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const log = paceUtils.createLogger(path.join(__dirname, 'pace-hooks.log'));

paceUtils.withStdinParsed((stdin) => {
  try {
    const cwd = paceUtils.resolveProjectCwd();
    if (!paceUtils.isPaceProject(cwd) || !stdin.sessionId) return;
    const detached = paceUtils.detachChangeOwnersForSession(cwd, { sessionId: stdin.sessionId });
    // CHG-20260611-03：session 级 pause 随 session 结束自动失效。
    const pauseCleared = paceUtils.clearSessionPause(cwd, stdin.sessionId);
    if (detached.length > 0 || pauseCleared) {
      log(paceUtils.logEntry('SessionEnd', 'DETACH_OWNERS', {
        proj: paceUtils.getProjectName(cwd),
        changes: detached.join(',') || '-',
        pause_cleared: pauseCleared ? '1' : '0',
      }));
    }
  } catch (e) {
    log(paceUtils.logEntry('SessionEnd', 'ERROR', { error: e.message }));
  }
});
