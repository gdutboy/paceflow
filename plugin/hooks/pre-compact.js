// PreCompact hook：compact 前的 native plan 兜底检测。
//   M4/T-002 起，原「写 artifact 状态快照供 session-start compact 恢复」机制已退役——
//   SessionStart 三段式重构后 collectState/buildLayers 实时读 artifact 已完整覆盖 compact 场景（OQ-1 + A0 对称）。
//   本 hook 现仅把最近匹配当前项目的原生计划路径落到 .pace/current-native-plan，供桥接提醒消费。
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
// M4/T-002 快照退役后，仅 native plan 兜底检测与 PACE 守卫所需的少量工具；原快照构造依赖
//   （ts/todayISO/readActive/countByStatus/summarizeActiveChanges）已随 snapshot 删除一并移除。
const { isPaceProject, getProjectName } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);
const projectLogEntry = (hook, action, fields = {}) => paceUtils.projectLogEntry(cwd, hook, action, fields);
const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);

try {
  const t0 = Date.now();
  const hookInput = paceUtils.parseStdinSync();
  const paceSignal = isPaceProject(cwd);
  if (!paceSignal) {
    log(projectLogEntry('PreCompact', 'SKIP', { proj, reason: 'non-pace' }));
    process.exit(0);
  }
  const rootConfigError = paceUtils.artifactRootConfigError(cwd);
  if (rootConfigError) {
    log(projectLogEntry('PreCompact', 'SKIP', { proj, reason: rootConfigError.code }));
    process.exit(0);
  }
  if (paceSignal !== 'artifact' && paceUtils.artifactRootChoiceNeeded(cwd)) {
    const action = paceSignal === 'legacy' ? 'SKIP_LEGACY_V5' : 'SKIP';
    log(projectLogEntry('PreCompact', action, { proj, signal: paceSignal, reason: 'artifact-root-choice-pending', dur: Date.now() - t0 }));
    process.exit(0);
  }

  // M4/T-002：PreCompact 快照机制（pre-compact-state.json）已退役。
  //   原先在此构造含 timestamp/artifacts/activeChanges/runtime.blockCount/findings/walkthrough 的快照、
  //   写入 .pace/pre-compact-state.json 供 SessionStart compact 恢复。三段式重构后 collectState/buildLayers
  //   实时读 artifact 已完整覆盖 compact 场景（OQ-1），快照成冗余旧路径。compact 与 startup 统一走实时读
  //   （A0 对称）。本 hook 退役后只剩下方 native plan 兜底检测——把最近的原生计划路径落到 .pace/current-native-plan，
  //   供 SessionStart 桥接提醒消费（native plan 与快照无关，保留）。

  // v5.0.1: 捕获 native plan 文件路径（AI 未主动记录时的兜底）
  // I-5: HOME/USERPROFILE 都不存在时跳过检测
  // I-15: native plan 最大年龄 1 小时（超过视为过期，不予记录）
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
              log(projectLogEntry('PreCompact', 'NATIVE_PLAN_DROP_FOREIGN', { proj, plan: currentPlan }));
            }
          }
        } catch(e) {}

        const recentPlans = allRecentPlans.filter(plan => paceUtils.nativePlanMatchesProject(plan.path, cwd));
        if (recentPlans.length > 0) {
          // T-326: 自动写入最近的 native plan 路径到 .pace/current-native-plan；不覆盖 AI 主动记录的路径。
          //   M4/T-002 快照退役后，current-native-plan 是 native plan 的唯一持久化出口（SessionStart 桥接提醒据此消费）。
          try {
            fs.mkdirSync(PACE_RUNTIME, { recursive: true });
            if (!fs.existsSync(currentPlanFile)) fs.writeFileSync(currentPlanFile, recentPlans[0].path, 'utf8');
          } catch(e) {}
        } else if (allRecentPlans.length > 0) {
          log(projectLogEntry('PreCompact', 'NATIVE_PLAN_SKIP_FOREIGN', {
            proj,
            candidates: allRecentPlans.length,
          }));
        }
      }
    } catch(e) {}
  }

  // M4/T-002：快照写入已退役（不再写 .pace/pre-compact-state.json）。
  //   PreCompact 现仅做 native plan 兜底检测（上方落 current-native-plan），故日志改记 NATIVE_PLAN_CHECK。
  log(projectLogEntry('PreCompact', 'NATIVE_PLAN_CHECK', { proj }));
} catch(e) {
  try { log(projectLogEntry('PreCompact', 'ERROR', { proj, error: e.message })); } catch(e2) {}
}
