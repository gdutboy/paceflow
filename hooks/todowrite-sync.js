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
const { PACE_VERSION, isPaceProject, readActive, countByStatus, isTeammate, hasPlanFiles, listPlanFiles, getArtifactDir } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger ? paceUtils.createLogger(LOG) : ((msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} });
const cwd = paceUtils.resolveProjectCwd ? paceUtils.resolveProjectCwd() : process.cwd();

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const paceSignal = isPaceProject(cwd);

    // 非 PACE 项目：直接放行
    if (!paceSignal) {
      return;
    }

    // v4.7: teammate 静默——避免 Agent Teams 共享任务的假阳性
    if (isTeammate()) {
      return;
    }

    let toolName = '', toolInput = {};
    try {
      const parsed = JSON.parse(input);
      toolName = parsed.tool_name || '';
      toolInput = parsed.tool_input || {};
    } catch(e) {
      return;
    }

    // TodoWrite 清空操作（空数组）直接放行，不产生 hint
    if (toolName === 'TodoWrite' && (toolInput.todos || []).length === 0) {
      return;
    }

    // 写入类操作：TodoWrite（批量替换）、TaskCreate（创建单项）、TaskUpdate（更新单项）
    const isWriteOp = (toolName === 'TodoWrite' || toolName === 'TaskCreate' || toolName === 'TaskUpdate');

    const taskActive = readActive(cwd, 'task.md');
    const hints = [];

    if (taskActive) {
      // W2: 统一使用 countByStatus（仅顶层任务）
      const { pending: pendingTasks, done: doneTasks, total: totalActive } = countByStatus(taskActive, { topLevelOnly: true });

      // W-9: totalActive=0 说明活跃区有内容但无顶层任务行（如只有标题/注释），视为无任务
      if (isWriteOp && totalActive === 0) {
        // Superpowers 场景：升级为 DENY（精确条件，不影响其他 TodoWrite 使用）
        if (paceSignal === 'superpowers' && hasPlanFiles(cwd)) {
          const planFiles = listPlanFiles(cwd);
          const fileList = planFiles.slice(0, 3).map(f => `docs/plans/${f}`).join(', ');
          const denyOutput = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `检测到 Superpowers 计划文件（${fileList}）但 task.md 无活跃任务。请先执行桥接：Read plan → Edit task.md 添加任务 + APPROVED → Edit implementation_plan.md 添加 CHG。详见 /pace-bridge skill。`
            }
          };
          process.stdout.write(JSON.stringify(denyOutput));
          log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: DENY | tool: ${toolName} | superpowers bridge required\n`);
          return;
        }
        hints.push(`task.md 无活跃任务，但正在创建 TodoWrite 项。task.md 是任务权威来源，请确认是否需要先在 task.md 中添加任务。`);
      }

      // 写入操作 + task.md 有活跃任务 → 同步提醒
      if (isWriteOp && pendingTasks > 0) {
        hints.push(`task.md 是任务权威来源（${pendingTasks} 个活跃），请确保 TodoWrite 项与 task.md 对齐。`);
      }

      // 写入操作 + 活跃区只有已完成项 → 提醒先归档
      if (isWriteOp && pendingTasks === 0 && doneTasks > 0) {
        hints.push(`task.md 活跃区有 ${doneTasks} 个已完成项待归档，无进行中任务。请先归档再操作 TodoWrite。`);
      }

      // TodoWrite 批量写入：数量差异检测
      if (toolName === 'TodoWrite') {
        const todos = toolInput.todos || [];
        if (todos.length > 0 && pendingTasks > 0 && Math.abs(todos.length - pendingTasks) > 3) {
          hints.push(`TodoWrite（${todos.length} 项）与 task.md 顶层活跃任务（${pendingTasks} 项）数量差异较大，请确认是否对齐。`);
        }
      }
    } else {
      // task.md 不存在但在创建 todo
      if (isWriteOp) {
        if (paceSignal === 'superpowers' && hasPlanFiles(cwd)) {
          const planFiles = listPlanFiles(cwd);
          const fileList = planFiles.slice(0, 3).map(f => `docs/plans/${f}`).join(', ');
          const denyOutput = {
            hookSpecificOutput: {
              hookEventName: "PreToolUse",
              permissionDecision: "deny",
              permissionDecisionReason: `检测到 Superpowers 计划文件（${fileList}）但 task.md 不存在。请先执行桥接：Read plan → 创建 task.md 添加任务 + APPROVED → Edit implementation_plan.md 添加 CHG。详见 /pace-bridge skill。`
            }
          };
          process.stdout.write(JSON.stringify(denyOutput));
          log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: DENY | tool: ${toolName} | superpowers bridge required (no task.md)\n`);
          return;
        }
        hints.push(`task.md 不存在。如果这是 PACE 项目，请先创建 task.md 再使用 TodoWrite。`);
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
      // PASS: 常规事件，不记录日志
    }
  } catch(e) {
    log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`);
  }
});
