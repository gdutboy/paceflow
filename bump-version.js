// bump-version.js — 一条命令同步 5 个文件的版本号
// 用法：node paceflow/bump-version.js [--dry-run] <version>
// 示例：node paceflow/bump-version.js 5.1.0
//       node paceflow/bump-version.js --dry-run v5.1.0
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const version = args.filter(a => a !== '--dry-run')[0];

if (!version) {
  console.error('用法: node bump-version.js [--dry-run] <version>');
  console.error('示例: node bump-version.js 5.1.0');
  process.exit(1);
}

const cleanVer = version.replace(/^v/, '');
const displayVer = 'v' + cleanVer;

if (!/^\d+\.\d+\.\d+$/.test(cleanVer)) {
  console.error(`版本号格式不合法: "${version}" → 需要 x.y.z 格式`);
  process.exit(1);
}

console.log(`${dryRun ? '[DRY-RUN] ' : ''}同步版本号 → ${displayVer}\n`);

let changed = 0;

// 通用替换函数
function updateFile(relPath, pattern, replacement, label) {
  const fp = path.join(ROOT, relPath);
  if (!fs.existsSync(fp)) {
    console.log(`  [跳过] ${relPath} — 文件不存在`);
    return;
  }
  const content = fs.readFileSync(fp, 'utf8');
  const match = content.match(pattern);
  if (!match) {
    console.log(`  [跳过] ${relPath} — 未匹配到模式 ${pattern}`);
    return;
  }
  const oldVal = match[0];
  const newContent = content.replace(pattern, replacement);
  if (oldVal === replacement) {
    console.log(`  [无变更] ${relPath}: ${label} — ${oldVal}`);
    return;
  }
  if (!dryRun) {
    fs.writeFileSync(fp, newContent, 'utf8');
  }
  console.log(`  [${dryRun ? '将更新' : '已更新'}] ${relPath}: ${oldVal} → ${replacement}`);
  changed++;
}

// JSON 文件专用替换函数
function updateJson(relPath, accessor, newVal, label) {
  const fp = path.join(ROOT, relPath);
  if (!fs.existsSync(fp)) {
    console.log(`  [跳过] ${relPath} — 文件不存在`);
    return;
  }
  const content = fs.readFileSync(fp, 'utf8');
  const obj = JSON.parse(content);
  const oldVal = accessor(obj);
  if (oldVal === newVal) {
    console.log(`  [无变更] ${relPath}: ${label} — "${oldVal}"`);
    return;
  }
  // 用正则替换保留原始格式（避免 JSON.stringify 改变缩进）
  const escaped = oldVal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`("version"\\s*:\\s*)"${escaped}"`);
  const newContent = content.replace(pattern, `$1"${newVal}"`);
  if (newContent === content) {
    console.log(`  [跳过] ${relPath} — 正则替换失败`);
    return;
  }
  if (!dryRun) {
    fs.writeFileSync(fp, newContent, 'utf8');
  }
  console.log(`  [${dryRun ? '将更新' : '已更新'}] ${relPath}: "${oldVal}" → "${newVal}"`);
  changed++;
}

// 1. hooks/pace-utils.js — PACE_VERSION 常量
updateFile(
  'hooks/pace-utils.js',
  /PACE_VERSION\s*=\s*'[^']+'/,
  `PACE_VERSION = '${displayVer}'`,
  'PACE_VERSION'
);

// 2. .claude-plugin/plugin.json — .version
updateJson(
  '.claude-plugin/plugin.json',
  obj => obj.version,
  cleanVer,
  'plugin.json version'
);

// 3. .claude-plugin/marketplace.json — .plugins[0].version
updateJson(
  '.claude-plugin/marketplace.json',
  obj => obj.plugins[0].version,
  cleanVer,
  'marketplace.json version'
);

// 4. REFERENCE.md L1 — # PACEflow vX.Y.Z
updateFile(
  'REFERENCE.md',
  /^# PACEflow v[\d.]+/m,
  `# PACEflow ${displayVer}`,
  'REFERENCE.md 标题'
);

// 5. REFERENCE.md L3 — **版本**：vX.Y.Z（中文冒号）
updateFile(
  'REFERENCE.md',
  /\*\*版本\*\*：v[\d.]+/,
  `**版本**：${displayVer}`,
  'REFERENCE.md 版本行'
);

// 6. README.md L3 — **版本**: vX.Y.Z（英文冒号）
updateFile(
  'README.md',
  /\*\*版本\*\*:\s*v[\d.]+/,
  `**版本**: ${displayVer}`,
  'README.md 版本行'
);

console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}共 ${changed} 个文件${dryRun ? '将被' : '已'}更新`);
if (changed > 0) {
  console.log('\n注意：CLAUDE.md 中散文里的版本号需手动检查更新。');
}
