#!/usr/bin/env node
// Mark a bridged plan file as synced in the project runtime directory.

const path = require('path');
const paceUtils = require('./pace-utils');

const LOG_PATH = path.join(__dirname, 'pace-hooks.log');
const log = paceUtils.createLogger(LOG_PATH);

function parseArgs(argv) {
  const args = { plan: '', cwd: '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--plan' || arg === '-p') {
      args.plan = String(argv[++i] || '');
    } else if (arg === '--cwd') {
      args.cwd = String(argv[++i] || '');
    } else if (!args.plan && !arg.startsWith('-')) {
      args.plan = String(arg || '');
    }
  }
  args.cwd = args.cwd ? path.resolve(args.cwd) : paceUtils.resolveProjectCwd();
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node hooks/sync-plan.js --plan <bridged-plan-path> [--cwd <project-cwd>]',
    '',
    'Run this after pace-bridge successfully creates the corresponding CHG.',
  ].join('\n');
}

function fail(cwd, action, message, fields = {}) {
  log(paceUtils.logEntry('PlanSync', action, { proj: paceUtils.getProjectName(cwd), ...fields }));
  process.stdout.write(`${message}\n`);
  process.exitCode = 2;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.plan) {
    fail(args.cwd, 'DENY_MISSING_PLAN', `缺少 plan 路径。\n\n${usage()}`);
    return;
  }

  const result = paceUtils.syncPlanFile(args.cwd, args.plan);
  if (!result.ok) {
    const plan = result.planPath ? paceUtils.displayDir(result.planPath) : String(args.plan || '');
    const reasonMap = {
      'plan-not-found': `plan 文件不存在：${plan}`,
      'plan-not-file': `plan 路径不是文件：${plan}`,
      'plan-not-markdown': `plan 路径必须是 Markdown 文件：${plan}`,
      'synced-plans-locked': 'synced-plans 正在被其他会话更新，请稍后重试。',
      'missing-plan': '缺少 plan 路径。',
    };
    fail(args.cwd, 'DENY_PLAN_SYNC', reasonMap[result.reason] || `无法标记 plan 已同步：${result.reason || 'unknown'}`, {
      reason: result.reason || '',
      plan,
      synced_plans: result.syncedPath ? paceUtils.displayDir(result.syncedPath) : '',
    });
    return;
  }

  log(paceUtils.logEntry('PlanSync', result.already ? 'ALREADY_SYNCED' : 'SYNCED', {
    proj: paceUtils.getProjectName(args.cwd),
    plan: result.name,
    synced_plans: paceUtils.displayDir(result.syncedPath),
  }));

  process.stdout.write([
    result.already ? 'plan 已经标记为同步。' : '已标记 plan 为同步。',
    `synced-plan: ${result.name}`,
    `synced-plans-file: ${paceUtils.displayDir(result.syncedPath)}`,
  ].join('\n') + '\n');
}

main();
