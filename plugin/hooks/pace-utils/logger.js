const fs = require('fs');
const { ts } = require('./path-utils');
const { currentSessionId } = require('./session');

const MAX_LOG_SIZE = 1024 * 1024;
const LOGGER_LOCK_STALE_MS = 30 * 1000;

function createLogger(logPath) {
  return (msg) => {
    let lockFd = null;
    const lockPath = `${logPath}.lock`;
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
        fs.appendFileSync(logPath, msg);
        return;
      }
      try {
        const stat = fs.statSync(logPath);
        if (stat.size > MAX_LOG_SIZE) {
          const buf = fs.readFileSync(logPath);
          const half = buf.slice(buf.length >> 1);
          const nlIdx = half.indexOf(10);
          fs.writeFileSync(logPath, nlIdx >= 0 ? half.slice(nlIdx + 1) : half);
        }
      } catch(e) {}
      fs.appendFileSync(logPath, msg);
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
  logEntry,
};
