// PreToolUse:TodoWrite|TaskCreate|TaskUpdate hook v4.3.9 方案 D
// 拦截 TodoWrite（批量）和 TaskCreate/TaskUpdate（单项）操作，校验与 task.md 一致性
// 非 PACE 项目时直接放行；PACE 项目时检查 task.md 活跃任务与操作的合理性
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

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const paceSignal = isPaceProject(cwd);

    // 非 PACE 项目：直接放行
    if (!paceSignal) {
      log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: SKIP | reason: 非 PACE 项目\n`);
      return;
    }

    let toolName = '', toolInput = {};
    try {
      const parsed = JSON.parse(input);
      toolName = parsed.tool_name || '';
      toolInput = parsed.tool_input || {};
    } catch(e) {
      log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: SKIP | reason: stdin 解析失败\n`);
      return;
    }

    // TodoWrite 清空操作（空数组）直接放行，不产生 hint
    if (toolName === 'TodoWrite' && (toolInput.todos || []).length === 0) {
      log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: PASS | tool: TodoWrite | reason: 清空操作\n`);
      return;
    }

    // 标记本会话使用过 TodoWrite（供 Stop hook 检测残留）
    const PACE_RUNTIME = path.join(cwd, '.pace');
    try { fs.mkdirSync(PACE_RUNTIME, { recursive: true }); } catch(e) {}
    try { fs.writeFileSync(path.join(PACE_RUNTIME, 'todowrite-used'), ts(), 'utf8'); } catch(e) {}

    // 写入类操作：TodoWrite（批量替换）、TaskCreate（创建单项）
    const isWriteOp = (toolName === 'TodoWrite' || toolName === 'TaskCreate');

    const taskActive = readActive(cwd, 'task.md');
    const hints = [];

    if (taskActive) {
      // W2: 统一使用 countByStatus（仅顶层任务）
      const { pending: pendingTasks, done: doneTasks, total: totalActive } = countByStatus(taskActive, { topLevelOnly: true });

      // 写入操作 + task.md 无活跃任务 → 可能是 compaction 残留
      if (isWriteOp && totalActive === 0) {
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
        hints.push(`task.md 不存在。如果这是 PACE 项目，请先创建 task.md 再使用 TodoWrite。`);
      }
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
      log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: PASS | tool: ${toolName}\n`);
    }
  } catch(e) {
    log(`[${ts()}] TaskSync    | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`);
  }
});
