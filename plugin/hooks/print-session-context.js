#!/usr/bin/env node
// print-session-context.js — 查看 SessionStart hook 实际会注入给模型什么（无副作用）。
//
// 用法：node print-session-context.js [--compact] [--cwd <项目目录>]
//   --compact   模拟 compact 之后的注入（默认模拟新 session startup）
//   --cwd <dir> 指定项目目录（默认当前工作目录）
//
// 原理：SessionStart 注入的内容平时只进模型 context、用户不可见。本 helper 设
//   PACE_PRINT_ONLY=1 + 合成 SessionStart event，子进程调用真实 session-start.js，
//   把它的 stdout 原样打到终端（忠实复现，含 50KB 截断逻辑），同时 PACE_PRINT_ONLY
//   让 session-start.js 跳过一切 .pace 运行态写盘（counter 重置 / compact 恢复 /
//   ensureProjectInfra / findings-age flag）——「看一眼」绝不改变任何状态。
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

/**
 * 解析命令行参数。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{compact: boolean, cwd: string, help: boolean}}
 */
function parseArgs(argv) {
  const args = { compact: false, cwd: '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compact') args.compact = true;
    else if (a === '--cwd') args.cwd = i + 1 < argv.length ? argv[++i] : '';
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write('用法：node print-session-context.js [--compact] [--cwd <项目目录>]\n');
  process.stdout.write('  --compact   查看 compact 之后的注入（默认查看新 session startup）\n');
  process.stdout.write('  --cwd <dir> 指定项目目录（默认当前工作目录）\n');
  process.exit(0);
}

const targetCwd = path.resolve(args.cwd || process.cwd());
const sessionStart = path.join(__dirname, 'session-start.js');
const eventType = args.compact ? 'compact' : 'startup';
const sep = '─'.repeat(60);

process.stdout.write(`=== SessionStart 注入预览（${eventType}，无副作用）===\n`);
process.stdout.write(`项目：${targetCwd}\n`);
process.stdout.write(`（${args.compact ? 'compact 之后' : '新 session 启动'}时 session-start.js 注入给模型的内容；PACE_PRINT_ONLY 已隔离 .pace 写盘）\n`);
process.stdout.write(sep + '\n');

// 合成 SessionStart event（session-start.js 用 hookInput.type 区分 startup / compact）。
const res = spawnSync('node', [sessionStart], {
  cwd: targetCwd,
  input: JSON.stringify({ type: eventType }),
  env: { ...process.env, PACE_PRINT_ONLY: '1', CLAUDE_PROJECT_DIR: targetCwd },
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

if (res.error) {
  process.stderr.write(`运行 session-start.js 失败：${res.error.message}\n`);
  process.exit(1);
}

process.stdout.write(res.stdout || '(无注入输出——当前目录可能不是 PACE 项目，或活跃区为空)\n');
if (res.stderr && res.stderr.trim()) {
  process.stdout.write('\n─── session-start.js stderr ───\n' + res.stderr);
}
process.stdout.write(sep + '\n');
process.exit(0);
