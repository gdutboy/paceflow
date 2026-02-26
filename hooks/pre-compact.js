// PreCompact hook：compact 前收集 artifact 状态快照，供 session-start.js compact 恢复使用
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, readActive, countByStatus } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();
const PACE_RUNTIME = path.join(cwd, '.pace');

try {
  const paceSignal = isPaceProject(cwd);
  if (!paceSignal) process.exit(0);

  const snapshot = { timestamp: new Date().toISOString(), artifacts: {} };

  // 收集 task.md 状态
  const taskActive = readActive(cwd, 'task.md');
  if (taskActive) {
    const { pending, done } = countByStatus(taskActive, { topLevelOnly: true });
    const inProgress = (taskActive.match(/^- \[\/\] .+$/gm) || []);
    snapshot.artifacts['task.md'] = { pending, done, inProgress };
  }

  // 收集 implementation_plan.md 状态
  const planActive = readActive(cwd, 'implementation_plan.md');
  if (planActive) {
    snapshot.artifacts['implementation_plan.md'] = {
      hasInProgress: /^- \[\/\]/m.test(planActive)
    };
  }

  // 收集运行时状态
  snapshot.runtime = {
    degraded: fs.existsSync(path.join(PACE_RUNTIME, 'degraded')),
    todowriteUsed: fs.existsSync(path.join(PACE_RUNTIME, 'todowrite-used'))
  };

  // 写入快照文件
  fs.mkdirSync(PACE_RUNTIME, { recursive: true });
  fs.writeFileSync(path.join(PACE_RUNTIME, 'pre-compact-state.json'), JSON.stringify(snapshot, null, 2), 'utf8');

  log(`[${ts()}] PreCompact  | cwd: ${cwd}\n  action: SNAPSHOT | tasks: ${taskActive ? 'yes' : 'no'} | plan: ${planActive ? 'yes' : 'no'}\n`);
} catch(e) {
  try { log(`[${ts()}] PreCompact  | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
}
