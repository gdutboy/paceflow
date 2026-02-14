// PreToolUse:TaskCreate|TaskUpdate hook v4.3.7 方案 D：拦截 Task 操作，校验与 task.md 一致性
// 非 PACE 项目时直接放行；PACE 项目时检查 task.md 活跃任务与 Task 操作的合理性
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

    const taskActive = readActive(cwd, 'task.md');
    const hints = [];

    if (taskActive) {
      // 只匹配顶层任务（行首无缩进）
      const pendingTasks = (taskActive.match(/^- \[[ \/!]\]/gm) || []).length;
      const doneTasks = (taskActive.match(/^- \[x\]|^- \[-\]/gm) || []).length;
      const totalActive = pendingTasks + doneTasks;

      // TaskCreate：task.md 无活跃任务时创建 todo → 可能是残留
      if (toolName === 'TaskCreate' && totalActive === 0) {
        hints.push(`task.md 无活跃任务，但正在创建 TodoWrite 项。task.md 是任务权威来源，请确认是否需要先在 task.md 中添加任务。`);
      }

      // TaskCreate：task.md 有活跃任务 → 注入同步提醒
      if (toolName === 'TaskCreate' && pendingTasks > 0) {
        hints.push(`task.md 是任务权威来源（${pendingTasks} 个活跃），请确保 TodoWrite 项与 task.md 对齐。`);
      }
    } else {
      // task.md 不存在但在创建 todo
      if (toolName === 'TaskCreate') {
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
