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
// W-8: 使用共享日志轮转函数
const log = paceUtils.createLogger ? paceUtils.createLogger(LOG) : ((msg) => { try { fs.appendFileSync(LOG, msg); } catch(e) {} });
const cwd = paceUtils.resolveProjectCwd ? paceUtils.resolveProjectCwd() : process.cwd();

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

    // W-10: 使用 JSON.parse 替代正则检测 disableAllHooks
    let hasDisableAll = false;
    try {
      const configObj = JSON.parse(configStr);
      hasDisableAll = configObj.disableAllHooks === true;
    } catch(e) {
      // 解析失败回退正则
      hasDisableAll = /"disableAllHooks"\s*:\s*true/.test(configStr);
    }
    if (hasDisableAll) {
      const ctx = `⚠️ 严重警告：检测到 disableAllHooks=true，这会导致 PACE 保护完全失效。如需临时禁用单个项目，请使用 .pace/disabled 标记而非禁用全部 hooks。请立即撤回此配置变更。`;
      const output = {
        hookSpecificOutput: {
          hookEventName: "ConfigChange",
          additionalContext: ctx
        }
      };
      process.stdout.write(JSON.stringify(output));
      log(`[${ts()}] ConfigGuard | cwd: ${cwd}\n  action: WARN | reason: disableAllHooks=true\n`);
      return;
    }

    // W-2: 检测删除 PACE hook 条目（收紧：需匹配 hooks/pace/ 路径）
    if (/hooks\/pace\//i.test(configStr) && /delete|remove|disable/i.test(configStr)) {
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
