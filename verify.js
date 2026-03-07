// verify.js — PACEflow 健康检查脚本
// 执行 8 组检查：语法验证、源码-生产一致性、settings.json 完整性、版本号一致性、模板完整性、Skill 文件一致性、Plugin 结构、hooks.json/settings 配置一致性
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME = process.env.HOME || process.env.USERPROFILE;
const HOOKS_DIR = path.join(__dirname, 'hooks');
const PROD_DIR = path.join(HOME, '.claude', 'hooks', 'pace');
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');
const SKILLS_TARGET = path.join(HOME, '.claude', 'skills');
const HOOKS_TEMPLATES = path.join(__dirname, 'hooks', 'templates');
const SKILLS_SRC = path.join(__dirname, 'skills');

// 需要检查的 7 个 PACE hook 脚本名
const EXPECTED_HOOKS = [
  'session-start.js',
  'pre-tool-use.js',
  'post-tool-use.js',
  'stop.js',
  'todowrite-sync.js',
  'pre-compact.js',
  'config-guard.js',
];

// v5.0.0: Skill 目录名列表（源码 skills/<name>/SKILL.md）
const SKILL_DIRS = [
  'pace-workflow',
  'artifact-management',
  'change-management',
  'pace-knowledge',
  'pace-bridge',
  'paceflow-audit',
];

let hasError = false;
let hasWarning = false;
const results = [];
// 每个检查组的结果：'pass' | 'warn' | 'error'
const groupStatus = [];

/**
 * 第 1 组：语法验证
 * 遍历 hooks/ 目录下所有 .js 文件，用 node -c 检查语法
 */
function checkSyntax() {
  try {
    const jsFiles = fs.readdirSync(HOOKS_DIR).filter(f => f.endsWith('.js'));
    let passed = 0;
    const errors = [];

    for (const file of jsFiles) {
      const filePath = path.join(HOOKS_DIR, file);
      try {
        execSync(`node -c "${filePath}"`, { stdio: 'pipe' });
        passed++;
      } catch (e) {
        const msg = e.stderr ? e.stderr.toString().trim() : e.message;
        errors.push(`❌ 语法错误: ${file} - ${msg}`);
        hasError = true;
      }
    }

    if (errors.length === 0) {
      results.push(`✅ 语法验证: ${passed}/${jsFiles.length} 通过`);
    } else {
      results.push(`❌ 语法验证: ${passed}/${jsFiles.length} 通过`);
      results.push(...errors);
    }
  } catch (e) {
    results.push(`❌ 语法验证: 无法读取 hooks 目录 - ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 2 组：源码 vs 生产一致性
 * 比较源码 hooks/*.js 与生产目录 ~/.claude/hooks/pace/*.js
 */
function checkSourceVsProd() {
  try {
    if (!fs.existsSync(PROD_DIR)) {
      results.push(`⚠️ 源码-生产一致性: 生产目录不存在 (${PROD_DIR})，跳过`);
      hasWarning = true;
      return;
    }

    const jsFiles = fs.readdirSync(HOOKS_DIR).filter(f => f.endsWith('.js'));
    let matched = 0;
    const issues = [];

    for (const file of jsFiles) {
      const srcPath = path.join(HOOKS_DIR, file);
      const prodPath = path.join(PROD_DIR, file);

      if (!fs.existsSync(prodPath)) {
        issues.push(`❌ 生产缺失: ${file}`);
        hasError = true;
        continue;
      }

      const srcBuf = fs.readFileSync(srcPath);
      const prodBuf = fs.readFileSync(prodPath);

      if (Buffer.compare(srcBuf, prodBuf) === 0) {
        matched++;
      } else {
        issues.push(`⚠️ 源码与生产不一致: ${file}`);
        hasWarning = true;
      }
    }

    if (issues.length === 0) {
      results.push(`✅ 源码-生产一致性: ${matched}/${jsFiles.length} 一致`);
    } else {
      results.push(`⚠️ 源码-生产一致性: ${matched}/${jsFiles.length} 一致`);
      results.push(...issues);
    }
  } catch (e) {
    results.push(`❌ 源码-生产一致性: ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 3 组：settings.json 完整性
 * 检查 settings.json 中是否包含所有 PACE hook 脚本的条目
 */
function checkSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) {
      results.push(`⚠️ settings.json: 文件不存在 (${SETTINGS_PATH})，跳过`);
      hasWarning = true;
      return;
    }

    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    const hooks = settings.hooks;

    if (!hooks) {
      results.push(`❌ settings.json: 缺少 hooks 配置`);
      hasError = true;
      return;
    }

    // 收集所有 hook 条目中的 command 字段
    const allCommands = [];
    for (const eventType of Object.keys(hooks)) {
      const entries = hooks[eventType];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        // 支持两种结构：直接 {command} 或嵌套 {hooks: [{command}]}
        if (entry.command) {
          allCommands.push(entry.command);
        }
        if (Array.isArray(entry.hooks)) {
          for (const h of entry.hooks) {
            if (h.command) allCommands.push(h.command);
          }
        }
      }
    }

    const missing = [];
    for (const script of EXPECTED_HOOKS) {
      const found = allCommands.some(cmd => cmd.includes(script));
      if (!found) {
        missing.push(script);
      }
    }

    if (missing.length === 0) {
      results.push(`✅ settings.json: ${EXPECTED_HOOKS.length}/${EXPECTED_HOOKS.length} hook 条目存在`);
    } else {
      results.push(`⚠️ settings.json: 缺少 ${missing.join(', ')} hook 条目`);
      hasWarning = true;
    }
  } catch (e) {
    results.push(`❌ settings.json: ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 4 组：版本号一致性
 * 从源码和生产的 pace-utils.js 中提取 PACE_VERSION 并比较
 */
function checkVersion() {
  try {
    const srcPath = path.join(HOOKS_DIR, 'pace-utils.js');
    const prodPath = path.join(PROD_DIR, 'pace-utils.js');

    const srcContent = fs.readFileSync(srcPath, 'utf8');
    const srcMatch = srcContent.match(/PACE_VERSION\s*=\s*'([^']+)'/);
    if (!srcMatch) {
      results.push(`❌ 版本号: 源码 pace-utils.js 中未找到 PACE_VERSION`);
      hasError = true;
      return;
    }
    const srcVersion = srcMatch[1];

    if (!fs.existsSync(prodPath)) {
      results.push(`⚠️ 版本号: 生产 pace-utils.js 不存在，源码版本 ${srcVersion}，跳过比较`);
      hasWarning = true;
      return;
    }

    const prodContent = fs.readFileSync(prodPath, 'utf8');
    const prodMatch = prodContent.match(/PACE_VERSION\s*=\s*'([^']+)'/);
    if (!prodMatch) {
      results.push(`❌ 版本号: 生产 pace-utils.js 中未找到 PACE_VERSION`);
      hasError = true;
      return;
    }
    const prodVersion = prodMatch[1];

    if (srcVersion === prodVersion) {
      results.push(`✅ 版本号一致: ${srcVersion}`);
    } else {
      results.push(`⚠️ 版本号不一致: 源码 ${srcVersion} vs 生产 ${prodVersion}`);
      hasWarning = true;
    }
  } catch (e) {
    results.push(`❌ 版本号: ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 5 组：模板完整性
 * v5.0.0: 模板统一到 hooks/templates/，仅检查文件存在性
 */
function checkTemplates() {
  try {
    const expectedTemplates = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
    let found = 0;
    const issues = [];

    for (const name of expectedTemplates) {
      const filePath = path.join(HOOKS_TEMPLATES, name);
      if (fs.existsSync(filePath)) {
        found++;
      } else {
        issues.push(`❌ 模板缺失: hooks/templates/${name}`);
        hasError = true;
      }
    }

    if (issues.length === 0) {
      results.push(`✅ 模板完整性: ${found}/${expectedTemplates.length} 存在`);
    } else {
      results.push(`❌ 模板完整性: ${found}/${expectedTemplates.length} 存在`);
      results.push(...issues);
    }
  } catch (e) {
    results.push(`❌ 模板完整性: ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 6 组：Skill 文件一致性
 * v5.0.0: 源码 skills/<name>/SKILL.md 与生产 ~/.claude/skills/<name>/SKILL.md 比较
 */
function checkSkills() {
  try {
    let matched = 0;
    const issues = [];

    for (const dirName of SKILL_DIRS) {
      const srcPath = path.join(SKILLS_SRC, dirName, 'SKILL.md');
      const prodPath = path.join(SKILLS_TARGET, dirName, 'SKILL.md');

      if (!fs.existsSync(srcPath)) {
        issues.push(`❌ 源码缺失: skills/${dirName}/SKILL.md`);
        hasError = true;
        continue;
      }
      if (!fs.existsSync(prodPath)) {
        issues.push(`❌ 生产缺失: ${dirName}/SKILL.md`);
        hasError = true;
        continue;
      }

      const srcBuf = fs.readFileSync(srcPath);
      const prodBuf = fs.readFileSync(prodPath);

      if (Buffer.compare(srcBuf, prodBuf) === 0) {
        matched++;
      } else {
        issues.push(`⚠️ Skill 不一致: ${dirName}/SKILL.md`);
        hasWarning = true;
      }
    }

    if (issues.length === 0) {
      results.push(`✅ Skill 一致性: ${matched}/${SKILL_DIRS.length} 一致`);
    } else {
      results.push(`⚠️ Skill 一致性: ${matched}/${SKILL_DIRS.length} 一致`);
      results.push(...issues);
    }
  } catch (e) {
    results.push(`❌ Skill 一致性: ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 7 组：Plugin 结构完整性
 * 检查 .claude-plugin/plugin.json、hooks/hooks.json 和 skills 目录结构
 */
function checkPlugin() {
  try {
    const pluginJsonPath = path.join(__dirname, '.claude-plugin', 'plugin.json');
    const hooksJsonPath = path.join(__dirname, 'hooks', 'hooks.json');
    const issues = [];

    // 检查 plugin.json
    if (!fs.existsSync(pluginJsonPath)) {
      issues.push(`❌ Plugin 缺失: .claude-plugin/plugin.json`);
      hasError = true;
    } else {
      try {
        const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
        if (!pluginJson.name) {
          issues.push(`❌ plugin.json: 缺少 name 字段`);
          hasError = true;
        }
        // H-1/H-2: 检查 plugin.json version 与 pace-utils.js PACE_VERSION 一致性
        if (pluginJson.version) {
          const utilsPath = path.join(HOOKS_DIR, 'pace-utils.js');
          const utilsContent = fs.readFileSync(utilsPath, 'utf8');
          const vMatch = utilsContent.match(/PACE_VERSION\s*=\s*'([^']+)'/);
          if (vMatch) {
            const paceVer = vMatch[1].replace(/^v/, '');
            if (paceVer !== pluginJson.version) {
              issues.push(`⚠️ plugin.json version "${pluginJson.version}" 与 pace-utils.js PACE_VERSION "${vMatch[1]}" 不一致`);
              hasWarning = true;
            }
          }
        }
      } catch (e) {
        issues.push(`❌ plugin.json: JSON 解析失败 - ${e.message}`);
        hasError = true;
      }
    }

    // 检查 hooks.json
    if (!fs.existsSync(hooksJsonPath)) {
      issues.push(`❌ Plugin 缺失: hooks/hooks.json`);
      hasError = true;
    } else {
      try {
        const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
        if (!hooksJson.hooks) {
          issues.push(`❌ hooks.json: 缺少 hooks 配置`);
          hasError = true;
        } else {
          // 检查所有预期 hook 脚本是否注册
          const allCommands = [];
          for (const entries of Object.values(hooksJson.hooks)) {
            for (const entry of entries) {
              if (Array.isArray(entry.hooks)) {
                for (const h of entry.hooks) {
                  if (h.command) allCommands.push(h.command);
                }
              }
            }
          }
          const missing = EXPECTED_HOOKS.filter(script => !allCommands.some(cmd => cmd.includes(script)));
          if (missing.length > 0) {
            issues.push(`⚠️ hooks.json: 缺少 ${missing.join(', ')} 注册`);
            hasWarning = true;
          }
        }
      } catch (e) {
        issues.push(`❌ hooks.json: JSON 解析失败 - ${e.message}`);
        hasError = true;
      }
    }

    // 检查 skills 目录结构
    let skillsOk = 0;
    for (const dirName of SKILL_DIRS) {
      const skillPath = path.join(SKILLS_SRC, dirName, 'SKILL.md');
      if (fs.existsSync(skillPath)) {
        skillsOk++;
      } else {
        issues.push(`❌ skills 目录结构: ${dirName}/SKILL.md 缺失`);
        hasError = true;
      }
    }

    if (issues.length === 0) {
      results.push(`✅ Plugin 结构: plugin.json + hooks.json + ${skillsOk} skills 完整`);
    } else {
      const errorCount = issues.filter(i => i.startsWith('❌')).length;
      if (errorCount > 0) {
        results.push(`❌ Plugin 结构: ${issues.length} 个问题`);
      } else {
        results.push(`⚠️ Plugin 结构: ${issues.length} 个问题`);
      }
      results.push(...issues);
    }
  } catch (e) {
    results.push(`❌ Plugin 结构: ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 8 组：hooks.json vs settings-hooks-excerpt.json 配置一致性
 * W-8: 两份配置的事件类型、matcher、脚本名必须一致
 */
function checkConfigSync() {
  try {
    const hooksJsonPath = path.join(__dirname, 'hooks', 'hooks.json');
    const settingsPath = path.join(__dirname, 'config', 'settings-hooks-excerpt.json');
    if (!fs.existsSync(hooksJsonPath) || !fs.existsSync(settingsPath)) {
      results.push(`⚠️ 配置一致性: hooks.json 或 settings-hooks-excerpt.json 不存在，跳过`);
      hasWarning = true;
      return;
    }
    const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, 'utf8'));
    const settingsJson = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const issues = [];

    // 提取结构化信息：{ eventType: [{ matcher, scriptName }] }
    function extractEntries(config) {
      const map = {};
      for (const [event, entries] of Object.entries(config.hooks || {})) {
        map[event] = entries.map(e => ({
          matcher: e.matcher || '',
          scripts: (e.hooks || []).map(h => {
            const m = (h.command || '').match(/([a-z-]+\.js)(?:'|")?$/);
            return m ? m[1] : h.command;
          })
        }));
      }
      return map;
    }

    const hMap = extractEntries(hooksJson);
    const sMap = extractEntries(settingsJson);
    const allEvents = new Set([...Object.keys(hMap), ...Object.keys(sMap)]);

    for (const event of allEvents) {
      if (!hMap[event]) { issues.push(`⚠️ hooks.json 缺少事件: ${event}`); continue; }
      if (!sMap[event]) { issues.push(`⚠️ settings 缺少事件: ${event}`); continue; }
      const hEntries = hMap[event];
      const sEntries = sMap[event];
      if (hEntries.length !== sEntries.length) {
        issues.push(`⚠️ ${event}: 条目数不同（hooks.json ${hEntries.length} vs settings ${sEntries.length}）`);
        continue;
      }
      for (let i = 0; i < hEntries.length; i++) {
        if (hEntries[i].matcher !== sEntries[i].matcher) {
          issues.push(`⚠️ ${event}[${i}] matcher 不同: "${hEntries[i].matcher}" vs "${sEntries[i].matcher}"`);
        }
        const hScripts = hEntries[i].scripts.join(',');
        const sScripts = sEntries[i].scripts.join(',');
        if (hScripts !== sScripts) {
          issues.push(`⚠️ ${event}[${i}] 脚本不同: ${hScripts} vs ${sScripts}`);
        }
      }
    }

    if (issues.length === 0) {
      results.push(`✅ 配置一致性: hooks.json 与 settings-hooks-excerpt.json ${allEvents.size} 个事件一致`);
    } else {
      results.push(`⚠️ 配置一致性: ${issues.length} 个差异`);
      results.push(...issues);
      hasWarning = true;
    }
  } catch (e) {
    results.push(`❌ 配置一致性: ${e.message}`);
    hasError = true;
  }
}

// 执行所有检查
console.log('PACEflow 健康检查');
console.log('==================');

const checks = [checkSyntax, checkSourceVsProd, checkSettings, checkVersion, checkTemplates, checkSkills, checkPlugin, checkConfigSync];
for (const check of checks) {
  const before = results.length;
  check();
  // 每个检查函数的第一行 push 是组级摘要，据其前缀判断组状态
  if (results.length > before) {
    const summary = results[before];
    if (summary.startsWith('✅')) groupStatus.push('pass');
    else if (summary.startsWith('⚠️')) groupStatus.push('warn');
    else groupStatus.push('error');
  }
}

// 输出结果
for (const line of results) {
  console.log(line);
}

// 统计通过/警告/错误（基于 groupStatus 数组，每组一个状态）
const passCount = groupStatus.filter(s => s === 'pass').length;
const warnCount = groupStatus.filter(s => s === 'warn').length;
const errCount = groupStatus.filter(s => s === 'error').length;

console.log('------------------');
const total = groupStatus.length;
const parts = [`结果: ${passCount}/${total} 通过`];
if (warnCount > 0) parts.push(`${warnCount} 警告`);
if (errCount > 0) parts.push(`${errCount} 错误`);
console.log(parts.join(', '));

if (hasError) process.exit(1);
process.exit(0);
