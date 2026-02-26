// ConfigChange hook：防止禁用所有 hooks + PACE hook 删除提醒
const fs = require('fs');
const path = require('path');
let paceUtils;
try { paceUtils = require('./pace-utils'); } catch(e) {
  process.stderr.write(`PACE: pace-utils.js 加载失败: ${e.message}\n`);
  process.exit(0);
}
const { isPaceProject } = paceUtils;

const LOG = path.join(__dirname, 'pace-hooks.log');
const ts = () => new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const log = (msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} };
const cwd = process.cwd();

// 异步读取 stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const paceSignal = isPaceProject(cwd);
    if (!paceSignal) return;

    // 尝试解析 stdin 获取配置内容
    let configStr = '';
    try {
      const parsed = JSON.parse(input);
      // ConfigChange stdin 格式可能是 tool_input 或完整 settings
      configStr = JSON.stringify(parsed.tool_input || parsed);
    } catch(e) {
      configStr = input;
    }

    // 检测 disableAllHooks
    if (/disableAllHooks.*true/i.test(configStr)) {
      process.stderr.write('PACE: 禁止禁用所有 hooks（disableAllHooks），这会导致 PACE 保护完全失效。如需临时禁用，请使用 .pace/disabled 标记。\n');
      log(`[${ts()}] ConfigGuard | cwd: ${cwd}\n  action: DENY | reason: disableAllHooks=true\n`);
      process.exit(2);
    }

    // 检测删除 PACE hook 条目
    if (/\/pace\//i.test(configStr) && /delete|remove/i.test(configStr)) {
      const ctx = `检测到可能删除 PACE hook 配置，请确认这是有意操作。删除后 PACE 保护将部分失效。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "ConfigChange",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] ConfigGuard | cwd: ${cwd}\n  action: WARN | reason: PACE hook 可能被删除\n`);
    }
  } catch(e) {
    try { log(`[${ts()}] ConfigGuard | cwd: ${cwd}\n  action: ERROR | ${e.message}\n`); } catch(e2) {}
  }
});
