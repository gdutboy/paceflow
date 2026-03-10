// test-install.js — install.js 核心路径集成测试
// subprocess 模式（install.js 不导出函数），通过 HOME 环境变量重定向到临时目录实现隔离
// 覆盖：标准安装 / settings 合并 / 备份 / --dry-run / --force / --plugin / --migrate / 边界情况

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const INSTALL_JS = path.join(__dirname, '..', 'install.js');

let passed = 0;
let failed = 0;
let tmpDirs = [];

/** 创建隔离临时目录 */
function makeTmpDir(label) {
  const dir = path.join(os.tmpdir(), `pace-install-test-${Date.now()}-${label}-${Math.random().toString(36).slice(2, 6)}`);
  fs.mkdirSync(dir, { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

/** 清理所有临时目录 */
function cleanup() {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }
}

/** 运行单个测试 */
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e) {
    failed++;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${e.message}`);
  }
}

/**
 * 执行 install.js 子进程
 * @param {string} home - 模拟的 HOME 目录
 * @param {string[]} args - CLI 参数
 * @returns {string} stdout 输出
 */
function runInstall(home, args = []) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  return execFileSync('node', [INSTALL_JS, ...args], {
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
}

/**
 * 执行 install.js 子进程（允许非零退出码）
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function runInstallSafe(home, args = []) {
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  try {
    const stdout = execFileSync('node', [INSTALL_JS, ...args], {
      env,
      encoding: 'utf8',
      timeout: 15000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status || 1, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

/** 读取 settings.json */
function readSettings(home) {
  const fp = path.join(home, '.claude', 'settings.json');
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

/** 写入 settings.json */
function writeSettings(home, obj) {
  const dir = path.join(home, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(obj, null, 2), 'utf8');
}

// ============================================================
// 1. 标准安装 — 全新环境
// ============================================================
console.log('\n--- 标准安装 ---');

test('全新安装创建 hooks 目录和 .js 文件', () => {
  const home = makeTmpDir('fresh-hooks');
  runInstall(home);
  const hooksDir = path.join(home, '.claude', 'hooks', 'pace');
  assert.ok(fs.existsSync(hooksDir), 'hooks/pace/ 目录应存在');
  // 验证核心 hook 文件
  const expected = ['pre-tool-use.js', 'post-tool-use.js', 'session-start.js', 'stop.js', 'pace-utils.js'];
  for (const f of expected) {
    assert.ok(fs.existsSync(path.join(hooksDir, f)), `${f} 应存在`);
  }
});

test('全新安装创建 templates 子目录', () => {
  const home = makeTmpDir('fresh-templates');
  runInstall(home);
  const tplDir = path.join(home, '.claude', 'hooks', 'pace', 'templates');
  assert.ok(fs.existsSync(tplDir), 'templates/ 目录应存在');
  const expected = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
  for (const f of expected) {
    assert.ok(fs.existsSync(path.join(tplDir, f)), `templates/${f} 应存在`);
  }
});

test('全新安装创建 6 个 skill 目录', () => {
  const home = makeTmpDir('fresh-skills');
  runInstall(home);
  const skillDirs = ['pace-workflow', 'artifact-management', 'change-management', 'pace-knowledge', 'pace-bridge', 'paceflow-audit'];
  for (const dir of skillDirs) {
    const skillFile = path.join(home, '.claude', 'skills', dir, 'SKILL.md');
    assert.ok(fs.existsSync(skillFile), `skills/${dir}/SKILL.md 应存在`);
  }
});

test('全新安装创建 settings.json 并包含 PACE hooks', () => {
  const home = makeTmpDir('fresh-settings');
  runInstall(home);
  const settings = readSettings(home);
  assert.ok(settings.hooks, 'settings.hooks 应存在');
  // 验证 6 个事件类型
  const expectedEvents = ['SessionStart', 'PreToolUse', 'PostToolUse', 'PreCompact', 'ConfigChange', 'Stop'];
  for (const evt of expectedEvents) {
    assert.ok(settings.hooks[evt], `settings.hooks.${evt} 应存在`);
    assert.ok(settings.hooks[evt].length > 0, `settings.hooks.${evt} 应有条目`);
  }
});

test('change-management templates 子目录安装', () => {
  const home = makeTmpDir('fresh-chg-tpl');
  runInstall(home);
  const chgTplDir = path.join(home, '.claude', 'skills', 'change-management', 'templates');
  assert.ok(fs.existsSync(chgTplDir), 'change-management/templates/ 应存在');
  assert.ok(
    fs.readdirSync(chgTplDir).some(f => f.endsWith('.md')),
    'change-management/templates/ 应有 .md 文件'
  );
});

// ============================================================
// 2. Settings 合并
// ============================================================
console.log('\n--- Settings 合并 ---');

test('保留用户已有的非 PACE hooks', () => {
  const home = makeTmpDir('merge-preserve');
  writeSettings(home, {
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node /my/custom/hook.js' }]
        }
      ]
    }
  });
  runInstall(home);
  const settings = readSettings(home);
  // 用户的 Bash hook 应保留
  const bashEntry = settings.hooks.PreToolUse.find(e => e.matcher === 'Bash');
  assert.ok(bashEntry, '用户的 Bash hook 应被保留');
  assert.ok(bashEntry.hooks[0].command.includes('/my/custom/hook.js'), '用户 hook command 应不变');
  // PACE 的 Write|Edit hook 也应存在
  const paceEntry = settings.hooks.PreToolUse.find(e => e.matcher === 'Write|Edit');
  assert.ok(paceEntry, 'PACE Write|Edit hook 应已添加');
});

test('更新已有 PACE hook 的 command 路径', () => {
  const home = makeTmpDir('merge-update');
  // 预填充旧路径的 PACE hook
  writeSettings(home, {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [{ type: 'command', command: 'node /old/path/pace/session-start.js' }]
        }
      ]
    }
  });
  runInstall(home);
  const settings = readSettings(home);
  const entry = settings.hooks.SessionStart[0];
  // 路径应已更新为新 HOME
  assert.ok(entry.hooks[0].command.includes(home.replace(/\\/g, '/')), `command 应包含新 HOME 路径，实际: ${entry.hooks[0].command}`);
  // 应只有 1 个 SessionStart 条目（更新而非重复添加）
  assert.strictEqual(settings.hooks.SessionStart.length, 1, 'SessionStart 应只有 1 个条目');
});

test('settings.json 合并前创建 .bak 备份', () => {
  const home = makeTmpDir('merge-bak');
  writeSettings(home, { hooks: {} });
  runInstall(home);
  const bakPath = path.join(home, '.claude', 'settings.json.bak');
  assert.ok(fs.existsSync(bakPath), 'settings.json.bak 应存在');
});

// ============================================================
// 3. 备份机制
// ============================================================
console.log('\n--- 备份机制 ---');

test('文件不一致时创建 .bak 时间戳备份', () => {
  const home = makeTmpDir('backup-ts');
  runInstall(home);
  // 修改一个已安装的 hook 文件
  const hookFile = path.join(home, '.claude', 'hooks', 'pace', 'pace-utils.js');
  fs.writeFileSync(hookFile, '// modified\n');
  // 再次安装
  runInstall(home);
  // 应有 .bak.YYYYMMDD-HHmmss 文件
  const hooksDir = path.join(home, '.claude', 'hooks', 'pace');
  const baks = fs.readdirSync(hooksDir).filter(f => f.startsWith('pace-utils.js.bak.'));
  assert.ok(baks.length > 0, '应创建时间戳备份文件');
});

// ============================================================
// 4. --dry-run 模式
// ============================================================
console.log('\n--- --dry-run ---');

test('--dry-run 不创建任何文件', () => {
  const home = makeTmpDir('dryrun-empty');
  const output = runInstall(home, ['--dry-run']);
  // .claude 目录应不存在（全新 HOME）
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'hooks')), '--dry-run 不应创建 hooks 目录');
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')), '--dry-run 不应创建 settings.json');
});

test('--dry-run 输出包含 [DRY RUN] 标记', () => {
  const home = makeTmpDir('dryrun-output');
  const output = runInstall(home, ['--dry-run']);
  assert.ok(output.includes('[DRY RUN]'), '输出应包含 [DRY RUN]');
});

test('--dry-run 对已安装环境零变更', () => {
  const home = makeTmpDir('dryrun-noop');
  // 先正常安装
  runInstall(home);
  // 修改一个文件
  const hookFile = path.join(home, '.claude', 'hooks', 'pace', 'pace-utils.js');
  fs.writeFileSync(hookFile, '// user modified\n');
  const modifiedContent = fs.readFileSync(hookFile, 'utf8');
  // dry-run 不应改变文件
  runInstall(home, ['--dry-run']);
  const afterContent = fs.readFileSync(hookFile, 'utf8');
  assert.strictEqual(afterContent, modifiedContent, '--dry-run 不应修改文件内容');
});

// ============================================================
// 5. --force 模式
// ============================================================
console.log('\n--- --force ---');

test('--force 不创建 .bak 备份文件', () => {
  const home = makeTmpDir('force-nobak');
  runInstall(home);
  const hookFile = path.join(home, '.claude', 'hooks', 'pace', 'pace-utils.js');
  fs.writeFileSync(hookFile, '// modified\n');
  runInstall(home, ['--force']);
  const hooksDir = path.join(home, '.claude', 'hooks', 'pace');
  const baks = fs.readdirSync(hooksDir).filter(f => f.startsWith('pace-utils.js.bak.'));
  assert.strictEqual(baks.length, 0, '--force 不应创建时间戳备份');
});

// ============================================================
// 6. --plugin 模式
// ============================================================
console.log('\n--- --plugin ---');

test('--plugin 创建 plugin 缓存目录结构', () => {
  const home = makeTmpDir('plugin-cache');
  runInstall(home, ['--plugin']);
  const cacheBase = path.join(home, '.claude', 'plugins', 'marketplaces', 'paceaitian-paceflow', 'paceflow');
  assert.ok(fs.existsSync(cacheBase), 'plugin 缓存基础目录应存在');
  // 应有版本子目录
  const versions = fs.readdirSync(cacheBase);
  assert.ok(versions.length > 0, '应有版本目录');
  const versionDir = path.join(cacheBase, versions[0]);
  // 验证 3 个核心子目录
  assert.ok(fs.existsSync(path.join(versionDir, '.claude-plugin')), '.claude-plugin/ 应存在');
  assert.ok(fs.existsSync(path.join(versionDir, 'hooks')), 'hooks/ 应存在');
  assert.ok(fs.existsSync(path.join(versionDir, 'skills')), 'skills/ 应存在');
});

test('--plugin 不修改 settings.json', () => {
  const home = makeTmpDir('plugin-no-settings');
  runInstall(home, ['--plugin']);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'settings.json')), '--plugin 不应创建 settings.json');
});

// ============================================================
// 7. --migrate 模式
// ============================================================
console.log('\n--- --migrate ---');

test('--migrate 清理 settings.json 中的 PACE hooks', () => {
  const home = makeTmpDir('migrate-settings');
  writeSettings(home, {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [{ type: 'command', command: 'node /home/user/.claude/hooks/pace/session-start.js' }]
        }
      ],
      PreToolUse: [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo test' }] },
        { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node /pace/pre-tool-use.js' }] }
      ]
    }
  });
  runInstall(home, ['--migrate']);
  const settings = readSettings(home);
  // SessionStart 的 PACE hook 应被移除（整个事件键因为空数组应被删除）
  assert.ok(!settings.hooks.SessionStart, 'SessionStart PACE hook 应已移除');
  // PreToolUse 的 Bash 用户 hook 应保留
  assert.ok(settings.hooks.PreToolUse, 'PreToolUse 应保留');
  assert.strictEqual(settings.hooks.PreToolUse.length, 1, 'PreToolUse 应只剩用户 hook');
  assert.strictEqual(settings.hooks.PreToolUse[0].matcher, 'Bash', '用户 Bash hook 应保留');
});

test('--migrate 删除 hooks/pace/ 目录', () => {
  const home = makeTmpDir('migrate-hooks');
  // 先安装
  runInstall(home);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'hooks', 'pace')), '安装后 hooks/pace/ 应存在');
  // 迁移
  runInstall(home, ['--migrate']);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'hooks', 'pace')), '--migrate 后 hooks/pace/ 应不存在');
});

test('--migrate 删除 PACE skill 目录', () => {
  const home = makeTmpDir('migrate-skills');
  runInstall(home);
  assert.ok(fs.existsSync(path.join(home, '.claude', 'skills', 'pace-workflow')), '安装后 skill 应存在');
  runInstall(home, ['--migrate']);
  assert.ok(!fs.existsSync(path.join(home, '.claude', 'skills', 'pace-workflow')), '--migrate 后 skill 应不存在');
});

// ============================================================
// 8. 幂等性 + 边界情况
// ============================================================
console.log('\n--- 幂等性 + 边界 ---');

test('重复安装相同版本输出 "一致" 并跳过', () => {
  const home = makeTmpDir('idempotent');
  runInstall(home);
  const output = runInstall(home);
  assert.ok(output.includes('一致'), '第二次安装应输出 "一致"');
  // skipped 计数应 > 0
  const match = output.match(/(\d+) 跳过/);
  assert.ok(match && parseInt(match[1]) > 0, '应有跳过的文件');
});

test('settings.json 无效 JSON 时 exit 1', () => {
  const home = makeTmpDir('invalid-json');
  const settingsDir = path.join(home, '.claude');
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.writeFileSync(path.join(settingsDir, 'settings.json'), '{invalid json!!!', 'utf8');
  const result = runInstallSafe(home);
  assert.strictEqual(result.status, 1, '无效 JSON 应 exit 1');
});

// ============================================================
// 清理 + 结果输出
// ============================================================
cleanup();

console.log(`\n${'='.repeat(40)}`);
console.log(`结果: ${passed} 通过, ${failed} 失败（共 ${passed + failed} 个测试）`);
if (failed > 0) process.exit(1);
