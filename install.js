// install.js — PACEflow 安装脚本
// 将 hooks、skills、settings.json 配置安装到用户的 ~/.claude/ 目录
// 用法: node install.js [--dry-run] [--force]

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');

const HOME = process.env.HOME || process.env.USERPROFILE;
const HOOKS_TARGET = path.join(HOME, '.claude', 'hooks', 'pace');
const SKILLS_TARGET = path.join(HOME, '.claude', 'skills');
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');

const HOOKS_SRC = path.join(__dirname, 'hooks');
const SKILLS_SRC = path.join(__dirname, 'skills');
const CONFIG_SRC = path.join(__dirname, 'config', 'settings-hooks-excerpt.json');

// I-11: skill .md 文件到子目录的映射（硬编码合理：4 个 skill 稳定且映射关系明确）
const SKILL_MAP = {
  'pace-workflow.md': 'pace-workflow',
  'artifact-management.md': 'artifact-management',
  'change-management.md': 'change-management',
  'pace-knowledge.md': 'pace-knowledge',
};

// 统计计数
let installed = 0;
let updated = 0;
let skipped = 0;

/** 当前日期字符串 YYYYMMDD */
function dateStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

/** 输出带可选 [DRY RUN] 前缀的消息 */
function log(msg) {
  console.log(dryRun ? `[DRY RUN] ${msg}` : msg);
}

/**
 * 比较两个文件内容是否一致
 * @param {string} fileA - 文件 A 路径
 * @param {string} fileB - 文件 B 路径
 * @returns {boolean} 内容一致返回 true
 */
function filesEqual(fileA, fileB) {
  try {
    const a = fs.readFileSync(fileA);
    const b = fs.readFileSync(fileB);
    return Buffer.from(a).equals(Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * 安装单个文件：一致则跳过，不一致则备份+复制
 * @param {string} src - 源文件路径
 * @param {string} dest - 目标文件路径
 * @param {string} displayName - 显示用的文件名
 */
function installFile(src, dest, displayName) {
  const destExists = fs.existsSync(dest);

  if (destExists && filesEqual(src, dest)) {
    log(`  ⏭️  ${displayName} (一致)`);
    skipped++;
    return;
  }

  // 备份旧文件（force 模式跳过备份）
  if (destExists && !force) {
    const bakName = `${dest}.bak.${dateStamp()}`;
    if (!dryRun) {
      fs.copyFileSync(dest, bakName);
    }
    log(`  🔄 ${displayName} (已更新，旧版本备份为 .bak.${dateStamp()})`);
    updated++;
  } else if (destExists && force) {
    log(`  🔄 ${displayName} (已更新，--force 跳过备份)`);
    updated++;
  } else {
    log(`  📦 ${displayName} (已安装)`);
    installed++;
  }

  if (!dryRun) {
    // 确保目标目录存在
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

/**
 * 步骤 1：安装 hooks 到 ~/.claude/hooks/pace/
 * 包括 .js 文件和 templates/ 子目录下的 .md 文件
 */
function installHooks() {
  log('\n[1/3] 安装 Hooks...');

  if (!dryRun) {
    fs.mkdirSync(HOOKS_TARGET, { recursive: true });
  }

  // 安装 .js 文件
  const jsFiles = fs.readdirSync(HOOKS_SRC).filter(f => f.endsWith('.js'));
  for (const file of jsFiles) {
    installFile(
      path.join(HOOKS_SRC, file),
      path.join(HOOKS_TARGET, file),
      file
    );
  }

  // 安装 templates/ 子目录
  const templatesDir = path.join(HOOKS_SRC, 'templates');
  if (fs.existsSync(templatesDir)) {
    const targetTemplatesDir = path.join(HOOKS_TARGET, 'templates');
    if (!dryRun) {
      fs.mkdirSync(targetTemplatesDir, { recursive: true });
    }
    const templateFiles = fs.readdirSync(templatesDir).filter(f => f.endsWith('.md'));
    for (const file of templateFiles) {
      installFile(
        path.join(templatesDir, file),
        path.join(targetTemplatesDir, file),
        `templates/${file}`
      );
    }
  }
}

/**
 * 步骤 2：安装 skills 到 ~/.claude/skills/
 * 每个 .md skill 文件映射到对应子目录下的 SKILL.md
 * skills/templates/ 下的文件按前缀分组复制到对应 skill 目录的 templates/ 子目录
 */
function installSkills() {
  log('\n[2/3] 安装 Skills...');

  // 安装 skill .md 文件
  const skillFiles = fs.readdirSync(SKILLS_SRC).filter(f => f.endsWith('.md'));
  for (const file of skillFiles) {
    const dirName = SKILL_MAP[file];
    if (!dirName) continue; // 未知 skill 文件跳过

    const targetDir = path.join(SKILLS_TARGET, dirName);
    if (!dryRun) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    installFile(
      path.join(SKILLS_SRC, file),
      path.join(targetDir, 'SKILL.md'),
      `${dirName}/SKILL.md`
    );
  }

  // 安装 skills/templates/ 下的文件到对应 skill 目录的 templates/ 子目录
  const skillTemplatesDir = path.join(SKILLS_SRC, 'templates');
  if (fs.existsSync(skillTemplatesDir)) {
    const templateFiles = fs.readdirSync(skillTemplatesDir).filter(f => f.endsWith('.md'));

    // 按前缀分组：artifact-*.md → artifact-management, change-*.md → change-management
    for (const file of templateFiles) {
      let targetSkillDir;
      if (file.startsWith('artifact-')) {
        targetSkillDir = 'artifact-management';
      } else if (file.startsWith('change-')) {
        targetSkillDir = 'change-management';
      } else {
        continue; // 无法归类的模板跳过
      }

      const targetDir = path.join(SKILLS_TARGET, targetSkillDir, 'templates');
      if (!dryRun) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      installFile(
        path.join(skillTemplatesDir, file),
        path.join(targetDir, file),
        `${targetSkillDir}/templates/${file}`
      );
    }
  }
}

/**
 * 步骤 3：合并 PACE hook 配置到 ~/.claude/settings.json
 * 保留用户已有的非 PACE hooks，仅添加/更新 PACE 条目
 */
function patchSettings() {
  log('\n[3/3] 更新 settings.json...');

  // 读取或创建 settings.json
  let settings;
  if (fs.existsSync(SETTINGS_PATH)) {
    // W-11: 修改前备份
    if (!dryRun) {
      fs.copyFileSync(SETTINGS_PATH, SETTINGS_PATH + '.bak');
    }
    try {
      settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    } catch(e) {
      // W-12: 解析失败提供清晰错误提示
      console.error(`❌ settings.json 格式错误: ${e.message}`);
      console.log('  备份已保存: ' + SETTINGS_PATH + '.bak');
      process.exit(1);
    }
  } else {
    settings = {};
    log('  📦 settings.json 不存在，将创建新文件');
  }
  if (!settings.hooks) settings.hooks = {};

  // 读取 excerpt 配置
  const excerpt = JSON.parse(fs.readFileSync(CONFIG_SRC, 'utf8'));
  const hooksDir = HOOKS_TARGET.replace(/\\/g, '/');

  // 遍历 excerpt 中的每个事件类型
  for (const [eventType, matchers] of Object.entries(excerpt.hooks)) {
    if (!settings.hooks[eventType]) settings.hooks[eventType] = [];

    for (const matcherEntry of matchers) {
      const matcher = matcherEntry.matcher;

      // 替换 <HOOKS_DIR> 占位符为实际路径
      const newHooks = matcherEntry.hooks.map(h => ({
        ...h,
        command: h.command.replace('<HOOKS_DIR>', hooksDir),
      }));

      // 查找 settings 中是否已有匹配的 PACE hook 条目
      const existingIdx = settings.hooks[eventType].findIndex(entry => {
        if (entry.matcher !== matcher) return false;
        return entry.hooks && entry.hooks.some(h => h.command && h.command.includes('/pace/'));
      });

      if (existingIdx >= 0) {
        // 更新已有条目的 command 路径
        settings.hooks[eventType][existingIdx].hooks = newHooks;
        const label = matcher || '(all)';
        log(`  ✅ ${eventType} [${label}] hook 已存在，路径已更新`);
      } else {
        // 添加新条目
        settings.hooks[eventType].push({
          matcher,
          hooks: newHooks,
        });
        const label = matcher || '(all)';
        log(`  📦 ${eventType} [${label}] hook 已添加`);
      }
    }
  }

  // 写回 settings.json
  if (!dryRun) {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }
}

// === 主流程 ===
try {
  console.log('PACEflow 安装脚本');
  console.log('==================');
  if (dryRun) console.log('[DRY RUN] 预览模式，不会执行任何操作\n');
  if (force) console.log('[FORCE] 强制模式，不一致文件直接覆盖不备份\n');

  installHooks();
  installSkills();
  patchSettings();

  console.log('\n==================');
  log(`安装完成: ${installed} 安装, ${updated} 更新, ${skipped} 跳过`);

  if (!dryRun) {
    console.log('\n⚠️  settings.json 修改后需要重启 Claude Code 才能生效');
  }
} catch (err) {
  console.error(`\n❌ 安装失败: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}
