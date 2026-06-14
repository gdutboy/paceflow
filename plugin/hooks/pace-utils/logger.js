const fs = require('fs');
const path = require('path');
const { ts } = require('./path-utils');
const { currentSessionId } = require('./session');

const MAX_LOG_SIZE = 1024 * 1024;
const LOGGER_LOCK_STALE_MS = 30 * 1000;

/**
 * 默认日志路径。可被 PACE_LOG_PATH 覆盖——e2e 每轮注入独立 tmp 日志，杜绝写源码树
 * plugin/hooks/pace-hooks.log（跨进程共享致 1MB 砍半的结构性 flaky 根因）。缺省回退
 * plugin/hooks/pace-hooks.log（本模块在 pace-utils/ 子目录，故上跳一级）。
 * 各 hook 用 createLogger() 空参即享此默认，env 逻辑集中此一处不在调用方重复。
 * @returns {string} 日志文件绝对路径
 */
function defaultLogPath() {
  return process.env.PACE_LOG_PATH || path.join(__dirname, '..', 'pace-hooks.log');
}

function createLogger(logPath) {
  const target = logPath || defaultLogPath();
  return (msg) => {
    let lockFd = null;
    const lockPath = `${target}.lock`;
    try {
      try {
        lockFd = fs.openSync(lockPath, 'wx');
      } catch(e) {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > LOGGER_LOCK_STALE_MS) {
            fs.unlinkSync(lockPath);
            lockFd = fs.openSync(lockPath, 'wx');
          }
        } catch(e2) {}
      }
      if (lockFd === null) {
        // Avoid torn log lines under contention. Logs are diagnostic only; a
        // later hook call will write once the lock is free or stale-cleared.
        return;
      }
      try {
        const stat = fs.statSync(target);
        if (stat.size > MAX_LOG_SIZE) {
          const buf = fs.readFileSync(target);
          const half = buf.slice(buf.length >> 1);
          const nlIdx = half.indexOf(10);
          fs.writeFileSync(target, nlIdx >= 0 ? half.slice(nlIdx + 1) : half);
        }
      } catch(e) {}
      fs.appendFileSync(target, msg);
    } catch(e) {
    } finally {
      if (lockFd !== null) {
        try { fs.closeSync(lockFd); } catch(e) {}
        try { fs.unlinkSync(lockPath); } catch(e) {}
      }
    }
  };
}

function logEntry(hook, action, fields = {}) {
  const parts = [`[${ts()}] ${hook.padEnd(11)} | act=${action}`];
  const merged = { sid: currentSessionId(), ...fields };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === null || v === '') continue;
    let value = String(v)
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, ' ')
      .replace(/\|/g, '/');
    if (value.length > 1000) value = value.slice(0, 997) + '...';
    parts.push(`${k}=${value}`);
  }
  return parts.join(' | ') + '\n';
}

module.exports = {
  createLogger,
  defaultLogPath,
  logEntry,
};
