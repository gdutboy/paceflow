// Legacy compatibility observer for older manual settings that still call this script.
// Current Claude Code exposes task-panel hooks as TaskCreated/TaskCompleted events, and
// PaceFlow no longer uses task-list hooks for workflow guidance. The authoritative
// execution state is changes/<id>.md; Claude's task panel remains model-owned memory.
const fs = require('fs');
const path = require('path');

let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}

const LOG = paceUtils.defaultLogPath();
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = paceUtils.getProjectName(cwd);

function observedTaskEvent(stdin) {
  const event = String(stdin.raw && stdin.raw.hook_event_name || '');
  const tool = String(stdin.toolName || '');
  return (
    event === 'TaskCreated' ||
    event === 'TaskCompleted' ||
    tool === 'TaskCreate' ||
    tool === 'TaskUpdate' ||
    tool === 'TodoWrite'
  );
}

paceUtils.withStdinParsed((stdin) => {
  const t0 = Date.now();
  try {
    if (!stdin.ok) {
      log(paceUtils.logEntry('TaskSync', 'SKIP', { proj, reason: 'bad-stdin', dur: Date.now() - t0 }));
      return;
    }

    const paceSignal = paceUtils.isPaceProject(cwd);
    if (!paceSignal) {
      log(paceUtils.logEntry('TaskSync', 'SKIP', { proj, reason: 'non-pace', dur: Date.now() - t0 }));
      return;
    }

    if (paceUtils.isTeammate()) {
      log(paceUtils.logEntry('TaskSync', 'SKIP', { proj, reason: 'teammate', dur: Date.now() - t0 }));
      return;
    }

    if (observedTaskEvent(stdin)) {
      const runtime = paceUtils.getProjectRuntimeDir(cwd);
      try { fs.mkdirSync(runtime, { recursive: true }); } catch(e) {}
      try { fs.writeFileSync(path.join(runtime, 'task-list-used'), paceUtils.ts(), 'utf8'); } catch(e) {}
      log(paceUtils.logEntry('TaskSync', 'OBSERVE', {
        proj,
        event: stdin.raw && stdin.raw.hook_event_name || '-',
        tool: stdin.toolName || '-',
        task_id: stdin.raw && stdin.raw.task_id || stdin.toolInput.task_id || '-',
        reason: 'task-panel-is-working-memory',
        dur: Date.now() - t0,
      }));
      return;
    }

    log(paceUtils.logEntry('TaskSync', 'PASS', { proj, dur: Date.now() - t0 }));
  } catch(e) {
    log(paceUtils.logEntry('TaskSync', 'ERROR', { proj, error: e.message }));
  }
});
