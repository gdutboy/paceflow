// install.js — PACEflow 安装脚本
// 将 hooks、skills、settings.json 配置安装到用户的 ~/.claude/ 目录
// 用法: node install.js [--dry-run] [--force] [--plugin] [--migrate]

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const pluginMode = args.includes('--plugin');
const migrateMode = args.includes('--migrate');

const HOME = process.env.HOME || process.env.USERPROFILE;
const HOOKS_TARGET = path.join(HOME, '.claude', 'hooks', 'pace');
const SKILLS_TARGET = path.join(HOME, '.claude', 'skills');
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');

const HOOKS_SRC = path.join(__dirname, 'hooks');
const SKILLS_SRC = path.join(__dirname, 'skills');
const CONFIG_SRC = path.join(__dirname, 'config', 'settings-hooks-excerpt.json');

// v5.0.0: skill 目录名列表（源码结构 skills/<name>/SKILL.md）
const SKILL_DIRS = [
  'pace-workflow',
  'artifact-management',
  'change-management',
  'pace-knowledge',
  'pace-bridge',
  'paceflow-audit',
];

// 统计计数
let installed = 0;
let updated = 0;
let skipped = 0;

/** 当前日期时间字符串 YYYYMMDD-HHmmss */
function dateStamp() {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const time = d.toTimeString().slice(0, 8).replace(/:/g, '');
  return `${date}-${time}`;
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
    // W-9: 缓存时间戳，避免跨秒差异导致日志与实际备份文件名不一致
    const stamp = dateStamp();
    const bakName = `${dest}.bak.${stamp}`;
    if (!dryRun) {
      fs.copyFileSync(dest, bakName);
    }
    log(`  🔄 ${displayName} (已更新，旧版本备份为 .bak.${stamp})`);
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
 * v5.0.0: 源码结构 skills/<name>/SKILL.md，含可选 templates/ 子目录
 */
function installSkills() {
  log('\n[2/3] 安装 Skills...');

  for (const dirName of SKILL_DIRS) {
    const srcDir = path.join(SKILLS_SRC, dirName);
    const targetDir = path.join(SKILLS_TARGET, dirName);

    // 安装 SKILL.md
    const srcSkill = path.join(srcDir, 'SKILL.md');
    if (!fs.existsSync(srcSkill)) continue;

    if (!dryRun) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    installFile(srcSkill, path.join(targetDir, 'SKILL.md'), `${dirName}/SKILL.md`);

    // 安装 templates/ 子目录（如 change-management/templates/）
    const srcTemplatesDir = path.join(srcDir, 'templates');
    if (fs.existsSync(srcTemplatesDir)) {
      const targetTemplatesDir = path.join(targetDir, 'templates');
      if (!dryRun) {
        fs.mkdirSync(targetTemplatesDir, { recursive: true });
      }
      const templateFiles = fs.readdirSync(srcTemplatesDir).filter(f => f.endsWith('.md'));
      for (const file of templateFiles) {
        installFile(
          path.join(srcTemplatesDir, file),
          path.join(targetTemplatesDir, file),
          `${dirName}/templates/${file}`
        );
      }
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

/**
 * 清理旧版手动安装遗留的无前缀模板文件和旧 SKILL 文件名
 * v5.0.0: 新增 artifact-management/templates/ 清理（模板统一到 hooks/templates/）
 */
function cleanupOldTemplates() {
  // artifact-management: 无 artifact- 前缀的旧模板
  const artDir = path.join(SKILLS_TARGET, 'artifact-management', 'templates');
  const OLD_ART = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
  for (const f of OLD_ART) {
    const fp = path.join(artDir, f);
    try {
      if (fs.existsSync(fp)) {
        if (!dryRun) fs.unlinkSync(fp);
        log(`  🗑️  artifact-management/templates/${f} (旧文件清理)`);
      }
    } catch(e) {}
  }
  // v5.0.0: artifact-management/templates/ 的 artifact-*.md 旧副本（已统一到 hooks/templates/）
  const OLD_ART_PREFIXED = ['artifact-spec.md', 'artifact-task.md', 'artifact-implementation_plan.md', 'artifact-walkthrough.md', 'artifact-findings.md'];
  for (const f of OLD_ART_PREFIXED) {
    const fp = path.join(artDir, f);
    try {
      if (fs.existsSync(fp)) {
        if (!dryRun) fs.unlinkSync(fp);
        log(`  🗑️  artifact-management/templates/${f} (v5.0.0 模板统一清理)`);
      }
    } catch(e) {}
  }
  // change-management: 无 change- 前缀或下划线变体的旧模板
  const chgDir = path.join(SKILLS_TARGET, 'change-management', 'templates');
  const OLD_CHG = ['change_record.md', 'implementation_plan.md'];
  for (const f of OLD_CHG) {
    const fp = path.join(chgDir, f);
    try {
      if (fs.existsSync(fp)) {
        if (!dryRun) fs.unlinkSync(fp);
        log(`  🗑️  change-management/templates/${f} (旧文件清理)`);
      }
    } catch(e) {}
  }
  // 旧版 SKILL 文件名（现统一为 SKILL.md）
  const OLD_SKILL_NAMES = {
    'artifact-management': 'artifact-management.md',
    'pace-knowledge': 'pace-knowledge.md',
  };
  for (const [dir, oldName] of Object.entries(OLD_SKILL_NAMES)) {
    const fp = path.join(SKILLS_TARGET, dir, oldName);
    try {
      if (fs.existsSync(fp)) {
        if (!dryRun) fs.unlinkSync(fp);
        log(`  🗑️  ${dir}/${oldName} (旧 SKILL 文件名清理)`);
      }
    } catch(e) {}
  }
  // 旧版遗留目录
  const OLD_DIRS = [
    path.join(SKILLS_TARGET, 'change-management', 'examples'),
    path.join(SKILLS_TARGET, 'change-management', 'scripts'),
  ];
  for (const dir of OLD_DIRS) {
    try {
      if (fs.existsSync(dir)) {
        if (!dryRun) fs.rmSync(dir, { recursive: true, force: true });
        log(`  🗑️  ${path.relative(SKILLS_TARGET, dir)}/ (旧目录清理)`);
      }
    } catch(e) {}
  }
}

/**
 * 递归复制目录（--plugin 模式使用）
 */
function copyDirRecursive(src, dest) {
  if (!dryRun) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      installFile(srcPath, destPath, path.relative(__dirname, srcPath));
    }
  }
}

/**
 * --plugin 模式：将 paceflow 安装到本地 plugin 缓存
 * 仅复制 plugin 需要的目录：.claude-plugin/、hooks/、skills/
 */
function installAsPlugin() {
  const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '.claude-plugin', 'plugin.json'), 'utf8'));
  const version = pj.version || '0.0.0';
  const PLUGIN_CACHE = path.join(HOME, '.claude', 'plugins', 'marketplaces', 'paceaitian-paceflow', 'paceflow', version);
  log(`\n[Plugin] 安装 paceflow@${version} 到本地 plugin 缓存...`);

  const PLUGIN_CONTENT = ['.claude-plugin', 'hooks', 'skills'];
  for (const dir of PLUGIN_CONTENT) {
    const srcDir = path.join(__dirname, dir);
    if (fs.existsSync(srcDir)) {
      copyDirRecursive(srcDir, path.join(PLUGIN_CACHE, dir));
    }
  }
  // 复制根目录 README.md（如有）
  const readme = path.join(__dirname, 'README.md');
  if (fs.existsSync(readme)) {
    installFile(readme, path.join(PLUGIN_CACHE, 'README.md'), 'README.md');
  }

  log(`\n✅ Plugin 已安装到 ${PLUGIN_CACHE}`);
}

/**
 * --migrate 模式：清理旧版手动安装（settings.json hooks + ~/.claude/hooks/pace/ + skills）
 */
function migrateFromManual() {
  log('\n[Migrate] 清理旧版手动安装...');

  // 1. 清理 settings.json 中的 PACE hook 条目
  if (fs.existsSync(SETTINGS_PATH)) {
    if (!dryRun) fs.copyFileSync(SETTINGS_PATH, SETTINGS_PATH + '.bak');
    const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    if (settings.hooks) {
      let removed = 0;
      for (const eventType of Object.keys(settings.hooks)) {
        const entries = settings.hooks[eventType];
        if (!Array.isArray(entries)) continue;
        const before = entries.length;
        settings.hooks[eventType] = entries.filter(entry => {
          const cmds = (entry.hooks || []).map(h => h.command || '').join('');
          return !cmds.includes('/pace/');
        });
        removed += before - settings.hooks[eventType].length;
        if (settings.hooks[eventType].length === 0) delete settings.hooks[eventType];
      }
      if (!dryRun) {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
      }
      log(`  🗑️  settings.json: 移除 ${removed} 个 PACE hook 条目（已备份 .bak）`);
    }
  }

  // 2. 清理旧 hooks 目录
  if (fs.existsSync(HOOKS_TARGET)) {
    if (!dryRun) fs.rmSync(HOOKS_TARGET, { recursive: true, force: true });
    log(`  🗑️  ${HOOKS_TARGET} 已删除`);
  }

  // 3. 清理旧 skills 目录中的 PACE skills
  for (const dirName of SKILL_DIRS) {
    const skillDir = path.join(SKILLS_TARGET, dirName);
    if (fs.existsSync(skillDir)) {
      if (!dryRun) fs.rmSync(skillDir, { recursive: true, force: true });
      log(`  🗑️  skills/${dirName}/ 已删除`);
    }
  }

  log('\n✅ 旧版手动安装已清理');
}

// === 主流程 ===
try {
  console.log('PACEflow 安装脚本');
  console.log('==================');
  if (dryRun) console.log('[DRY RUN] 预览模式，不会执行任何操作\n');
  if (force) console.log('[FORCE] 强制模式，不一致文件直接覆盖不备份\n');

  if (migrateMode) {
    migrateFromManual();
  } else if (pluginMode) {
    installAsPlugin();
  } else {
    installHooks();
    installSkills();
    cleanupOldTemplates();
    patchSettings();
  }

  console.log('\n==================');
  log(`完成: ${installed} 安装, ${updated} 更新, ${skipped} 跳过`);

  if (!dryRun && !migrateMode) {
    console.log('\n⚠️  重启 Claude Code 后生效');
  }
} catch (err) {
  console.error(`\n❌ 安装失败: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
}
