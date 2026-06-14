#!/usr/bin/env node
// run-all.js — 核心测试套件聚合 runner（CHG-20260614-07）
// 用途：一条命令串起全部核心套件 + plugin validate + git diff --check，
// 任一子套件非零退出即整体非零退出，杜绝「手敲漏跑某套件→回归静默漏网」。
// 设计：每个 suite 是独立子进程（execFileSync），退出码忠实透传；
// runSuites 接受任意 suite 列表便于自测（tests/test-run-all.js 喂 fake 子命令验证传播）。

const path = require('path');
const { execFileSync } = require('child_process');

// 核心套件清单。run-all-self 是聚合器自测，喂 fake 子命令、不递归跑 run-all 本身。
const SUITES = [
  { name: 'pace-utils', cmd: process.execPath, args: ['tests/test-pace-utils.js'] },
  { name: 'hooks-e2e', cmd: process.execPath, args: ['tests/test-hooks-e2e.js'] },
  { name: 'session-layers', cmd: process.execPath, args: ['tests/test-session-layers.js'] },
  { name: 'migrate-v7', cmd: process.execPath, args: ['tests/test-migrate-v7.js'] },
  { name: 'agent-helpers', cmd: process.execPath, args: ['tests/test-agent-tests-helpers.js'] },
  { name: 'run-all-self', cmd: process.execPath, args: ['tests/test-run-all.js'] },
  { name: 'plugin-validate', cmd: 'claude', args: ['plugin', 'validate', './plugin'] },
  { name: 'git-diff-check', cmd: 'git', args: ['diff', '--check'] },
];

/**
 * 按子串筛选套件（供 PACE_TEST_FILTER 分片）。空值返回全部，不做静默清空。
 * @param {Array} suites - 套件清单
 * @param {string} filter - 名字子串
 * @returns {Array} 命中的套件
 */
function filterSuites(suites, filter) {
  if (!filter) return suites;
  return suites.filter((s) => s.name.includes(filter));
}

/**
 * 顺序运行每个套件，忠实透传退出码。任一非零即整体 exitCode=1。
 * @param {Array} suites - 套件清单
 * @param {{cwd?: string, quiet?: boolean}} opts - quiet 时吞子进程输出（自测用）
 * @returns {{results: Array<{name,ok,ms}>, exitCode: number}}
 */
function runSuites(suites, opts = {}) {
  const cwd = opts.cwd || path.join(__dirname, '..');
  const quiet = !!opts.quiet;
  const results = [];
  for (const s of suites) {
    const t0 = Date.now();
    let ok = true;
    try {
      execFileSync(s.cmd, s.args, { cwd, stdio: quiet ? 'pipe' : 'inherit' });
    } catch (e) {
      ok = false; // 子进程非零退出 / 命令不存在 → 标记失败，继续跑完其余套件
    }
    const ms = Date.now() - t0;
    results.push({ name: s.name, ok, ms });
    if (!quiet) console.log(`  ${ok ? '✅' : '❌'} ${s.name} (${ms}ms)`);
  }
  const failed = results.filter((r) => !r.ok);
  return { results, exitCode: failed.length > 0 ? 1 : 0 };
}

if (require.main === module) {
  const filter = process.env.PACE_TEST_FILTER || '';
  const suites = filterSuites(SUITES, filter);
  if (filter) console.log(`PACE_TEST_FILTER="${filter}" → ${suites.length}/${SUITES.length} 套件`);
  const { results, exitCode } = runSuites(suites);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${exitCode === 0 ? '✅' : '❌'} run-all: ${passed}/${results.length} 套件通过`);
  if (exitCode !== 0) {
    console.log('失败套件: ' + results.filter((r) => !r.ok).map((r) => r.name).join(', '));
  }
  process.exit(exitCode);
}

module.exports = { runSuites, filterSuites, SUITES };
