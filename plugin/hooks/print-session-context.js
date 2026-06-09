#!/usr/bin/env node
// print-session-context.js — 查看 SessionStart hook 实际会注入给模型什么（无副作用）。
//
// 用法：node print-session-context.js [--compact] [--cwd <项目目录>] [--group core|artifact]
//   --compact   模拟 compact 之后的注入（默认模拟新 session startup）
//   --cwd <dir> 指定项目目录（默认当前工作目录）
//   --group <g> 只看一个 hook（core 或 artifact）；默认 core+artifact 两段都打
//
// 原理：SessionStart 多 hook 重构后由 core + artifact 两个 hook 各注入 <10K chars（per-hook 10K cap）。
//   本 helper 设 PACE_PRINT_ONLY=1 + 合成 SessionStart event，按 group 子进程调用 session-start.js
//   --group <g>，把各 hook 的 stdout 原样打到终端（忠实复现 Claude Code 双 hook 实际注入，含截断逻辑），
//   PACE_PRINT_ONLY 让 session-start.js 跳过一切 .pace 运行态写盘——「看一眼」绝不改变任何状态。
//   每段末尾报字符数，便于核对各 hook 是否 <9500 chars 预算（超出会被 Claude persist 成 2KB preview）。
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

/**
 * 解析命令行参数。
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{compact: boolean, cwd: string, group: string, help: boolean}}
 */
function parseArgs(argv) {
  const args = { compact: false, cwd: '', group: '', help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--compact') args.compact = true;
    else if (a === '--cwd') args.cwd = i + 1 < argv.length ? argv[++i] : '';
    else if (a === '--group') args.group = i + 1 < argv.length ? argv[++i] : '';
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write('用法：node print-session-context.js [--compact] [--cwd <项目目录>] [--group core|artifact]\n');
  process.stdout.write('  --compact   查看 compact 之后的注入（默认查看新 session startup）\n');
  process.stdout.write('  --cwd <dir> 指定项目目录（默认当前工作目录）\n');
  process.stdout.write('  --group <g> 只看 core 或 artifact 一个 hook；默认两段都打（双 hook 各自注入）\n');
  process.exit(0);
}

const targetCwd = path.resolve(args.cwd || process.cwd());
const sessionStart = path.join(__dirname, 'session-start.js');
const eventType = args.compact ? 'compact' : 'startup';
const sep = '─'.repeat(60);

// 默认 core+artifact 两段都打；--group 指定则只跑该 group（双 hook 重构后各自 <10K 独立注入）。
const groups = (args.group === 'core' || args.group === 'artifact') ? [args.group] : ['core', 'artifact'];

process.stdout.write(`=== SessionStart 注入预览（${eventType}，无副作用）===\n`);
process.stdout.write(`项目：${targetCwd}\n`);
process.stdout.write(`（${args.compact ? 'compact 之后' : '新 session 启动'}时各 hook 注入给模型的内容；PACE_PRINT_ONLY 已隔离 .pace 写盘）\n`);

let failed = false;
for (const group of groups) {
  process.stdout.write('\n' + sep + '\n');
  process.stdout.write(`【--group ${group} hook】\n`);
  process.stdout.write(sep + '\n');

  // 合成 SessionStart event（session-start.js 用 hookInput.type 区分 startup / compact）。
  const res = spawnSync('node', [sessionStart, '--group', group], {
    cwd: targetCwd,
    input: JSON.stringify({ type: eventType }),
    env: { ...process.env, PACE_PRINT_ONLY: '1', CLAUDE_PROJECT_DIR: targetCwd },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  if (res.error) {
    process.stderr.write(`运行 session-start.js --group ${group} 失败：${res.error.message}\n`);
    failed = true;
    continue;
  }

  process.stdout.write(res.stdout || `(无注入输出——当前目录可能不是 PACE 项目，或 ${group} 活跃区为空)\n`);
  if (res.stderr && res.stderr.trim()) {
    process.stdout.write(`\n─── session-start.js --group ${group} stderr ───\n` + res.stderr);
  }
  // 字符数核对（双 hook 各 <9500 chars 预算；超 10K 会被 Claude persist 成 2KB preview，上下文恢复残废）。
  const chars = (res.stdout || '').length;
  process.stdout.write(`\n[${group} hook 注入 ${chars} chars${chars >= 9500 ? ' ⚠️ 接近/超 9500 预算上限' : ''}]\n`);
}
process.stdout.write(sep + '\n');
process.exit(failed ? 1 : 0);
