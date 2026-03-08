// PreCompact hook：compact 前收集 artifact 状态快照，供 session-start.js compact 恢复使用
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { ts, isPaceProject, readActive, countByStatus } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
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

  // I-5: 收集运行时状态（含 blockCount 供 compact 恢复判断降级进度）
  const blockCountFile = path.join(PACE_RUNTIME, 'stop-block-count');
  let blockCount = 0;
  try { blockCount = parseInt(fs.readFileSync(blockCountFile, 'utf8').trim(), 10) || 0; } catch(e) {}
  snapshot.runtime = {
    degraded: fs.existsSync(path.join(PACE_RUNTIME, 'degraded')),
    todowriteUsed: fs.existsSync(path.join(PACE_RUNTIME, 'todowrite-used')),
    blockCount
  };

  // v5.0.2: 快照扩展 findings + walkthrough 状态
  try {
    const findingsActive = readActive(cwd, 'findings.md');
    if (findingsActive) {
      const openCount = (findingsActive.match(/^- \[ \] /gm) || []).length;
      const warningCount = (findingsActive.match(/⚠️/g) || []).length;
      snapshot.findings = { openCount, warningCount };
    }
  } catch(e) {}
  try {
    const walkActive = readActive(cwd, 'walkthrough.md');
    if (walkActive) {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
      const hasTodayEntry = walkActive.includes(today);
      snapshot.walkthrough = { hasTodayEntry };
    }
  } catch(e) {}

  // v5.0.1: 捕获 native plan 文件路径（AI 未主动记录时的兜底）
  // I-5: HOME/USERPROFILE 都不存在时跳过检测
  const HOME = process.env.HOME || process.env.USERPROFILE;
  if (HOME) {
    const nativePlansDir = path.join(HOME, '.claude', 'plans');
    try {
      if (fs.existsSync(nativePlansDir)) {
        const now = Date.now();
        const recentPlans = fs.readdirSync(nativePlansDir)
          .filter(f => f.endsWith('.md'))
          .map(f => {
            try {
              const fp = path.join(nativePlansDir, f);
              const mtime = fs.statSync(fp).mtimeMs;
              return (now - mtime) < 3600000 ? { path: fp.replace(/\\/g, '/'), mtime } : null;
            } catch(e) { return null; }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime - a.mtime);
        if (recentPlans.length > 0) {
          snapshot.nativePlans = recentPlans.map(e => e.path);
          // T-326: 自动写入最近的 native plan 路径到 .pace/current-native-plan
          try {
            fs.writeFileSync(path.join(PACE_RUNTIME, 'current-native-plan'), recentPlans[0].path, 'utf8');
          } catch(e) {}
        }
      }
    } catch(e) {}
  }

  // 写入快照文件
  fs.mkdirSync(PACE_RUNTIME, { recursive: true });
  fs.writeFileSync(path.join(PACE_RUNTIME, 'pre-compact-state.json'), JSON.stringify(snapshot, null, 2), 'utf8');

  log(`[${ts()}] PreCompact  | cwd: ${cwd}\n  action: SNAPSHOT | tasks: ${taskActive ? 'yes' : 'no'} | plan: ${planActive ? 'yes' : 'no'}\n`);
} catch(e) {
  try { log(`[${ts()}] PreCompact  | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
}
