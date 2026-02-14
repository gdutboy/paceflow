// PreToolUse:TodoWrite hook v4.3.6 方案 D：拦截 TodoWrite 调用，校验与 task.md 一致性
// 非 PACE 项目时直接放行；PACE 项目时比对 task.md 活跃任务与 TodoWrite todos
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject, readActive } = paceUtils;

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

    // 非 PACE 项目：直接放行，不干预
    if (!paceSignal) {
      log(`[${ts()}] TodoWrite   | cwd: ${cwd}\n  action: SKIP | reason: 非 PACE 项目\n`);
      return;
    }

    let todos = [];
    try {
      const parsed = JSON.parse(input);
      todos = parsed.tool_input?.todos || [];
    } catch(e) {
      log(`[${ts()}] TodoWrite   | cwd: ${cwd}\n  action: SKIP | reason: stdin 解析失败\n`);
      return;
    }

    const taskActive = readActive(cwd, 'task.md');
    const hints = [];

    if (taskActive) {
      // 只匹配顶层任务（行首无缩进），避免子任务导致数量偏差
      const pendingTasks = (taskActive.match(/^- \[[ \/!]\]/gm) || []).length;
      const doneTasks = (taskActive.match(/^- \[x\]|^- \[-\]/gm) || []).length;
      const totalActive = pendingTasks + doneTasks;

      // 场景 1：task.md 无活跃任务但 TodoWrite 有项目 → 残留
      if (totalActive === 0 && todos.length > 0) {
        hints.push(`task.md 无活跃任务，但 TodoWrite 有 ${todos.length} 个残留项。请清空 TodoWrite。`);
      }

      // 场景 2：task.md 有活跃任务但 TodoWrite 为空 → 缺同步
      if (pendingTasks > 0 && todos.length === 0) {
        hints.push(`task.md 有 ${pendingTasks} 个活跃任务，但 TodoWrite 正在被清空。如果任务仍在进行，建议保留对应的 todo 项。`);
      }

      // 场景 3：数量差异较大 → 提醒对齐（顶层任务比对）
      if (todos.length > 0 && pendingTasks > 0 && Math.abs(todos.length - pendingTasks) > 3) {
        hints.push(`TodoWrite（${todos.length} 项）与 task.md 顶层活跃任务（${pendingTasks} 项）数量差异较大，请确认是否对齐。`);
      }
    } else {
      // task.md 不存在但 TodoWrite 有项目
      if (todos.length > 0) {
        hints.push(`task.md 不存在，TodoWrite 的 ${todos.length} 个 todo 项无法校验。如果这是 PACE 项目，请先创建 task.md。`);
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
      log(`[${ts()}] TodoWrite   | cwd: ${cwd}\n  action: HINT | todos: ${todos.length} | hints: ${hints.join('; ')}\n`);
    } else {
      log(`[${ts()}] TodoWrite   | cwd: ${cwd}\n  action: PASS | todos: ${todos.length}\n`);
    }
  } catch(e) {
    log(`[${ts()}] TodoWrite   | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`);
  }
});
