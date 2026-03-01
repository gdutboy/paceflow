// migrate-artifacts.js — 将 PACE artifact 从 junction 指向的 CWD 迁移到 vault 实际目录
// 用法: node migrate-artifacts.js [--dry-run] [--cleanup]
//   --dry-run  仅预览，不执行任何修改
//   --cleanup  迁移后删除 CWD 中的旧 artifact 文件
const fs = require('fs');
const path = require('path');

const ARTIFACT_FILES = ['spec.md', 'task.md', 'implementation_plan.md', 'walkthrough.md', 'findings.md'];
const VAULT_PATH = process.env.PACE_VAULT_PATH || 'C:/Users/Xiao/OneDrive/Documents/Obsidian';
const projectsDir = path.join(VAULT_PATH, 'projects');

const dryRun = process.argv.includes('--dry-run');
const cleanup = process.argv.includes('--cleanup');

if (dryRun) console.log('[DRY-RUN] 仅预览，不执行修改\n');

try {
  if (!fs.existsSync(projectsDir)) {
    console.error(`错误：projects 目录不存在: ${projectsDir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  let migratedCount = 0;
  let skippedCount = 0;

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const entryPath = path.join(projectsDir, entry.name);

    // 检测是否为 junction/symlink
    let stat;
    try { stat = fs.lstatSync(entryPath); } catch(e) { continue; }

    if (!stat.isSymbolicLink()) {
      // 已是实际目录（可能已迁移），跳过
      console.log(`  跳过 ${entry.name}（已是实际目录）`);
      skippedCount++;
      continue;
    }

    // 读取 junction 目标
    let targetDir;
    try { targetDir = fs.readlinkSync(entryPath); } catch(e) {
      console.log(`  跳过 ${entry.name}（无法读取链接目标: ${e.message}）`);
      skippedCount++;
      continue;
    }

    // 规范化目标路径（Git Bash 格式 /k/... → K:/...）
    if (/^\/[a-zA-Z]\//.test(targetDir)) {
      targetDir = targetDir[1].toUpperCase() + ':' + targetDir.slice(2);
    }

    console.log(`\n迁移 ${entry.name}:`);
    console.log(`  junction → ${targetDir}`);

    // 收集目标目录中的 artifact 文件
    const artifacts = [];
    for (const file of ARTIFACT_FILES) {
      const srcPath = path.join(targetDir, file);
      try {
        if (fs.existsSync(srcPath)) {
          artifacts.push({ file, srcPath, content: fs.readFileSync(srcPath, 'utf8') });
        }
      } catch(e) {
        console.log(`  警告：无法读取 ${srcPath}: ${e.message}`);
      }
    }

    if (artifacts.length === 0) {
      console.log(`  跳过（目标目录无 artifact 文件）`);
      skippedCount++;
      continue;
    }

    console.log(`  找到 ${artifacts.length} 个 artifact: ${artifacts.map(a => a.file).join(', ')}`);

    if (!dryRun) {
      // 1. 删除 junction
      try {
        fs.rmSync(entryPath, { recursive: true, force: true });
        console.log(`  已删除 junction`);
      } catch(e) {
        console.error(`  错误：无法删除 junction: ${e.message}`);
        continue;
      }

      // 2. 创建实际目录
      try {
        fs.mkdirSync(entryPath, { recursive: true });
        console.log(`  已创建目录`);
      } catch(e) {
        console.error(`  错误：无法创建目录: ${e.message}`);
        continue;
      }

      // 3. 复制 artifact 文件
      for (const a of artifacts) {
        const destPath = path.join(entryPath, a.file);
        fs.writeFileSync(destPath, a.content, 'utf8');
      }
      console.log(`  已复制 ${artifacts.length} 个文件`);

      // 4. 可选：删除 CWD 中的旧文件
      if (cleanup) {
        for (const a of artifacts) {
          try {
            fs.unlinkSync(a.srcPath);
            console.log(`  已清理 ${a.srcPath}`);
          } catch(e) {
            console.log(`  清理失败 ${a.srcPath}: ${e.message}`);
          }
        }
      }

      migratedCount++;
    } else {
      console.log(`  [DRY-RUN] 将删除 junction → 创建目录 → 复制 ${artifacts.length} 个文件`);
      if (cleanup) {
        console.log(`  [DRY-RUN] 将清理 CWD 中的旧 artifact`);
      }
      migratedCount++;
    }
  }

  console.log(`\n完成：${migratedCount} 迁移，${skippedCount} 跳过`);
  if (dryRun && migratedCount > 0) {
    console.log('移除 --dry-run 执行实际迁移');
  }
} catch(e) {
  console.error(`迁移失败: ${e.message}`);
  process.exit(1);
}
