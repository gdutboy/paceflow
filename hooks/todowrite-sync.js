// PreToolUse:TodoWrite|TaskCreate|TaskUpdate hook 方案 D
// 拦截 TodoWrite（批量）和 TaskCreate/TaskUpdate（单项）操作，校验与 task.md 一致性
// 非 PACE 项目时直接放行；PACE 项目时检查 task.md 活跃任务与操作的合理性
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { ts, isPaceProject, readActive, countByStatus, isTeammate, getArtifactDir, getProjectName, formatBridgeHint, TODO_DRIFT_THRESHOLD, FORMAT_SNIPPETS, getActiveChangeEntries, countDetailTasks } = paceUtils;

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
    // W-dry-2: 预计算桥接提示（供两处 Superpowers DENY 复用）
    const artDir = getArtifactDir(cwd);
    const bridgeHint = formatBridgeHint(cwd, artDir);
    const hints = [];

    if (paceSignal === 'artifact') {
      const entries = getActiveChangeEntries(cwd).filter(e => e.task && e.impl && e.detail && !e.detail.missing);
      const activeTaskCount = entries.reduce((sum, e) => sum + countDetailTasks(e.detail.content).pending, 0);
      const completedActiveChanges = entries.filter(e => {
        const status = (e.detail.frontmatter.status || '').replace(/^["']|["']$/g, '');
        return status === 'completed';
      }).length;

      if (isWriteOp && activeTaskCount === 0 && entries.length === 0) {
        hints.push(`v6 项目当前无活跃 CHG。请先派 paceflow-artifact-writer create-chg 创建变更，再使用 TodoWrite。`);
      } else if (isWriteOp && activeTaskCount > 0) {
        hints.push(`v6 任务权威是 changes/<id>.md 的 ## 任务清单。当前详情文件有 ${activeTaskCount} 个未完成 T-NNN，请为它们创建或更新 TodoWrite 项。`);
      } else if (isWriteOp && activeTaskCount === 0 && completedActiveChanges > 0) {
        hints.push(`当前有 ${completedActiveChanges} 个 completed 变更待 verify/archive。归档后再清空 TodoWrite。${FORMAT_SNIPPETS.archiveOp}`);
      }

      if (toolName === 'TodoWrite') {
        const todos = toolInput.todos || [];
        if (todos.length > 0 && activeTaskCount > 0 && Math.abs(todos.length - activeTaskCount) > TODO_DRIFT_THRESHOLD) {
          hints.push(`TodoWrite（${todos.length} 项）与 v6 详情未完成任务（${activeTaskCount} 项）数量差异较大。`);
        }
      }
    } else {

    if (taskActive) {
      // W2: 统一使用 countByStatus（仅顶层任务）
      const { pending: activeTasks, done: doneTasks, total: totalActive } = countByStatus(taskActive, { topLevelOnly: true });

      // W-9: totalActive=0 说明活跃区有内容但无顶层任务行（如只有标题/注释），视为无任务
      if (isWriteOp && totalActive === 0) {
        // Superpowers 场景：升级为 DENY（精确条件，不影响其他 TodoWrite 使用）
        if (paceSignal === 'superpowers' && bridgeHint) {
          const denyOutput = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `检测到 Superpowers 计划文件（${bridgeHint.fileList}）但 task.md 无活跃任务。请先执行桥接：${bridgeHint.bridgeSteps}`
            }
          };
          process.stdout.write(JSON.stringify(denyOutput));
          log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: DENY | tool: ${toolName} | superpowers bridge required\n`);
          return;
        }
        hints.push(`task.md 无活跃任务，但正在创建 TodoWrite 项。请先创建 v6 CHG 详情，再使用 TodoWrite。`);
      }

      // 写入操作 + task.md 有活跃任务 → 同步提醒
      if (isWriteOp && activeTasks > 0) {
        hints.push(`legacy task.md 有 ${activeTasks} 个活跃任务；v6 应迁移为 changes/<id>.md 任务清单。`);
      }

      // 写入操作 + 活跃区只有已完成项 → 提醒先归档
      if (isWriteOp && activeTasks === 0 && doneTasks > 0) {
        hints.push(`task.md 活跃区有 ${doneTasks} 个已完成项待归档，无进行中任务。请先归档再操作 TodoWrite。${FORMAT_SNIPPETS.archiveOp}`);
      }

      // TodoWrite 批量写入：数量差异检测
      if (toolName === 'TodoWrite') {
        const todos = toolInput.todos || [];
        if (todos.length > 0 && activeTasks > 0 && Math.abs(todos.length - activeTasks) > TODO_DRIFT_THRESHOLD) {
          hints.push(`TodoWrite（${todos.length} 项）与 task.md 顶层活跃任务（${activeTasks} 项）数量差异较大，请为每个顶层活跃任务创建或更新对应的 TodoWrite 项。`);
        }
      }
    } else {
      // task.md 不存在但在创建 todo
      if (isWriteOp) {
        if (paceSignal === 'superpowers' && bridgeHint) {
          const denyOutput = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `检测到 Superpowers 计划文件（${bridgeHint.fileList}）但 task.md 不存在。请先执行桥接：${bridgeHint.bridgeSteps}`
            }
          };
          process.stdout.write(JSON.stringify(denyOutput));
          log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: DENY | tool: ${toolName} | superpowers bridge required (no task.md)\n`);
          return;
        }
        hints.push(`未检测到 v6 artifact。请先创建 changes/ 与 v6 索引，或用 .pace/disabled 标记此项目不使用 PACE。`);
      }
    }
    }

    // 标记本会话使用过 TodoWrite（供 Stop hook 检测残留）—— 仅写入操作且通过 DENY 检查后才标记
    if (isWriteOp) {
      const PACE_RUNTIME = path.join(cwd, '.pace');
      try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
      try { fs.writeFileSync(path.join(PACE_RUNTIME, 'todowrite-used'), ts(), 'utf8'); } catch(e) {}
    }

    if (hints.length > 0) {
      const ctx = `TodoWrite 同步校验：${hints.join(' ')}`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: HINT | tool: ${toolName} | hints: ${hints.join('; ')}\n`);
    } else {
      log(paceUtils.logEntry('TaskSync', 'PASS', { proj, tool: toolName, dur: Date.now() - t0 }));
    }
  } catch(e) {
    log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`);
  }
});
