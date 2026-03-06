// verify.js — PACEflow 健康检查脚本
// 执行 6 组检查：语法验证、源码-生产一致性、settings.json 完整性、版本号一致性、模板同步、Skill 文件一致性
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HOME = process.env.HOME || process.env.USERPROFILE;
const HOOKS_DIR = path.join(__dirname, 'hooks');
const PROD_DIR = path.join(HOME, '.claude', 'hooks', 'pace');
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');
const SKILLS_TARGET = path.join(HOME, '.claude', 'skills');
const HOOKS_TEMPLATES = path.join(__dirname, 'hooks', 'templates');
const SKILLS_TEMPLATES = path.join(__dirname, 'skills', 'templates');
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

// 模板文件映射：hooks 模板名 → skills 模板名（artifact- 前缀）
const TEMPLATE_MAP = {
  'spec.md': 'artifact-spec.md',
  'task.md': 'artifact-task.md',
  'implementation_plan.md': 'artifact-implementation_plan.md',
  'walkthrough.md': 'artifact-walkthrough.md',
  'findings.md': 'artifact-findings.md',
};

// Skill 文件映射：源码文件名 → 生产目录名（与 install.js SKILL_MAP 一致）
const SKILL_MAP = {
  'pace-workflow.md': 'pace-workflow',
  'artifact-management.md': 'artifact-management',
  'change-management.md': 'change-management',
  'pace-knowledge.md': 'pace-knowledge',
  'pace-bridge.md': 'pace-bridge',
  'paceflow-audit.md': 'paceflow-audit',
};

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
 * 第 5 组：模板同步
 * 比较 hooks/templates/ 和 skills/templates/ 中的对应模板内容
 */
function checkTemplates() {
  try {
    const templateNames = Object.keys(TEMPLATE_MAP);
    let matched = 0;
    const issues = [];

    for (const hooksName of templateNames) {
      const skillsName = TEMPLATE_MAP[hooksName];
      const hooksPath = path.join(HOOKS_TEMPLATES, hooksName);
      const skillsPath = path.join(SKILLS_TEMPLATES, skillsName);

      if (!fs.existsSync(hooksPath)) {
        issues.push(`❌ hooks 模板缺失: ${hooksName}`);
        hasError = true;
        continue;
      }
      if (!fs.existsSync(skillsPath)) {
        issues.push(`❌ skills 模板缺失: ${skillsName}`);
        hasError = true;
        continue;
      }

      const hooksBuf = fs.readFileSync(hooksPath);
      const skillsBuf = fs.readFileSync(skillsPath);

      if (Buffer.compare(hooksBuf, skillsBuf) === 0) {
        matched++;
      } else {
        issues.push(`⚠️ 模板不同步: ${hooksName} ≠ ${skillsName}`);
        hasWarning = true;
      }
    }

    if (issues.length === 0) {
      results.push(`✅ 模板同步: ${matched}/${templateNames.length} 一致`);
    } else {
      results.push(`⚠️ 模板同步: ${matched}/${templateNames.length} 一致`);
      results.push(...issues);
    }
  } catch (e) {
    results.push(`❌ 模板同步: ${e.message}`);
    hasError = true;
  }
}

/**
 * 第 6 组：Skill 文件一致性
 * 比较源码 skills/*.md 与生产 ~/.claude/skills/{name}/SKILL.md
 */
function checkSkills() {
  try {
    const skillNames = Object.keys(SKILL_MAP);
    let matched = 0;
    const issues = [];

    for (const srcName of skillNames) {
      const dirName = SKILL_MAP[srcName];
      const srcPath = path.join(SKILLS_SRC, srcName);
      const prodPath = path.join(SKILLS_TARGET, dirName, 'SKILL.md');

      if (!fs.existsSync(srcPath)) {
        issues.push(`❌ 源码缺失: skills/${srcName}`);
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
        issues.push(`⚠️ Skill 不一致: ${srcName} ≠ ${dirName}/SKILL.md`);
        hasWarning = true;
      }
    }

    if (issues.length === 0) {
      results.push(`✅ Skill 一致性: ${matched}/${skillNames.length} 一致`);
    } else {
      results.push(`⚠️ Skill 一致性: ${matched}/${skillNames.length} 一致`);
      results.push(...issues);
    }
  } catch (e) {
    results.push(`❌ Skill 一致性: ${e.message}`);
    hasError = true;
  }
}

// 执行所有检查
console.log('PACEflow 健康检查');
console.log('==================');

const checks = [checkSyntax, checkSourceVsProd, checkSettings, checkVersion, checkTemplates, checkSkills];
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
