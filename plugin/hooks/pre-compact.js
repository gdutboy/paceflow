// PreCompact hook：compact 前收集 artifact 状态快照，供 session-start.js compact 恢复使用
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { ts, todayISO, isPaceProject, readActive, countByStatus, getProjectName, summarizeActiveChanges } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);
const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);

try {
  const t0 = Date.now();
  const hookInput = paceUtils.parseStdinSync();
  const paceSignal = isPaceProject(cwd);
  if (!paceSignal) {
    log(paceUtils.logEntry('PreCompact', 'SKIP', { proj, reason: 'non-pace' }));
    process.exit(0);
  }
  const rootConfigError = paceUtils.artifactRootConfigError(cwd);
  if (rootConfigError) {
    log(paceUtils.logEntry('PreCompact', 'SKIP', { proj, reason: rootConfigError.code }));
    process.exit(0);
  }
  if (paceSignal !== 'artifact' && paceUtils.artifactRootChoiceNeeded(cwd)) {
    const action = paceSignal === 'legacy' ? 'SKIP_LEGACY_V5' : 'SKIP';
    log(paceUtils.logEntry('PreCompact', action, { proj, signal: paceSignal, reason: 'artifact-root-choice-pending', dur: Date.now() - t0 }));
    process.exit(0);
  }

  const snapshot = { timestamp: new Date().toISOString(), artifacts: {} };

  if (paceSignal === 'artifact') {
    snapshot.activeChanges = summarizeActiveChanges(cwd).map(change => {
      const ownerStatus = paceUtils.changeOwnerStatus(cwd, change.id, hookInput.sessionId);
      return {
        ...change,
        ownerDisposition: ownerStatus.disposition,
        ownerWorktree: ownerStatus.owner && ownerStatus.owner.worktree || '',
        ownerBranch: ownerStatus.owner && ownerStatus.owner.branch || '',
        ownerState: ownerStatus.owner && ownerStatus.owner.state || '',
      };
    });
  }

  // 收集 task.md 状态
  const taskActive = readActive(cwd, 'task.md');
  if (taskActive) {
    const { pending, done } = countByStatus(taskActive, { topLevelOnly: true });
    // P3-4: 只需要进行中任务的文本列表（供 compact 恢复显示），保留 match
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
    taskListUsed: fs.existsSync(path.join(PACE_RUNTIME, 'task-list-used')) || fs.existsSync(path.join(PACE_RUNTIME, 'todowrite-used')),
    blockCount
  };

  // v5.0.2: 快照扩展 findings + walkthrough 状态
  try {
    const findingsActive = readActive(cwd, 'findings.md');
    if (findingsActive) {
      const openCount = (findingsActive.match(/^- \[ \] /gm) || []).length;
      snapshot.findings = { openCount };
    }
  } catch(e) {}
  try {
    const walkActive = readActive(cwd, 'walkthrough.md');
    if (walkActive) {
      const today = todayISO();
      // T-425: 正则匹配对齐 stop.js 精确度，避免 includes() 子串误匹配
      const hasTodayEntry = new RegExp('^\\|\\s*' + today + '\\s*\\|', 'm').test(walkActive);
      snapshot.walkthrough = { hasTodayEntry };
    }
  } catch(e) {}

  // v5.0.1: 捕获 native plan 文件路径（AI 未主动记录时的兜底）
  // I-5: HOME/USERPROFILE 都不存在时跳过检测
  // I-15: native plan 最大年龄 1 小时（超过视为过期，不纳入快照）
  const NATIVE_PLAN_MAX_AGE_MS = 60 * 60 * 1000;
  const HOME = process.env.HOME || process.env.USERPROFILE;
  if (HOME) {
    const nativePlansDir = path.join(HOME, '.claude', 'plans');
    try {
      if (fs.existsSync(nativePlansDir)) {
        const now = Date.now();
        const allRecentPlans = fs.readdirSync(nativePlansDir)
          .filter(f => f.endsWith('.md'))
          .map(f => {
            try {
              const fp = path.join(nativePlansDir, f);
              const mtime = fs.statSync(fp).mtimeMs;
              return (now - mtime) < NATIVE_PLAN_MAX_AGE_MS ? { path: fp.replace(/\\/g, '/'), mtime } : null;
            } catch(e) { return null; }
          })
          .filter(Boolean)
          .sort((a, b) => b.mtime - a.mtime);
        const currentPlanFile = path.join(PACE_RUNTIME, 'current-native-plan');
        try {
          if (fs.existsSync(currentPlanFile)) {
            const currentPlan = fs.readFileSync(currentPlanFile, 'utf8').trim();
            if (currentPlan && !paceUtils.nativePlanMatchesProject(currentPlan, cwd)) {
              fs.unlinkSync(currentPlanFile);
              log(paceUtils.logEntry('PreCompact', 'NATIVE_PLAN_DROP_FOREIGN', { proj, plan: currentPlan }));
            }
          }
        } catch(e) {}

        const recentPlans = allRecentPlans.filter(plan => paceUtils.nativePlanMatchesProject(plan.path, cwd));
        if (recentPlans.length > 0) {
          snapshot.nativePlans = recentPlans.map(e => e.path);
          // T-326: 自动写入最近的 native plan 路径到 .pace/current-native-plan；不覆盖 AI 主动记录的路径。
          try {
            fs.mkdirSync(PACE_RUNTIME, { recursive: true });
            if (!fs.existsSync(currentPlanFile)) fs.writeFileSync(currentPlanFile, recentPlans[0].path, 'utf8');
          } catch(e) {}
        } else if (allRecentPlans.length > 0) {
          log(paceUtils.logEntry('PreCompact', 'NATIVE_PLAN_SKIP_FOREIGN', {
            proj,
            candidates: allRecentPlans.length,
          }));
        }
      }
    } catch(e) {}
  }

  // 写入快照文件
  fs.mkdirSync(PACE_RUNTIME, { recursive: true });
  fs.writeFileSync(path.join(PACE_RUNTIME, 'pre-compact-state.json'), JSON.stringify(snapshot, null, 2), 'utf8');

  log(paceUtils.logEntry('PreCompact', 'SNAPSHOT', { proj, tasks: taskActive ? 'yes' : 'no', plan: planActive ? 'yes' : 'no' }));
} catch(e) {
  try { log(paceUtils.logEntry('PreCompact', 'ERROR', { proj, error: e.message })); } catch(e2) {}
}
