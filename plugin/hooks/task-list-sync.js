// PreToolUse:TaskCreate|TaskUpdate|TodoWrite hook 方案 D
// 拦截 Claude 任务列表写入：交互式 TaskCreate/TaskUpdate + 非交互/SDK TodoWrite。
// 校验任务列表与 v6 changes/<id>.md 任务清单的一致性。
// 非 PACE 项目时直接放行；PACE 项目时检查 task.md 活跃任务与操作的合理性
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { ts, isPaceProject, readActive, isTeammate, getArtifactDir, getProjectName, formatBridgeHint, TODO_DRIFT_THRESHOLD, FORMAT_SNIPPETS, getActiveChangeEntries, classifyChange } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger(LOG);
const cwd = paceUtils.resolveProjectCwd();
const proj = getProjectName(cwd);

// S-1: 统一 stdin 解析
paceUtils.withStdinParsed((stdin) => {
  try {
    const t0 = Date.now();
    const paceSignal = isPaceProject(cwd);

    // 非 PACE 项目：直接放行
    if (!paceSignal) {
      log(paceUtils.logEntry('TaskSync', 'SKIP', { proj, reason: 'non-pace', dur: Date.now() - t0 }));
      return;
    }
    const rootConfigError = paceUtils.artifactRootConfigError(cwd);
    if (rootConfigError) {
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: rootConfigError.message,
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('TaskSync', 'HINT', { proj, reason: rootConfigError.code, dur: Date.now() - t0 }));
      return;
    }

    // v4.7: teammate 静默——避免 Agent Teams 共享任务的假阳性
    if (isTeammate()) {
      log(paceUtils.logEntry('TaskSync', 'SKIP', { proj, reason: 'teammate', dur: Date.now() - t0 }));
      return;
    }

    const { toolName, toolInput } = stdin;
    if (!stdin.ok) return;

    // TodoWrite 清空操作（空数组）直接放行，不产生 hint
    if (toolName === 'TodoWrite' && (toolInput.todos || []).length === 0) {
      return;
    }

    // 写入类操作：TodoWrite（批量替换）、TaskCreate（创建单项）、TaskUpdate（更新单项）
    const isWriteOp = (toolName === 'TodoWrite' || toolName === 'TaskCreate' || toolName === 'TaskUpdate');

    const taskActive = readActive(cwd, 'task.md');
    // W-dry-2: 预计算桥接提示（只作为任务列表提醒；任务列表不是 artifact 权威）
    const artDir = getArtifactDir(cwd);
    const artifactHint = paceUtils.artifactDirRuntimeHint(cwd);
    const bridgeHint = formatBridgeHint(cwd, artDir);
    const hints = [];

    if (paceSignal === 'artifact') {
      const changes = getActiveChangeEntries(cwd).map(e => classifyChange(e));
      const currentChanges = changes.filter(c => ['running', 'blocked'].includes(c.category));
      const activeTaskCount = currentChanges.reduce((sum, c) => sum + c.tasks.pending, 0);
      const completedActiveChanges = changes.filter(c => c.category === 'closing-required').length;

      if (isWriteOp && activeTaskCount === 0 && changes.length === 0) {
        hints.push(`v6 项目当前无活跃 CHG。请先派 artifact-writer create-chg 创建变更，再更新 Claude 任务列表。`);
      } else if (isWriteOp && activeTaskCount > 0) {
        hints.push(`v6 任务权威是 changes/<id>.md 的 ## 任务清单。当前执行中的 CHG 有 ${activeTaskCount} 个未完成 T-NNN，请为它们创建或更新 Claude 任务列表项。`);
      } else if (isWriteOp && activeTaskCount === 0 && completedActiveChanges > 0) {
        hints.push(`当前有 ${completedActiveChanges} 个 completed 变更待 close-chg。确认验证通过并归档后再清空 Claude 任务列表；archive-chg 仅用于已 verified 的单独归档修复。${FORMAT_SNIPPETS.closeOp}`);
      }

      if (toolName === 'TodoWrite') {
        const todos = toolInput.todos || [];
        if (todos.length > 0 && activeTaskCount > 0 && Math.abs(todos.length - activeTaskCount) > TODO_DRIFT_THRESHOLD) {
          hints.push(`TodoWrite（${todos.length} 项）与 v6 详情未完成任务（${activeTaskCount} 项）数量差异较大。`);
        }
      }
    } else {

    if (taskActive) {
      if (isWriteOp) {
        hints.push(`检测到 legacy task.md 活跃内容，但当前项目没有 changes/ v6 详情目录。Claude 任务列表不再从 v5 task.md 同步；请先运行 migrate/batch-archive-v5.js 迁移，或派 artifact-writer create-chg 桥接为 changes/<id>.md + wikilink 索引。迁移或桥接后仍需重试被阻止的原始代码写入。`);
      }
    } else {
      // task.md 不存在但在创建 todo
      if (isWriteOp) {
        if (paceSignal === 'superpowers' && bridgeHint) {
          hints.push(`检测到 Superpowers 计划文件（${bridgeHint.fileList}）但 task.md 不存在；Claude 任务列表可继续作为工作记忆。真正写代码或派 artifact-writer 前，请先按 paceflow:pace-bridge 桥接计划。`);
        } else {
          hints.push(`未检测到 v6 artifact。请先创建 changes/ 与 v6 索引，或用 .pace/disabled 标记此项目不使用 PACE。`);
        }
      }
    }
    }

    // 标记本会话使用过任务列表工具（供 Stop hook 检测残留）。
    if (isWriteOp) {
      const PACE_RUNTIME = paceUtils.getProjectRuntimeDir(cwd);
      try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
      try { fs.writeFileSync(path.join(PACE_RUNTIME, 'task-list-used'), ts(), 'utf8'); } catch(e) {}
    }

    if (hints.length > 0) {
      const ctx = `Claude 任务列表同步校验：${hints.join(' ')}\n${artifactHint}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(paceUtils.logEntry('TaskSync', 'HINT', { proj, tool: toolName, hints: hints.join('; '), dur: Date.now() - t0 }));
    } else {
      log(paceUtils.logEntry('TaskSync', 'PASS', { proj, tool: toolName, dur: Date.now() - t0 }));
    }
  } catch(e) {
    log(paceUtils.logEntry('TaskSync', 'ERROR', { proj, error: e.message }));
  }
});
