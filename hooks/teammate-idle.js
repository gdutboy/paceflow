// TeammateIdle hook：向 Agent Teams teammate 注入 PACE 上下文
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { PACE_VERSION, isPaceProject, readActive, countByStatus } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();

try {
  const paceSignal = isPaceProject(cwd);
  if (!paceSignal) process.exit(0);

  const lines = [`=== PACE ${PACE_VERSION} | 信号: ${paceSignal} ===`];

  // 活跃任务统计
  const taskActive = readActive(cwd, 'task.md');
  if (taskActive) {
    const { pending, done } = countByStatus(taskActive, { topLevelOnly: true });
    lines.push(`活跃任务: ${pending} 待办, ${done} 完成`);

    // 进行中任务列表
    const inProgress = taskActive.match(/^- \[\/\] .+$/gm) || [];
    if (inProgress.length > 0) {
      lines.push('进行中:');
      inProgress.forEach(t => lines.push(`  ${t}`));
    }
  } else {
    lines.push('task.md 不存在');
  }

  // 关键约束提醒
  lines.push('');
  lines.push('约束提醒:');
  lines.push('- task.md 有活跃任务才能写代码文件');
  lines.push('- 需要 <!-- APPROVED --> 或 [/] 任务才能写代码');
  lines.push('- implementation_plan.md 需有 [/] 变更索引');

  process.stdout.write(lines.join('\n') + '\n');
  log(`[${ts()}] TeammateIdle | cwd: ${cwd}\n  action: INJECT | signal: ${paceSignal}\n`);
} catch(e) {
  try { log(`[${ts()}] TeammateIdle | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
}
